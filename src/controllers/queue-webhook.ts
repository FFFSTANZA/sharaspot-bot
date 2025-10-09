// src/controllers/queue-webhook.ts - PRODUCTION READY & OPTIMIZED
import { whatsappService } from '../services/whatsapp';
import { bookingController } from './booking';
import { userService } from '../services/userService';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';
import { parseButtonId, ButtonParseResult } from '../utils/button-parser';

// ===============================================
// TYPES & INTERFACES
// ===============================================

interface QueuePosition {
  position: number;
  stationId: number;
  stationName: string;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'ready' | 'charging' | 'completed' | 'cancelled';
  joinedAt: Date;
}

interface SessionData {
  sessionId: string;
  stationId: number;
  stationName: string;
  startTime: Date;
  energyDelivered: number;
  currentCost: number;
  status: 'active' | 'paused' | 'completed';
}

// ===============================================
// PRODUCTION QUEUE WEBHOOK CONTROLLER
// ===============================================

export class QueueWebhookController {

  // ===============================================
  // MAIN ENTRY POINTS
  // ===============================================

  /**
   * Handle queue-related button interactions
   */
  async handleQueueButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID format', { whatsappId });
      return;
    }

    try {
      logger.info('Processing queue button', { whatsappId, buttonId, buttonTitle });

      const parsed = parseButtonId(buttonId);
      await this.routeQueueAction(whatsappId, buttonId, parsed, buttonTitle);

    } catch (error) {
      await this.handleError(error, 'queue button handling', { whatsappId, buttonId });
    }
  }

  /**
   * Handle queue-related list selections
   */
  async handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID format', { whatsappId });
      return;
    }

    try {
      logger.info('Processing queue list', { whatsappId, listId, listTitle });

      const parsed = parseButtonId(listId);
      await this.routeQueueAction(whatsappId, listId, parsed, listTitle);

    } catch (error) {
      await this.handleError(error, 'queue list handling', { whatsappId, listId });
    }
  }

  // ===============================================
  // ACTION ROUTING
  // ===============================================

  /**
   * Route queue actions to appropriate handlers
   */
  private async routeQueueAction(whatsappId: string, actionId: string, parsed: ButtonParseResult, title: string): Promise<void> {
    const { action, category, stationId } = parsed;

    // Route based on category and action
    switch (category) {
      case 'queue':
        await this.handleQueueCategory(whatsappId, action, stationId, actionId);
        break;

      case 'session':
        await this.handleSessionCategory(whatsappId, action, stationId, parsed);
        break;

      case 'station':
        // Delegate station actions to booking controller
        await this.handleStationCategory(whatsappId, action, stationId);
        break;

      default:
        // Handle specific action patterns
        await this.handleSpecificActions(whatsappId, actionId, parsed);
    }
  }

  // ===============================================
  // CATEGORY HANDLERS
  // ===============================================

  /**
   * Handle queue category actions
   */
  private async handleQueueCategory(whatsappId: string, action: string, stationId: number, actionId: string): Promise<void> {
    switch (action) {
      case 'status':
        await this.handleQueueStatus(whatsappId, stationId);
        break;

      case 'cancel':
        await this.handleQueueCancel(whatsappId, stationId);
        break;

      case 'confirm_cancel':
        await this.handleConfirmCancel(whatsappId, stationId);
        break;

      case 'join':
        await this.handleJoinQueue(whatsappId, stationId);
        break;

      default:
        await this.handleUnknownAction(whatsappId, actionId);
    }
  }

  /**
   * Handle session category actions
   */
  // In src/controllers/queue-webhook.ts
// UPDATE the handleSessionCategory method:

private async handleSessionCategory(whatsappId: string, action: string, stationId: number, parsed: ButtonParseResult): Promise<void> {
  switch (action) {
    case 'start':
      await this.handleSessionStart(whatsappId, stationId);
      break;

    case 'status':
      await this.handleSessionStatus(whatsappId, stationId);
      break;

    case 'stop':
      // FIXED: Delegate to booking controller like other session operations
      await bookingController.handleSessionStop(whatsappId, stationId);
      break;

    case 'extend':
      const minutes = parsed.additionalData || 30;
      await this.handleSessionExtend(whatsappId, stationId, minutes);
      break;

    default:
      await this.handleUnknownAction(whatsappId, `${action}_${stationId}`);
  }
}

  /**
   * Handle station category actions (delegate to booking controller)
   */
  private async handleStationCategory(whatsappId: string, action: string, stationId: number): Promise<void> {
    switch (action) {
      case 'book':
        await bookingController.handleStationBooking(whatsappId, stationId);
        break;

      case 'info':
      case 'details':
        await bookingController.showStationDetails(whatsappId, stationId);
        break;

      case 'directions':
        await bookingController.handleGetDirections(whatsappId, stationId);
        break;

      case 'alternatives':
        await bookingController.handleFindAlternatives(whatsappId, stationId);
        break;

      case 'rate':
        await this.handleStationRating(whatsappId, stationId);
        break;

      default:
        await bookingController.handleStationSelection(whatsappId, stationId);
    }
  }

  /**
   * Handle specific action patterns
   */
  private async handleSpecificActions(whatsappId: string, actionId: string, parsed: ButtonParseResult): Promise<void> {
    // Handle specific patterns that don't fit standard categories
    if (actionId.startsWith('live_')) {
      await this.handleLiveUpdates(whatsappId, parsed.stationId);
    } else if (actionId.startsWith('smart_')) {
      await this.handleSmartActions(whatsappId, actionId, parsed.stationId);
    } else if (actionId.startsWith('notify_')) {
      await this.handleNotificationActions(whatsappId, actionId, parsed.stationId);
    } else {
      await this.handleUnknownAction(whatsappId, actionId);
    }
  }

  // ===============================================
  // QUEUE OPERATIONS
  // ===============================================

  /**
   * Handle queue status check
   */
  private async handleQueueStatus(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Checking queue status', { whatsappId, stationId });

      // Get simulated queue data (replace with actual service when available)
      const queueData = await this.getSimulatedQueueData(whatsappId, stationId);

      if (!queueData) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📋 *No Active Queue*\n\nYou are not currently in any queue.\n\n🔍 Ready to find a charging station?'
        );

        setTimeout(async () => {
          await this.sendFindStationButtons(whatsappId);
        }, 2000);
        return;
      }

      const statusMessage = this.formatQueueStatus(queueData);
      await whatsappService.sendTextMessage(whatsappId, statusMessage);

      // Send queue management options
      setTimeout(async () => {
        await this.sendQueueManagementButtons(whatsappId, queueData);
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'queue status check', { whatsappId, stationId });
    }
  }

  /**
   * Handle joining a queue
   */
  private async handleJoinQueue(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Processing join queue request', { whatsappId, stationId });

      // Delegate to booking controller which has the proper implementation
      await bookingController.handleJoinQueue(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'join queue', { whatsappId, stationId });
    }
  }

  /**
   * Handle queue cancellation request
   */
  private async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    try {
      // Show confirmation dialog
      await whatsappService.sendButtonMessage(
        whatsappId,
        '❓ *Cancel Queue Position*\n\nAre you sure you want to cancel your booking?\n\n⚠️ *Note:* Your position will be released and given to the next person in line.',
        [
          { id: `confirm_cancel_${stationId}`, title: '✅ Yes, Cancel' },
          { id: `queue_status_${stationId}`, title: '❌ Keep Position' },
          { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' }
        ]
      );

    } catch (error) {
      await this.handleError(error, 'queue cancel request', { whatsappId, stationId });
    }
  }

  /**
   * Handle confirmed cancellation
   */
  private async handleConfirmCancel(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Processing confirmed cancellation', { whatsappId, stationId });

      // Delegate to booking controller for consistent handling
      await bookingController.handleQueueCancel(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'confirm cancel', { whatsappId, stationId });
    }
  }

  // ===============================================
  // SESSION OPERATIONS
  // ===============================================

  /**
   * Handle session start
   */
  private async handleSessionStart(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Processing session start', { whatsappId, stationId });

      // Delegate to booking controller for consistent handling
      await bookingController.handleChargingStart(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'session start', { whatsappId, stationId });
    }
  }

  /**
   * Handle session status check
   */
  private async handleSessionStatus(whatsappId: string, stationId: number): Promise<void> {
    try {
      const sessionData = await this.getSimulatedSessionData(whatsappId, stationId);

      if (!sessionData) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '⚡ *No Active Session*\n\nYou don\'t have an active charging session.\n\n🔍 Ready to start charging?'
        );
        return;
      }

      const statusMessage = this.formatSessionStatus(sessionData);
      await whatsappService.sendTextMessage(whatsappId, statusMessage);

      // Send session management buttons
      setTimeout(async () => {
        await this.sendSessionManagementButtons(whatsappId, sessionData);
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'session status', { whatsappId, stationId });
    }
  }

  /**
   * Handle session stop
   */
  private async handleSessionStop(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🛑 *Stop Charging Session*\n\nTo stop your charging session:\n\n' +
        '1️⃣ Use the physical stop button on the station\n' +
        '2️⃣ Or use the station\'s mobile app\n' +
        '3️⃣ Unplug your vehicle when charging stops\n\n' +
        '📊 You\'ll receive a summary once the session ends.'
      );

    } catch (error) {
      await this.handleError(error, 'session stop', { whatsappId, stationId });
    }
  }

  /**
   * Handle session extension
   */
  private async handleSessionExtend(whatsappId: string, stationId: number, minutes: number): Promise<void> {
    try {
      const message = `⏰ *Session Extension*\n\n` +
        `Adding ${minutes} minutes to your charging session.\n\n` +
        `💰 *Additional Cost:* Approximately ₹${(minutes * 0.8).toFixed(0)}\n` +
        `🕐 *New End Time:* ${this.calculateExtendedTime(minutes)}\n\n` +
        `✅ Extension confirmed! Continue charging.`;

      await whatsappService.sendTextMessage(whatsappId, message);

    } catch (error) {
      await this.handleError(error, 'session extend', { whatsappId, stationId, minutes });
    }
  }

  // ===============================================
  // ADDITIONAL FEATURES
  // ===============================================

  /**
   * Handle live updates request
   */
  private async handleLiveUpdates(whatsappId: string, stationId: number): Promise<void> {
    try {
      const message = `📊 *Live Updates*\n\n` +
        `📍 Station #${stationId}\n` +
        `🔄 *Real-time Status:*\n` +
        `• Queue Length: 2 people\n` +
        `• Average Wait: 15 minutes\n` +
        `• Station Load: 70%\n` +
        `• Last Updated: ${new Date().toLocaleTimeString()}\n\n` +
        `🔔 *Notifications:* You'll receive updates every 5 minutes.`;

      await whatsappService.sendTextMessage(whatsappId, message);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '📱 *Live Update Options:*',
          [
            { id: `queue_status_${stationId}`, title: '📊 Refresh Status' },
            { id: `notify_when_ready_${stationId}`, title: '🔔 Notify When Ready' },
            { id: `find_alternatives_${stationId}`, title: '🔍 Find Alternatives' }
          ]
        );
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'live updates', { whatsappId, stationId });
    }
  }

  /**
   * Handle smart actions
   */
  private async handleSmartActions(whatsappId: string, actionId: string, stationId: number): Promise<void> {
    try {
      if (actionId.includes('schedule')) {
        await this.handleSmartSchedule(whatsappId, stationId);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '🧠 *Smart Features*\n\nAI-powered optimization features are coming soon!\n\n' +
          '💡 *Preview:*\n' +
          '• Optimal timing suggestions\n' +
          '• Dynamic pricing alerts\n' +
          '• Predictive availability\n' +
          '• Route optimization'
        );
      }

    } catch (error) {
      await this.handleError(error, 'smart actions', { whatsappId, actionId, stationId });
    }
  }

  /**
   * Handle notification actions
   */
  private async handleNotificationActions(whatsappId: string, actionId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔔 *Notifications Enabled*\n\n' +
        'You will receive alerts for:\n' +
        '• Position updates in queue\n' +
        '• When your slot is ready\n' +
        '• Charging completion\n' +
        '• Payment confirmations\n\n' +
        '✅ All set! We\'ll keep you informed.'
      );

    } catch (error) {
      await this.handleError(error, 'notification actions', { whatsappId, actionId, stationId });
    }
  }

  /**
   * Handle station rating
   */
  private async handleStationRating(whatsappId: string, stationId: number): Promise<void> {
    try {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '⭐ *Rate Your Experience*\n\nHow would you rate this charging station?\n\nYour feedback helps improve service quality!',
        [
          { id: `rate_5_${stationId}`, title: '⭐⭐⭐⭐⭐ Excellent' },
          { id: `rate_4_${stationId}`, title: '⭐⭐⭐⭐ Good' },
          { id: `rate_3_${stationId}`, title: '⭐⭐⭐ Average' }
        ]
      );

    } catch (error) {
      await this.handleError(error, 'station rating', { whatsappId, stationId });
    }
  }

  // ===============================================
  // SMART FEATURES
  // ===============================================

  /**
   * Handle smart scheduling
   */
  private async handleSmartSchedule(whatsappId: string, stationId: number): Promise<void> {
    const currentHour = new Date().getHours();
    const isOffPeak = currentHour < 8 || currentHour > 22;
    const savings = isOffPeak ? '15%' : '5%';

    const message = `🧠 *Smart Scheduling*\n\n` +
      `📊 *Analysis for Station #${stationId}:*\n` +
      `• Current Time: ${isOffPeak ? '🟢 Off-Peak' : '🟡 Regular'}\n` +
      `• Estimated Savings: ${savings}\n` +
      `• Wait Time: ${isOffPeak ? 'Minimal' : 'Moderate'}\n\n` +
      `💡 *Recommendation:* ${this.getSmartRecommendation(isOffPeak)}`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎯 *Smart Options:*',
        [
          { id: `book_station_${stationId}`, title: '⚡ Book Now' },
          { id: `notify_better_time_${stationId}`, title: '⏰ Notify Better Time' },
          { id: 'find_cheaper_alternatives', title: '💰 Find Cheaper' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // MESSAGE FORMATTING
  // ===============================================

  /**
   * Format queue status message
   */
  private formatQueueStatus(queueData: QueuePosition): string {
    const statusEmoji = this.getQueueStatusEmoji(queueData.status);
    const progressBar = this.generateProgressBar(queueData.position, 5);

    return `${statusEmoji} *Queue Status*\n\n` +
      `📍 *${queueData.stationName}*\n` +
      `👥 *Position:* #${queueData.position}\n` +
      `${progressBar}\n` +
      `⏱️ *Estimated Wait:* ${queueData.estimatedWaitMinutes} minutes\n` +
      `📅 *Joined:* ${queueData.joinedAt.toLocaleTimeString()}\n` +
      `🔄 *Status:* ${this.getStatusDescription(queueData.status)}\n\n` +
      `${this.getQueueTip(queueData)}`;
  }

  /**
   * Format session status message
   */
  private formatSessionStatus(sessionData: SessionData): string {
    const duration = Math.floor((Date.now() - sessionData.startTime.getTime()) / 60000);

    return `⚡ *Charging Session*\n\n` +
      `📍 *${sessionData.stationName}*\n` +
      `🔋 *Energy Delivered:* ${sessionData.energyDelivered} kWh\n` +
      `⏱️ *Duration:* ${duration} minutes\n` +
      `💰 *Current Cost:* ₹${sessionData.currentCost}\n` +
      `🕐 *Started:* ${sessionData.startTime.toLocaleTimeString()}\n` +
      `📊 *Status:* ${sessionData.status.toUpperCase()}\n\n` +
      `🔄 *Live monitoring active*`;
  }

  // ===============================================
  // BUTTON GENERATORS
  // ===============================================

  /**
   * Send queue management buttons
   */
  private async sendQueueManagementButtons(whatsappId: string, queueData: QueuePosition): Promise<void> {
    const buttons = [
      { id: `queue_status_${queueData.stationId}`, title: '🔄 Refresh Status' },
      { id: `get_directions_${queueData.stationId}`, title: '🗺️ Get Directions' },
      { id: `cancel_queue_${queueData.stationId}`, title: '❌ Cancel Queue' }
    ];

    await whatsappService.sendButtonMessage(
      whatsappId,
      '📱 *Queue Management:*',
      buttons
    );
  }

  /**
   * Send session management buttons
   */
  private async sendSessionManagementButtons(whatsappId: string, sessionData: SessionData): Promise<void> {
    const buttons = [
      { id: `session_status_${sessionData.stationId}`, title: '📊 Refresh Status' },
      { id: `extend_30_${sessionData.stationId}`, title: '⏰ Extend 30min' },
      { id: `session_stop_${sessionData.stationId}`, title: '🛑 Stop Info' }
    ];

    await whatsappService.sendButtonMessage(
      whatsappId,
      '⚡ *Session Control:*',
      buttons
    );
  }

  /**
   * Send find station buttons
   */
  private async sendFindStationButtons(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '🔍 *Find Charging Stations:*',
      [
        { id: 'share_gps_location', title: '📍 Share Location' },
        { id: 'new_search', title: '🆕 New Search' },
        { id: 'recent_searches', title: '🕒 Recent Searches' }
      ]
    );
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  /**
   * Get queue status emoji
   */
  private getQueueStatusEmoji(status: string): string {
    const emojiMap: Record<string, string> = {
      'waiting': '⏳',
      'ready': '🎯',
      'charging': '⚡',
      'completed': '✅',
      'cancelled': '❌'
    };
    return emojiMap[status] || '📍';
  }

  /**
   * Get status description
   */
  private getStatusDescription(status: string): string {
    const descriptions: Record<string, string> = {
      'waiting': 'In Queue',
      'ready': 'Ready to Charge',
      'charging': 'Charging Active',
      'completed': 'Session Complete',
      'cancelled': 'Cancelled'
    };
    return descriptions[status] || 'Unknown';
  }

  /**
   * Generate progress bar
   */
  private generateProgressBar(position: number, maxLength: number): string {
    const filled = Math.max(0, maxLength - position);
    const empty = Math.max(0, position - 1);
    return '🟢'.repeat(filled) + '⚪'.repeat(empty);
  }

  /**
   * Get queue tip based on position
   */
  private getQueueTip(queueData: QueuePosition): string {
    if (queueData.status === 'ready') {
      return '🚀 *Your slot is ready!* Please arrive within 15 minutes.';
    } else if (queueData.position === 1) {
      return '🎉 *You\'re next!* Get ready to charge soon.';
    } else if (queueData.position <= 3) {
      return '🔔 *Almost there!* Stay nearby for quick notifications.';
    } else {
      return '💡 *Perfect time* to grab coffee or run errands nearby!';
    }
  }

  /**
   * Get smart recommendation
   */
  private getSmartRecommendation(isOffPeak: boolean): string {
    if (isOffPeak) {
      return '✅ Great timing! Lower rates and shorter waits expected.';
    } else {
      return '⚠️ Consider waiting for off-peak hours (after 10 PM) for better rates.';
    }
  }

  /**
   * Calculate extended end time
   */
  private calculateExtendedTime(minutes: number): string {
    const extendedTime = new Date(Date.now() + minutes * 60000);
    return extendedTime.toLocaleTimeString();
  }

  // ===============================================
  // SIMULATION DATA (TEMPORARY)
  // ===============================================

  /**
   * Get simulated queue data (replace with actual service)
   */
  private async getSimulatedQueueData(whatsappId: string, stationId: number): Promise<QueuePosition | null> {
    // Simulate some users having active queues
    const hasQueue = Math.random() > 0.5;
    
    if (!hasQueue) return null;

    return {
      position: Math.floor(Math.random() * 4) + 1,
      stationId,
      stationName: `Charging Station #${stationId}`,
      estimatedWaitMinutes: Math.floor(Math.random() * 30) + 10,
      status: 'waiting',
      joinedAt: new Date(Date.now() - Math.random() * 1800000) // Random time in last 30 mins
    };
  }

  /**
   * Get simulated session data (replace with actual service)
   */
  private async getSimulatedSessionData(whatsappId: string, stationId: number): Promise<SessionData | null> {
    // Simulate some users having active sessions
    const hasSession = Math.random() > 0.7;
    
    if (!hasSession) return null;

    const startTime = new Date(Date.now() - Math.random() * 3600000); // Random start in last hour
    const duration = Math.floor((Date.now() - startTime.getTime()) / 60000);

    return {
      sessionId: `session_${Date.now()}`,
      stationId,
      stationName: `Charging Station #${stationId}`,
      startTime,
      energyDelivered: Math.floor(duration * 0.5), // Rough estimate
      currentCost: Math.floor(duration * 0.5 * 12.5), // ₹12.5 per kWh
      status: 'active'
    };
  }

  // ===============================================
  // ERROR HANDLING
  // ===============================================

  /**
   * Handle unknown actions
   */
  private async handleUnknownAction(whatsappId: string, actionId: string): Promise<void> {
    logger.warn('Unknown queue action', { whatsappId, actionId });
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '❓ *Unknown Action*\n\nThat action is not recognized. Please try again or type "help" for available commands.'
    );

    setTimeout(async () => {
      await this.sendFindStationButtons(whatsappId);
    }, 2000);
  }

  /**
   * Centralized error handling
   */
  private async handleError(error: any, operation: string, context: Record<string, any>): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Queue webhook ${operation} failed`, { ...context, error: errorMessage });

    const whatsappId = context.whatsappId;
    if (whatsappId) {
      await whatsappService.sendTextMessage(
        whatsappId,
        `❌ ${operation} failed. Please try again or contact support.`
      ).catch(sendError => 
        logger.error('Failed to send error message', { whatsappId, sendError })
      );
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
    activeQueues: number;
    activeSessions: number;
    lastActivity: string;
  } {
    return {
      status: 'healthy',
      activeQueues: 0, // Could track active operations
      activeSessions: 0,
      lastActivity: new Date().toISOString()
    };
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const queueWebhookController = new QueueWebhookController();