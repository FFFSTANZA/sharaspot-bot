"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookLocationController = exports.WebhookLocationController = void 0;
const whatsapp_1 = require("../../services/whatsapp");
const index_1 = require("./index");
const preference_1 = require("../../controllers/preference");
const logger_1 = require("../../utils/logger");
class WebhookLocationController {
    async handleLocationButton(whatsappId, buttonId, buttonTitle) {
        try {
            logger_1.logger.info('Location button pressed', { whatsappId, buttonId, buttonTitle });
            switch (buttonId) {
                case 'next_station':
                    await index_1.locationController.handleNextStation(whatsappId);
                    break;
                case 'load_more_stations':
                    await index_1.locationController.loadMoreStations(whatsappId);
                    break;
                case 'show_all_results':
                case 'show_all_nearby':
                    await index_1.locationController.showAllNearbyStations(whatsappId);
                    break;
                case 'back_to_top_result':
                    await this.backToTopResult(whatsappId);
                    break;
                case 'expand_search':
                    await this.expandSearchRadius(whatsappId);
                    break;
                case 'remove_filters':
                    await this.removeFilters(whatsappId);
                    break;
                case 'new_search':
                    await this.startNewSearch(whatsappId);
                    break;
                case 'share_gps_location':
                    await this.requestGPSLocation(whatsappId);
                    break;
                case 'try_different_address':
                    await this.requestAddressInput(whatsappId);
                    break;
                case 'location_help':
                    await preference_1.preferenceController.showLocationHelp(whatsappId);
                    break;
                default:
                    if (buttonId.startsWith('book_station_')) {
                        const stationId = buttonId.replace('book_station_', '');
                        await this.handleStationBooking(whatsappId, parseInt(stationId));
                    }
                    else if (buttonId.startsWith('station_info_')) {
                        const stationId = buttonId.replace('station_info_', '');
                        await this.showStationDetails(whatsappId, parseInt(stationId));
                    }
                    else {
                        logger_1.logger.warn('Unknown location button', { whatsappId, buttonId });
                        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown option. Please try again or type "help".');
                    }
                    break;
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle location button', { whatsappId, buttonId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Please try again.');
        }
    }
    async handleLocationList(whatsappId, listId, listTitle) {
        try {
            logger_1.logger.info('Location list selected', { whatsappId, listId, listTitle });
            if (listId.startsWith('select_station_')) {
                const stationId = listId.replace('select_station_', '');
                await this.handleStationSelection(whatsappId, parseInt(stationId));
            }
            else {
                logger_1.logger.warn('Unknown location list selection', { whatsappId, listId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again.');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle location list', { whatsappId, listId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Please try again.');
        }
    }
    async backToTopResult(whatsappId) {
        await index_1.locationController.showBackToTopResult(whatsappId);
    }
    async expandSearchRadius(whatsappId) {
        await index_1.locationController.expandSearchRadius(whatsappId);
    }
    async removeFilters(whatsappId) {
        await index_1.locationController.removeFilters(whatsappId);
    }
    async startNewSearch(whatsappId) {
        index_1.locationController.clearLocationContext(whatsappId);
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Start New Search*\n\nWhere would you like to find charging stations?', [
            { id: 'share_gps_location', title: '📱 Share Current Location' },
            { id: 'type_address', title: '⌨️ Type Address' },
            { id: 'recent_searches', title: '🕒 Recent Searches' },
        ], '🔍 New Search');
    }
    async requestGPSLocation(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📱 *Share Your GPS Location*\n\n' +
            '1️⃣ Tap the 📎 attachment icon\n' +
            '2️⃣ Select "Location"\n' +
            '3️⃣ Choose "Send your current location"\n' +
            '4️⃣ Tap "Send"\n\n' +
            '🎯 This gives the most accurate results!');
    }
    async requestAddressInput(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📝 *Type Your Address*\n\n' +
            'Enter the location where you need charging:\n\n' +
            '*Examples:*\n' +
            '• Connaught Place, Delhi\n' +
            '• Brigade Road, Bangalore\n' +
            '• Sector 18, Noida\n' +
            '• Phoenix Mall, Chennai\n\n' +
            'Just type the address and press send!');
    }
    async handleStationSelection(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🏢 *Station Selected*\n\nStation ID: ${stationId}\n\nLoading detailed information...`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Station selection feature will be enhanced in Phase 4 with full booking capabilities!', [
                { id: `book_station_${stationId}`, title: '⚡ Book Now' },
                { id: `station_info_${stationId}`, title: '📋 More Info' },
                { id: 'back_to_list', title: '⬅️ Back to List' },
            ], '🏢 Station Options');
        }, 1500);
    }
    async handleStationBooking(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⚡ *Booking Station ${stationId}*\n\nPreparing reservation system...\n\nThis feature will be available in Phase 4!`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🚧 Coming Soon: Full booking system with queue management, real-time updates, and payment integration!', [
                { id: 'notify_when_ready', title: '🔔 Notify When Ready' },
                { id: 'find_other_stations', title: '🔍 Find Other Stations' },
            ]);
        }, 2000);
    }
    async showStationDetails(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📋 *Station Details*\n\nStation ID: ${stationId}\n\nLoading comprehensive information...\n\n` +
            '• Real-time availability\n' +
            '• Pricing details\n' +
            '• Amenities nearby\n' +
            '• User reviews\n' +
            '• Operating hours');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Detailed station information will be available in Phase 4!', [
                { id: `book_station_${stationId}`, title: '⚡ Book Now' },
                { id: 'get_directions', title: '🗺️ Get Directions' },
                { id: 'back_to_search', title: '⬅️ Back to Search' },
            ]);
        }, 2000);
    }
}
exports.WebhookLocationController = WebhookLocationController;
exports.webhookLocationController = new WebhookLocationController();
//# sourceMappingURL=webhook-location.js.map