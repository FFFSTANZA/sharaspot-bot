"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueWebhookController = exports.QueueWebhookController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const booking_1 = require("./booking");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
const button_parser_1 = require("../utils/button-parser");
class QueueWebhookController {
    async handleQueueButton(whatsappId, buttonId, buttonTitle) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID format', { whatsappId });
            return;
        }
        try {
            logger_1.logger.info('Processing queue button', { whatsappId, buttonId, buttonTitle });
            const parsed = (0, button_parser_1.parseButtonId)(buttonId);
            await this.routeQueueAction(whatsappId, buttonId, parsed, buttonTitle);
        }
        catch (error) {
            await this.handleError(error, 'queue button handling', { whatsappId, buttonId });
        }
    }
    async handleQueueList(whatsappId, listId, listTitle) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID format', { whatsappId });
            return;
        }
        try {
            logger_1.logger.info('Processing queue list', { whatsappId, listId, listTitle });
            const parsed = (0, button_parser_1.parseButtonId)(listId);
            await this.routeQueueAction(whatsappId, listId, parsed, listTitle);
        }
        catch (error) {
            await this.handleError(error, 'queue list handling', { whatsappId, listId });
        }
    }
    async routeQueueAction(whatsappId, actionId, parsed, title) {
        const { action, category, stationId } = parsed;
        switch (category) {
            case 'queue':
                await this.handleQueueCategory(whatsappId, action, stationId, actionId);
                break;
            case 'session':
                await this.handleSessionCategory(whatsappId, action, stationId, parsed);
                break;
            case 'station':
                await this.handleStationCategory(whatsappId, action, stationId);
                break;
            default:
                await this.handleSpecificActions(whatsappId, actionId, parsed);
        }
    }
    async handleQueueCategory(whatsappId, action, stationId, actionId) {
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
    async handleSessionCategory(whatsappId, action, stationId, parsed) {
        switch (action) {
            case 'start':
                await this.handleSessionStart(whatsappId, stationId);
                break;
            case 'status':
                await this.handleSessionStatus(whatsappId, stationId);
                break;
            case 'stop':
                await booking_1.bookingController.handleSessionStop(whatsappId, stationId);
                break;
            case 'extend':
                const minutes = parsed.additionalData || 30;
                await this.handleSessionExtend(whatsappId, stationId, minutes);
                break;
            default:
                await this.handleUnknownAction(whatsappId, `${action}_${stationId}`);
        }
    }
    async handleStationCategory(whatsappId, action, stationId) {
        switch (action) {
            case 'book':
                await booking_1.bookingController.handleStationBooking(whatsappId, stationId);
                break;
            case 'info':
            case 'details':
                await booking_1.bookingController.showStationDetails(whatsappId, stationId);
                break;
            case 'directions':
                await booking_1.bookingController.handleGetDirections(whatsappId, stationId);
                break;
            case 'alternatives':
                await booking_1.bookingController.handleFindAlternatives(whatsappId, stationId);
                break;
            case 'rate':
                await this.handleStationRating(whatsappId, stationId);
                break;
            default:
                await booking_1.bookingController.handleStationSelection(whatsappId, stationId);
        }
    }
    async handleSpecificActions(whatsappId, actionId, parsed) {
        if (actionId.startsWith('live_')) {
            await this.handleLiveUpdates(whatsappId, parsed.stationId);
        }
        else if (actionId.startsWith('smart_')) {
            await this.handleSmartActions(whatsappId, actionId, parsed.stationId);
        }
        else if (actionId.startsWith('notify_')) {
            await this.handleNotificationActions(whatsappId, actionId, parsed.stationId);
        }
        else {
            await this.handleUnknownAction(whatsappId, actionId);
        }
    }
    async handleQueueStatus(whatsappId, stationId) {
        try {
            logger_1.logger.info('Checking queue status', { whatsappId, stationId });
            const queueData = await this.getSimulatedQueueData(whatsappId, stationId);
            if (!queueData) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 *No Active Queue*\n\nYou are not currently in any queue.\n\n🔍 Ready to find a charging station?');
                setTimeout(async () => {
                    await this.sendFindStationButtons(whatsappId);
                }, 2000);
                return;
            }
            const statusMessage = this.formatQueueStatus(queueData);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, statusMessage);
            setTimeout(async () => {
                await this.sendQueueManagementButtons(whatsappId, queueData);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'queue status check', { whatsappId, stationId });
        }
    }
    async handleJoinQueue(whatsappId, stationId) {
        try {
            logger_1.logger.info('Processing join queue request', { whatsappId, stationId });
            await booking_1.bookingController.handleJoinQueue(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'join queue', { whatsappId, stationId });
        }
    }
    async handleQueueCancel(whatsappId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '❓ *Cancel Queue Position*\n\nAre you sure you want to cancel your booking?\n\n⚠️ *Note:* Your position will be released and given to the next person in line.', [
                { id: `confirm_cancel_${stationId}`, title: '✅ Yes, Cancel' },
                { id: `queue_status_${stationId}`, title: '❌ Keep Position' },
                { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' }
            ]);
        }
        catch (error) {
            await this.handleError(error, 'queue cancel request', { whatsappId, stationId });
        }
    }
    async handleConfirmCancel(whatsappId, stationId) {
        try {
            logger_1.logger.info('Processing confirmed cancellation', { whatsappId, stationId });
            await booking_1.bookingController.handleQueueCancel(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'confirm cancel', { whatsappId, stationId });
        }
    }
    async handleSessionStart(whatsappId, stationId) {
        try {
            logger_1.logger.info('Processing session start', { whatsappId, stationId });
            await booking_1.bookingController.handleChargingStart(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'session start', { whatsappId, stationId });
        }
    }
    async handleSessionStatus(whatsappId, stationId) {
        try {
            const sessionData = await this.getSimulatedSessionData(whatsappId, stationId);
            if (!sessionData) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⚡ *No Active Session*\n\nYou don\'t have an active charging session.\n\n🔍 Ready to start charging?');
                return;
            }
            const statusMessage = this.formatSessionStatus(sessionData);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, statusMessage);
            setTimeout(async () => {
                await this.sendSessionManagementButtons(whatsappId, sessionData);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'session status', { whatsappId, stationId });
        }
    }
    async handleSessionStop(whatsappId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🛑 *Stop Charging Session*\n\nTo stop your charging session:\n\n' +
                '1️⃣ Use the physical stop button on the station\n' +
                '2️⃣ Or use the station\'s mobile app\n' +
                '3️⃣ Unplug your vehicle when charging stops\n\n' +
                '📊 You\'ll receive a summary once the session ends.');
        }
        catch (error) {
            await this.handleError(error, 'session stop', { whatsappId, stationId });
        }
    }
    async handleSessionExtend(whatsappId, stationId, minutes) {
        try {
            const message = `⏰ *Session Extension*\n\n` +
                `Adding ${minutes} minutes to your charging session.\n\n` +
                `💰 *Additional Cost:* Approximately ₹${(minutes * 0.8).toFixed(0)}\n` +
                `🕐 *New End Time:* ${this.calculateExtendedTime(minutes)}\n\n` +
                `✅ Extension confirmed! Continue charging.`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        }
        catch (error) {
            await this.handleError(error, 'session extend', { whatsappId, stationId, minutes });
        }
    }
    async handleLiveUpdates(whatsappId, stationId) {
        try {
            const message = `📊 *Live Updates*\n\n` +
                `📍 Station #${stationId}\n` +
                `🔄 *Real-time Status:*\n` +
                `• Queue Length: 2 people\n` +
                `• Average Wait: 15 minutes\n` +
                `• Station Load: 70%\n` +
                `• Last Updated: ${new Date().toLocaleTimeString()}\n\n` +
                `🔔 *Notifications:* You'll receive updates every 5 minutes.`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Live Update Options:*', [
                    { id: `queue_status_${stationId}`, title: '📊 Refresh Status' },
                    { id: `notify_when_ready_${stationId}`, title: '🔔 Notify When Ready' },
                    { id: `find_alternatives_${stationId}`, title: '🔍 Find Alternatives' }
                ]);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'live updates', { whatsappId, stationId });
        }
    }
    async handleSmartActions(whatsappId, actionId, stationId) {
        try {
            if (actionId.includes('schedule')) {
                await this.handleSmartSchedule(whatsappId, stationId);
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🧠 *Smart Features*\n\nAI-powered optimization features are coming soon!\n\n' +
                    '💡 *Preview:*\n' +
                    '• Optimal timing suggestions\n' +
                    '• Dynamic pricing alerts\n' +
                    '• Predictive availability\n' +
                    '• Route optimization');
            }
        }
        catch (error) {
            await this.handleError(error, 'smart actions', { whatsappId, actionId, stationId });
        }
    }
    async handleNotificationActions(whatsappId, actionId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔔 *Notifications Enabled*\n\n' +
                'You will receive alerts for:\n' +
                '• Position updates in queue\n' +
                '• When your slot is ready\n' +
                '• Charging completion\n' +
                '• Payment confirmations\n\n' +
                '✅ All set! We\'ll keep you informed.');
        }
        catch (error) {
            await this.handleError(error, 'notification actions', { whatsappId, actionId, stationId });
        }
    }
    async handleStationRating(whatsappId, stationId) {
        try {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⭐ *Rate Your Experience*\n\nHow would you rate this charging station?\n\nYour feedback helps improve service quality!', [
                { id: `rate_5_${stationId}`, title: '⭐⭐⭐⭐⭐ Excellent' },
                { id: `rate_4_${stationId}`, title: '⭐⭐⭐⭐ Good' },
                { id: `rate_3_${stationId}`, title: '⭐⭐⭐ Average' }
            ]);
        }
        catch (error) {
            await this.handleError(error, 'station rating', { whatsappId, stationId });
        }
    }
    async handleSmartSchedule(whatsappId, stationId) {
        const currentHour = new Date().getHours();
        const isOffPeak = currentHour < 8 || currentHour > 22;
        const savings = isOffPeak ? '15%' : '5%';
        const message = `🧠 *Smart Scheduling*\n\n` +
            `📊 *Analysis for Station #${stationId}:*\n` +
            `• Current Time: ${isOffPeak ? '🟢 Off-Peak' : '🟡 Regular'}\n` +
            `• Estimated Savings: ${savings}\n` +
            `• Wait Time: ${isOffPeak ? 'Minimal' : 'Moderate'}\n\n` +
            `💡 *Recommendation:* ${this.getSmartRecommendation(isOffPeak)}`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Smart Options:*', [
                { id: `book_station_${stationId}`, title: '⚡ Book Now' },
                { id: `notify_better_time_${stationId}`, title: '⏰ Notify Better Time' },
                { id: 'find_cheaper_alternatives', title: '💰 Find Cheaper' }
            ]);
        }, 2000);
    }
    formatQueueStatus(queueData) {
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
    formatSessionStatus(sessionData) {
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
    async sendQueueManagementButtons(whatsappId, queueData) {
        const buttons = [
            { id: `queue_status_${queueData.stationId}`, title: '🔄 Refresh Status' },
            { id: `get_directions_${queueData.stationId}`, title: '🗺️ Get Directions' },
            { id: `cancel_queue_${queueData.stationId}`, title: '❌ Cancel Queue' }
        ];
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Queue Management:*', buttons);
    }
    async sendSessionManagementButtons(whatsappId, sessionData) {
        const buttons = [
            { id: `session_status_${sessionData.stationId}`, title: '📊 Refresh Status' },
            { id: `extend_30_${sessionData.stationId}`, title: '⏰ Extend 30min' },
            { id: `session_stop_${sessionData.stationId}`, title: '🛑 Stop Info' }
        ];
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚡ *Session Control:*', buttons);
    }
    async sendFindStationButtons(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Find Charging Stations:*', [
            { id: 'share_gps_location', title: '📍 Share Location' },
            { id: 'new_search', title: '🆕 New Search' },
            { id: 'recent_searches', title: '🕒 Recent Searches' }
        ]);
    }
    getQueueStatusEmoji(status) {
        const emojiMap = {
            'waiting': '⏳',
            'ready': '🎯',
            'charging': '⚡',
            'completed': '✅',
            'cancelled': '❌'
        };
        return emojiMap[status] || '📍';
    }
    getStatusDescription(status) {
        const descriptions = {
            'waiting': 'In Queue',
            'ready': 'Ready to Charge',
            'charging': 'Charging Active',
            'completed': 'Session Complete',
            'cancelled': 'Cancelled'
        };
        return descriptions[status] || 'Unknown';
    }
    generateProgressBar(position, maxLength) {
        const filled = Math.max(0, maxLength - position);
        const empty = Math.max(0, position - 1);
        return '🟢'.repeat(filled) + '⚪'.repeat(empty);
    }
    getQueueTip(queueData) {
        if (queueData.status === 'ready') {
            return '🚀 *Your slot is ready!* Please arrive within 15 minutes.';
        }
        else if (queueData.position === 1) {
            return '🎉 *You\'re next!* Get ready to charge soon.';
        }
        else if (queueData.position <= 3) {
            return '🔔 *Almost there!* Stay nearby for quick notifications.';
        }
        else {
            return '💡 *Perfect time* to grab coffee or run errands nearby!';
        }
    }
    getSmartRecommendation(isOffPeak) {
        if (isOffPeak) {
            return '✅ Great timing! Lower rates and shorter waits expected.';
        }
        else {
            return '⚠️ Consider waiting for off-peak hours (after 10 PM) for better rates.';
        }
    }
    calculateExtendedTime(minutes) {
        const extendedTime = new Date(Date.now() + minutes * 60000);
        return extendedTime.toLocaleTimeString();
    }
    async getSimulatedQueueData(whatsappId, stationId) {
        const hasQueue = Math.random() > 0.5;
        if (!hasQueue)
            return null;
        return {
            position: Math.floor(Math.random() * 4) + 1,
            stationId,
            stationName: `Charging Station #${stationId}`,
            estimatedWaitMinutes: Math.floor(Math.random() * 30) + 10,
            status: 'waiting',
            joinedAt: new Date(Date.now() - Math.random() * 1800000)
        };
    }
    async getSimulatedSessionData(whatsappId, stationId) {
        const hasSession = Math.random() > 0.7;
        if (!hasSession)
            return null;
        const startTime = new Date(Date.now() - Math.random() * 3600000);
        const duration = Math.floor((Date.now() - startTime.getTime()) / 60000);
        return {
            sessionId: `session_${Date.now()}`,
            stationId,
            stationName: `Charging Station #${stationId}`,
            startTime,
            energyDelivered: Math.floor(duration * 0.5),
            currentCost: Math.floor(duration * 0.5 * 12.5),
            status: 'active'
        };
    }
    async handleUnknownAction(whatsappId, actionId) {
        logger_1.logger.warn('Unknown queue action', { whatsappId, actionId });
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ *Unknown Action*\n\nThat action is not recognized. Please try again or type "help" for available commands.');
        setTimeout(async () => {
            await this.sendFindStationButtons(whatsappId);
        }, 2000);
    }
    async handleError(error, operation, context) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error(`Queue webhook ${operation} failed`, { ...context, error: errorMessage });
        const whatsappId = context.whatsappId;
        if (whatsappId) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${operation} failed. Please try again or contact support.`).catch(sendError => logger_1.logger.error('Failed to send error message', { whatsappId, sendError }));
        }
    }
    getHealthStatus() {
        return {
            status: 'healthy',
            activeQueues: 0,
            activeSessions: 0,
            lastActivity: new Date().toISOString()
        };
    }
}
exports.QueueWebhookController = QueueWebhookController;
exports.queueWebhookController = new QueueWebhookController();
//# sourceMappingURL=queue-webhook.js.map