"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookController = exports.WebhookController = void 0;
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
const whatsapp_1 = require("../services/whatsapp");
const user_1 = require("../services/user");
const preference_1 = require("../services/preference");
const preference_2 = require("../controllers/preference");
const profile_1 = require("../services/profile");
class WebhookController {
    constructor() {
        this.usersWaitingForName = new Set();
        this.usersWaitingForAddress = new Set();
    }
    verifyWebhook(req, res) {
        try {
            const mode = req.query['hub.mode'];
            const token = req.query['hub.verify_token'];
            const challenge = req.query['hub.challenge'];
            if (mode === 'subscribe' && token === env_1.env.VERIFY_TOKEN) {
                logger_1.logger.info('✅ Webhook verified successfully');
                res.status(200).send(challenge);
            }
            else {
                logger_1.logger.warn('❌ Webhook verification failed', { mode, token });
                res.status(403).send('Forbidden');
            }
        }
        catch (error) {
            logger_1.logger.error('Webhook verification error', { error });
            res.status(500).send('Internal Server Error');
        }
    }
    async handleWebhook(req, res) {
        try {
            const body = req.body;
            res.status(200).send('OK');
            this.processWebhookAsync(body);
        }
        catch (error) {
            logger_1.logger.error('Webhook handling error', { error });
            res.status(500).send('Internal Server Error');
        }
    }
    async processWebhookAsync(webhookData) {
        try {
            for (const entry of webhookData.entry) {
                for (const change of entry.changes) {
                    if (change.value.messages) {
                        for (const message of change.value.messages) {
                            await this.processMessage(message);
                        }
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error('Async webhook processing error', { error, webhookData });
        }
    }
    async processMessage(message) {
        try {
            const { from: whatsappId, type } = message;
            logger_1.logger.info('📨 Processing message', {
                whatsappId,
                type,
                messageId: message.id
            });
            await whatsapp_1.whatsappService.markAsRead(message.id);
            const isBanned = await user_1.userService.isUserBanned(whatsappId);
            if (isBanned) {
                logger_1.logger.warn('Blocked message from banned user', { whatsappId });
                return;
            }
            let user = await user_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user) {
                user = await user_1.userService.createUser({
                    whatsappId,
                    name: null,
                    phoneNumber: whatsappId,
                });
                if (!user) {
                    logger_1.logger.error('Failed to create new user', { whatsappId });
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Sorry, there was an error setting up your account. Please try again later.');
                    return;
                }
                profile_1.profileService.updateUserProfileFromWhatsApp(whatsappId);
            }
            await this.routeMessage(user, message);
        }
        catch (error) {
            logger_1.logger.error('Message processing error', { error, message });
            if (message.from) {
                await whatsapp_1.whatsappService.sendTextMessage(message.from, '❌ Sorry, something went wrong. Please try again.');
            }
        }
    }
    async routeMessage(user, message) {
        const { whatsappId } = user;
        const messageText = message.text?.body?.toLowerCase().trim() || '';
        const buttonReply = message.interactive?.button_reply;
        const listReply = message.interactive?.list_reply;
        const isInPreferenceFlow = preference_1.preferenceService.isInPreferenceFlow(whatsappId);
        if (buttonReply) {
            await this.handleButtonReply(user, buttonReply.id, buttonReply.title, isInPreferenceFlow);
            return;
        }
        if (listReply) {
            await this.handleListReply(user, listReply.id, listReply.title, isInPreferenceFlow);
            return;
        }
        if (message.type === 'location' && message.location) {
            await this.handleLocationMessage(user, message.location);
            return;
        }
        if (message.type === 'text') {
            await this.handleTextInput(user, messageText, message.text?.body || '');
            return;
        }
        logger_1.logger.warn('Unknown message type received', {
            whatsappId,
            type: message.type,
            messageId: message.id
        });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ I didn\'t understand that. Type "help" to see available commands.');
    }
    async handleTextInput(user, lowerCaseText, originalText) {
        const { whatsappId } = user;
        if (this.usersWaitingForName.has(whatsappId)) {
            await this.handleNameInput(whatsappId, originalText);
            return;
        }
        if (this.usersWaitingForAddress.has(whatsappId)) {
            await this.handleAddressInput(whatsappId, originalText);
            return;
        }
        const isInPreferenceFlow = preference_1.preferenceService.isInPreferenceFlow(whatsappId);
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'text', originalText);
            return;
        }
        await this.handleTextCommand(user, lowerCaseText);
    }
    async handleTextCommand(user, command) {
        const { whatsappId, name } = user;
        switch (command) {
            case 'hi':
            case 'hello':
            case 'start':
                await this.handleGreeting(user);
                break;
            case 'help':
                await this.handleHelpCommand(whatsappId);
                break;
            case 'profile':
            case 'my profile':
                await profile_1.profileService.showProfileSummary(whatsappId);
                break;
            case 'status':
                await this.handleStatusCommand(whatsappId);
                break;
            case 'book':
                await this.handleBookCommand(user);
                break;
            case 'cancel':
                await this.handleCancelCommand(whatsappId);
                break;
            case 'preferences':
            case 'settings':
                await preference_2.preferenceController.startPreferenceGathering(whatsappId, false);
                break;
            case 'skip':
                const context = preference_1.preferenceService.getUserContext(whatsappId);
                if (context) {
                    await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'button', 'skip_ev_model');
                }
                else {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Skip what? Type "help" for available commands.');
                }
                break;
            default:
                if (command.length > 5 && (command.includes('road') || command.includes('street') || command.includes('avenue') || command.includes('mall') || command.includes('sector'))) {
                    await this.handleAddressInput(whatsappId, command);
                }
                else {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❓ I didn't recognize "${command}". Type "help" for available commands.`);
                }
                break;
        }
    }
    async handleGreeting(user) {
        const { whatsappId, name, preferencesCaptured } = user;
        if (!name) {
            await profile_1.profileService.requestUserName(whatsappId);
            this.usersWaitingForName.add(whatsappId);
            return;
        }
        const displayName = name || 'there';
        if (preferencesCaptured) {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `Welcome back ${displayName}! 👋\n\n*Quick Actions:*\nUse your saved preferences or update them?`, [
                { id: 'quick_book', title: '⚡ Quick Book' },
                { id: 'update_preferences', title: '🔄 Update Preferences' },
                { id: 'view_profile', title: '👤 View Profile' },
            ], '⚡ SharaSpot - EV Charging');
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `Welcome to SharaSpot ${displayName}! ⚡\n\nI'll help you find and book EV charging stations. Let's set up your preferences first.`);
            await preference_2.preferenceController.startPreferenceGathering(whatsappId, true);
        }
    }
    async handleNameInput(whatsappId, name) {
        this.usersWaitingForName.delete(whatsappId);
        const success = await profile_1.profileService.updateUserName(whatsappId, name);
        if (success) {
            setTimeout(async () => {
                await preference_2.preferenceController.startPreferenceGathering(whatsappId, true);
            }, 1500);
        }
    }
    async handleAddressInput(whatsappId, address) {
        this.usersWaitingForAddress.delete(whatsappId);
        logger_1.logger.info('Address received', { whatsappId, address });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 *Address Received!*\n\n${address}\n\nSearching for nearby charging stations... ⚡`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔍 Station search and booking features will be available in the next update!\n\nType "help" for available commands.');
        }, 2000);
    }
    async handleHelpCommand(whatsappId) {
        const helpText = `🆘 *SharaSpot Help*\n\n` +
            `*Main Commands:*\n` +
            `• *hi* - Start/restart the bot\n` +
            `• *book* - Quick booking (skip to location)\n` +
            `• *profile* - View your profile & preferences\n` +
            `• *preferences* - Update your EV preferences\n` +
            `• *status* - Check your current queue status\n` +
            `• *cancel* - Cancel active reservation\n` +
            `• *help* - Show this help message\n\n` +
            `*How to use:*\n` +
            `1. Say "hi" to start\n` +
            `2. Set your name & EV preferences\n` +
            `3. Share your location 📍 or type address\n` +
            `4. Browse nearby stations\n` +
            `5. Book instantly! ⚡\n\n` +
            `*During Setup:*\n` +
            `• Use buttons for quick selection\n` +
            `• Type custom values when needed\n` +
            `• Say "skip" to skip optional steps\n\n` +
            `Need assistance? Just type your message!`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, helpText);
    }
    async handleStatusCommand(whatsappId) {
        const user = await user_1.userService.getUserByWhatsAppId(whatsappId);
        if (!user) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ User not found. Please start with "hi".');
            return;
        }
        const statusText = `📊 *Your Status*\n\n` +
            `👤 Name: ${user.name || 'Not set'}\n` +
            `✅ Preferences: ${user.preferencesCaptured ? 'Complete' : 'Incomplete'}\n` +
            `🚗 EV Model: ${user.evModel || 'Not specified'}\n` +
            `🔌 Connector: ${user.connectorType || 'Not set'}\n\n` +
            `📍 No active reservations or queue positions.\n\n` +
            `Type "book" to find nearby charging stations!`;
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, statusText, [
            { id: 'quick_book', title: '⚡ Book Now' },
            { id: 'view_profile', title: '👤 View Profile' },
        ], '📊 Your Status');
    }
    async handleBookCommand(user) {
        const { whatsappId, preferencesCaptured, name } = user;
        if (!name) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '👋 Welcome! Please tell me your name first, then I\'ll help you book a charging station.');
            this.usersWaitingForName.add(whatsappId);
            return;
        }
        if (!preferencesCaptured) {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚙️ *Quick Setup Required*\n\nTo find the best stations for you, I need to know your EV preferences first.', [
                { id: 'start_quick_setup', title: '⚡ Quick Setup (2 min)' },
                { id: 'skip_to_location', title: '⏭️ Skip & Find Any Station' },
            ], '⚙️ Setup Required');
            return;
        }
        await this.requestLocation(whatsappId);
    }
    async handleCancelCommand(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ No active reservations to cancel.\n\nType "book" to find charging stations!');
    }
    async handleButtonReply(user, buttonId, buttonTitle, isInPreferenceFlow) {
        const { whatsappId } = user;
        logger_1.logger.info('Button reply received', { whatsappId, buttonId, buttonTitle, isInPreferenceFlow });
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'button', buttonId);
            return;
        }
        switch (buttonId) {
            case 'quick_book':
            case 'use_saved_preferences':
                await this.requestLocation(whatsappId);
                break;
            case 'update_preferences':
                await preference_2.preferenceController.startPreferenceGathering(whatsappId, false);
                break;
            case 'view_profile':
                await profile_1.profileService.showProfileSummary(whatsappId);
                break;
            case 'start_quick_setup':
                await preference_2.preferenceController.startPreferenceGathering(whatsappId, true);
                break;
            case 'skip_to_location':
                await this.requestLocation(whatsappId);
                break;
            case 'location_help':
                await preference_2.preferenceController.showLocationHelp(whatsappId);
                break;
            case 'type_address':
                await preference_2.preferenceController.requestAddressInput(whatsappId);
                this.usersWaitingForAddress.add(whatsappId);
                break;
            case 'update_profile':
                await profile_1.profileService.requestUserName(whatsappId);
                this.usersWaitingForName.add(whatsappId);
                break;
            default:
                logger_1.logger.warn('Unknown button ID', { whatsappId, buttonId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown selection. Please try again or type "help".');
                break;
        }
    }
    async handleListReply(user, listId, listTitle, isInPreferenceFlow) {
        const { whatsappId } = user;
        logger_1.logger.info('List reply received', { whatsappId, listId, listTitle, isInPreferenceFlow });
        if (isInPreferenceFlow) {
            await preference_2.preferenceController.handlePreferenceResponse(whatsappId, 'button', listId);
            return;
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📝 List selection received. This feature will be available soon!');
    }
    async handleLocationMessage(user, location) {
        const { whatsappId } = user;
        const { latitude, longitude, name, address } = location;
        logger_1.logger.info('Location received', {
            whatsappId,
            latitude,
            longitude,
            name,
            address
        });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📍 *Location Received!*\n\n${name || 'Your location'}\n${address || `${latitude}, ${longitude}`}\n\nSearching for nearby charging stations... ⚡`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔍 Station search and booking features will be available in the next update!\n\nType "help" for available commands.');
        }, 2000);
    }
    async requestLocation(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📍 *Share Your Location*\n\nTo find the best charging stations near you:\n\n🎯 Tap "Share Location" below\n📎 Or use the attachment menu\n⌨️ Or type your address', [
            { id: 'location_help', title: '❓ How to Share Location' },
            { id: 'type_address', title: '⌨️ Type Address Instead' },
        ], '📍 Location Request');
    }
}
exports.WebhookController = WebhookController;
exports.webhookController = new WebhookController();
//# sourceMappingURL=webhook.js.map