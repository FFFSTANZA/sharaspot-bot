
import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/user';
import { preferenceService } from '../services/preference';
import { preferenceController } from './preference';
import { profileService } from '../services/profile';
import { locationController } from './location';
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
      case 'find':
      case 'search':
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
        const context = preferenceService.getUserContext(whatsappId);
        if (context) {
          await preferenceController.handlePreferenceResponse(whatsappId, 'button', 'skip_ev_model');
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❓ Skip what? Type "help" for available commands.');
        }
        break;

      default:
        // Check if it looks like an address
        if (this.looksLikeAddress(command)) {
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
   * Check if text looks like an address
   */
  private looksLikeAddress(text: string): boolean {
    const addressKeywords = [
      'road', 'street', 'avenue', 'mall', 'sector', 'block', 'area', 'nagar', 
      'colony', 'market', 'circle', 'square', 'junction', 'cross', 'gate',
      'metro', 'station', 'airport', 'hospital', 'school', 'college', 'university',
      'park', 'garden', 'temple', 'church', 'mosque', 'place', 'centre', 'center',
      'coimbatore', 'chennai', 'madurai', 'salem', 'tirupur', 'erode', 'vellore'
    ];
    
    const lowerText = text.toLowerCase();
    return text.length > 5 && addressKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Handle greeting message
   */
  private async handleGreeting(user: any): Promise<void> {
    const { whatsappId, name, preferencesCaptured } = user;

    if (!name) {
      await profileService.requestUserName(whatsappId);
      this.usersWaitingForName.add(whatsappId);
      return;
    }

    const displayName = name || 'there';

    if (preferencesCaptured) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `Welcome back ${displayName}! 👋\n\n*Quick Actions:*\nReady to find charging stations?`,
        [
          { id: 'quick_book', title: '⚡ Find Stations' },
          { id: 'update_preferences', title: '🔄 Update Settings' },
          { id: 'view_profile', title: '👤 My Profile' },
        ],
        '⚡ SharaSpot'
      );
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        `Welcome to SharaSpot ${displayName}! ⚡\n\nI'll help you find and book EV charging stations. Let's set up your preferences first.`
      );
      
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
    await locationController.handleAddressInput(whatsappId, address);
  }

  /**
   * Handle help command
   */
  private async handleHelpCommand(whatsappId: string): Promise<void> {
    const helpText = `🆘 *SharaSpot Help*\n\n` +
      `*Main Commands:*\n` +
      `• *hi* - Start/restart the bot\n` +
      `• *book* / *find* - Find charging stations\n` +
      `• *profile* - View your profile & preferences\n` +
      `• *preferences* - Update your EV settings\n` +
      `• *status* - Check your current bookings\n` +
      `• *cancel* - Cancel active reservation\n` +
      `• *help* - Show this help message\n\n` +
      `*How to Find Stations:*\n` +
      `1. Say "find" or "book"\n` +
      `2. Share your location 📍 or type address\n` +
      `3. Browse nearby stations by availability\n` +
      `4. Select and book instantly! ⚡\n\n` +
      `*Location Tips:*\n` +
      `• GPS location gives best results\n` +
      `• Type city names or landmarks\n` +
      `• Use "Next Station" to browse more\n\n` +
      `Need assistance? Just type your message!`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  /**
   * Handle status command
   */
  private async handleStatusCommand(whatsappId: string): Promise<void> {
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
      `Ready to find charging stations near you?`;

    await whatsappService.sendButtonMessage(
      whatsappId,
      statusText,
      [
        { id: 'quick_book', title: '⚡ Find Stations' },
        { id: 'view_profile', title: '👤 View Profile' },
      ],
      '📊 Status'
    );
  }

  /**
   * Handle book command
   */
  private async handleBookCommand(user: any): Promise<void> {
    const { whatsappId, preferencesCaptured, name } = user;

    if (!name) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '👋 Welcome! Please tell me your name first, then I\'ll help you find charging stations.'
      );
      this.usersWaitingForName.add(whatsappId);
      return;
    }

    if (!preferencesCaptured) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⚙️ *Quick Setup Required*\n\nTo find the best stations for you, I need to know your EV preferences first.',
        [
          { id: 'start_quick_setup', title: '⚡ Quick Setup' },
          { id: 'skip_to_location', title: '⏭️ Skip & Find' },
        ],
        '⚙️ Setup'
      );
      return;
    }

    // Request location for station search
    await this.requestLocation(whatsappId);
  }

  /**
   * Handle cancel command
   */
  private async handleCancelCommand(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '❌ No active reservations to cancel.\n\nType "find" to search for charging stations!'
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

    // Handle location-related buttons
    const locationButtons = [
      'next_station', 'load_more_stations', 'show_all_results', 'show_all_nearby',
      'back_to_top_result', 'expand_search', 'remove_filters', 'new_search',
      'share_gps_location', 'try_different_address', 'location_help'
    ];

    if (locationButtons.includes(buttonId) || buttonId.startsWith('book_station_') || buttonId.startsWith('station_info_')) {
      await this.handleLocationButton(whatsappId, buttonId, buttonTitle);
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

      case 'type_address':
        await this.requestAddressInput(whatsappId);
        break;

      case 'share_gps_location':
        await this.showLocationHelp(whatsappId);
        break;

      case 'location_help':
        await this.showLocationHelp(whatsappId);
        break;

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
   * Handle location-specific button actions
   */
  private async handleLocationButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    try {
      switch (buttonId) {
        case 'next_station':
          await locationController.handleNextStation(whatsappId);
          break;

        case 'load_more_stations':
          await locationController.loadMoreStations(whatsappId);
          break;

        case 'show_all_results':
        case 'show_all_nearby':
          await locationController.showAllNearbyStations(whatsappId);
          break;

        case 'expand_search':
          await locationController.expandSearchRadius(whatsappId);
          break;

        case 'remove_filters':
          await locationController.removeFilters(whatsappId);
          break;

        case 'new_search':
          locationController.clearLocationContext(whatsappId);
          await this.requestLocation(whatsappId);
          break;

        case 'back_to_top_result':
          await locationController.showBackToTopResult(whatsappId);
          break;

        case 'share_gps_location':
          await this.showLocationHelp(whatsappId);
          break;

        case 'try_different_address':
          await this.requestAddressInput(whatsappId);
          break;

        case 'location_help':
          await this.showLocationHelp(whatsappId);
          break;

        default:
          if (buttonId.startsWith('book_station_')) {
            const stationId = buttonId.replace('book_station_', '');
            await this.handleStationBooking(whatsappId, parseInt(stationId));
          } else if (buttonId.startsWith('station_info_')) {
            const stationId = buttonId.replace('station_info_', '');
            await this.showStationDetails(whatsappId, parseInt(stationId));
          } else {
            await whatsappService.sendTextMessage(
              whatsappId,
              `Button "${buttonTitle}" received. This feature will be available in Phase 4!`
            );
          }
          break;
      }
    } catch (error) {
      logger.error('Failed to handle location button', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
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

    // Handle location-related list selections
    if (listId.startsWith('select_station_')) {
      const stationId = listId.replace('select_station_', '');
      await this.handleStationSelection(whatsappId, parseInt(stationId), listTitle);
      return;
    }

    // Handle other list selections
    await whatsappService.sendTextMessage(
      whatsappId,
      `Selected: ${listTitle}. This feature will be enhanced in upcoming updates!`
    );
  }

  /**
   * Handle location message
   */
  private async handleLocationMessage(user: any, location: any): Promise<void> {
    const { whatsappId } = user;
    const { latitude, longitude, name, address } = location;

    await locationController.handleGPSLocation(whatsappId, latitude, longitude, name, address);
  }

  /**
   * Request user location
   */
  private async requestLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '📍 *Find Charging Stations Near You*\n\nShare your location to get the most accurate results:\n\n🎯 GPS location gives best results\n📍 Or type any address/landmark\n🏢 City names work too!',
      [
        { id: 'share_gps_location', title: '📱 Share GPS' },
        { id: 'type_address', title: '⌨️ Type Address' },
        { id: 'location_help', title: '❓ Help' },
      ],
      '📍 Location'
    );
  }

  /**
   * Request address input
   */
  private async requestAddressInput(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Type Your Address*\n\n' +
      'Enter the location where you need charging:\n\n' +
      '*Examples:*\n' +
      '• Anna Nagar Chennai\n' +
      '• RS Puram Coimbatore\n' +
      '• T Nagar Chennai\n' +
      '• Gandhipuram Coimbatore\n\n' +
      'Just type the address and I\'ll find charging stations nearby!'
    );

    this.usersWaitingForAddress.add(whatsappId);
  }

  /**
   * Show location sharing help
   */
  private async showLocationHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📍 *How to Share Your Location:*\n\n' +
      '1️⃣ Tap the 📎 *attachment* icon (next to message input)\n' +
      '2️⃣ Select *Location* from the menu\n' +
      '3️⃣ Choose *Send your current location*\n' +
      '4️⃣ Tap *Send*\n\n' +
      '🔒 *Privacy:* Your location is only used to find nearby charging stations and is not stored permanently.\n\n' +
      'Alternatively, you can type your address manually!'
    );
  }

  /**
   * Handle station selection from list
   */
  private async handleStationSelection(whatsappId: string, stationId: number, stationTitle: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      `🏢 *Selected: ${stationTitle}*\n\nWhat would you like to do?`,
      [
        { id: `book_station_${stationId}`, title: '⚡ Book Now' },
        { id: `station_info_${stationId}`, title: '📋 More Info' },
        { id: 'back_to_list', title: '⬅️ Back to List' },
      ],
      '🏢 Station'
    );
  }

  /**
   * Handle station booking (placeholder for Phase 4)
   */
  private async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Booking Station ${stationId}*\n\nPreparing reservation system...\n\nThis feature will be available in Phase 4!`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🚧 Coming Soon: Full booking system with queue management, real-time updates, and payment integration!',
        [
          { id: 'find_other_stations', title: '🔍 Find Others' },
          { id: 'new_search', title: '🔍 New Search' },
        ]
      );
    }, 2000);
  }

  /**
   * Show detailed station information (placeholder for Phase 4)
   */
  private async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Station Details*\n\nStation ID: ${stationId}\n\nLoading comprehensive information...\n\n` +
      '• Real-time availability\n' +
      '• Pricing details\n' +
      '• Amenities nearby\n' +
      '• Operating hours\n\n' +
      'Detailed station information will be available in Phase 4!'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'What would you like to do?',
        [
          { id: `book_station_${stationId}`, title: '⚡ Book Now' },
          { id: 'back_to_search', title: '⬅️ Back' },
        ]
      );
    }, 2000);
  }
}

// Export singleton instance
export const webhookController = new WebhookController();
