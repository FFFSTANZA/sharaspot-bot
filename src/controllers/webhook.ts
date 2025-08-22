// src/controllers/webhook.ts - FINAL OPTIMIZED VERSION
import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/user';
import { preferenceService } from '../services/preference';
import { preferenceController } from './preference';
import { profileService } from '../services/profile';
import { locationController } from './location';
import { bookingController } from './booking';
import { WhatsAppWebhook, WhatsAppMessage } from '../types/whatsapp';

// Import the QueueWebhookController class and instance from your provided code
import { QueueWebhookController, queueWebhookController } from './queue-webhook';

// ===============================================
// OPTIMIZED WEBHOOK CONTROLLER
// ===============================================

export class WebhookController {
  private waitingUsers = {
    name: new Set<string>(),
    address: new Set<string>()
  };

  // Pre-compiled action handlers for performance
  private readonly commandHandlers = new Map([
    ['hi', this.handleGreeting.bind(this)],
    ['hello', this.handleGreeting.bind(this)],
    ['start', this.handleGreeting.bind(this)],
    ['help', this.showHelp.bind(this)],
    ['book', this.startBooking.bind(this)],
    ['find', this.startBooking.bind(this)],
    ['search', this.startBooking.bind(this)],
    ['profile', (whatsappId: string) => profileService.showProfileSummary(whatsappId)],
    ['status', this.showStatus.bind(this)],
    ['preferences', (whatsappId: string) => preferenceController.startPreferenceGathering(whatsappId)],
    ['settings', (whatsappId: string) => preferenceController.startPreferenceGathering(whatsappId)],
    ['cancel', this.handleCancel.bind(this)]
  ]);

  private readonly buttonHandlers = new Map([
    ['quick_book', this.requestLocation.bind(this)],
    ['start_preferences', (whatsappId: string) => preferenceController.startPreferenceGathering(whatsappId)],
    ['skip_to_location', this.requestLocation.bind(this)],
    ['view_profile', (whatsappId: string) => profileService.showProfileSummary(whatsappId)],
    ['type_address', this.requestAddress.bind(this)],
    ['share_gps_location', this.showLocationHelp.bind(this)],
    ['location_help', this.showLocationHelp.bind(this)],
    ['help', this.showHelp.bind(this)]
  ]);

  private readonly locationHandlers = new Map([
    ['next_station', (whatsappId: string) => locationController.handleNextStation(whatsappId)],
    ['load_more_stations', (whatsappId: string) => locationController.loadMoreStations(whatsappId)],
    ['show_all_results', (whatsappId: string) => locationController.showAllNearbyStations(whatsappId)],
    ['expand_search', (whatsappId: string) => locationController.expandSearchRadius(whatsappId)],
    ['new_search', this.handleNewSearch.bind(this)],
    ['try_different_address', this.requestAddress.bind(this)],
    ['share_gps_location', this.showLocationHelp.bind(this)]
  ]);

  // ===============================================
  // MAIN WEBHOOK HANDLERS
  // ===============================================

  verifyWebhook(req: Request, res: Response): void {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    
    if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
      logger.info('✅ Webhook verified');
      res.status(200).send(challenge);
    } else {
      logger.warn('❌ Webhook verification failed');
      res.status(403).send('Forbidden');
    }
  }

  async handleWebhook(req: Request, res: Response): Promise<void> {
    res.status(200).send('OK');
    this.processWebhookAsync(req.body);
  }

  // ===============================================
  // OPTIMIZED MESSAGE PROCESSING
  // ===============================================

  private async processWebhookAsync(data: WhatsAppWebhook): Promise<void> {
    try {
      // Process all messages in parallel for better performance
      const messagePromises = data.entry.flatMap(entry =>
        entry.changes.flatMap(change =>
          change.value.messages?.map(message => this.processMessage(message)) || []
        )
      );

      await Promise.allSettled(messagePromises); // Use allSettled to avoid one failure stopping all
    } catch (error) {
      logger.error('Webhook processing failed', { error });
    }
  }

  private async processMessage(message: WhatsAppMessage): Promise<void> {
    try {
      const whatsappId = message.from;
      
      logger.info('📨 Message received', { whatsappId, type: message.type });
      
      await whatsappService.markAsRead(message.id);

      // Early return for banned users
      if (await userService.isUserBanned(whatsappId)) {
        logger.warn('Blocked banned user', { whatsappId });
        return;
      }

      // Get or create user efficiently
      const user = await this.getOrCreateUser(whatsappId);
      if (!user) return;

      await this.routeMessage(user, message);

    } catch (error) {
      logger.error('Message processing failed', { error });
      await whatsappService.sendTextMessage(message.from, '❌ Something went wrong. Please try again.');
    }
  }

  // ===============================================
  // SMART MESSAGE ROUTING
  // ===============================================

  private async routeMessage(user: any, message: WhatsAppMessage): Promise<void> {
    const { whatsappId } = user;
    const isInPreferenceFlow = preferenceService.isInPreferenceFlow(whatsappId);

    // Route efficiently based on message type
    if (message.interactive?.button_reply) {
      await this.handleButton(user, message.interactive.button_reply, isInPreferenceFlow);
    } else if (message.interactive?.list_reply) {
      await this.handleList(user, message.interactive.list_reply, isInPreferenceFlow);
    } else if (message.type === 'location' && message.location) {
      await this.handleLocation(user, message.location);
    } else if (message.type === 'text') {
      await this.handleText(user, message.text?.body || '', isInPreferenceFlow);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ I didn\'t understand that. Type "help" for commands.');
    }
  }

  // ===============================================
  // INTERACTION HANDLERS
  // ===============================================

  private async handleButton(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId });

    try {
      // Handle Phase 4 buttons first (queue/booking)
      if (this.isPhase4Button(buttonId)) {
        await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
        return;
      }

      // Handle station booking
      if (buttonId.startsWith('book_station_')) {
        const stationId = parseInt(buttonId.replace('book_station_', ''));
        await bookingController.handleStationBooking(whatsappId, stationId);
        return;
      }

      // Handle preference flow
      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
        return;
      }

      // Handle location buttons
      if (this.isLocationButton(buttonId)) {
        const handler = this.locationHandlers.get(buttonId);
        if (handler) {
          await handler(whatsappId);
        } else if (buttonId.startsWith('book_station_')) {
          const stationId = parseInt(buttonId.replace('book_station_', ''));
          await bookingController.handleStationBooking(whatsappId, stationId);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location action.');
        }
        return;
      }

      // Handle main buttons
      const handler = this.buttonHandlers.get(buttonId);
      if (handler) {
        await handler(whatsappId);
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown button. Please try again.');
      }

    } catch (error) {
      logger.error('Button handling failed', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Button action failed. Please try again.');
    }
  }

  private async handleList(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId });

    try {
      // Phase 4: Queue & Session lists
      if (this.isPhase4List(listId)) {
        await queueWebhookController.handleQueueList(whatsappId, listId, title);
        return;
      }

      // Preference flow
      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
        return;
      }

      // Location lists
      if (this.isLocationList(listId)) {
        await this.handleLocationList(whatsappId, listId, title);
        return;
      }

      // Station selection
      if (listId.startsWith('select_station_')) {
        const stationId = parseInt(listId.replace('select_station_', ''));
        await this.showStationOptions(whatsappId, stationId, title);
        return;
      }

      await whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again.');

    } catch (error) {
      logger.error('List handling failed', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ List action failed. Please try again.');
    }
  }

  private async handleLocation(user: any, location: any): Promise<void> {
    const { whatsappId } = user;
    const { latitude, longitude, name, address } = location;
    
    await locationController.handleGPSLocation(whatsappId, latitude, longitude, name, address);
  }

  private async handleText(user: any, text: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const lowerText = text.toLowerCase().trim();

    // Check waiting states first (early return pattern)
    if (this.handleWaitingStates(whatsappId, text)) return;

    // Handle preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
      return;
    }

    // Handle commands efficiently
    await this.handleCommand(user, lowerText, text);
  }

  // ===============================================
  // OPTIMIZED HELPER METHODS
  // ===============================================

  private async getOrCreateUser(whatsappId: string) {
    let user = await userService.getUserByWhatsAppId(whatsappId);
    
    if (!user) {
      user = await userService.createUser({
        whatsappId,
        name: null,
        phoneNumber: whatsappId,
      });

      if (!user) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Account setup failed. Please try again.');
        return null;
      }

      // Async profile update without await for better performance
      profileService.updateUserProfileFromWhatsApp(whatsappId);
    }

    return user;
  }

  private handleWaitingStates(whatsappId: string, text: string): boolean {
    if (this.waitingUsers.name.has(whatsappId)) {
      this.waitingUsers.name.delete(whatsappId);
      profileService.updateUserName(whatsappId, text);
      setTimeout(() => preferenceController.startPreferenceGathering(whatsappId), 1000);
      return true;
    }

    if (this.waitingUsers.address.has(whatsappId)) {
      this.waitingUsers.address.delete(whatsappId);
      locationController.handleAddressInput(whatsappId, text);
      return true;
    }

    return false;
  }

  private async handleCommand(user: any, command: string, originalText: string): Promise<void> {
    const { whatsappId } = user;
    
    const handler = this.commandHandlers.get(command);
    
    if (handler) {
      // Fixed: properly handle the spread operator by ensuring args are a tuple type
      if (command === 'profile' || command === 'preferences' || command === 'settings') {
        await (handler as (whatsappId: string) => Promise<void>)(whatsappId);
      } else {
        await (handler as (user: any) => Promise<void>)(user);
      }
    } else if (this.looksLikeAddress(originalText)) {
      await locationController.handleAddressInput(whatsappId, originalText);
    } else {
      await whatsappService.sendTextMessage(whatsappId, `❓ Unknown command "${command}". Type "help" for available commands.`);
    }
  }

  // ===============================================
  // UTILITY METHODS (REGEX OPTIMIZED)
  // ===============================================

  private isPhase4Button(buttonId: string): boolean {
    return /^(queue_|book_|session_|join_|start_|extend_|cancel_|rate_|live_|notify_|smart_|nearby_|cheaper_|faster_)/.test(buttonId);
  }

  private isPhase4List(listId: string): boolean {
    return /^(queue_|session_|live_|analytics_|cost_|reminder_|share_)/.test(listId);
  }

  private isLocationButton(buttonId: string): boolean {
    return this.locationHandlers.has(buttonId) || /^(location|station)/.test(buttonId);
  }

  private isLocationList(listId: string): boolean {
    return /^(location|station|city)/.test(listId);
  }

  private looksLikeAddress(text: string): boolean {
    return text.length >= 5 && /\b(road|street|mall|sector|area|nagar|colony|market|circle|junction|metro|station|coimbatore|chennai|madurai|salem)\b/i.test(text);
  }

  private async handleLocationList(whatsappId: string, listId: string, title: string): Promise<void> {
    try {
      if (listId.startsWith('select_station_')) {
        const stationId = parseInt(listId.replace('select_station_', ''));
        await locationController.handleStationSelection(whatsappId, stationId);
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
      }
    } catch (error) {
      logger.error('Location list handling failed', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to handle selection. Please try again.');
    }
  }

  private async handleNewSearch(whatsappId: string): Promise<void> {
    locationController.clearLocationContext(whatsappId);
    await this.requestLocation(whatsappId);
  }

  // ===============================================
  // MAIN ACTION HANDLERS
  // ===============================================

  private async handleGreeting(user: any): Promise<void> {
    const { whatsappId, name, preferencesCaptured } = user;

    if (!name) {
      await whatsappService.sendTextMessage(whatsappId, '👋 Welcome to SharaSpot! What\'s your name?');
      this.waitingUsers.name.add(whatsappId);
      return;
    }

    if (preferencesCaptured) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `Welcome back ${name}! 👋\n\nReady to find charging stations?`,
        [
          { id: 'quick_book', title: '⚡ Find Stations' },
          { id: 'view_profile', title: '👤 Profile' },
          { id: 'help', title: '❓ Help' }
        ]
      );
    } else {
      await whatsappService.sendTextMessage(whatsappId, `Hi ${name}! Let's set up your EV preferences first.`);
      setTimeout(() => preferenceController.startPreferenceGathering(whatsappId), 1000);
    }
  }

  private async startBooking(user: any): Promise<void> {
    const { whatsappId, name, preferencesCaptured } = user;

    if (!name) {
      await whatsappService.sendTextMessage(whatsappId, '👋 Please tell me your name first!');
      this.waitingUsers.name.add(whatsappId);
      return;
    }

    if (!preferencesCaptured) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⚙️ Quick setup needed first!',
        [
          { id: 'start_preferences', title: '⚡ Quick Setup' },
          { id: 'skip_to_location', title: '⏭️ Skip & Find' }
        ]
      );
      return;
    }

    await this.requestLocation(whatsappId);
  }

  private async requestLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '📍 *Find Charging Stations*\n\nShare your location or type an address:',
      [
        { id: 'share_gps_location', title: '📱 Share GPS' },
        { id: 'type_address', title: '⌨️ Type Address' },
        { id: 'location_help', title: '❓ Help' }
      ]
    );
  }

  private async showHelp(whatsappId: string): Promise<void> {
    const helpText = `🆘 *SharaSpot Help*\n\n` +
      `*Commands:*\n• hi, find, profile, status, help\n\n` +
      `*How to Find Stations:*\n` +
      `1. Say "find"\n2. Share location or type address\n3. Select and book stations\n\n` +
      `Just type your message for help!`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  private async showStatus(user: any): Promise<void> {
    const { whatsappId, name, preferencesCaptured, evModel, connectorType } = user;

    const statusText = `📊 *Your Status*\n\n` +
      `👤 Name: ${name || 'Not set'}\n` +
      `✅ Setup: ${preferencesCaptured ? 'Complete' : 'Incomplete'}\n` +
      `🚗 EV: ${evModel || 'Not specified'}\n` +
      `🔌 Connector: ${connectorType || 'Not set'}\n\n` +
      `📍 No active bookings`;

    await whatsappService.sendButtonMessage(
      whatsappId,
      statusText,
      [
        { id: 'quick_book', title: '⚡ Find Stations' },
        { id: 'view_profile', title: '👤 Profile' }
      ]
    );
  }

  private async handleCancel(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, '❌ No active bookings to cancel.\n\nType "find" to search stations!');
  }

  private async requestAddress(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Type Your Address*\n\nExamples:\n• Anna Nagar Chennai\n• RS Puram Coimbatore\n• T Nagar Chennai\n\nJust type and send!'
    );
    this.waitingUsers.address.add(whatsappId);
  }

  private async showLocationHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📍 *Share Location:*\n\n1️⃣ Tap 📎 attachment icon\n2️⃣ Select Location\n3️⃣ Send current location\n\n🔒 Privacy: Location used only for finding stations\n\nOr type your address!'
    );
  }

  private async showStationOptions(whatsappId: string, stationId: number, stationName: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      `🏢 *${stationName}*\n\nWhat would you like to do?`,
      [
        { id: `book_station_${stationId}`, title: '⚡ Book Now' },
        { id: `station_info_${stationId}`, title: '📋 Info' },
        { id: 'back_to_list', title: '⬅️ Back' }
      ]
    );
  }
}

export const webhookController = new WebhookController();