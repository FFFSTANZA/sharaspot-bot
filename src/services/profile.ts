import { whatsappService } from './whatsapp';
import { userService } from './user';
import { logger } from '../utils/logger';

export class ProfileService {
  /**
   * Extract and update user profile from WhatsApp
   */
  async updateUserProfileFromWhatsApp(whatsappId: string, messageContext?: any): Promise<void> {
    try {
      // In a real implementation, you would call WhatsApp Business API
      // to get user profile information. For now, we'll simulate this.
      
      // This would be implemented with WhatsApp Business API profile endpoint
      const profileData = await this.fetchWhatsAppProfile(whatsappId);
      
      if (profileData) {
        await userService.updateUserProfile(whatsappId, {
          name: profileData.name,
          phoneNumber: profileData.phoneNumber,
        });

        logger.info('Profile updated from WhatsApp', { whatsappId, profileData });
      }
    } catch (error) {
      logger.error('Failed to update profile from WhatsApp', { whatsappId, error });
    }
  }

  /**
   * Fetch user profile from WhatsApp Business API
   * Note: This is a placeholder - actual implementation depends on WhatsApp Business API
   */
  private async fetchWhatsAppProfile(whatsappId: string): Promise<{name?: string, phoneNumber?: string} | null> {
    try {
      // Placeholder for actual WhatsApp Business API call
      // In real implementation, you would call:
      // GET https://graph.facebook.com/v18.0/{whatsappId}
      
      // For now, we'll extract the phone number from WhatsApp ID
      return {
        phoneNumber: whatsappId,
        // name would come from actual API call
      };
    } catch (error) {
      logger.error('Failed to fetch WhatsApp profile', { whatsappId, error });
      return null;
    }
  }

  /**
   * Request user name if not available
   */
  async requestUserName(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '👋 *What should I call you?*\n\n' +
      'Please tell me your name so I can personalize your experience!\n\n' +
      'Just type your name (e.g., "Ravi" or "Priya")'
    );
  }

  /**
   * Update user name from text input
   */
  async updateUserName(whatsappId: string, name: string): Promise<boolean> {
    try {
      const cleanName = name.trim();
      if (cleanName.length < 2 || cleanName.length > 50) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Please provide a valid name (2-50 characters).'
        );
        return false;
      }

      const updatedUser = await userService.updateUserProfile(whatsappId, { name: cleanName });
      
      if (updatedUser) {
        await whatsappService.sendTextMessage(
          whatsappId,
          `✅ Nice to meet you, *${cleanName}*! 👋\n\nLet's set up your EV charging preferences.`
        );
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed to update user name', { whatsappId, name, error });
      return false;
    }
  }

  /**
   * Show user profile summary
   */
  async showProfileSummary(whatsappId: string): Promise<void> {
    try {
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Profile not found. Please start with "hi".'
        );
        return;
      }

      const profileText = `👤 *Your Profile*\n\n` +
        `📱 Name: ${user.name || 'Not set'}\n` +
        `📞 Phone: ${user.phoneNumber || whatsappId}\n` +
        `🚗 EV Model: ${user.evModel || 'Not specified'}\n` +
        `🔌 Connector: ${user.connectorType || 'Not set'}\n` +
        `⚡ Charging Style: ${user.chargingIntent || 'Not set'}\n` +
        `🚶‍♂️ Queue Preference: ${user.queuePreference || 'Not set'}\n` +
        `✅ Preferences Complete: ${user.preferencesCaptured ? 'Yes' : 'No'}\n` +
        `📅 Member Since: ${user.createdAt ? user.createdAt.toLocaleDateString() : 'Unknown'}`;
      await whatsappService.sendButtonMessage(
        whatsappId,
        profileText,
        [
          { id: 'update_preferences', title: '🔄 Update Preferences' },
          { id: 'update_profile', title: '✏️ Update Name' },
        ],
        '👤 Your Profile'
      );

    } catch (error) {
      logger.error('Failed to show profile summary', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load profile. Please try again.'
      );
    }
  }

  /**
   * Handle profile update requests
   */
  async handleProfileUpdate(whatsappId: string, updateType: string): Promise<void> {
    switch (updateType) {
      case 'update_preferences':
        const { preferenceController } = await import('../controllers/preference');
        await preferenceController.startPreferenceGathering(whatsappId, false);
        break;
        
      case 'update_profile':
        await this.requestUserName(whatsappId);
        break;
        
      default:
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown update option. Type "help" for available commands.'
        );
        break;
    }
  }
}

export const profileService = new ProfileService();
