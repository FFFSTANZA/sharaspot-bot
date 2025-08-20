import { eq, and } from 'drizzle-orm';
import { db } from '../config/database';
import { users, auditLogs, type User, type NewUser } from '../db/schema';
import { logger } from '../utils/logger';
import { validateWhatsAppId, userPreferencesSchema } from '../utils/validation';

export class UserService {
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
   * Create new user
   */
  async createUser(userData: NewUser): Promise<User | null> {
    try {
      if (!validateWhatsAppId(userData.whatsappId)) {
        logger.warn('Invalid WhatsApp ID format during user creation', { whatsappId: userData.whatsappId });
        return null;
      }

      const [newUser] = await db
        .insert(users)
        .values({
          ...userData,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Log the user creation
      await this.logUserAction(userData.whatsappId, 'user_created', null, newUser);

      logger.info('✅ User created successfully', { 
        whatsappId: newUser.whatsappId, 
        userId: newUser.id 
      });

      return newUser;
    } catch (error) {
      logger.error('Failed to create user', { userData, error });
      return null;
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
   */
  async updateUserProfile(
    whatsappId: string,
    profileData: { name?: string; phoneNumber?: string }
  ): Promise<User | null> {
    try {
      const currentUser = await this.getUserByWhatsAppId(whatsappId);
      if (!currentUser) {
        logger.warn('User not found for profile update', { whatsappId });
        return null;
      }

      const [updatedUser] = await db
        .update(users)
        .set({
          ...profileData,
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
    } catch (error) {
      logger.error('Failed to update user profile', { whatsappId, profileData, error });
      return null;
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

export const userService = new UserService();