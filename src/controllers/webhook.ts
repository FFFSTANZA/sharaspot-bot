// src/controllers/webhook.ts - OPTIMIZED & FIXED
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
  private readonly waitingUsers = new Map<string, 'name' | 'address'>();

  // ===============================================
  // COMPLETE HANDLER MAPPINGS - FIXED
  // ===============================================
  private readonly handlers = {
    // Text commands mapping
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

    // Button handlers mapping
    buttons: new Map<string, (whatsappId: string) => Promise<void>>([
      // Core navigation
      ['help', this.showHelp.bind(this)],
      ['view_profile', (id: string) => profileService.showProfileSummary(id)],
      ['update_profile', this.startProfileUpdate.bind(this)],
      ['update_preferences', (id: string) => preferenceController.startPreferenceGathering(id)],
      
      // Booking flow
      ['quick_book', this.startBooking.bind(this)],
      ['find_stations', this.startBooking.bind(this)],
      ['find_other_stations', this.startBooking.bind(this)],
      
      // Location input methods
      ['share_location', this.handleGPSLocation.bind(this)],
      ['share_gps_location', this.handleGPSLocation.bind(this)],
      ['type_address', this.handleAddressInput.bind(this)],
      ['try_different_address', this.handleAddressInput.bind(this)],
      
      // Navigation & search results
      ['next_station', this.handleNextStation.bind(this)],
      ['load_more_stations', this.loadMoreStations.bind(this)],
      ['show_all_stations', this.showAllResults.bind(this)],
      ['show_all_nearby', this.showAllResults.bind(this)],
      ['back_to_top_result', this.backToTopResult.bind(this)],
      
      // Search modification
      ['expand_search', this.expandSearch.bind(this)],
      ['new_search', this.startBooking.bind(this)],
      ['remove_filters', this.removeFilters.bind(this)],
      
      // Help & utilities
      ['location_help', this.showLocationHelp.bind(this)]
    ]),

    // ✅ FIXED: Complete location-specific handlers
    location: new Map<string, (whatsappId: string) => Promise<void>>([
      // Basic location input
      ['share_gps_location', this.handleGPSLocation.bind(this)],
      ['type_address', this.handleAddressInput.bind(this)],
      ['try_different_address', this.handleAddressInput.bind(this)],
      ['location_help', this.showLocationHelp.bind(this)],
      
      // ✅ MISSING HANDLERS ADDED - Recent searches
      ['recent_searches', async (whatsappId: string) => {
        await locationController.showRecentSearches(whatsappId);
      }],
      
      // ✅ MISSING HANDLERS ADDED - Navigation
      ['next_station', this.handleNextStation.bind(this)],
      ['load_more_stations', this.loadMoreStations.bind(this)],
      ['show_all_results', this.showAllResults.bind(this)],
      ['show_all_nearby', this.showAllResults.bind(this)],
      ['back_to_top_result', this.backToTopResult.bind(this)],
      
      // ✅ MISSING HANDLERS ADDED - Search modification
      ['expand_search', this.expandSearch.bind(this)],
      ['remove_filters', this.removeFilters.bind(this)],
      ['new_search', async (whatsappId: string) => {
        await locationController.startNewSearch(whatsappId);
      }]
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
  // WEBHOOK HANDLING - OPTIMIZED
  // ===============================================
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookData: WhatsAppWebhook = req.body;

      if (webhookData.object === 'whatsapp_business_account') {
        // Process all messages asynchronously for better performance
        const messagePromises: Promise<void>[] = [];
        
        for (const entry of webhookData.entry) {
          for (const change of entry.changes) {
            if (change.field === 'messages') {
              for (const message of change.value.messages || []) {
                messagePromises.push(
                  this.processMessage(message).catch((error: Error) => {
                    logger.error('Message processing failed', { messageId: message.id, error });
                  })
                );
              }
            }
          }
        }

        // Wait for all message processing to complete (with timeout)
        await Promise.allSettled(messagePromises);
      }

      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      logger.error('Webhook processing failed', { error });
      res.status(500).send('Internal Server Error');
    }
  }

  // ===============================================
  // MESSAGE PROCESSING - OPTIMIZED
  // ===============================================
  private async processMessage(message: WhatsAppMessage): Promise<void> {
    const whatsappId = message.from;

    try {
      // Mark as read (non-blocking)
      whatsappService.markAsRead(message.id).catch(error => 
        logger.warn('Mark as read failed', { messageId: message.id, error })
      );

      logger.info('📨 Message received', { whatsappId, type: message.type });

      // Get/create user and check preference flow in parallel
      const [userResult, preferenceResult] = await Promise.allSettled([
        userService.createUser({ whatsappId }),
        preferenceService.isInPreferenceFlow(whatsappId)
      ]);

      const userData = userResult.status === 'fulfilled' 
        ? userResult.value 
        : (() => {
            logger.error('Failed to get/create user', { whatsappId, error: userResult.reason });
            return { whatsappId, name: null, preferencesCaptured: false, is_active: true };
          })();
          
      const inPreferenceFlow = preferenceResult.status === 'fulfilled' 
        ? preferenceResult.value 
        : (() => {
            logger.warn('Preference flow check failed', { whatsappId, error: preferenceResult.reason });
            return false;
          })();

      // Route message based on type
      switch (message.type) {
        case 'text':
          await this.handleText(userData, message.text?.body || '', inPreferenceFlow);
          break;
        case 'interactive':
          if (message.interactive?.type === 'button_reply') {
            await this.handleButton(userData, message.interactive.button_reply, inPreferenceFlow);
          } else if (message.interactive?.type === 'list_reply') {
            await this.handleList(userData, message.interactive.list_reply, inPreferenceFlow);
          }
          break;
        case 'location':
          await this.handleLocation(userData, message.location);
          break;
        default:
          await whatsappService.sendTextMessage(
            whatsappId,
            '❓ Unsupported message type. Please send text, location, or use buttons.'
          );
      }
    } catch (error) {
      logger.error('Message processing failed', { messageId: message.id, whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId, 
        '❌ Something went wrong. Please try again or type "help".'
      ).catch(sendError => 
        logger.error('Failed to send error message', { whatsappId, sendError })
      );
    }
  }

  // ===============================================
  // TEXT HANDLING
  // ===============================================
  private async handleText(user: any, text: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const cleanText = text.toLowerCase().trim();

    try {
      // Priority 1: Preference flow
      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
        return;
      }

      // Priority 2: Waiting for specific input
      const waitingType = this.waitingUsers.get(whatsappId);
      if (waitingType === 'name') {
        await this.handleNameInput(whatsappId, text);
        return;
      }
      if (waitingType === 'address') {
        await this.handleAddressInput(whatsappId, text);
        return;
      }

      // Priority 3: Command handlers
      const handler = this.handlers.commands.get(cleanText);
      if (handler) {
        await handler(whatsappId);
        return;
      }

      // Priority 4: Unknown message (potentially address)
      await this.handleUnknownMessage(whatsappId, text);

    } catch (error) {
      logger.error('Text handling failed', { whatsappId, text, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to process your message. Please try again.');
    }
  }

  // ===============================================
  // BUTTON HANDLING - OPTIMIZED
  // ===============================================
  private async handleButton(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId });

    try {
      // Priority 1: Phase 4 buttons (queue/booking)
      if (this.isPhase4Button(buttonId)) {
        await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
        return;
      }

      // Priority 2: Station-specific buttons
      if (buttonId.startsWith('book_station_')) {
        const stationId = this.extractStationId(buttonId, 'book_station_');
        if (stationId > 0) {
          await bookingController.handleStationBooking(whatsappId, stationId);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID.');
        }
        return;
      }

      if (buttonId.startsWith('station_info_')) {
        const stationId = this.extractStationId(buttonId, 'station_info_');
        if (stationId > 0) {
          await this.showStationDetails(whatsappId, stationId);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID.');
        }
        return;
      }

      // Priority 3: Preference flow
      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
        return;
      }

      // Priority 4: Location-specific buttons
      if (this.isLocationButton(buttonId)) {
        const handler = this.handlers.location.get(buttonId);
        if (handler) {
          await handler(whatsappId);
        } else {
          logger.warn('Unknown location button', { whatsappId, buttonId });
          await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location action.');
        }
        return;
      }

      // Priority 5: General buttons
      const handler = this.handlers.buttons.get(buttonId);
      if (handler) {
        await handler(whatsappId);
      } else {
        logger.warn('Unknown button', { whatsappId, buttonId });
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown button. Please try again or type "help".');
      }

    } catch (error) {
      logger.error('Button handling failed', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Button action failed. Please try again.');
    }
  }

  // ===============================================
  // LIST HANDLING - OPTIMIZED
  // ===============================================
  private async handleList(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId });

    try {
      // Priority 1: Phase 4 lists
      if (this.isPhase4List(listId)) {
        await queueWebhookController.handleQueueList(whatsappId, listId, title);
        return;
      }

      // Priority 2: Preference flow
      if (isInPreferenceFlow) {
        await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
        return;
      }

      // Priority 3: Location lists
      if (this.isLocationList(listId)) {
        await this.handleLocationList(whatsappId, listId, title);
        return;
      }

      // Priority 4: Station selection
      if (listId.startsWith('select_station_')) {
        const stationId = this.extractStationId(listId, 'select_station_');
        if (stationId > 0) {
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
      if (!location?.latitude || !location?.longitude) {
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
  // INPUT HANDLERS - OPTIMIZED
  // ===============================================
  private async handleGPSLocation(whatsappId: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '📱 *Share Your GPS Location*\n\n' +
        '1️⃣ Tap the 📎 attachment icon\n' +
        '2️⃣ Select "Location"\n' +
        '3️⃣ Choose "Send your current location"\n' +
        '4️⃣ Tap "Send"\n\n' +
        '🎯 This gives the most accurate results!'
      );
    } catch (error) {
      logger.error('GPS location request failed', { whatsappId, error });
    }
  }

  private async handleAddressInput(whatsappId: string, address?: string): Promise<void> {
    try {
      if (address?.trim()) {
        this.waitingUsers.delete(whatsappId);
        await locationController.handleAddressInput(whatsappId, address.trim());
      } else {
        this.waitingUsers.set(whatsappId, 'address');
        await whatsappService.sendTextMessage(
          whatsappId,
          '📝 *Type Your Address*\n\n' +
          'Enter the location where you need charging:\n\n' +
          '*Examples:*\n' +
          '• Anna Nagar, Chennai\n' +
          '• Brigade Road, Bangalore\n' +
          '• Sector 18, Noida\n' +
          '• Phoenix Mall, Mumbai\n\n' +
          'Just type the address and press send!'
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
  // LOCATION & NAVIGATION HELPERS - OPTIMIZED
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
      // Check if locationController has this method, otherwise use bookingController
      if (typeof locationController.showStationDetails === 'function') {
        await locationController.showStationDetails(whatsappId, stationId);
      } else {
        // Fallback to basic station info
        await whatsappService.sendTextMessage(
          whatsappId,
          `🏢 *Station Details*\n\nStation ID: ${stationId}\n\nDetailed information will be available soon!`
        );
      }
    } catch (error) {
      logger.error('Show station details failed', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to load station details.');
    }
  }

  // ===============================================
  // LOCATION LIST HANDLING - FIXED
  // ===============================================
  private async handleLocationList(whatsappId: string, listId: string, title: string): Promise<void> {
    try {
      if (listId.startsWith('select_station_')) {
        const stationId = this.extractStationId(listId, 'select_station_');
        if (stationId > 0) {
          await this.showStationOptions(whatsappId, stationId, title);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station selection.');
        }
      } else if (listId.startsWith('recent_search_')) {
        const searchIndex = this.extractStationId(listId, 'recent_search_');
        if (searchIndex >= 0) {
          await locationController.handleRecentSearchSelection(whatsappId, searchIndex);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid search selection.');
        }
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
      }
    } catch (error) {
      logger.error('Location list handling failed', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to process selection. Please try again.');
    }
  }

  private async showStationOptions(whatsappId: string, stationId: number, stationName: string): Promise<void> {
    try {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `🏢 *${stationName}*\n\nWhat would you like to do?`,
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
  // CORE USER INTERACTION HELPERS
  // ===============================================
  private async handleGreeting(whatsappId: string): Promise<void> {
    try {
      const user = await userService.createUser({ whatsappId });
      
      if (!user?.preferencesCaptured) {
        await preferenceController.startPreferenceGathering(whatsappId);
      } else {
        await whatsappService.sendButtonMessage(
          whatsappId,
          `👋 Welcome back ${user.name || 'there'}! Ready to find charging stations?`,
          [
            { id: 'quick_book', title: '⚡ Find Stations' },
            { id: 'view_profile', title: '👤 Profile' },
            { id: 'help', title: '❓ Help' }
          ],
          '🔋 SharaSpot'
        );
      }
    } catch (error) {
      logger.error('Greeting failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, 'Welcome! Type "help" to see available commands.');
    }
  }

  private async startBooking(whatsappId: string): Promise<void> {
    try {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Find Charging Stations*\n\nHow would you like to search?',
        [
          { id: 'share_gps_location', title: '📍 Share Location' },
          { id: 'type_address', title: '📝 Type Address' },
          { id: 'recent_searches', title: '🕒 Recent Searches' }
        ],
        '🔋 Find Stations'
      );
    } catch (error) {
      logger.error('Start booking failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to start booking. Please try again.');
    }
  }

  private async showHelp(whatsappId: string): Promise<void> {
    const helpText = `🔋 *SharaSpot Help*

*Quick Commands:*
• "find" or "book" - Find stations
• "profile" - View your profile
• "preferences" - Update settings
• "help" - Show this help

*How to Find Stations:*
1️⃣ Say "find" or tap "Find Stations"
2️⃣ Share location or type address
3️⃣ Browse and select stations
4️⃣ Book your charging slot

*Tips:*
📍 Sharing GPS location gives most accurate results
📝 You can also just type any address directly
🕒 Recent searches are saved for quick access

Need more help? Just ask!`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  private async showLocationHelp(whatsappId: string): Promise<void> {
    try {
      const helpText = `📍 *Location Help*

*Share GPS Location:*
1️⃣ Tap 📎 attachment icon
2️⃣ Select "Location"
3️⃣ Choose "Send current location"
4️⃣ Tap "Send"

*Type Address:*
Just type your location like:
• "Anna Nagar, Chennai"
• "Brigade Road, Bangalore"
• "Sector 18, Noida"

*Recent Searches:*
• Access your previous searches
• Tap to search again quickly

*Tips:*
• GPS location is most accurate
• Include city name for better results
• Try nearby landmarks if address doesn't work

Ready to find stations?`;

      await whatsappService.sendButtonMessage(
        whatsappId,
        helpText,
        [
          { id: 'share_gps_location', title: '📍 Share Location' },
          { id: 'type_address', title: '📝 Type Address' },
          { id: 'recent_searches', title: '🕒 Recent Searches' }
        ],
        '📍 Location Help'
      );
    } catch (error) {
      logger.error('Location help failed', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to show location help.');
    }
  }

  private async startProfileUpdate(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔄 Profile update feature coming soon! Use "preferences" to update your charging preferences.'
    );
  }

  private async showStatus(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📊 Status feature coming soon! Use "profile" to see your information.'
    );
  }

  private async handleUnknownMessage(whatsappId: string, text: string): Promise<void> {
    // If text looks like an address, try to handle it as location input
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
  // UTILITY METHODS - OPTIMIZED
  // ===============================================
  
  /**
   * Extract station ID from button/list ID with proper validation
   */
  private extractStationId(id: string, prefix: string): number {
    try {
      const numStr = id.replace(prefix, '');
      const num = parseInt(numStr, 10);
      return isNaN(num) ? -1 : num;
    } catch {
      return -1;
    }
  }

  /**
   * Check if button is Phase 4 related (queue/booking system)
   */
  private isPhase4Button(buttonId: string): boolean {
    const phase4Prefixes = [
      'queue_', 'session_', 'join_', 'start_', 'extend_', 
      'notify_', 'live_', 'smart_', 'rate_', 'share_', 
      'cancel_', 'nearby_', 'cheaper_', 'faster_'
    ];
    return phase4Prefixes.some(prefix => buttonId.startsWith(prefix));
  }

  /**
   * ✅ FIXED: Enhanced location button detection
   */
  private isLocationButton(buttonId: string): boolean {
    const locationButtons = [
      'share_gps_location',
      'try_different_address',
      'location_help',
      'type_address',
      'recent_searches',     // ✅ Added missing button
      'next_station',
      'load_more_stations',
      'show_all_stations',
      'show_all_nearby',
      'back_to_top_result',
      'expand_search',
      'new_search',         // ✅ Added missing button
      'remove_filters'
    ];
    
    // Check exact matches first
    if (locationButtons.includes(buttonId)) return true;
    
    // Check prefixes for dynamic buttons
    return buttonId.startsWith('station_info_');
  }

  /**
   * Check if list is Phase 4 related
   */
  private isPhase4List(listId: string): boolean {
    const phase4Prefixes = ['queue_', 'session_', 'analytics_', 'remind_', 'live_'];
    return phase4Prefixes.some(prefix => listId.startsWith(prefix));
  }

  /**
   * ✅ FIXED: Enhanced location list detection
   */
  private isLocationList(listId: string): boolean {
    const locationPrefixes = [
      'select_station_',
      'recent_search_',    // ✅ Added missing prefix
      'station_',
      'location_'
    ];
    return locationPrefixes.some(prefix => listId.startsWith(prefix));
  }

  // ===============================================
  // CLEANUP & MONITORING
  // ===============================================
  
  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.waitingUsers.clear();
    logger.info('Webhook controller cleanup completed');
  }

  /**
   * Get waiting users count for monitoring
   */
  public getWaitingUsersCount(): number {
    return this.waitingUsers.size;
  }

  /**
   * Get handler statistics for monitoring
   */
  public getHandlerStats(): {
    commands: number;
    buttons: number;
    location: number;
    total: number;
  } {
    return {
      commands: this.handlers.commands.size,
      buttons: this.handlers.buttons.size,
      location: this.handlers.location.size,
      total: this.handlers.commands.size + this.handlers.buttons.size + this.handlers.location.size
    };
  }

  /**
   * Check if a specific handler exists
   */
  public hasHandler(type: 'command' | 'button' | 'location', id: string): boolean {
    switch (type) {
      case 'command':
        return this.handlers.commands.has(id);
      case 'button':
        return this.handlers.buttons.has(id) || this.handlers.location.has(id);
      case 'location':
        return this.handlers.location.has(id);
      default:
        return false;
    }
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const webhookController = new WebhookController();