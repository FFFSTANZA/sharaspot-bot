// src/controllers/webhook.ts - FINAL CORRECTED & OPTIMIZED
import { Request, Response } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/userService';
import { preferenceService } from '../services/preference';
import { preferenceController } from './preference';
import { profileService } from '../services/profile';
import { locationController } from './location';
import { bookingController } from './booking';
import { queueWebhookController } from './queue-webhook';
import { WhatsAppWebhook, WhatsAppMessage } from '../types/whatsapp';

export class WebhookController {
  private waitingUsers = new Map<string, 'name' | 'address'>();

  // ===============================================
  // HANDLER MAPPINGS
  // ===============================================
  private readonly handlers = {
    commands: new Map<string, (whatsappId: string) => Promise<void>>([
      ['hi', this.handleGreeting.bind(this)],
      ['hello', this.handleGreeting.bind(this)],
      ['start', this.handleGreeting.bind(this)],
      ['help', this.showHelp.bind(this)],
      ['book', this.startBooking.bind(this)],
      ['find', this.startBooking.bind(this)],
      ['search', this.startBooking.bind(this)],
      ['profile', (id: string) => profileService.showProfileSummary(id)],
      ['status', this.showStatus.bind(this)],
      ['preferences', (id: string) => preferenceController.startPreferenceGathering(id)],
      ['settings', (id: string) => preferenceController.startPreferenceGathering(id)]
    ]),
    buttons: new Map<string, (whatsappId: string) => Promise<void>>([
      ['help', this.showHelp.bind(this)],
      ['view_profile', (id: string) => profileService.showProfileSummary(id)],
      ['update_profile', this.startProfileUpdate.bind(this)],
      ['update_preferences', (id: string) => preferenceController.startPreferenceGathering(id)],
      ['quick_book', this.startBooking.bind(this)],
      ['find_stations', this.startBooking.bind(this)],
      ['location_help', this.showLocationHelp.bind(this)],
      ['share_location', this.handleGPSLocation.bind(this)],
      ['type_address', this.handleAddressInput.bind(this)],
      ['share_gps_location', this.handleGPSLocation.bind(this)],
      ['try_different_address', this.handleAddressInput.bind(this)],
      ['find_other_stations', this.startBooking.bind(this)],
      ['back_to_top_result', this.backToTopResult.bind(this)],
      ['load_more_stations', this.loadMoreStations.bind(this)],
      ['show_all_stations', this.showAllResults.bind(this)],
      ['show_all_nearby', this.showAllResults.bind(this)],
      ['expand_search', this.expandSearch.bind(this)],
      ['new_search', this.startBooking.bind(this)],
      ['next_station', this.handleNextStation.bind(this)],
      ['remove_filters', this.removeFilters.bind(this)]
    ]),
    location: new Map<string, (whatsappId: string) => Promise<void>>([
      ['share_gps_location', this.handleGPSLocation.bind(this)],
      ['try_different_address', this.handleAddressInput.bind(this)],
      ['location_help', this.showLocationHelp.bind(this)],
      ['type_address', this.handleAddressInput.bind(this)]
    ])
  };

  // ===============================================
  // WEBHOOK VERIFICATION
  // ===============================================
  async verifyWebhook(req: Request, res: Response): Promise<void> {
    try {
      const mode = req.query['hub.mode'] as string | undefined;
      const token = req.query['hub.verify_token'] as string | undefined;
      const challenge = req.query['hub.challenge'] as string | undefined;

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        logger.info('✅ Webhook verified');
        res.status(200).send(challenge);
      } else {
        logger.error('❌ Webhook verification failed', { mode, token });
        res.sendStatus(mode && token ? 403 : 400);
      }
    } catch (error) {
      logger.error('Webhook verification error', { error });
      res.sendStatus(500);
    }
  }

  // ===============================================
  // WEBHOOK HANDLING
  // ===============================================
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookData: WhatsAppWebhook = req.body;

      if (webhookData.object === 'whatsapp_business_account') {
        for (const entry of webhookData.entry) {
          for (const change of entry.changes) {
            if (change.field === 'messages') {
              for (const message of change.value.messages || []) {
                void this.processMessage(message).catch((error: Error) => {
                  logger.error('Async message processing failed', { messageId: message.id, error });
                });
              }
            }
          }
        }
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      logger.error('Webhook processing failed', { error });
      res.status(500).send('Internal Server Error');
    }
  }

  // ===============================================
  // MESSAGE PROCESSING
  // ===============================================
  private async processMessage(message: WhatsAppMessage): Promise<void> {
    try {
      const whatsappId = message.from;

      try {
        await whatsappService.markAsRead(message.id);
      } catch (readError) {
        logger.warn('❌ Mark as read failed', { messageId: message.id, error: readError });
      }

      logger.info('📨 Message received', { whatsappId, type: message.type });

      let user;
      try {
        // ✅ FIX: Pass object if service expects it
        user = await userService.createUser({ whatsappId });
      } catch (userError) {
        logger.error('Failed to get/create user', { whatsappId, error: userError });
        user = { whatsappId, name: null, preferencesCaptured: false, is_active: true };
      }

      let isInPreferenceFlow = false;
      try {
        isInPreferenceFlow = await preferenceService.isInPreferenceFlow(whatsappId);
      } catch (err) {
        logger.warn('Preference flow check failed', { whatsappId, error: err });
        isInPreferenceFlow = false;
      }

      switch (message.type) {
        case 'text':
          await this.handleText(user, message.text?.body || '', isInPreferenceFlow);
          break;
        case 'interactive':
          if (message.interactive?.type === 'button_reply') {
            await this.handleButton(user, message.interactive.button_reply, isInPreferenceFlow);
          } else if (message.interactive?.type === 'list_reply') {
            await this.handleList(user, message.interactive.list_reply, isInPreferenceFlow);
          }
          break;
        case 'location':
          await this.handleLocation(user, message.location);
          break;
        default:
          await whatsappService.sendTextMessage(
            whatsappId,
            '❓ Unsupported message type. Please send text, location, or use buttons.'
          );
      }
    } catch (error) {
      logger.error('Message processing failed', { messageId: message.id, from: message.from, error });
      try {
        await whatsappService.sendTextMessage(message.from, '❌ Something went wrong. Please try again or type "help".');
      } catch (sendError) {
        logger.error('Failed to send error message', { whatsappId: message.from, sendError });
      }
    }
  }

  // ===============================================
  // TEXT HANDLING
  // ===============================================
  private async handleText(user: any, text: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const cleanText = text.toLowerCase().trim();

    try {
      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
        return;
      }

      const waitingType = this.waitingUsers.get(whatsappId);
      if (waitingType === 'name') {
        await this.handleNameInput(whatsappId, text);
        return;
      } else if (waitingType === 'address') {
        await this.handleAddressInput(whatsappId, text);
        return;
      }

      const handler = this.handlers.commands.get(cleanText);
      if (handler) {
        await handler(whatsappId);
      } else {
        await this.handleUnknownMessage(whatsappId, text);
      }
    } catch (error) {
      logger.error('Text handling failed', { whatsappId, text, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to process your message. Please try again.');
    }
  }

  // ===============================================
  // BUTTON HANDLING
  // ===============================================
  private async handleButton(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId });

    try {
      if (this.isPhase4Button(buttonId)) {
        await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
        return;
      }

      if (buttonId.startsWith('book_station_')) {
        const stationId = parseInt(buttonId.replace('book_station_', ''), 10);
        if (!isNaN(stationId) && stationId > 0) {
          await bookingController.handleStationBooking(whatsappId, stationId);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID.');
        }
        return;
      }

      if (buttonId.startsWith('station_info_')) {
        const stationId = parseInt(buttonId.replace('station_info_', ''), 10);
        if (!isNaN(stationId) && stationId > 0) {
          await this.showStationDetails(whatsappId, stationId);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID.');
        }
        return;
      }

      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
        return;
      }

      if (this.isLocationButton(buttonId)) {
        const handler = this.handlers.location.get(buttonId);
        if (handler) {
          await handler(whatsappId);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location action.');
        }
        return;
      }

      const handler = this.handlers.buttons.get(buttonId);
      if (handler) {
        await handler(whatsappId);
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown button. Please try again or type "help".');
      }
    } catch (error) {
      logger.error('Button handling failed', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Button action failed. Please try again.');
    }
  }

  // ===============================================
  // LIST HANDLING
  // ===============================================
  private async handleList(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId });

    try {
      if (this.isPhase4List(listId)) {
        await queueWebhookController.handleQueueList(whatsappId, listId, title);
        return;
      }

      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
        return;
      }

      if (this.isLocationList(listId)) {
        await this.handleLocationList(whatsappId, listId, title);
        return;
      }

      if (listId.startsWith('select_station_')) {
        const stationId = parseInt(listId.replace('select_station_', ''), 10);
        if (!isNaN(stationId) && stationId > 0) {
          await this.showStationOptions(whatsappId, stationId, title);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
        }
        return;
      }

      await whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again.');
    } catch (error) {
      logger.error('List handling failed', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ List action failed. Please try again.');
    }
  }

  // ===============================================
  // LOCATION HANDLING
  // ===============================================
  private async handleLocation(user: any, location: any): Promise<void> {
    const { whatsappId } = user;

    try {
      if (!location.latitude || !location.longitude) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Invalid location data. Please try sharing your location again.');
        return;
      }

      await locationController.handleGPSLocation(
        whatsappId,
        location.latitude,
        location.longitude,
        location.name,
        location.address
      );
    } catch (error) {
      logger.error('Location handling failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to process location. Please try again or type an address.');
    }
  }

  // ===============================================
  // INPUT HANDLERS
  // ===============================================
  private async handleGPSLocation(whatsappId: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '📍 Please share your current location using the location button below this message.'
      );
    } catch (error) {
      logger.error('GPS location request failed', { whatsappId, error });
    }
  }

  private async handleAddressInput(whatsappId: string, address?: string): Promise<void> {
    try {
      if (address && address.trim()) {
        this.waitingUsers.delete(whatsappId);
        await locationController.handleAddressInput(whatsappId, address.trim());
      } else {
        this.waitingUsers.set(whatsappId, 'address');
        await whatsappService.sendTextMessage(
          whatsappId,
          '📝 Please type your address (e.g., "Anna Nagar, Chennai" or "MG Road, Bangalore"):'
        );
      }
    } catch (error) {
      logger.error('Address input failed', { whatsappId, error });
      this.waitingUsers.delete(whatsappId);
      await whatsappService.sendTextMessage(whatsappId, '❌ Address processing failed. Please try again.');
    }
  }

  private async handleNameInput(whatsappId: string, name: string): Promise<void> {
    try {
      this.waitingUsers.delete(whatsappId);
      const trimmedName = name.trim();
      if (trimmedName.length > 0 && trimmedName.length <= 50) {
        // ✅ FIX: Pass object
        await userService.createUser({ whatsappId, name: trimmedName });
        await whatsappService.sendTextMessage(whatsappId, `✅ Great! Nice to meet you, ${trimmedName}.`);
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid name (1-50 characters).');
      }
    } catch (error) {
      logger.error('Name input failed', { whatsappId, error });
      this.waitingUsers.delete(whatsappId);
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to save name. Please try again.');
    }
  }

  // ===============================================
  // NAVIGATION & STATION HELPERS
  // ===============================================
  private async backToTopResult(whatsappId: string): Promise<void> {
    try {
      await locationController.showBackToTopResult(whatsappId);
    } catch (error) {
      logger.error('Back to top failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to return to top result.');
    }
  }

  private async loadMoreStations(whatsappId: string): Promise<void> {
    try {
      // ✅ This should be valid — if error persists, check import/circularity
      await locationController.loadMoreStations(whatsappId);
    } catch (error) {
      logger.error('Load more stations failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to load more stations. Please try a new search.');
    }
  }

  private async showAllResults(whatsappId: string): Promise<void> {
    try {
      await locationController.showAllNearbyStations(whatsappId);
    } catch (error) {
      logger.error('Show all results failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to show all results. Please try a new search.');
    }
  }

  private async expandSearch(whatsappId: string): Promise<void> {
    try {
      await locationController.expandSearchRadius(whatsappId);
    } catch (error) {
      logger.error('Expand search failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to expand search.');
    }
  }

  private async removeFilters(whatsappId: string): Promise<void> {
    try {
      await locationController.removeFilters(whatsappId);
    } catch (error) {
      logger.error('Remove filters failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to remove filters.');
    }
  }

  private async handleNextStation(whatsappId: string): Promise<void> {
    try {
      await locationController.handleNextStation(whatsappId);
    } catch (error) {
      logger.error('Next station failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ No more stations available. Try expanding your search.');
    }
  }

  private async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    try {
      await locationController.showStationDetails(whatsappId, stationId);
    } catch (error) {
      logger.error('Show station details failed', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to load station details.');
    }
  }

  private async handleLocationList(whatsappId: string, listId: string, title: string): Promise<void> {
    try {
      if (listId.startsWith('select_station_')) {
        const stationId = parseInt(listId.replace('select_station_', ''), 10);
        if (!isNaN(stationId) && stationId > 0) {
          await this.showStationOptions(whatsappId, stationId, title);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
        }
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
      }
    } catch (error) {
      logger.error('Location list handling failed', { whatsappId, listId, error });
    }
  }

  private async showStationOptions(whatsappId: string, stationId: number, stationName: string): Promise<void> {
    try {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `Selected: ${stationName}\n\nWhat would you like to do?`,
        [
          { id: `book_station_${stationId}`, title: '⚡ Book Now' },
          { id: `station_info_${stationId}`, title: 'ℹ️ More Info' },
          { id: 'find_other_stations', title: '🔍 Find Others' }
        ],
        '🏢 Station Options'
      );
    } catch (error) {
      logger.error('Show station options failed', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to show station options. Please try again.');
    }
  }

  // ===============================================
  // HELPERS
  // ===============================================
  private async handleGreeting(whatsappId: string): Promise<void> {
    try {
      // ✅ FIX: Pass object
      const user = await userService.createUser({ whatsappId });
      if (!user?.preferencesCaptured) {
        await preferenceController.startPreferenceGathering(whatsappId);
      } else {
        await whatsappService.sendButtonMessage(
          whatsappId,
          `Welcome back ${user.name || 'there'}! Ready to find charging stations?`,
          [
            { id: 'quick_book', title: '⚡ Find Stations' },
            { id: 'view_profile', title: '👤 Profile' },
            { id: 'help', title: '❓ Help' }
          ]
        );
      }
    } catch (error) {
      logger.error('Greeting failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, 'Welcome! Type "help" to see available commands.');
    }
  }

  private async startProfileUpdate(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔄 Profile update feature coming soon! Use "preferences" to update your charging preferences.'
    );
  }

  private async showHelp(whatsappId: string): Promise<void> {
    const helpText = `**SharaSpot Help**

**Commands:**
• hi, find, profile, status, help

**How to Find Stations:**
1. Say "find"
2. Share location or type address
3. Select and book stations

Just type your message for help!`;
    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  private async showLocationHelp(whatsappId: string): Promise<void> {
    await locationController.showLocationHelp(whatsappId);
  }

  private async startBooking(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      'How would you like to find charging stations?',
      [
        { id: 'share_gps_location', title: '📍 Share Location' },
        { id: 'type_address', title: '📝 Type Address' },
        { id: 'location_help', title: '❓ Help' }
      ]
    );
  }

  private async showStatus(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📊 Status feature coming soon! Use "profile" to see your information.'
    );
  }

  private async handleUnknownMessage(whatsappId: string, text: string): Promise<void> {
    if (text.length > 3 && /[a-zA-Z]/.test(text) && text.length < 100) {
      await this.handleAddressInput(whatsappId, text);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ I didn\'t understand that. Type "help" for available commands or "find" to search for charging stations.'
      );
    }
  }

  // ===============================================
  // UTILS
  // ===============================================
  private isPhase4Button(buttonId: string): boolean {
    return ['queue_', 'session_', 'join_', 'start_', 'extend_', 'notify_', 'live_', 'smart_', 'rate_', 'share_', 'cancel_', 'nearby_', 'cheaper_', 'faster_', 'book_station_'].some(p => buttonId.startsWith(p));
  }

  private isLocationButton(buttonId: string): boolean {
    return ['share_gps_location', 'try_different_address', 'location_help', 'type_address', 'next_station', 'load_more_stations', 'show_all_stations', 'show_all_nearby', 'back_to_top_result', 'expand_search', 'station_info_', 'new_search', 'remove_filters'].some(p => buttonId.includes(p));
  }

  private isPhase4List(listId: string): boolean {
    return ['queue_', 'session_', 'analytics_', 'remind_', 'live_'].some(p => listId.startsWith(p));
  }

  private isLocationList(listId: string): boolean {
    return ['select_station_', 'station_', 'location_'].some(p => listId.startsWith(p));
  }

  public cleanup(): void {
    this.waitingUsers.clear();
  }

  public getWaitingUsersCount(): number {
    return this.waitingUsers.size;
  }
}

export const webhookController = new WebhookController();