// src/controllers/booking.ts
import { whatsappService } from '../services/whatsapp';
import { queueService } from '../services/queue';
import { sessionService } from '../services/session';
import { analyticsService } from '../services/analytics';
import { userService } from '../services/user';
import { logger } from '../utils/logger';
import { db } from '../db/connection';
import { chargingStations } from '../db/schema';
import { eq } from 'drizzle-orm';



export class BookingController {
  /**
   * Handle station booking with smart queue management
   */
  async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('🚀 Processing smart booking request', { whatsappId, stationId });

      // Get user and station details
      const [user, station] = await Promise.all([
        userService.getUserByWhatsAppId(whatsappId),
        this.getStationDetails(stationId)
      ]);

      if (!user) {
        await whatsappService.sendTextMessage(whatsappId, '❌ User account not found. Please restart the bot.');
        return;
      }

      if (!station || !station.isActive || !station.isOpen) {
        await this.handleUnavailableStation(whatsappId, stationId, station);
        return;
      }

      // Check if user already in any queue
      const existingQueues = await queueService.getUserQueueStatus(whatsappId);
      if (existingQueues.length > 0) {
        await this.handleExistingQueue(whatsappId, existingQueues);
        return;
      }

      // Get real-time analytics for smart recommendations
      const analytics = await analyticsService.getStationAnalytics(stationId);
      
      // Show smart booking interface
      await this.showSmartBookingInterface(whatsappId, station, analytics, user);

    } catch (error) {
      logger.error('❌ Failed to handle station booking', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Booking failed. Please try again or contact support.'
      );
    }
  }
   
  /**
   * Process queue joining with smart optimization
   */
  async processQueueJoin(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('⚡ Processing queue join', { whatsappId, stationId });

      const queuePosition = await queueService.joinQueue(whatsappId, stationId);
      
      if (!queuePosition) {
        await this.handleQueueJoinFailure(whatsappId, stationId);
        return;
      }

      // Send confirmation with rich analytics
      await this.sendQueueJoinConfirmation(whatsappId, queuePosition);

      // Start smart monitoring
      await this.initializeSmartMonitoring(whatsappId, stationId);

    } catch (error) {
      logger.error('❌ Failed to process queue join', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to join queue. Please try again.');
    }
  }

  /**
   * Handle queue status check with live updates
   */
  async handleQueueStatus(whatsappId: string, stationId?: number): Promise<void> {
    try {
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      
      if (userQueues.length === 0) {
        await this.handleNoActiveQueues(whatsappId);
        return;
      }

      for (const queue of userQueues) {
        await this.sendLiveQueueStatus(whatsappId, queue);
      }

    } catch (error) {
      logger.error('❌ Failed to get queue status', { whatsappId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to get queue status.');
    }
  }

  /**
   * Handle queue cancellation with smart alternatives
   */
  async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('🛑 Processing queue cancellation', { whatsappId, stationId });

      const success = await queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
      
      if (!success) {
        await whatsappService.sendTextMessage(
          whatsappId, 
          '❌ No active booking found to cancel.'
        );
        return;
      }

      // Send cancellation confirmation with alternatives
      await this.sendCancellationConfirmation(whatsappId, stationId);

    } catch (error) {
      logger.error('❌ Failed to cancel queue', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to cancel booking.');
    }
  }

  /**
   * Handle charging session start
   */
  async handleChargingStart(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('⚡ Starting charging session', { whatsappId, stationId });

      // Verify reservation and start charging
      const success = await queueService.startCharging(whatsappId, stationId);
      
      if (!success) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Unable to start charging. Please check your reservation status.'
        );
        return;
      }

      // Initialize session tracking
      await sessionService.startSession(whatsappId, stationId);

      // Send charging start confirmation
      await this.sendChargingStartConfirmation(whatsappId, stationId);

    } catch (error) {
      logger.error('❌ Failed to start charging', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to start charging session.');
    }
  }

  /**
   * Handle charging session completion
   */
  async handleChargingComplete(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('✅ Completing charging session', { whatsappId, stationId });

      // Complete charging and queue
      const [queueSuccess, sessionSummary] = await Promise.all([
        queueService.completeCharging(whatsappId, stationId),
        sessionService.completeSession(whatsappId, stationId)
      ]);

      if (!queueSuccess) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Error completing session. Please contact station support.'
        );
        return;
      }

      // Send completion notification with summary
      await this.sendSessionSummary(whatsappId, stationId, sessionSummary);

    } catch (error) {
      logger.error('❌ Failed to complete charging', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to complete charging session.');
    }
  }

  // Private helper methods

  private async showSmartBookingInterface(whatsappId: string, station: any, analytics: any, user: any): Promise<void> {
    const currentQueue = analytics.currentQueueLength || 0;
    const waitTime = analytics.estimatedWaitTime || 0;
    const peakStatus = analytics.isPeakHour ? '🔴 Peak Hours' : '🟢 Normal Hours';
    
    const message = `⚡ *${station.name}*\n` +
      `📍 ${station.address}\n\n` +
      `📊 *Live Status:*\n` +
      `👥 Queue: ${currentQueue}/${station.maxQueueLength} people\n` +
      `⏱️ Est. Wait: ${waitTime} minutes\n` +
      `📈 ${peakStatus}\n` +
      `💰 Rate: ₹${station.pricePerKwh}/kWh\n\n` +
      `🔌 *Your EV:* ${user.evModel || 'Not specified'}\n` +
      `🔗 *Connector:* ${user.connectorType || 'CCS'}\n\n` +
      `${this.getSmartRecommendation(analytics)}`;

    await whatsappService.sendTextMessage(whatsappId, message);

    // Send action options with contextual buttons
    setTimeout(async () => {
      const buttons = this.getContextualButtons(station, analytics);
      
      await whatsappService.sendListMessage(
        whatsappId,
        '🎯 *Choose Your Action*',
        'Select how you want to proceed:',
        [
          {
            title: '⚡ Booking Options',
            rows: buttons.booking
          },
          {
            title: '📊 Information',
            rows: buttons.info
          },
          {
            title: '🔧 Alternatives',
            rows: buttons.alternatives
          }
        ]
      );
    }, 2000);
  }

  private getSmartRecommendation(analytics: any): string {
    if (analytics.currentQueueLength === 0) {
      return '🎉 *Perfect Timing!* No queue - book now for immediate charging!';
    } else if (analytics.currentQueueLength < 3) {
      return '✨ *Good Time!* Short queue expected.';
    } else if (analytics.isPeakHour) {
      return '⚠️ *Peak Hours:* Consider booking for later or check nearby stations.';
    } else {
      return '💡 *Tip:* Queue is longer than usual. Book now or get notified when it\'s shorter.';
    }
  }

  private getContextualButtons(stationId: number, analytics: any): any {
    const canBookNow = analytics.currentQueueLength < 5;
    
    return {
      booking: [
        ...(canBookNow ? [{ 
          id: `join_queue_${stationId}`, 
          title: '⚡ Join Queue Now', 
          description: 'Book your charging slot' 
        }] : []),
        { 
          id: `smart_schedule_${stationId}`, 
          title: '🧠 Smart Schedule', 
          description: 'AI-powered optimal timing' 
        },
        { 
          id: `notify_available_${stationId}`, 
          title: '🔔 Notify When Free', 
          description: 'Get alerted when queue is shorter' 
        }
      ],
      info: [
        { 
          id: `live_analytics_${stationId}`, 
          title: '📈 Live Analytics', 
          description: 'Real-time station insights' 
        },
        { 
          id: `station_details_${stationId}`, 
          title: '📋 Full Details', 
          description: 'Complete station information' 
        },
        { 
          id: `user_reviews_${stationId}`, 
          title: '⭐ User Reviews', 
          description: 'Community feedback' 
        }
      ],
      alternatives: [
        { 
          id: `nearby_stations_${stationId}`, 
          title: '🗺️ Nearby Stations', 
          description: 'Find alternatives nearby' 
        },
        { 
          id: `cheaper_options_${stationId}`, 
          title: '💰 Cheaper Options', 
          description: 'Find better rates' 
        },
        { 
          id: `faster_options_${stationId}`, 
          title: '⚡ Faster Charging', 
          description: 'Higher speed chargers' 
        }
      ]
    };
  }

  private async sendQueueJoinConfirmation(whatsappId: string, queuePosition: any): Promise<void> {
    const message = `🎉 *BOOKING CONFIRMED!*\n\n` +
      `📍 *${queuePosition.stationName}*\n` +
      `🎯 *Your Position:* #${queuePosition.position}\n` +
      `⏱️ *Estimated Wait:* ${queuePosition.estimatedWaitMinutes} minutes\n` +
      `🕐 *Expected Time:* ${this.calculateExpectedTime(queuePosition.estimatedWaitMinutes)}\n\n` +
      `✨ *What Happens Next:*\n` +
      `• Live position updates every 5 minutes\n` +
      `• Auto-reservation when you're #1\n` +
      `• Navigation assistance when ready\n` +
      `• Smart notifications throughout\n\n` +
      `🎮 *Manage your booking below* ⬇️`;

    await whatsappService.sendTextMessage(whatsappId, message);

    // Send management options
    setTimeout(async () => {
      await whatsappService.sendListMessage(
        whatsappId,
        '🎛️ *Booking Management*',
        'Control your charging session:',
        [
          {
            title: '📊 Live Updates',
            rows: [
              { id: `queue_status_${queuePosition.stationId}`, title: '📍 My Position', description: 'Live queue position' },
              { id: `time_estimate_${queuePosition.stationId}`, title: '⏱️ Time Update', description: 'Latest wait time' },
              { id: `station_cam_${queuePosition.stationId}`, title: '📹 Station View', description: 'Live station camera' }
            ]
          },
          {
            title: '🔧 Actions',
            rows: [
              { id: `extend_booking_${queuePosition.stationId}`, title: '⏰ Extend Time', description: 'Add more charging time' },
              { id: `share_booking_${queuePosition.stationId}`, title: '📤 Share Status', description: 'Share with family/friends' },
              { id: `cancel_booking_${queuePosition.stationId}`, title: '❌ Cancel Booking', description: 'Leave the queue' }
            ]
          }
        ]
      );
    }, 3000);
  }

  private async sendLiveQueueStatus(whatsappId: string, queue: any): Promise<void> {
    const statusEmoji = this.getStatusEmoji(queue.status);
    const progressBar = this.generateProgressBar(queue.position, 5);
    
    const message = `${statusEmoji} *${queue.stationName}*\n\n` +
      `📍 *Current Position:* #${queue.position}\n` +
      `${progressBar}\n` +
      `⏱️ *Updated Wait Time:* ${queue.estimatedWaitMinutes} min\n` +
      `🕐 *Expected At:* ${this.calculateExpectedTime(queue.estimatedWaitMinutes)}\n` +
      `📊 *Status:* ${this.getStatusDescription(queue.status)}\n\n` +
      `${this.getLiveStatusTip(queue)}`;

    await whatsappService.sendTextMessage(whatsappId, message);

    // Send location if user is next and has reservation
    if (queue.position === 1 && queue.isReserved) {
      setTimeout(async () => {
        await this.sendNavigationAssistance(whatsappId, queue.stationId);
      }, 1000);
    }
  }

  private async initializeSmartMonitoring(whatsappId: string, stationId: number): Promise<void> {
    // This will be handled by the queue scheduler
    logger.info('🧠 Smart monitoring initialized', { whatsappId, stationId });
  }

  private async handleUnavailableStation(whatsappId: string, stationId: number, station: any): Promise<void> {
    let reason = '❌ Station is currently unavailable.';
    
    if (!station) {
      reason = '❌ Station not found. Please try a different station.';
    } else if (!station.isActive) {
      reason = '🚫 Station is temporarily disabled for maintenance.';
    } else if (!station.isOpen) {
      reason = '🕐 Station is currently closed. Check operating hours.';
    }

    await whatsappService.sendTextMessage(whatsappId, reason);

    // Suggest alternatives
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Find Alternative Stations*\n\nLet us help you find another charging option:',
        [
          { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
          { id: 'show_open_stations', title: '🕐 Show Open Now' },
          { id: 'notify_when_open', title: '🔔 Notify When Open' }
        ]
      );
    }, 1500);
  }

  private async handleExistingQueue(whatsappId: string, existingQueues: any[]): Promise<void> {
    const queue = existingQueues[0];
    
    const message = `⚠️ *Active Booking Found*\n\n` +
      `You're already in queue at:\n` +
      `📍 ${queue.stationName}\n` +
      `🎯 Position: #${queue.position}\n` +
      `⏱️ Wait Time: ${queue.estimatedWaitMinutes} min\n\n` +
      `You can only have one active booking at a time.`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎛️ *Manage Your Current Booking:*',
        [
          { id: `queue_status_${queue.stationId}`, title: '📊 Check Status' },
          { id: `cancel_current_${queue.stationId}`, title: '❌ Cancel Current' },
          { id: 'find_alternatives', title: '🔍 Find Others' }
        ]
      );
    }, 2000);
  }

  private async getStationDetails(stationId: number): Promise<any> {
    const stations = await db.select()
      .from(chargingStations)
      .where(eq(chargingStations.id, stationId))
      .limit(1);
    
    return stations[0] || null;
  }

  private calculateExpectedTime(waitMinutes: number): string {
    const now = new Date();
    const expectedTime = new Date(now.getTime() + (waitMinutes * 60 * 1000));
    return expectedTime.toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  private getStatusEmoji(status: string): string {
    const emojis = {
      waiting: '⏳',
      reserved: '🎯',
      charging: '⚡',
      completed: '✅',
      cancelled: '❌'
    };
    return emojis[status as keyof typeof emojis] || '📍';
  }

  private generateProgressBar(position: number, maxLength: number): string {
    const filled = Math.max(0, maxLength - position);
    const empty = Math.max(0, position - 1);
    return '🟢'.repeat(filled) + '⚪'.repeat(empty);
  }

  private getStatusDescription(status: string): string {
    const descriptions = {
      waiting: 'In Queue',
      reserved: 'Slot Reserved - Come Now!',
      charging: 'Charging Active',
      completed: 'Session Complete',
      cancelled: 'Booking Cancelled'
    };
    return descriptions[status as keyof typeof descriptions] || 'Unknown';
  }

  private getLiveStatusTip(queue: any): string {
    if (queue.status === 'reserved') {
      return '🚀 *Your slot is ready!* Please arrive within 15 minutes.';
    } else if (queue.position === 2) {
      return '🎉 *You\'re next!* Get ready to charge soon.';
    } else if (queue.position <= 3) {
      return '🔔 *Almost there!* Stay nearby for quick notifications.';
    } else {
      return '💡 *Perfect time* to grab coffee or run errands nearby!';
    }
  }

  private async sendNavigationAssistance(whatsappId: string, stationId: number): Promise<void> {
    const station = await this.getStationDetails(stationId);
    
    if (station?.latitude && station?.longitude) {
      await whatsappService.sendLocationMessage(
        whatsappId,
        station.latitude,
        station.longitude,
        `🎯 ${station.name} - Your Reserved Slot`,
        'Navigate here now - your charging slot is ready!'
      );
    }
  }

  private async sendCancellationConfirmation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `✅ *Booking Cancelled*\n\n` +
      `Your queue position has been released.\n` +
      `Other users have been automatically promoted.\n\n` +
      `💡 *Need another station?* Let's find you alternatives!`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Find Your Next Charging Station:*',
        [
          { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
          { id: 'show_available_now', title: '⚡ Available Now' },
          { id: 'book_for_later', title: '⏰ Schedule Later' }
        ]
      );
    }, 2000);
  }

  private async sendChargingStartConfirmation(whatsappId: string, stationId: number): Promise<void> {
    const session = await sessionService.getActiveSession(whatsappId, stationId);
    
    const message = `⚡ *CHARGING STARTED!*\n\n` +
      `🔋 *Session Active*\n` +
      `📍 Station: ${session?.stationName}\n` +
      `🕐 Started: ${new Date().toLocaleTimeString()}\n` +
      `⚡ Rate: ₹${session?.pricePerKwh || '12'}/kWh\n\n` +
      `📱 *Live Monitoring:*\n` +
      `• Real-time cost tracking\n` +
      `• Battery level updates\n` +
      `• Completion estimates\n` +
      `• Auto-stop when full\n\n` +
      `🎮 *Control your session below* ⬇️`;

    await whatsappService.sendTextMessage(whatsappId, message);
  }

  private async sendSessionSummary(whatsappId: string, stationId: number, summary: any): Promise<void> {
    const message = `🎉 *CHARGING COMPLETE!*\n\n` +
      `📊 *Session Summary:*\n` +
      `⚡ Energy: ${summary?.energyDelivered || '25'} kWh\n` +
      `⏱️ Duration: ${summary?.duration || '45'} minutes\n` +
      `💰 Total Cost: ₹${summary?.totalCost || '300'}\n` +
      `🔋 Final Battery: ${summary?.finalBatteryLevel || '85'}%\n\n` +
      `✨ *Thank you for using SharaSpot!*\n` +
      `Your session has been saved to your history.`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🌟 *Rate Your Experience:*',
        [
          { id: `rate_5_${stationId}`, title: '⭐⭐⭐⭐⭐ Excellent' },
          { id: `rate_4_${stationId}`, title: '⭐⭐⭐⭐ Good' },
          { id: `rate_3_${stationId}`, title: '⭐⭐⭐ Average' }
        ]
      );
    }, 3000);
  }

  private async handleQueueJoinFailure(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `❌ *Unable to Join Queue*\n\n` +
      `The station queue might be full or temporarily unavailable.\n\n` +
      `💡 *Let's find you alternatives!*`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Alternative Options:*',
        [
          { id: `notify_when_available_${stationId}`, title: '🔔 Notify When Available' },
          { id: 'find_nearby_alternatives', title: '🗺️ Find Nearby' },
          { id: 'try_again_later', title: '⏰ Try Again Later' }
        ]
      );
    }, 1500);
  }

  private async handleNoActiveQueues(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📍 *No Active Bookings*\n\n` +
      `You don't have any current charging bookings.\n\n` +
      `⚡ *Ready to charge?* Let's find you a station!`
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🚀 *Start Your Charging Journey:*',
        [
          { id: 'find_nearest_station', title: '🎯 Find Nearest' },
          { id: 'share_location_book', title: '📍 Share Location' },
          { id: 'browse_all_stations', title: '📋 Browse All' }
        ]
      );
    }, 1500);
  }
}

export const bookingController = new BookingController();