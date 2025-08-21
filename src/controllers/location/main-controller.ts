import { whatsappService } from '../../services/whatsapp';
import { geocodingService } from '../../services/location/geocoding';
import { logger } from '../../utils/logger';
import { LocationContextManager } from './context-manager';
import { LocationDisplayController } from './display-controller';
import { LocationSearchController } from './search-controller';

export class LocationMainController {
  private contextManager: LocationContextManager;
  private displayController: LocationDisplayController;
  private searchController: LocationSearchController;

  constructor() {
    this.contextManager = new LocationContextManager();
    this.displayController = new LocationDisplayController(this.contextManager);
    this.searchController = new LocationSearchController(this.contextManager, this.displayController);
  }

  /**
   * Handle GPS location sharing
   */
  async handleGPSLocation(whatsappId: string, latitude: number, longitude: number, name?: string, address?: string): Promise<void> {
    try {
      logger.info('GPS location received', { whatsappId, latitude, longitude, name, address });

      // Store location context
      this.contextManager.setLocationContext(whatsappId, {
        latitude,
        longitude,
        address: address || name || `${latitude}, ${longitude}`,
      });

      // Acknowledge location
      await whatsappService.sendTextMessage(
        whatsappId,
        `📍 *Location Received!*\n\n${name || address || 'Your location'}\n\nSearching for nearby charging stations... ⚡`
      );

      // Search for stations
      await this.searchController.searchAndShowStations(whatsappId, latitude, longitude, address);

    } catch (error) {
      logger.error('Failed to handle GPS location', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process your location. Please try again.'
      );
    }
  }

  /**
   * Handle text address input
   */
  async handleAddressInput(whatsappId: string, address: string): Promise<void> {
    try {
      logger.info('Address input received', { whatsappId, address });

      // Show geocoding progress
      await whatsappService.sendTextMessage(
        whatsappId,
        `🔍 *Searching for: "${address}"*\n\nFinding location and nearby charging stations...`
      );

      // Geocode the address
      const geocodeResults = await geocodingService.geocodeText(address, { userWhatsapp: whatsappId });

      if (geocodeResults.length === 0) {
        const recentSearches = await geocodingService.getUserRecentSearches(whatsappId, 3);
        await this.displayController.handleGeocodingFailed(whatsappId, address, recentSearches);
        return;
      }

      const location = geocodeResults[0];
      
      // Store location context
      this.contextManager.setLocationContext(whatsappId, {
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.formattedAddress,
      });

      // Show geocoding result
      await whatsappService.sendTextMessage(
        whatsappId,
        `📍 *Found: ${location.formattedAddress}*\n\nSearching for nearby charging stations... ⚡`
      );

      // Search for stations
      await this.searchController.searchAndShowStations(whatsappId, location.latitude, location.longitude, location.formattedAddress);

    } catch (error) {
      logger.error('Failed to handle address input', { whatsappId, address, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to find that location. Please try a different address or share your GPS location.'
      );
    }
  }

  /**
   * Handle next station request
   */
  async handleNextStation(whatsappId: string): Promise<void> {
    await this.searchController.handleNextStation(whatsappId);
  }

  /**
   * Load more stations from server
   */
  async loadMoreStations(whatsappId: string): Promise<void> {
    await this.searchController.loadMoreStations(whatsappId);
  }

  /**
   * Show all nearby stations as a list
   */
  async showAllNearbyStations(whatsappId: string): Promise<void> {
    await this.searchController.showAllNearbyStations(whatsappId);
  }

  /**
   * Expand search radius
   */
  async expandSearchRadius(whatsappId: string): Promise<void> {
    await this.searchController.expandSearchRadius(whatsappId);
  }

  /**
   * Remove search filters
   */
  async removeFilters(whatsappId: string): Promise<void> {
    await this.searchController.removeFilters(whatsappId);
  }

  /**
   * Show back to top result
   */
  async showBackToTopResult(whatsappId: string): Promise<void> {
    await this.displayController.showBackToTopResult(whatsappId);
  }

  /**
   * Start new search
   */
  async startNewSearch(whatsappId: string): Promise<void> {
    try {
      // Clear location context
      this.clearLocationContext(whatsappId);
      
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔍 *Start New Search*\n\nWhere would you like to find charging stations?',
        [
          { id: 'share_gps_location', title: '📱 Share Current Location' },
          { id: 'type_address', title: '⌨️ Type Address' },
          { id: 'recent_searches', title: '🕒 Recent Searches' },
        ],
        '🔍 New Search'
      );
    } catch (error) {
      logger.error('Failed to start new search', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to start new search. Please try again.'
      );
    }
  }

  /**
   * Show recent searches
   */
  async showRecentSearches(whatsappId: string): Promise<void> {
    try {
      const recentSearches = await geocodingService.getUserRecentSearches(whatsappId, 5);
      
      if (recentSearches.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '🕒 *No Recent Searches*\n\nYou haven\'t searched for any locations yet.\n\nShare your location or type an address to get started!'
        );
        return;
      }

      // Create list message with recent searches
      const searchRows = recentSearches.map((search, index) => ({
        id: `recent_search_${index}`,
        title: search.substring(0, 24),
        description: 'Tap to search again',
      }));

      await whatsappService.sendListMessage(
        whatsappId,
        '🕒 *Your Recent Searches*\n\nSelect a location to search again:',
        'Select Location',
        [
          {
            title: '📍 Recent Locations',
            rows: searchRows,
          },
        ],
        '🕒 Recent Searches'
      );

    } catch (error) {
      logger.error('Failed to show recent searches', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load recent searches. Please try again.'
      );
    }
  }

  /**
   * Handle recent search selection
   */
  async handleRecentSearchSelection(whatsappId: string, searchIndex: number): Promise<void> {
    try {
      const recentSearches = await geocodingService.getUserRecentSearches(whatsappId, 10);
      
      if (searchIndex >= 0 && searchIndex < recentSearches.length) {
        const selectedSearch = recentSearches[searchIndex];
        await this.handleAddressInput(whatsappId, selectedSearch);
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Invalid selection. Please try again.'
        );
      }
    } catch (error) {
      logger.error('Failed to handle recent search selection', { whatsappId, searchIndex, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process selection. Please try again.'
      );
    }
  }

  /**
   * Handle station selection from list
   */
  async handleStationSelection(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Station selected', { whatsappId, stationId });

      await whatsappService.sendTextMessage(
        whatsappId,
        `🏢 *Station Selected*\n\nStation ID: ${stationId}\n\nLoading detailed information...`
      );

      // Show station details and booking options
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Station details and booking will be available in Phase 4!',
          [
            { id: `book_station_${stationId}`, title: '⚡ Book Now' },
            { id: `station_info_${stationId}`, title: '📋 More Info' },
            { id: 'back_to_list', title: '⬅️ Back to List' },
          ],
          '🏢 Station Options'
        );
      }, 1500);

    } catch (error) {
      logger.error('Failed to handle station selection', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to select station. Please try again.'
      );
    }
  }

  /**
   * Handle station booking request (placeholder for Phase 4)
   */
  async handleStationBooking(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Station booking requested', { whatsappId, stationId });

      await whatsappService.sendTextMessage(
        whatsappId,
        `⚡ *Booking Station ${stationId}*\n\nPreparing reservation system...\n\nThis feature will be available in Phase 4 with:\n• Real-time queue management\n• Automatic notifications\n• Payment integration\n• Booking confirmations`
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '🚧 *Coming Soon: Full Booking System*\n\nPhase 4 will include complete booking capabilities!',
          [
            { id: 'notify_when_ready', title: '🔔 Notify When Ready' },
            { id: 'find_other_stations', title: '🔍 Find Other Stations' },
            { id: 'back_to_search', title: '⬅️ Back to Search' },
          ]
        );
      }, 2000);

    } catch (error) {
      logger.error('Failed to handle station booking', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to process booking request. Please try again.'
      );
    }
  }

  /**
   * Show detailed station information (placeholder for Phase 4)
   */
  async showStationDetails(whatsappId: string, stationId: number): Promise<void> {
    try {
      logger.info('Station details requested', { whatsappId, stationId });

      await whatsappService.sendTextMessage(
        whatsappId,
        `📋 *Station Details*\n\nStation ID: ${stationId}\n\nLoading comprehensive information...\n\n` +
        '• Real-time availability\n' +
        '• Pricing details\n' +
        '• Amenities nearby\n' +
        '• User reviews\n' +
        '• Operating hours\n' +
        '• Navigation assistance'
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          'Detailed station information will be enhanced in Phase 4!',
          [
            { id: `book_station_${stationId}`, title: '⚡ Book Now' },
            { id: 'get_directions', title: '🗺️ Get Directions' },
            { id: 'share_station', title: '📤 Share Station' },
            { id: 'back_to_search', title: '⬅️ Back to Search' },
          ]
        );
      }, 2000);

    } catch (error) {
      logger.error('Failed to show station details', { whatsappId, stationId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load station details. Please try again.'
      );
    }
  }

  /**
   * Handle help request for location features
   */
  async showLocationHelp(whatsappId: string): Promise<void> {
    const helpText = `📍 *Location Help*\n\n` +
      `*How to Share Location:*\n` +
      `1. Tap the 📎 attachment icon\n` +
      `2. Select "Location"\n` +
      `3. Choose "Send your current location"\n` +
      `4. Tap "Send"\n\n` +
      `*Typing Addresses:*\n` +
      `• City names: "Mumbai", "Delhi"\n` +
      `• Landmarks: "Connaught Place Delhi"\n` +
      `• Areas: "Banjara Hills Hyderabad"\n` +
      `• Roads: "MG Road Bangalore"\n\n` +
      `*Navigation:*\n` +
      `• "Next Station" - Browse one by one\n` +
      `• "Show All" - See complete list\n` +
      `• "Load More" - Find additional stations\n` +
      `• "Expand Search" - Increase radius\n\n` +
      `🔒 *Privacy:* Location data is used only for finding nearby stations.`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  /**
   * Clear location context
   */
  clearLocationContext(whatsappId: string): void {
    this.contextManager.clearLocationContext(whatsappId);
  }

  /**
   * Check if user has active location context
   */
  hasLocationContext(whatsappId: string): boolean {
    return this.contextManager.hasLocationContext(whatsappId);
  }

  /**
   * Get location context (for debugging/monitoring)
   */
  getLocationContext(whatsappId: string) {
    return this.contextManager.getLocationContext(whatsappId);
  }

  /**
   * Get active contexts count (for monitoring)
   */
  getActiveContextsCount(): number {
    return this.contextManager.getActiveContextsCount();
  }

  /**
   * Handle back to list request
   */
  async handleBackToList(whatsappId: string): Promise<void> {
    await this.showAllNearbyStations(whatsappId);
  }

  /**
   * Handle find other stations request
   */
  async handleFindOtherStations(whatsappId: string): Promise<void> {
    const context = this.contextManager.getLocationContext(whatsappId);
    if (context?.currentLocation) {
      // Show stations with expanded radius
      await this.expandSearchRadius(whatsappId);
    } else {
      // Start new search
      await this.startNewSearch(whatsappId);
    }
  }

  /**
   * Handle notifications setup (placeholder for Phase 4)
   */
  async handleNotificationSetup(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔔 *Notification Setup*\n\nPhase 4 will include:\n• Booking status updates\n• Queue position changes\n• Station availability alerts\n• Payment confirmations\n\nStay tuned for these features!'
    );
  }
}

// Create and export singleton instance
export const locationController = new LocationMainController();