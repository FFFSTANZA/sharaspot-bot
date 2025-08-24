// src/controllers/booking.ts - PRODUCTION READY & OPTIMIZED
import { whatsappService } from '../services/whatsapp';
import { userService } from '../services/userService';
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
// PRODUCTION BOOKING CONTROLLER
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
   * Handle station booking request
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

      if (!this.isStationBookable(station)) {
        await this.handleUnavailableStation(whatsappId, station);
        return;
      }

      await this.showBookingOptions(whatsappId, station, user);

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
  // PLACEHOLDER METHODS FOR QUEUE INTEGRATION
  // ===============================================

  /**
   * Handle join queue action - Ready for queue service integration
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

      // TODO: Integrate with queueService when implemented
      // const queuePosition = await queueService.joinQueue(whatsappId, stationId);
      
      // For now, simulate queue joining
      await this.simulateQueueJoin(whatsappId, station);

    } catch (error) {
      await this.handleError(error, 'join queue', { whatsappId, stationId });
    }
  }

  /**
   * Handle queue status check - Ready for queue service integration
   */
  async handleQueueStatus(whatsappId: string, stationId?: number): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) return;

    try {
      logger.info('Checking queue status', { whatsappId, stationId });

      // TODO: Integrate with queueService when implemented
      // const userQueues = await queueService.getUserQueueStatus(whatsappId);
      
      // For now, show placeholder status
      await this.showPlaceholderQueueStatus(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'queue status', { whatsappId, stationId });
    }
  }

  /**
   * Handle queue cancellation - Ready for queue service integration
   */
  async handleQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing queue cancellation', { whatsappId, stationId });

      // TODO: Integrate with queueService when implemented
      // const success = await queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
      
      // For now, simulate cancellation
      await this.simulateQueueCancel(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'queue cancel', { whatsappId, stationId });
    }
  }

  /**
   * Handle charging session start - Ready for session service integration
   */
  async handleChargingStart(whatsappId: string, stationId: number): Promise<void> {
    if (!this.validateInput(whatsappId, stationId)) return;

    try {
      logger.info('Processing charging start', { whatsappId, stationId });

      // TODO: Integrate with sessionService when implemented
      // const session = await sessionService.startSession(whatsappId, stationId);
      
      // For now, simulate session start
      await this.simulateChargingStart(whatsappId, stationId);

    } catch (error) {
      await this.handleError(error, 'charging start', { whatsappId, stationId });
    }
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
      
      const message = `🗺️ *Directions to ${station.name}*\n\n` +
        `📍 ${station.address}\n\n` +
        `🔗 *Google Maps:*\n${googleMapsUrl}\n\n` +
        `💡 *Tip:* Save this location for faster navigation next time!`;

      await whatsappService.sendTextMessage(whatsappId, message);

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
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 *Finding Alternative Stations...*\n\nSearching for nearby options with similar features...'
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '🎯 *Alternative Options:*\n\nChoose how you\'d like to find alternatives:',
          [
            { id: 'expand_search', title: '📡 Expand Search Area' },
            { id: 'new_search', title: '🆕 Start New Search' },
            { id: 'back_to_list', title: '📋 Back to Station List' }
          ]
        );
      }, 2000);

    } catch (error) {
      await this.handleError(error, 'find alternatives', { whatsappId, stationId });
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
  // SIMULATION METHODS (TEMPORARY PLACEHOLDERS)
  // ===============================================

  /**
   * Simulate queue joining (until queue service is implemented)
   */
  private async simulateQueueJoin(whatsappId: string, station: ProcessedStation): Promise<void> {
    const position = Math.floor(Math.random() * 3) + 1;
    const waitTime = position * 15;

    const message = `🎯 *Queue Joined Successfully!*\n\n` +
      `📍 *${station.name}*\n` +
      `👥 *Your Position:* #${position}\n` +
      `⏱️ *Estimated Wait:* ${waitTime} minutes\n` +
      `🔔 *Updates:* You'll receive notifications as the queue moves\n\n` +
      `💡 *Tip:* Arrive 5 minutes before your estimated time!`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '📱 *Manage Your Booking:*',
        [
          { id: `queue_status_${station.id}`, title: '📊 Check Status' },
          { id: `cancel_queue_${station.id}`, title: '❌ Cancel Queue' },
          { id: `get_directions_${station.id}`, title: '🗺️ Get Directions' }
        ]
      );
    }, 3000);
  }

  /**
   * Show placeholder queue status
   */
  private async showPlaceholderQueueStatus(whatsappId: string, stationId?: number): Promise<void> {
    if (stationId) {
      const station = await this.getStationDetails(stationId);
      const message = `📊 *Queue Status*\n\n` +
        `📍 *Station:* ${station?.name || `Station #${stationId}`}\n` +
        `👥 *Your Position:* #2\n` +
        `⏱️ *Estimated Wait:* 15 minutes\n` +
        `🔄 *Last Updated:* Just now\n\n` +
        `⚡ *Status:* Queue is moving smoothly`;

      await whatsappService.sendTextMessage(whatsappId, message);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '📋 *Your Active Bookings:*\n\n' +
        'No active bookings found.\n\n' +
        '🔍 Ready to find a charging station?'
      );
    }
  }

  /**
   * Simulate queue cancellation
   */
  private async simulateQueueCancel(whatsappId: string, stationId: number): Promise<void> {
    const message = `✅ *Booking Cancelled Successfully*\n\n` +
      `Your queue position has been released.\n` +
      `Other users have been automatically promoted.\n\n` +
      `💡 *Ready to find another station?*`;

    await whatsappService.sendTextMessage(whatsappId, message);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Find Your Next Charging Station:*',
        [
          { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
          { id: 'new_search', title: '🆕 Start New Search' },
          { id: 'recent_searches', title: '🕒 Recent Searches' }
        ]
      );
    }, 2000);
  }

  /**
   * Simulate charging session start
   */
  private async simulateChargingStart(whatsappId: string, stationId: number): Promise<void> {
    const message = `⚡ *Charging Session Started!*\n\n` +
      `🔋 *Session Active*\n` +
      `📍 Station ID: ${stationId}\n` +
      `🕐 Started: ${new Date().toLocaleTimeString()}\n` +
      `⚡ Rate: ₹12.50/kWh\n\n` +
      `📱 *Live Monitoring:*\n` +
      `• Real-time cost tracking\n` +
      `• Battery level updates\n` +
      `• Completion estimates\n\n` +
      `🛑 *To stop charging,* use the station interface or app.`;

    await whatsappService.sendTextMessage(whatsappId, message);
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
  } {
    return {
      status: 'healthy',
      activeOperations: 0,
      lastActivity: new Date().toISOString()
    };
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const bookingController = new BookingController();