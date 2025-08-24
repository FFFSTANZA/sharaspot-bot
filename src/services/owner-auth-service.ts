// src/owner/services/owner-auth-service.ts
import { db } from '../config/database';
import { stationOwners } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';
import { ownerService } from './owner-service';

// Session storage (in production, use Redis or database)
interface AuthSession {
  whatsappId: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export class OwnerAuthService {
  private activeSessions = new Map<string, AuthSession>();
  private readonly SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Check if owner is authenticated
   */
  async isAuthenticated(whatsappId: string): Promise<boolean> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return false;
      }

      // Check if owner exists and is active
      const owner = await ownerService.getOwnerProfile(whatsappId);
      return !!(owner?.isActive);
    } catch (error) {
      logger.error('Authentication check failed', { whatsappId, error });
      return false;
    }
  }

  /**
   * Authenticate owner by business name
   */
  async authenticateByBusinessName(whatsappId: string, businessName: string): Promise<boolean> {
    try {
      const owner = await ownerService.getOwnerByBusinessName(businessName);
      
      if (!owner) {
        logger.warn('Owner not found by business name', { businessName });
        return false;
      }

      // For security, check if the WhatsApp ID matches
      if (owner.whatsappId !== whatsappId) {
        logger.warn('WhatsApp ID mismatch for business name', { businessName, whatsappId });
        return false;
      }

      // Check if owner is active
      if (!owner.isActive) {
        logger.warn('Owner account is not active', { whatsappId, businessName });
        return false;
      }

      logger.info('Owner authenticated successfully', { whatsappId, businessName });
      return true;

    } catch (error) {
      logger.error('Authentication by business name failed', { whatsappId, businessName, error });
      return false;
    }
  }

  /**
   * Create authentication session
   */
  async createAuthSession(whatsappId: string): Promise<string | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        return null;
      }

      // Check if owner exists and is active
      const isAuthenticated = await this.isAuthenticated(whatsappId);
      if (!isAuthenticated) {
        return null;
      }

      // Generate session token
      const token = this.generateSessionToken(whatsappId);
      const expiresAt = new Date(Date.now() + this.SESSION_DURATION);

      // Store session
      const session: AuthSession = {
        whatsappId,
        token,
        createdAt: new Date(),
        expiresAt,
        isActive: true
      };

      this.activeSessions.set(token, session);

      logger.info('Auth session created', { whatsappId, token });
      return token;

    } catch (error) {
      logger.error('Failed to create auth session', { whatsappId, error });
      return null;
    }
  }

  /**
   * Validate session token
   */
  async validateSession(token: string): Promise<boolean> {
    try {
      const session = this.activeSessions.get(token);
      
      if (!session) {
        return false;
      }

      // Check if session is expired
      if (session.expiresAt < new Date()) {
        this.activeSessions.delete(token);
        return false;
      }

      // Check if session is still active
      if (!session.isActive) {
        return false;
      }

      // Update expiration (sliding window)
      session.expiresAt = new Date(Date.now() + this.SESSION_DURATION);
      this.activeSessions.set(token, session);

      return true;

    } catch (error) {
      logger.error('Session validation failed', { token, error });
      return false;
    }
  }

  /**
   * Get WhatsApp ID from session token
   */
  async getWhatsAppIdFromToken(token: string): Promise<string | null> {
    try {
      const session = this.activeSessions.get(token);
      
      if (!session || !session.isActive || session.expiresAt < new Date()) {
        return null;
      }

      return session.whatsappId;

    } catch (error) {
      logger.error('Failed to get WhatsApp ID from token', { token, error });
      return null;
    }
  }

  /**
   * Invalidate session
   */
  async invalidateSession(token: string): Promise<boolean> {
    try {
      const session = this.activeSessions.get(token);
      
      if (session) {
        session.isActive = false;
        this.activeSessions.set(token, session);
        this.activeSessions.delete(token);
        logger.info('Session invalidated', { token });
        return true;
      }

      return false;

    } catch (error) {
      logger.error('Failed to invalidate session', { token, error });
      return false;
    }
  }

  /**
   * Invalidate all sessions for a WhatsApp ID
   */
  async invalidateAllSessions(whatsappId: string): Promise<boolean> {
    try {
      let count = 0;
      
      for (const [token, session] of this.activeSessions.entries()) {
        if (session.whatsappId === whatsappId) {
          session.isActive = false;
          this.activeSessions.delete(token);
          count++;
        }
      }

      logger.info('All sessions invalidated for owner', { whatsappId, count });
      return count > 0;

    } catch (error) {
      logger.error('Failed to invalidate all sessions', { whatsappId, error });
      return false;
    }
  }

  /**
   * Cleanup expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = new Date();
    let expiredCount = 0;
    
    for (const [token, session] of this.activeSessions.entries()) {
      if (session.expiresAt < now) {
        this.activeSessions.delete(token);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.info('Expired sessions cleaned up', { expiredCount });
    }
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Generate session token
   */
  private generateSessionToken(whatsappId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `owner_${whatsappId}_${timestamp}_${random}`;
  }

  /**
   * Verify owner credentials (for future email/password auth)
   */
  async verifyCredentials(whatsappId: string, password: string): Promise<boolean> {
    // Placeholder for future credential-based authentication
    // This would typically involve hashing and comparing passwords
    logger.warn('Password authentication not implemented yet', { whatsappId });
    return false;
  }

  /**
   * Request password reset
   */
  async requestPasswordReset(whatsappId: string): Promise<boolean> {
    // Placeholder for future password reset functionality
    logger.warn('Password reset not implemented yet', { whatsappId });
    return false;
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const ownerAuthService = new OwnerAuthService();

// Regular cleanup of expired sessions
setInterval(() => {
  ownerAuthService.cleanupExpiredSessions();
}, 60 * 60 * 1000); // Cleanup every hour