// src/services/userService.ts - COMPLETE FIXED VERSION
// Replace your entire userService.ts file with this content

import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

export class UserService {
  /**
   * Get or create user - the safe way (string parameter)
   */
  static async getOrCreateUser(whatsappId: string) {
    try {
      logger.info('🔍 Looking for user', { whatsappId });

      // First, try to find existing user
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.whatsappId, whatsappId))
        .limit(1);

      if (existingUser.length > 0) {
        logger.info('✅ Found existing user', { 
          whatsappId, 
          userId: existingUser[0].id 
        });
        return existingUser[0];
      }

      // If user doesn't exist, create new one
      logger.info('➕ Creating new user', { whatsappId });
      
      const newUser = await db
        .insert(users)
        .values({
          whatsappId,
          // Don't set other fields, let them use schema defaults
        })
        .returning();

      logger.info('✅ Successfully created new user', { 
        whatsappId, 
        userId: newUser[0].id 
      });

      return newUser[0];

    } catch (error: any) {
      // Handle the specific constraint violation
      if (error?.code === '23505' && error?.constraint === 'users_whatsapp_id_unique') {
        logger.warn('🔄 User creation race condition detected, fetching existing user', { whatsappId });
        
        // Race condition: user was created between our check and insert
        // Just fetch the existing user
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.whatsappId, whatsappId))
          .limit(1);

        if (existingUser.length > 0) {
          return existingUser[0];
        }
      }

      logger.error('❌ Failed to get or create user', { 
        whatsappId, 
        error: error?.message || 'Unknown error',
        code: error?.code 
      });
      throw error;
    }
  }

  /**
   * Create user with object parameter (for backward compatibility with webhook)
   */
  static async createUser(userData: { whatsappId: string; name?: string }) {
    try {
      const { whatsappId, name } = userData;
      
      logger.info('📝 Creating/updating user', { whatsappId, name });
      
      // Use the existing getOrCreateUser method
      const existingUser = await this.getOrCreateUser(whatsappId);
      
      // If name is provided and user doesn't have a name, update it
      if (name && !existingUser.name) {
        const updatedUser = await db
          .update(users)
          .set({ 
            name,
            updatedAt: new Date()
          })
          .where(eq(users.whatsappId, whatsappId))
          .returning();
          
        logger.info('✅ Updated user with name', { whatsappId, name });
        return updatedUser[0];
      }
      
      return existingUser;
      
    } catch (error: any) {
      logger.error('❌ Failed to create user', { 
        userData, 
        error: error?.message || 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Alternative: Use upsert pattern (PostgreSQL specific)
   */
  static async upsertUser(whatsappId: string) {
    try {
      const result = await db
        .insert(users)
        .values({ whatsappId })
        .onConflictDoUpdate({
          target: users.whatsappId,
          set: {
            updatedAt: new Date(), // Update timestamp on conflict
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
   * Update user profile
   */
  static async updateUserProfile(whatsappId: string, updates: { name?: string; phoneNumber?: string }) {
    try {
      const updatedUser = await db
        .update(users)
        .set({
          ...updates,
          updatedAt: new Date()
        })
        .where(eq(users.whatsappId, whatsappId))
        .returning();

      if (updatedUser.length > 0) {
        logger.info('✅ User profile updated', { whatsappId, updates });
        return updatedUser[0];
      }

      return null;
    } catch (error: any) {
      logger.error('❌ Failed to update user profile', { whatsappId, updates, error });
      throw error;
    }
  }

  /**
   * Get user by WhatsApp ID
   */
  static async getUserByWhatsAppId(whatsappId: string) {
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.whatsappId, whatsappId))
        .limit(1);

      return user.length > 0 ? user[0] : null;
    } catch (error: any) {
      logger.error('❌ Failed to get user', { whatsappId, error });
      return null;
    }
  }
}

// Export a default instance for backward compatibility with existing imports
export const userService = {
  createUser: UserService.createUser.bind(UserService),
  getOrCreateUser: UserService.getOrCreateUser.bind(UserService),
  upsertUser: UserService.upsertUser.bind(UserService),
  updateUserProfile: UserService.updateUserProfile.bind(UserService),
  getUserByWhatsAppId: UserService.getUserByWhatsAppId.bind(UserService)
};

// Export individual functions for modern usage
export async function handleIncomingMessage(whatsappId: string, message: any) {
  try {
    logger.info('📨 Processing message', { whatsappId, messageType: message?.type });

    // Use the safe user creation method
    const user = await UserService.getOrCreateUser(whatsappId);
    
    // Continue with your message processing logic...
    
  } catch (error: any) {
    logger.error('❌ Message processing failed', { 
      whatsappId, 
      messageId: message?.id,
      error: error?.message || 'Unknown error'
    });
    
    // Send error response to user
    await sendErrorMessage(whatsappId, "Sorry, something went wrong. Please try again.");
  }
}

async function sendErrorMessage(whatsappId: string, message: string) {
  // Implement your WhatsApp message sending logic here
  logger.info('📤 Sending error message', { whatsappId, message });
}