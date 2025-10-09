// src/controllers/webhook.ts - PRODUCTION READY & OPTIMIZED - COMPLETE FIXED VERSION
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
import { webhookLocationController } from './location/webhook-location'; 
import { WhatsAppWebhook, WhatsAppMessage } from '../types/whatsapp';
import { parseButtonId, ButtonParseResult } from '../utils/button-parser';
import { validateWhatsAppId } from '../utils/validation';
import { ownerWebhookController } from '../controllers/owner-webhook';
import { db } from '../config/database';
import { chargingStations } from '../db/schema'; 
import { eq } from 'drizzle-orm';
// ===============================================
// PRODUCTION WEBHOOK CONTROLLER - COMPLETE & FIXED
// ===============================================

export class WebhookController {
  private readonly waitingUsers = new Map<string, 'name' | 'address'>();

  // ===============================================
  // WEBHOOK VERIFICATION & HANDLING
  // ===============================================

  /**
   * Verify webhook subscription
   */
  async verifyWebhook(req: Request, res: Response): Promise<void> {
    try {
      const mode = req.query['hub.mode'] as string;
      const token = req.query['hub.verify_token'] as string;
      const challenge = req.query['hub.challenge'] as string;

      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        logger.info('✅ Webhook verified successfully');
        res.status(200).send(challenge);
      } else {
        logger.error('❌ Webhook verification failed', { mode, token: !!token });
        res.sendStatus(403);
      }
    } catch (error) {
      logger.error('Webhook verification error', { error });
      res.sendStatus(500);
    }
  }
  

  
  /**
   * Handle incoming webhook messages
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookData: WhatsAppWebhook = req.body;

      if (webhookData.object !== 'whatsapp_business_account') {
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

      // Process all messages in parallel for better performance
      const messagePromises = this.extractMessages(webhookData)
        .map(message => this.processMessage(message)
          .catch(error => logger.error('Message processing failed', { 
            messageId: message.id, 
            error: error instanceof Error ? error.message : String(error)
          }))
        );

      await Promise.allSettled(messagePromises);
      res.status(200).send('EVENT_RECEIVED');

    } catch (error) {
      logger.error('Webhook processing failed', { error });
      res.status(500).send('Internal Server Error');
    }
  }

  // ===============================================
  // MESSAGE PROCESSING PIPELINE
  // ===============================================

  /**
   * Extract all messages from webhook data
   */
  private extractMessages(webhookData: WhatsAppWebhook): WhatsAppMessage[] {
    const messages: WhatsAppMessage[] = [];
    
    for (const entry of webhookData.entry) {
      for (const change of entry.changes) {
        if (change.field === 'messages' && change.value.messages) {
          messages.push(...change.value.messages);
        }
      }
    }
    
    return messages;
  }

  /**
   * Process individual message with proper error handling
   */
  private async processMessage(message: WhatsAppMessage): Promise<void> {
    const whatsappId = message.from;

    // Validate WhatsApp ID format
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID format', { whatsappId });
      return;
    }

    try {
      // Mark as read (non-blocking)
      whatsappService.markAsRead(message.id).catch(error => 
        logger.warn('Mark as read failed', { messageId: message.id, error })
      );

      logger.info('📨 Processing message', { whatsappId, type: message.type, messageId: message.id });

      // Get user context in parallel
      const [user, isInPreferenceFlow] = await Promise.allSettled([
        userService.createUser({ whatsappId }),
        preferenceService.isInPreferenceFlow(whatsappId)
      ]);

      const userData = user.status === 'fulfilled' ? user.value : null;
      const preferenceFlow = isInPreferenceFlow.status === 'fulfilled' ? isInPreferenceFlow.value : false;

      if (!userData) {
        logger.error('Failed to get/create user', { whatsappId });
        await this.sendErrorMessage(whatsappId, 'Failed to initialize user session. Please try again.');
        return;
      }

      // Route message based on type
      await this.routeMessage(message, userData, preferenceFlow);

    } catch (error) {
      logger.error('Message processing failed', { 
        messageId: message.id, 
        whatsappId, 
        error: error instanceof Error ? error.message : String(error)
      });
      await this.sendErrorMessage(whatsappId, 'Something went wrong. Please try again or type "help".');
    }
  }

  /**
   * Route message to appropriate handler
   */
  private async routeMessage(message: WhatsAppMessage, user: any, isInPreferenceFlow: boolean): Promise<void> {
    switch (message.type) {
      case 'text':
        await this.handleTextMessage(user, message.text?.body || '', isInPreferenceFlow);
        break;
        
      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          await this.handleButtonMessage(user, message.interactive.button_reply, isInPreferenceFlow);
        } else if (message.interactive?.type === 'list_reply') {
          await this.handleListMessage(user, message.interactive.list_reply, isInPreferenceFlow);
        }
        break;
        
      case 'location':
        await this.handleLocationMessage(user, message.location);
        break;
        
      default:
        await whatsappService.sendTextMessage(
          user.whatsappId,
          '❓ Unsupported message type. Please send text, location, or use buttons.'
        );
    }
  }

  // ===============================================
  // MESSAGE TYPE HANDLERS
  // ===============================================

  /**
   * Handle text messages with command routing
   */
  private async handleTextMessage(user: any, text: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const cleanText = text.toLowerCase().trim();

    // Priority 1: Check if user is in owner mode - MUST come first
    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'text', text);
      return;
    }

    // Priority 2: Owner mode entry
    if (cleanText === 'owner') {
      await ownerWebhookController.enterOwnerMode(whatsappId);
      return;
    }

    // Priority 3: Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
      return;
    }

    // Priority 4: Waiting for specific input
    const waitingType = this.waitingUsers.get(whatsappId);
    if (waitingType) {
      await this.handleWaitingInput(whatsappId, text, waitingType);
      return;
    }

    // Priority 5: Commands
    await this.handleCommand(whatsappId, cleanText, text);
  }

  /**
   * Handle button interactions with unified parsing
   */
  private async handleButtonMessage(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId, title });

    // Priority 1: Check if user is in owner mode - MUST come first
    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'button', button);
      return;
    }

    // Priority 2: Handle session stop buttons first (before other routing)
    if (buttonId.startsWith('session_stop_')) {
      const stationId = parseInt(buttonId.split('_')[2]);
      if (!isNaN(stationId)) {
        await bookingController.handleSessionStop(whatsappId, stationId);
        return;
      }
    }

    // Parse button ID once
    const parsed = parseButtonId(buttonId);
    
    // Priority 3: Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
      return;
    }

    // Priority 4: Route based on button category
    await this.routeButtonAction(whatsappId, buttonId, parsed, title);
  }

  /**
   * Handle list selections with unified parsing
   */
  private async handleListMessage(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId, title });

    // Priority 1: Check if user is in owner mode - MUST come first
    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'list', list);
      return;
    }

    // Parse list ID once
    const parsed = parseButtonId(listId);

    // Priority 2: Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
      return;
    }

    // Priority 3: Route based on list category
    await this.routeListAction(whatsappId, listId, parsed, title);
  }

  /**
   * Handle location sharing - FIXED & COMPLETE
   */
  private async handleLocationMessage(user: any, location: any): Promise<void> {
  const { whatsappId } = user;

  // Check if user is in owner mode first
  if (ownerWebhookController.isInOwnerMode(whatsappId)) {
    await whatsappService.sendTextMessage(whatsappId, 'Location sharing not supported in owner mode. Please use buttons or type commands.');
    return;
  }

  // ENHANCED: Log the raw location data for debugging
  logger.info('📍 Raw location data received', { 
    whatsappId, 
    rawLocation: location,
    hasLatitude: !!location?.latitude,
    hasLongitude: !!location?.longitude,
    latType: typeof location?.latitude,
    lngType: typeof location?.longitude
  });

  // ENHANCED: More flexible location validation
  let lat: number, lng: number;
  
  try {
    // Handle different data types WhatsApp might send
    if (typeof location?.latitude === 'string') {
      lat = parseFloat(location.latitude);
    } else if (typeof location?.latitude === 'number') {
      lat = location.latitude;
    } else {
      throw new Error('No valid latitude found');
    }

    if (typeof location?.longitude === 'string') {
      lng = parseFloat(location.longitude);
    } else if (typeof location?.longitude === 'number') {
      lng = location.longitude;
    } else {
      throw new Error('No valid longitude found');
    }

    // Validate coordinate ranges
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Invalid coordinate values');
    }

  } catch (error) {
    logger.error('❌ Location validation failed', { 
      whatsappId, 
      location,
      error: error instanceof Error ? error.message : String(error)
    });
    
    await whatsappService.sendTextMessage(
      whatsappId, 
      '❌ Invalid location data received. Please try sharing your location again:\n\n' +
      '1️⃣ Tap 📎 attachment icon\n' +
      '2️⃣ Select "Location"\n' +
      '3️⃣ Choose "Send your current location"\n' +
      '4️⃣ Tap "Send"'
    );
    return;
  }

  logger.info('✅ GPS location validated', { 
    whatsappId, 
    latitude: lat, 
    longitude: lng,
    name: location.name,
    address: location.address 
  });

  // ENHANCED: Handle GPS location with better error handling
  try {
    await locationController.handleGPSLocation(
      whatsappId,
      lat,
      lng,
      location.name || null,
      location.address || null
    );
    
    logger.info('✅ Location successfully processed by locationController', { whatsappId });
    
  } catch (error) {
    logger.error('❌ Location controller processing failed', { 
      whatsappId, 
      coordinates: { lat, lng },
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    await whatsappService.sendTextMessage(
      whatsappId, 
      '❌ Failed to process your location. Please try again or type your address instead.\n\n' +
      'If the problem persists, try typing your address like:\n' +
      '• "Anna Nagar, Chennai"\n' +
      '• "Brigade Road, Bangalore"'
    );
  }
}

  // ===============================================
  // BUTTON & LIST ROUTING LOGIC - FIXED
  // ===============================================

  /**
   * Route button actions to appropriate controllers
   */
  private async routeButtonAction(whatsappId: string, buttonId: string, parsed: ButtonParseResult, title: string): Promise<void> {
  logger.info('🎯 Routing button action', { whatsappId, buttonId, parsed });

  // Priority 1: Queue/booking system buttons (Phase 4)
  if (this.isQueueButton(buttonId)) {
    logger.info('📋 Routing to queue controller', { whatsappId, buttonId });
    await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
    return;
  }

  // Priority 2: Location buttons - FIXED: Check this BEFORE station buttons
  if (this.isLocationButton(buttonId)) {
    logger.info('📍 Routing to location controller', { whatsappId, buttonId });
    await this.handleLocationButton(whatsappId, buttonId);
    return;
  }

  // Priority 3: Station-specific buttons (only if not location-related)
  if (parsed.category === 'station' && parsed.stationId > 0) {
    logger.info('🏭 Routing to station handler', { whatsappId, buttonId, stationId: parsed.stationId });
    await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
    return;
  }

  // Priority 4: Core system buttons
  logger.info('⚙️ Routing to core button handler', { whatsappId, buttonId });
  await this.handleCoreButton(whatsappId, buttonId);
}
  /**
   * Route list actions to appropriate controllers
   */
  private async routeListAction(whatsappId: string, listId: string, parsed: ButtonParseResult, title: string): Promise<void> {
  logger.info('📋 Routing list action', { whatsappId, listId, parsed });

  // Priority 1: Queue/booking lists
  if (this.isQueueButton(listId)) {
    await queueWebhookController.handleQueueList(whatsappId, listId, title);
    return;
  }

  // Priority 2: Location-specific lists - FIXED: Check location lists properly
  if (this.isLocationList(listId)) {
    logger.info('📍 Routing to location list handler', { whatsappId, listId });
    await this.handleLocationList(whatsappId, listId, parsed);
    return;
  }

  // Priority 3: Station selection lists
  if (parsed.category === 'station' && parsed.stationId > 0) {
    await bookingController.handleStationSelection(whatsappId, parsed.stationId);
    return;
  }

  // Unknown list
  await whatsappService.sendTextMessage(whatsappId, 'Unknown selection. Please try again.');
}

  // ===============================================
  // SPECIFIC BUTTON HANDLERS - ENHANCED
  // ===============================================

  /**
   * Handle station-related buttons
   */
  private async handleStationButton(whatsappId: string, action: string, stationId: number): Promise<void> {
    switch (action) {
      case 'book':
        await bookingController.handleStationBooking(whatsappId, stationId);
        break;
        
      case 'info':
      case 'details':
        await bookingController.showStationDetails(whatsappId, stationId);
        break;
        
      case 'directions':
        await this.handleGetDirections(whatsappId, stationId);
        break;
        
      default:
        // Default to station selection
        await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

  /**
   * Handle location-related buttons - 🔧 FIXED: Complete implementation
   */
  private async handleLocationButton(whatsappId: string, buttonId: string): Promise<void> {
  logger.info('🎯 Routing location button', { whatsappId, buttonId });
  
  try {
    // Route to the webhook location controller with proper error handling
    await webhookLocationController.handleLocationButton(whatsappId, buttonId, '');
    
    logger.info('✅ Location button handled successfully', { whatsappId, buttonId });
    
  } catch (error) {
    logger.error('❌ Location button handling failed', { 
      whatsappId, 
      buttonId, 
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Fallback handling for common buttons
    switch (buttonId) {
      case 'share_gps_location':
        await this.requestGPSLocation(whatsappId);
        break;
        
      case 'type_address':
        await this.requestAddressInput(whatsappId);
        break;
        
      case 'location_help':
        await this.showLocationHelp(whatsappId);
        break;
        
      case 'new_search':
        await this.startBooking(whatsappId);
        break;
        
      default:
        await whatsappService.sendTextMessage(
          whatsappId, 
          'There was an issue with that button. Please try "find" to search for stations.'
        );
    }
  }
}

  /**
   * Handle core system buttons
   */
  private async handleCoreButton(whatsappId: string, buttonId: string): Promise<void> {
    switch (buttonId) {
      case 'help':
        await this.showHelp(whatsappId);
        break;
        
      case 'quick_book':
      case 'find_stations':
        await this.startBooking(whatsappId);
        break;
        
      case 'view_profile':
        await profileService.showProfileSummary(whatsappId);
        break;
        
      case 'update_profile':
        await this.requestProfileUpdate(whatsappId);
        break;
        
      case 'update_preferences':
        await preferenceController.startPreferenceGathering(whatsappId);
        break;
        
      default:
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown action. Type "help" for available commands.');
    }
  }

  // ===============================================
  // COMMAND HANDLING - COMPLETE WITH LOCATION COMMANDS
  // ===============================================

  /**
   * Handle text commands with fallback to address parsing
   */
  private async handleCommand(whatsappId: string, cleanText: string, originalText: string): Promise<void> {
    // Core commands
    const commands: Record<string, () => Promise<void>> = {
      // Basic commands
      'hi': () => this.handleGreeting(whatsappId),
      'hello': () => this.handleGreeting(whatsappId),
      'hey': () => this.handleGreeting(whatsappId),
      'start': () => this.handleGreeting(whatsappId),
      'help': () => this.showHelp(whatsappId),
      
      // Station finding
      'book': () => this.startBooking(whatsappId),
      'find': () => this.startBooking(whatsappId),
      'search': () => this.startBooking(whatsappId),
      'station': () => this.startBooking(whatsappId),
      'stations': () => this.startBooking(whatsappId),
      
      // 🔧 ADDED: Location & GPS commands
      'gps': () => this.requestGPSLocation(whatsappId),
      'location': () => this.requestGPSLocation(whatsappId),
      'share': () => this.requestGPSLocation(whatsappId),
      'nearby': () => this.handleNearbyRequest(whatsappId),
      'near': () => this.handleNearbyRequest(whatsappId),
      'around': () => this.handleNearbyRequest(whatsappId),
      
      // 🔧 ADDED: Directions commands  
      'directions': () => this.handleGetDirections(whatsappId),
      'navigate': () => this.handleGetDirections(whatsappId),
      'maps': () => this.handleGetDirections(whatsappId),
      'route': () => this.handleGetDirections(whatsappId),
      
      // Profile & preferences
      'profile': () => profileService.showProfileSummary(whatsappId),
      'preferences': () => preferenceController.startPreferenceGathering(whatsappId),
      'settings': () => preferenceController.startPreferenceGathering(whatsappId)
    };

    const commandHandler = commands[cleanText];
    if (commandHandler) {
      await commandHandler();
      return;
    }

    // Fallback: treat as potential address
    await this.handlePotentialAddress(whatsappId, originalText);
  }

  /**
   * Handle waiting input (name/address)
   */
  private async handleWaitingInput(whatsappId: string, input: string, type: 'name' | 'address'): Promise<void> {
    this.waitingUsers.delete(whatsappId);
    
    const trimmedInput = input.trim();
    
    if (type === 'name') {
      await this.processNameInput(whatsappId, trimmedInput);
    } else {
      await this.processAddressInput(whatsappId, trimmedInput);
    }
  }

  // ===============================================
  // LOCATION & ADDRESS HANDLING - ENHANCED
  // ===============================================

  /**
   * Handle location lists
   */
  private async handleLocationList(whatsappId: string, listId: string, parsed: ButtonParseResult): Promise<void> {
    if (listId.startsWith('recent_search_') && parsed.index !== undefined) {
      await locationController.handleRecentSearchSelection(whatsappId, parsed.index);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
    }
  }

  /**
   * Handle potential address input
   */
  private async handlePotentialAddress(whatsappId: string, text: string): Promise<void> {
    // Check if text looks like an address
    if (this.looksLikeAddress(text)) {
      await locationController.handleAddressInput(whatsappId, text);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ I didn\'t understand that. Type "help" for commands or "find" to search for charging stations.'
      );
    }
  }

  /**
   * Check if text looks like an address
   */
  private looksLikeAddress(text: string): boolean {
    const addressIndicators = [
      'road', 'street', 'st', 'rd', 'avenue', 'ave', 'nagar', 'colony',
      'sector', 'block', 'phase', 'mall', 'plaza', 'complex', 'society',
      'mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad', 'pune', 'kolkata'
    ];
    
    const lowerText = text.toLowerCase();
    return text.length > 3 && 
           text.length < 100 && 
           /[a-zA-Z]/.test(text) &&
           addressIndicators.some(indicator => lowerText.includes(indicator));
  }

  // ===============================================
  // NEW LOCATION METHODS - 🔧 ADDED MISSING IMPLEMENTATIONS
  // ===============================================

  /**
   * Handle get directions request - 🔧 ADDED MISSING METHOD
   */
  private async handleGetDirections(whatsappId: string, stationId?: number): Promise<void> {
  if (stationId) {
    try {
      // Get station from database - FIXED table name
      const [station] = await db
        .select({
          id: chargingStations.id,
          name: chargingStations.name,
          address: chargingStations.address,
          latitude: chargingStations.latitude,
          longitude: chargingStations.longitude
        })
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (!station) {
        await whatsappService.sendTextMessage(whatsappId, 'Station not found.');
        return;
      }

      // Convert decimal to number for location message
      const lat = Number(station.latitude);
      const lng = Number(station.longitude);

      // Send actual WhatsApp location message
      const locationSent = await whatsappService.sendLocationMessage(
        whatsappId,
        lat,
        lng,
        station.name,
        station.address
      );

      if (locationSent) {
        // Send helpful navigation message after location
        setTimeout(async () => {
          await whatsappService.sendTextMessage(
            whatsappId,
            `Location sent for ${station.name}\n\nTap the location above to open in your maps app for turn-by-turn navigation!`
          );
        }, 1000);
      } else {
        // Fallback if location message fails
        await whatsappService.sendTextMessage(
          whatsappId,
          `${station.name}\n${station.address}\n\nCopy this address to your maps app for navigation.`
        );
      }

    } catch (error) {
      logger.error('Failed to send station directions', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        'Failed to get directions. Please try again.'
      );
    }
  } else {
    // No station ID - show general help
    await whatsappService.sendTextMessage(
      whatsappId,
      'Get Directions\n\nFirst select a charging station, then I can send you the exact location for navigation!'
    );
  }
}

  /**
   * Handle nearby stations request - 🔧 ADDED MISSING METHOD
   */
  private async handleNearbyRequest(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '📍 *Find Nearby Stations*\n\n' +
      'Share your location to find charging stations around you:',
      [
        { id: 'share_gps_location', title: '📱 Share GPS Location' },
        { id: 'type_address', title: '📝 Type Address' },
        { id: 'recent_searches', title: '🕒 Recent Searches' }
      ],
      '🔍 Location Search'
    );
  }

  // ===============================================
  // USER INTERACTION METHODS
  // ===============================================

  /**
   * Handle user greeting
   */
  private async handleGreeting(whatsappId: string): Promise<void> {
    const user = await userService.createUser({ whatsappId });
    
    if (!user?.preferencesCaptured) {
      await preferenceController.startPreferenceGathering(whatsappId);
    } else {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `👋 Welcome back ${user.name || 'there'}! Ready to find charging stations?`,
        [
          { id: 'quick_book', title: ' Find Stations' },
          { id: 'view_profile', title: '👤 Profile' },
          { id: 'help', title: '❓ Help' }
        ],
        ' SharaSpot'
      );
    }
  }

  /**
   * Start booking flow
   */
  private async startBooking(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Find Charging Stations*\n\nHow would you like to search?',
      [
        { id: 'share_gps_location', title: '📍 Share Location' },
        { id: 'type_address', title: '📝 Type Address' },
        { id: 'recent_searches', title: '🕒 Recent Searches' }
      ],
      ' Find Stations'
    );
  }

  /**
   * Show help message
   */
  private async showHelp(whatsappId: string): Promise<void> {
    const helpText = `🔋 *SharaSpot Help*\n\n` +
      `*Quick Commands:*\n` +
      `• "find" or "book" - Find stations\n` +
      `• "gps" or "location" - Share GPS\n` +
      `• "nearby" - Find nearby stations\n` +
      `• "directions" - Get navigation help\n` +
      `• "profile" - View your profile\n` +
      `• "preferences" - Update settings\n` +
      `• "help" - Show this help\n` +
      `• "owner" - Access owner portal\n\n` +
      `*How to Find Stations:*\n` +
      `1️⃣ Say "find" or tap "Find Stations"\n` +
      `2️⃣ Share location or type address\n` +
      `3️⃣ Browse and select stations\n` +
      `4️⃣ Book your charging slot\n\n` +
      `*Location Tips:*\n` +
      `📍 GPS location gives most accurate results\n` +
      `📝 You can type any address directly\n` +
      `🕒 Recent searches are saved for quick access\n` +
      `🗺️ Use "directions" for navigation help\n\n` +
      `Need more help? Just ask!`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  /**
   * Show location help
   */
  private async showLocationHelp(whatsappId: string): Promise<void> {
    const helpText = `📍 *Location Help*\n\n` +
      `*Share GPS Location:*\n` +
      `1️⃣ Tap 📎 attachment icon\n` +
      `2️⃣ Select "Location"\n` +
      `3️⃣ Choose "Send current location"\n` +
      `4️⃣ Tap "Send"\n\n` +
      `*Type Address:*\n` +
      `Just type your location like:\n` +
      `• "Anna Nagar, Chennai"\n` +
      `• "Brigade Road, Bangalore"\n` +
      `• "Sector 18, Noida"\n\n` +
      `*Get Directions:*\n` +
      `📱 Use WhatsApp live location sharing\n` +
      `🗺️ Copy address to your maps app\n\n` +
      `*Tips:*\n` +
      `• GPS location is most accurate\n` +
      `• Include city name for better results\n` +
      `• Try nearby landmarks if address doesn't work`;

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
  }

  // ===============================================
  // INPUT REQUEST METHODS - ENHANCED
  // ===============================================

  /**
   * Request GPS location sharing - 🔧 FIXED: Complete implementation
   */
  private async requestGPSLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📱 *Share Your GPS Location*\n\n' +
      '1️⃣ Tap the 📎 attachment icon\n' +
      '2️⃣ Select "Location"\n' +
      '3️⃣ Choose "Send your current location"\n' +
      '4️⃣ Tap "Send"\n\n' +
      '🎯 This gives the most accurate results!\n\n' +
      '📝 Or type your address if you prefer'
    );
  }

  /**
   * Request address input
   */
  private async requestAddressInput(whatsappId: string): Promise<void> {
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

  /**
   * Request profile update
   */
  private async requestProfileUpdate(whatsappId: string): Promise<void> {
    // Set user in waiting state for name input
    this.waitingUsers.set(whatsappId, 'name');
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '✏️ *Update Your Name*\n\n' +
      'What would you like me to call you?\n\n' +
      '💡 Examples:\n' +
      '• Ravi Kumar\n' +
      '• Ashreya\n' +
      '• Pooja\n\n' +
      'Just type your preferred name:'
    );
  }

  // ===============================================
  // INPUT PROCESSING METHODS - COMPLETE
  // ===============================================

  /**
   * Process name input
   */
  private async processNameInput(whatsappId: string, name: string): Promise<void> {
    const cleanName = name.trim();
    
    // Validation
    if (cleanName.length < 2 || cleanName.length > 50) {
      await whatsappService.sendTextMessage(
        whatsappId, 
        '❌ Please provide a valid name (2-50 characters).\n\nTry again:'
      );
      // Keep user in waiting state
      this.waitingUsers.set(whatsappId, 'name');
      return;
    }

    try {
      // Use profileService to update name (better than userService.createUser)
      const success = await profileService.updateUserName(whatsappId, cleanName);
      
      if (success) {
        // Success message already sent by profileService
        logger.info('✅ User name updated successfully', { whatsappId, newName: cleanName });
      } else {
        await whatsappService.sendTextMessage(
          whatsappId, 
          '❌ Failed to update name. Please try again.\n\nType your name:'
        );
        // Keep user in waiting state
        this.waitingUsers.set(whatsappId, 'name');
      }
    } catch (error) {
      logger.error('Failed to update user name', { whatsappId, name: cleanName, error });
      await whatsappService.sendTextMessage(
        whatsappId, 
        '❌ Something went wrong. Please try again.\n\nType your name:'
      );
      // Keep user in waiting state
      this.waitingUsers.set(whatsappId, 'name');
    }
  }

  /**
   * Process address input
   */
  private async processAddressInput(whatsappId: string, address: string): Promise<void> {
    if (address.length < 3) {
      await whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid address.');
      return;
    }

    await locationController.handleAddressInput(whatsappId, address);
  }

  // ===============================================
  // UTILITY METHODS - COMPLETE & ENHANCED
  // ===============================================

  /**
   * Check if button is queue/booking related
   */
  private isQueueButton(buttonId: string): boolean {
  // Use specific queue button patterns instead of broad prefixes
  const queueButtons = [
    // Queue management
    'join_queue_', 'queue_status_', 'cancel_queue_', 'confirm_cancel_',
    
    // Session management  
    'start_session_', 'session_stop_', 'session_status_', 'extend_',
    
    // Smart suggestions
    'nearby_alternatives_', 'cheaper_options_', 'faster_charging_',
    'smart_recommendation_',
    
    // Notifications
    'notify_when_ready_', 'live_updates_',
    
    // Rating (but NOT location sharing)
    'rate_1_', 'rate_2_', 'rate_3_', 'rate_4_', 'rate_5_'
  ];
  
  return queueButtons.some(pattern => buttonId.startsWith(pattern));
}

  /**
   * Check if button is location related - 🔧 ENHANCED: Complete list
   */
  private isLocationButton(buttonId: string): boolean {
  // Core location buttons
  const coreLocationButtons = [
    'share_gps_location', 'type_address', 'try_different_address',
    'location_help', 'recent_searches', 'new_search'
  ];
  
  // Navigation buttons
  const navigationButtons = [
    'next_station', 'load_more_stations', 'show_all_nearby', 
    'show_all_results', 'back_to_search', 'back_to_list',
    'back_to_top_result', 'expand_search', 'remove_filters'
  ];
  
  // Direction buttons  
  const directionButtons = [
    'get_directions', 'directions_help'
  ];
  
  // Check exact matches first
  if (coreLocationButtons.includes(buttonId) || 
      navigationButtons.includes(buttonId) || 
      directionButtons.includes(buttonId)) {
    return true;
  }
  
  // Check prefixes
  const locationPrefixes = [
    'recent_search_', 'location_', 'search_', 'station_info_',
    'select_station_', 'book_station_' // These are location context related
  ];
  
  return locationPrefixes.some(prefix => buttonId.startsWith(prefix));
}

  /**
   * Check if list is location related
   */
  private isLocationList(listId: string): boolean {
  const locationListPrefixes = [
    'recent_search_', 'location_', 'search_', 'select_station_'
  ];
  
  const exactLocationLists = [
    'recent_searches', 'location_options', 'search_results'
  ];
  
  return exactLocationLists.includes(listId) || 
         locationListPrefixes.some(prefix => listId.startsWith(prefix));
}

  /**
   * Send standardized error message
   */
  private async sendErrorMessage(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
    } catch (error) {
      logger.error('Failed to send error message', { whatsappId, error });
    }
  }

  // ===============================================
  // MONITORING & CLEANUP
  // ===============================================

  /**
   * Get waiting users count for monitoring
   */
  public getWaitingUsersCount(): number {
    return this.waitingUsers.size;
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.waitingUsers.clear();
    logger.info('Webhook controller cleanup completed');
  }

  /**
   * Health check for monitoring
   */
  public getHealthStatus(): {
    status: 'healthy' | 'degraded';
    waitingUsers: number;
    uptime: string;
  } {
    return {
      status: 'healthy',
      waitingUsers: this.waitingUsers.size,
      uptime: process.uptime().toString()
    };
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const webhookController = new WebhookController();