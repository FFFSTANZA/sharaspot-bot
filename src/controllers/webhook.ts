// src/controllers/webhook.ts - PRODUCTION READY WITH PROPER OCR INTEGRATION
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
import { photoVerificationService } from '../services/photo-verification';
import ocrProcessor from '../utils/ocr-processor';
import { WhatsAppWebhook, WhatsAppMessage } from '../types/whatsapp';
import { parseButtonId, ButtonParseResult } from '../utils/button-parser';
import { validateWhatsAppId } from '../utils/validation';
import { ownerWebhookController } from '../controllers/owner-webhook';
import { db } from '../config/database';
import { chargingStations, chargingSessions } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import axios from 'axios';

// ===============================================
// EXTENDED WHATSAPP MESSAGE TYPE
// ===============================================

interface ExtendedWhatsAppMessage extends WhatsAppMessage {
  image?: {
    id: string;
    mime_type?: string;
    sha256?: string;
    caption?: string;
  };
}

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
        .map(message => this.processMessage(message as ExtendedWhatsAppMessage)
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
        if (change.field === 'messages' && change.value.messages) {
          messages.push(...change.value.messages);
        }
      }
    }

    return messages;
  }

  private async processMessage(message: ExtendedWhatsAppMessage): Promise<void> {
    const whatsappId = message.from;

    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID format', { whatsappId });
      return;
    }

    try {
      whatsappService.markAsRead(message.id).catch(error =>
        logger.warn('Mark as read failed', { messageId: message.id, error })
      );

      logger.info('📨 Processing message', { whatsappId, type: message.type, messageId: message.id });

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
   * Route message to appropriate handler - ENHANCED with Photo Verification
   */
  private async routeMessage(message: ExtendedWhatsAppMessage, user: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;

    // ✅ PRIORITY 0: Check photo verification flow FIRST
    const verificationState = photoVerificationService.getVerificationState(whatsappId);
    if (verificationState) {
      // Handle image messages during verification
      if (message.image && verificationState.waitingFor) {
        await this.handleVerificationPhoto(whatsappId, message, verificationState);
        return;
      } 
      // Handle manual text entry (after OCR failures)
      else if (message.type === 'text' && !verificationState.waitingFor) {
        const type = verificationState.waitingFor === 'start_photo' ? 'start' : 'end';
        await this.handleManualVerificationEntry(whatsappId, message.text?.body || '', type);
        return;
      }
    }

    // Continue with normal routing
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
  // PHOTO VERIFICATION HANDLERS - REFACTORED
  // ===============================================

  /**
   * Handle verification photo upload - NOW USES OCR PROCESSOR
   */
  private async handleVerificationPhoto(
    whatsappId: string,
    message: ExtendedWhatsAppMessage,
    state: any
  ): Promise<void> {
    try {
      logger.info('📸 Processing verification photo', {
        whatsappId,
        waitingFor: state.waitingFor,
        attempt: state.attemptCount + 1
      });

      // Download image from WhatsApp
      const imageBuffer = await this.downloadWhatsAppImage(message.image?.id || '');

      if (!imageBuffer) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Failed to download image. Please try again.'
        );
        return;
      }

      // ✅ USE CENTRALIZED OCR PROCESSOR
      if (state.waitingFor === 'start_photo') {
        await photoVerificationService.handleStartPhoto(whatsappId, imageBuffer);
      } else if (state.waitingFor === 'end_photo') {
        await photoVerificationService.handleEndPhoto(whatsappId, imageBuffer);
      }

    } catch (error) {
      logger.error('Photo verification failed', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process photo. Please try again or type the reading manually.'
      );
    }
  }

  /**
   * Handle manual entry during verification flow
   */
  private async handleManualVerificationEntry(
    whatsappId: string,
    text: string,
    type: 'start' | 'end'
  ): Promise<void> {
    try {
      const trimmedInput = text.trim();
      
      // ✅ USE CENTRALIZED MANUAL ENTRY HANDLER
      await photoVerificationService.handleManualEntry(whatsappId, trimmedInput, type);

    } catch (error) {
      logger.error('Manual verification entry failed', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process entry. Please try again.'
      );
    }
  }

  /**
   * Download WhatsApp image via Cloud API
   */
  private async downloadWhatsAppImage(mediaId: string): Promise<Buffer | null> {
    try {
      // Step 1: Get media URL
      const mediaUrlResponse = await axios.get(
        `https://graph.facebook.com/v18.0/${mediaId}`,
        {
          headers: {
            'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`
          }
        }
      );

      const mediaUrl = mediaUrlResponse.data.url;
      if (!mediaUrl) {
        logger.error('No media URL in response', { mediaId });
        return null;
      }

      // Step 2: Download actual image
      const imageResponse = await axios.get(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`
        },
        responseType: 'arraybuffer'
      });

      const imageBuffer = Buffer.from(imageResponse.data);
      logger.info('✅ Image downloaded', { mediaId, size: imageBuffer.length });

      return imageBuffer;

    } catch (error) {
      logger.error('Failed to download WhatsApp image', { mediaId, error });
      return null;
    }
  }

  /**
   * Handle verification button responses
   */
  private async handleVerificationButtons(whatsappId: string, buttonId: string): Promise<void> {
    switch (buttonId) {
      case 'confirm_start_reading':
        await photoVerificationService.confirmStartReading(whatsappId);
        break;

      case 'confirm_end_reading':
        await photoVerificationService.confirmEndReading(whatsappId);
        break;

      case 'retake_start_photo':
        await photoVerificationService.retakeStartPhoto(whatsappId);
        break;

      case 'retake_end_photo':
        await photoVerificationService.retakeEndPhoto(whatsappId);
        break;

      case 'manual_entry':
        const state = photoVerificationService.getVerificationState(whatsappId);
        if (state) {
          const type = state.waitingFor === 'start_photo' ? 'start' : 'end';
          await whatsappService.sendTextMessage(
            whatsappId,
            `📝 *Manual Entry*\n\nPlease type the ${type} kWh reading from the meter.\n\n` +
            'Example: 1245.8'
          );
        }
        break;
    }
  }

  // ===============================================
  // MESSAGE TYPE HANDLERS (EXISTING)
  // ===============================================

  private async handleTextMessage(user: any, text: string, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const cleanText = text.toLowerCase().trim();

    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'text', text);
      return;
    }

    if (cleanText === 'owner') {
      await ownerWebhookController.enterOwnerMode(whatsappId);
      return;
    }

    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
      return;
    }

    const waitingType = this.waitingUsers.get(whatsappId);
    if (waitingType) {
      await this.handleWaitingInput(whatsappId, text, waitingType);
      return;
    }

    await this.handleCommand(whatsappId, cleanText, text);
  }

  private async handleButtonMessage(user: any, button: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: buttonId, title } = button;

    logger.info('🔘 Button pressed', { whatsappId, buttonId, title });

    // ✅ Check verification buttons FIRST
    if (photoVerificationService.isInVerificationFlow(whatsappId) && this.isVerificationButton(buttonId)) {
      await this.handleVerificationButtons(whatsappId, buttonId);
      return;
    }

    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'button', button);
      return;
    }

    if (buttonId.startsWith('session_stop_')) {
      const stationId = parseInt(buttonId.split('_')[2]);
      if (!isNaN(stationId)) {
        await bookingController.handleSessionStop(whatsappId, stationId);
        return;
      }
    }

    const parsed = parseButtonId(buttonId);

    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
      return;
    }

    await this.routeButtonAction(whatsappId, buttonId, parsed, title);
  }

  private async handleListMessage(user: any, list: any, isInPreferenceFlow: boolean): Promise<void> {
    const { whatsappId } = user;
    const { id: listId, title } = list;

    logger.info('📋 List selected', { whatsappId, listId, title });

    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await ownerWebhookController.handleOwnerMessage(whatsappId, 'list', list);
      return;
    }

    const parsed = parseButtonId(listId);

    if (isInPreferenceFlow) {
      await preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
      return;
    }

    await this.routeListAction(whatsappId, listId, parsed, title);
  }

  private async handleLocationMessage(user: any, location: any): Promise<void> {
    const { whatsappId } = user;

    if (ownerWebhookController.isInOwnerMode(whatsappId)) {
      await whatsappService.sendTextMessage(whatsappId, 'Location sharing not supported in owner mode. Please use buttons or type commands.');
      return;
    }

    logger.info('📍 Raw location data received', {
      whatsappId,
      rawLocation: location,
      hasLatitude: !!location?.latitude,
      hasLongitude: !!location?.longitude,
      latType: typeof location?.latitude,
      lngType: typeof location?.longitude
    });

    let lat: number, lng: number;

    try {
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
  // BUTTON & LIST ROUTING LOGIC
  // ===============================================

  private async routeButtonAction(whatsappId: string, buttonId: string, parsed: ButtonParseResult, title: string): Promise<void> {
    logger.info('🎯 Routing button action', { whatsappId, buttonId, parsed });

    if (this.isQueueButton(buttonId)) {
      logger.info('📋 Routing to queue controller', { whatsappId, buttonId });
      await queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
      return;
    }

    if (this.isLocationButton(buttonId)) {
      logger.info('📍 Routing to location controller', { whatsappId, buttonId });
      await this.handleLocationButton(whatsappId, buttonId);
      return;
    }

    if (parsed.category === 'station' && parsed.stationId > 0) {
      logger.info('🏭 Routing to station handler', { whatsappId, buttonId, stationId: parsed.stationId });
      await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
      return;
    }

    logger.info('⚙️ Routing to core button handler', { whatsappId, buttonId });
    await this.handleCoreButton(whatsappId, buttonId);
  }

  private async routeListAction(whatsappId: string, listId: string, parsed: ButtonParseResult, title: string): Promise<void> {
    logger.info('📋 Routing list action', { whatsappId, listId, parsed });

    if (this.isQueueButton(listId)) {
      await queueWebhookController.handleQueueList(whatsappId, listId, title);
      return;
    }

    if (this.isLocationList(listId)) {
      logger.info('📍 Routing to location list handler', { whatsappId, listId });
      await this.handleLocationList(whatsappId, listId, parsed);
      return;
    }

    if (parsed.category === 'station' && parsed.stationId > 0) {
      await bookingController.handleStationSelection(whatsappId, parsed.stationId);
      return;
    }

    await whatsappService.sendTextMessage(whatsappId, 'Unknown selection. Please try again.');
  }

  // ===============================================
  // SPECIFIC BUTTON HANDLERS
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
        await this.handleGetDirections(whatsappId, stationId);
        break;

      default:
        await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

  private async handleLocationButton(whatsappId: string, buttonId: string): Promise<void> {
    logger.info('🎯 Routing location button', { whatsappId, buttonId });

    try {
      await webhookLocationController.handleLocationButton(whatsappId, buttonId, '');
      logger.info('✅ Location button handled successfully', { whatsappId, buttonId });

    } catch (error) {
      logger.error('❌ Location button handling failed', {
        whatsappId,
        buttonId,
        error: error instanceof Error ? error.message : String(error)
      });

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

  private async handleCommand(whatsappId: string, cleanText: string, originalText: string): Promise<void> {
    const commands: Record<string, () => Promise<void>> = {
      'hi': () => this.handleGreeting(whatsappId),
      'hello': () => this.handleGreeting(whatsappId),
      'hey': () => this.handleGreeting(whatsappId),
      'start': () => this.handleGreeting(whatsappId),
      'help': () => this.showHelp(whatsappId),
      'book': () => this.startBooking(whatsappId),
      'find': () => this.startBooking(whatsappId),
      'search': () => this.startBooking(whatsappId),
      'station': () => this.startBooking(whatsappId),
      'stations': () => this.startBooking(whatsappId),
      'gps': () => this.requestGPSLocation(whatsappId),
      'location': () => this.requestGPSLocation(whatsappId),
      'share': () => this.requestGPSLocation(whatsappId),
      'nearby': () => this.handleNearbyRequest(whatsappId),
      'near': () => this.handleNearbyRequest(whatsappId),
      'around': () => this.handleNearbyRequest(whatsappId),
      'directions': () => this.handleGetDirections(whatsappId),
      'navigate': () => this.handleGetDirections(whatsappId),
      'maps': () => this.handleGetDirections(whatsappId),
      'route': () => this.handleGetDirections(whatsappId),
      'profile': () => profileService.showProfileSummary(whatsappId),
      'preferences': () => preferenceController.startPreferenceGathering(whatsappId),
      'settings': () => preferenceController.startPreferenceGathering(whatsappId)
    };

    const commandHandler = commands[cleanText];
    if (commandHandler) {
      await commandHandler();
      return;
    }

    await this.handlePotentialAddress(whatsappId, originalText);
  }

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

  private async handleLocationList(whatsappId: string, listId: string, parsed: ButtonParseResult): Promise<void> {
    if (listId.startsWith('recent_search_') && parsed.index !== undefined) {
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
  // LOCATION METHODS
  // ===============================================

  private async handleGetDirections(whatsappId: string, stationId?: number): Promise<void> {
    if (stationId) {
      try {
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

        const lat = Number(station.latitude);
        const lng = Number(station.longitude);

        const locationSent = await whatsappService.sendLocationMessage(
          whatsappId,
          lat,
          lng,
          station.name,
          station.address
        );

        if (locationSent) {
          setTimeout(async () => {
            await whatsappService.sendTextMessage(
              whatsappId,
              `Location sent for ${station.name}\n\nTap the location above to open in your maps app for turn-by-turn navigation!`
            );
          }, 1000);
        } else {
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
      await whatsappService.sendTextMessage(
        whatsappId,
        'Get Directions\n\nFirst select a charging station, then I can send you the exact location for navigation!'
      );
    }
  }

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
        '⚡ SharaSpot'
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
      '⚡ Find Stations'
    );
  }

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
  // INPUT REQUEST METHODS
  // ===============================================

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

  private async requestProfileUpdate(whatsappId: string): Promise<void> {
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
  // INPUT PROCESSING METHODS
  // ===============================================

  private async processNameInput(whatsappId: string, name: string): Promise<void> {
    const cleanName = name.trim();

    if (cleanName.length < 2 || cleanName.length > 50) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Please provide a valid name (2-50 characters).\n\nTry again:'
      );
      this.waitingUsers.set(whatsappId, 'name');
      return;
    }

    try {
      const success = await profileService.updateUserName(whatsappId, cleanName);

      if (success) {
        logger.info('✅ User name updated successfully', { whatsappId, newName: cleanName });
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Failed to update name. Please try again.\n\nType your name:'
        );
        this.waitingUsers.set(whatsappId, 'name');
      }
    } catch (error) {
      logger.error('Failed to update user name', { whatsappId, name: cleanName, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.\n\nType your name:'
      );
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

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private isVerificationButton(buttonId: string): boolean {
    const verificationButtons = [
      'confirm_start_reading', 'confirm_end_reading',
      'retake_start_photo', 'retake_end_photo',
      'manual_entry'
    ];
    return verificationButtons.includes(buttonId);
  }

  private isQueueButton(buttonId: string): boolean {
    const queueButtons = [
      'join_queue_', 'queue_status_', 'cancel_queue_', 'confirm_cancel_',
      'start_session_', 'session_stop_', 'session_status_', 'extend_',
      'nearby_alternatives_', 'cheaper_options_', 'faster_charging_',
      'smart_recommendation_',
      'notify_when_ready_', 'live_updates_',
      'rate_1_', 'rate_2_', 'rate_3_', 'rate_4_', 'rate_5_'
    ];

    return queueButtons.some(pattern => buttonId.startsWith(pattern));
  }

  private isLocationButton(buttonId: string): boolean {
    const coreLocationButtons = [
      'share_gps_location', 'type_address', 'try_different_address',
      'location_help', 'recent_searches', 'new_search'
    ];

    const navigationButtons = [
      'next_station', 'load_more_stations', 'show_all_nearby',
      'show_all_results', 'back_to_search', 'back_to_list',
      'back_to_top_result', 'expand_search', 'remove_filters'
    ];

    const directionButtons = [
      'get_directions', 'directions_help'
    ];

    if (coreLocationButtons.includes(buttonId) ||
        navigationButtons.includes(buttonId) ||
        directionButtons.includes(buttonId)) {
      return true;
    }

    const locationPrefixes = [
      'recent_search_', 'location_', 'search_', 'station_info_',
      'select_station_', 'book_station_'
    ];

    return locationPrefixes.some(prefix => buttonId.startsWith(prefix));
  }

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
    verificationStatesCount: number;
    uptime: string;
  } {
    // Get verification states count from service
    let verificationCount = 0;
    try {
      // Count active verification states
      // Note: This is a workaround since the service doesn't expose a count method
      verificationCount = 0; // photoVerificationService should add a getStatesCount() method
    } catch {
      verificationCount = 0;
    }

    return {
      status: 'healthy',
      waitingUsers: this.waitingUsers.size,
      verificationStatesCount: verificationCount,
      uptime: process.uptime().toString()
    };
  }
}

export const webhookController = new WebhookController();