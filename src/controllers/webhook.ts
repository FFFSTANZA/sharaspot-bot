// src/controllers/webhook.ts - PRODUCTION READY & OPTIMIZED
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
import { parseButtonId, ButtonParseResult } from '../utils/button-parser';
import { validateWhatsAppId } from '../utils/validation';

// ===============================================
// PRODUCTION WEBHOOK CONTROLLER
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

    // Priority 1: Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
      return;
    }

    // Priority 2: Waiting for specific input
    const waitingType = this.waitingUsers.get(whatsappId);
    if (waitingType) {
      await this.handleWaitingInput(whatsappId, text, waitingType);
      return;
    }

    // Priority 3: Commands
    await this.handleCommand(whatsappId, cleanText, text);
  }

  /**
   * Handle button interactions with unified parsing
   */
  private async handleButtonMessage(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId, title });

    // Parse button ID once
    const parsed = parseButtonId(buttonId);
    
    // Priority 1: Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
      return;
    }

    // Priority 2: Route based on button category
    await this.routeButtonAction(whatsappId, buttonId, parsed, title);
  }

  /**
   * Handle list selections with unified parsing
   */
  private async handleListMessage(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId, title });

    // Parse list ID once
    const parsed = parseButtonId(listId);

    // Priority 1: Preference flow
    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
      return;
    }

    // Priority 2: Route based on list category
    await this.routeListAction(whatsappId, listId, parsed, title);
  }

  /**
   * Handle location sharing
   */
  private async handleLocationMessage(user: any, location: any): Promise<void> {
    const { whatsappId } = user;

    if (!location?.latitude || !location?.longitude) {
      await whatsappService.sendTextMessage(whatsappId, '❌ Invalid location data. Please try again.');
      return;
    }

    await locationController.handleGPSLocation(
      whatsappId,
      location.latitude,
      location.longitude,
      location.name,
      location.address
    );
  }

  // ===============================================
  // BUTTON & LIST ROUTING LOGIC
  // ===============================================

  /**
   * Route button actions to appropriate controllers
   */
  private async routeButtonAction(whatsappId: string, buttonId: string, parsed: ButtonParseResult, title: string): Promise<void> {
    // Queue/booking system buttons (Phase 4)
    if (this.isQueueButton(buttonId)) {
      await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
      return;
    }

    // Station-specific buttons
    if (parsed.category === 'station' && parsed.stationId > 0) {
      await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
      return;
    }

    // Location buttons
    if (this.isLocationButton(buttonId)) {
      await this.handleLocationButton(whatsappId, buttonId);
      return;
    }

    // Core system buttons
    await this.handleCoreButton(whatsappId, buttonId);
  }

  /**
   * Route list actions to appropriate controllers
   */
  private async routeListAction(whatsappId: string, listId: string, parsed: ButtonParseResult, title: string): Promise<void> {
    // Queue/booking lists
    if (this.isQueueButton(listId)) {
      await queueWebhookController.handleQueueList(whatsappId, listId, title);
      return;
    }

    // Station selection lists
    if (parsed.category === 'station' && parsed.stationId > 0) {
      await bookingController.handleStationSelection(whatsappId, parsed.stationId);
      return;
    }

    // Location-specific lists
    if (this.isLocationList(listId)) {
      await this.handleLocationList(whatsappId, listId, parsed);
      return;
    }

    // Unknown list
    await whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again.');
  }

  // ===============================================
  // SPECIFIC BUTTON HANDLERS
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
        await this.handleDirections(whatsappId, stationId);
        break;
        
      default:
        // Default to station selection
        await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

  /**
   * Handle location-related buttons
   */
  private async handleLocationButton(whatsappId: string, buttonId: string): Promise<void> {
    switch (buttonId) {
      case 'share_gps_location':
        await this.requestGPSLocation(whatsappId);
        break;
        
      case 'type_address':
      case 'try_different_address':
        await this.requestAddressInput(whatsappId);
        break;
        
      case 'recent_searches':
        await locationController.showRecentSearches(whatsappId);
        break;
        
      case 'next_station':
        await locationController.handleNextStation(whatsappId);
        break;
        
      case 'load_more_stations':
        await locationController.loadMoreStations(whatsappId);
        break;
        
      case 'show_all_nearby':
      case 'show_all_results':
        await locationController.showAllNearbyStations(whatsappId);
        break;
        
      case 'expand_search':
        await locationController.expandSearchRadius(whatsappId);
        break;
        
      case 'remove_filters':
        await locationController.removeFilters(whatsappId);
        break;
        
      case 'new_search':
        await locationController.startNewSearch(whatsappId);
        break;
        
      case 'location_help':
        await this.showLocationHelp(whatsappId);
        break;
        
      default:
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location action.');
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
  // COMMAND HANDLING
  // ===============================================

  /**
   * Handle text commands with fallback to address parsing
   */
  private async handleCommand(whatsappId: string, cleanText: string, originalText: string): Promise<void> {
    // Core commands
    const commands: Record<string, () => Promise<void>> = {
      'hi': () => this.handleGreeting(whatsappId),
      'hello': () => this.handleGreeting(whatsappId),
      'start': () => this.handleGreeting(whatsappId),
      'help': () => this.showHelp(whatsappId),
      'book': () => this.startBooking(whatsappId),
      'find': () => this.startBooking(whatsappId),
      'search': () => this.startBooking(whatsappId),
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
  // LOCATION & ADDRESS HANDLING
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
          { id: 'quick_book', title: '⚡ Find Stations' },
          { id: 'view_profile', title: '👤 Profile' },
          { id: 'help', title: '❓ Help' }
        ],
        '🔋 SharaSpot'
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
      '🔋 Find Stations'
    );
  }

  /**
   * Show help message
   */
  private async showHelp(whatsappId: string): Promise<void> {
    const helpText = `🔋 *SharaSpot Help*\n\n` +
      `*Quick Commands:*\n` +
      `• "find" or "book" - Find stations\n` +
      `• "profile" - View your profile\n` +
      `• "preferences" - Update settings\n` +
      `• "help" - Show this help\n\n` +
      `*How to Find Stations:*\n` +
      `1️⃣ Say "find" or tap "Find Stations"\n` +
      `2️⃣ Share location or type address\n` +
      `3️⃣ Browse and select stations\n` +
      `4️⃣ Book your charging slot\n\n` +
      `*Tips:*\n` +
      `📍 GPS location gives most accurate results\n` +
      `📝 You can type any address directly\n` +
      `🕒 Recent searches are saved for quick access\n\n` +
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
  // INPUT REQUEST METHODS
  // ===============================================

  /**
   * Request GPS location sharing
   */
  private async requestGPSLocation(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📱 *Share Your GPS Location*\n\n' +
      '1️⃣ Tap the 📎 attachment icon\n' +
      '2️⃣ Select "Location"\n' +
      '3️⃣ Choose "Send your current location"\n' +
      '4️⃣ Tap "Send"\n\n' +
      '🎯 This gives the most accurate results!'
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
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔄 Profile update feature coming soon! Use "preferences" to update your charging preferences.'
    );
  }

  // ===============================================
  // INPUT PROCESSING METHODS
  // ===============================================

  /**
   * Process name input
   */
  private async processNameInput(whatsappId: string, name: string): Promise<void> {
    if (name.length === 0 || name.length > 50) {
      await whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid name (1-50 characters).');
      return;
    }

    try {
      await userService.createUser({ whatsappId, name });
      await whatsappService.sendTextMessage(whatsappId, `✅ Great! Nice to meet you, ${name}.`);
    } catch (error) {
      logger.error('Failed to save user name', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to save name. Please try again.');
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

  /**
   * Handle get directions request
   */
  private async handleDirections(whatsappId: string, stationId: number): Promise<void> {
    // This could be enhanced to get actual station details
    await whatsappService.sendTextMessage(
      whatsappId,
      `🗺️ *Navigation*\n\nDirections for station #${stationId} will be provided by the booking system.`
    );
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  /**
   * Check if button is queue/booking related
   */
  private isQueueButton(buttonId: string): boolean {
    const queuePrefixes = [
      'queue_', 'session_', 'join_', 'start_', 'extend_',
      'live_', 'rate_', 'share_', 'cancel_', 'confirm_',
      'nearby_', 'cheaper_', 'faster_', 'smart_', 'notify_'
    ];
    return queuePrefixes.some(prefix => buttonId.startsWith(prefix));
  }

  /**
   * Check if button is location related
   */
  private isLocationButton(buttonId: string): boolean {
    const locationButtons = [
      'share_gps_location', 'type_address', 'try_different_address',
      'location_help', 'recent_searches', 'next_station',
      'load_more_stations', 'show_all_nearby', 'show_all_results',
      'expand_search', 'remove_filters', 'new_search'
    ];
    return locationButtons.includes(buttonId);
  }

  /**
   * Check if list is location related
   */
  private isLocationList(listId: string): boolean {
    const locationPrefixes = ['recent_search_', 'location_', 'search_'];
    return locationPrefixes.some(prefix => listId.startsWith(prefix));
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