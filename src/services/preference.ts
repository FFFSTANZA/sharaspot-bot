import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { users, type User } from '../db/schema';
import { logger } from '../utils/logger';
import { userService } from './user';

export interface PreferenceStep {
  step: 'ev_model' | 'connector_type' | 'charging_intent' | 'queue_preference' | 'completed';
  data?: any;
}

export interface UserContext {
  whatsappId: string;
  currentStep: PreferenceStep['step'];
  preferenceData: {
    evModel?: string;
    connectorType?: string;
    chargingIntent?: string;
    queuePreference?: string;
  };
  isOnboarding: boolean;
}

export class PreferenceService {
  // In-memory context storage (Phase 1 limitation - no Redis)
  private userContexts = new Map<string, UserContext>();

  /**
   * Start preference gathering flow
   */
  async startPreferenceFlow(whatsappId: string, isOnboarding: boolean = false): Promise<void> {
    try {
      // Initialize user context
      this.userContexts.set(whatsappId, {
        whatsappId,
        currentStep: 'ev_model',
        preferenceData: {},
        isOnboarding,
      });

      logger.info('Started preference flow', { whatsappId, isOnboarding });
    } catch (error) {
      logger.error('Failed to start preference flow', { whatsappId, error });
    }
  }

  /**
   * Get user context
   */
  getUserContext(whatsappId: string): UserContext | null {
    return this.userContexts.get(whatsappId) || null;
  }

  /**
   * Update user context
   */
  updateUserContext(whatsappId: string, updates: Partial<UserContext>): void {
    const context = this.userContexts.get(whatsappId);
    if (context) {
      this.userContexts.set(whatsappId, { ...context, ...updates });
    }
  }

  /**
   * Clear user context (after completion)
   */
  clearUserContext(whatsappId: string): void {
    this.userContexts.delete(whatsappId);
  }

  /**
   * Save preferences to database
   */
  async savePreferences(whatsappId: string): Promise<User | null> {
    try {
      const context = this.getUserContext(whatsappId);
      if (!context) {
        logger.warn('No context found for saving preferences', { whatsappId });
        return null;
      }

      const updatedUser = await userService.updateUserPreferences(
        whatsappId,
        context.preferenceData
      );

      if (updatedUser) {
        this.clearUserContext(whatsappId);
        logger.info('✅ Preferences saved successfully', { whatsappId });
      }

      return updatedUser;
    } catch (error) {
      logger.error('Failed to save preferences', { whatsappId, error });
      return null;
    }
  }

  /**
   * Check if user is in preference flow
   */
  isInPreferenceFlow(whatsappId: string): boolean {
    return this.userContexts.has(whatsappId);
  }

  /**
   * Get next step in preference flow
   */
  getNextStep(currentStep: PreferenceStep['step']): PreferenceStep['step'] {
    const stepOrder: PreferenceStep['step'][] = [
      'ev_model',
      'connector_type', 
      'charging_intent',
      'queue_preference',
      'completed'
    ];
    
    const currentIndex = stepOrder.indexOf(currentStep);
    return stepOrder[currentIndex + 1] || 'completed';
  }

  /**
   * Get previous step in preference flow
   */
  getPreviousStep(currentStep: PreferenceStep['step']): PreferenceStep['step'] {
    const stepOrder: PreferenceStep['step'][] = [
      'ev_model',
      'connector_type',
      'charging_intent', 
      'queue_preference',
      'completed'
    ];
    
    const currentIndex = stepOrder.indexOf(currentStep);
    return stepOrder[currentIndex - 1] || 'ev_model';
  }
}

export const preferenceService = new PreferenceService();