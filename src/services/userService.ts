// src/services/userService.ts
import { db } from '../config/database';
import { users, auditLogs, type User, type NewUser } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId, userPreferencesSchema } from '../utils/validation';

export class UserService {
  /**
   * Get or create user - the safe way (handles race conditions)
   */
  async getOrCreateUser(whatsappId: string): Promise<User> {
    try {
      logger.info('🔍 Looking for user', { whatsappId });

      if (!validateWhatsAppId(whatsappId)) {
        throw new Error('Invalid WhatsApp ID format');
      }

      // First, try to find existing user
      const existingUser = await this.getUserByWhatsAppId(whatsappId);
      
      if (existingUser) {
        logger.info('✅ Found existing user', { 
          whatsappId, 
          userId: existingUser.id 
        });
        return existingUser;
      }

      // If user doesn't exist, create new one
      logger.info('➕ Creating new user', { whatsappId });
      
      try {
        const [newUser] = await db
          .insert(users)
          .values({
            whatsappId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        // Log the user creation
        await this.logUserAction(whatsappId, 'user_created', null, newUser);

        logger.info('✅ Successfully created new user', { 
          whatsappId, 
          userId: newUser.id 
        });

        return newUser;
      } catch (error: any) {
        // Handle the specific constraint violation (race condition)
        if (error?.code === '23505' && error?.constraint === 'users_whatsapp_id_unique') {
          logger.warn('🔄 User creation race condition detected, fetching existing user', { whatsappId });
          
          // Race condition: user was created between our check and insert
          // Just fetch the existing user
          const existingUser = await this.getUserByWhatsAppId(whatsappId);
          if (existingUser) {
            return existingUser;
          }
        }
        throw error;
      }
    } catch (error: any) {
      logger.error('❌ Failed to get or create user', { 
        whatsappId, 
        error: error?.message || 'Unknown error',
        code: error?.code 
      });
      throw error;
    }
  }

  /**
   * Get user by WhatsApp ID
   */
  async getUserByWhatsAppId(whatsappId: string): Promise<User | null> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        logger.warn('Invalid WhatsApp ID format', { whatsappId });
        return null;
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.whatsappId, whatsappId))
        .limit(1);

      return user || null;
    } catch (error) {
      logger.error('Failed to get user by WhatsApp ID', { whatsappId, error });
      return null;
    }
  }

  /**
   * Create new user with optional profile data
   */
  async createUser(userData: NewUser): Promise<User> {
    try {
      if (!validateWhatsAppId(userData.whatsappId)) {
        throw new Error('Invalid WhatsApp ID format');
      }

      // Use getOrCreateUser which handles race conditions
      const user = await this.getOrCreateUser(userData.whatsappId);
      
      // Build update object only with non-null/undefined values
      const updates: Partial<User> = {};
      if (typeof userData.name === 'string') updates.name = userData.name;
      if (typeof userData.phoneNumber === 'string') updates.phoneNumber = userData.phoneNumber;
      
      if (Object.keys(updates).length > 0) {
        return await this.updateUserProfile(userData.whatsappId, updates);
      }
      
      return user;
    } catch (error: any) {
      logger.error('Failed to create user', { userData, error });
      throw error;
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(
    whatsappId: string, 
    preferences: {
      evModel?: string;
      connectorType?: string;
      chargingIntent?: string;
      queuePreference?: string;
    }
  ): Promise<User | null> {
    try {
      // Validate preferences
      const validationResult = userPreferencesSchema.safeParse(preferences);
      if (!validationResult.success) {
        logger.warn('Invalid user preferences', { whatsappId, preferences, errors: validationResult.error });
        return null;
      }

      // Get current user data for audit log
      const currentUser = await this.getUserByWhatsAppId(whatsappId);
      if (!currentUser) {
        logger.warn('User not found for preferences update', { whatsappId });
        return null;
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          ...preferences,
          preferencesCaptured: true,
          updatedAt: new Date(),
        })
        .where(eq(users.whatsappId, whatsappId))
        .returning();

      // Log the preference update
      await this.logUserAction(whatsappId, 'preferences_updated', currentUser, updatedUser);

      logger.info('✅ User preferences updated', { 
        whatsappId, 
        preferences,
        userId: updatedUser.id 
      });

      return updatedUser;
    } catch (error) {
      logger.error('Failed to update user preferences', { whatsappId, preferences, error });
      return null;
    }
  }

  /**
   * Update user profile (name, phone)
   * Accepts null or string, but filters nulls out before DB update
   */
  async updateUserProfile(
    whatsappId: string,
    profileData: { name?: string | null; phoneNumber?: string | null }
  ): Promise<User> {
    try {
      const currentUser = await this.getUserByWhatsAppId(whatsappId);
      if (!currentUser) {
        throw new Error('User not found');
      }

      // Only include defined (non-null) fields
      const updateData: { name?: string; phoneNumber?: string } = {};
      if (profileData.name != null) updateData.name = profileData.name;
      if (profileData.phoneNumber != null) updateData.phoneNumber = profileData.phoneNumber;

      const [updatedUser] = await db
        .update(users)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(users.whatsappId, whatsappId))
        .returning();

      // Log the profile update
      await this.logUserAction(whatsappId, 'profile_updated', currentUser, updatedUser);

      logger.info('✅ User profile updated', { 
        whatsappId, 
        profileData,
        userId: updatedUser.id 
      });

      return updatedUser;
    } catch (error: any) {
      logger.error('Failed to update user profile', { whatsappId, profileData, error });
      throw error;
    }
  }

  /**
   * Check if user has completed preferences setup
   */
  async hasCompletedPreferences(whatsappId: string): Promise<boolean> {
    try {
      const user = await this.getUserByWhatsAppId(whatsappId);
      return user?.preferencesCaptured || false;
    } catch (error) {
      logger.error('Failed to check user preferences completion', { whatsappId, error });
      return false;
    }
  }

  /**
   * Ban/unban user
   */
  async updateUserBanStatus(whatsappId: string, isBanned: boolean, adminWhatsappId: string): Promise<boolean> {
    try {
      const currentUser = await this.getUserByWhatsAppId(whatsappId);
      if (!currentUser) {
        logger.warn('User not found for ban status update', { whatsappId });
        return false;
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          isBanned,
          updatedAt: new Date(),
        })
        .where(eq(users.whatsappId, whatsappId))
        .returning();

      // Log the ban/unban action
      await db.insert(auditLogs).values({
        actorWhatsappId: adminWhatsappId,
        actorType: 'admin',
        action: isBanned ? 'user_banned' : 'user_unbanned',
        resourceType: 'user',
        resourceId: whatsappId,
        oldValues: { isBanned: currentUser.isBanned },
        newValues: { isBanned },
        createdAt: new Date(),
      });

      logger.info(`✅ User ${isBanned ? 'banned' : 'unbanned'}`, { 
        whatsappId, 
        adminWhatsappId,
        userId: updatedUser.id 
      });

      return true;
    } catch (error) {
      logger.error('Failed to update user ban status', { whatsappId, isBanned, adminWhatsappId, error });
      return false;
    }
  }

  /**
   * Check if user is banned
   */
  async isUserBanned(whatsappId: string): Promise<boolean> {
    try {
      const user = await this.getUserByWhatsAppId(whatsappId);
      return user?.isBanned || false;
    } catch (error) {
      logger.error('Failed to check user ban status', { whatsappId, error });
      return false;
    }
  }

  /**
   * Upsert user (PostgreSQL specific)
   */
  async upsertUser(whatsappId: string, userData?: Partial<NewUser>): Promise<User> {
    try {
      if (!validateWhatsAppId(whatsappId)) {
        throw new Error('Invalid WhatsApp ID format');
      }

      const result = await db
        .insert(users)
        .values({
          whatsappId,
          ...userData,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.whatsappId,
          set: {
            ...userData,
            updatedAt: new Date(),
          }
        })
        .returning();

      logger.info('✅ User upserted successfully', { 
        whatsappId, 
        userId: result[0].id 
      });

      return result[0];
    } catch (error: any) {
      logger.error('❌ Failed to upsert user', { whatsappId, error: error?.message || 'Unknown error' });
      throw error;
    }
  }

  /**
   * Log user action for audit trail
   */
  private async logUserAction(
    whatsappId: string, 
    action: string, 
    oldValues: any, 
    newValues: any
  ): Promise<void> {
    try {
      await db.insert(auditLogs).values({
        actorWhatsappId: whatsappId,
        actorType: 'user',
        action,
        resourceType: 'user',
        resourceId: whatsappId,
        oldValues,
        newValues,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to log user action', { whatsappId, action, error });
    }
  }
}

// Export a singleton instance
export const userService = new UserService();

// Helper function for message processing
export async function handleIncomingMessage(whatsappId: string, message: any) {
  try {
    logger.info('📨 Processing message', { whatsappId, messageType: message?.type });

    // Use the safe user creation method
    const user = await userService.getOrCreateUser(whatsappId);
    
    // Continue with your message processing logic...
    return user;
    
  } catch (error: any) {
    logger.error('❌ Message processing failed', { 
      whatsappId, 
      messageId: message?.id,
      error: error?.message || 'Unknown error'
    });
    
    // Send error response to user
    await sendErrorMessage(whatsappId, "Sorry, something went wrong. Please try again.");
    throw error;
  }
}

async function sendErrorMessage(whatsappId: string, message: string) {
  // Implement your WhatsApp message sending logic here
  logger.info('📤 Sending error message', { whatsappId, message });
}