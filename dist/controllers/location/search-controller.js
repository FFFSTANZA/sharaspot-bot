"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocationSearchController = void 0;
const station_search_1 = require("../../services/location/station-search");
const user_1 = require("../../services/user");
const whatsapp_1 = require("../../services/whatsapp");
const logger_1 = require("../../utils/logger");
class LocationSearchController {
    constructor(contextManager, displayController) {
        this.contextManager = contextManager;
        this.displayController = displayController;
    }
    async searchAndShowStations(whatsappId, latitude, longitude, address) {
        try {
            const user = await user_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user) {
                logger_1.logger.error('User not found for station search', { whatsappId });
                return;
            }
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude,
                longitude,
                radius: 25,
                maxResults: 5,
                offset: 0,
                availableOnly: user.queuePreference === 'Free Now',
                connectorTypes: user.connectorType ? [user.connectorType] : undefined,
                sortBy: 'availability',
            };
            const searchResult = await station_search_1.stationSearchService.searchStations(searchOptions);
            this.contextManager.updateSearchResults(whatsappId, searchResult);
            if (searchResult.stations.length === 0) {
                await this.displayController.handleNoStationsFound(whatsappId, address);
                return;
            }
            await this.displayController.displayStationResults(whatsappId, searchResult, 0);
        }
        catch (error) {
            logger_1.logger.error('Failed to search stations', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to search for stations. Please try again.');
        }
    }
    async handleNextStation(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.lastSearchResults) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No active search. Please share your location first.');
                return;
            }
            const { lastSearchResults } = context;
            const currentIndex = context.currentOffset + 1;
            if (currentIndex < lastSearchResults.stations.length) {
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
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `*Station ${currentIndex + 1} of ${lastSearchResults.totalCount}*\n\nWhat would you like to do?`, buttons, '🎯 Quick Actions');
            }
            else {
                await this.loadMoreStations(whatsappId);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle next station', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load next station. Please try again.');
        }
    }
    async loadMoreStations(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔄 Loading more stations...');
            const user = await user_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user)
                return;
            const searchOptions = {
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
            const newResults = await station_search_1.stationSearchService.searchStations(searchOptions);
            if (newResults.stations.length === 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📍 No more stations found in this area.\n\nTry expanding your search or choosing a different location.');
                return;
            }
            this.contextManager.mergeSearchResults(whatsappId, newResults);
            const updatedContext = this.contextManager.getLocationContext(whatsappId);
            if (updatedContext) {
                const newOffset = (updatedContext.lastSearchResults.stations.length || 1) - 1;
                this.contextManager.updateOffset(whatsappId, newOffset);
                const newStation = newResults.stations[0];
                await this.displayController.showStationCard(whatsappId, newStation, newOffset + 1, updatedContext.lastSearchResults.totalCount);
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `*Found ${newResults.stations.length} more stations!*`, [
                    { id: `book_station_${newStation.id}`, title: '⚡ Book Now' },
                    { id: `station_info_${newStation.id}`, title: '📋 More Info' },
                    { id: 'next_station', title: '➡️ Next Station' },
                ], '🎯 Quick Actions');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to load more stations', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load more stations. Please try again.');
        }
    }
    async showAllNearbyStations(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 Loading all nearby stations...');
            const user = await user_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user)
                return;
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude: context.currentLocation.latitude,
                longitude: context.currentLocation.longitude,
                radius: 25,
                maxResults: 15,
                offset: 0,
                availableOnly: false,
                connectorTypes: user.connectorType ? [user.connectorType] : undefined,
                sortBy: 'availability',
            };
            const results = await station_search_1.stationSearchService.getAllNearbyStations(searchOptions);
            await this.displayController.showAllNearbyStations(whatsappId, results.stations, results.totalCount);
        }
        catch (error) {
            logger_1.logger.error('Failed to show all nearby stations', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load stations list. Please try again.');
        }
    }
    async expandSearchRadius(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔍 *Expanding search to 50km radius...*\n\nLooking for more charging stations...');
            const user = await user_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user)
                return;
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude: context.currentLocation.latitude,
                longitude: context.currentLocation.longitude,
                radius: 50,
                maxResults: 10,
                offset: 0,
                availableOnly: false,
                connectorTypes: user.connectorType ? [user.connectorType] : undefined,
                sortBy: 'distance',
            };
            const results = await station_search_1.stationSearchService.searchStations(searchOptions);
            if (results.stations.length === 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '😔 No stations found even within 50km.\n\nTry a different location or check back later.');
                return;
            }
            this.contextManager.updateSearchResults(whatsappId, results);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🎯 *Found ${results.totalCount} stations within 50km!*\n\nShowing results sorted by distance...`);
            await this.displayController.displayStationResults(whatsappId, results, 0);
        }
        catch (error) {
            logger_1.logger.error('Failed to expand search', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to expand search. Please try again.');
        }
    }
    async removeFilters(whatsappId) {
        try {
            const context = this.contextManager.getLocationContext(whatsappId);
            if (!context?.currentLocation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ No location found. Please share your location first.');
                return;
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔧 *Removing filters...*\n\nSearching for all charging stations regardless of availability and connector type...');
            const searchOptions = {
                userWhatsapp: whatsappId,
                latitude: context.currentLocation.latitude,
                longitude: context.currentLocation.longitude,
                radius: 25,
                maxResults: 10,
                offset: 0,
                availableOnly: false,
                connectorTypes: undefined,
                sortBy: 'distance',
            };
            const results = await station_search_1.stationSearchService.searchStations(searchOptions);
            if (results.stations.length === 0) {
                await this.displayController.handleNoStationsFound(whatsappId);
                return;
            }
            this.contextManager.updateSearchResults(whatsappId, results);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🎯 *Found ${results.totalCount} stations (all types)*\n\nShowing all available options...`);
            await this.displayController.displayStationResults(whatsappId, results, 0);
        }
        catch (error) {
            logger_1.logger.error('Failed to remove filters', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to remove filters. Please try again.');
        }
    }
}
exports.LocationSearchController = LocationSearchController;
//# sourceMappingURL=search-controller.js.map