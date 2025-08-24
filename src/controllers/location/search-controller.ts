import { geocodingService } from '../../services/location/geocoding';
import { stationSearchService, type StationSearchOptions } from '../../services/location/station-search';
import { userService } from '../../services/userService';
import { whatsappService } from '../../services/whatsapp';
import { logger } from '../../utils/logger';
import { LocationContextManager } from './context-manager';
import { LocationDisplayController } from './display-controller';

export class LocationSearchController {
  private contextManager: LocationContextManager;
  private displayController: LocationDisplayController;

  constructor(contextManager: LocationContextManager, displayController: LocationDisplayController) {
    this.contextManager = contextManager;
    this.displayController = displayController;
  }

  /**
   * Search and display stations
   */
  async searchAndShowStations(whatsappId: string, latitude: number, longitude: number, address?: string): Promise<void> {
    try {
      // Get user preferences
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) {
        logger.error('User not found for station search', { whatsappId });
        return;
      }

      // Build search options
      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude,
        longitude,
        radius: 25, // 25km radius
        maxResults: 5, // Show top 5 initially
        offset: 0,
        availableOnly: user.queuePreference === 'Free Now',
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'availability', // Priority: availability > distance > price
      };

      // Search for stations
      const searchResult = await stationSearchService.searchStations(searchOptions);

      // Store search context for pagination
      this.contextManager.updateSearchResults(whatsappId, searchResult);

      if (searchResult.stations.length === 0) {
        await this.displayController.handleNoStationsFound(whatsappId, address);
        return;
      }

      // Show stations
      await this.displayController.displayStationResults(whatsappId, searchResult, 0);

    } catch (error) {
      logger.error('Failed to search stations', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to search for stations. Please try again.'
      );
    }
  }

  /**
   * Handle next station request
   */
  async handleNextStation(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.lastSearchResults) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No active search. Please share your location first.'
        );
        return;
      }

      const { lastSearchResults } = context;
      const currentIndex = context.currentOffset + 1;

      if (currentIndex < lastSearchResults.stations.length) {
        // Show next station from current results
        this.contextManager.updateOffset(whatsappId, currentIndex);

        const station = lastSearchResults.stations[currentIndex];
        await this.displayController.showStationCard(whatsappId, station, currentIndex + 1, lastSearchResults.totalCount);
        
        const buttons = [
          { id: `book_station_${station.id}`, title: '⚡ Book Now' },
          { id: `station_info_${station.id}`, title: '📋 More Info' },
        ];

        if (currentIndex + 1 < lastSearchResults.stations.length) {
          buttons.push({ id: 'next_station', title: '➡️ Next Station' });
        }

        await whatsappService.sendButtonMessage(
          whatsappId,
          `*Station ${currentIndex + 1} of ${lastSearchResults.totalCount}*\n\nWhat would you like to do?`,
          buttons,
          '🎯 Quick Actions'
        );
      } else {
        // Load more stations from server
        await this.loadMoreStations(whatsappId);
      }

    } catch (error) {
      logger.error('Failed to handle next station', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load next station. Please try again.'
      );
    }
  }

  /**
   * Load more stations from server
   */
  async loadMoreStations(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔄 Loading more stations...'
      );

      // Get user for search options
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) return;

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 25,
        maxResults: 5,
        offset: (context.lastSearchResults?.stations.length || 0),
        availableOnly: user.queuePreference === 'Free Now',
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'availability',
      };

      const newResults = await stationSearchService.searchStations(searchOptions);

      if (newResults.stations.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '📍 No more stations found in this area.\n\nTry expanding your search or choosing a different location.'
        );
        return;
      }

      // Merge with existing results
      this.contextManager.mergeSearchResults(whatsappId, newResults);
      
      const updatedContext = this.contextManager.getLocationContext(whatsappId);
      if (updatedContext) {
        const newOffset = (updatedContext.lastSearchResults.stations.length || 1) - 1;
        this.contextManager.updateOffset(whatsappId, newOffset);

        // Show the first new station
        const newStation = newResults.stations[0];
        await this.displayController.showStationCard(whatsappId, newStation, newOffset + 1, updatedContext.lastSearchResults.totalCount);
        
        await whatsappService.sendButtonMessage(
          whatsappId,
          `*Found ${newResults.stations.length} more stations!*`,
          [
            { id: `book_station_${newStation.id}`, title: '⚡ Book Now' },
            { id: `station_info_${newStation.id}`, title: '📋 More Info' },
            { id: 'next_station', title: '➡️ Next Station' },
          ],
          '🎯 Quick Actions'
        );
      }

    } catch (error) {
      logger.error('Failed to load more stations', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load more stations. Please try again.'
      );
    }
  }

  /**
   * Show all nearby stations
   */
  async showAllNearbyStations(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '📋 Loading all nearby stations...'
      );

      // Get user for search options
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) return;

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 25,
        maxResults: 15, // Show more in list view
        offset: 0,
        availableOnly: false, // Show all stations
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'availability',
      };

      const results = await stationSearchService.getAllNearbyStations(searchOptions);

      await this.displayController.showAllNearbyStations(whatsappId, results.stations, results.totalCount);

    } catch (error) {
      logger.error('Failed to show all nearby stations', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to load stations list. Please try again.'
      );
    }
  }

  /**
   * Expand search radius
   */
  async expandSearchRadius(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔍 *Expanding search to 50km radius...*\n\nLooking for more charging stations...'
      );

      // Get user for search options
      const user = await userService.getUserByWhatsAppId(whatsappId);
      if (!user) return;

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 50, // Expanded radius
        maxResults: 10,
        offset: 0,
        availableOnly: false, // Show all stations in expanded search
        connectorTypes: user.connectorType ? [user.connectorType] : undefined,
        sortBy: 'distance', // Sort by distance for expanded search
      };

      const results = await stationSearchService.searchStations(searchOptions);

      if (results.stations.length === 0) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '😔 No stations found even within 50km.\n\nTry a different location or check back later.'
        );
        return;
      }

      // Update context with expanded results
      this.contextManager.updateSearchResults(whatsappId, results);

      await whatsappService.sendTextMessage(
        whatsappId,
        `🎯 *Found ${results.totalCount} stations within 50km!*\n\nShowing results sorted by distance...`
      );

      // Show results
      await this.displayController.displayStationResults(whatsappId, results, 0);

    } catch (error) {
      logger.error('Failed to expand search', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to expand search. Please try again.'
      );
    }
  }

  /**
   * Remove search filters
   */
  async removeFilters(whatsappId: string): Promise<void> {
    try {
      const context = this.contextManager.getLocationContext(whatsappId);
      if (!context?.currentLocation) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ No location found. Please share your location first.'
        );
        return;
      }

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔧 *Removing filters...*\n\nSearching for all charging stations regardless of availability and connector type...'
      );

      const searchOptions: StationSearchOptions = {
        userWhatsapp: whatsappId,
        latitude: context.currentLocation.latitude,
        longitude: context.currentLocation.longitude,
        radius: 25,
        maxResults: 10,
        offset: 0,
        availableOnly: false, // Remove availability filter
        connectorTypes: undefined, // Remove connector filter
        sortBy: 'distance',
      };

      const results = await stationSearchService.searchStations(searchOptions);

      if (results.stations.length === 0) {
        await this.displayController.handleNoStationsFound(whatsappId);
        return;
      }

      // Update context
      this.contextManager.updateSearchResults(whatsappId, results);

      await whatsappService.sendTextMessage(
        whatsappId,
        `🎯 *Found ${results.totalCount} stations (all types)*\n\nShowing all available options...`
      );

      // Show results
      await this.displayController.displayStationResults(whatsappId, results, 0);

    } catch (error) {
      logger.error('Failed to remove filters', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Failed to remove filters. Please try again.'
      );
    }
  }
}
