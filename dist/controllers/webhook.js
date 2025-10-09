"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookController = exports.WebhookController = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const whatsapp_1 = require("../services/whatsapp");
const userService_1 = require("../services/userService");
const preference_1 = require("../services/preference");
const preference_2 = require("./preference");
const profile_1 = require("../services/profile");
const location_1 = require("./location");
const booking_1 = require("./booking");
const queue_webhook_1 = require("./queue-webhook");
const webhook_location_1 = require("./location/webhook-location");
const button_parser_1 = require("../utils/button-parser");
const validation_1 = require("../utils/validation");
const owner_webhook_1 = require("../controllers/owner-webhook");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
class WebhookController {
    constructor() {
        this.waitingUsers = new Map();
    }
    async verifyWebhook(req, res) {
        try {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            if (mode === 'subscribe' && token === env_1.env.VERIFY_TOKEN) {
                logger_1.logger.info('✅ Webhook verified successfully');
                res.status(200).send(challenge);
            }
            else {
                logger_1.logger.error('❌ Webhook verification failed', { mode, token: !!token });
                res.sendStatus(403);
            }
        }
        catch (error) {
            logger_1.logger.error('Webhook verification error', { error });
            res.sendStatus(500);
        }
    }
    async handleWebhook(req, res) {
        try {
            const webhookData = req.body;
            if (webhookData.object !== 'whatsapp_business_account') {
                res.status(200).send('EVENT_RECEIVED');
                return;
            }
            const messagePromises = this.extractMessages(webhookData)
                .map(message => this.processMessage(message)
                .catch(error => logger_1.logger.error('Message processing failed', {
                messageId: message.id,
                error: error instanceof Error ? error.message : String(error)
            })));
            await Promise.allSettled(messagePromises);
            res.status(200).send('EVENT_RECEIVED');
        }
        catch (error) {
            logger_1.logger.error('Webhook processing failed', { error });
            res.status(500).send('Internal Server Error');
        }
    }
    extractMessages(webhookData) {
        const messages = [];
        for (const entry of webhookData.entry) {
            for (const change of entry.changes) {
                if (change.field === 'messages' && change.value.messages) {
                    messages.push(...change.value.messages);
                }
            }
        }
        return messages;
    }
    async processMessage(message) {
        const whatsappId = message.from;
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID format', { whatsappId });
            return;
        }
        try {
            whatsapp_1.whatsappService.markAsRead(message.id).catch(error => logger_1.logger.warn('Mark as read failed', { messageId: message.id, error }));
            logger_1.logger.info('📨 Processing message', { whatsappId, type: message.type, messageId: message.id });
            const [user, isInPreferenceFlow] = await Promise.allSettled([
                userService_1.userService.createUser({ whatsappId }),
                preference_1.preferenceService.isInPreferenceFlow(whatsappId)
            ]);
            const userData = user.status === 'fulfilled' ? user.value : null;
            const preferenceFlow = isInPreferenceFlow.status === 'fulfilled' ? isInPreferenceFlow.value : false;
            if (!userData) {
                logger_1.logger.error('Failed to get/create user', { whatsappId });
                await this.sendErrorMessage(whatsappId, 'Failed to initialize user session. Please try again.');
                return;
            }
            await this.routeMessage(message, userData, preferenceFlow);
        }
        catch (error) {
            logger_1.logger.error('Message processing failed', {
                messageId: message.id,
                whatsappId,
                error: error instanceof Error ? error.message : String(error)
            });
            await this.sendErrorMessage(whatsappId, 'Something went wrong. Please try again or type "help".');
        }
    }
    async routeMessage(message, user, isInPreferenceFlow) {
        switch (message.type) {
            case 'text':
                await this.handleTextMessage(user, message.text?.body || '', isInPreferenceFlow);
                break;
            case 'interactive':
                if (message.interactive?.type === 'button_reply') {
                    await this.handleButtonMessage(user, message.interactive.button_reply, isInPreferenceFlow);
                }
                else if (message.interactive?.type === 'list_reply') {
                    await this.handleListMessage(user, message.interactive.list_reply, isInPreferenceFlow);
                }
                break;
            case 'location':
                await this.handleLocationMessage(user, message.location);
                break;
            default:
                await whatsapp_1.whatsappService.sendTextMessage(user.whatsappId, '❓ Unsupported message type. Please send text, location, or use buttons.');
        }
    }
    async handleTextMessage(user, text, isInPreferenceFlow) {
        const { whatsappId } = user;
        const cleanText = text.toLowerCase().trim();
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await owner_webhook_1.ownerWebhookController.handleOwnerMessage(whatsappId, 'text', text);
            return;
        }
        if (cleanText === 'owner') {
            await owner_webhook_1.ownerWebhookController.enterOwnerMode(whatsappId);
            return;
        }
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'text', text);
            return;
        }
        const waitingType = this.waitingUsers.get(whatsappId);
        if (waitingType) {
            await this.handleWaitingInput(whatsappId, text, waitingType);
            return;
        }
        await this.handleCommand(whatsappId, cleanText, text);
    }
    async handleButtonMessage(user, button, isInPreferenceFlow) {
        const { whatsappId } = user;
        const { id: buttonId, title } = button;
        logger_1.logger.info('🔘 Button pressed', { whatsappId, buttonId, title });
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await owner_webhook_1.ownerWebhookController.handleOwnerMessage(whatsappId, 'button', button);
            return;
        }
        if (buttonId.startsWith('session_stop_')) {
            const stationId = parseInt(buttonId.split('_')[2]);
            if (!isNaN(stationId)) {
                await booking_1.bookingController.handleSessionStop(whatsappId, stationId);
                return;
            }
        }
        const parsed = (0, button_parser_1.parseButtonId)(buttonId);
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
            return;
        }
        await this.routeButtonAction(whatsappId, buttonId, parsed, title);
    }
    async handleListMessage(user, list, isInPreferenceFlow) {
        const { whatsappId } = user;
        const { id: listId, title } = list;
        logger_1.logger.info('📋 List selected', { whatsappId, listId, title });
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await owner_webhook_1.ownerWebhookController.handleOwnerMessage(whatsappId, 'list', list);
            return;
        }
        const parsed = (0, button_parser_1.parseButtonId)(listId);
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'text', listId);
            return;
        }
        await this.routeListAction(whatsappId, listId, parsed, title);
    }
    async handleLocationMessage(user, location) {
        const { whatsappId } = user;
        if (owner_webhook_1.ownerWebhookController.isInOwnerMode(whatsappId)) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Location sharing not supported in owner mode. Please use buttons or type commands.');
            return;
        }
        logger_1.logger.info('📍 Raw location data received', {
            whatsappId,
            rawLocation: location,
            hasLatitude: !!location?.latitude,
            hasLongitude: !!location?.longitude,
            latType: typeof location?.latitude,
            lngType: typeof location?.longitude
        });
        let lat, lng;
        try {
            if (typeof location?.latitude === 'string') {
                lat = parseFloat(location.latitude);
            }
            else if (typeof location?.latitude === 'number') {
                lat = location.latitude;
            }
            else {
                throw new Error('No valid latitude found');
            }
            if (typeof location?.longitude === 'string') {
                lng = parseFloat(location.longitude);
            }
            else if (typeof location?.longitude === 'number') {
                lng = location.longitude;
            }
            else {
                throw new Error('No valid longitude found');
            }
            if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                throw new Error('Invalid coordinate values');
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Location validation failed', {
                whatsappId,
                location,
                error: error instanceof Error ? error.message : String(error)
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid location data received. Please try sharing your location again:\n\n' +
                '1️⃣ Tap 📎 attachment icon\n' +
                '2️⃣ Select "Location"\n' +
                '3️⃣ Choose "Send your current location"\n' +
                '4️⃣ Tap "Send"');
            return;
        }
        logger_1.logger.info('✅ GPS location validated', {
            whatsappId,
            latitude: lat,
            longitude: lng,
            name: location.name,
            address: location.address
        });
        try {
            await location_1.locationController.handleGPSLocation(whatsappId, lat, lng, location.name || null, location.address || null);
            logger_1.logger.info('✅ Location successfully processed by locationController', { whatsappId });
        }
        catch (error) {
            logger_1.logger.error('❌ Location controller processing failed', {
                whatsappId,
                coordinates: { lat, lng },
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to process your location. Please try again or type your address instead.\n\n' +
                'If the problem persists, try typing your address like:\n' +
                '• "Anna Nagar, Chennai"\n' +
                '• "Brigade Road, Bangalore"');
        }
    }
    async routeButtonAction(whatsappId, buttonId, parsed, title) {
        logger_1.logger.info('🎯 Routing button action', { whatsappId, buttonId, parsed });
        if (this.isQueueButton(buttonId)) {
            logger_1.logger.info('📋 Routing to queue controller', { whatsappId, buttonId });
            await queue_webhook_1.queueWebhookController.handleQueueButton(whatsappId, buttonId, title);
            return;
        }
        if (this.isLocationButton(buttonId)) {
            logger_1.logger.info('📍 Routing to location controller', { whatsappId, buttonId });
            await this.handleLocationButton(whatsappId, buttonId);
            return;
        }
        if (parsed.category === 'station' && parsed.stationId > 0) {
            logger_1.logger.info('🏭 Routing to station handler', { whatsappId, buttonId, stationId: parsed.stationId });
            await this.handleStationButton(whatsappId, parsed.action, parsed.stationId);
            return;
        }
        logger_1.logger.info('⚙️ Routing to core button handler', { whatsappId, buttonId });
        await this.handleCoreButton(whatsappId, buttonId);
    }
    async routeListAction(whatsappId, listId, parsed, title) {
        logger_1.logger.info('📋 Routing list action', { whatsappId, listId, parsed });
        if (this.isQueueButton(listId)) {
            await queue_webhook_1.queueWebhookController.handleQueueList(whatsappId, listId, title);
            return;
        }
        if (this.isLocationList(listId)) {
            logger_1.logger.info('📍 Routing to location list handler', { whatsappId, listId });
            await this.handleLocationList(whatsappId, listId, parsed);
            return;
        }
        if (parsed.category === 'station' && parsed.stationId > 0) {
            await booking_1.bookingController.handleStationSelection(whatsappId, parsed.stationId);
            return;
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Unknown selection. Please try again.');
    }
    async handleStationButton(whatsappId, action, stationId) {
        switch (action) {
            case 'book':
                await booking_1.bookingController.handleStationBooking(whatsappId, stationId);
                break;
            case 'info':
            case 'details':
                await booking_1.bookingController.showStationDetails(whatsappId, stationId);
                break;
            case 'directions':
                await this.handleGetDirections(whatsappId, stationId);
                break;
            default:
                await booking_1.bookingController.handleStationSelection(whatsappId, stationId);
        }
    }
    async handleLocationButton(whatsappId, buttonId) {
        logger_1.logger.info('🎯 Routing location button', { whatsappId, buttonId });
        try {
            await webhook_location_1.webhookLocationController.handleLocationButton(whatsappId, buttonId, '');
            logger_1.logger.info('✅ Location button handled successfully', { whatsappId, buttonId });
        }
        catch (error) {
            logger_1.logger.error('❌ Location button handling failed', {
                whatsappId,
                buttonId,
                error: error instanceof Error ? error.message : String(error)
            });
            switch (buttonId) {
                case 'share_gps_location':
                    await this.requestGPSLocation(whatsappId);
                    break;
                case 'type_address':
                    await this.requestAddressInput(whatsappId);
                    break;
                case 'location_help':
                    await this.showLocationHelp(whatsappId);
                    break;
                case 'new_search':
                    await this.startBooking(whatsappId);
                    break;
                default:
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'There was an issue with that button. Please try "find" to search for stations.');
            }
        }
    }
    async handleCoreButton(whatsappId, buttonId) {
        switch (buttonId) {
            case 'help':
                await this.showHelp(whatsappId);
                break;
            case 'quick_book':
            case 'find_stations':
                await this.startBooking(whatsappId);
                break;
            case 'view_profile':
                await profile_1.profileService.showProfileSummary(whatsappId);
                break;
            case 'update_profile':
                await this.requestProfileUpdate(whatsappId);
                break;
            case 'update_preferences':
                await preference_2.preferenceController.startPreferenceGathering(whatsappId);
                break;
            default:
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown action. Type "help" for available commands.');
        }
    }
    async handleCommand(whatsappId, cleanText, originalText) {
        const commands = {
            'hi': () => this.handleGreeting(whatsappId),
            'hello': () => this.handleGreeting(whatsappId),
            'hey': () => this.handleGreeting(whatsappId),
            'start': () => this.handleGreeting(whatsappId),
            'help': () => this.showHelp(whatsappId),
            'book': () => this.startBooking(whatsappId),
            'find': () => this.startBooking(whatsappId),
            'search': () => this.startBooking(whatsappId),
            'station': () => this.startBooking(whatsappId),
            'stations': () => this.startBooking(whatsappId),
            'gps': () => this.requestGPSLocation(whatsappId),
            'location': () => this.requestGPSLocation(whatsappId),
            'share': () => this.requestGPSLocation(whatsappId),
            'nearby': () => this.handleNearbyRequest(whatsappId),
            'near': () => this.handleNearbyRequest(whatsappId),
            'around': () => this.handleNearbyRequest(whatsappId),
            'directions': () => this.handleGetDirections(whatsappId),
            'navigate': () => this.handleGetDirections(whatsappId),
            'maps': () => this.handleGetDirections(whatsappId),
            'route': () => this.handleGetDirections(whatsappId),
            'profile': () => profile_1.profileService.showProfileSummary(whatsappId),
            'preferences': () => preference_2.preferenceController.startPreferenceGathering(whatsappId),
            'settings': () => preference_2.preferenceController.startPreferenceGathering(whatsappId)
        };
        const commandHandler = commands[cleanText];
        if (commandHandler) {
            await commandHandler();
            return;
        }
        await this.handlePotentialAddress(whatsappId, originalText);
    }
    async handleWaitingInput(whatsappId, input, type) {
        this.waitingUsers.delete(whatsappId);
        const trimmedInput = input.trim();
        if (type === 'name') {
            await this.processNameInput(whatsappId, trimmedInput);
        }
        else {
            await this.processAddressInput(whatsappId, trimmedInput);
        }
    }
    async handleLocationList(whatsappId, listId, parsed) {
        if (listId.startsWith('recent_search_') && parsed.index !== undefined) {
            await location_1.locationController.handleRecentSearchSelection(whatsappId, parsed.index);
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown location selection.');
        }
    }
    async handlePotentialAddress(whatsappId, text) {
        if (this.looksLikeAddress(text)) {
            await location_1.locationController.handleAddressInput(whatsappId, text);
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ I didn\'t understand that. Type "help" for commands or "find" to search for charging stations.');
        }
    }
    looksLikeAddress(text) {
        const addressIndicators = [
            'road', 'street', 'st', 'rd', 'avenue', 'ave', 'nagar', 'colony',
            'sector', 'block', 'phase', 'mall', 'plaza', 'complex', 'society',
            'mumbai', 'delhi', 'bangalore', 'chennai', 'hyderabad', 'pune', 'kolkata'
        ];
        const lowerText = text.toLowerCase();
        return text.length > 3 &&
            text.length < 100 &&
            /[a-zA-Z]/.test(text) &&
            addressIndicators.some(indicator => lowerText.includes(indicator));
    }
    async handleGetDirections(whatsappId, stationId) {
        if (stationId) {
            try {
                const [station] = await database_1.db
                    .select({
                    id: schema_1.chargingStations.id,
                    name: schema_1.chargingStations.name,
                    address: schema_1.chargingStations.address,
                    latitude: schema_1.chargingStations.latitude,
                    longitude: schema_1.chargingStations.longitude
                })
                    .from(schema_1.chargingStations)
                    .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                    .limit(1);
                if (!station) {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Station not found.');
                    return;
                }
                const lat = Number(station.latitude);
                const lng = Number(station.longitude);
                const locationSent = await whatsapp_1.whatsappService.sendLocationMessage(whatsappId, lat, lng, station.name, station.address);
                if (locationSent) {
                    setTimeout(async () => {
                        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `Location sent for ${station.name}\n\nTap the location above to open in your maps app for turn-by-turn navigation!`);
                    }, 1000);
                }
                else {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `${station.name}\n${station.address}\n\nCopy this address to your maps app for navigation.`);
                }
            }
            catch (error) {
                logger_1.logger.error('Failed to send station directions', { whatsappId, stationId, error });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Failed to get directions. Please try again.');
            }
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, 'Get Directions\n\nFirst select a charging station, then I can send you the exact location for navigation!');
        }
    }
    async handleNearbyRequest(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📍 *Find Nearby Stations*\n\n' +
            'Share your location to find charging stations around you:', [
            { id: 'share_gps_location', title: '📱 Share GPS Location' },
            { id: 'type_address', title: '📝 Type Address' },
            { id: 'recent_searches', title: '🕒 Recent Searches' }
        ], '🔍 Location Search');
    }
    async handleGreeting(whatsappId) {
        const user = await userService_1.userService.createUser({ whatsappId });
        if (!user?.preferencesCaptured) {
            await preference_2.preferenceController.startPreferenceGathering(whatsappId);
        }
        else {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `👋 Welcome back ${user.name || 'there'}! Ready to find charging stations?`, [
                { id: 'quick_book', title: ' Find Stations' },
                { id: 'view_profile', title: '👤 Profile' },
                { id: 'help', title: '❓ Help' }
            ], ' SharaSpot');
        }
    }
    async startBooking(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Find Charging Stations*\n\nHow would you like to search?', [
            { id: 'share_gps_location', title: '📍 Share Location' },
            { id: 'type_address', title: '📝 Type Address' },
            { id: 'recent_searches', title: '🕒 Recent Searches' }
        ], ' Find Stations');
    }
    async showHelp(whatsappId) {
        const helpText = `🔋 *SharaSpot Help*\n\n` +
            `*Quick Commands:*\n` +
            `• "find" or "book" - Find stations\n` +
            `• "gps" or "location" - Share GPS\n` +
            `• "nearby" - Find nearby stations\n` +
            `• "directions" - Get navigation help\n` +
            `• "profile" - View your profile\n` +
            `• "preferences" - Update settings\n` +
            `• "help" - Show this help\n` +
            `• "owner" - Access owner portal\n\n` +
            `*How to Find Stations:*\n` +
            `1️⃣ Say "find" or tap "Find Stations"\n` +
            `2️⃣ Share location or type address\n` +
            `3️⃣ Browse and select stations\n` +
            `4️⃣ Book your charging slot\n\n` +
            `*Location Tips:*\n` +
            `📍 GPS location gives most accurate results\n` +
            `📝 You can type any address directly\n` +
            `🕒 Recent searches are saved for quick access\n` +
            `🗺️ Use "directions" for navigation help\n\n` +
            `Need more help? Just ask!`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, helpText);
    }
    async showLocationHelp(whatsappId) {
        const helpText = `📍 *Location Help*\n\n` +
            `*Share GPS Location:*\n` +
            `1️⃣ Tap 📎 attachment icon\n` +
            `2️⃣ Select "Location"\n` +
            `3️⃣ Choose "Send current location"\n` +
            `4️⃣ Tap "Send"\n\n` +
            `*Type Address:*\n` +
            `Just type your location like:\n` +
            `• "Anna Nagar, Chennai"\n` +
            `• "Brigade Road, Bangalore"\n` +
            `• "Sector 18, Noida"\n\n` +
            `*Get Directions:*\n` +
            `📱 Use WhatsApp live location sharing\n` +
            `🗺️ Copy address to your maps app\n\n` +
            `*Tips:*\n` +
            `• GPS location is most accurate\n` +
            `• Include city name for better results\n` +
            `• Try nearby landmarks if address doesn't work`;
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, helpText, [
            { id: 'share_gps_location', title: '📍 Share Location' },
            { id: 'type_address', title: '📝 Type Address' },
            { id: 'recent_searches', title: '🕒 Recent Searches' }
        ], '📍 Location Help');
    }
    async requestGPSLocation(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📱 *Share Your GPS Location*\n\n' +
            '1️⃣ Tap the 📎 attachment icon\n' +
            '2️⃣ Select "Location"\n' +
            '3️⃣ Choose "Send your current location"\n' +
            '4️⃣ Tap "Send"\n\n' +
            '🎯 This gives the most accurate results!\n\n' +
            '📝 Or type your address if you prefer');
    }
    async requestAddressInput(whatsappId) {
        this.waitingUsers.set(whatsappId, 'address');
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📝 *Type Your Address*\n\n' +
            'Enter the location where you need charging:\n\n' +
            '*Examples:*\n' +
            '• Anna Nagar, Chennai\n' +
            '• Brigade Road, Bangalore\n' +
            '• Sector 18, Noida\n' +
            '• Phoenix Mall, Mumbai\n\n' +
            'Just type the address and press send!');
    }
    async requestProfileUpdate(whatsappId) {
        this.waitingUsers.set(whatsappId, 'name');
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '✏️ *Update Your Name*\n\n' +
            'What would you like me to call you?\n\n' +
            '💡 Examples:\n' +
            '• Ravi Kumar\n' +
            '• Ashreya\n' +
            '• Pooja\n\n' +
            'Just type your preferred name:');
    }
    async processNameInput(whatsappId, name) {
        const cleanName = name.trim();
        if (cleanName.length < 2 || cleanName.length > 50) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid name (2-50 characters).\n\nTry again:');
            this.waitingUsers.set(whatsappId, 'name');
            return;
        }
        try {
            const success = await profile_1.profileService.updateUserName(whatsappId, cleanName);
            if (success) {
                logger_1.logger.info('✅ User name updated successfully', { whatsappId, newName: cleanName });
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to update name. Please try again.\n\nType your name:');
                this.waitingUsers.set(whatsappId, 'name');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to update user name', { whatsappId, name: cleanName, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Please try again.\n\nType your name:');
            this.waitingUsers.set(whatsappId, 'name');
        }
    }
    async processAddressInput(whatsappId, address) {
        if (address.length < 3) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Please provide a valid address.');
            return;
        }
        await location_1.locationController.handleAddressInput(whatsappId, address);
    }
    isQueueButton(buttonId) {
        const queueButtons = [
            'join_queue_', 'queue_status_', 'cancel_queue_', 'confirm_cancel_',
            'start_session_', 'session_stop_', 'session_status_', 'extend_',
            'nearby_alternatives_', 'cheaper_options_', 'faster_charging_',
            'smart_recommendation_',
            'notify_when_ready_', 'live_updates_',
            'rate_1_', 'rate_2_', 'rate_3_', 'rate_4_', 'rate_5_'
        ];
        return queueButtons.some(pattern => buttonId.startsWith(pattern));
    }
    isLocationButton(buttonId) {
        const coreLocationButtons = [
            'share_gps_location', 'type_address', 'try_different_address',
            'location_help', 'recent_searches', 'new_search'
        ];
        const navigationButtons = [
            'next_station', 'load_more_stations', 'show_all_nearby',
            'show_all_results', 'back_to_search', 'back_to_list',
            'back_to_top_result', 'expand_search', 'remove_filters'
        ];
        const directionButtons = [
            'get_directions', 'directions_help'
        ];
        if (coreLocationButtons.includes(buttonId) ||
            navigationButtons.includes(buttonId) ||
            directionButtons.includes(buttonId)) {
            return true;
        }
        const locationPrefixes = [
            'recent_search_', 'location_', 'search_', 'station_info_',
            'select_station_', 'book_station_'
        ];
        return locationPrefixes.some(prefix => buttonId.startsWith(prefix));
    }
    isLocationList(listId) {
        const locationListPrefixes = [
            'recent_search_', 'location_', 'search_', 'select_station_'
        ];
        const exactLocationLists = [
            'recent_searches', 'location_options', 'search_results'
        ];
        return exactLocationLists.includes(listId) ||
            locationListPrefixes.some(prefix => listId.startsWith(prefix));
    }
    async sendErrorMessage(whatsappId, message) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
        }
        catch (error) {
            logger_1.logger.error('Failed to send error message', { whatsappId, error });
        }
    }
    getWaitingUsersCount() {
        return this.waitingUsers.size;
    }
    cleanup() {
        this.waitingUsers.clear();
        logger_1.logger.info('Webhook controller cleanup completed');
    }
    getHealthStatus() {
        return {
            status: 'healthy',
            waitingUsers: this.waitingUsers.size,
            uptime: process.uptime().toString()
        };
    }
}
exports.WebhookController = WebhookController;
exports.webhookController = new WebhookController();
//# sourceMappingURL=webhook.js.map