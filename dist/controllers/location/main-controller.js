"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.locationController = exports.LocationMainController = void 0;
const whatsapp_1 = require("../../services/whatsapp");
const geocoding_1 = require("../../services/location/geocoding");
const logger_1 = require("../../utils/logger");
const context_manager_1 = require("./context-manager");
const display_controller_1 = require("./display-controller");
const search_controller_1 = require("./search-controller");
class LocationMainController {
    constructor() {
        this.contextManager = new context_manager_1.LocationContextManager();
        this.displayController = new display_controller_1.LocationDisplayController(this.contextManager);
        this.searchController = new search_controller_1.LocationSearchController(this.contextManager, this.displayController);
    }
    async handleGPSLocation(whatsappId, latitude, longitude, name, address) {
        try {
            logger_1.logger.info('GPS location received', { whatsappId, latitude, longitude, name, address });
            this.contextManager.setLocationContext(whatsappId, {
                latitude,
                longitude,
                address: address || name || `${latitude}, ${longitude}`,
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 *Location Received!*\n\n${name || address || 'Your location'}\n\nSearching for nearby charging stations... ⚡`);
            await this.searchController.searchAndShowStations(whatsappId, latitude, longitude, address);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle GPS location', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process your location. Please try again.');
        }
    }
    async handleAddressInput(whatsappId, address) {
        try {
            logger_1.logger.info('Address input received', { whatsappId, address });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🔍 *Searching for: "${address}"*\n\nFinding location and nearby charging stations...`);
            const geocodeResults = await geocoding_1.geocodingService.geocodeText(address, { userWhatsapp: whatsappId });
            if (geocodeResults.length === 0) {
                const recentSearches = await geocoding_1.geocodingService.getUserRecentSearches(whatsappId, 3);
                await this.displayController.handleGeocodingFailed(whatsappId, address, recentSearches);
                return;
            }
            const location = geocodeResults[0];
            this.contextManager.setLocationContext(whatsappId, {
                latitude: location.latitude,
                longitude: location.longitude,
                address: location.formattedAddress,
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 *Found: ${location.formattedAddress}*\n\nSearching for nearby charging stations... ⚡`);
            await this.searchController.searchAndShowStations(whatsappId, location.latitude, location.longitude, location.formattedAddress);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle address input', { whatsappId, address, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to find that location. Please try a different address or share your GPS location.');
        }
    }
    async handleNextStation(whatsappId) {
        await this.searchController.handleNextStation(whatsappId);
    }
    async loadMoreStations(whatsappId) {
        await this.searchController.loadMoreStations(whatsappId);
    }
    async showAllNearbyStations(whatsappId) {
        await this.searchController.showAllNearbyStations(whatsappId);
    }
    async expandSearchRadius(whatsappId) {
        await this.searchController.expandSearchRadius(whatsappId);
    }
    async removeFilters(whatsappId) {
        await this.searchController.removeFilters(whatsappId);
    }
    async showBackToTopResult(whatsappId) {
        await this.displayController.showBackToTopResult(whatsappId);
    }
    async startNewSearch(whatsappId) {
        try {
            this.clearLocationContext(whatsappId);
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Start New Search*\n\nWhere would you like to find charging stations?', [
                { id: 'share_gps_location', title: '📱 Share Current Location' },
                { id: 'type_address', title: '⌨️ Type Address' },
                { id: 'recent_searches', title: '🕒 Recent Searches' },
            ], '🔍 New Search');
        }
        catch (error) {
            logger_1.logger.error('Failed to start new search', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to start new search. Please try again.');
        }
    }
    async showRecentSearches(whatsappId) {
        try {
            const recentSearches = await geocoding_1.geocodingService.getUserRecentSearches(whatsappId, 5);
            if (recentSearches.length === 0) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🕒 *No Recent Searches*\n\nYou haven\'t searched for any locations yet.\n\nShare your location or type an address to get started!');
                return;
            }
            const searchRows = recentSearches.map((search, index) => ({
                id: `recent_search_${index}`,
                title: search.substring(0, 24),
                description: 'Tap to search again',
            }));
            await whatsapp_1.whatsappService.sendListMessage(whatsappId, '🕒 *Your Recent Searches*\n\nSelect a location to search again:', 'Select Location', [
                {
                    title: '📍 Recent Locations',
                    rows: searchRows,
                },
            ], '🕒 Recent Searches');
        }
        catch (error) {
            logger_1.logger.error('Failed to show recent searches', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load recent searches. Please try again.');
        }
    }
    async handleRecentSearchSelection(whatsappId, searchIndex) {
        try {
            const recentSearches = await geocoding_1.geocodingService.getUserRecentSearches(whatsappId, 10);
            if (searchIndex >= 0 && searchIndex < recentSearches.length) {
                const selectedSearch = recentSearches[searchIndex];
                await this.handleAddressInput(whatsappId, selectedSearch);
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Invalid selection. Please try again.');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle recent search selection', { whatsappId, searchIndex, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process selection. Please try again.');
        }
    }
    async handleStationSelection(whatsappId, stationId) {
        try {
            logger_1.logger.info('Station selected', { whatsappId, stationId });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🏢 *Station Selected*\n\nStation ID: ${stationId}\n\nLoading detailed information...`);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Station details and booking will be available in Phase 4!', [
                    { id: `book_station_${stationId}`, title: '⚡ Book Now' },
                    { id: `station_info_${stationId}`, title: '📋 More Info' },
                    { id: 'back_to_list', title: '⬅️ Back to List' },
                ], '🏢 Station Options');
            }, 1500);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle station selection', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to select station. Please try again.');
        }
    }
    async handleStationBooking(whatsappId, stationId) {
        try {
            logger_1.logger.info('Station booking requested', { whatsappId, stationId });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⚡ *Booking Station ${stationId}*\n\nPreparing reservation system...\n\nThis feature will be available in Phase 4 with:\n• Real-time queue management\n• Automatic notifications\n• Payment integration\n• Booking confirmations`);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🚧 *Coming Soon: Full Booking System*\n\nPhase 4 will include complete booking capabilities!', [
                    { id: 'notify_when_ready', title: '🔔 Notify When Ready' },
                    { id: 'find_other_stations', title: '🔍 Find Other Stations' },
                    { id: 'back_to_search', title: '⬅️ Back to Search' },
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to handle station booking', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process booking request. Please try again.');
        }
    }
    async showStationDetails(whatsappId, stationId) {
        try {
            logger_1.logger.info('Station details requested', { whatsappId, stationId });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📋 *Station Details*\n\nStation ID: ${stationId}\n\nLoading comprehensive information...\n\n` +
                '• Real-time availability\n' +
                '• Pricing details\n' +
                '• Amenities nearby\n' +
                '• User reviews\n' +
                '• Operating hours\n' +
                '• Navigation assistance');
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Detailed station information will be enhanced in Phase 4!', [
                    { id: `book_station_${stationId}`, title: '⚡ Book Now' },
                    { id: 'get_directions', title: '🗺️ Get Directions' },
                    { id: 'share_station', title: '📤 Share Station' },
                    { id: 'back_to_search', title: '⬅️ Back to Search' },
                ]);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to show station details', { whatsappId, stationId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load station details. Please try again.');
        }
    }
    async showLocationHelp(whatsappId) {
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
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, helpText);
    }
    clearLocationContext(whatsappId) {
        this.contextManager.clearLocationContext(whatsappId);
    }
    hasLocationContext(whatsappId) {
        return this.contextManager.hasLocationContext(whatsappId);
    }
    getLocationContext(whatsappId) {
        return this.contextManager.getLocationContext(whatsappId);
    }
    getActiveContextsCount() {
        return this.contextManager.getActiveContextsCount();
    }
    async handleBackToList(whatsappId) {
        await this.showAllNearbyStations(whatsappId);
    }
    async handleFindOtherStations(whatsappId) {
        const context = this.contextManager.getLocationContext(whatsappId);
        if (context?.currentLocation) {
            await this.expandSearchRadius(whatsappId);
        }
        else {
            await this.startNewSearch(whatsappId);
        }
    }
    async handleNotificationSetup(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔔 *Notification Setup*\n\nPhase 4 will include:\n• Booking status updates\n• Queue position changes\n• Station availability alerts\n• Payment confirmations\n\nStay tuned for these features!');
    }
}
exports.LocationMainController = LocationMainController;
exports.locationController = new LocationMainController();
//# sourceMappingURL=main-controller.js.map