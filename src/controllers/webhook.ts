// src/controllers/webhook.ts - PRODUCTION READY WITH PHOTO VERIFICATION + TESSERACT
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
import { chargingStations, chargingSessions } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import axios from 'axios';
import { createWorker } from 'tesseract.js';

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
// PHOTO VERIFICATION TYPES
// ===============================================

interface VerificationState {
  sessionId: string;
  stationId: number;
  waitingFor: 'start_photo' | 'end_photo' | 'manual_entry' | null;
  attemptCount: number;
  startReading?: number;
  endReading?: number;
  timestamp: Date;
}

interface OCRResult {
  success: boolean;
  kwhValue?: number;
  confidence?: number;
  error?: string;
}

// ===============================================
// PRODUCTION WEBHOOK CONTROLLER - COMPLETE & FIXED
// ===============================================

export class WebhookController {
  private readonly waitingUsers = new Map<string, 'name' | 'address'>();
  private readonly verificationStates = new Map<string, VerificationState>();
  private readonly MAX_OCR_ATTEMPTS = 3;

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

    // Priority 0: Check photo verification flow FIRST
    const verificationState = this.verificationStates.get(whatsappId);
    if (verificationState) {
      // Check if this is an image message
      if (message.image && verificationState.waitingFor) {
        await this.handleVerificationPhoto(whatsappId, message, verificationState);
        return;
      } else if (message.type === 'text' && !verificationState.waitingFor) {
        // Manual entry after OCR failures
        await this.handleManualEntry(whatsappId, message.text?.body || '', verificationState);
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
  // PHOTO VERIFICATION HANDLERS - NEW
  // ===============================================

  /**
   * Handle verification photo upload
   */
  private async handleVerificationPhoto(
    whatsappId: string,
    message: ExtendedWhatsAppMessage,
    state: VerificationState
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

      // Process OCR using Tesseract
      const ocrResult = await this.processOCRWithTesseract(imageBuffer);

      if (ocrResult.success && ocrResult.kwhValue) {
        // OCR successful
        if (state.waitingFor === 'start_photo') {
          await this.handleStartPhoto(whatsappId, ocrResult.kwhValue, state);
        } else if (state.waitingFor === 'end_photo') {
          await this.handleEndPhoto(whatsappId, ocrResult.kwhValue, state);
        }
      } else {
        // OCR failed
        state.attemptCount++;
        this.verificationStates.set(whatsappId, state);

        if (state.attemptCount >= this.MAX_OCR_ATTEMPTS) {
          // Allow manual entry after 3 failures
          state.waitingFor = null;
          this.verificationStates.set(whatsappId, state);

          await whatsappService.sendTextMessage(
            whatsappId,
            '❌ *Having trouble reading the meter*\n\n' +
            '📝 Please type the kWh reading manually.\n\n' +
            '*Format:* Just type the number (e.g., "1245.8")\n\n' +
            '💡 *Tips:*\n' +
            '• Make sure image is clear and well-lit\n' +
            '• Focus on the kWh digits\n' +
            '• Avoid glare or shadows'
          );
        } else {
          // Ask to retake photo
          const attemptsLeft = this.MAX_OCR_ATTEMPTS - state.attemptCount;
          await whatsappService.sendButtonMessage(
            whatsappId,
            `❌ *Couldn't read the meter clearly*\n\n` +
            `Attempts remaining: ${attemptsLeft}\n\n` +
            `📸 Tips for better photo:\n` +
            `• Ensure good lighting\n` +
            `• Hold camera steady\n` +
            `• Focus on the kWh display\n` +
            `• Avoid reflections`,
            [
              { id: `retake_${state.waitingFor}`, title: '📸 Retake Photo' },
              { id: 'manual_entry', title: '📝 Type Manually' }
            ],
            '📸 Photo Verification'
          );
        }
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
   * Handle start meter reading photo
   */
  private async handleStartPhoto(whatsappId: string, kwhValue: number, state: VerificationState): Promise<void> {
    try {
      state.startReading = kwhValue;
      state.waitingFor = null;
      this.verificationStates.set(whatsappId, state);

      await whatsappService.sendButtonMessage(
        whatsappId,
        `✅ *Start Reading Captured*\n\n` +
        `📊 *Meter Reading:* ${kwhValue} kWh\n\n` +
        `Is this correct?`,
        [
          { id: 'confirm_start_reading', title: '✅ Confirm' },
          { id: 'retake_start_photo', title: '📸 Retake' }
        ],
        '📊 Confirm Reading'
      );

    } catch (error) {
      logger.error('Failed to handle start photo', { whatsappId, error });
      throw error;
    }
  }

  /**
   * Handle end meter reading photo
   */
  private async handleEndPhoto(whatsappId: string, kwhValue: number, state: VerificationState): Promise<void> {
    try {
      state.endReading = kwhValue;
      state.waitingFor = null;
      this.verificationStates.set(whatsappId, state);

      const energyConsumed = state.startReading ? kwhValue - state.startReading : 0;

      await whatsappService.sendButtonMessage(
        whatsappId,
        `✅ *End Reading Captured*\n\n` +
        `📊 *Start:* ${state.startReading} kWh\n` +
        `📊 *End:* ${kwhValue} kWh\n` +
        `⚡ *Consumed:* ${energyConsumed.toFixed(2)} kWh\n\n` +
        `Is this correct?`,
        [
          { id: 'confirm_end_reading', title: '✅ Confirm & Complete' },
          { id: 'retake_end_photo', title: '📸 Retake' }
        ],
        '📊 Confirm Reading'
      );

    } catch (error) {
      logger.error('Failed to handle end photo', { whatsappId, error });
      throw error;
    }
  }

  /**
   * Handle manual entry after OCR failures
   */
  private async handleManualEntry(whatsappId: string, text: string, state: VerificationState): Promise<void> {
    try {
      const kwhValue = parseFloat(text.trim());

      if (isNaN(kwhValue) || kwhValue < 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Invalid number. Please type a valid kWh reading (e.g., "1245.8")'
        );
        return;
      }

      // Determine if this is start or end reading based on context
      if (!state.startReading) {
        await this.handleStartPhoto(whatsappId, kwhValue, state);
      } else {
        await this.handleEndPhoto(whatsappId, kwhValue, state);
      }

    } catch (error) {
      logger.error('Manual entry failed', { whatsappId, error });
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
   * Process OCR on meter image using Tesseract.js
   */
  private async processOCRWithTesseract(imageBuffer: Buffer): Promise<OCRResult> {
    let worker;
    try {
      logger.info('🔍 Starting Tesseract OCR processing', { bufferSize: imageBuffer.length });

      // Create Tesseract worker
      worker = await createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });

      // Set recognition parameters for better number detection
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.kKwWhH '
      });

      // Recognize text from image
      const { data: { text, confidence } } = await worker.recognize(imageBuffer);
      
      logger.info('📝 OCR text extracted', { text, confidence });

      // Extract kWh value from text
      const kwhValue = this.extractKwhFromText(text);

      if (kwhValue !== null && confidence && confidence > 50) {
        logger.info('✅ OCR successful', { kwhValue, confidence });
        return {
          success: true,
          kwhValue,
          confidence
        };
      } else {
        logger.warn('❌ OCR failed to extract valid kWh', { text, confidence });
        return {
          success: false,
          error: 'Could not extract kWh value from image'
        };
      }

    } catch (error) {
      logger.error('❌ Tesseract OCR processing failed', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OCR processing failed'
      };
    } finally {
      // Always terminate worker to free resources
      if (worker) {
        await worker.terminate();
      }
    }
  }

  /**
   * Extract kWh value from OCR text
   */
  private extractKwhFromText(text: string): number | null {
    try {
      // Remove whitespace and convert to lowercase
      const cleanText = text.replace(/\s+/g, ' ').toLowerCase();
      
      logger.info('🔍 Extracting kWh from text', { cleanText });

      // Pattern 1: "1234.5 kwh" or "1234.5kwh"
      let match = cleanText.match(/(\d+\.?\d*)\s*k?wh/i);
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        if (!isNaN(value) && value >= 0 && value < 1000000) {
          return value;
        }
      }

      // Pattern 2: Just numbers (assume it's kWh if reasonable range)
      match = cleanText.match(/(\d+\.?\d+)/);
      if (match && match[1]) {
        const value = parseFloat(match[1]);
        // Reasonable range for meter reading (0-100000 kWh)
        if (!isNaN(value) && value >= 0 && value < 100000) {
          return value;
        }
      }

      // Pattern 3: Multiple numbers - take the largest reasonable one
      const allNumbers = cleanText.match(/\d+\.?\d*/g);
      if (allNumbers && allNumbers.length > 0) {
        const validNumbers = allNumbers
          .map(n => parseFloat(n))
          .filter(n => !isNaN(n) && n >= 0 && n < 100000);
        
        if (validNumbers.length > 0) {
          // Return the largest valid number (likely the main meter reading)
          return Math.max(...validNumbers);
        }
      }

      return null;

    } catch (error) {
      logger.error('Failed to extract kWh', { text, error });
      return null;
    }
  }

  /**
   * Handle verification button responses
   */
  private async handleVerificationButtons(whatsappId: string, buttonId: string): Promise<void> {
    const state = this.verificationStates.get(whatsappId);
    if (!state) return;

    switch (buttonId) {
      case 'confirm_start_reading':
        // Start charging session
        await this.startChargingSession(whatsappId, state);
        break;

      case 'confirm_end_reading':
        // Complete session and send bill
        await this.completeChargingSession(whatsappId, state);
        break;

      case 'retake_start_photo':
        state.attemptCount = 0;
        state.waitingFor = 'start_photo';
        state.startReading = undefined;
        this.verificationStates.set(whatsappId, state);
        await this.requestMeterPhoto(whatsappId, 'start');
        break;

      case 'retake_end_photo':
        state.attemptCount = 0;
        state.waitingFor = 'end_photo';
        state.endReading = undefined;
        this.verificationStates.set(whatsappId, state);
        await this.requestMeterPhoto(whatsappId, 'end');
        break;

      case 'manual_entry':
        state.waitingFor = null;
        this.verificationStates.set(whatsappId, state);
        await whatsappService.sendTextMessage(
          whatsappId,
          '📝 *Manual Entry*\n\nPlease type the kWh reading from the meter.\n\n' +
          'Example: 1245.8'
        );
        break;
    }
  }

  /**
   * Request meter photo from user
   */
  private async requestMeterPhoto(whatsappId: string, type: 'start' | 'end'): Promise<void> {
    const message = type === 'start' ?
      '📸 *Take Start Meter Photo*\n\n' +
      '1️⃣ Focus on the kWh display\n' +
      '2️⃣ Ensure good lighting\n' +
      '3️⃣ Keep image steady\n' +
      '4️⃣ Send the photo\n\n' +
      '💡 Clear photo = accurate billing!' :
      '📸 *Take End Meter Photo*\n\n' +
      '1️⃣ Focus on the kWh display\n' +
      '2️⃣ Ensure good lighting\n' +
      '3️⃣ Keep image steady\n' +
      '4️⃣ Send the photo\n\n' +
      '🧾 This will generate your final bill';

    await whatsappService.sendTextMessage(whatsappId, message);
  }

  /**
   * Start charging session after start photo verification
   */
  private async startChargingSession(whatsappId: string, state: VerificationState): Promise<void> {
    try {
      // Clear waiting state but keep verification record
      this.verificationStates.delete(whatsappId);

      await whatsappService.sendTextMessage(
        whatsappId,
        `⚡ *Charging Started!*\n\n` +
        `📊 *Start Reading:* ${state.startReading} kWh\n` +
        `🔋 *Session Active*\n\n` +
        `You'll receive live updates during charging.\n` +
        `Take an end photo when you're done!`
      );

      logger.info('✅ Charging session started', { whatsappId, startReading: state.startReading });

    } catch (error) {
      logger.error('Failed to start charging session', { whatsappId, error });
    }
  }

  /**
   * Complete charging session and send summary
   */
  private async completeChargingSession(whatsappId: string, state: VerificationState): Promise<void> {
    try {
      if (!state.startReading || !state.endReading) {
        throw new Error('Missing readings');
      }

      const energyConsumed = state.endReading - state.startReading;
      const pricePerKwh = 12.5; // Get from station
      const energyCost = energyConsumed * pricePerKwh;
      const platformFee = Math.max(5, energyCost * 0.05);
      const gst = (energyCost + platformFee) * 0.18;
      const totalCost = energyCost + platformFee + gst;

      // Send session summary
      await this.sendSessionSummary(whatsappId, {
        sessionId: state.sessionId,
        stationId: state.stationId,
        startReading: state.startReading,
        endReading: state.endReading,
        energyConsumed,
        energyCost,
        platformFee,
        gst,
        totalCost,
        pricePerKwh
      });

      // Clear verification state
      this.verificationStates.delete(whatsappId);

      logger.info('✅ Charging session completed', { whatsappId, energyConsumed, totalCost });

    } catch (error) {
      logger.error('Failed to complete charging session', { whatsappId, error });
    }
  }

  /**
   * Send formatted session summary
   */
  private async sendSessionSummary(whatsappId: string, summary: any): Promise<void> {
    const message =
      `🎉 *Charging Complete!*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *SESSION SUMMARY*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📈 *Meter Readings:*\n` +
      `  Start: ${summary.startReading} kWh\n` +
      `  End: ${summary.endReading} kWh\n` +
      `  Consumed: ${summary.energyConsumed.toFixed(2)} kWh\n\n` +
      `💰 *Cost Breakdown:*\n` +
      `  Energy: ₹${summary.energyCost.toFixed(2)}\n` +
      `  Platform Fee: ₹${summary.platformFee.toFixed(2)}\n` +
      `  GST (18%): ₹${summary.gst.toFixed(2)}\n` +
      `  ─────────────────\n` +
      `  *Total: ₹${summary.totalCost.toFixed(2)}*\n\n` +
      `⚡ Rate: ₹${summary.pricePerKwh}/kWh\n\n` +
      `🧾 Receipt saved to your history!\n` +
      `Thank you for using SharaSpot! ⚡`;

    await whatsappService.sendTextMessage(whatsappId, message);

    // Send rating request
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🌟 *Rate Your Experience*',
        [
          { id: `rate_5_${summary.stationId}`, title: '⭐⭐⭐⭐⭐' },
          { id: `rate_4_${summary.stationId}`, title: '⭐⭐⭐⭐' },
          { id: `rate_3_${summary.stationId}`, title: '⭐⭐⭐' }
        ],
        '⭐ Feedback'
      );
    }, 2000);
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

    if (this.verificationStates.has(whatsappId) && this.isVerificationButton(buttonId)) {
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

  public getVerificationStatesCount(): number {
    return this.verificationStates.size;
  }

  public cleanup(): void {
    this.waitingUsers.clear();
    this.verificationStates.clear();
    logger.info('Webhook controller cleanup completed');
  }

  public getHealthStatus(): {
    status: 'healthy' | 'degraded';
    waitingUsers: number;
    verificationStates: number;
    uptime: string;
  } {
    return {
      status: 'healthy',
      waitingUsers: this.waitingUsers.size,
      verificationStates: this.verificationStates.size,
      uptime: process.uptime().toString()
    };
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const webhookController = new WebhookController();