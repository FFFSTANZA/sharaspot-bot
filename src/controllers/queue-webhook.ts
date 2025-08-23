// src/controllers/queue-webhook.ts - Fixed and Optimized Implementation
import { whatsappService } from '../services/whatsapp';
import { bookingController } from './booking';
import { queueService } from '../services/queue';
import { sessionService } from '../services/session';
import { analyticsService } from '../services/analytics';
import { notificationService } from '../services/notification';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

// Type-safe action types
type QueueAction = 
  | 'book' | 'join' | 'queue' 
  | 'start' | 'session' | 'extend'
  | 'live' | 'station' | 'user'
  | 'nearby' | 'cheaper' | 'faster'
  | 'rate' | 'share' | 'cancel'
  | 'confirm';

// Standardized button ID patterns - More specific patterns first
const BUTTON_ID_PATTERNS = {
  BOOK_STATION: /^book_station_(\d+)$/,
  JOIN_QUEUE: /^join_queue_(\d+)$/,
  CONFIRM_CANCEL: /^confirm_cancel_(\d+)$/,
  STATION_INFO: /^station_info_(\d+)$/,
  QUEUE_STATUS: /^queue_status_(\d+)$/,
  SESSION_START: /^start_session_(\d+)$/,
  EXTEND_SESSION: /^extend_(\d+)_(\d+)$/, // extend_minutes_stationId
  RATE_STATION: /^rate_(\d)_(\d+)$/, // rate_score_stationId
  GENERAL_STATION: /^(?:.*_)?station_(\d+)$/,
  GENERAL_ACTION: /^.*_(\d+)$/,
  NUMERIC_ONLY: /^(\d+)$/
};

export class QueueWebhookController {
  /**
   * Handle all queue-related button interactions
   */
  async handleQueueButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    try {
      // Validate WhatsApp ID
      if (!validateWhatsAppId(whatsappId)) {
        logger.error('Invalid WhatsApp ID format', { whatsappId });
        return;
      }

      logger.info('Queue button interaction', { whatsappId, buttonId, buttonTitle });

      // Extract action and station ID from button ID
      const { action, stationId, additionalData } = this.parseButtonId(buttonId);

      // Handle actions based on type
      switch (action) {
        // Booking & Queue Actions
        case 'book':
          await this.handleBookStation(whatsappId, stationId, buttonId);
          break;

        case 'join':
          await this.handleJoinQueue(whatsappId, stationId, buttonId);
          break;

        case 'queue':
          await this.handleQueueActions(whatsappId, buttonId, stationId);
          break;

        // Session Actions
        case 'start':
          await this.handleSessionStart(whatsappId, stationId);
          break;

        case 'session':
          await this.handleSessionActions(whatsappId, stationId);
          break;

        case 'extend':
          await this.handleSessionExtension(whatsappId, stationId, additionalData);
          break;

        // Information Actions
        case 'live':
          await this.handleLiveUpdates(whatsappId, stationId);
          break;

        case 'station':
          await this.handleStationInfo(whatsappId, stationId);
          break;

        case 'user':
          await this.handleUserOptions(whatsappId, buttonId);
          break;

        // Alternative Actions
        case 'nearby':
          await this.handleNearbyStations(whatsappId, buttonId);
          break;

        case 'cheaper':
          await this.handleCheaperOptions(whatsappId, buttonId);
          break;

        case 'faster':
          await this.handleFasterOptions(whatsappId, buttonId);
          break;

        // Misc Actions
        case 'rate':
          await this.handleRating(whatsappId, buttonId, stationId, additionalData);
          break;

        case 'share':
          await this.handleShareActions(whatsappId, buttonId, stationId);
          break;

        case 'cancel':
          await this.handleCancelActions(whatsappId, buttonId, stationId);
          break;

        case 'confirm':
          await this.handleConfirmActions(whatsappId, buttonId, stationId);
          break;

        default:
          logger.warn('Unknown queue button action', { whatsappId, buttonId, action });
          await whatsappService.sendTextMessage(
            whatsappId,
            '❓ Unknown action. Please try again or type "help".'
          );
      }
    } catch (error) {
      logger.error('Failed to handle queue button', { 
        whatsappId, 
        buttonId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again or type "help" for assistance.'
      );
    }
  }

  /**
   * Handle list selection for queue-related options
   */
  async handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    try {
      // Validate WhatsApp ID
      if (!validateWhatsAppId(whatsappId)) {
        logger.error('Invalid WhatsApp ID format', { whatsappId });
        return;
      }

      logger.info('Queue list interaction', { whatsappId, listId, listTitle });

      // Extract station ID if present
      const { stationId } = this.parseButtonId(listId);

      // Process based on list type pattern
      if (listId.startsWith('queue_status_')) {
        await this.handleQueueStatus(whatsappId, stationId);
      } else if (listId.startsWith('queue_estimate_')) {
        await this.handleWaitEstimates(whatsappId, stationId);
      } else if (listId.startsWith('queue_analytics_')) {
        await this.handleQueueAnalytics(whatsappId, stationId);
      } else if (listId.startsWith('queue_remind_')) {
        await this.handleQueueReminders(whatsappId, stationId);
      } else if (listId.startsWith('queue_cancel_')) {
        await this.handleQueueCancellation(whatsappId, stationId);
      } else if (listId.startsWith('queue_share_')) {
        await this.handleQueueSharing(whatsappId, stationId);
      } else if (listId.startsWith('select_station_')) {
        // Delegate station selection to booking controller
        await bookingController.handleStationSelection(whatsappId, stationId);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Unknown option selected. Please try again or type "help" for assistance.'
        );
      }
    } catch (error) {
      logger.error('Failed to handle queue list', { 
        whatsappId, 
        listId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Please try again or type "help" for assistance.'
      );
    }
  }

  /**
   * Enhanced button ID parsing with consistent pattern matching
   */
  private parseButtonId(buttonId: string): { action: string; stationId: number; additionalData?: number } {
    if (!buttonId) {
      return { action: '', stationId: 0 };
    }

    try {
      // Try specific patterns first (most specific to least specific)
      
      // Handle extend session: extend_30_123 -> minutes=30, stationId=123
      const extendMatch = buttonId.match(BUTTON_ID_PATTERNS.EXTEND_SESSION);
      if (extendMatch) {
        return {
          action: 'extend',
          stationId: parseInt(extendMatch[2], 10),
          additionalData: parseInt(extendMatch[1], 10) // minutes
        };
      }

      // Handle rating: rate_5_123 -> rating=5, stationId=123
      const rateMatch = buttonId.match(BUTTON_ID_PATTERNS.RATE_STATION);
      if (rateMatch) {
        return {
          action: 'rate',
          stationId: parseInt(rateMatch[2], 10),
          additionalData: parseInt(rateMatch[1], 10) // rating score
        };
      }

      // Handle confirm cancel: confirm_cancel_123
      const confirmCancelMatch = buttonId.match(BUTTON_ID_PATTERNS.CONFIRM_CANCEL);
      if (confirmCancelMatch) {
        return {
          action: 'confirm',
          stationId: parseInt(confirmCancelMatch[1], 10)
        };
      }

      // Handle book station: book_station_123
      const bookMatch = buttonId.match(BUTTON_ID_PATTERNS.BOOK_STATION);
      if (bookMatch) {
        return {
          action: 'book',
          stationId: parseInt(bookMatch[1], 10)
        };
      }

      // Handle join queue: join_queue_123
      const joinMatch = buttonId.match(BUTTON_ID_PATTERNS.JOIN_QUEUE);
      if (joinMatch) {
        return {
          action: 'join',
          stationId: parseInt(joinMatch[1], 10)
        };
      }

      // Handle station info: station_info_123
      const stationInfoMatch = buttonId.match(BUTTON_ID_PATTERNS.STATION_INFO);
      if (stationInfoMatch) {
        return {
          action: 'station',
          stationId: parseInt(stationInfoMatch[1], 10)
        };
      }

      // Handle queue status: queue_status_123
      const queueStatusMatch = buttonId.match(BUTTON_ID_PATTERNS.QUEUE_STATUS);
      if (queueStatusMatch) {
        return {
          action: 'queue',
          stationId: parseInt(queueStatusMatch[1], 10)
        };
      }

      // Handle session start: start_session_123
      const sessionStartMatch = buttonId.match(BUTTON_ID_PATTERNS.SESSION_START);
      if (sessionStartMatch) {
        return {
          action: 'start',
          stationId: parseInt(sessionStartMatch[1], 10)
        };
      }

      // Generic patterns
      const parts = buttonId.split('_');
      const action = parts[0];

      // Try general station pattern
      const generalStationMatch = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_STATION);
      if (generalStationMatch) {
        return {
          action,
          stationId: parseInt(generalStationMatch[1], 10)
        };
      }

      // Try general action pattern
      const generalActionMatch = buttonId.match(BUTTON_ID_PATTERNS.GENERAL_ACTION);
      if (generalActionMatch) {
        return {
          action,
          stationId: parseInt(generalActionMatch[1], 10)
        };
      }

      // Try numeric only pattern
      const numericMatch = buttonId.match(BUTTON_ID_PATTERNS.NUMERIC_ONLY);
      if (numericMatch) {
        return {
          action: 'station', // Default action for numeric IDs
          stationId: parseInt(numericMatch[1], 10)
        };
      }

      logger.warn('Could not parse button ID', { buttonId });
      return { action, stationId: 0 };

    } catch (error) {
      logger.error('Button ID parsing failed', { 
        buttonId, 
        error: error instanceof Error ? error.message : String(error)
      });
      return { action: '', stationId: 0 };
    }
  }

  // ===============================================
  // BOOKING & QUEUE HANDLERS
  // ===============================================

  /**
   * Handle station booking request - Delegate to booking controller
   */
  private async handleBookStation(whatsappId: string, stationId: number, buttonId: string): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid station ID. Please try selecting a station again.'
      );
      return;
    }

    logger.info('Processing station booking', { whatsappId, stationId, buttonId });
    
    // Delegate to booking controller for consistent handling
    await bookingController.handleStationBooking(whatsappId, stationId);
  }

  /**
   * Handle queue joining - Delegate to booking controller
   */
  private async handleJoinQueue(whatsappId: string, stationId: number, buttonId: string): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid station for queue. Please try selecting a station again.'
      );
      return;
    }

    logger.info('Processing queue join request', { whatsappId, stationId });
    
    // Delegate to booking controller for consistent handling
    await bookingController.processQueueJoin(whatsappId, stationId);
  }

  /**
   * Handle queue management actions
   */
  private async handleQueueActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    // Secondary actions based on button ID details
    const subAction = buttonId.split('_')[1] || '';
    
    switch (subAction) {
      case 'status':
        await this.handleQueueStatus(whatsappId, stationId);
        break;
        
      case 'leave':
      case 'cancel':
        await this.handleQueueCancellation(whatsappId, stationId);
        break;
        
      default:
        // General queue management options
        await whatsappService.sendListMessage(
          whatsappId,
          '📋 *Queue Management*\n\nChoose an option:',
          'Options',
          [
            {
              title: '📊 Queue Status',
              rows: [
                { id: `queue_status_${stationId}`, title: 'Current Status', description: 'Check your position and wait time' },
                { id: `queue_estimate_${stationId}`, title: 'Wait Estimates', description: 'Get detailed time estimates' }
              ]
            },
            {
              title: '⚙️ Manage Queue',
              rows: [
                { id: `queue_cancel_${stationId}`, title: 'Cancel Booking', description: 'Leave the queue' }
              ]
            }
          ]
        );
    }
  }

  // ===============================================
  // SESSION MANAGEMENT HANDLERS
  // ===============================================

  /**
   * Handle charging session start - Delegate to booking controller
   */
  private async handleSessionStart(whatsappId: string, stationId: number): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid station. Please try selecting a station again.'
      );
      return;
    }
    
    logger.info('Processing session start', { whatsappId, stationId });
    
    // Delegate to booking controller for consistent handling
    await bookingController.handleChargingStart(whatsappId, stationId);
  }

  /**
   * Handle session management options
   */
  private async handleSessionActions(whatsappId: string, stationId: number): Promise<void> {
    const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
    
    if (!activeSession) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ You don\'t have an active charging session at this station.'
      );
      return;
    }
    
    // Calculate duration in minutes
    const durationMs = new Date().getTime() - activeSession.startTime.getTime();
    const durationMins = Math.floor(durationMs / 60000);
    
    // Show session details
    const messageLines = [
      '⚡ *Charging Session Details*',
      '',
      `📍 Station: #${stationId}`,
      `⏱️ Time elapsed: ${durationMins} minutes`,
      `🔋 Energy delivered: ${activeSession.energyDelivered} kWh`,
      `💰 Current cost: ₹${activeSession.totalCost}`,
      `⏰ Started at: ${activeSession.startTime.toLocaleTimeString()}`
    ];
    
    await whatsappService.sendTextMessage(whatsappId, messageLines.join('\n'));
    
    // Session management options
    setTimeout(() => {
      whatsappService.sendButtonMessage(
        whatsappId,
        '⚙️ *Session Management*\n\nWhat would you like to do?',
        [
          { id: `session_stop_${stationId}`, title: '⏹️ Stop Charging' },
          { id: `extend_30_${stationId}`, title: '⏳ Extend 30min' },
          { id: `extend_60_${stationId}`, title: '⏳ Extend 1hr' }
        ]
      );
    }, 1000);
  }

  /**
   * Handle session extension
   */
  private async handleSessionExtension(whatsappId: string, stationId: number, minutes?: number): Promise<void> {
    const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
    
    if (!activeSession) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ You don\'t have an active charging session to extend.'
      );
      return;
    }
    
    if (minutes) {
      // Process the extension
      const success = await sessionService.extendSession(whatsappId, stationId, minutes);
      
      if (success) {
        await whatsappService.sendTextMessage(
          whatsappId,
          `✅ *Session Extended*\n\nAdded ${minutes} minutes to your charging session.\n\nYour updated session will end at ${new Date(Date.now() + minutes * 60000).toLocaleTimeString()}.`
        );
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Failed to extend session. Please try again or contact support.'
        );
      }
    } else {
      // Show extension options
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⏳ *Extend Charging Session*\n\nHow much additional time would you like?',
        [
          { id: `extend_15_${stationId}`, title: '+15 minutes' },
          { id: `extend_30_${stationId}`, title: '+30 minutes' },
          { id: `extend_60_${stationId}`, title: '+1 hour' }
        ]
      );
    }
  }

  // ===============================================
  // INFORMATION HANDLERS
  // ===============================================

  /**
   * Handle live updates
   */
  private async handleLiveUpdates(whatsappId: string, stationId: number): Promise<void> {
    // Check for active sessions
    const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
    
    if (activeSession) {
      // Live session updates
      await this.handleSessionActions(whatsappId, stationId);
    } else {
      // Check for queue position - Delegate to booking controller
      await bookingController.handleQueueStatus(whatsappId);
    }
  }

  /**
   * Handle station information - Delegate to booking controller
   */
  private async handleStationInfo(whatsappId: string, stationId: number): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid station ID. Please try selecting a station again.'
      );
      return;
    }
    
    logger.info('Processing station info request', { whatsappId, stationId });
    
    // Delegate to booking controller for consistent handling
    await bookingController.showStationDetails(whatsappId, stationId);
  }

  /**
   * Handle user account options
   */
  private async handleUserOptions(whatsappId: string, buttonId: string): Promise<void> {
    await whatsappService.sendListMessage(
      whatsappId,
      '👤 *User Options*\n\nManage your account and preferences:',
      'Options',
      [
        {
          title: '📋 My Account',
          rows: [
            { id: 'user_profile', title: 'View Profile', description: 'See your account details' },
            { id: 'user_preferences', title: 'Preferences', description: 'Update your settings' }
          ]
        },
        {
          title: '📊 My Activity',
          rows: [
            { id: 'user_history', title: 'Charging History', description: 'View past sessions' },
            { id: 'user_bookings', title: 'Active Bookings', description: 'Manage current bookings' }
          ]
        }
      ]
    );
  }

  // ===============================================
  // ALTERNATIVES HANDLERS
  // ===============================================

  /**
   * Handle nearby stations
   */
  private async handleNearbyStations(whatsappId: string, buttonId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔍 *Finding Nearby Stations*\n\nTo find stations near you, please type "find" followed by your location.'
    );
  }

  /**
   * Handle cheaper station options
   */
  private async handleCheaperOptions(whatsappId: string, buttonId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '💰 *Finding More Affordable Options*\n\nLooking for budget-friendly charging stations nearby...'
    );
    
    setTimeout(() => {
      whatsappService.sendTextMessage(
        whatsappId,
        'To find affordable stations near a specific location, type "find budget" followed by your location.'
      );
    }, 1000);
  }

  /**
   * Handle faster station options
   */
  private async handleFasterOptions(whatsappId: string, buttonId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⚡ *Finding Faster Charging Options*\n\nLooking for high-speed charging stations with shorter wait times...'
    );
    
    setTimeout(() => {
      whatsappService.sendTextMessage(
        whatsappId,
        'To find fast-charging stations near a specific location, type "find fast" followed by your location.'
      );
    }, 1000);
  }

  // ===============================================
  // QUEUE STATUS HANDLERS
  // ===============================================

  /**
   * Handle queue status check - Delegate to booking controller
   */
  private async handleQueueStatus(whatsappId: string, stationId: number): Promise<void> {
    if (stationId) {
      // Check specific station queue - delegate to booking controller
      await bookingController.handleStationQueueStatus(whatsappId, stationId);
    } else {
      // Check all active queues - delegate to booking controller
      await bookingController.handleQueueStatus(whatsappId);
    }
  }

  /**
   * Handle wait time estimates
   */
  private async handleWaitEstimates(whatsappId: string, stationId: number): Promise<void> {
    const analytics = await analyticsService.getStationAnalytics(stationId);
    
    if (!analytics) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Unable to retrieve queue statistics for this station.'
      );
      return;
    }
    
    // Get user's position if in queue
    const queues = await queueService.getUserQueueStatus(whatsappId);
    const relevantQueue = queues.find(q => q.stationId === stationId);
    
    const messageLines = [
      '⏱️ *Queue Wait Estimates*',
      '',
      `📍 Station #${stationId}`,
      `👥 Total in queue: ${analytics.currentQueueLength}`,
      `⏰ Average wait time: ${analytics.averageWaitTime} min`,
      `🔄 Peak hours: ${analytics.peakHours.join(', ')}`
    ];
    
    // Add user's position info if applicable
    if (relevantQueue) {
      messageLines.push('');
      messageLines.push(`🎯 *Your position:* #${relevantQueue.position}`);
      messageLines.push(`⏱️ *Your estimated wait:* ${relevantQueue.estimatedWaitMinutes} min`);
    }
    
    await whatsappService.sendTextMessage(whatsappId, messageLines.join('\n'));
  }

  /**
   * Handle queue analytics
   */
  private async handleQueueAnalytics(whatsappId: string, stationId: number): Promise<void> {
    const analytics = await analyticsService.getStationAnalytics(stationId);
    
    if (!analytics) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Unable to retrieve analytics for this station.'
      );
      return;
    }
    
    const messageLines = [
      '📊 *Queue Analytics*',
      '',
      `📍 Station #${stationId}`,
      `👥 Current queue: ${analytics.currentQueueLength} people`,
      `⏱️ Average wait: ${analytics.averageWaitTime} minutes`,
      `⚡ Utilization: ${Math.round(analytics.utilization * 100)}%`,
      `📈 User satisfaction: ${Math.round(analytics.userSatisfaction * 100)}%`
    ];
    
    await whatsappService.sendTextMessage(whatsappId, messageLines.join('\n'));
  }

  /**
   * Handle queue reminders
   */
  private async handleQueueReminders(whatsappId: string, stationId: number): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '⏰ *Queue Reminders*\n\nReminder feature coming soon! We\'ll let you know when it\'s almost your turn.',
      [
        { id: `queue_status_${stationId}`, title: '📊 Check Status' },
        { id: 'back_to_menu', title: '⬅️ Back to Menu' }
      ]
    );
  }

  /**
   * Handle queue cancellation
   */
  private async handleQueueCancellation(whatsappId: string, stationId: number): Promise<void> {
    // Confirm before cancellation
    await whatsappService.sendButtonMessage(
      whatsappId,
      '❓ *Cancel Queue Position*\n\nAre you sure you want to cancel your position in line?',
      [
        { id: `confirm_cancel_${stationId}`, title: '✅ Yes, Cancel' },
        { id: `queue_status_${stationId}`, title: '❌ No, Keep It' }
      ]
    );
  }

  /**
   * Handle queue sharing
   */
  private async handleQueueSharing(whatsappId: string, stationId: number): Promise<void> {
    const queues = await queueService.getUserQueueStatus(whatsappId);
    const relevantQueue = queues.find(q => q.stationId === stationId);
    
    if (!relevantQueue) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ You are not currently in the queue for this station.'
      );
      return;
    }
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '📤 *Share Queue Position*\n\n' +
      'You can share your queue position with friends or family. ' +
      'They\'ll be able to monitor your progress but not make changes.\n\n' +
      'This feature will be available in the next update!'
    );
  }

  // ===============================================
  // MISC ACTION HANDLERS
  // ===============================================

  /**
   * Handle rating submission
   */
  private async handleRating(whatsappId: string, buttonId: string, stationId: number, rating?: number): Promise<void> {
    if (rating && rating > 0) {
      // Submit the rating
      await analyticsService.submitRating(whatsappId, stationId, rating);
      
      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Thank you for your ${rating}-star rating! Your feedback helps improve the service.`
      );
      
      // Prompt for additional feedback if rating is low
      if (rating <= 3) {
        setTimeout(() => {
          whatsappService.sendTextMessage(
            whatsappId,
            '📝 We\'d love to hear more about your experience. Please share any specific feedback or issues you encountered.'
          );
        }, 1000);
      }
    } else {
      // Show rating options
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⭐ *Rate Your Experience*\n\nHow would you rate your experience with this station?',
        [
          { id: `rate_5_${stationId}`, title: '⭐⭐⭐⭐⭐' },
          { id: `rate_3_${stationId}`, title: '⭐⭐⭐' },
          { id: `rate_1_${stationId}`, title: '⭐' }
        ]
      );
    }
  }

  /**
   * Handle share options
   */
  private async handleShareActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📤 *Share Options*\n\n' +
      'You can share station information or your queue position with others. ' +
      'This feature will be available in the next update!'
    );
  }

  /**
   * Handle cancellation requests
   */
  private async handleCancelActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    // Check if cancellation is confirmed
    if (buttonId.startsWith('confirm_cancel_')) {
      // Process the cancellation - delegate to booking controller
      await bookingController.handleQueueCancel(whatsappId, stationId);
    } else {
      // Request confirmation
      await this.handleQueueCancellation(whatsappId, stationId);
    }
  }

  /**
   * Handle confirmation actions
   */
  private async handleConfirmActions(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    if (buttonId.startsWith('confirm_cancel_')) {
      // Process the cancellation - delegate to booking controller
      await bookingController.handleQueueCancel(whatsappId, stationId);
    } else {
      // Other confirmation actions
      logger.warn('Unknown confirmation action', { whatsappId, buttonId });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ Unknown confirmation action. Please try again.'
      );
    }
  }

  /**
   * Format queue status for display
   */
  private formatQueueStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'waiting': '⏳ Waiting in line',
      'reserved': '✅ Reserved and ready',
      'charging': '⚡ Charging in progress',
      'completed': '✓ Completed',
      'cancelled': '❌ Cancelled'
    };
    
    return statusMap[status] || status;
  }
}

// Export singleton instance
export const queueWebhookController = new QueueWebhookController();