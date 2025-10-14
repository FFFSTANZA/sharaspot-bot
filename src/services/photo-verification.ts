// src/services/photo-verification.ts
import { db } from '../config/database';
import { chargingSessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { whatsappService } from './whatsapp';
import ocrProcessor from '../utils/ocr-processor';
import { OCR_CONFIG } from '../config/ocr-config';

/**
 * Photo Verification Service
 * Manages the complete photo verification flow for charging sessions
 * NO IMAGE STORAGE - Only extracts and stores kWh values
 */

export interface VerificationState {
  sessionId: string;
  userWhatsapp: string;
  stationId: number;
  waitingFor: 'start_photo' | 'end_photo' | null;
  attemptCount: number;
  lastReading?: number;
  lastConfidence?: number;
  timestamp: Date;
}

export interface PhotoVerificationResult {
  success: boolean;
  reading?: number;
  confidence?: number;
  message: string;
  shouldRetry?: boolean;
  retrySuggestions?: string[];
}

interface ConsumptionValidation {
  isValid: boolean;
  consumption?: number;
  warnings?: string[];
  error?: string;
}

class PhotoVerificationService {
  private verificationStates = new Map<string, VerificationState>();

  // ==================== PUBLIC METHODS ====================

  /**
   * Initiate start photo verification flow
   */
  async initiateStartVerification(
    userWhatsapp: string,
    sessionId: string,
    stationId: number
  ): Promise<void> {
    const state: VerificationState = {
      sessionId,
      userWhatsapp,
      stationId,
      waitingFor: 'start_photo',
      attemptCount: 0,
      timestamp: new Date(),
    };

    this.setVerificationState(userWhatsapp, state);

    await db
      .update(chargingSessions)
      .set({
        verificationStatus: 'awaiting_start_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    await this.sendStartPhotoRequest(userWhatsapp, 0);
    logger.info('Start photo verification initiated', { userWhatsapp, sessionId });
  }

  /**
   * Handle uploaded start photo
   */
  async handleStartPhoto(
    userWhatsapp: string,
    imageBuffer: Buffer
  ): Promise<PhotoVerificationResult> {
    return this.handlePhoto(userWhatsapp, imageBuffer, 'start');
  }

  /**
   * Confirm start reading
   */
  async confirmStartReading(userWhatsapp: string): Promise<boolean> {
    return this.confirmReading(userWhatsapp, 'start');
  }

  /**
   * Reject start reading and retry
   */
  async retakeStartPhoto(userWhatsapp: string): Promise<void> {
    await this.retakePhoto(userWhatsapp, 'start');
  }

  /**
   * Initiate end photo verification flow
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

    const state: VerificationState = {
      sessionId,
      userWhatsapp,
      stationId,
      waitingFor: 'end_photo',
      attemptCount: 0,
      timestamp: new Date(),
    };

    this.setVerificationState(userWhatsapp, state);

    await db
      .update(chargingSessions)
      .set({
        verificationStatus: 'awaiting_end_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    await this.sendEndPhotoRequest(userWhatsapp, 0);
    logger.info('End photo verification initiated', { userWhatsapp, sessionId });
  }

  /**
   * Handle uploaded end photo
   */
  async handleEndPhoto(
    userWhatsapp: string,
    imageBuffer: Buffer
  ): Promise<PhotoVerificationResult> {
    return this.handlePhoto(userWhatsapp, imageBuffer, 'end');
  }

  /**
   * Confirm end reading and complete session
   */
  async confirmEndReading(userWhatsapp: string): Promise<boolean> {
    return this.confirmReading(userWhatsapp, 'end');
  }

  /**
   * Reject end reading and retry
   */
  async retakeEndPhoto(userWhatsapp: string): Promise<void> {
    await this.retakePhoto(userWhatsapp, 'end');
  }

  /**
   * Handle manual entry input
   */
  async handleManualEntry(
    userWhatsapp: string,
    input: string,
    type: 'start' | 'end'
  ): Promise<boolean> {
    const state = this.getVerificationState(userWhatsapp);
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

    if (type === 'end') {
      const validationResult = await this.validateConsumption(state.sessionId, reading);
      if (!validationResult.isValid) {
        await whatsappService.sendTextMessage(
          userWhatsapp,
          `❌ *Validation Failed*\n\n${validationResult.error}\n\nPlease check and re-enter the reading.`
        );
        return false;
      }
    }

    state.lastReading = reading;
    state.lastConfidence = 0;
    this.setVerificationState(userWhatsapp, state);

    await this.sendReadingConfirmation(
      userWhatsapp,
      reading,
      type,
      OCR_CONFIG.MAX_ATTEMPTS,
      0
    );
    return true;
  }

  // ==================== UTILITY METHODS ====================

  getVerificationState(userWhatsapp: string): VerificationState | null {
    const state = this.verificationStates.get(userWhatsapp);
    if (state && Date.now() - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS) {
      this.clearVerificationState(userWhatsapp);
      return null;
    }
    return state || null;
  }

  isInVerificationFlow(userWhatsapp: string): boolean {
    return this.getVerificationState(userWhatsapp) !== null;
  }

  clearVerificationState(userWhatsapp: string): void {
    this.verificationStates.delete(userWhatsapp);
  }

  cleanupExpiredStates(): void {
    const now = Date.now();
    for (const [whatsappId, state] of this.verificationStates.entries()) {
      if (now - state.timestamp.getTime() > OCR_CONFIG.STATE_EXPIRY_MS) {
        this.verificationStates.delete(whatsappId);
        logger.info('Cleaned up expired verification state', { whatsappId });
      }
    }
  }

  // ==================== PRIVATE HELPERS ====================

  private setVerificationState(userWhatsapp: string, state: VerificationState): void {
    this.verificationStates.set(userWhatsapp, { ...state });
  }

  private async getSession(sessionId: string) {
    const sessions = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    return sessions[0] || null;
  }

  private async handlePhoto(
    userWhatsapp: string,
    imageBuffer: Buffer,
    type: 'start' | 'end'
  ): Promise<PhotoVerificationResult> {
    const state = this.getVerificationState(userWhatsapp);
    if (!state || state.waitingFor !== `${type}_photo`) {
      return {
        success: false,
        message: `❌ Not expecting a ${type} photo right now.`,
      };
    }

    state.attemptCount += 1;
    this.setVerificationState(userWhatsapp, state);

    logger.info(`Processing ${type} photo`, {
      userWhatsapp,
      attempt: state.attemptCount,
      sessionId: state.sessionId,
    });

    const ocrResult = await ocrProcessor.extractKwhReading(imageBuffer);
    
    if (!ocrResult.success || ocrResult.reading === undefined) {
      return await this.handleOCRFailure(userWhatsapp, state, type, ocrResult.error);
    }

    const confidence = ocrResult.confidence || 0;
    
    // Check if confidence is below minimum threshold
    if (confidence < OCR_CONFIG.MIN_OCR_CONFIDENCE) {
      return await this.handleLowConfidence(userWhatsapp, state, type, confidence);
    }

    state.lastReading = ocrResult.reading;
    state.lastConfidence = confidence;
    this.setVerificationState(userWhatsapp, state);

    // Additional validation for end readings
    if (type === 'end') {
      const validationResult = await this.validateConsumption(state.sessionId, ocrResult.reading);
      if (!validationResult.isValid) {
        await whatsappService.sendTextMessage(
          userWhatsapp,
          `⚠️ *Reading Validation Issue*\n\n${validationResult.error}\n\nPlease retake the photo.`
        );
        return {
          success: false,
          message: validationResult.error || 'Validation failed',
          shouldRetry: true,
        };
      }

      await this.sendEndReadingConfirmation(
        userWhatsapp,
        ocrResult.reading,
        validationResult.consumption!,
        state.attemptCount,
        confidence,
        validationResult.warnings
      );
    } else {
      await this.sendReadingConfirmation(
        userWhatsapp,
        ocrResult.reading,
        type,
        state.attemptCount,
        confidence
      );
    }

    return {
      success: true,
      reading: ocrResult.reading,
      confidence,
      message: `${type} reading extracted. Awaiting confirmation.`,
    };
  }

  private async confirmReading(userWhatsapp: string, type: 'start' | 'end'): Promise<boolean> {
    const state = this.getVerificationState(userWhatsapp);
    if (!state || state.lastReading === undefined) {
      await whatsappService.sendTextMessage(
        userWhatsapp,
        '❌ No reading to confirm. Please take a photo first.'
      );
      return false;
    }

    const session = await this.getSession(state.sessionId);
    if (!session) {
      logger.error('Session not found during confirmation', { sessionId: state.sessionId });
      return false;
    }

    const updates: Partial<typeof chargingSessions.$inferInsert> = {
      verificationStatus: type === 'start' ? 'start_verified' : 'completed',
      meterValidated: true,
      updatedAt: new Date(),
    };

    if (type === 'start') {
      updates.startMeterReading = state.lastReading.toString();
      updates.startReadingConfidence = state.lastConfidence?.toString();
      updates.startVerificationAttempts = state.attemptCount;
    } else {
      const startReading = parseFloat(session.startMeterReading!);
      const consumption = state.lastReading - startReading;
      const endTime = new Date();
      const durationMs = endTime.getTime() - (session.startTime?.getTime() || Date.now());
      const durationMinutes = Math.floor(durationMs / (1000 * 60));
      const chargerPowerKw = session.maxPowerUsed || 50;

      const contextValidation = ocrProcessor.validateConsumptionWithContext(
        consumption,
        durationMinutes,
        chargerPowerKw
      );

      updates.endMeterReading = state.lastReading.toString();
      updates.endReadingConfidence = state.lastConfidence?.toString();
      updates.endVerificationAttempts = state.attemptCount;
      updates.energyDelivered = consumption.toString();
      updates.endTime = endTime;
      updates.duration = durationMinutes;
      updates.meterValidated = contextValidation.valid;
      updates.validationWarnings = contextValidation.warnings
        ? JSON.stringify(contextValidation.warnings)
        : null;

      await this.sendCompletionMessage(
        userWhatsapp,
        startReading,
        state.lastReading,
        consumption,
        durationMinutes,
        contextValidation.warnings
      );
    }

    await db
      .update(chargingSessions)
      .set(updates)
      .where(eq(chargingSessions.sessionId, state.sessionId));

    this.clearVerificationState(userWhatsapp);
    logger.info(`${type} reading confirmed`, {
      userWhatsapp,
      reading: state.lastReading,
      confidence: state.lastConfidence,
      sessionId: state.sessionId,
    });

    return true;
  }

  private async retakePhoto(userWhatsapp: string, type: 'start' | 'end'): Promise<void> {
    const state = this.getVerificationState(userWhatsapp);
    if (!state) {
      await whatsappService.sendTextMessage(userWhatsapp, '❌ Session expired. Please start again.');
      return;
    }

    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state, type);
      return;
    }

    if (type === 'start') {
      await this.sendStartPhotoRequest(userWhatsapp, state.attemptCount);
    } else {
      await this.sendEndPhotoRequest(userWhatsapp, state.attemptCount);
    }
  }

  private async validateConsumption(
    sessionId: string,
    endReading: number
  ): Promise<ConsumptionValidation> {
    const session = await this.getSession(sessionId);
    if (!session?.startMeterReading) {
      return { isValid: false, error: 'Start reading not found for this session' };
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
    const base = '📸 *Please take a photo of your charging dashboard*\n\n';
    const tips = attemptCount === 0
      ? `🎯 *Tips for best results:*\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}\n\n📊 We need the *current kWh reading* to start your session.`
      : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${OCR_CONFIG.MAX_ATTEMPTS})\n\n💡 *Please ensure:*\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.steady}`;

    await whatsappService.sendTextMessage(userWhatsapp, base + tips);
  }

  private async sendEndPhotoRequest(userWhatsapp: string, attemptCount: number): Promise<void> {
    const base = '📸 *Please take a photo of your FINAL charging reading*\n\n';
    const tips = attemptCount === 0
      ? `🎯 *Capture the final kWh display:*\n• Same dashboard as start photo\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.visible}\n\n📊 This will calculate your actual consumption.`
      : `📸 *Let's try again!* (Attempt ${attemptCount + 1} of ${OCR_CONFIG.MAX_ATTEMPTS})\n\n💡 *Please ensure:*\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.focus}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.lighting}\n• ${OCR_CONFIG.MESSAGES.RETRY_TIPS.numbers}`;

    await whatsappService.sendTextMessage(userWhatsapp, base + tips);
  }

  private async sendReadingConfirmation(
    userWhatsapp: string,
    reading: number,
    type: 'start' | 'end',
    attemptCount: number,
    confidence: number
  ): Promise<void> {
    const formatted = ocrProcessor.formatReading(reading);
    const confidenceWarning = ocrProcessor.shouldWarnLowConfidence(confidence)
      ? `\n⚠️ *Low confidence (${confidence.toFixed(0)}%)* - Please verify carefully\n`
      : '';
    
    const message = `✅ *Reading Detected!*\n\n📊 *${type === 'start' ? 'Start' : 'Final'} Reading:* ${formatted}${confidenceWarning}\n❓ *Is this correct?*`;

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
    attemptCount: number,
    confidence: number,
    warnings?: string[]
  ): Promise<void> {
    const confidenceWarning = ocrProcessor.shouldWarnLowConfidence(confidence)
      ? `⚠️ *Low confidence (${confidence.toFixed(0)}%)* - Please verify carefully\n\n`
      : '';
    
    let message = `✅ *Final Reading Detected!*\n\n${confidenceWarning}📊 *Reading:* ${ocrProcessor.formatReading(endReading)}\n⚡ *Consumption:* ${consumption.toFixed(2)} kWh\n\n`;
    
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

  private async sendCompletionMessage(
    userWhatsapp: string,
    startReading: number,
    endReading: number,
    consumption: number,
    durationMinutes: number,
    warnings?: string[]
  ): Promise<void> {
    const durationText = durationMinutes >= 60
      ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
      : `${durationMinutes}m`;

    let message = `🎉 *Charging Session Completed!*\n\n📊 *Start Reading:* ${ocrProcessor.formatReading(startReading)}\n📊 *End Reading:* ${ocrProcessor.formatReading(endReading)}\n⚡ *Energy Consumed:* ${consumption.toFixed(2)} kWh\n⏱️ *Duration:* ${durationText}\n\n💰 *Your bill is being calculated...*`;

    if (warnings?.length) {
      message += `\n\n📝 *Notes:*\n${warnings.map(w => `• ${w}`).join('\n')}`;
    }

    await whatsappService.sendTextMessage(userWhatsapp, message);
  }

  // ==================== ERROR HANDLING ====================

  private async handleOCRFailure(
    userWhatsapp: string,
    state: VerificationState,
    type: 'start' | 'end',
    error?: string
  ): Promise<PhotoVerificationResult> {
    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state, type);
      return { 
        success: false, 
        message: 'Max attempts reached. Falling back to manual entry.' 
      };
    }

    const suggestions = ocrProcessor.getRetrySuggestions();
    const message = `❌ *Couldn't read the display*\n\n${error || 'Please retake the photo'}\n\n💡 *Tips:*\n${suggestions.join('\n')}\n\n📸 *Attempt ${state.attemptCount} of ${OCR_CONFIG.MAX_ATTEMPTS}*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    return {
      success: false,
      message: error || 'OCR failed',
      shouldRetry: true,
      retrySuggestions: suggestions,
    };
  }

  private async handleLowConfidence(
    userWhatsapp: string,
    state: VerificationState,
    type: 'start' | 'end',
    confidence: number
  ): Promise<PhotoVerificationResult> {
    if (state.attemptCount >= OCR_CONFIG.MAX_ATTEMPTS) {
      await this.fallbackToManualEntry(userWhatsapp, state, type);
      return { 
        success: false, 
        message: 'Max attempts reached. Falling back to manual entry.' 
      };
    }

    const tips = OCR_CONFIG.MESSAGES.RETRY_TIPS;
    const message = `⚠️ *Low Reading Confidence*\n\nWe detected a reading but confidence is low (${confidence.toFixed(0)}%)\n\n💡 *Please retake with:*\n• ${tips.lighting}\n• ${tips.focus}\n• ${tips.steady}\n\n*Attempt ${state.attemptCount} of ${OCR_CONFIG.MAX_ATTEMPTS}*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    return { 
      success: false, 
      message: `Low confidence: ${confidence.toFixed(0)}%`, 
      shouldRetry: true 
    };
  }

  private async fallbackToManualEntry(
    userWhatsapp: string,
    state: VerificationState,
    type: 'start' | 'end'
  ): Promise<void> {
    await db
      .update(chargingSessions)
      .set({
        manualEntryUsed: true,
        verificationStatus: type === 'start' ? 'start_verified' : 'awaiting_end_photo',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, state.sessionId));

    const message = `📝 *Manual Entry Required*\n\nWe couldn't read the display after ${OCR_CONFIG.MAX_ATTEMPTS} attempts.\n\nPlease *type* the ${type === 'start' ? 'current' : 'final'} kWh reading from your dashboard.\n\n📊 *Example:* 1245.8\n\n💡 *Make sure to enter the exact reading shown.*`;

    await whatsappService.sendTextMessage(userWhatsapp, message);
    state.waitingFor = null;
    this.setVerificationState(userWhatsapp, state);
    logger.info('Fallback to manual entry', { 
      userWhatsapp, 
      type, 
      sessionId: state.sessionId,
      attempts: state.attemptCount 
    });
  }
}

export const photoVerificationService = new PhotoVerificationService();

// Cleanup expired states every 10 minutes
setInterval(() => photoVerificationService.cleanupExpiredStates(), 10 * 60 * 1000);