// src/controllers/queue-webhook.ts - WITH PROPER EXPORTS
import { whatsappService } from '../services/whatsapp';
import { bookingController } from './booking';
import { queueService } from '../services/queue';
import { sessionService } from '../services/session';
import { analyticsService } from '../services/analytics';
import { notificationService } from '../services/notification';
import { logger } from '../utils/logger';

export class QueueWebhookController {
  /**
   * Handle all queue-related button interactions
   */
  async handleQueueButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    try {
      logger.info('🎮 Queue button interaction', { whatsappId, buttonId, buttonTitle });

      // Extract action and station ID from button ID
      const [action, ...parts] = buttonId.split('_');
      const stationId = this.extractStationId(buttonId);

      switch (action) {
        // Queue Management Actions
        case 'join':
          await this.handleJoinQueue(whatsappId, stationId, buttonId);
          break;

        case 'queue':
          await this.handleQueueActions(whatsappId, buttonId, stationId);
          break;

        case 'smart':
          await this.handleSmartActions(whatsappId, buttonId, stationId);
          break;

        case 'notify':
          await this.handleNotificationActions(whatsappId, buttonId, stationId);
          break;

        // Session Management Actions
        case 'start':
          await this.handleSessionStart(whatsappId, buttonId, stationId);
          break;

        case 'session':
          await this.handleSessionActions(whatsappId, buttonId, stationId);
          break;

        case 'extend':
          await this.handleExtendActions(whatsappId, buttonId, stationId);
          break;

        // Analytics and Information
        case 'live':
          await this.handleLiveActions(whatsappId, buttonId, stationId);
          break;

        case 'station':
          await this.handleStationActions(whatsappId, buttonId, stationId);
          break;

        case 'user':
          await this.handleUserActions(whatsappId, buttonId, stationId);
          break;

        // Alternative Actions
        case 'nearby':
          await this.handleNearbyActions(whatsappId, buttonId);
          break;

        case 'cheaper':
          await this.handleCheaperOptions(whatsappId, buttonId);
          break;

        case 'faster':
          await this.handleFasterOptions(whatsappId, buttonId);
          break;

        // Rating and Feedback
        case 'rate':
          await this.handleRating(whatsappId, buttonId, stationId);
          break;

        case 'share':
          await this.handleShareActions(whatsappId, buttonId, stationId);
          break;

        // Cancellation and Management
        case 'cancel':
          await this.handleCancelActions(whatsappId, buttonId, stationId);
          break;

        default:
          logger.warn('🤔 Unknown queue button action', { whatsappId, buttonId, action });
          await whatsappService.sendTextMessage(
            whatsappId,
            '❓ Unknown action. Please try again or type "help".'
          );
          break;
      }

    } catch (error) {
      logger.error('❌ Failed to handle queue button', { whatsappId, buttonId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
    }
  }

  /**
   * Handle queue list interactions
   */
  async handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    try {
      logger.info('📋 Queue list interaction', { whatsappId, listId, listTitle });

      const stationId = this.extractStationId(listId);

      if (listId.startsWith('queue_status_')) {
        await bookingController.handleQueueStatus(whatsappId, stationId);
      } else if (listId.startsWith('queue_estimate_')) {
        await this.sendUpdatedEstimate(whatsappId, stationId);
      } else if (listId.startsWith('queue_analytics_')) {
        await this.sendQueueAnalytics(whatsappId, stationId);
      } else if (listId.startsWith('queue_remind_')) {
        await this.setupQueueReminder(whatsappId, stationId);
      } else if (listId.startsWith('queue_cancel_')) {
        await bookingController.handleQueueCancel(whatsappId, stationId);
      } else if (listId.startsWith('queue_share_')) {
        await this.shareQueueStatus(whatsappId, stationId);
      } else if (listId.startsWith('live_analytics_')) {
        await this.sendLiveAnalytics(whatsappId, stationId);
      } else if (listId.startsWith('session_status_')) {
        await this.sendSessionStatus(whatsappId, stationId);
      } else if (listId.startsWith('session_cost_')) {
        await this.sendCostTracker(whatsappId, stationId);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown option selected. Please try again.'
        );
      }

    } catch (error) {
      logger.error('❌ Failed to handle queue list', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to process your selection.');
    }
  }

  // Private handler methods

  private async handleJoinQueue(whatsappId: string, stationId: number, buttonId: string): Promise<void> {
    if (buttonId === `join_queue_${stationId}`) {
      await bookingController.processQueueJoin(whatsappId, stationId);
    }
  }

  private async handleQueueActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `queue_status_${stationId}`) {
      await bookingController.handleQueueStatus(whatsappId, stationId);
    } else if (buttonId === `queue_cancel_${stationId}`) {
      await this.confirmCancellation(whatsappId, stationId);
    }
  }

  private async handleSmartActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `smart_schedule_${stationId}`) {
      await this.showSmartScheduling(whatsappId, stationId);
    }
  }

  private async handleNotificationActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `notify_available_${stationId}`) {
      await this.setupAvailabilityNotification(whatsappId, stationId);
    } else if (buttonId === `notify_when_ready`) {
      await this.setupReadyNotification(whatsappId, stationId);
    }
  }

  private async handleSessionStart(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `start_charging_${stationId}`) {
      await bookingController.handleChargingStart(whatsappId, stationId);
    }
  }

  private async handleSessionActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `session_pause_${stationId}`) {
      await this.pauseSession(whatsappId, stationId);
    } else if (buttonId === `session_stop_${stationId}`) {
      await this.stopSession(whatsappId, stationId);
    } else if (buttonId === `session_status_${stationId}`) {
      await this.sendSessionStatus(whatsappId, stationId);
    }
  }

  private async handleExtendActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `extend_reservation_${stationId}`) {
      await this.extendReservation(whatsappId, stationId);
    } else if (buttonId === `extend_booking_${stationId}`) {
      await this.extendBooking(whatsappId, stationId);
    }
  }

  private async handleLiveActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `live_analytics_${stationId}`) {
      await this.sendLiveAnalytics(whatsappId, stationId);
    }
  }

  private async handleStationActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `station_details_${stationId}`) {
      await this.sendDetailedStationInfo(whatsappId, stationId);
    } else if (buttonId === `station_cam_${stationId}`) {
      await this.sendStationCamera(whatsappId, stationId);
    }
  }

  private async handleUserActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `user_reviews_${stationId}`) {
      await this.sendUserReviews(whatsappId, stationId);
    }
  }

  private async handleNearbyActions(whatsappId: string, buttonId: string): Promise<void> {
    const stationId = this.extractStationId(buttonId);
    if (buttonId === `nearby_stations_${stationId}`) {
      await this.findNearbyAlternatives(whatsappId, stationId);
    }
  }

  private async handleCheaperOptions(whatsappId: string, buttonId: string): Promise<void> {
    const stationId = this.extractStationId(buttonId);
    await this.findCheaperAlternatives(whatsappId, stationId);
  }

  private async handleFasterOptions(whatsappId: string, buttonId: string): Promise<void> {
    const stationId = this.extractStationId(buttonId);
    await this.findFasterAlternatives(whatsappId, stationId);
  }

  private async handleRating(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    const rating = parseInt(buttonId.split('_')[1]);
    await this.submitRating(whatsappId, stationId, rating);
  }

  private async handleShareActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `share_booking_${stationId}`) {
      await this.shareBookingStatus(whatsappId, stationId);
    }
  }

  private async handleCancelActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId === `cancel_booking_${stationId}` || buttonId === `cancel_reservation_${stationId}`) {
      await this.confirmCancellation(whatsappId, stationId);
    }
  }

  // Implementation methods - simplified for Phase 4

  private async confirmCancellation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⚠️ *Confirm Cancellation*\n\nAre you sure you want to cancel your booking?\n\nThis action cannot be undone.'
    );
  }

  private async showSmartScheduling(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🧠 *Smart Scheduling for Station ${stationId}*\n\nAnalyzing optimal charging times...\n\nThis feature will be available in Phase 4!`
    );
  }

  private async setupAvailabilityNotification(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🔔 *Notification Set!*\n\nYou'll be alerted when station ${stationId} becomes available.\n\n📱 Smart alerts active for the next 4 hours`
    );
  }

  private async setupReadyNotification(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🔔 *Ready Notification Set*\n\nWe'll notify you when it's almost your turn at station ${stationId}.`
    );
  }

  private async sendUpdatedEstimate(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⏱️ *Updated Time Estimate*\n\nCalculating latest wait time for station ${stationId}...\n\nReal-time estimates will be available in Phase 4!`
    );
  }

  private async sendQueueAnalytics(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📊 *Queue Analytics*\n\nDetailed analytics for station ${stationId} will be available in Phase 4!\n\nThis will include:\n• Real-time utilization\n• Wait time predictions\n• Usage patterns`
    );
  }

  private async sendLiveAnalytics(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📡 *Live Station Data*\n\nReal-time monitoring for station ${stationId} coming in Phase 4!\n\nFeatures:\n• Live power output\n• Current utilization\n• Predictive analytics`
    );
  }

  private async sendSessionStatus(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Live Charging Status*\n\nSession monitoring for station ${stationId} will be available in Phase 4!\n\nTrack:\n• Battery level\n• Charging rate\n• Cost in real-time`
    );
  }

  private async sendCostTracker(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `💰 *Live Cost Tracker*\n\nReal-time cost tracking for station ${stationId} coming in Phase 4!\n\nMonitor:\n• Energy consumption\n• Current charges\n• Cost comparisons`
    );
  }

  private async pauseSession(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⏸️ *Session Control*\n\nSession pause/resume for station ${stationId} will be available in Phase 4!`
    );
  }

  private async stopSession(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🛑 *Session Control*\n\nSession stop functionality for station ${stationId} will be available in Phase 4!`
    );
  }

  private async extendReservation(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⏰ *Reservation Extension*\n\nReservation management for station ${stationId} will be available in Phase 4!`
    );
  }

  private async extendBooking(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⏰ *Booking Extension*\n\nBooking extension for station ${stationId} will be available in Phase 4!`
    );
  }

  private async shareBookingStatus(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📤 *Share Status*\n\nBooking sharing for station ${stationId} will be available in Phase 4!\n\nFeatures:\n• Share with friends\n• Live status updates\n• ETA sharing`
    );
  }

  private async submitRating(whatsappId: string, stationId: number, rating: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🌟 *Rating Submitted!*\n\nThank you for rating station ${stationId}!\n\nRating: ${rating}/5 stars\n\nDetailed feedback system coming in Phase 4!`
    );
  }

  private async sendDetailedStationInfo(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *Station Details*\n\nDetailed information for station ${stationId} will include:\n\n• Live camera feeds\n• Amenities nearby\n• User reviews\n• Technical specs\n\nComing in Phase 4!`
    );
  }

  private async sendStationCamera(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📹 *Station Camera*\n\nLive camera feed for station ${stationId} will be available in Phase 4!\n\nSee real-time:\n• Station availability\n• Queue status\n• Weather conditions`
    );
  }

  private async sendUserReviews(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `👥 *User Reviews*\n\nUser reviews and ratings for station ${stationId} coming in Phase 4!\n\nFeatures:\n• Recent reviews\n• Photo reviews\n• Rating breakdown`
    );
  }

  private async setupQueueReminder(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🔔 *Queue Reminder*\n\nSmart reminders for station ${stationId} will be available in Phase 4!\n\nGet notified:\n• When queue moves\n• 5 minutes before your turn\n• If better alternatives appear`
    );
  }

  private async shareQueueStatus(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `📤 *Share Queue Status*\n\nQueue sharing for station ${stationId} coming in Phase 4!\n\nShare:\n• Current position\n• Wait time\n• Live tracking link`
    );
  }

  private async findNearbyAlternatives(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🗺️ *Finding Alternatives*\n\nNearby alternatives to station ${stationId} will be suggested in Phase 4!\n\nFind:\n• Stations within 5km\n• Shorter wait times\n• Better prices`
    );
  }

  private async findCheaperAlternatives(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `💰 *Cheaper Options*\n\nBudget-friendly alternatives to station ${stationId} coming in Phase 4!\n\nSave money with:\n• Lower rates\n• Promotional offers\n• Off-peak pricing`
    );
  }

  private async findFasterAlternatives(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ *Faster Charging*\n\nHigh-speed alternatives to station ${stationId} coming in Phase 4!\n\nFind:\n• Super-fast chargers\n• No wait time\n• Quick top-up options`
    );
  }

  private extractStationId(buttonId: string): number {
    const match = buttonId.match(/_(\d+)$/);
    return match ? parseInt(match[1]) : 0;
  }
}

// Export both the class and an instance
export const queueWebhookController = new QueueWebhookController();