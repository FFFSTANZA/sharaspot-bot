// src/services/userService.ts - Fix user creation logic
import { db } from '../config/database';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';

export class UserService {
  /**
   * Get or create user - the safe way
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
}

// Update your message handler to use the fixed user service
export async function handleIncomingMessage(whatsappId: string, message: any) {
  try {
    logger.info('📨 Processing message', { whatsappId, messageType: message.type });

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