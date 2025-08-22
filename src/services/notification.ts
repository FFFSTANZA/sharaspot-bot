// src/services/notification.ts
import { whatsappService } from './whatsapp';
import { userService } from './user';
import { logger } from '../utils/logger';
import { chargingStations } from '../db/schema';
import { db } from '../db/connection';
import { eq } from 'drizzle-orm';

interface NotificationSchedule {
  userWhatsapp: string;
  stationId: number;
  type: 'reservation_expiry' | 'queue_reminder' | 'maintenance_alert';
  scheduledTime: Date;
  message?: string;
}

class NotificationService {
  private scheduledNotifications = new Map<string, NodeJS.Timeout>();

  /**
   * Send queue joined notification with rich content
   */
  async sendQueueJoinedNotification(userWhatsapp: string, queuePosition: any): Promise<void> {
    try {
      const station = await this.getStationDetails(queuePosition.stationId);
      
      const message = this.formatQueueJoinedMessage(queuePosition, station);
      
      // Send main notification
      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send interactive list with queue options
      setTimeout(async () => {
        await whatsappService.sendListMessage(
          userWhatsapp,
          '⚡ *Queue Management Options*',
          'Choose an action for your booking:',
          [
            {
              title: '📊 Queue Status',
              rows: [
                { id: `queue_status_${queuePosition.stationId}`, title: '📍 My Position', description: 'Check current queue status' },
                { id: `queue_estimate_${queuePosition.stationId}`, title: '⏱️ Time Estimate', description: 'Get updated wait time' },
                { id: `queue_analytics_${queuePosition.stationId}`, title: '📈 Queue Analytics', description: 'View station insights' }
              ]
            },
            {
              title: '🔧 Queue Actions',
              rows: [
                { id: `queue_remind_${queuePosition.stationId}`, title: '🔔 Reminder', description: 'Get notified 10 min before' },
                { id: `queue_cancel_${queuePosition.stationId}`, title: '❌ Leave Queue', description: 'Cancel your booking' },
                { id: `queue_share_${queuePosition.stationId}`, title: '📤 Share Status', description: 'Share with someone' }
              ]
            }
          ]
        );
      }, 2000);

    } catch (error) {
      logger.error('Failed to send queue joined notification', { userWhatsapp, error });
    }
  }

  /**
   * Send reservation confirmation with countdown
   */
  async sendReservationConfirmation(userWhatsapp: string, stationId: number, reservationMinutes: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const expiryTime = new Date(Date.now() + (reservationMinutes * 60 * 1000));
      
      const message = `🎉 *SLOT RESERVED!*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `📍 ${station?.address || 'Loading address...'}\n\n` +
        `⏰ *Reservation Expires:* ${expiryTime.toLocaleTimeString()}\n` +
        `⏳ *You have ${reservationMinutes} minutes* to arrive\n\n` +
        `🚗 *Next Steps:*\n` +
        `• Navigate to the station now\n` +
        `• Scan QR code or tap "Start Charging"\n` +
        `• Your charging slot is secured!\n\n` +
        `💡 *Pro Tip:* Enable location sharing for real-time navigation assistance`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send location if available
      if (station?.latitude && station?.longitude) {
        setTimeout(async () => {
          await whatsappService.sendLocationMessage(
            userWhatsapp,
            station.latitude,
            station.longitude,
            `${station.name} - Your Reserved Slot`,
            station.address || ''
          );
        }, 1000);
      }

      // Send action buttons
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          `🚀 *Ready to charge?*\n\nArrive at the station and select an option:`,
          [
            { id: `start_charging_${stationId}`, title: '⚡ Start Charging' },
            { id: `extend_reservation_${stationId}`, title: '⏰ Extend Time' },
            { id: `cancel_reservation_${stationId}`, title: '❌ Cancel' }
          ]
        );
      }, 3000);

    } catch (error) {
      logger.error('Failed to send reservation confirmation', { userWhatsapp, stationId, error });
    }
  }

  /**
   * Send charging started notification with session tracking
   */
  async sendChargingStartedNotification(userWhatsapp: string, stationId: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const user = await userService.getUserByWhatsAppId(userWhatsapp);
      
      const message = `⚡ *CHARGING STARTED!*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `🔋 *Vehicle:* ${user?.evModel || 'Your EV'}\n` +
        `🔌 *Connector:* ${user?.connectorType || 'Standard'}\n\n` +
        `🎯 *Session Active*\n` +
        `• Charging in progress...\n` +
        `• Real-time monitoring enabled\n` +
        `• Auto-notifications every 30 minutes\n\n` +
        `💰 *Billing:* ₹${station?.pricePerKwh || '12'}/kWh\n` +
        `⏱️ *Started:* ${new Date().toLocaleTimeString()}\n\n` +
        `🔔 You'll receive updates automatically!`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send session management options
      setTimeout(async () => {
        await whatsappService.sendListMessage(
          userWhatsapp,
          '🎛️ *Charging Session Control*',
          'Manage your charging session:',
          [
            {
              title: '📊 Session Info',
              rows: [
                { id: `session_status_${stationId}`, title: '⚡ Current Status', description: 'View charging progress' },
                { id: `session_estimate_${stationId}`, title: '⏱️ Time Estimate', description: 'Completion time estimate' },
                { id: `session_cost_${stationId}`, title: '💰 Cost Tracker', description: 'Real-time cost calculation' }
              ]
            },
            {
              title: '🔧 Session Control',
              rows: [
                { id: `session_pause_${stationId}`, title: '⏸️ Pause Charging', description: 'Temporarily stop charging' },
                { id: `session_stop_${stationId}`, title: '🛑 Stop & Complete', description: 'End charging session' },
                { id: `session_extend_${stationId}`, title: '⏰ Extend Session', description: 'Add more time if needed' }
              ]
            }
          ]
        );
      }, 2000);

    } catch (error) {
      logger.error('Failed to send charging started notification', { userWhatsapp, stationId, error });
    }
  }

  /**
   * Send charging completed notification with summary
   */
  async sendChargingCompletedNotification(userWhatsapp: string, stationId: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const sessionSummary = await this.generateSessionSummary(userWhatsapp, stationId);
      
      const message = `✅ *CHARGING COMPLETE!*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `🕐 *Completed:* ${new Date().toLocaleTimeString()}\n\n` +
        `📊 *Session Summary:*\n` +
        `⚡ Energy: ${sessionSummary.energyDelivered} kWh\n` +
        `⏱️ Duration: ${sessionSummary.duration} minutes\n` +
        `💰 Total Cost: ₹${sessionSummary.totalCost}\n` +
        `🔋 Battery: ${sessionSummary.batteryLevel}% charged\n\n` +
        `🎉 *Thank you for using SharaSpot!*\n` +
        `Your charging session has been saved to your history.\n\n` +
        `📱 *Rate your experience* to help us improve!`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send rating and next actions
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          `🌟 *How was your charging experience?*\n\nYour feedback helps us improve!`,
          [
            { id: `rate_session_5_${stationId}`, title: '⭐⭐⭐⭐⭐ Excellent' },
            { id: `rate_session_4_${stationId}`, title: '⭐⭐⭐⭐ Good' },
            { id: `rate_session_3_${stationId}`, title: '⭐⭐⭐ Average' }
          ]
        );
      }, 2000);

      // Send next journey options
      setTimeout(async () => {
        await whatsappService.sendListMessage(
          userWhatsapp,
          '🚀 *What\'s Next?*',
          'Continue your journey with SharaSpot:',
          [
            {
              title: '🔍 Discover More',
              rows: [
                { id: 'find_nearby_stations', title: '🗺️ Find Nearby', description: 'Discover other charging stations' },
                { id: 'view_session_history', title: '📊 My History', description: 'View past charging sessions' },
                { id: 'explore_features', title: '✨ Explore Features', description: 'Learn about new features' }
              ]
            },
            {
              title: '⚡ Quick Actions',
              rows: [
                { id: 'book_again_same', title: '🔄 Book Again Here', description: 'Reserve another session' },
                { id: 'recommend_friends', title: '👥 Invite Friends', description: 'Share SharaSpot with others' },
                { id: 'setup_preferences', title: '⚙️ Update Preferences', description: 'Customize your experience' }
              ]
            }
          ]
        );
      }, 4000);

    } catch (error) {
      logger.error('Failed to send charging completed notification', { userWhatsapp, stationId, error });
    }
  }

  /**
   * Send queue left notification
   */
  async sendQueueLeftNotification(userWhatsapp: string, stationId: number, reason: string): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      let message = '';
      
      switch (reason) {
        case 'user_cancelled':
          message = `✅ *BOOKING CANCELLED*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `🕐 *Cancelled:* ${new Date().toLocaleTimeString()}\n\n` +
            `Your queue position has been released.\n` +
            `Other users have been automatically promoted.\n\n` +
            `💡 *Need another station?* Let's find you alternatives!`;
          break;
          
        case 'expired':
          message = `⏰ *RESERVATION EXPIRED*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `🕐 *Expired:* ${new Date().toLocaleTimeString()}\n\n` +
            `Your 15-minute reservation window has ended.\n` +
            `The slot has been released to the next user.\n\n` +
            `🔄 *Want to try again?* You can rejoin the queue!`;
          break;
          
        default:
          message = `📝 *QUEUE STATUS UPDATED*\n\n` +
            `📍 *${station?.name || 'Charging Station'}*\n` +
            `Your booking status has been updated.\n\n` +
            `💡 *Looking for alternatives?* We can help!`;
      }

      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send alternative actions
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '🔍 *What would you like to do next?*',
          [
            { id: `rejoin_queue_${stationId}`, title: '🔄 Rejoin Queue' },
            { id: 'find_alternatives', title: '🗺️ Find Alternatives' },
            { id: 'schedule_later', title: '⏰ Schedule Later' }
          ]
        );
      }, 2000);

    } catch (error) {
      logger.error('Failed to send queue left notification', { userWhatsapp, stationId, reason, error });
    }
  }

  /**
   * Send queue progress notification
   */
  async sendQueueProgressNotification(userWhatsapp: string, stationId: number, position: number, waitTime: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const expectedTime = new Date(Date.now() + (waitTime * 60 * 1000)).toLocaleTimeString();
      
      let message = '';
      let emoji = '';
      
      if (position === 1) {
        emoji = '🎯';
        message = `${emoji} *YOU'RE NEXT!*\n\n` +
          `📍 *${station?.name || 'Charging Station'}*\n` +
          `🏆 *Position:* #${position} (FIRST!)\n` +
          `⏱️ *Expected:* ${expectedTime}\n\n` +
          `🚀 *Get ready!* Your slot will be reserved automatically.\n` +
          `Start heading to the station now!`;
      } else if (position === 2) {
        emoji = '🔥';
        message = `${emoji} *ALMOST THERE!*\n\n` +
          `📍 *${station?.name || 'Charging Station'}*\n` +
          `🎯 *Position:* #${position}\n` +
          `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
          `🕐 *Expected:* ${expectedTime}\n\n` +
          `🎉 *You're next in line!* Stay nearby for quick notifications.`;
      } else {
        emoji = '📈';
        message = `${emoji} *QUEUE PROGRESS UPDATE*\n\n` +
          `📍 *${station?.name || 'Charging Station'}*\n` +
          `📍 *Your Position:* #${position}\n` +
          `⏱️ *Updated Wait:* ${waitTime} minutes\n` +
          `🕐 *Expected:* ${expectedTime}\n\n` +
          `🚶‍♂️ *Queue is moving!* ${this.getProgressTip(position, waitTime)}`;
      }

      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send management options for users in position 1-3
      if (position <= 3) {
        setTimeout(async () => {
          await whatsappService.sendButtonMessage(
            userWhatsapp,
            position === 1 ? '🎯 *Your turn is coming!*' : '📊 *Manage your booking:*',
            [
              { id: `live_status_${stationId}`, title: '📡 Live Status' },
              { id: `share_position_${stationId}`, title: '📤 Share Position' },
              { id: `cancel_booking_${stationId}`, title: '❌ Cancel' }
            ]
          );
        }, 1500);
      }

    } catch (error) {
      logger.error('Failed to send queue progress notification', { userWhatsapp, stationId, position, waitTime, error });
    }
  }

  /**
   * Schedule reservation expiry notification
   */
  async scheduleReservationExpiry(userWhatsapp: string, stationId: number, expiryTime: Date): Promise<void> {
    try {
      const notificationKey = `expiry_${userWhatsapp}_${stationId}`;
      
      // Clear existing notification if any
      const existing = this.scheduledNotifications.get(notificationKey);
      if (existing) {
        clearTimeout(existing);
      }

      // Schedule warning 5 minutes before expiry
      const warningTime = new Date(expiryTime.getTime() - (5 * 60 * 1000));
      const warningDelay = warningTime.getTime() - Date.now();
      
      if (warningDelay > 0) {
        const warningTimeout = setTimeout(async () => {
          await this.sendReservationWarning(userWhatsapp, stationId, 5);
        }, warningDelay);
        
        this.scheduledNotifications.set(`warning_${notificationKey}`, warningTimeout);
      }

      // Schedule final expiry notification
      const expiryDelay = expiryTime.getTime() - Date.now();
      if (expiryDelay > 0) {
        const expiryTimeout = setTimeout(async () => {
          await this.sendReservationExpired(userWhatsapp, stationId);
          this.scheduledNotifications.delete(notificationKey);
        }, expiryDelay);
        
        this.scheduledNotifications.set(notificationKey, expiryTimeout);
      }

      logger.info('Reservation expiry notifications scheduled', { 
        userWhatsapp, 
        stationId, 
        expiryTime,
        warningDelay,
        expiryDelay
      });

    } catch (error) {
      logger.error('Failed to schedule reservation expiry', { userWhatsapp, stationId, expiryTime, error });
    }
  }

  /**
   * Send reservation warning (5 minutes before expiry)
   */
  private async sendReservationWarning(userWhatsapp: string, stationId: number, minutesLeft: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      
      const message = `⚠️ *RESERVATION EXPIRING SOON!*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `⏰ *${minutesLeft} minutes left* to arrive\n\n` +
        `🚗 *Please hurry!* Your reserved slot will be released if you don't arrive in time.\n\n` +
        `📍 *Need directions?* Tap below for navigation.`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      // Send quick action buttons
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '⚡ *Quick Actions:*',
          [
            { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
            { id: `extend_time_${stationId}`, title: '⏰ Extend Time' },
            { id: `cancel_urgent_${stationId}`, title: '❌ Cancel Now' }
          ]
        );
      }, 1000);

      // Send location if available
      if (station?.latitude && station?.longitude) {
        setTimeout(async () => {
          await whatsappService.sendLocationMessage(
            userWhatsapp,
            station.latitude,
            station.longitude,
            `🚨 ${station.name} - HURRY! ${minutesLeft} min left`,
            'Your reserved charging slot'
          );
        }, 2000);
      }

    } catch (error) {
      logger.error('Failed to send reservation warning', { userWhatsapp, stationId, minutesLeft, error });
    }
  }

  /**
   * Send reservation expired notification
   */
  private async sendReservationExpired(userWhatsapp: string, stationId: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      
      const message = `💔 *RESERVATION EXPIRED*\n\n` +
        `📍 *${station?.name || 'Charging Station'}*\n` +
        `🕐 *Expired:* ${new Date().toLocaleTimeString()}\n\n` +
        `⏰ *Time's up!* Your 15-minute reservation window has ended.\n` +
        `The charging slot has been automatically released.\n\n` +
        `🔄 *Don't worry!* You can rejoin the queue or find alternatives.`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '🔄 *What would you like to do?*',
          [
            { id: `rejoin_queue_${stationId}`, title: '🔄 Rejoin Queue' },
            { id: 'find_nearby_alternatives', title: '🗺️ Find Nearby' },
            { id: 'schedule_for_later', title: '⏰ Schedule Later' }
          ]
        );
      }, 2000);

    } catch (error) {
      logger.error('Failed to send reservation expired notification', { userWhatsapp, stationId, error });
    }
  }

  /**
   * Notify station owner about queue events
   */
  async notifyStationOwner(stationId: number, eventType: string, data: any): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      const ownerWhatsapp = station?.ownerWhatsappId;
      
      if (!ownerWhatsapp) {
        logger.warn('No owner WhatsApp ID found for station', { stationId });
        return;
      }

      let message = '';
      
      switch (eventType) {
        case 'queue_joined':
          message = `📈 *New Customer*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer joined queue\n` +
            `📍 Position: #${data.position}\n` +
            `🕐 ${new Date().toLocaleTimeString()}`;
          break;
          
        case 'queue_left':
          message = `📉 *Customer Left*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer left queue\n` +
            `📍 Was position: #${data.position}\n` +
            `📝 Reason: ${data.reason}`;
          break;
          
        case 'slot_reserved':
          message = `🎯 *Slot Reserved*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer reserved slot\n` +
            `⏰ Expires: ${data.expiryTime.toLocaleTimeString()}`;
          break;
          
        case 'charging_started':
          message = `⚡ *Charging Started*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer started charging\n` +
            `🕐 ${new Date().toLocaleTimeString()}`;
          break;
          
        case 'charging_completed':
          message = `✅ *Session Complete*\n\n` +
            `🏢 *${station.name}*\n` +
            `👤 Customer completed charging\n` +
            `🕐 ${new Date().toLocaleTimeString()}`;
          break;
      }

      if (message) {
        await whatsappService.sendTextMessage(ownerWhatsapp, message);
        logger.info('Station owner notified', { stationId, ownerWhatsapp, eventType });
      }

    } catch (error) {
      logger.error('Failed to notify station owner', { stationId, eventType, data, error });
    }
  }

  /**
   * Send session-related notifications
   */
  async sendSessionStartNotification(userWhatsapp: string, session: any): Promise<void> {
    try {
      const message = `⚡ *SESSION MONITORING ACTIVE*\n\n` +
        `📱 *Live tracking enabled for your charging session*\n\n` +
        `🔄 *You'll receive updates every 30 minutes*\n` +
        `📊 *Real-time cost and progress tracking*\n` +
        `🔔 *Auto-notification when 80% charged*\n` +
        `⚡ *Auto-stop when target reached*\n\n` +
        `💡 *Tip:* Keep your phone nearby for important updates!`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session start notification', { userWhatsapp, session, error });
    }
  }

  async sendSessionPausedNotification(userWhatsapp: string, session: any): Promise<void> {
    try {
      const message = `⏸️ *CHARGING PAUSED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🕐 *Paused:* ${new Date().toLocaleTimeString()}\n\n` +
        `⏰ *Your slot is reserved for 10 minutes*\n` +
        `🔄 *Charging will auto-resume if not manually stopped*\n\n` +
        `💡 *Resume anytime from your session controls*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session paused notification', { userWhatsapp, session, error });
    }
  }

  async sendSessionResumedNotification(userWhatsapp: string, session: any): Promise<void> {
    try {
      const message = `▶️ *CHARGING RESUMED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🕐 *Resumed:* ${new Date().toLocaleTimeString()}\n\n` +
        `⚡ *Charging is now active again*\n` +
        `📊 *Live monitoring continues*\n` +
        `🔔 *You'll receive progress updates*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session resumed notification', { userWhatsapp, session, error });
    }
  }

  async sendSessionProgressNotification(userWhatsapp: string, session: any, progress: any): Promise<void> {
    try {
      const message = `📊 *CHARGING PROGRESS UPDATE*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🔋 *Battery:* ${progress.currentBatteryLevel}%\n` +
        `⚡ *Power:* ${progress.chargingRate} kW\n` +
        `💰 *Cost so far:* ₹${progress.currentCost}\n` +
        `⏱️ *Est. completion:* ${progress.estimatedCompletion}\n\n` +
        `${progress.statusMessage}`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session progress notification', { userWhatsapp, session, progress, error });
    }
  }

  async sendSessionCompletedNotification(userWhatsapp: string, session: any, summary: any): Promise<void> {
    try {
      const message = `🎉 *CHARGING SESSION COMPLETE!*\n\n` +
        `📍 *${session.stationName}*\n` +
        `⏱️ *Duration:* ${summary.duration}\n` +
        `⚡ *Energy:* ${summary.energyDelivered} kWh\n` +
        `💰 *Total Cost:* ₹${summary.totalCost}\n` +
        `🔋 *Final Battery:* ${summary.finalBatteryLevel}%\n\n` +
        `✨ *Session saved to your history*\n` +
        `📊 *Rate your experience to help others*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session completed notification', { userWhatsapp, session, summary, error });
    }
  }

  async sendSessionExtendedNotification(userWhatsapp: string, session: any, newTarget: number): Promise<void> {
    try {
      const message = `⏰ *SESSION EXTENDED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `🎯 *New Target:* ${newTarget}%\n` +
        `🔋 *Current:* ${session.currentBatteryLevel}%\n\n` +
        `⚡ *Charging will continue to your new target*\n` +
        `📊 *Updated estimates will be sent*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session extended notification', { userWhatsapp, session, newTarget, error });
    }
  }

  async sendAnomalyAlert(userWhatsapp: string, session: any, status: any): Promise<void> {
    try {
      const message = `⚠️ *CHARGING ANOMALY DETECTED*\n\n` +
        `📍 *${session.stationName}*\n` +
        `📊 *Issue:* Lower than expected charging rate\n` +
        `⚡ *Current Rate:* ${status.chargingRate} kW\n` +
        `📈 *Expected:* ${session.chargingRate} kW\n\n` +
        `🔧 *Station team has been notified*\n` +
        `📞 *Contact support if issues persist*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send anomaly alert', { userWhatsapp, session, status, error });
    }
  }

  /**
   * Advanced notification methods
   */
  async sendAvailabilityAlert(userWhatsapp: string, stationId: number, analytics: any): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      
      const message = `🚨 *STATION AVAILABLE!*\n\n` +
        `📍 *${station?.name}*\n` +
        `🟢 *Queue Length:* ${analytics.currentQueueLength} people\n` +
        `⏱️ *Wait Time:* ${analytics.estimatedWaitTime} minutes\n\n` +
        `⚡ *Perfect time to charge!*\n` +
        `🚀 *Book now for quick access*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          userWhatsapp,
          '🎯 *Quick Actions:*',
          [
            { id: `quick_book_${stationId}`, title: '⚡ Book Now' },
            { id: `get_directions_${stationId}`, title: '🗺️ Directions' },
            { id: `dismiss_alert_${stationId}`, title: '❌ Dismiss' }
          ]
        );
      }, 1000);

    } catch (error) {
      logger.error('Failed to send availability alert', { userWhatsapp, stationId, analytics, error });
    }
  }

  async sendPromotionNotification(userWhatsapp: string, stationId: number, newPosition: number): Promise<void> {
    try {
      const station = await this.getStationDetails(stationId);
      
      const message = `📈 *QUEUE POSITION UPDATED!*\n\n` +
        `📍 *${station?.name}*\n` +
        `🎯 *New Position:* #${newPosition}\n` +
        `⏱️ *You moved up in the queue!*\n\n` +
        `${newPosition === 1 ? '🎉 *You\'re next!* Get ready for your slot.' : 
          newPosition === 2 ? '🔥 *Almost there!* You\'re second in line.' : 
          '📊 *Progress!* You\'re getting closer.'}`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send promotion notification', { userWhatsapp, stationId, newPosition, error });
    }
  }

  async sendSessionReminder(userWhatsapp: string, stationId: number, status: any): Promise<void> {
    try {
      const message = `🔔 *CHARGING REMINDER*\n\n` +
        `🔋 *Your battery is now ${status.currentBatteryLevel}%*\n` +
        `⏱️ *Est. completion:* ${status.estimatedCompletion}\n\n` +
        `💡 *Your EV is almost ready!*\n` +
        `🚗 *Plan your departure accordingly*`;

      await whatsappService.sendTextMessage(userWhatsapp, message);

    } catch (error) {
      logger.error('Failed to send session reminder', { userWhatsapp, stationId, status, error });
    }
  }

  // Helper methods

  private async getStationDetails(stationId: number): Promise<any> {
    try {
      const stations = await db.select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);
      
      return stations[0] || null;
    } catch (error) {
      logger.error('Failed to get station details', { stationId, error });
      return null;
    }
  }

  private formatQueueJoinedMessage(queuePosition: any, station: any): string {
    const waitTime = queuePosition.estimatedWaitMinutes;
    const expectedTime = new Date(Date.now() + (waitTime * 60 * 1000)).toLocaleTimeString();
    
    return `🎉 *BOOKING CONFIRMED!*\n\n` +
      `📍 *${station?.name || 'Charging Station'}*\n` +
      `🎯 *Your Position:* #${queuePosition.position}\n` +
      `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
      `🕐 *Expected Time:* ${expectedTime}\n\n` +
      `✨ *What happens next:*\n` +
      `• Live position updates every 5 minutes\n` +
      `• Auto-reservation when you're #1\n` +
      `• Navigation assistance when ready\n` +
      `• Smart notifications throughout\n\n` +
      `🎮 *Manage your booking with options below* ⬇️`;
  }

  private async generateSessionSummary(userWhatsapp: string, stationId: number): Promise<any> {
    // In real implementation, get from session service
    return {
      energyDelivered: 25.5,
      duration: 45,
      totalCost: 306,
      batteryLevel: 85
    };
  }

  private getProgressTip(position: number, waitTime: number): string {
    if (position <= 3) {
      return 'Stay nearby for quick notifications!';
    } else if (waitTime < 30) {
      return 'Great time to grab a coffee nearby!';
    } else if (waitTime < 60) {
      return 'Perfect for a quick meal or errands!';
    } else {
      return 'Consider exploring nearby attractions!';
    }
  }

  /**
   * Clear all scheduled notifications for a user
   */
  clearUserNotifications(userWhatsapp: string): void {
    for (const [key, timeout] of this.scheduledNotifications.entries()) {
      if (key.includes(userWhatsapp)) {
        clearTimeout(timeout);
        this.scheduledNotifications.delete(key);
      }
    }
    
    logger.info('Cleared scheduled notifications for user', { userWhatsapp });
  }

  /**
   * Get notification statistics
   */
  getNotificationStats(): any {
    return {
      scheduledNotifications: this.scheduledNotifications.size,
      activeKeys: Array.from(this.scheduledNotifications.keys())
    };
  }
}

export const notificationService = new NotificationService();