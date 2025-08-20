import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/user';
import { preferenceService } from '../services/preference';
import { preferenceController } from '../controllers/preference';
import { profileService } from '../services/profile';
import { WhatsAppWebhook, WhatsAppMessage } from '../types/whatsapp';

export class WebhookController {
  // Track users waiting for text input
  private usersWaitingForName = new Set<string>();
  private usersWaitingForAddress = new Set<string>();

  /**
   * Verify webhook for WhatsApp
   */
  verifyWebhook(req: Request, res: Response): void {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        logger.info('✅ Webhook verified successfully');
        res.status(200).send(challenge);
      } else {
        logger.warn('❌ Webhook verification failed', { mode, token });
        res.status(403).send('Forbidden');
      }
    } catch (error) {
      logger.error('Webhook verification error', { error });
      res.status(500).send('Internal Server Error');
    }
  }

  /**
   * Handle incoming WhatsApp messages
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const body: WhatsAppWebhook = req.body;

      // Quick response to acknowledge receipt
      res.status(200).send('OK');

      // Process webhook asynchronously
      this.processWebhookAsync(body);
    } catch (error) {
      logger.error('Webhook handling error', { error });
      res.status(500).send('Internal Server Error');
    }
  }

  /**
   * Process webhook data asynchronously
   */
  private async processWebhookAsync(webhookData: WhatsAppWebhook): Promise<void> {
    try {
      for (const entry of webhookData.entry) {
        for (const change of entry.changes) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              await this.processMessage(message);
            }
          }
        }
      }
    } catch (error) {
      logger.error('Async webhook processing error', { error, webhookData });
    }
  }

  /**
   * Process individual WhatsApp message
   */
  private async processMessage(message: WhatsAppMessage): Promise<void> {
    try {
      const { from: whatsappId, type } = message;

      logger.info('📨 Processing message', { 
        whatsappId, 
        type, 
        messageId: message.id 
      });

      // Mark message as read
      await whatsappService.markAsRead(message.id);

      // Check if user is banned
      const isBanned = await userService.isUserBanned(whatsappId);
      if (isBanned) {
        logger.warn('Blocked message from banned user', { whatsappId });
        return;
      }

      // Get or create user
      let user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) {
        // Create new user
        user = await userService.createUser({
          whatsappId,
          name: null,
          phoneNumber: whatsappId,
        });

        if (!user) {
          logger.error('Failed to create new user', { whatsappId });
          await whatsappService.sendTextMessage(
            whatsappId,
            '❌ Sorry, there was an error setting up your account. Please try again later.'
          );
          return;
        }

        // Update profile from WhatsApp (async)
        profileService.updateUserProfileFromWhatsApp(whatsappId);
      }

      // Route message based on type and content
      await this.routeMessage(user, message);

    } catch (error) {
      logger.error('Message processing error', { error, message });
      
      // Send error message to user if we have their WhatsApp ID
      if (message.from) {
        await whatsappService.sendTextMessage(
          message.from,
          '❌ Sorry, something went wrong. Please try again.'
        );
      }
    }
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(user: any, message: WhatsAppMessage): Promise<void> {
    const { whatsappId } = user;
    const messageText = message.text?.body?.toLowerCase().trim() || '';
    const buttonReply = message.interactive?.button_reply;
    const listReply = message.interactive?.list_reply;

    // Check if user is in preference flow
    const isInPreferenceFlow = preferenceService.isInPreferenceFlow(whatsappId);

    // Handle button replies
    if (buttonReply) {
      await this.handleButtonReply(user, buttonReply.id, buttonReply.title, isInPreferenceFlow);
      return;
    }

    // Handle list replies
    if (listReply) {
      await this.handleListReply(user, listReply.id, listReply.title, isInPreferenceFlow);
      return;
    }

    // Handle location sharing
    if (message.type === 'location' && message.location) {
      await this.handleLocationMessage(user, message.location);
      return;
    }

    // Handle text commands/input
    if (message.type === 'text') {
      await this.handleTextInput(user, messageText, message.text?.body || '');
      return;
    }

    // Unknown message type
    logger.warn('Unknown message type received', { 
      whatsappId, 
      type: message.type, 
      messageId: message.id 
    });
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '❓ I didn\'t understand that. Type "help" to see available commands.'
    );
  }

  /**
   * Handle text input (commands + free text for preferences)
   */
  private async handleTextInput(user: any, lowerCaseText: string, originalText: string): Promise<void> {
    const { whatsappId } = user;

    // Check if waiting for specific text input
    if (this.usersWaitingForName.has(whatsappId)) {
      await this.handleNameInput(whatsappId, originalText);
      return;
    }

    if (this.usersWaitingForAddress.has(whatsappId)) {
      await this.handleAddressInput(whatsappId, originalText);
      return;
    }

    // Check if in preference flow
    const isInPreferenceFlow = preferenceService.isInPreferenceFlow(whatsappId);
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', originalText);
      return;
    }

    // Handle standard commands
    await this.handleTextCommand(user, lowerCaseText);
  }

  /**
   * Handle text commands
   */
  private async handleTextCommand(user: any, command: string): Promise<void> {
    const { whatsappId, name } = user;

    switch (command) {
      case 'hi':
      case 'hello':
      case 'start':
        await this.handleGreeting(user);
        break;

      case 'help':
        await this.handleHelpCommand(whatsappId);
        break;

      case 'profile':
      case 'my profile':
        await profileService.showProfileSummary(whatsappId);
        break;

      case 'status':
        await this.handleStatusCommand(whatsappId);
        break;

      case 'book':
        await this.handleBookCommand(user);
        break;

      case 'cancel':
        await this.handleCancelCommand(whatsappId);
        break;

      case 'preferences':
      case 'settings':
        await preferenceController.startPreferenceGathering(whatsappId, false);
        break;

      case 'skip':
        // Handle skip during preference flow
        const context = preferenceService.getUserContext(whatsappId);
        if (context) {
          await preferenceController.handlePreferenceResponse(whatsappId, 'button', 'skip_ev_model');
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❓ Skip what? Type "help" for available commands.');
        }
        break;

      default:
        // Check if it looks like an address
        if (command.length > 5 && (command.includes('road') || command.includes('street') || command.includes('avenue') || command.includes('mall') || command.includes('sector'))) {
          await this.handleAddressInput(whatsappId, command);
        } else {
          await whatsappService.sendTextMessage(
            whatsappId,
            `❓ I didn't recognize "${command}". Type "help" for available commands.`
          );
        }
        break;
    }
  }

  /**
   * Handle greeting message
   */
  private async handleGreeting(user: any): Promise<void> {
    const { whatsappId, name, preferencesCaptured } = user;

    // If no name, request it first
    if (!name) {
      await profileService.requestUserName(whatsappId);
      this.usersWaitingForName.add(whatsappId);
      return;
    }

    const displayName = name || 'there';

    if (preferencesCaptured) {
      // User has preferences - offer to use saved settings
      await whatsappService.sendButtonMessage(
        whatsappId,
        `Welcome back ${displayName}! 👋\n\n*Quick Actions:*\nUse your saved preferences or update them?`,
        [
          { id: 'quick_book', title: '⚡ Quick Book' },
          { id: 'update_preferences', title: '🔄 Update Preferences' },
          { id: 'view_profile', title: '👤 View Profile' },
        ],
        '⚡ SharaSpot - EV Charging'
      );
    } else {
      // New user - start preference gathering
      await whatsappService.sendTextMessage(
        whatsappId,
        `Welcome to SharaSpot ${displayName}! ⚡\n\nI'll help you find and book EV charging stations. Let's set up your preferences first.`
      );
      
      // Start preference gathering flow
      await preferenceController.startPreferenceGathering(whatsappId, true);
    }
  }

  /**
   * Handle name input
   */
  private async handleNameInput(whatsappId: string, name: string): Promise<void> {
    this.usersWaitingForName.delete(whatsappId);
    
    const success = await profileService.updateUserName(whatsappId, name);
    if (success) {
      // After name is set, start preference gathering
      setTimeout(async () => {
        await preferenceController.startPreferenceGathering(whatsappId, true);
      }, 1500);
    }
  }

  /**
   * Handle address input
   */
  private async handleAddressInput(whatsappId: string, address: string): Promise<void> {
    this.usersWaitingForAddress.delete(whatsappId);
    
    logger.info('Address received', { whatsappId, address });

    await whatsappService.sendTextMessage(
      whatsappId,
      `📍 *Address Received!*\n\n${address}\n\nSearching for nearby charging stations... ⚡`
    );

    // Geocoding and station search will be implemented in Phase 3
    setTimeout(async () => {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 Station search and booking features will be available in the next update!\n\nType "help" for available commands.'
      );
    }, 2000);
  }

  /**
   * Handle help command
   */
  private async handleHelpCommand(whatsappId: string): Promise<void> {
    const helpText = `🆘 *SharaSpot Help*\n\n` +
      `*Main Commands:*\n` +
      `• *hi* - Start/restart the bot\n` +
      `• *book* - Quick booking (skip to location)\n` +
      `• *profile* - View your profile & preferences\n` +
      `• *preferences* - Update your EV preferences\n` +
      `• *status* - Check your current queue status\n` +
      `• *cancel* - Cancel active reservation\n` +
      `• *help* - Show this help message\n\n` +
      `*How to use:*\n` +
      `1. Say "hi" to start\n` +
      `2. Set your name & EV preferences\n` +
      `3. Share your location 📍 or type address\n` +
      `4. Browse nearby stations\n` +
      `5. Book instantly! ⚡\n\n` +
      `*During Setup:*\n` +
      `• Use buttons for quick selection\n` +
      `• Type custom values when needed\n` +
      `• Say "skip" to skip optional steps\n\n` +
      `Need assistance? Just type your message!`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  /**
   * Handle status command
   */
  private async handleStatusCommand(whatsappId: string): Promise<void> {
    // This will be implemented in Phase 4 (Booking System)
    const user = await userService.getUserByWhatsAppId(whatsappId);
    
    if (!user) {
      await whatsappService.sendTextMessage(whatsappId, '❌ User not found. Please start with "hi".');
      return;
    }

    const statusText = `📊 *Your Status*\n\n` +
      `👤 Name: ${user.name || 'Not set'}\n` +
      `✅ Preferences: ${user.preferencesCaptured ? 'Complete' : 'Incomplete'}\n` +
      `🚗 EV Model: ${user.evModel || 'Not specified'}\n` +
      `🔌 Connector: ${user.connectorType || 'Not set'}\n\n` +
      `📍 No active reservations or queue positions.\n\n` +
      `Type "book" to find nearby charging stations!`;

    await whatsappService.sendButtonMessage(
      whatsappId,
      statusText,
      [
        { id: 'quick_book', title: '⚡ Book Now' },
        { id: 'view_profile', title: '👤 View Profile' },
      ],
      '📊 Your Status'
    );
  }

  /**
   * Handle book command (shortcut to location request)
   */
  private async handleBookCommand(user: any): Promise<void> {
    const { whatsappId, preferencesCaptured, name } = user;

    if (!name) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '👋 Welcome! Please tell me your name first, then I\'ll help you book a charging station.'
      );
      this.usersWaitingForName.add(whatsappId);
      return;
    }

    if (!preferencesCaptured) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⚙️ *Quick Setup Required*\n\nTo find the best stations for you, I need to know your EV preferences first.',
        [
          { id: 'start_quick_setup', title: '⚡ Quick Setup (2 min)' },
          { id: 'skip_to_location', title: '⏭️ Skip & Find Any Station' },
        ],
        '⚙️ Setup Required'
      );
      return;
    }

    // Skip to location request
    await this.requestLocation(whatsappId);
  }

  /**
   * Handle cancel command
   */
  private async handleCancelCommand(whatsappId: string): Promise<void> {
    // This will be implemented in Phase 4 (Booking System)
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ No active reservations to cancel.\n\nType "book" to find charging stations!'
    );
  }

  /**
   * Handle button replies
   */
  private async handleButtonReply(user: any, buttonId: string, buttonTitle: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;

    logger.info('Button reply received', { whatsappId, buttonId, buttonTitle, isInPreferenceFlow });

    // Handle preference flow buttons
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
      return;
    }

    // Handle main flow buttons
    switch (buttonId) {
      case 'quick_book':
      case 'use_saved_preferences':
        await this.requestLocation(whatsappId);
        break;

      case 'update_preferences':
        await preferenceController.startPreferenceGathering(whatsappId, false);
        break;

      case 'view_profile':
        await profileService.showProfileSummary(whatsappId);
        break;

      case 'start_quick_setup':
        await preferenceController.startPreferenceGathering(whatsappId, true);
        break;

      case 'skip_to_location':
        await this.requestLocation(whatsappId);
        break;

      case 'location_help':
        await preferenceController.showLocationHelp(whatsappId);
        break;

      case 'type_address':
        await preferenceController.requestAddressInput(whatsappId);
        this.usersWaitingForAddress.add(whatsappId);
        break;

      // Profile update buttons
      case 'update_profile':
        await profileService.requestUserName(whatsappId);
        this.usersWaitingForName.add(whatsappId);
        break;

      default:
        logger.warn('Unknown button ID', { whatsappId, buttonId });
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown selection. Please try again or type "help".'
        );
        break;
    }
  }

  /**
   * Handle list replies
   */
  private async handleListReply(user: any, listId: string, listTitle: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;

    logger.info('List reply received', { whatsappId, listId, listTitle, isInPreferenceFlow });

    // Handle preference flow list selections
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'button', listId);
      return;
    }

    // Handle other list selections (Phase 3+)
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 List selection received. This feature will be available soon!'
    );
  }

  /**
   * Handle location message
   */
  private async handleLocationMessage(user: any, location: any): Promise<void> {
    const { whatsappId } = user;
    const { latitude, longitude, name, address } = location;

    logger.info('Location received', { 
      whatsappId, 
      latitude, 
      longitude, 
      name, 
      address 
    });

    // Acknowledge location receipt
    await whatsappService.sendTextMessage(
      whatsappId,
      `📍 *Location Received!*\n\n${name || 'Your location'}\n${address || `${latitude}, ${longitude}`}\n\nSearching for nearby charging stations... ⚡`
    );

    // Station search will be implemented in Phase 3
    setTimeout(async () => {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 Station search and booking features will be available in the next update!\n\nType "help" for available commands.'
      );
    }, 2000);
  }

  /**
   * Request user location
   */
  private async requestLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '📍 *Share Your Location*\n\nTo find the best charging stations near you:\n\n🎯 Tap "Share Location" below\n📎 Or use the attachment menu\n⌨️ Or type your address',
      [
        { id: 'location_help', title: '❓ How to Share Location' },
        { id: 'type_address', title: '⌨️ Type Address Instead' },
      ],
      '📍 Location Request'
    );
  }
}

export const webhookController = new WebhookController();