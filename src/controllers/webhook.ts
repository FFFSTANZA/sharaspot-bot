// src/controllers/webhook.ts - PRODUCTION READY & OPTIMIZED + ADMIN INTEGRATION
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
import { ownerWebhookController } from './owner-webhook';
import { adminWebhookController } from './admin-webhook'; // ✅ Import admin controller
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

  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      const webhookData: WhatsAppWebhook = req.body;

      if (webhookData.object !== 'whatsapp_business_account') {
        res.status(200).send('EVENT_RECEIVED');
        return;
      }

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

  private extractMessages(webhookData: WhatsAppWebhook): WhatsAppMessage[] {
    const messages: WhatsAppMessage[] = [];
    for (const entry of webhookData.entry) {
      for (const change of entry.changes) {
        if (change.field === 'messages' && Array.isArray(change.value.messages)) {
          messages.push(...change.value.messages);
        }
      }
    }
    return messages;
  }

  private async processMessage(message: WhatsAppMessage): Promise<void> {
    const whatsappId = message.from;

    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID format', { whatsappId });
      return;
    }

    try {
      // Mark as read (fire-and-forget)
      whatsappService.markAsRead(message.id).catch(error =>
        logger.warn('Mark as read failed', { messageId: message.id, error })
      );

      logger.info('📨 Processing message', { whatsappId, type: message.type, messageId: message.id });

      const [userResult, preferenceFlowResult] = await Promise.allSettled([
        userService.createUser({ whatsappId }),
        preferenceService.isInPreferenceFlow(whatsappId)
      ]);

      const user = userResult.status === 'fulfilled' ? userResult.value : null;
      const isInPreferenceFlow = preferenceFlowResult.status === 'fulfilled' ? preferenceFlowResult.value : false;

      if (!user) {
        logger.error('Failed to get/create user', { whatsappId });
        await this.sendErrorMessage(whatsappId, 'Failed to initialize user session. Please try again.');
        return;
      }

      await this.routeMessage(message, user, isInPreferenceFlow);
    } catch (error) {
      logger.error('Message processing failed', {
        messageId: message.id,
        whatsappId,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.sendErrorMessage(whatsappId, 'Something went wrong. Please try again or type "help".');
    }
  }

  // ===============================================
  // MESSAGE ROUTING (WITH ADMIN PRIORITY)
  // ===============================================

  private async routeMessage(message: WhatsAppMessage, user: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;

    // ✅ PRIORITY 1: ADMIN MODE
    if (adminWebhookController.getAdminContext(whatsappId)) {
      const content = this.getMessageContent(message);
      if (content === null) return;

      await adminWebhookController.handleAdminMessage(whatsappId, message.type, content);
      return;
    }

    // ✅ PRIORITY 2: OWNER MODE
    if (message.type === 'text') {
      const cleanText = message.text?.body?.trim().toLowerCase();
      if (cleanText === 'owner') {
        await ownerWebhookController.enterOwnerMode(whatsappId);
        return;
      }

      if (ownerWebhookController.isInOwnerMode(whatsappId)) {
        await ownerWebhookController.handleOwnerMessage(whatsappId, 'text', message.text?.body || '');
        return;
      }
    }

    // ✅ PRIORITY 3: PREFERENCE FLOW
    if (isInPreferenceFlow) {
      switch (message.type) {
        case 'text':
          await preferenceController.handlePreferenceResponse(whatsappId, 'text', message.text?.body || '');
          break;
        case 'interactive':
          if (message.interactive?.type === 'button_reply' && message.interactive.button_reply) {
            await preferenceController.handlePreferenceResponse(
              whatsappId,
              'button',
              message.interactive.button_reply.id
            );
          } else if (message.interactive?.type === 'list_reply' && message.interactive.list_reply) {
            await preferenceController.handlePreferenceResponse(
              whatsappId,
              'text',
              message.interactive.list_reply.id
            );
          }
          break;
        default:
          await whatsappService.sendTextMessage(whatsappId, 'Please respond using buttons or text as requested.');
      }
      return;
    }

    // ✅ PRIORITY 4: WAITING FOR INPUT
    const waitingType = this.waitingUsers.get(whatsappId);
    if (waitingType && message.type === 'text') {
      await this.handleWaitingInput(whatsappId, message.text?.body || '', waitingType);
      return;
    }

    // ✅ PRIORITY 5: NORMAL USER MESSAGES
    await this.routeNormalMessage(message, whatsappId);
  }

  /**
   * Extract message content safely
   */
  private getMessageContent(message: WhatsAppMessage): any {
    switch (message.type) {
      case 'text':
        return message.text?.body || '';
      case 'interactive':
        if (message.interactive?.type === 'button_reply') {
          return message.interactive.button_reply || null;
        }
        if (message.interactive?.type === 'list_reply') {
          return message.interactive.list_reply || null;
        }
        return null;
      case 'location':
        return message.location || null;
      default:
        return null;
    }
  }

  /**
   * Route normal (non-admin, non-owner) messages
   */
  private async routeNormalMessage(message: WhatsAppMessage, whatsappId: string): Promise<void> {
    switch (message.type) {
      case 'text':
        const text = message.text?.body?.trim();
        if (!text) break;
        await this.handleTextMessage(whatsappId, text);
        break;

      case 'interactive':
        if (message.interactive?.type === 'button_reply' && message.interactive.button_reply) {
          await this.handleButtonMessage(whatsappId, message.interactive.button_reply);
        } else if (message.interactive?.type === 'list_reply' && message.interactive.list_reply) {
          await this.handleListMessage(whatsappId, message.interactive.list_reply);
        }
        break;

      case 'location':
        if (message.location?.latitude && message.location?.longitude) {
          await this.handleLocationMessage(whatsappId, message.location);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❌ Invalid location data received.');
        }
        break;

      default:
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unsupported message type. Please use text, buttons, or share location.'
        );
    }
  }

  // ===============================================
  // TEXT & INTERACTIVE HANDLERS
  // ===============================================

  private async handleTextMessage(whatsappId: string, text: string): Promise<void> {
    const cleanText = text.toLowerCase().trim();

    // ✅ Enter admin mode
    if (cleanText === 'admin') {
      await adminWebhookController.enterAdminMode(whatsappId);
      return;
    }

    // Handle normal command
    await this.handleCommand(whatsappId, cleanText, text);
  }

  private async handleButtonMessage(whatsappId: string, button: { id: string; title: string }): Promise<void> {
    const { id: buttonId, title } = button;

    // ✅ Admin button
    if (buttonId.startsWith('admin_')) {
      await adminWebhookController.handleAdminMessage(whatsappId, 'button', { id: buttonId, title });
      return;
    }

    // Normal button
    const parsed = parseButtonId(buttonId);
    await this.routeButtonAction(whatsappId, buttonId, parsed, title);
  }

  private async handleListMessage(whatsappId: string, list: { id: string; title: string }): Promise<void> {
    const { id: listId, title } = list;

    // ✅ Admin list
    if (listId.startsWith('admin_')) {
      await adminWebhookController.handleAdminMessage(whatsappId, 'list', { id: listId, title });
      return;
    }

    // Normal list
    const parsed = parseButtonId(listId);
    await this.routeListAction(whatsappId, listId, parsed, title);
  }

  private async handleLocationMessage(whatsappId: string, location: any): Promise<void> {
    if (!location.latitude || !location.longitude) {
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
  // COMMAND HANDLING
  // ===============================================

  private async handleCommand(whatsappId: string, cleanText: string, originalText: string): Promise<void> {
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

    const handler = commands[cleanText];
    if (handler) {
      await handler();
      return;
    }

    // Fallback: treat as address
    await this.handlePotentialAddress(whatsappId, originalText);
  }

  // ===============================================
  // BUTTON & LIST ROUTING
  // ===============================================

  private async routeButtonAction(
    whatsappId: string,
    buttonId: string,
    parsed: ButtonParseResult,
    title: string
  ): Promise<void> {
    if (this.isQueueButton(buttonId)) {
      await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
      return;
    }

    if (parsed.category === 'station' && parsed.stationId > 0) {
      await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
      return;
    }

    if (this.isLocationButton(buttonId)) {
      await this.handleLocationButton(whatsappId, buttonId);
      return;
    }

    await this.handleCoreButton(whatsappId, buttonId);
  }

  private async routeListAction(
    whatsappId: string,
    listId: string,
    parsed: ButtonParseResult,
    title: string
  ): Promise<void> {
    if (this.isQueueButton(listId)) {
      await queueWebhookController.handleQueueList(whatsappId, listId, title);
      return;
    }

    if (parsed.category === 'station' && parsed.stationId > 0) {
      await bookingController.handleStationSelection(whatsappId, parsed.stationId);
      return;
    }

    if (this.isLocationList(listId)) {
      await this.handleLocationList(whatsappId, listId, parsed);
      return;
    }

    await whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again.');
  }

  // ===============================================
  // SPECIFIC HANDLERS
  // ===============================================

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
        await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

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
  // INPUT & LOCATION HELPERS
  // ===============================================

  private async handleWaitingInput(whatsappId: string, input: string, type: 'name' | 'address'): Promise<void> {
    this.waitingUsers.delete(whatsappId);
    const trimmed = input.trim();

    if (type === 'name') {
      await this.processNameInput(whatsappId, trimmed);
    } else {
      await this.processAddressInput(whatsappId, trimmed);
    }
  }

  private async handleLocationList(whatsappId: string, listId: string, parsed: ButtonParseResult): Promise<void> {
    if (listId.startsWith('recent_search_') && typeof parsed.index === 'number') {
      await locationController.handleRecentSearchSelection(whatsappId, parsed.index);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
    }
  }

  private async handlePotentialAddress(whatsappId: string, text: string): Promise<void> {
    if (this.looksLikeAddress(text)) {
      await locationController.handleAddressInput(whatsappId, text);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ I didn\'t understand that. Type "help" for commands or "find" to search for charging stations.'
      );
    }
  }

  private looksLikeAddress(text: string): boolean {
    const indicators = [
      'road', 'street', 'st', 'rd', 'avenue', 'ave', 'nagar', 'colony',
      'sector', 'block', 'phase', 'mall', 'plaza', 'complex', 'society',
      'mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad', 'pune', 'kolkata'
    ];
    const lower = text.toLowerCase();
    return text.length > 3 && text.length < 100 && /[a-zA-Z]/.test(text) &&
           indicators.some(indicator => lower.includes(indicator));
  }

  // ===============================================
  // USER INTERACTIONS
  // ===============================================

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
      `🕒 Recent searches are saved for quick access`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  private async showLocationHelp(whatsappId: string): Promise<void> {
    const helpText = `📍 *Location Help*\n\n` +
      `*Share GPS Location:*\n` +
      `1️⃣ Tap the 📎 attachment icon\n` +
      `2️⃣ Select "Location"\n` +
      `3️⃣ Choose "Send current location"\n` +
      `4️⃣ Tap "Send"\n\n` +
      `*Type Address:*\n` +
      `Just type your location like:\n` +
      `• "Anna Nagar, Chennai"\n` +
      `• "Brigade Road, Bangalore"\n\n` +
      `*Tips:*\n` +
      `• GPS location is most accurate\n` +
      `• Include city name for better results`;

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
  // INPUT REQUESTS
  // ===============================================

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

  private async requestAddressInput(whatsappId: string): Promise<void> {
    this.waitingUsers.set(whatsappId, 'address');
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Type Your Address*\n\n' +
      'Enter the location where you need charging:\n\n' +
      '*Examples:*\n' +
      '• Anna Nagar, Chennai\n' +
      '• Brigade Road, Bangalore\n\n' +
      'Just type the address and press send!'
    );
  }

  private async requestProfileUpdate(whatsappId: string): Promise<void> {
    this.waitingUsers.set(whatsappId, 'name');
    await whatsappService.sendTextMessage(
      whatsappId,
      '✏️ *Update Your Name*\n\n' +
      'What would you like me to call you?\n\n' +
      '💡 Examples:\n' +
      '• Ravi Kumar\n' +
      '• Ashreya\n\n' +
      'Just type your preferred name:'
    );
  }

  // ===============================================
  // INPUT PROCESSING
  // ===============================================

  private async processNameInput(whatsappId: string, name: string): Promise<void> {
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 50) {
      await whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid name (2-50 characters).\n\nTry again:');
      this.waitingUsers.set(whatsappId, 'name');
      return;
    }

    try {
      const success = await profileService.updateUserName(whatsappId, cleanName);
      if (success) {
        await whatsappService.sendTextMessage(whatsappId, `✅ Name updated to *${cleanName}*!`);
        logger.info('✅ User name updated successfully', { whatsappId, newName: cleanName });
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❌ Failed to update name. Please try again.\n\nType your name:');
        this.waitingUsers.set(whatsappId, 'name');
      }
    } catch (error) {
      logger.error('Failed to update user name', { whatsappId, name: cleanName, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Please try again.\n\nType your name:');
      this.waitingUsers.set(whatsappId, 'name');
    }
  }

  private async processAddressInput(whatsappId: string, address: string): Promise<void> {
    if (address.length < 3) {
      await whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid address.');
      return;
    }
    await locationController.handleAddressInput(whatsappId, address);
  }

  private async handleDirections(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🗺️ *Navigation*\n\nDirections for station #${stationId} will be provided after booking.`
    );
  }

  // ===============================================
  // UTILITIES
  // ===============================================

  private isQueueButton(buttonId: string): boolean {
    const prefixes = [
      'queue_', 'session_', 'join_', 'start_', 'extend_',
      'live_', 'rate_', 'share_', 'cancel_', 'confirm_',
      'nearby_', 'cheaper_', 'faster_', 'smart_', 'notify_'
    ];
    return prefixes.some(p => buttonId.startsWith(p));
  }

  private isLocationButton(buttonId: string): boolean {
    return [
      'share_gps_location', 'type_address', 'try_different_address',
      'location_help', 'recent_searches', 'next_station',
      'load_more_stations', 'show_all_nearby', 'show_all_results',
      'expand_search', 'remove_filters', 'new_search'
    ].includes(buttonId);
  }

  private isLocationList(listId: string): boolean {
    return ['recent_search_', 'location_', 'search_'].some(p => listId.startsWith(p));
  }

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

  public getWaitingUsersCount(): number {
    return this.waitingUsers.size;
  }

  public cleanup(): void {
    this.waitingUsers.clear();
    logger.info('Webhook controller cleanup completed');
  }

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

// Export singleton
export const webhookController = new WebhookController();