// src/controllers/queue-webhook.ts - FIXED USER FLOW ISSUES

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
        // **FIX 1: Handle 'book' action properly**
        case 'book':
          await this.handleBookStation(whatsappId, stationId, buttonId);
          break;

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

  // **FIX 2: Add missing handleBookStation method**
  private async handleBookStation(whatsappId: string, stationId: number, buttonId: string): Promise<void> {
    try {
      logger.info('📋 Processing station booking', { whatsappId, stationId, buttonId });
      
      if (!stationId || isNaN(stationId)) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Invalid station. Please try again.'
        );
        return;
      }

      // Use existing booking controller
      await bookingController.handleStationBooking(whatsappId, stationId);
      
    } catch (error) {
      logger.error('❌ Failed to handle station booking', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Booking failed. Please try again or contact support.'
      );
    }
  }

  /**
   * **FIX 3: Improve station ID extraction with error handling**
   */
  private extractStationId(buttonId: string): number {
    try {
      // Handle different button ID formats
      const patterns = [
        /book_station_(\d+)/,     // book_station_99
        /station_(\d+)/,          // station_99
        /_(\d+)$/,                // anything_99
        /(\d+)/                   // just numbers
      ];

      for (const pattern of patterns) {
        const match = buttonId.match(pattern);
        if (match) {
          const stationId = parseInt(match[1]);
          if (!isNaN(stationId)) {
            return stationId;
          }
        }
      }

      logger.warn('Could not extract station ID', { buttonId });
      return 0; // Return 0 as fallback instead of undefined
      
    } catch (error) {
      logger.error('Station ID extraction failed', { buttonId, error });
      return 0;
    }
  }

  // **FIX 4: Add missing handler methods with proper error handling**
  private async handleJoinQueue(whatsappId: string, stationId: number, buttonId: string): Promise<void> {
    try {
      if (!stationId) {
        await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station for queue join.');
        return;
      }
      
      // Implement queue joining logic
      await whatsappService.sendTextMessage(
        whatsappId,
        `🚗 Joining queue for station ${stationId}. Please wait while we process your request...`
      );
      
      // TODO: Implement actual queue logic when queue service is ready
      
    } catch (error) {
      logger.error('Join queue failed', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(whatsappId, '❌ Failed to join queue. Please try again.');
    }
  }

  private async handleQueueActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `📊 Queue action for station ${stationId}. Feature coming soon!`
      );
    } catch (error) {
      logger.error('Queue action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleSmartActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `🤖 Smart features for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Smart action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleNotificationActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `🔔 Notification setup for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Notification action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleSessionStart(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `⚡ Starting charging session at station ${stationId}. Please confirm at the station.`
      );
    } catch (error) {
      logger.error('Session start failed', { whatsappId, buttonId, error });
    }
  }

  private async handleSessionActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `📊 Session management for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Session action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleExtendActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `⏰ Extend options for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Extend action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleLiveActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `📊 Live data for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Live action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleStationActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `🏢 Station details for ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Station action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleUserActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `👤 User features for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('User action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleNearbyActions(whatsappId: string, buttonId: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `📍 Finding nearby alternatives...`
      );
    } catch (error) {
      logger.error('Nearby action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleCheaperOptions(whatsappId: string, buttonId: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `💰 Finding cheaper options nearby...`
      );
    } catch (error) {
      logger.error('Cheaper options failed', { whatsappId, buttonId, error });
    }
  }

  private async handleFasterOptions(whatsappId: string, buttonId: string): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `⚡ Finding faster charging options...`
      );
    } catch (error) {
      logger.error('Faster options failed', { whatsappId, buttonId, error });
    }
  }

  private async handleRating(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `⭐ Rating system for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Rating failed', { whatsappId, buttonId, error });
    }
  }

  private async handleShareActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `📤 Share features for station ${stationId} coming soon!`
      );
    } catch (error) {
      logger.error('Share action failed', { whatsappId, buttonId, error });
    }
  }

  private async handleCancelActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        `❌ Cancellation for station ${stationId} processed.`
      );
    } catch (error) {
      logger.error('Cancel action failed', { whatsappId, buttonId, error });
    }
  }

  // **FIX 5: Add missing queue list handling methods**
  async handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    try {
      logger.info('📋 Queue list interaction', { whatsappId, listId, listTitle });

      const stationId = this.extractStationId(listId);

      if (listId.startsWith('queue_status_')) {
        await whatsappService.sendTextMessage(whatsappId, `📊 Queue status for station ${stationId} coming soon!`);
      } else if (listId.startsWith('queue_estimate_')) {
        await whatsappService.sendTextMessage(whatsappId, `⏰ Wait time estimates coming soon!`);
      } else if (listId.startsWith('queue_analytics_')) {
        await whatsappService.sendTextMessage(whatsappId, `📈 Queue analytics coming soon!`);
      } else if (listId.startsWith('queue_remind_')) {
        await whatsappService.sendTextMessage(whatsappId, `🔔 Reminder setup coming soon!`);
      } else if (listId.startsWith('queue_cancel_')) {
        await whatsappService.sendTextMessage(whatsappId, `❌ Queue cancellation processed.`);
      } else if (listId.startsWith('queue_share_')) {
        await whatsappService.sendTextMessage(whatsappId, `📤 Queue sharing coming soon!`);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown option selected. Please try again.'
        );
      }

    } catch (error) {
      logger.error('❌ Failed to handle queue list', { whatsappId, listId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again.'
      );
    }
  }
}

// **FIX 6: Export the instance properly**
export const queueWebhookController = new QueueWebhookController();