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
  | 'rate' | 'share' | 'cancel';

// Button ID patterns
const BUTTON_ID_PATTERNS = {
  BOOK_STATION: /^book(?:_station)?_(\d+)$/,
  JOIN_QUEUE: /^join(?:_queue)?_(\d+)$/,
  STATION_ID: /^(?:.*_)?station_(\d+)$/,
  GENERAL_ID: /^.*_(\d+)$/,
  NUMERIC: /^(\d+)$/
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
      const parts = buttonId.split('_');
      const action = parts[0] as QueueAction;
      const stationId = this.extractStationId(buttonId);

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
          await this.handleSessionExtension(whatsappId, stationId);
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
          await this.handleRating(whatsappId, buttonId, stationId);
          break;

        case 'share':
          await this.handleShareActions(whatsappId, buttonId, stationId);
          break;

        case 'cancel':
          await this.handleCancelActions(whatsappId, buttonId, stationId);
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
      const stationId = this.extractStationId(listId);

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
   * Extracts station ID from button/list ID with robust pattern matching
   * Returns 0 if no valid ID found
   */
  private extractStationId(inputId: string): number {
    if (!inputId) return 0;
    
    try {
      // Try each pattern in order of specificity
      for (const [_, pattern] of Object.entries(BUTTON_ID_PATTERNS)) {
        const match = inputId.match(pattern);
        if (match && match[1]) {
          const id = parseInt(match[1], 10);
          if (!isNaN(id) && id > 0) {
            return id;
          }
        }
      }
      
      logger.warn('Could not extract valid station ID', { inputId });
      return 0;
    } catch (error) {
      logger.error('Station ID extraction failed', { 
        inputId, 
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  // ===============================================
  // BOOKING & QUEUE HANDLERS
  // ===============================================

  /**
   * Handle station booking request
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
   * Handle queue joining
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
    
    // Initial feedback to user
    await whatsappService.sendTextMessage(
      whatsappId,
      `🚗 Joining queue for station #${stationId}. Please wait while we process your request...`
    );
    
    // Attempt to join queue
    const queuePosition = await queueService.joinQueue(whatsappId, stationId);
    
    if (!queuePosition) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Unable to join queue. The station may be unavailable or the queue is full. Please try another station.'
      );
      return;
    }
    
    // Queue position details handled by notification service
    // Additional buttons for queue management
    setTimeout(() => {
      whatsappService.sendButtonMessage(
        whatsappId,
        '🎮 *Queue Management*\n\nUse these options to manage your spot in the queue:',
        [
          { id: `queue_status_${stationId}`, title: '📊 Queue Status' },
          { id: `queue_cancel_${stationId}`, title: '❌ Cancel' },
          { id: 'find_stations', title: '🔍 Find Others' }
        ]
      );
    }, 1500);
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
   * Handle charging session start
   */
  private async handleSessionStart(whatsappId: string, stationId: number): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid station. Please try selecting a station again.'
      );
      return;
    }
    
    await whatsappService.sendTextMessage(
      whatsappId,
      `⚡ Starting charging session at station #${stationId}. Please connect your vehicle...`
    );
    
    // Session creation delegated to session service
    const session = await sessionService.startSession(whatsappId, stationId);
    
    if (!session) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to start charging session. Please ensure you have an active reservation.'
      );
      return;
    }
    
    // Session started successfully
    setTimeout(() => {
      whatsappService.sendButtonMessage(
        whatsappId,
        '✅ *Charging Session Started*\n\nYour session has been initialized successfully!',
        [
          { id: `session_status_${stationId}`, title: '📊 Session Status' },
          { id: `session_extend_${stationId}`, title: '⏳ Extend Time' },
          { id: `session_stop_${stationId}`, title: '⏹️ Stop Charging' }
        ]
      );
    }, 2000);
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
          { id: `session_extend_${stationId}`, title: '⏳ Extend Time' }
        ]
      );
    }, 1000);
  }

  /**
   * Handle session extension
   */
  private async handleSessionExtension(whatsappId: string, stationId: number): Promise<void> {
    const activeSession = await sessionService.getActiveSession(whatsappId, stationId);
    
    if (!activeSession) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ You don\'t have an active charging session to extend.'
      );
      return;
    }
    
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
      // Check for queue position
      const userQueues = await queueService.getUserQueueStatus(whatsappId);
      const relevantQueue = userQueues.find(q => q.stationId === stationId);
      
      if (relevantQueue) {
        await this.handleQueueStatus(whatsappId, stationId);
      } else {
        // No active state to update
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ You don\'t have an active queue position or charging session to monitor.'
        );
      }
    }
  }

  /**
   * Handle station information
   */
  private async handleStationInfo(whatsappId: string, stationId: number): Promise<void> {
    if (!stationId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Invalid station ID. Please try selecting a station again.'
      );
      return;
    }
    
    // Show station details
    await whatsappService.sendTextMessage(
      whatsappId,
      `📍 *Station #${stationId} Information*\n\nLoading station details...`
    );
    
    // Get station analytics
    const analytics = await analyticsService.getStationAnalytics(stationId);
    
    if (!analytics) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Unable to retrieve station information.'
      );
      return;
    }
    
    const messageLines = [
      `📍 *Station #${stationId} Details*`,
      '',
      `👥 Current queue: ${analytics.currentQueueLength} people`,
      `⏱️ Average wait: ${analytics.averageWaitTime} minutes`,
      `⚡ Utilization: ${Math.round(analytics.utilization * 100)}%`,
      `🕒 Peak hours: ${analytics.peakHours.join(', ')}`
    ];
    
    await whatsappService.sendTextMessage(whatsappId, messageLines.join('\n'));
    
    // Station action options
    setTimeout(() => {
      whatsappService.sendButtonMessage(
        whatsappId,
        '⚙️ *Station Options*\n\nWhat would you like to do?',
        [
          { id: `book_station_${stationId}`, title: '⚡ Book Now' },
          { id: `join_queue_${stationId}`, title: '🚶 Join Queue' },
          { id: 'nearby_stations', title: '🔍 Find Others' }
        ]
      );
    }, 1000);
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
   * Handle queue status check
   */
  private async handleQueueStatus(whatsappId: string, stationId: number): Promise<void> {
    // If stationId is provided, check specific queue
    if (stationId) {
      const queues = await queueService.getUserQueueStatus(whatsappId);
      const relevantQueue = queues.find(q => q.stationId === stationId);
      
      if (!relevantQueue) {
        await whatsappService.sendTextMessage(
          whatsappId,
          `❓ You are not currently in the queue for station #${stationId}.`
        );
        return;
      }
      
      // Format wait time
      const waitTimeText = relevantQueue.estimatedWaitMinutes > 60 
        ? `${Math.floor(relevantQueue.estimatedWaitMinutes / 60)} hr ${relevantQueue.estimatedWaitMinutes % 60} min`
        : `${relevantQueue.estimatedWaitMinutes} min`;
      
      // Send queue status
      await whatsappService.sendTextMessage(
        whatsappId,
        `📊 *Queue Status*\n\n` +
        `📍 Station: #${stationId}\n` +
        `🎯 Your position: #${relevantQueue.position}\n` +
        `⏱️ Estimated wait: ${waitTimeText}\n` +
        `📅 Joined: ${relevantQueue.createdAt.toLocaleTimeString()}\n` +
        `🔄 Status: ${this.formatQueueStatus(relevantQueue.status)}`
      );
      
      // Queue management options
      setTimeout(() => {
        whatsappService.sendButtonMessage(
          whatsappId,
          '⚙️ *Queue Management*\n\nWhat would you like to do?',
          [
            { id: `queue_cancel_${stationId}`, title: '❌ Cancel' },
            { id: 'nearby_stations', title: '🔍 Other Options' }
          ]
        );
      }, 1000);
    } else {
      // Check all active queues for this user
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
  private async handleRating(whatsappId: string, buttonId: string, stationId: number): Promise<void> {
    // Extract rating from button ID if available
    const ratingMatch = buttonId.match(/rate_(\d)_/);
    const rating = ratingMatch ? parseInt(ratingMatch[1], 10) : 0;
    
    if (rating > 0) {
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
      // Process the cancellation
      await bookingController.handleQueueCancel(whatsappId, stationId);
    } else {
      // Request confirmation
      await this.handleQueueCancellation(whatsappId, stationId);
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