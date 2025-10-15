// src/services/photo-verification.ts 
import { db } from '../config/database';
import { chargingSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { whatsappService } from './whatsapp';
import { sessionService } from './session';
import ocrProcessor from '../utils/ocr-processor';
import { OCR_CONFIG } from '../config/ocr-config';

/**
 * Photo Verification Service - Handles START and END photo verification
 * NO IMAGE STORAGE - Only extracts and validates kWh readings
 * BLOCKS session activation until START photo confirmed
 */

// Declaration 1 (non-exported)
interface VerificationState {
  sessionId: string;
  userWhatsapp: string;
  stationId: number;
  type: 'start' | 'end';
  attemptCount: number;
  lastReading?: number;
  lastConfidence?: number;
  timestamp: Date;
}

interface PhotoResult {
  success: boolean;
  reading?: number;
  confidence?: number;
  message: string;
  shouldRetry?: boolean;
}

interface ConsumptionValidation {
  isValid: boolean;
  consumption?: number;
  warnings?: string[];
  error?: string;
}

class PhotoVerificationService {
  private states = new Map<string, VerificationState>();

  // ==================== START PHOTO FLOW ====================

  /**
   * ✅ Step 1: Initiate START photo - Session stays 'initiated'
   */
  async initiateStartVerification(
    userWhatsapp: string,
    sessionId: string,
    stationId: number
  ): Promise<void> {
    this.states.set(userWhatsapp, {
      sessionId,
      userWhatsapp,
      stationId,
      type: 'start',
      attemptCount: 0,
      timestamp: new Date(),
    });

    await db
      .update(chargingSessions)
      .set({
        verificationStatus: 'awaiting_start_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    await this.sendStartPhotoRequest(userWhatsapp, 0);
    logger.info('✅ START photo requested', { userWhatsapp, sessionId });
  }

  /**
   * ✅ Step 2: Handle START photo upload
   */
  async handleStartPhoto(userWhatsapp: string, imageBuffer: Buffer): Promise<PhotoResult> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'start') {
      return { success: false, message: '❌ Not expecting a start photo right now.' };
    }

    state.attemptCount++;
    this.states.set(userWhatsapp, state);

    logger.info('📸 Processing START photo', {
      userWhatsapp,
      attempt: state.attemptCount,
      sessionId: state.sessionId,
    });

    const ocrResult = await ocrProcessor.extractKwhReading(imageBuffer);

    if (!ocrResult.success || !ocrResult.reading) {
      return await this.handleOCRFailure(userWhatsapp, state, ocrResult.error);
    }

    const confidence = ocrResult.confidence || 0;

    if (confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      return await this.handleLowConfidence(userWhatsapp, state, confidence);
    }

    state.lastReading = ocrResult.reading;
    state.lastConfidence = confidence;
    this.states.set(userWhatsapp, state);

    await this.sendReadingConfirmation(userWhatsapp, ocrResult.reading, 'start', confidence);

    return {
      success: true,
      reading: ocrResult.reading,
      confidence,
      message: 'Reading detected. Awaiting confirmation.',
    };
  }

  /**
   * ✅ Step 3: Confirm START reading - ACTIVATES charging
   */
  async confirmStartReading(userWhatsapp: string): Promise<boolean> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'start' || !state.lastReading) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        '❌ No reading to confirm. Please take a photo first.'
      );
      return false;
    }

    const session = await this.getSession(state.sessionId);
    if (!session) {
      logger.error('Session not found during START confirmation', { sessionId: state.sessionId });
      return false;
    }

    // ✅ Update session with START reading
    await db
      .update(chargingSessions)
      .set({
        startMeterReading: state.lastReading.toString(),
        startReadingConfidence: state.lastConfidence?.toString(),
        startVerificationAttempts: state.attemptCount,
        verificationStatus: 'start_verified',
        meterValidated: true,
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    logger.info('✅ START reading confirmed', {
      userWhatsapp,
      reading: state.lastReading,
      confidence: state.lastConfidence,
      sessionId: state.sessionId,
    });

    // ✅ CRITICAL: Activate charging ONLY after confirmation
    await sessionService.startChargingAfterVerification(state.sessionId, state.lastReading);

    // ✅ Send activation message
    await whatsappService.sendTextMessage(
      userWhatsapp,
      `⚡ *Charging Started!*\n\n` +
      `📊 *Initial Reading:* ${ocrProcessor.formatReading(state.lastReading)}\n` +
      `💰 *Rate:* ₹${session.ratePerKwh}/kWh\n` +
      `🔋 *Target:* 80%\n\n` +
      `When done charging, use:\n🛑 /stop - To end session`
    );

    this.states.delete(userWhatsapp);
    return true;
  }

  /**
   * Retry START photo
   */
  async retakeStartPhoto(userWhatsapp: string): Promise<void> {
    const state = this.states.get(userWhatsapp);
    if (!state) {
      await whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
      return;
    }

    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return;
    }

    await this.sendStartPhotoRequest(userWhatsapp, state.attemptCount);
  }

  // ==================== END PHOTO FLOW ====================

  /**
   * ✅ Step 1: Initiate END photo
   */
  async initiateEndVerification(
    userWhatsapp: string,
    sessionId: string,
    stationId: number
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session?.startMeterReading) {
      throw new Error('No start reading found for session');
    }

    this.states.set(userWhatsapp, {
      sessionId,
      userWhatsapp,
      stationId,
      type: 'end',
      attemptCount: 0,
      timestamp: new Date(),
    });

    await db
      .update(chargingSessions)
      .set({
        verificationStatus: 'awaiting_end_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    await this.sendEndPhotoRequest(userWhatsapp, 0);
    logger.info('✅ END photo requested', { userWhatsapp, sessionId });
  }

  /**
   * ✅ Step 2: Handle END photo upload
   */
  async handleEndPhoto(userWhatsapp: string, imageBuffer: Buffer): Promise<PhotoResult> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'end') {
      return { success: false, message: '❌ Not expecting an end photo right now.' };
    }

    state.attemptCount++;
    this.states.set(userWhatsapp, state);

    logger.info('📸 Processing END photo', {
      userWhatsapp,
      attempt: state.attemptCount,
      sessionId: state.sessionId,
    });

    const ocrResult = await ocrProcessor.extractKwhReading(imageBuffer);

    if (!ocrResult.success || !ocrResult.reading) {
      return await this.handleOCRFailure(userWhatsapp, state, ocrResult.error);
    }

    const confidence = ocrResult.confidence || 0;

    if (confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      return await this.handleLowConfidence(userWhatsapp, state, confidence);
    }

    // ✅ Validate consumption
    const validation = await this.validateConsumption(state.sessionId, ocrResult.reading);
    if (!validation.isValid) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        `⚠️ *Validation Issue*\n\n${validation.error}\n\nPlease retake the photo.`
      );
      return { success: false, message: validation.error || 'Validation failed', shouldRetry: true };
    }

    state.lastReading = ocrResult.reading;
    state.lastConfidence = confidence;
    this.states.set(userWhatsapp, state);

    await this.sendEndReadingConfirmation(
      userWhatsapp,
      ocrResult.reading,
      validation.consumption!,
      confidence,
      validation.warnings
    );

    return {
      success: true,
      reading: ocrResult.reading,
      confidence,
      message: 'End reading detected. Awaiting confirmation.',
    };
  }

  /**
   * ✅ Step 3: Confirm END reading - COMPLETES session
   */
  async confirmEndReading(userWhatsapp: string): Promise<boolean> {
    const state = this.states.get(userWhatsapp);
    if (!state || state.type !== 'end' || !state.lastReading) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        '❌ No reading to confirm. Please take a photo first.'
      );
      return false;
    }

    const session = await this.getSession(state.sessionId);
    if (!session?.startMeterReading) {
      logger.error('Start reading not found during END confirmation', { sessionId: state.sessionId });
      return false;
    }

    const startReading = parseFloat(session.startMeterReading);
    const consumption = state.lastReading - startReading;

    // ✅ Update session with END reading
    await db
      .update(chargingSessions)
      .set({
        endMeterReading: state.lastReading.toString(),
        endReadingConfidence: state.lastConfidence?.toString(),
        endVerificationAttempts: state.attemptCount,
        energyDelivered: consumption.toString(),
        verificationStatus: 'completed',
        meterValidated: true,
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    logger.info('✅ END reading confirmed', {
      userWhatsapp,
      reading: state.lastReading,
      consumption,
      sessionId: state.sessionId,
    });

    // ✅ CRITICAL: Complete session with consumption
    await sessionService.completeSessionAfterVerification(
      state.sessionId,
      state.lastReading,
      consumption
    );

    this.states.delete(userWhatsapp);
    return true;
  }

  /**
   * Retry END photo
   */
  async retakeEndPhoto(userWhatsapp: string): Promise<void> {
    const state = this.states.get(userWhatsapp);
    if (!state) {
      await whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
      return;
    }

    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return;
    }

    await this.sendEndPhotoRequest(userWhatsapp, state.attemptCount);
  }

  // ==================== MANUAL ENTRY ====================

  async handleManualEntry(userWhatsapp: string, input: string): Promise<boolean> {
    const state = this.states.get(userWhatsapp);
    if (!state) return false;

    const reading = parseFloat(input.trim());
    const validation = ocrProcessor.validateReading(reading);

    if (!validation.valid) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        `❌ *Invalid Reading*\n\n${validation.error}\n\nPlease enter a valid kWh reading.`
      );
      return false;
    }

    if (state.type === 'end') {
      const consumptionValidation = await this.validateConsumption(state.sessionId, reading);
      if (!consumptionValidation.isValid) {
        await whatsappService.sendTextMessage(
          userWhatsapp,
          `❌ *Validation Failed*\n\n${consumptionValidation.error}\n\nPlease check and re-enter.`
        );
        return false;
      }
    }

    state.lastReading = reading;
    state.lastConfidence = 0;
    this.states.set(userWhatsapp, state);

    await this.sendReadingConfirmation(userWhatsapp, reading, state.type, 0);
    return true;
  }

  // ==================== VALIDATION ====================

  private async validateConsumption(sessionId: string, endReading: number): Promise<ConsumptionValidation> {
    const session = await this.getSession(sessionId);
    if (!session?.startMeterReading) {
      return { isValid: false, error: 'Start reading not found' };
    }

    const startReading = parseFloat(session.startMeterReading);
    const result = ocrProcessor.calculateConsumption(startReading, endReading);

    if (!result.valid) {
      return { isValid: false, error: result.error };
    }

    const durationMinutes = Math.floor(
      (Date.now() - (session.startTime?.getTime() || Date.now())) / (1000 * 60)
    );
    const chargerPowerKw = session.maxPowerUsed || 50;
    const contextValidation = ocrProcessor.validateConsumptionWithContext(
      result.consumption!,
      durationMinutes,
      chargerPowerKw
    );

    return {
      isValid: contextValidation.valid,
      consumption: result.consumption,
      warnings: contextValidation.warnings,
      error: contextValidation.error,
    };
  }

  // ==================== MESSAGING ====================

  private async sendStartPhotoRequest(userWhatsapp: string, attemptCount: number): Promise<void> {
    const message = attemptCount === 0
      ? `📸 *Please take a photo of your charging dashboard*\n\n` +
        `🎯 *Tips for best results:*\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}\n\n` +
        `📊 We need the *current kWh reading* to start your session.`
      : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${OCR_CONFIG.MAX_ATTEMPTS})\n\n` +
        `💡 *Please ensure:*\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.steady}`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
  }

  private async sendEndPhotoRequest(userWhatsapp: string, attemptCount: number): Promise<void> {
    const message = attemptCount === 0
      ? `📸 *Please take a photo of your FINAL charging reading*\n\n` +
        `🎯 *Capture the final kWh display:*\n` +
        `• Same dashboard as start photo\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n\n` +
        `📊 This will calculate your actual consumption.`
      : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${OCR_CONFIG.MAX_ATTEMPTS})\n\n` +
        `💡 *Please ensure:*\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n` +
        `• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
  }

  private async sendReadingConfirmation(
    userWhatsapp: string,
    reading: number,
    type: 'start' | 'end',
    confidence: number
  ): Promise<void> {
    const formatted = ocrProcessor.formatReading(reading);
    const confidenceWarning = ocrProcessor.shouldWarnLowConfidence(confidence)
      ? `\n⚠️ *Low confidence (${confidence.toFixed(0)}%)* - Please verify carefully\n`
      : '';

    const message = `✅ *Reading Detected!*\n\n` +
      `📊 *${type === 'start' ? 'Start' : 'Final'} Reading:* ${formatted}${confidenceWarning}\n` +
      `❓ *Is this correct?*`;

    await whatsappService.sendButtonMessage(
      userWhatsapp,
      message,
      [
        { id: `confirm_${type}_reading`, title: '✓ Yes, Correct' },
        { id: `retake_${type}_photo`, title: '✗ Retake Photo' },
      ],
      '📊 Confirm Reading'
    );
  }

  private async sendEndReadingConfirmation(
    userWhatsapp: string,
    endReading: number,
    consumption: number,
    confidence: number,
    warnings?: string[]
  ): Promise<void> {
    const confidenceWarning = ocrProcessor.shouldWarnLowConfidence(confidence)
      ? `⚠️ *Low confidence (${confidence.toFixed(0)}%)* - Please verify carefully\n\n`
      : '';

    let message = `✅ *Final Reading Detected!*\n\n${confidenceWarning}` +
      `📊 *Reading:* ${ocrProcessor.formatReading(endReading)}\n` +
      `⚡ *Consumption:* ${consumption.toFixed(2)} kWh\n\n`;

    if (warnings?.length) {
      message += `⚠️ *Notices:*\n${warnings.map(w => `• ${w}`).join('\n')}\n\n`;
    }

    message += `❓ *Confirm to complete your session?*`;

    await whatsappService.sendButtonMessage(
      userWhatsapp,
      message,
      [
        { id: 'confirm_end_reading', title: '✓ Confirm & Complete' },
        { id: 'retake_end_photo', title: '✗ Retake Photo' },
      ],
      '📊 Final Confirmation'
    );
  }

  // ==================== ERROR HANDLING ====================

  private async handleOCRFailure(
    userWhatsapp: string,
    state: VerificationState,
    error?: string
  ): Promise<PhotoResult> {
    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return { success: false, message: 'Max attempts reached. Manual entry required.' };
    }

    const suggestions = ocrProcessor.getRetrySuggestions();
    const message = `❌ *Couldn't read the display*\n\n${error || 'Please retake the photo'}\n\n` +
      `💡 *Tips:*\n${suggestions.join('\n')}\n\n` +
      `📸 *Attempt ${state.attemptCount} of ${OCR_CONFIG.MAX_ATTEMPTS}*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    return { success: false, message: error || 'OCR failed', shouldRetry: true };
  }

  private async handleLowConfidence(
    userWhatsapp: string,
    state: VerificationState,
    confidence: number
  ): Promise<PhotoResult> {
    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state);
      return { success: false, message: 'Max attempts reached. Manual entry required.' };
    }

    const tips = OCR_CONFIG.MESSAGES.RETRY_TIPS;
    const message = `⚠️ *Low Reading Confidence*\n\n` +
      `We detected a reading but confidence is low (${confidence.toFixed(0)}%)\n\n` +
      `💡 *Please retake with:*\n• ${tips.lighting}\n• ${tips.focus}\n• ${tips.steady}\n\n` +
      `*Attempt ${state.attemptCount} of ${OCR_CONFIG.MAX_ATTEMPTS}*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    return { success: false, message: `Low confidence: ${confidence.toFixed(0)}%`, shouldRetry: true };
  }

  private async fallbackToManualEntry(userWhatsapp: string, state: VerificationState): Promise<void> {
    await db
      .update(chargingSessions)
      .set({
        manualEntryUsed: true,
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    const message = `📝 *Manual Entry Required*\n\n` +
      `We couldn't read the display after ${OCR_CONFIG.MAX_ATTEMPTS} attempts.\n\n` +
      `Please *type* the ${state.type === 'start' ? 'current' : 'final'} kWh reading from your dashboard.\n\n` +
      `📊 *Example:* 1245.8\n\n` +
      `💡 *Make sure to enter the exact reading shown.*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    logger.info('Fallback to manual entry', {
      userWhatsapp,
      type: state.type,
      sessionId: state.sessionId,
      attempts: state.attemptCount,
    });
  }

  // ==================== UTILITIES ====================

  private async getSession(sessionId: string) {
    const sessions = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    return sessions[0] || null;
  }

  isInVerificationFlow(userWhatsapp: string): boolean {
    const state = this.states.get(userWhatsapp);
    if (!state) return false;
    
    // Check if expired
    if (Date.now() - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS) {
      this.states.delete(userWhatsapp);
      return false;
    }
    return true;
  }

  getVerificationState(userWhatsapp: string): VerificationState | null {
    return this.states.get(userWhatsapp) || null;
  }

  clearVerificationState(userWhatsapp: string): void {
    this.states.delete(userWhatsapp);
  }

  cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [whatsappId, state] of this.states.entries()) {
      if (now - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS) {
        this.states.delete(whatsappId);
        logger.info('Cleaned up expired verification state', { whatsappId });
      }
    }
  }
}


export const photoVerificationService = new PhotoVerificationService();

// Cleanup expired states every 10 minutes
setInterval(() => photoVerificationService.cleanupExpiredStates(), 10 * 60 * 1000);