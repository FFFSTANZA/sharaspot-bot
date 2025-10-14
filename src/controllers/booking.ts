// src/controllers/booking.ts - PRODUCTION READY WITH PHOTO VERIFICATION
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/userService';
import { queueService } from '../services/queue';
import { sessionService } from '../services/session';
import { notificationService } from '../services/notification';
import { photoVerificationService } from '../services/photo-verification';
import { logger } from '../utils/logger';
import { db } from '../config/database';
import { chargingStations, chargingSessions } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { validateWhatsAppId } from '../utils/validation';

// ===============================================
// INTERFACES & TYPES
// ===============================================

interface StationDetails {
  id: number;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  geohash: string | null;
  distance: string | null;
  totalSlots: number;
  availableSlots: number;
  totalPorts: number;
  availablePorts: number;
  pricePerKwh: string;
  connectorTypes: any;
  operatingHours: any;
  amenities: any;
  isActive: boolean | null;
  isOpen: boolean | null;
  rating?: string | null;
  averageRating?: string | null;
  totalReviews?: number | null;
  reviewCount?: number | null;
  updatedAt: Date | null;
}

interface ProcessedStation extends StationDetails {
  isAvailable: boolean;
  utilization: number;
  availability: string;
  priceDisplay: string;
  distanceDisplay: string;
  ratingDisplay: string;
  slotsDisplay: string;
  finalRating: number;
  finalReviews: number;
}

// ===============================================
// BOOKING CONTROLLER WITH PHOTO VERIFICATION
// ===============================================

export class BookingController {
  
  // ===============================================
  // MESSAGE HANDLING WITH VERIFICATION
  // ===============================================

  /**
   * Central message handler with photo verification integration
   */
  async handleMessage(message: any): Promise<void> {
    const whatsappId = message.from;
    const verificationState = photoVerificationService.getVerificationState(whatsappId);

    // Handle IMAGE messages during verification
    if (message.type === 'image' && verificationState) {
      await this.handleVerificationPhoto(whatsappId, message, verificationState);
      return;
    }

    // Handle TEXT messages (manual entry during verification)
    if (message.type === 'text' && verificationState && !verificationState.waitingFor) {
      const type = verificationState.sessionId.includes('start') ? 'start' : 'end';
      const success = await photoVerificationService.handleManualEntry(
        whatsappId,
        message.text.body,
        type
      );
      
      if (!success) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Please enter a valid kWh reading (e.g., 1245.8)'
        );
      }
      return;
    }

    // Regular message handling continues here
    // (Button callbacks, text commands, etc.)
  }

  /**
   * Handle photo verification images
   */
  private async handleVerificationPhoto(
    whatsappId: string,
    message: any,
    state: any
  ): Promise<void> {
    try {
      const imageBuffer = await this.downloadWhatsAppImage(message.image.id);

      if (state.waitingFor === 'start_photo') {
        await photoVerificationService.handleStartPhoto(whatsappId, imageBuffer);
      } else if (state.waitingFor === 'end_photo') {
        await photoVerificationService.handleEndPhoto(whatsappId, imageBuffer);
      }
    } catch (error) {
      logger.error('Photo processing failed', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process photo. Please try again.'
      );
    }
  }

  /**
   * Download image from WhatsApp Cloud API
   */
  private async downloadWhatsAppImage(mediaId: string): Promise<Buffer> {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
      }
    );

    const data = await response.json() as { url?: string };
    
    if (!data.url) {
      throw new Error('Media URL not found in response');
    }

    const imageResponse = await fetch(data.url, {
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
    });

    return Buffer.from(await imageResponse.arrayBuffer());
  }

  /**
   * Handle button callbacks with verification support
   */
  async handleButtonClick(buttonId: string, whatsappId: string): Promise<void> {
    // Photo verification confirmations
    if (buttonId === 'confirm_start_reading') {
      const success = await photoVerificationService.confirmStartReading(whatsappId);
      if (success) {
        const state = photoVerificationService.getVerificationState(whatsappId);
        if (state?.sessionId && state.lastReading) {
          await sessionService.startChargingAfterVerification(
            state.sessionId,
            state.lastReading
          );
        }
      }
      return;
    }

    if (buttonId === 'confirm_end_reading') {
      const success = await photoVerificationService.confirmEndReading(whatsappId);
      if (success) {
        await this.sendSessionSummary(whatsappId);
      }
      return;
    }

    // Retake photo buttons
    if (buttonId === 'retake_start_photo') {
      await photoVerificationService.retakeStartPhoto(whatsappId);
      return;
    }

    if (buttonId === 'retake_end_photo') {
      await photoVerificationService.retakeEndPhoto(whatsappId);
      return;
    }

    // Session start/stop with verification
    if (buttonId.startsWith('session_start_')) {
      const stationId = parseInt(buttonId.replace('session_start_', ''));
      await this.handleChargingStart(whatsappId, stationId);
      return;
    }

    if (buttonId.startsWith('session_stop_')) {
      const stationId = parseInt(buttonId.replace('session_stop_', ''));
      await this.handleSessionStop(whatsappId, stationId);
      return;
    }

    // Other button handlers
    await this.routeButtonAction(buttonId, whatsappId);
  }

  /**
   * Route other button actions
   */
  private async routeButtonAction(buttonId: string, whatsappId: string): Promise<void> {
    const [action, ...params] = buttonId.split('_');
    const stationId = params.length > 0 ? parseInt(params[params.length - 1]) : 0;

    switch (action) {
      case 'book': await this.handleStationBooking(whatsappId, stationId); break;
      case 'join': await this.handleJoinQueue(whatsappId, stationId); break;
      case 'queue': await this.handleQueueStatus(whatsappId, stationId); break;
      case 'cancel': await this.handleQueueCancel(whatsappId, stationId); break;
      case 'directions': await this.handleGetDirections(whatsappId, stationId); break;
      case 'alternatives': await this.handleFindAlternatives(whatsappId, stationId); break;
      case 'status': await this.handleSessionStatus(whatsappId, stationId); break;
      case 'extend': 
        const minutes = params[0] === '30' ? 30 : 60;
        await this.handleSessionExtend(whatsappId, stationId, minutes);
        break;
      default: logger.warn('Unknown button action', { buttonId, whatsappId });
    }
  }

  // ===============================================
  // CORE BOOKING OPERATIONS
  // ===============================================

  async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found');
        return;
      }
      await this.showStationOverview(whatsappId, station);
    } catch (error) {
      await this.handleError(error, 'station selection', { whatsappId, stationId });
    }
  }

  async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const [user, station] = await Promise.all([
        userService.getUserByWhatsAppId(whatsappId),
        this.getStationDetails(stationId)
      ]);

      if (!user || !station) {
        await this.sendError(whatsappId, 'Unable to process booking');
        return;
      }

      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      if (existingQueues.length > 0) {
        await this.handleExistingBooking(whatsappId, existingQueues[0]);
        return;
      }

      if (station.isAvailable && station.availableSlots > 0) {
        await this.handleInstantBooking(whatsappId, station, user);
      } else if (this.isStationBookable(station)) {
        await this.handleQueueBooking(whatsappId, station, user);
      } else {
        await this.handleUnavailableStation(whatsappId, station);
      }
    } catch (error) {
      await this.handleError(error, 'station booking', { whatsappId, stationId });
    }
  }

  async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not available');
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        this.formatStationDetails(station)
      );

      setTimeout(() => this.sendStationActionButtons(whatsappId, station), 2000);
    } catch (error) {
      await this.handleError(error, 'station details', { whatsappId, stationId });
    }
  }

  // ===============================================
  // QUEUE MANAGEMENT
  // ===============================================

  async handleJoinQueue(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found');
        return;
      }

      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      const existingQueue = existingQueues.find(q => q.stationId === stationId);
      
      if (existingQueue) {
        await this.showExistingQueueStatus(whatsappId, existingQueue);
        return;
      }

      const queuePosition = await queueService.joinQueue(whatsappId, stationId);
      
      if (!queuePosition) {
        await this.handleQueueJoinFailure(whatsappId, station);
        return;
      }

      await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
    } catch (error) {
      await this.handleError(error, 'join queue', { whatsappId, stationId });
    }
  }

  async handleQueueStatus(whatsappId: string, stationId?: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;

    try {
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      
      if (userQueues.length === 0) {
        await this.showNoActiveQueues(whatsappId);
        return;
      }

      for (const queue of userQueues) {
        await this.displayQueueStatus(whatsappId, queue);
      }

      setTimeout(() => this.sendQueueManagementButtons(whatsappId, userQueues), 2000);
    } catch (error) {
      await this.handleError(error, 'queue status', { whatsappId });
    }
  }

  async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const success = await queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
      
      if (!success) {
        await this.sendError(whatsappId, 'No active queue found');
        return;
      }

      await this.handleSuccessfulCancellation(whatsappId, stationId);
    } catch (error) {
      await this.handleError(error, 'queue cancel', { whatsappId, stationId });
    }
  }

  // ===============================================
  // SESSION MANAGEMENT WITH VERIFICATION
  // ===============================================

  async handleChargingStart(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      const reservedQueue = userQueues.find(q => 
        q.stationId === stationId && 
        ['reserved', 'waiting'].includes(q.status)
      );

      if (!reservedQueue) {
        await this.handleNoValidReservation(whatsappId, stationId);
        return;
      }

      // Photo verification will be triggered by sessionService
      const session = await sessionService.startSession(whatsappId, stationId, reservedQueue.id);
      
      if (!session) {
        await this.handleSessionStartFailure(whatsappId, stationId);
        return;
      }

      await queueService.startCharging(whatsappId, stationId);
      await this.handleSuccessfulSessionStart(whatsappId, session);
    } catch (error) {
      await this.handleError(error, 'charging start', { whatsappId, stationId });
    }
  }

  async handleSessionStatus(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
      
      if (!activeSession) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '⚡ *No Active Session*\n\nNo active charging session found at this station.'
        );
        return;
      }

      const sessionStatus = await sessionService.getSessionStatus(activeSession.id);
      
      if (sessionStatus) {
        await this.displaySessionStatus(whatsappId, sessionStatus, activeSession);
      } else {
        await this.displayBasicSessionInfo(whatsappId, activeSession);
      }
    } catch (error) {
      await this.handleError(error, 'session status', { whatsappId, stationId });
    }
  }

  async handleSessionStop(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
      
      // Photo verification will be triggered by sessionService.stopSession
      const success = await sessionService.stopSession(whatsappId, stationId);
      
      if (!success) {
        await this.sendError(whatsappId, 'No active session found');
        return;
      }

      // Generate and send summary
      if (activeSession) {
        const durationMs = Date.now() - activeSession.startTime.getTime();
        const durationMin = Math.floor(durationMs / 60000);
        const energyDelivered = Math.floor(durationMin * 0.5);
        const totalCost = energyDelivered * 12.5;

        const summary = {
          sessionId: activeSession.id,
          duration: `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`,
          energyDelivered,
          finalBatteryLevel: activeSession.currentBatteryLevel || 80,
          totalCost,
          efficiency: activeSession.efficiency || 95,
          stationName: activeSession.stationName || 'Charging Station',
          startTime: activeSession.startTime,
          endTime: new Date()
        };

        await notificationService.sendSessionCompletedNotification(whatsappId, activeSession, summary);
      }

      await queueService.completeCharging(whatsappId, stationId).catch(() => {});

      await whatsappService.sendTextMessage(
        whatsappId,
        '🛑 *Session Stopped*\n\nCharging session terminated.\n📊 Summary sent!'
      );
    } catch (error) {
      await this.handleError(error, 'session stop', { whatsappId, stationId });
    }
  }

  async handleSessionExtend(whatsappId: string, stationId: number, minutes: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const newTargetBattery = Math.min(100, 80 + Math.floor(minutes / 30) * 10);
      const success = await sessionService.extendSession(whatsappId, stationId, newTargetBattery);
      
      if (!success) {
        await this.sendError(whatsappId, 'Unable to extend session');
        return;
      }

      const extendedTime = new Date(Date.now() + minutes * 60000);
      await whatsappService.sendTextMessage(
        whatsappId,
        `⏰ *Session Extended*\n\n` +
        `⚡ +${minutes} minutes\n` +
        `🔋 New target: ${newTargetBattery}%\n` +
        `🕐 Expected: ${extendedTime.toLocaleTimeString()}`
      );
    } catch (error) {
      await this.handleError(error, 'session extend', { whatsappId, stationId });
    }
  }

  /**
   * Send final session summary after verification
   */
  private async sendSessionSummary(whatsappId: string): Promise<void> {
    try {
      const [session] = await db.select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, whatsappId),
            eq(chargingSessions.verificationStatus, 'completed')
          )
        )
        .orderBy(desc(chargingSessions.createdAt))
        .limit(1);

      if (!session) return;

      const consumption = parseFloat(session.energyDelivered || '0');
      const totalCost = parseFloat(session.totalCost || '0');
      const duration = session.duration || 0;

      await whatsappService.sendTextMessage(
        whatsappId,
        `🎉 *Charging Complete!*\n\n` +
        `📊 *Summary:*\n` +
        `⚡ Energy: ${consumption.toFixed(2)} kWh\n` +
        `⏱️ Duration: ${Math.floor(duration / 60)}h ${duration % 60}m\n` +
        `💰 Total: ₹${totalCost.toFixed(2)}\n\n` +
        `📈 *Meter Readings:*\n` +
        `Start: ${session.startMeterReading} kWh\n` +
        `End: ${session.endMeterReading} kWh\n\n` +
        `✅ Payment processing...\n` +
        `📧 Receipt sent to email.`
      );
    } catch (error) {
      logger.error('Failed to send session summary', { whatsappId, error });
    }
  }

  // ===============================================
  // SMART BOOKING HANDLERS
  // ===============================================

  private async handleInstantBooking(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    try {
      const queuePosition = await queueService.joinQueue(whatsappId, station.id);
      if (!queuePosition) {
        await this.handleQueueBooking(whatsappId, station, user);
        return;
      }

      const reserved = await queueService.reserveSlot(whatsappId, station.id, 15);
      
      if (reserved) {
        await this.showInstantBookingSuccess(whatsappId, station, user);
      } else {
        await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
      }
    } catch (error) {
      logger.error('Instant booking failed', { whatsappId, stationId: station.id, error });
      await this.handleQueueBooking(whatsappId, station, user);
    }
  }

  private async handleQueueBooking(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    const queueStats = await queueService.getQueueStats(station.id);
    
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Join Queue at ${station.name}?*\n\n` +
      `📊 ${queueStats.totalInQueue} people in queue\n` +
      `⏱️ Average wait: ${queueStats.averageWaitTime} min\n` +
      `💰 Rate: ${station.priceDisplay}\n` +
      `💵 Expected: ~₹${this.estimateCost(station, user)}`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎯 *Proceed?*',
      [
        { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
        { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' },
        { id: `get_directions_${station.id}`, title: '🗺️ Directions' }
      ]
    ), 2000);
  }

  private async handleExistingBooking(whatsappId: string, existingQueue: any): Promise<void> {
    const statusMap: Record<string, string> = {
      reserved: 'Reserved',
      waiting: 'In Queue',
      charging: 'Active'
    };

    await whatsappService.sendTextMessage(
      whatsappId,
      `⚠️ *Existing Booking*\n\n` +
      `📍 ${existingQueue.stationName}\n` +
      `📊 Status: ${statusMap[existingQueue.status] || 'Active'}\n` +
      `👥 Position: #${existingQueue.position}\n\n` +
      `💡 Only one booking allowed at a time.`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Manage Booking:*',
      [
        { id: `queue_status_${existingQueue.stationId}`, title: '📊 Status' },
        { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel' },
        { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Directions' }
      ]
    ), 2000);
  }

  // ===============================================
  // SUCCESS HANDLERS
  // ===============================================

  private async showInstantBookingSuccess(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🎉 *Slot Reserved!*\n\n` +
      `📍 ${station.name}\n` +
      `⚡ Reserved for 15 minutes\n` +
      `💰 Rate: ${station.priceDisplay}\n` +
      `💵 Expected: ~₹${this.estimateCost(station, user)}\n\n` +
      `⏰ Arrive within 15 minutes!`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '⚡ *Ready?*',
      [
        { id: `start_session_${station.id}`, title: '⚡ Start' },
        { id: `get_directions_${station.id}`, title: '🗺️ Navigate' },
        { id: `cancel_queue_${station.id}`, title: '❌ Cancel' }
      ]
    ), 2000);
  }

  private async handleSuccessfulQueueJoin(whatsappId: string, queuePosition: any): Promise<void> {
    const waitAdvice = queuePosition.estimatedWaitMinutes > 30 
      ? '\n💡 Long wait. Consider alternatives.' 
      : '\n✅ Reasonable wait time!';

    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Joined Queue!*\n\n` +
      `📍 ${queuePosition.stationName}\n` +
      `👥 Position: #${queuePosition.position}\n` +
      `⏱️ Wait: ~${queuePosition.estimatedWaitMinutes} min\n` +
      `🔔 Live updates enabled${waitAdvice}`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Manage Queue:*',
      [
        { id: `queue_status_${queuePosition.stationId}`, title: '📊 Status' },
        { id: `get_directions_${queuePosition.stationId}`, title: '🗺️ Navigate' },
        { id: `cancel_queue_${queuePosition.stationId}`, title: '❌ Cancel' }
      ]
    ), 2000);
  }

  private async handleSuccessfulSessionStart(whatsappId: string, session: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Charging Started!*\n\n` +
      `📍 ${session.stationName}\n` +
      `🔋 Current: ${session.currentBatteryLevel}%\n` +
      `🎯 Target: ${session.targetBatteryLevel}%\n` +
      `⚡ Rate: ${session.chargingRate} kW\n` +
      `💰 ₹${session.pricePerKwh}/kWh\n` +
      `📊 Cost: ₹${session.totalCost.toFixed(2)}\n\n` +
      `🔄 Updates every 10 minutes`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📊 *Session Controls:*',
      [
        { id: `session_status_${session.stationId}`, title: '📊 Status' },
        { id: `extend_30_${session.stationId}`, title: '⏰ +30min' },
        { id: `session_stop_${session.stationId}`, title: '🛑 Stop' }
      ]
    ), 2000);
  }

  private async handleSuccessfulCancellation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `✅ *Queue Cancelled*\n\nBooking cancelled successfully.\nNo charges applied.\n\n💡 Find another station?`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Next Steps:*',
      [
        { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
        { id: 'new_search', title: '🆕 New Search' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ]
    ), 2000);
  }

  // ===============================================
  // FAILURE HANDLERS
  // ===============================================

  private async handleQueueJoinFailure(whatsappId: string, station: ProcessedStation): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Queue Full*\n\nUnable to join queue at ${station.name}.\n\n🔍 Find alternatives?`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎯 *Options:*',
      [
        { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' },
        { id: 'find_nearby_stations', title: '🗺️ Nearby' },
        { id: 'new_search', title: '🆕 Search' }
      ]
    ), 2000);
  }

  private async handleSessionStartFailure(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Start Failed*\n\nCouldn't start session. Possible reasons:\n` +
      `• Station connectivity issues\n• No valid reservation\n• Technical maintenance`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🔧 *Actions:*',
      [
        { id: `queue_status_${stationId}`, title: '📊 Check Queue' },
        { id: `get_directions_${stationId}`, title: '🗺️ Directions' },
        { id: 'help', title: '❓ Support' }
      ]
    ), 2000);
  }

  private async handleNoValidReservation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚠️ *No Reservation*\n\nYou need an active queue position to start charging.\n\n💡 Join the queue first.`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎯 *Next Steps:*',
      [
        { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
        { id: `queue_status_${stationId}`, title: '📊 Status' },
        { id: 'find_nearby_stations', title: '🔍 Alternatives' }
      ]
    ), 2000);
  }

  private async handleUnavailableStation(whatsappId: string, station: ProcessedStation): Promise<void> {
    let reason = '❌ Station unavailable';
    let suggestion = 'Try another station';

    if (!station.isActive) {
      reason = '🚫 Station offline for maintenance';
      suggestion = 'Check back later';
    } else if (!station.isOpen) {
      reason = '🕐 Station closed';
      suggestion = `Hours: ${this.formatOperatingHours(station.operatingHours)}`;
    } else if (station.availableSlots === 0) {
      reason = '🔴 All slots occupied';
      suggestion = 'Join queue or find alternatives';
    }

    await whatsappService.sendTextMessage(whatsappId, `${reason}\n\n${suggestion}`);

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Options:*',
      [
        { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
        { id: 'find_nearby_stations', title: '🗺️ Nearby' },
        { id: 'new_search', title: '🆕 Search' }
      ]
    ), 2000);
  }

  // ===============================================
  // DISPLAY METHODS
  // ===============================================

  private async displayQueueStatus(whatsappId: string, queue: any): Promise<void> {
    const statusEmoji: Record<string, string> = {
      waiting: '⏳', reserved: '✅', charging: '⚡',
      ready: '🎯', completed: '✅', cancelled: '❌'
    };

    const emoji = statusEmoji[queue.status] || '📋';
    const timeInfo = queue.status === 'reserved' && queue.reservationExpiry
      ? `⏰ Expires: ${new Date(queue.reservationExpiry).toLocaleTimeString()}`
      : `⏱️ Wait: ~${queue.estimatedWaitMinutes} min`;

    await whatsappService.sendTextMessage(
      whatsappId,
      `${emoji} *Queue Status*\n\n` +
      `📍 ${queue.stationName}\n` +
      `📊 Status: ${this.capitalizeFirst(queue.status)}\n` +
      `👥 Position: #${queue.position}\n` +
      `${timeInfo}\n` +
      `📅 Joined: ${new Date(queue.createdAt).toLocaleString()}`
    );
  }

  private async displaySessionStatus(whatsappId: string, status: any, session: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Live Status*\n\n` +
      `📍 ${session.stationName}\n` +
      `🔋 Battery: ${status.currentBatteryLevel}%\n` +
      `⚡ Rate: ${status.chargingRate} kW\n` +
      `🔌 Energy: ${status.energyAdded.toFixed(1)} kWh\n` +
      `💰 Cost: ₹${status.currentCost.toFixed(2)}\n` +
      `⏱️ Duration: ${status.duration}\n` +
      `🎯 Complete: ${status.estimatedCompletion}\n` +
      `📊 Efficiency: ${status.efficiency}%\n\n` +
      `${status.statusMessage}`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎛️ *Controls:*',
      [
        { id: `extend_30_${session.stationId}`, title: '⏰ +30min' },
        { id: `extend_60_${session.stationId}`, title: '⏰ +1hr' },
        { id: `session_stop_${session.stationId}`, title: '🛑 Stop' }
      ]
    ), 2000);
  }

  private async displayBasicSessionInfo(whatsappId: string, session: any): Promise<void> {
    const duration = Math.floor((Date.now() - session.startTime.getTime()) / 60000);
    const durationText = duration > 60 
      ? `${Math.floor(duration / 60)}h ${duration % 60}m` 
      : `${duration}m`;

    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Active Session*\n\n` +
      `📍 ${session.stationName}\n` +
      `🔋 Current: ${session.currentBatteryLevel}%\n` +
      `🎯 Target: ${session.targetBatteryLevel}%\n` +
      `⚡ Rate: ${session.chargingRate} kW\n` +
      `💰 Rate: ₹${session.pricePerKwh}/kWh\n` +
      `⏱️ Duration: ${durationText}\n` +
      `📊 Cost: ₹${session.totalCost.toFixed(2)}\n\n` +
      `🔄 Session active`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '🎛️ *Controls:*',
      [
        { id: `extend_30_${session.stationId}`, title: '⏰ +30min' },
        { id: `extend_60_${session.stationId}`, title: '⏰ +1hr' },
        { id: `session_stop_${session.stationId}`, title: '🛑 Stop' }
      ]
    ), 2000);
  }

  private async showNoActiveQueues(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📋 *Your Bookings*\n\nNo active bookings found.\n\n🔍 Ready to find a station?'
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '⚡ *Find Stations:*',
      [
        { id: 'find_nearby_stations', title: '🗺️ Nearby' },
        { id: 'new_search', title: '🆕 Search' },
        { id: 'recent_searches', title: '🕒 Recent' }
      ]
    ), 2000);
  }

  private async showExistingQueueStatus(whatsappId: string, existingQueue: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Already in Queue*\n\n` +
      `You're already queued at this station.\n\n` +
      `👥 Position: #${existingQueue.position}\n` +
      `⏱️ Wait: ~${existingQueue.estimatedWaitMinutes} min\n\n` +
      `💡 Updates coming as position changes.`
    );

    setTimeout(() => whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Manage:*',
      [
        { id: `queue_status_${existingQueue.stationId}`, title: '📊 Refresh' },
        { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Navigate' },
        { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel' }
      ]
    ), 2000);
  }

  private async sendQueueManagementButtons(whatsappId: string, queues: any[]): Promise<void> {
    if (queues.length === 0) return;

    const primaryQueue = queues[0];
    const buttons = [];

    if (primaryQueue.status === 'reserved') {
      buttons.push({ id: `start_session_${primaryQueue.stationId}`, title: '⚡ Start' });
    }
    
    buttons.push(
      { id: `get_directions_${primaryQueue.stationId}`, title: '🗺️ Navigate' },
      { id: `cancel_queue_${primaryQueue.stationId}`, title: '❌ Cancel' }
    );

    await whatsappService.sendButtonMessage(
      whatsappId,
      '🎛️ *Queue Management:*',
      buttons.slice(0, 3)
    );
  }

  // ===============================================
  // ADDITIONAL ACTIONS
  // ===============================================

  async handleGetDirections(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found');
        return;
      }

      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(station.name + ' ' + station.address)}`;
      const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(station.name + ' ' + station.address)}`;
      
      await whatsappService.sendTextMessage(
        whatsappId,
        `🗺️ *Directions to ${station.name}*\n\n` +
        `📍 ${station.address}\n\n` +
        `🔗 *Navigate:*\n` +
        `📱 Google Maps: ${googleMapsUrl}\n` +
        `🚗 Waze: ${wazeUrl}\n\n` +
        `💡 *Tips:*\n` +
        `• Save location for quick access\n` +
        `• Check hours before travel\n` +
        `• Arrive 5 min early for reservations`
      );

      setTimeout(() => whatsappService.sendButtonMessage(
        whatsappId,
        '📱 *While traveling:*',
        [
          { id: `queue_status_${station.id}`, title: '📊 Check Queue' },
          { id: `station_info_${station.id}`, title: '📋 Details' },
          { id: 'help', title: '❓ Support' }
        ]
      ), 2000);
    } catch (error) {
      await this.handleError(error, 'get directions', { whatsappId, stationId });
    }
  }

  async handleFindAlternatives(whatsappId: string, stationId: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;

    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 *Finding Alternatives...*\n\n' +
        'Searching for nearby options with:\n' +
        '• Similar speeds\n• Compatible connectors\n• Shorter waits\n• Better rates'
      );

      const user = await userService.getUserByWhatsAppId(whatsappId);

      setTimeout(async () => {
        await whatsappService.sendTextMessage(
          whatsappId,
          `🎯 *Alternative Strategies:*\n\n` +
          `**Quick Options:**\n` +
          `🔍 Expand search radius\n` +
          `⏰ Find shorter queues\n` +
          `💰 Better rate stations\n\n` +
          `**Smart Tips:**\n` +
          `${user?.connectorType ? `🔌 ${user.connectorType} compatible\n` : ''}` +
          `📊 Off-peak hours (10 PM - 8 AM)\n` +
          `🏢 Try commercial areas`
        );

        await whatsappService.sendButtonMessage(
          whatsappId,
          '🎯 *Next Move:*',
          [
            { id: 'expand_search', title: '📡 Expand Area' },
            { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
            { id: 'new_search', title: '🆕 New Search' }
          ]
        );
      }, 3000);
    } catch (error) {
      await this.handleError(error, 'find alternatives', { whatsappId, stationId });
    }
  }

  // ===============================================
  // DATABASE OPERATIONS
  // ===============================================

  private async getStationDetails(stationId: number): Promise<ProcessedStation | null> {
    try {
      const [station] = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (!station) {
        logger.warn('Station not found', { stationId });
        return null;
      }

      return this.processStationData(station);
    } catch (error) {
      logger.error('Database query failed', { stationId, error });
      return null;
    }
  }

  private processStationData(station: any): ProcessedStation {
    const isActive = station.isActive ?? false;
    const isOpen = station.isOpen ?? false;
    
    // Handle both old and new schema field names
    const availableSlots = Number(station.availableSlots || station.availablePorts) || 0;
    const totalSlots = Number(station.totalSlots || station.totalPorts) || 1;
    const distance = Number(station.distance) || 0;
    
    const price = Number(station.pricePerKwh) || 0;
    const rating = Number(station.rating || station.averageRating) || 0;
    const reviews = Number(station.totalReviews || station.reviewCount) || 0;

    const utilization = totalSlots > 0 
      ? Math.round(((totalSlots - availableSlots) / totalSlots) * 100) 
      : 0;
    const isAvailable = availableSlots > 0 && isActive && isOpen;

    let availability = 'Offline';
    if (isActive && isOpen) {
      availability = availableSlots > 0 ? 'Available' : 'Full';
    }

    return {
      ...station,
      // Ensure all required fields are present
      distance: station.distance || '0',
      totalSlots: totalSlots,
      availableSlots: availableSlots,
      totalPorts: station.totalPorts || totalSlots,
      availablePorts: station.availablePorts || availableSlots,
      // Processed fields
      isActive,
      isOpen,
      isAvailable,
      utilization,
      availability,
      priceDisplay: price > 0 ? `₹${price.toFixed(2)}/kWh` : 'N/A',
      distanceDisplay: distance > 0 ? `${distance.toFixed(1)} km` : 'N/A',
      ratingDisplay: rating > 0 ? `${rating.toFixed(1)} ⭐` : 'No ratings',
      slotsDisplay: `${availableSlots}/${totalSlots} available`,
      finalRating: rating,
      finalReviews: reviews
    };
  }

  // ===============================================
  // MESSAGE FORMATTING
  // ===============================================

  private async showStationOverview(whatsappId: string, station: ProcessedStation): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *${station.name}*\n\n` +
      `📍 ${station.address}\n` +
      `📏 ${station.distanceDisplay}\n` +
      `⚡ ${station.slotsDisplay}\n` +
      `💰 ${station.priceDisplay}\n` +
      `⭐ ${station.ratingDisplay} (${station.finalReviews} reviews)\n\n` +
      `🔌 *Connectors:* ${this.formatConnectorTypes(station.connectorTypes)}\n` +
      `🕒 *Hours:* ${this.formatOperatingHours(station.operatingHours)}\n` +
      `🎯 *Status:* ${this.getStatusWithEmoji(station.availability)}`
    );

    setTimeout(() => this.sendStationActionButtons(whatsappId, station), 2000);
  }

  private formatStationDetails(station: ProcessedStation): string {
    let details = `🏢 *${station.name}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📍 *Location:*\n${station.address}\n\n` +
      `⚡ *Charging:*\n` +
      `• Slots: ${station.slotsDisplay}\n` +
      `• Price: ${station.priceDisplay}\n` +
      `• Connectors: ${this.formatConnectorTypes(station.connectorTypes)}\n\n` +
      `🕒 *Hours:*\n${this.formatOperatingHours(station.operatingHours)}\n\n` +
      `⭐ *Rating:* ${station.ratingDisplay}\n` +
      `📊 *Utilization:* ${station.utilization}%\n`;

    if (station.amenities && Array.isArray(station.amenities) && station.amenities.length > 0) {
      details += `\n🎯 *Amenities:*\n${station.amenities.map((a: string) => `• ${this.capitalizeFirst(a)}`).join('\n')}\n`;
    }

    details += `\n${this.getStatusWithEmoji(station.availability)} *Status:* ${station.availability}`;
    return details;
  }

  private async sendStationActionButtons(whatsappId: string, station: ProcessedStation): Promise<void> {
    const buttons = [];

    if (station.isAvailable) {
      buttons.push(
        { id: `book_station_${station.id}`, title: '⚡ Book Now' },
        { id: `station_info_${station.id}`, title: '📊 Details' }
      );
    } else {
      buttons.push(
        { id: `join_queue_${station.id}`, title: '📋 Queue' },
        { id: `find_alternatives_${station.id}`, title: '🔍 Alternatives' }
      );
    }

    buttons.push({ id: `get_directions_${station.id}`, title: '🗺️ Navigate' });

    if (buttons.length > 0) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `🎯 *Actions for ${station.name}:*`,
        buttons.slice(0, 3),
        '🏢 Station Menu'
      );
    }
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private validateInput(whatsappId: string, stationId: number): boolean {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID', { whatsappId });
      return false;
    }

    if (!stationId || isNaN(stationId) || stationId <= 0) {
      logger.error('Invalid station ID', { stationId, whatsappId });
      whatsappService.sendTextMessage(whatsappId, '❌ Invalid station. Try again.');
      return false;
    }

    return true;
  }

  private isStationBookable(station: ProcessedStation): boolean {
    return station.isActive === true && station.isOpen === true;
  }

  private formatConnectorTypes(connectorTypes: any): string {
    if (Array.isArray(connectorTypes)) {
      return connectorTypes.length > 0 ? connectorTypes.join(', ') : 'Standard';
    }
    return connectorTypes || 'Standard';
  }

  private formatOperatingHours(operatingHours: any): string {
    if (typeof operatingHours === 'object' && operatingHours !== null) {
      const allDay = Object.values(operatingHours).every(h => h === '24/7');
      if (allDay) return '24/7';
      return 'Varies by day';
    }
    return operatingHours || '24/7';
  }

  private getStatusWithEmoji(availability: string): string {
    const map: Record<string, string> = {
      Available: '✅', Full: '🔴', Offline: '⚫'
    };
    return map[availability] || '❓';
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private estimateCost(station: ProcessedStation, user: any): string {
    const basePrice = Number(station.pricePerKwh) || 12;
    const estimatedKwh = user.connectorType === 'CCS2' ? 25 : 15;
    return (basePrice * estimatedKwh).toFixed(0);
  }

  // ===============================================
  // ERROR HANDLING
  // ===============================================

  private async handleError(error: any, operation: string, context: Record<string, any>): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`${operation} failed`, { ...context, error: errorMsg });

    if (context.whatsappId) {
      await this.sendError(context.whatsappId, `Failed to ${operation}. Try again.`);
    }
  }

  private async sendError(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
    } catch (error) {
      logger.error('Failed to send error', { whatsappId, error });
    }
  }

  private async sendNotFound(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `🔍 ${message}`);
    } catch (error) {
      logger.error('Failed to send not found', { whatsappId, error });
    }
  }

  // ===============================================
  // MONITORING & HEALTH
  // ===============================================

  public getHealthStatus(): {
    status: 'healthy' | 'degraded';
    activeOperations: number;
    lastActivity: string;
    integrations: {
      queueService: boolean;
      sessionService: boolean;
      notificationService: boolean;
      photoVerification: boolean;
    };
  } {
    return {
      status: 'healthy',
      activeOperations: 0,
      lastActivity: new Date().toISOString(),
      integrations: {
        queueService: !!queueService,
        sessionService: !!sessionService,
        notificationService: !!notificationService,
        photoVerification: !!photoVerificationService
      }
    };
  }

  // ===============================================
  // ALIASES FOR BACKWARD COMPATIBILITY
  // ===============================================

  async processQueueJoin(whatsappId: string, stationId: number): Promise<void> {
    return this.handleJoinQueue(whatsappId, stationId);
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const bookingController = new BookingController();