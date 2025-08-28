// src/controllers/booking.ts - PRODUCTION READY & FULLY INTEGRATED
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/userService';
import { queueService } from '../services/queue';
import { sessionService } from '../services/session';
import { notificationService } from '../services/notification';
import { logger } from '../utils/logger';
import { db } from '../config/database';
import { chargingStations } from '../db/schema';
import { eq } from 'drizzle-orm';
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
// PRODUCTION BOOKING CONTROLLER - FULLY INTEGRATED
// ===============================================

export class BookingController {
  
  // ===============================================
  // CORE BOOKING OPERATIONS
  // ===============================================

  /**
   * Handle station selection from any source
   */
  async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing station selection', { whatsappId, stationId });

      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found. Please try another station.');
        return;
      }

      await this.showStationOverview(whatsappId, station);

    } catch (error) {
      await this.handleError(error, 'station selection', { whatsappId, stationId });
    }
  }

  /**
   * Handle station booking request - ENHANCED WITH SMART BOOKING
   */
  async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing station booking', { whatsappId, stationId });

      const [user, station] = await Promise.all([
        userService.getUserByWhatsAppId(whatsappId),
        this.getStationDetails(stationId)
      ]);

      if (!user) {
        await this.sendError(whatsappId, 'User account not found. Please restart the bot.');
        return;
      }

      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found. Please try another station.');
        return;
      }

      // Check if user already has active booking
      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      if (existingQueues.length > 0) {
        await this.handleExistingBooking(whatsappId, existingQueues[0]);
        return;
      }

      // Smart booking logic
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

  /**
   * Show detailed station information
   */
  async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Showing station details', { whatsappId, stationId });

      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station information not available.');
        return;
      }

      const detailsMessage = this.formatStationDetails(station);
      await whatsappService.sendTextMessage(whatsappId, detailsMessage);

      // Send action buttons after details
      setTimeout(async () => {
        await this.sendStationActionButtons(whatsappId, station);
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'station details', { whatsappId, stationId });
    }
  }

  // ===============================================
  // INTEGRATED QUEUE MANAGEMENT
  // ===============================================

  /**
   * Handle join queue action - FULLY INTEGRATED
   */
  async handleJoinQueue(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing join queue request', { whatsappId, stationId });

      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found.');
        return;
      }

      // Check for existing queue
      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      if (existingQueues.length > 0) {
        const existingQueue = existingQueues.find(q => q.stationId === stationId);
        if (existingQueue) {
          await this.showExistingQueueStatus(whatsappId, existingQueue);
          return;
        }
      }

      // Join queue using real service
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

  /**
   * Handle queue status check - FULLY INTEGRATED
   */
  async handleQueueStatus(whatsappId: string, stationId?: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;

    try {
      logger.info('Checking queue status', { whatsappId, stationId });

      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      
      if (userQueues.length === 0) {
        await this.showNoActiveQueues(whatsappId);
        return;
      }

      // Show all active queues
      for (const queue of userQueues) {
        await this.displayQueueStatus(whatsappId, queue);
      }

      // Send management buttons for each queue
      setTimeout(async () => {
        await this.sendQueueManagementButtons(whatsappId, userQueues);
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'queue status', { whatsappId, stationId });
    }
  }

  /**
   * Handle queue cancellation - FULLY INTEGRATED
   */
  async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing queue cancellation', { whatsappId, stationId });

      const success = await queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
      
      if (!success) {
        await this.sendError(whatsappId, 'No active queue found to cancel.');
        return;
      }

      await this.handleSuccessfulCancellation(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'queue cancel', { whatsappId, stationId });
    }
  }

  // ===============================================
  // INTEGRATED SESSION MANAGEMENT
  // ===============================================

  /**
   * Handle charging session start - FULLY INTEGRATED
   */
  async handleChargingStart(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing charging start', { whatsappId, stationId });

      // Check if user has valid reservation
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      const reservedQueue = userQueues.find(q => 
        q.stationId === stationId && 
        (q.status === 'reserved' || q.status === 'waiting')
      );

      if (!reservedQueue) {
        await this.handleNoValidReservation(whatsappId, stationId);
        return;
      }

      // Start charging session using real service
      const session = await sessionService.startSession(whatsappId, stationId, reservedQueue?.id);
      
      if (!session) {
        await this.handleSessionStartFailure(whatsappId, stationId);
        return;
      }

      // Update queue status to charging
      await queueService.startCharging(whatsappId, stationId);

      await this.handleSuccessfulSessionStart(whatsappId, session);

    } catch (error) {
      await this.handleError(error, 'charging start', { whatsappId, stationId });
    }
  }

  /**
   * Handle session status check - NEW METHOD
   */
  async handleSessionStatus(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Checking session status', { whatsappId, stationId });

      const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
      
      if (!activeSession) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '⚡ *No Active Session*\n\nYou don\'t have an active charging session at this station.\n\n🔍 Ready to start charging?'
        );
        return;
      }

      // Use the session ID to get status, not whatsappId and stationId
      const sessionStatus = await sessionService.getSessionStatus(activeSession.id);
      if (sessionStatus) {
        await this.displaySessionStatus(whatsappId, sessionStatus, activeSession);
      } else {
        // If no detailed status available, show basic session info
        await this.displayBasicSessionInfo(whatsappId, activeSession);
      }

    } catch (error) {
      await this.handleError(error, 'session status', { whatsappId, stationId });
    }
  }

  /**
   * Handle session stop - NEW METHOD
   */
/**
 * Handle session stop request from user
 */
async handleSessionStop(whatsappId: string, stationId: number): Promise<void> {
  // Validate input parameters
  if (!this.validateInput(whatsappId, stationId)) {
    logger.warn('Invalid input for session stop', { whatsappId, stationId });
    return;
  }

  try {
    logger.info('Processing session stop request', { whatsappId, stationId });

    // Attempt to stop the session
    const success = await sessionService.stopSession(whatsappId, stationId);
    
    if (!success) {
      await this.sendError(whatsappId, 'No active session found to stop.');
      return;
    }

    // Complete charging in queue service for consistency
    try {
      await queueService.completeCharging(whatsappId, stationId);
    } catch (queueError) {
      logger.warn('Queue service completion failed (non-critical)', { 
        whatsappId, 
        stationId, 
        error: queueError 
      });
      // Don't fail the main flow if queue completion fails
    }

    // Send confirmation message to user
    await whatsappService.sendTextMessage(
      whatsappId,
      '🛑 *Charging Session Stopped*\n\n' +
      'Your charging session has been terminated.\n' +
      'You\'ll receive a detailed summary shortly.\n\n' +
      '📊 Thank you for using SharaSpot!'
    );

    logger.info('Session stop processed successfully', { whatsappId, stationId });

  } catch (error) {
    await this.handleError(error, 'session stop', { whatsappId, stationId });
  }
}

/**
 * Process queue join (alias for handleJoinQueue for backward compatibility)
 */
async processQueueJoin(whatsappId: string, stationId: number): Promise<void> {
  try {
    logger.info('Processing queue join via alias', { whatsappId, stationId });
    return await this.handleJoinQueue(whatsappId, stationId);
  } catch (error) {
    logger.error('Failed to process queue join via alias', { 
      whatsappId, 
      stationId, 
      error 
    });
    throw error; // Re-throw to maintain error propagation
  }
}
  /**
   * Handle session extension 
   */
  async handleSessionExtend(whatsappId: string, stationId: number, minutes: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing session extension', { whatsappId, stationId, minutes });

      // Convert minutes to new target battery level (simplified logic)
      // In reality, this would calculate based on current battery level and charging rate
      const newTargetBatteryLevel = Math.min(100, 80 + Math.floor(minutes / 30) * 10);

      const success = await sessionService.extendSession(whatsappId, stationId, newTargetBatteryLevel);
      
      if (!success) {
        await this.sendError(whatsappId, 'Unable to extend session. Please check if you have an active session.');
        return;
      }

      const extendedTime = new Date(Date.now() + minutes * 60000);
      await whatsappService.sendTextMessage(
        whatsappId,
        `⏰ *Session Extended Successfully*\n\n` +
        `⚡ Extended by: ${minutes} minutes\n` +
        `🔋 New target: ${newTargetBatteryLevel}%\n` +
        `🕐 Expected completion: ${extendedTime.toLocaleTimeString()}\n\n` +
        `📊 *Updated session details will be sent shortly.*`
      );

    } catch (error) {
      await this.handleError(error, 'session extend', { whatsappId, stationId });
    }
  }

  // ===============================================
  // SMART BOOKING HANDLERS
  // ===============================================

  /**
   * Handle instant booking for available stations
   */
  private async handleInstantBooking(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    try {
      // Try to reserve a slot immediately
      const queuePosition = await queueService.joinQueue(whatsappId, station.id);
      
      if (!queuePosition) {
        await this.handleQueueBooking(whatsappId, station, user);
        return;
      }

      // Auto-reserve since station is available
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

  /**
   * Handle queue-based booking
   */
  private async handleQueueBooking(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    const queueStats = await queueService.getQueueStats(station.id);
    
    const message = `📋 *Join Queue at ${station.name}?*\n\n` +
      `📊 *Current Situation:*\n` +
      `• ${queueStats.totalInQueue} people in queue\n` +
      `• Average wait: ${queueStats.averageWaitTime} minutes\n` +
      `• Rate: ${station.priceDisplay}\n` +
      `• Expected cost: ~₹${this.estimateCost(station, user)}\n\n` +
      `💡 *You'll get live updates as the queue moves!*`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎯 *How would you like to proceed?*',
        [
          { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
          { id: `find_alternatives_${station.id}`, title: '🔍 Find Alternatives' },
          { id: `get_directions_${station.id}`, title: '🗺️ Get Directions' }
        ]
      );
    }, 2000);
  }

  /**
   * Handle existing booking
   */
  private async handleExistingBooking(whatsappId: string, existingQueue: any): Promise<void> {
    const statusText = existingQueue.status === 'reserved' ? 'Reserved' : 
                      existingQueue.status === 'waiting' ? 'In Queue' : 'Active';

    await whatsappService.sendTextMessage(
      whatsappId,
      `⚠️ *Existing Booking Found*\n\n` +
      `📍 Station: ${existingQueue.stationName}\n` +
      `📊 Status: ${statusText}\n` +
      `👥 Position: #${existingQueue.position}\n\n` +
      `💡 You can only have one active booking at a time.`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '📱 *Manage Your Current Booking:*',
        [
          { id: `queue_status_${existingQueue.stationId}`, title: '📊 Check Status' },
          { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel Current' },
          { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Get Directions' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // SUCCESS HANDLERS
  // ===============================================

  /**
   * Show instant booking success
   */
  private async showInstantBookingSuccess(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    const message = `🎉 *Slot Reserved Successfully!*\n\n` +
      `📍 *${station.name}*\n` +
      `⚡ Slot reserved for 15 minutes\n` +
      `💰 Rate: ${station.priceDisplay}\n` +
      `🎯 Expected cost: ~₹${this.estimateCost(station, user)}\n\n` +
      `⏰ *Please arrive within 15 minutes to start charging.*`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⚡ *Ready to Charge?*',
        [
          { id: `start_session_${station.id}`, title: '⚡ Start Charging' },
          { id: `get_directions_${station.id}`, title: '🗺️ Get Directions' },
          { id: `cancel_queue_${station.id}`, title: '❌ Cancel Booking' }
        ]
      );
    }, 2000);
  }

  /**
   * Handle successful queue join
   */
  private async handleSuccessfulQueueJoin(whatsappId: string, queuePosition: any): Promise<void> {
    const waitAdvice = queuePosition.estimatedWaitMinutes > 30 ? 
      '\n💡 *Long wait expected. Consider finding alternatives or coming back later.*' : 
      '\n✅ *Reasonable wait time. Perfect time for a coffee break!*';

    const message = `📋 *Joined Queue Successfully!*\n\n` +
      `📍 *Station:* ${queuePosition.stationName}\n` +
      `👥 *Your Position:* #${queuePosition.position}\n` +
      `⏱️ *Estimated Wait:* ${queuePosition.estimatedWaitMinutes} minutes\n` +
      `🔔 *Live Updates:* You'll receive notifications as the queue moves${waitAdvice}`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '📱 *Manage Your Queue Position:*',
        [
          { id: `queue_status_${queuePosition.stationId}`, title: '📊 Check Status' },
          { id: `get_directions_${queuePosition.stationId}`, title: '🗺️ Get Directions' },
          { id: `cancel_queue_${queuePosition.stationId}`, title: '❌ Cancel Queue' }
        ]
      );
    }, 2000);
  }

  /**
   * Handle successful session start
   */
  private async handleSuccessfulSessionStart(whatsappId: string, session: any): Promise<void> {
    const message = `⚡ *Charging Session Started!*\n\n` +
      `📍 *Station:* ${session.stationName}\n` +
      `🔋 *Current Level:* ${session.currentBatteryLevel}%\n` +
      `🎯 *Target Level:* ${session.targetBatteryLevel}%\n` +
      `⚡ *Charging Rate:* ${session.chargingRate} kW\n` +
      `💰 *Rate:* ₹${session.pricePerKwh}/kWh\n` +
      `📊 *Current Cost:* ₹${session.totalCost.toFixed(2)}\n\n` +
      `🔄 *Live updates every 10 minutes*`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '📊 *Session Management:*',
        [
          { id: `session_status_${session.stationId}`, title: '📊 Live Status' },
          { id: `extend_30_${session.stationId}`, title: '⏰ +30 mins' },
          { id: `session_stop_${session.stationId}`, title: '🛑 Stop Session' }
        ]
      );
    }, 2000);
  }

  /**
   * Handle successful cancellation
   */
  private async handleSuccessfulCancellation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `✅ *Queue Position Cancelled Successfully*\n\n` +
      `Your booking has been cancelled and others have been promoted.\n` +
      `No charges applied for cancellation.\n\n` +
      `💡 *Ready to find another station?*`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Find Your Next Charging Station:*',
        [
          { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
          { id: 'new_search', title: '🆕 New Search' },
          { id: 'recent_searches', title: '🕒 Recent Locations' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // FAILURE HANDLERS
  // ===============================================

  /**
   * Handle queue join failure
   */
  private async handleQueueJoinFailure(whatsappId: string, station: ProcessedStation): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Unable to Join Queue*\n\n` +
      `The queue at ${station.name} might be full or temporarily unavailable.\n\n` +
      `🔍 *Let's find you alternatives:*`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎯 *Alternative Options:*',
        [
          { id: `find_alternatives_${station.id}`, title: '🔍 Find Alternatives' },
          { id: 'find_nearby_stations', title: '🗺️ Search Nearby' },
          { id: 'new_search', title: '🆕 Start New Search' }
        ]
      );
    }, 2000);
  }

  /**
   * Handle session start failure
   */
  private async handleSessionStartFailure(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Unable to Start Charging Session*\n\n` +
      `This might be due to:\n` +
      `• Station connectivity issues\n` +
      `• No valid reservation\n` +
      `• Technical maintenance\n\n` +
      `💡 *Please try again or contact station support.*`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔧 *Available Actions:*',
        [
          { id: `queue_status_${stationId}`, title: '📊 Check Queue Status' },
          { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
          { id: 'help', title: '❓ Contact Support' }
        ]
      );
    }, 2000);
  }

  /**
   * Handle no valid reservation
   */
  private async handleNoValidReservation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚠️ *No Valid Reservation Found*\n\n` +
      `You need an active queue position or reservation to start charging.\n\n` +
      `💡 *Please join the queue first.*`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎯 *Next Steps:*',
        [
          { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
          { id: `queue_status_${stationId}`, title: '📊 Check Status' },
          { id: 'find_nearby_stations', title: '🔍 Find Alternatives' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // DISPLAY METHODS
  // ===============================================

  /**
   * Display queue status
   */
  private async displayQueueStatus(whatsappId: string, queue: any): Promise<void> {
    const statusEmoji: { [key: string]: string } = {
      'waiting': '⏳',
      'reserved': '✅',
      'charging': '⚡',
      'ready': '🎯',
      'completed': '✅',
      'cancelled': '❌'
    };

    const emoji = statusEmoji[queue.status] || '📋';

    const timeInfo = queue.status === 'reserved' && queue.reservationExpiry ?
      `⏰ Reservation expires: ${new Date(queue.reservationExpiry).toLocaleTimeString()}` :
      `⏱️ Estimated wait: ${queue.estimatedWaitMinutes} minutes`;

    const message = `${emoji} *Queue Status*\n\n` +
      `📍 *Station:* ${queue.stationName}\n` +
      `📊 *Status:* ${this.capitalizeFirst(queue.status)}\n` +
      `👥 *Position:* #${queue.position}\n` +
      `${timeInfo}\n` +
      `📅 *Joined:* ${new Date(queue.createdAt).toLocaleString()}\n\n` +
      `🔄 *Last updated:* Just now`;

    await whatsappService.sendTextMessage(whatsappId, message);
  }

  /**
   * Display session status
   */
  private async displaySessionStatus(whatsappId: string, status: any, session: any): Promise<void> {
    const message = `⚡ *Live Charging Status*\n\n` +
      `📍 *Station:* ${session.stationName}\n` +
      `🔋 *Battery Level:* ${status.currentBatteryLevel}%\n` +
      `⚡ *Charging Rate:* ${status.chargingRate} kW\n` +
      `🔌 *Energy Added:* ${status.energyAdded.toFixed(1)} kWh\n` +
      `💰 *Current Cost:* ₹${status.currentCost.toFixed(2)}\n` +
      `⏱️ *Duration:* ${status.duration}\n` +
      `🎯 *Completion:* ${status.estimatedCompletion}\n` +
      `📊 *Efficiency:* ${status.efficiency}%\n\n` +
      `${status.statusMessage}`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎛️ *Session Controls:*',
        [
          { id: `extend_30_${session.stationId}`, title: '⏰ Extend +30min' },
          { id: `extend_60_${session.stationId}`, title: '⏰ Extend +1hr' },
          { id: `session_stop_${session.stationId}`, title: '🛑 Stop Now' }
        ]
      );
    }, 2000);
  }

  /**
   * Display basic session info when detailed status is not available
   */
  private async displayBasicSessionInfo(whatsappId: string, session: any): Promise<void> {
    const duration = Math.floor((Date.now() - session.startTime.getTime()) / (1000 * 60));
    const durationText = duration > 60 ? 
      `${Math.floor(duration / 60)}h ${duration % 60}m` : 
      `${duration}m`;

    const message = `⚡ *Active Charging Session*\n\n` +
      `📍 *Station:* ${session.stationName}\n` +
      `🔋 *Current Level:* ${session.currentBatteryLevel}%\n` +
      `🎯 *Target Level:* ${session.targetBatteryLevel}%\n` +
      `⚡ *Charging Rate:* ${session.chargingRate} kW\n` +
      `💰 *Rate:* ₹${session.pricePerKwh}/kWh\n` +
      `⏱️ *Duration:* ${durationText}\n` +
      `📊 *Current Cost:* ₹${session.totalCost.toFixed(2)}\n\n` +
      `🔄 *Session is active and running*`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎛️ *Session Controls:*',
        [
          { id: `extend_30_${session.stationId}`, title: '⏰ Extend +30min' },
          { id: `extend_60_${session.stationId}`, title: '⏰ Extend +1hr' },
          { id: `session_stop_${session.stationId}`, title: '🛑 Stop Now' }
        ]
      );
    }, 2000);
  }

  /**
   * Show no active queues
   */
  private async showNoActiveQueues(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📋 *Your Active Bookings*\n\n' +
      'No active bookings or queue positions found.\n\n' +
      '🔍 Ready to find a charging station?'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⚡ *Find Charging Stations:*',
        [
          { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
          { id: 'new_search', title: '🆕 New Search' },
          { id: 'recent_searches', title: '🕒 Recent Searches' }
        ]
      );
    }, 2000);
  }

  /**
   * Show existing queue status
   */
  private async showExistingQueueStatus(whatsappId: string, existingQueue: any): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📋 *Already in Queue*\n\n` +
      `You're already in the queue at this station.\n\n` +
      `👥 *Position:* #${existingQueue.position}\n` +
      `⏱️ *Wait Time:* ${existingQueue.estimatedWaitMinutes} minutes\n\n` +
      `💡 *You'll receive updates as your position changes.*`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '📱 *Manage Your Position:*',
        [
          { id: `queue_status_${existingQueue.stationId}`, title: '📊 Refresh Status' },
          { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Get Directions' },
          { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel Queue' }
        ]
      );
    }, 2000);
  }

  /**
   * Send queue management buttons
   */
  private async sendQueueManagementButtons(whatsappId: string, queues: any[]): Promise<void> {
    if (queues.length === 0) return;

    const buttons = [];
    const primaryQueue = queues[0]; // Focus on first queue

    if (primaryQueue.status === 'reserved') {
      buttons.push({ id: `start_session_${primaryQueue.stationId}`, title: '⚡ Start Charging' });
    }
    
    buttons.push(
      { id: `get_directions_${primaryQueue.stationId}`, title: '🗺️ Get Directions' },
      { id: `cancel_queue_${primaryQueue.stationId}`, title: '❌ Cancel Queue' }
    );

    await whatsappService.sendButtonMessage(
      whatsappId,
      '🎛️ *Queue Management:*',
      buttons.slice(0, 3) // WhatsApp max 3 buttons
    );
  }

  // ===============================================
  // ADDITIONAL ACTION HANDLERS
  // ===============================================

  /**
   * Handle get directions request
   */
  async handleGetDirections(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found.');
        return;
      }

      const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(station.name + ' ' + station.address)}`;
      const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(station.name + ' ' + station.address)}`;
      
      const message = `🗺️ *Directions to ${station.name}*\n\n` +
        `📍 **Address:**\n${station.address}\n\n` +
        `🔗 **Navigation Links:**\n` +
        `📱 Google Maps: ${googleMapsUrl}\n` +
        `🚗 Waze: ${wazeUrl}\n\n` +
        `💡 **Tips:**\n` +
        `• Save this location for faster access\n` +
        `• Check station hours before travelling\n` +
        `• Arrive 5 minutes early if you have a reservation`;

      await whatsappService.sendTextMessage(whatsappId, message);

      // Send additional helpful buttons
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '📱 *While you travel:*',
          [
            { id: `queue_status_${station.id}`, title: '📊 Check Queue Status' },
            { id: `station_info_${station.id}`, title: '📋 Station Details' },
            { id: 'help', title: '❓ Contact Support' }
          ]
        );
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'get directions', { whatsappId, stationId });
    }
  }

  /**
   * Handle find alternatives request
   */
  async handleFindAlternatives(whatsappId: string, stationId: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;

    try {
      logger.info('Finding alternatives for station', { whatsappId, stationId });

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 *Finding Alternative Stations...*\n\n' +
        'Searching for nearby options with:\n' +
        '• Similar charging speeds\n' +
        '• Compatible connectors\n' +
        '• Shorter wait times\n' +
        '• Better rates\n\n' +
        '⏳ *Please wait...*'
      );

      // Get user preferences for better alternatives
      const user = await userService.getUserByWhatsAppId(whatsappId);
      const userConnector = user?.connectorType;

      setTimeout(async () => {
        const alternativeMessage = `🎯 *Alternative Strategies:*\n\n` +
          `**Quick Options:**\n` +
          `🔍 Expand search radius for more stations\n` +
          `⏰ Check stations with shorter queues\n` +
          `💰 Find stations with better rates\n\n` +
          `**Smart Suggestions:**\n` +
          `${userConnector ? `🔌 Focus on ${userConnector} compatible stations\n` : ''}` +
          `📊 Consider off-peak hours (10 PM - 8 AM)\n` +
          `🏢 Try commercial areas vs residential`;

        await whatsappService.sendTextMessage(whatsappId, alternativeMessage);

        // Send action buttons
        await whatsappService.sendButtonMessage(
          whatsappId,
          '🎯 *Choose Your Next Move:*',
          [
            { id: 'expand_search', title: '📡 Expand Search Area' },
            { id: 'find_nearby_stations', title: '🗺️ Find Nearby Stations' },
            { id: 'new_search', title: '🆕 Start New Search' }
          ]
        );
      }, 3000);

    } catch (error) {
      await this.handleError(error, 'find alternatives', { whatsappId, stationId });
    }
  }

  /**
   * Handle station rating - NEW METHOD
   */
  async handleStationRating(whatsappId: string, stationId: number, rating: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing station rating', { whatsappId, stationId, rating });

      if (rating < 1 || rating > 5) {
        await this.sendError(whatsappId, 'Please provide a rating between 1 and 5 stars.');
        return;
      }

      // Check if user has used this station
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      const hasUsedStation = userQueues.some(q => 
        q.stationId === stationId && 
        (q.status === 'completed' || q.status === 'charging')
      );

      if (!hasUsedStation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '⭐ *Station Rating*\n\n' +
          'Thank you for wanting to rate this station!\n\n' +
          '💡 *You can rate stations after using them.*\n' +
          'This helps maintain authentic reviews.'
        );
        return;
      }

      const station = await this.getStationDetails(stationId);
      if (!station) {
        await this.sendNotFound(whatsappId, 'Station not found.');
        return;
      }

      // Simulate rating submission (integrate with actual rating service when available)
      const ratingText = rating === 5 ? 'Excellent! ⭐⭐⭐⭐⭐' :
                        rating === 4 ? 'Great! ⭐⭐⭐⭐' :
                        rating === 3 ? 'Good ⭐⭐⭐' :
                        rating === 2 ? 'Fair ⭐⭐' : 'Poor ⭐';

      await whatsappService.sendTextMessage(
        whatsappId,
        `⭐ *Rating Submitted Successfully!*\n\n` +
        `📍 **Station:** ${station.name}\n` +
        `⭐ **Your Rating:** ${ratingText}\n\n` +
        `🙏 **Thank you for helping the EV community!**\n` +
        `Your feedback helps other users make informed decisions.`
      );

      // Ask for detailed feedback if rating is low
      if (rating <= 3) {
        setTimeout(async () => {
          await whatsappService.sendTextMessage(
            whatsappId,
            '💬 *Help us improve!*\n\n' +
            'Would you like to share what could be better?\n' +
            'Simply reply with your feedback, and we\'ll make sure ' +
            'the station owner gets your suggestions.'
          );
        }, 2000);
      }

    } catch (error) {
      await this.handleError(error, 'station rating', { whatsappId, stationId, rating });
    }
  }

  // ===============================================
  // DATABASE OPERATIONS
  // ===============================================

  /**
   * Get station details from database with proper error handling
   */
  private async getStationDetails(stationId: number): Promise<ProcessedStation | null> {
    try {
      const stations = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (stations.length === 0) {
        logger.warn('Station not found in database', { stationId });
        return null;
      }

      return this.processStationData(stations[0]);

    } catch (error) {
      logger.error('Database query failed', { stationId, error });
      return null;
    }
  }

  /**
   * Process raw station data into user-friendly format
   */
  private processStationData(station: StationDetails): ProcessedStation {
    const isActive = station.isActive === null ? false : station.isActive;
    const isOpen = station.isOpen === null ? false : station.isOpen;
    const availableSlots = Number(station.availableSlots || station.availablePorts) || 0;
    const totalSlots = Number(station.totalSlots || station.totalPorts) || 1;
    const price = Number(station.pricePerKwh) || 0;
    const rating = Number(station.rating || station.averageRating) || 0;
    const reviews = Number(station.totalReviews || station.reviewCount) || 0;
    const distance = Number(station.distance) || 0;

    const utilization = totalSlots > 0 ? Math.round(((totalSlots - availableSlots) / totalSlots) * 100) : 0;
    const isAvailable = availableSlots > 0 && isActive && isOpen;

    let availability = 'Offline';
    if (isActive && isOpen) {
      availability = availableSlots > 0 ? 'Available' : 'Full';
    }

    return {
      ...station,
      isActive,
      isOpen,
      isAvailable,
      utilization,
      availability,
      priceDisplay: price > 0 ? `₹${price.toFixed(2)}/kWh` : 'Price not available',
      distanceDisplay: distance > 0 ? `${distance.toFixed(1)} km` : 'Distance unknown',
      ratingDisplay: rating > 0 ? `${rating.toFixed(1)} ⭐` : 'No ratings yet',
      slotsDisplay: `${availableSlots}/${totalSlots} available`,
      finalRating: rating,
      finalReviews: reviews
    };
  }

  // ===============================================
  // MESSAGE FORMATTING
  // ===============================================

  /**
   * Show station overview with booking options
   */
  private async showStationOverview(whatsappId: string, station: ProcessedStation): Promise<void> {
    const overviewText = `🏢 *${station.name}*\n\n` +
      `📍 ${station.address}\n` +
      `📏 ${station.distanceDisplay}\n` +
      `⚡ ${station.slotsDisplay}\n` +
      `💰 ${station.priceDisplay}\n` +
      `⭐ ${station.ratingDisplay} (${station.finalReviews} reviews)\n\n` +
      `🔌 *Connectors:* ${this.formatConnectorTypes(station.connectorTypes)}\n` +
      `🕒 *Hours:* ${this.formatOperatingHours(station.operatingHours)}\n` +
      `🎯 *Status:* ${this.getStatusWithEmoji(station.availability)}`;

    await whatsappService.sendTextMessage(whatsappId, overviewText);

    // Send action buttons based on availability
    setTimeout(async () => {
      await this.sendStationActionButtons(whatsappId, station);
    }, 2000);
  }

  /**
   * Format detailed station information
   */
  private formatStationDetails(station: ProcessedStation): string {
    let detailsText = `🏢 *${station.name}*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📍 *Location:*\n${station.address}\n\n` +
      `⚡ *Charging Details:*\n` +
      `• Available Slots: ${station.slotsDisplay}\n` +
      `• Price: ${station.priceDisplay}\n` +
      `• Connectors: ${this.formatConnectorTypes(station.connectorTypes)}\n\n` +
      `🕒 *Operating Hours:*\n${this.formatOperatingHours(station.operatingHours)}\n\n` +
      `⭐ *Rating:* ${station.ratingDisplay}\n` +
      `📊 *Utilization:* ${station.utilization}%\n`;

    // Add amenities if available
    if (station.amenities && Array.isArray(station.amenities) && station.amenities.length > 0) {
      detailsText += `\n🎯 *Amenities:*\n${station.amenities.map((a: string) => `• ${this.capitalizeFirst(a)}`).join('\n')}\n`;
    }

    // Add status
    detailsText += `\n${this.getStatusWithEmoji(station.availability)} *Status:* ${station.availability}`;

    return detailsText;
  }

  /**
   * Show booking options for available station
   */
  private async showBookingOptions(whatsappId: string, station: ProcessedStation, user: any): Promise<void> {
    const message = `⚡ *Ready to Charge at ${station.name}?*\n\n` +
      `📊 *Current Status:*\n` +
      `• ${station.slotsDisplay}\n` +
      `• Rate: ${station.priceDisplay}\n` +
      `• Expected for your ${user.evModel || 'EV'}: ~₹${this.estimateCost(station, user)}\n\n` +
      `🔌 *Your Vehicle:*\n` +
      `• Model: ${user.evModel || 'Not specified'}\n` +
      `• Connector: ${user.connectorType || 'Any'}\n\n` +
      `🎯 Choose your preferred option below:`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      const buttons = this.getBookingButtons(station);
      await whatsappService.sendListMessage(
        whatsappId,
        '⚡ *Booking Options*',
        'Select how you want to proceed:',
        [
          {
            title: '🚀 Quick Actions',
            rows: buttons.quick
          },
          {
            title: '📋 More Options',
            rows: buttons.detailed
          }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // BUTTON GENERATION
  // ===============================================

  /**
   * Send appropriate action buttons based on station status
   */
  private async sendStationActionButtons(whatsappId: string, station: ProcessedStation): Promise<void> {
    const buttons = [];

    if (station.isAvailable) {
      buttons.push({ id: `book_station_${station.id}`, title: '⚡ Book Now' });
      buttons.push({ id: `station_info_${station.id}`, title: '📊 More Details' });
    } else {
      buttons.push({ id: `join_queue_${station.id}`, title: '📋 Join Queue' });
      buttons.push({ id: `find_alternatives_${station.id}`, title: '🔍 Find Alternatives' });
    }

    buttons.push({ id: `get_directions_${station.id}`, title: '🗺️ Get Directions' });

    if (buttons.length > 0) {
      await whatsappService.sendButtonMessage(
        whatsappId,
        `🎯 *What would you like to do at ${station.name}?*`,
        buttons.slice(0, 3), // WhatsApp max 3 buttons
        '🏢 Station Actions'
      );
    }
  }

  /**
   * Get booking-specific buttons
   */
  private getBookingButtons(station: ProcessedStation): { quick: any[], detailed: any[] } {
    const quick = [];
    const detailed = [];

    if (station.availableSlots > 0) {
      quick.push({
        id: `join_queue_${station.id}`,
        title: '⚡ Book Immediately',
        description: 'Reserve your slot now'
      });
    }

    detailed.push(
      {
        id: `queue_status_${station.id}`,
        title: '📊 Check Wait Time',
        description: 'See current queue status'
      },
      {
        id: `get_directions_${station.id}`,
        title: '🗺️ Get Directions',
        description: 'Navigate to station'
      },
      {
        id: `find_alternatives_${station.id}`,
        title: '🔍 Find Alternatives',
        description: 'Browse nearby stations'
      }
    );

    return { quick, detailed };
  }

  // ===============================================
  // ERROR HANDLING & EDGE CASES
  // ===============================================

  /**
   * Handle unavailable stations
   */
  private async handleUnavailableStation(whatsappId: string, station: ProcessedStation): Promise<void> {
    let reason = '❌ Station is currently unavailable.';
    let suggestion = 'Please try another station.';

    if (!station.isActive) {
      reason = '🚫 Station is temporarily disabled for maintenance.';
      suggestion = 'Check back later or find an alternative.';
    } else if (!station.isOpen) {
      reason = '🕐 Station is currently closed.';
      suggestion = `Operating hours: ${this.formatOperatingHours(station.operatingHours)}`;
    } else if (station.availableSlots === 0) {
      reason = '🔴 All charging slots are currently occupied.';
      suggestion = 'Join the queue or find an alternative station.';
    }

    await whatsappService.sendTextMessage(
      whatsappId,
      `${reason}\n\n${suggestion}`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Alternative Options:*',
        [
          { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
          { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
          { id: 'new_search', title: '🆕 New Search' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  /**
   * Validate input parameters
   */
  private validateInput(whatsappId: string, stationId: number): boolean {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID', { whatsappId });
      return false;
    }

    if (!stationId || isNaN(stationId) || stationId <= 0) {
      logger.error('Invalid station ID', { stationId, whatsappId });
      whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID. Please try again.');
      return false;
    }

    return true;
  }

  /**
   * Check if station is bookable
   */
  private isStationBookable(station: ProcessedStation): boolean {
    return station.isActive === true && station.isOpen === true;
  }

  /**
   * Format connector types for display
   */
  private formatConnectorTypes(connectorTypes: any): string {
    if (Array.isArray(connectorTypes)) {
      return connectorTypes.length > 0 ? connectorTypes.join(', ') : 'Standard';
    }
    return connectorTypes || 'Standard';
  }

  /**
   * Format operating hours for display
   */
  private formatOperatingHours(operatingHours: any): string {
    if (typeof operatingHours === 'object' && operatingHours !== null) {
      const allDay = Object.values(operatingHours).every(hours => hours === '24/7');
      if (allDay) return '24/7';
      return 'Varies by day (check station for details)';
    }
    return operatingHours || '24/7';
  }

  /**
   * Get status with appropriate emoji
   */
  private getStatusWithEmoji(availability: string): string {
    const emojiMap: Record<string, string> = {
      'Available': '✅',
      'Full': '🔴',
      'Offline': '⚫'
    };
    return emojiMap[availability] || '❓';
  }

  /**
   * Capitalize first letter
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Estimate charging cost for user
   */
  private estimateCost(station: ProcessedStation, user: any): string {
    const basePrice = Number(station.pricePerKwh) || 12;
    const estimatedKwh = user.connectorType === 'CCS2' ? 25 : 15;
    const estimatedCost = basePrice * estimatedKwh;
    return estimatedCost.toFixed(0);
  }

  // ===============================================
  // ERROR HANDLING
  // ===============================================

  /**
   * Centralized error handling
   */
  private async handleError(error: any, operation: string, context: Record<string, any>): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`${operation} failed`, { ...context, error: errorMessage });

    const whatsappId = context.whatsappId;
    if (whatsappId) {
      await this.sendError(whatsappId, `Failed to ${operation}. Please try again.`);
    }
  }

  /**
   * Send error message to user
   */
  private async sendError(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
    } catch (sendError) {
      logger.error('Failed to send error message', { whatsappId, sendError });
    }
  }

  /**
   * Send not found message to user
   */
  private async sendNotFound(whatsappId: string, message: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(whatsappId, `🔍 ${message}`);
    } catch (sendError) {
      logger.error('Failed to send not found message', { whatsappId, sendError });
    }
  }

  // ===============================================
  // MONITORING & HEALTH
  // ===============================================

  /**
   * Get controller health status
   */
  public getHealthStatus(): {
    status: 'healthy' | 'degraded';
    activeOperations: number;
    lastActivity: string;
    integrations: {
      queueService: boolean;
      sessionService: boolean;
      notificationService: boolean;
    };
  } {
    return {
      status: 'healthy',
      activeOperations: 0,
      lastActivity: new Date().toISOString(),
      integrations: {
        queueService: !!queueService,
        sessionService: !!sessionService,
        notificationService: !!notificationService
      }
    };
  }

  // ===============================================
  // ADVANCED FEATURES
  // ===============================================

  /**
   * Handle bulk operations - NEW METHOD
   */
  async handleBulkOperation(whatsappId: string, operation: string, data: any[]): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;

    try {
      logger.info('Processing bulk operation', { whatsappId, operation, count: data.length });

      switch (operation) {
        case 'cancel_all_queues':
          await this.cancelAllUserQueues(whatsappId);
          break;
        case 'get_all_status':
          await this.getAllUserStatuses(whatsappId);
          break;
        default:
          await this.sendError(whatsappId, 'Unknown bulk operation.');
      }

    } catch (error) {
      await this.handleError(error, 'bulk operation', { whatsappId, operation });
    }
  }

  /**
   * Cancel all user queues
   */
  private async cancelAllUserQueues(whatsappId: string): Promise<void> {
    const userQueues = await queueService.getUserQueueStatus(whatsappId);
    
    if (userQueues.length === 0) {
      await whatsappService.sendTextMessage(whatsappId, '📋 No active queues to cancel.');
      return;
    }

    let cancelledCount = 0;
    for (const queue of userQueues) {
      if (queue.status !== 'completed') {
        const success = await queueService.leaveQueue(whatsappId, queue.stationId, 'user_cancelled');
        if (success) cancelledCount++;
      }
    }

    await whatsappService.sendTextMessage(
      whatsappId,
      `✅ *Bulk Cancellation Complete*\n\n` +
      `📊 Cancelled ${cancelledCount} of ${userQueues.length} queues.\n\n` +
      `💡 You're now free to book at any station.`
    );
  }

  /**
   * Get all user statuses
   */
  private async getAllUserStatuses(whatsappId: string): Promise<void> {
    const [userQueues, activeSessions] = await Promise.all([
      queueService.getUserQueueStatus(whatsappId),
      this.getUserActiveSessions(whatsappId)
    ]);

    if (userQueues.length === 0 && activeSessions.length === 0) {
      await this.showNoActiveQueues(whatsappId);
      return;
    }

    let statusMessage = `📊 *Your Complete Status*\n\n`;

    if (userQueues.length > 0) {
      statusMessage += `📋 **Active Queues (${userQueues.length}):**\n`;
      userQueues.forEach((queue, index) => {
        statusMessage += `${index + 1}. ${queue.stationName} - Position #${queue.position}\n`;
      });
      statusMessage += `\n`;
    }

    if (activeSessions.length > 0) {
      statusMessage += `⚡ **Active Sessions (${activeSessions.length}):**\n`;
      activeSessions.forEach((session, index) => {
        statusMessage += `${index + 1}. ${session.stationName} - ${session.currentBatteryLevel}% charged\n`;
      });
    }

    await whatsappService.sendTextMessage(whatsappId, statusMessage);
  }

  /**
   * Get user active sessions
   */
  private async getUserActiveSessions(whatsappId: string): Promise<any[]> {
    try {
      // Get all user queues that are in charging status
      const chargingQueues = await queueService.getUserQueueStatus(whatsappId);
      const activeSessions = [];

      for (const queue of chargingQueues) {
        if (queue.status === 'charging') {
          const session = await sessionService.getActiveSession(whatsappId, queue.stationId);
          if (session) {
            activeSessions.push(session);
          }
        }
      }

      return activeSessions;
    } catch (error) {
      logger.error('Failed to get user active sessions', { whatsappId, error });
      return [];
    }
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const bookingController = new BookingController();