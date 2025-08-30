"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingController = exports.BookingController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const userService_1 = require("../services/userService");
const queue_1 = require("../services/queue");
const session_1 = require("../services/session");
const notification_1 = require("../services/notification");
const logger_1 = require("../utils/logger");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const validation_1 = require("../utils/validation");
class BookingController {
    async handleStationSelection(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing station selection', { whatsappId, stationId });
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found. Please try another station.');
                return;
            }
            await this.showStationOverview(whatsappId, station);
        }
        catch (error) {
            await this.handleError(error, 'station selection', { whatsappId, stationId });
        }
    }
    async handleStationBooking(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing station booking', { whatsappId, stationId });
            const [user, station] = await Promise.all([
                userService_1.userService.getUserByWhatsAppId(whatsappId),
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
            const existingQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            if (existingQueues.length > 0) {
                await this.handleExistingBooking(whatsappId, existingQueues[0]);
                return;
            }
            if (station.isAvailable && station.availableSlots > 0) {
                await this.handleInstantBooking(whatsappId, station, user);
            }
            else if (this.isStationBookable(station)) {
                await this.handleQueueBooking(whatsappId, station, user);
            }
            else {
                await this.handleUnavailableStation(whatsappId, station);
            }
        }
        catch (error) {
            await this.handleError(error, 'station booking', { whatsappId, stationId });
        }
    }
    async showStationDetails(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Showing station details', { whatsappId, stationId });
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station information not available.');
                return;
            }
            const detailsMessage = this.formatStationDetails(station);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, detailsMessage);
            setTimeout(async () => {
                await this.sendStationActionButtons(whatsappId, station);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'station details', { whatsappId, stationId });
        }
    }
    async handleJoinQueue(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing join queue request', { whatsappId, stationId });
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found.');
                return;
            }
            const existingQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            if (existingQueues.length > 0) {
                const existingQueue = existingQueues.find(q => q.stationId === stationId);
                if (existingQueue) {
                    await this.showExistingQueueStatus(whatsappId, existingQueue);
                    return;
                }
            }
            const queuePosition = await queue_1.queueService.joinQueue(whatsappId, stationId);
            if (!queuePosition) {
                await this.handleQueueJoinFailure(whatsappId, station);
                return;
            }
            await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
        }
        catch (error) {
            await this.handleError(error, 'join queue', { whatsappId, stationId });
        }
    }
    async handleQueueStatus(whatsappId, stationId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId))
            return;
        try {
            logger_1.logger.info('Checking queue status', { whatsappId, stationId });
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            if (userQueues.length === 0) {
                await this.showNoActiveQueues(whatsappId);
                return;
            }
            for (const queue of userQueues) {
                await this.displayQueueStatus(whatsappId, queue);
            }
            setTimeout(async () => {
                await this.sendQueueManagementButtons(whatsappId, userQueues);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'queue status', { whatsappId, stationId });
        }
    }
    async handleQueueCancel(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing queue cancellation', { whatsappId, stationId });
            const success = await queue_1.queueService.leaveQueue(whatsappId, stationId, 'user_cancelled');
            if (!success) {
                await this.sendError(whatsappId, 'No active queue found to cancel.');
                return;
            }
            await this.handleSuccessfulCancellation(whatsappId, stationId);
        }
        catch (error) {
            await this.handleError(error, 'queue cancel', { whatsappId, stationId });
        }
    }
    async handleChargingStart(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing charging start', { whatsappId, stationId });
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            const reservedQueue = userQueues.find(q => q.stationId === stationId &&
                (q.status === 'reserved' || q.status === 'waiting'));
            if (!reservedQueue) {
                await this.handleNoValidReservation(whatsappId, stationId);
                return;
            }
            const session = await session_1.sessionService.startSession(whatsappId, stationId, reservedQueue?.id);
            if (!session) {
                await this.handleSessionStartFailure(whatsappId, stationId);
                return;
            }
            await queue_1.queueService.startCharging(whatsappId, stationId);
            await this.handleSuccessfulSessionStart(whatsappId, session);
        }
        catch (error) {
            await this.handleError(error, 'charging start', { whatsappId, stationId });
        }
    }
    async handleSessionStatus(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Checking session status', { whatsappId, stationId });
            const activeSession = await session_1.sessionService.getActiveSession(whatsappId, stationId);
            if (!activeSession) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⚡ *No Active Session*\n\nYou don\'t have an active charging session at this station.\n\n🔍 Ready to start charging?');
                return;
            }
            const sessionStatus = await session_1.sessionService.getSessionStatus(activeSession.id);
            if (sessionStatus) {
                await this.displaySessionStatus(whatsappId, sessionStatus, activeSession);
            }
            else {
                await this.displayBasicSessionInfo(whatsappId, activeSession);
            }
        }
        catch (error) {
            await this.handleError(error, 'session status', { whatsappId, stationId });
        }
    }
    async handleSessionStop(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId)) {
            logger_1.logger.warn('Invalid input for session stop', { whatsappId, stationId });
            return;
        }
        try {
            logger_1.logger.info('Processing session stop request', { whatsappId, stationId });
            const activeSession = await session_1.sessionService.getActiveSession(whatsappId, stationId);
            const success = await session_1.sessionService.stopSession(whatsappId, stationId);
            if (!success) {
                await this.sendError(whatsappId, 'No active session found to stop.');
                return;
            }
            if (activeSession) {
                const durationMs = new Date().getTime() - activeSession.startTime.getTime();
                const durationMinutes = Math.floor(durationMs / (1000 * 60));
                const durationFormatted = `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`;
                const summary = {
                    sessionId: activeSession.id,
                    duration: durationFormatted,
                    energyDelivered: Math.floor(durationMinutes * 0.5),
                    finalBatteryLevel: activeSession.currentBatteryLevel || 80,
                    totalCost: Math.floor(durationMinutes * 0.5) * 12.5,
                    efficiency: activeSession.efficiency || 95,
                    stationName: activeSession.stationName || 'Charging Station',
                    startTime: activeSession.startTime,
                    endTime: new Date()
                };
                await notification_1.notificationService.sendSessionCompletedNotification(whatsappId, activeSession, summary);
                logger_1.logger.info('Session summary sent', { whatsappId, sessionId: activeSession.id });
            }
            try {
                await queue_1.queueService.completeCharging(whatsappId, stationId);
            }
            catch (queueError) {
                logger_1.logger.warn('Queue service completion failed (non-critical)', {
                    whatsappId,
                    stationId,
                    error: queueError
                });
            }
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🛑 *Charging Session Stopped*\n\n' +
                'Your charging session has been terminated.\n' +
                'You\'ll receive a detailed summary shortly.\n\n' +
                '📊 Thank you for using SharaSpot!');
            logger_1.logger.info('Session stop processed successfully', { whatsappId, stationId });
        }
        catch (error) {
            await this.handleError(error, 'session stop', { whatsappId, stationId });
        }
    }
    async processQueueJoin(whatsappId, stationId) {
        try {
            logger_1.logger.info('Processing queue join via alias', { whatsappId, stationId });
            return await this.handleJoinQueue(whatsappId, stationId);
        }
        catch (error) {
            logger_1.logger.error('Failed to process queue join via alias', {
                whatsappId,
                stationId,
                error
            });
            throw error;
        }
    }
    async handleSessionExtend(whatsappId, stationId, minutes) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing session extension', { whatsappId, stationId, minutes });
            const newTargetBatteryLevel = Math.min(100, 80 + Math.floor(minutes / 30) * 10);
            const success = await session_1.sessionService.extendSession(whatsappId, stationId, newTargetBatteryLevel);
            if (!success) {
                await this.sendError(whatsappId, 'Unable to extend session. Please check if you have an active session.');
                return;
            }
            const extendedTime = new Date(Date.now() + minutes * 60000);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⏰ *Session Extended Successfully*\n\n` +
                `⚡ Extended by: ${minutes} minutes\n` +
                `🔋 New target: ${newTargetBatteryLevel}%\n` +
                `🕐 Expected completion: ${extendedTime.toLocaleTimeString()}\n\n` +
                `📊 *Updated session details will be sent shortly.*`);
        }
        catch (error) {
            await this.handleError(error, 'session extend', { whatsappId, stationId });
        }
    }
    async handleInstantBooking(whatsappId, station, user) {
        try {
            const queuePosition = await queue_1.queueService.joinQueue(whatsappId, station.id);
            if (!queuePosition) {
                await this.handleQueueBooking(whatsappId, station, user);
                return;
            }
            const reserved = await queue_1.queueService.reserveSlot(whatsappId, station.id, 15);
            if (reserved) {
                await this.showInstantBookingSuccess(whatsappId, station, user);
            }
            else {
                await this.handleSuccessfulQueueJoin(whatsappId, queuePosition);
            }
        }
        catch (error) {
            logger_1.logger.error('Instant booking failed', { whatsappId, stationId: station.id, error });
            await this.handleQueueBooking(whatsappId, station, user);
        }
    }
    async handleQueueBooking(whatsappId, station, user) {
        const queueStats = await queue_1.queueService.getQueueStats(station.id);
        const message = `📋 *Join Queue at ${station.name}?*\n\n` +
            `📊 *Current Situation:*\n` +
            `• ${queueStats.totalInQueue} people in queue\n` +
            `• Average wait: ${queueStats.averageWaitTime} minutes\n` +
            `• Rate: ${station.priceDisplay}\n` +
            `• Expected cost: ~₹${this.estimateCost(station, user)}\n\n` +
            `💡 *You'll get live updates as the queue moves!*`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *How would you like to proceed?*', [
                { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
                { id: `find_alternatives_${station.id}`, title: '🔍 Find Alternatives' },
                { id: `get_directions_${station.id}`, title: '🗺️ Get Directions' }
            ]);
        }, 2000);
    }
    async handleExistingBooking(whatsappId, existingQueue) {
        const statusText = existingQueue.status === 'reserved' ? 'Reserved' :
            existingQueue.status === 'waiting' ? 'In Queue' : 'Active';
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⚠️ *Existing Booking Found*\n\n` +
            `📍 Station: ${existingQueue.stationName}\n` +
            `📊 Status: ${statusText}\n` +
            `👥 Position: #${existingQueue.position}\n\n` +
            `💡 You can only have one active booking at a time.`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Manage Your Current Booking:*', [
                { id: `queue_status_${existingQueue.stationId}`, title: '📊 Check Status' },
                { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel Current' },
                { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Get Directions' }
            ]);
        }, 2000);
    }
    async showInstantBookingSuccess(whatsappId, station, user) {
        const message = `🎉 *Slot Reserved Successfully!*\n\n` +
            `📍 *${station.name}*\n` +
            `⚡ Slot reserved for 15 minutes\n` +
            `💰 Rate: ${station.priceDisplay}\n` +
            `🎯 Expected cost: ~₹${this.estimateCost(station, user)}\n\n` +
            `⏰ *Please arrive within 15 minutes to start charging.*`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚡ *Ready to Charge?*', [
                { id: `start_session_${station.id}`, title: '⚡ Start Charging' },
                { id: `get_directions_${station.id}`, title: '🗺️ Get Directions' },
                { id: `cancel_queue_${station.id}`, title: '❌ Cancel Booking' }
            ]);
        }, 2000);
    }
    async handleSuccessfulQueueJoin(whatsappId, queuePosition) {
        const waitAdvice = queuePosition.estimatedWaitMinutes > 30 ?
            '\n💡 *Long wait expected. Consider finding alternatives or coming back later.*' :
            '\n✅ *Reasonable wait time. Perfect time for a coffee break!*';
        const message = `📋 *Joined Queue Successfully!*\n\n` +
            `📍 *Station:* ${queuePosition.stationName}\n` +
            `👥 *Your Position:* #${queuePosition.position}\n` +
            `⏱️ *Estimated Wait:* ${queuePosition.estimatedWaitMinutes} minutes\n` +
            `🔔 *Live Updates:* You'll receive notifications as the queue moves${waitAdvice}`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Manage Your Queue Position:*', [
                { id: `queue_status_${queuePosition.stationId}`, title: '📊 Check Status' },
                { id: `get_directions_${queuePosition.stationId}`, title: '🗺️ Get Directions' },
                { id: `cancel_queue_${queuePosition.stationId}`, title: '❌ Cancel Queue' }
            ]);
        }, 2000);
    }
    async handleSuccessfulSessionStart(whatsappId, session) {
        const message = `⚡ *Charging Session Started!*\n\n` +
            `📍 *Station:* ${session.stationName}\n` +
            `🔋 *Current Level:* ${session.currentBatteryLevel}%\n` +
            `🎯 *Target Level:* ${session.targetBatteryLevel}%\n` +
            `⚡ *Charging Rate:* ${session.chargingRate} kW\n` +
            `💰 *Rate:* ₹${session.pricePerKwh}/kWh\n` +
            `📊 *Current Cost:* ₹${session.totalCost.toFixed(2)}\n\n` +
            `🔄 *Live updates every 10 minutes*`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📊 *Session Management:*', [
                { id: `session_status_${session.stationId}`, title: '📊 Live Status' },
                { id: `extend_30_${session.stationId}`, title: '⏰ +30 mins' },
                { id: `session_stop_${session.stationId}`, title: '🛑 Stop Session' }
            ]);
        }, 2000);
    }
    async handleSuccessfulCancellation(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ *Queue Position Cancelled Successfully*\n\n` +
            `Your booking has been cancelled and others have been promoted.\n` +
            `No charges applied for cancellation.\n\n` +
            `💡 *Ready to find another station?*`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Find Your Next Charging Station:*', [
                { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
                { id: 'new_search', title: '🆕 New Search' },
                { id: 'recent_searches', title: '🕒 Recent Locations' }
            ]);
        }, 2000);
    }
    async handleQueueJoinFailure(whatsappId, station) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ *Unable to Join Queue*\n\n` +
            `The queue at ${station.name} might be full or temporarily unavailable.\n\n` +
            `🔍 *Let's find you alternatives:*`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Alternative Options:*', [
                { id: `find_alternatives_${station.id}`, title: '🔍 Find Alternatives' },
                { id: 'find_nearby_stations', title: '🗺️ Search Nearby' },
                { id: 'new_search', title: '🆕 Start New Search' }
            ]);
        }, 2000);
    }
    async handleSessionStartFailure(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ *Unable to Start Charging Session*\n\n` +
            `This might be due to:\n` +
            `• Station connectivity issues\n` +
            `• No valid reservation\n` +
            `• Technical maintenance\n\n` +
            `💡 *Please try again or contact station support.*`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔧 *Available Actions:*', [
                { id: `queue_status_${stationId}`, title: '📊 Check Queue Status' },
                { id: `get_directions_${stationId}`, title: '🗺️ Get Directions' },
                { id: 'help', title: '❓ Contact Support' }
            ]);
        }, 2000);
    }
    async handleNoValidReservation(whatsappId, stationId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⚠️ *No Valid Reservation Found*\n\n` +
            `You need an active queue position or reservation to start charging.\n\n` +
            `💡 *Please join the queue first.*`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Next Steps:*', [
                { id: `join_queue_${stationId}`, title: '📋 Join Queue' },
                { id: `queue_status_${stationId}`, title: '📊 Check Status' },
                { id: 'find_nearby_stations', title: '🔍 Find Alternatives' }
            ]);
        }, 2000);
    }
    async displayQueueStatus(whatsappId, queue) {
        const statusEmoji = {
            'waiting': '⏳',
            'reserved': '✅',
            'charging': '⚡',
            'ready': '🎯',
            'completed': '✅',
            'cancelled': '❌'
        };
        const emoji = statusEmoji[queue.status] || '📋';
        const timeInfo = queue.status === 'reserved' && queue.reservationExpiry ?
            `⏰ Reservation expires: ${new Date(queue.reservationExpiry).toLocaleTimeString()}` :
            `⏱️ Estimated wait: ${queue.estimatedWaitMinutes} minutes`;
        const message = `${emoji} *Queue Status*\n\n` +
            `📍 *Station:* ${queue.stationName}\n` +
            `📊 *Status:* ${this.capitalizeFirst(queue.status)}\n` +
            `👥 *Position:* #${queue.position}\n` +
            `${timeInfo}\n` +
            `📅 *Joined:* ${new Date(queue.createdAt).toLocaleString()}\n\n` +
            `🔄 *Last updated:* Just now`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
    }
    async displaySessionStatus(whatsappId, status, session) {
        const message = `⚡ *Live Charging Status*\n\n` +
            `📍 *Station:* ${session.stationName}\n` +
            `🔋 *Battery Level:* ${status.currentBatteryLevel}%\n` +
            `⚡ *Charging Rate:* ${status.chargingRate} kW\n` +
            `🔌 *Energy Added:* ${status.energyAdded.toFixed(1)} kWh\n` +
            `💰 *Current Cost:* ₹${status.currentCost.toFixed(2)}\n` +
            `⏱️ *Duration:* ${status.duration}\n` +
            `🎯 *Completion:* ${status.estimatedCompletion}\n` +
            `📊 *Efficiency:* ${status.efficiency}%\n\n` +
            `${status.statusMessage}`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎛️ *Session Controls:*', [
                { id: `extend_30_${session.stationId}`, title: '⏰ Extend +30min' },
                { id: `extend_60_${session.stationId}`, title: '⏰ Extend +1hr' },
                { id: `session_stop_${session.stationId}`, title: '🛑 Stop Now' }
            ]);
        }, 2000);
    }
    async displayBasicSessionInfo(whatsappId, session) {
        const duration = Math.floor((Date.now() - session.startTime.getTime()) / (1000 * 60));
        const durationText = duration > 60 ?
            `${Math.floor(duration / 60)}h ${duration % 60}m` :
            `${duration}m`;
        const message = `⚡ *Active Charging Session*\n\n` +
            `📍 *Station:* ${session.stationName}\n` +
            `🔋 *Current Level:* ${session.currentBatteryLevel}%\n` +
            `🎯 *Target Level:* ${session.targetBatteryLevel}%\n` +
            `⚡ *Charging Rate:* ${session.chargingRate} kW\n` +
            `💰 *Rate:* ₹${session.pricePerKwh}/kWh\n` +
            `⏱️ *Duration:* ${durationText}\n` +
            `📊 *Current Cost:* ₹${session.totalCost.toFixed(2)}\n\n` +
            `🔄 *Session is active and running*`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎛️ *Session Controls:*', [
                { id: `extend_30_${session.stationId}`, title: '⏰ Extend +30min' },
                { id: `extend_60_${session.stationId}`, title: '⏰ Extend +1hr' },
                { id: `session_stop_${session.stationId}`, title: '🛑 Stop Now' }
            ]);
        }, 2000);
    }
    async showNoActiveQueues(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 *Your Active Bookings*\n\n' +
            'No active bookings or queue positions found.\n\n' +
            '🔍 Ready to find a charging station?');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '⚡ *Find Charging Stations:*', [
                { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
                { id: 'new_search', title: '🆕 New Search' },
                { id: 'recent_searches', title: '🕒 Recent Searches' }
            ]);
        }, 2000);
    }
    async showExistingQueueStatus(whatsappId, existingQueue) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `📋 *Already in Queue*\n\n` +
            `You're already in the queue at this station.\n\n` +
            `👥 *Position:* #${existingQueue.position}\n` +
            `⏱️ *Wait Time:* ${existingQueue.estimatedWaitMinutes} minutes\n\n` +
            `💡 *You'll receive updates as your position changes.*`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *Manage Your Position:*', [
                { id: `queue_status_${existingQueue.stationId}`, title: '📊 Refresh Status' },
                { id: `get_directions_${existingQueue.stationId}`, title: '🗺️ Get Directions' },
                { id: `cancel_queue_${existingQueue.stationId}`, title: '❌ Cancel Queue' }
            ]);
        }, 2000);
    }
    async sendQueueManagementButtons(whatsappId, queues) {
        if (queues.length === 0)
            return;
        const buttons = [];
        const primaryQueue = queues[0];
        if (primaryQueue.status === 'reserved') {
            buttons.push({ id: `start_session_${primaryQueue.stationId}`, title: '⚡ Start Charging' });
        }
        buttons.push({ id: `get_directions_${primaryQueue.stationId}`, title: '🗺️ Get Directions' }, { id: `cancel_queue_${primaryQueue.stationId}`, title: '❌ Cancel Queue' });
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎛️ *Queue Management:*', buttons.slice(0, 3));
    }
    async handleGetDirections(whatsappId, stationId) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found.');
                return;
            }
            const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(station.name + ' ' + station.address)}`;
            const wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(station.name + ' ' + station.address)}`;
            const message = `🗺️ *Directions to ${station.name}*\n\n` +
                `📍 **Address:**\n${station.address}\n\n` +
                `🔗 **Navigation Links:**\n` +
                `📱 Google Maps: ${googleMapsUrl}\n` +
                `🚗 Waze: ${wazeUrl}\n\n` +
                `💡 **Tips:**\n` +
                `• Save this location for faster access\n` +
                `• Check station hours before travelling\n` +
                `• Arrive 5 minutes early if you have a reservation`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
            setTimeout(async () => {
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '📱 *While you travel:*', [
                    { id: `queue_status_${station.id}`, title: '📊 Check Queue Status' },
                    { id: `station_info_${station.id}`, title: '📋 Station Details' },
                    { id: 'help', title: '❓ Contact Support' }
                ]);
            }, 2000);
        }
        catch (error) {
            await this.handleError(error, 'get directions', { whatsappId, stationId });
        }
    }
    async handleFindAlternatives(whatsappId, stationId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId))
            return;
        try {
            logger_1.logger.info('Finding alternatives for station', { whatsappId, stationId });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🔍 *Finding Alternative Stations...*\n\n' +
                'Searching for nearby options with:\n' +
                '• Similar charging speeds\n' +
                '• Compatible connectors\n' +
                '• Shorter wait times\n' +
                '• Better rates\n\n' +
                '⏳ *Please wait...*');
            const user = await userService_1.userService.getUserByWhatsAppId(whatsappId);
            const userConnector = user?.connectorType;
            setTimeout(async () => {
                const alternativeMessage = `🎯 *Alternative Strategies:*\n\n` +
                    `**Quick Options:**\n` +
                    `🔍 Expand search radius for more stations\n` +
                    `⏰ Check stations with shorter queues\n` +
                    `💰 Find stations with better rates\n\n` +
                    `**Smart Suggestions:**\n` +
                    `${userConnector ? `🔌 Focus on ${userConnector} compatible stations\n` : ''}` +
                    `📊 Consider off-peak hours (10 PM - 8 AM)\n` +
                    `🏢 Try commercial areas vs residential`;
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, alternativeMessage);
                await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🎯 *Choose Your Next Move:*', [
                    { id: 'expand_search', title: '📡 Expand Search Area' },
                    { id: 'find_nearby_stations', title: '🗺️ Find Nearby Stations' },
                    { id: 'new_search', title: '🆕 Start New Search' }
                ]);
            }, 3000);
        }
        catch (error) {
            await this.handleError(error, 'find alternatives', { whatsappId, stationId });
        }
    }
    async handleStationRating(whatsappId, stationId, rating) {
        if (!this.validateInput(whatsappId, stationId))
            return;
        try {
            logger_1.logger.info('Processing station rating', { whatsappId, stationId, rating });
            if (rating < 1 || rating > 5) {
                await this.sendError(whatsappId, 'Please provide a rating between 1 and 5 stars.');
                return;
            }
            const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            const hasUsedStation = userQueues.some(q => q.stationId === stationId &&
                (q.status === 'completed' || q.status === 'charging'));
            if (!hasUsedStation) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⭐ *Station Rating*\n\n' +
                    'Thank you for wanting to rate this station!\n\n' +
                    '💡 *You can rate stations after using them.*\n' +
                    'This helps maintain authentic reviews.');
                return;
            }
            const station = await this.getStationDetails(stationId);
            if (!station) {
                await this.sendNotFound(whatsappId, 'Station not found.');
                return;
            }
            const ratingText = rating === 5 ? 'Excellent! ⭐⭐⭐⭐⭐' :
                rating === 4 ? 'Great! ⭐⭐⭐⭐' :
                    rating === 3 ? 'Good ⭐⭐⭐' :
                        rating === 2 ? 'Fair ⭐⭐' : 'Poor ⭐';
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `⭐ *Rating Submitted Successfully!*\n\n` +
                `📍 **Station:** ${station.name}\n` +
                `⭐ **Your Rating:** ${ratingText}\n\n` +
                `🙏 **Thank you for helping the EV community!**\n` +
                `Your feedback helps other users make informed decisions.`);
            if (rating <= 3) {
                setTimeout(async () => {
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '💬 *Help us improve!*\n\n' +
                        'Would you like to share what could be better?\n' +
                        'Simply reply with your feedback, and we\'ll make sure ' +
                        'the station owner gets your suggestions.');
                }, 2000);
            }
        }
        catch (error) {
            await this.handleError(error, 'station rating', { whatsappId, stationId, rating });
        }
    }
    async getStationDetails(stationId) {
        try {
            const stations = await database_1.db
                .select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            if (stations.length === 0) {
                logger_1.logger.warn('Station not found in database', { stationId });
                return null;
            }
            return this.processStationData(stations[0]);
        }
        catch (error) {
            logger_1.logger.error('Database query failed', { stationId, error });
            return null;
        }
    }
    processStationData(station) {
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
    async showStationOverview(whatsappId, station) {
        const overviewText = `🏢 *${station.name}*\n\n` +
            `📍 ${station.address}\n` +
            `📏 ${station.distanceDisplay}\n` +
            `⚡ ${station.slotsDisplay}\n` +
            `💰 ${station.priceDisplay}\n` +
            `⭐ ${station.ratingDisplay} (${station.finalReviews} reviews)\n\n` +
            `🔌 *Connectors:* ${this.formatConnectorTypes(station.connectorTypes)}\n` +
            `🕒 *Hours:* ${this.formatOperatingHours(station.operatingHours)}\n` +
            `🎯 *Status:* ${this.getStatusWithEmoji(station.availability)}`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, overviewText);
        setTimeout(async () => {
            await this.sendStationActionButtons(whatsappId, station);
        }, 2000);
    }
    formatStationDetails(station) {
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
        if (station.amenities && Array.isArray(station.amenities) && station.amenities.length > 0) {
            detailsText += `\n🎯 *Amenities:*\n${station.amenities.map((a) => `• ${this.capitalizeFirst(a)}`).join('\n')}\n`;
        }
        detailsText += `\n${this.getStatusWithEmoji(station.availability)} *Status:* ${station.availability}`;
        return detailsText;
    }
    async showBookingOptions(whatsappId, station, user) {
        const message = `⚡ *Ready to Charge at ${station.name}?*\n\n` +
            `📊 *Current Status:*\n` +
            `• ${station.slotsDisplay}\n` +
            `• Rate: ${station.priceDisplay}\n` +
            `• Expected for your ${user.evModel || 'EV'}: ~₹${this.estimateCost(station, user)}\n\n` +
            `🔌 *Your Vehicle:*\n` +
            `• Model: ${user.evModel || 'Not specified'}\n` +
            `• Connector: ${user.connectorType || 'Any'}\n\n` +
            `🎯 Choose your preferred option below:`;
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, message);
        setTimeout(async () => {
            const buttons = this.getBookingButtons(station);
            await whatsapp_1.whatsappService.sendListMessage(whatsappId, '⚡ *Booking Options*', 'Select how you want to proceed:', [
                {
                    title: '🚀 Quick Actions',
                    rows: buttons.quick
                },
                {
                    title: '📋 More Options',
                    rows: buttons.detailed
                }
            ]);
        }, 2000);
    }
    async sendStationActionButtons(whatsappId, station) {
        const buttons = [];
        if (station.isAvailable) {
            buttons.push({ id: `book_station_${station.id}`, title: '⚡ Book Now' });
            buttons.push({ id: `station_info_${station.id}`, title: '📊 More Details' });
        }
        else {
            buttons.push({ id: `join_queue_${station.id}`, title: '📋 Join Queue' });
            buttons.push({ id: `find_alternatives_${station.id}`, title: '🔍 Find Alternatives' });
        }
        buttons.push({ id: `get_directions_${station.id}`, title: '🗺️ Get Directions' });
        if (buttons.length > 0) {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `🎯 *What would you like to do at ${station.name}?*`, buttons.slice(0, 3), '🏢 Station Actions');
        }
    }
    getBookingButtons(station) {
        const quick = [];
        const detailed = [];
        if (station.availableSlots > 0) {
            quick.push({
                id: `join_queue_${station.id}`,
                title: '⚡ Book Immediately',
                description: 'Reserve your slot now'
            });
        }
        detailed.push({
            id: `queue_status_${station.id}`,
            title: '📊 Check Wait Time',
            description: 'See current queue status'
        }, {
            id: `get_directions_${station.id}`,
            title: '🗺️ Get Directions',
            description: 'Navigate to station'
        }, {
            id: `find_alternatives_${station.id}`,
            title: '🔍 Find Alternatives',
            description: 'Browse nearby stations'
        });
        return { quick, detailed };
    }
    async handleUnavailableStation(whatsappId, station) {
        let reason = '❌ Station is currently unavailable.';
        let suggestion = 'Please try another station.';
        if (!station.isActive) {
            reason = '🚫 Station is temporarily disabled for maintenance.';
            suggestion = 'Check back later or find an alternative.';
        }
        else if (!station.isOpen) {
            reason = '🕐 Station is currently closed.';
            suggestion = `Operating hours: ${this.formatOperatingHours(station.operatingHours)}`;
        }
        else if (station.availableSlots === 0) {
            reason = '🔴 All charging slots are currently occupied.';
            suggestion = 'Join the queue or find an alternative station.';
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `${reason}\n\n${suggestion}`);
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '🔍 *Alternative Options:*', [
                { id: `join_queue_${station.id}`, title: '📋 Join Queue' },
                { id: 'find_nearby_stations', title: '🗺️ Find Nearby' },
                { id: 'new_search', title: '🆕 New Search' }
            ]);
        }, 2000);
    }
    validateInput(whatsappId, stationId) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
            logger_1.logger.error('Invalid WhatsApp ID', { whatsappId });
            return false;
        }
        if (!stationId || isNaN(stationId) || stationId <= 0) {
            logger_1.logger.error('Invalid station ID', { stationId, whatsappId });
            whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID. Please try again.');
            return false;
        }
        return true;
    }
    isStationBookable(station) {
        return station.isActive === true && station.isOpen === true;
    }
    formatConnectorTypes(connectorTypes) {
        if (Array.isArray(connectorTypes)) {
            return connectorTypes.length > 0 ? connectorTypes.join(', ') : 'Standard';
        }
        return connectorTypes || 'Standard';
    }
    formatOperatingHours(operatingHours) {
        if (typeof operatingHours === 'object' && operatingHours !== null) {
            const allDay = Object.values(operatingHours).every(hours => hours === '24/7');
            if (allDay)
                return '24/7';
            return 'Varies by day (check station for details)';
        }
        return operatingHours || '24/7';
    }
    getStatusWithEmoji(availability) {
        const emojiMap = {
            'Available': '✅',
            'Full': '🔴',
            'Offline': '⚫'
        };
        return emojiMap[availability] || '❓';
    }
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
    estimateCost(station, user) {
        const basePrice = Number(station.pricePerKwh) || 12;
        const estimatedKwh = user.connectorType === 'CCS2' ? 25 : 15;
        const estimatedCost = basePrice * estimatedKwh;
        return estimatedCost.toFixed(0);
    }
    async handleError(error, operation, context) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error(`${operation} failed`, { ...context, error: errorMessage });
        const whatsappId = context.whatsappId;
        if (whatsappId) {
            await this.sendError(whatsappId, `Failed to ${operation}. Please try again.`);
        }
    }
    async sendError(whatsappId, message) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
        }
        catch (sendError) {
            logger_1.logger.error('Failed to send error message', { whatsappId, sendError });
        }
    }
    async sendNotFound(whatsappId, message) {
        try {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `🔍 ${message}`);
        }
        catch (sendError) {
            logger_1.logger.error('Failed to send not found message', { whatsappId, sendError });
        }
    }
    getHealthStatus() {
        return {
            status: 'healthy',
            activeOperations: 0,
            lastActivity: new Date().toISOString(),
            integrations: {
                queueService: !!queue_1.queueService,
                sessionService: !!session_1.sessionService,
                notificationService: !!notification_1.notificationService
            }
        };
    }
    async handleBulkOperation(whatsappId, operation, data) {
        if (!(0, validation_1.validateWhatsAppId)(whatsappId))
            return;
        try {
            logger_1.logger.info('Processing bulk operation', { whatsappId, operation, count: data.length });
            switch (operation) {
                case 'cancel_all_queues':
                    await this.cancelAllUserQueues(whatsappId);
                    break;
                case 'get_all_status':
                    await this.getAllUserStatuses(whatsappId);
                    break;
                default:
                    await this.sendError(whatsappId, 'Unknown bulk operation.');
            }
        }
        catch (error) {
            await this.handleError(error, 'bulk operation', { whatsappId, operation });
        }
    }
    async cancelAllUserQueues(whatsappId) {
        const userQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
        if (userQueues.length === 0) {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📋 No active queues to cancel.');
            return;
        }
        let cancelledCount = 0;
        for (const queue of userQueues) {
            if (queue.status !== 'completed') {
                const success = await queue_1.queueService.leaveQueue(whatsappId, queue.stationId, 'user_cancelled');
                if (success)
                    cancelledCount++;
            }
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ *Bulk Cancellation Complete*\n\n` +
            `📊 Cancelled ${cancelledCount} of ${userQueues.length} queues.\n\n` +
            `💡 You're now free to book at any station.`);
    }
    async getAllUserStatuses(whatsappId) {
        const [userQueues, activeSessions] = await Promise.all([
            queue_1.queueService.getUserQueueStatus(whatsappId),
            this.getUserActiveSessions(whatsappId)
        ]);
        if (userQueues.length === 0 && activeSessions.length === 0) {
            await this.showNoActiveQueues(whatsappId);
            return;
        }
        let statusMessage = `📊 *Your Complete Status*\n\n`;
        if (userQueues.length > 0) {
            statusMessage += `📋 **Active Queues (${userQueues.length}):**\n`;
            userQueues.forEach((queue, index) => {
                statusMessage += `${index + 1}. ${queue.stationName} - Position #${queue.position}\n`;
            });
            statusMessage += `\n`;
        }
        if (activeSessions.length > 0) {
            statusMessage += `⚡ **Active Sessions (${activeSessions.length}):**\n`;
            activeSessions.forEach((session, index) => {
                statusMessage += `${index + 1}. ${session.stationName} - ${session.currentBatteryLevel}% charged\n`;
            });
        }
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, statusMessage);
    }
    async getUserActiveSessions(whatsappId) {
        try {
            const chargingQueues = await queue_1.queueService.getUserQueueStatus(whatsappId);
            const activeSessions = [];
            for (const queue of chargingQueues) {
                if (queue.status === 'charging') {
                    const session = await session_1.sessionService.getActiveSession(whatsappId, queue.stationId);
                    if (session) {
                        activeSessions.push(session);
                    }
                }
            }
            return activeSessions;
        }
        catch (error) {
            logger_1.logger.error('Failed to get user active sessions', { whatsappId, error });
            return [];
        }
    }
}
exports.BookingController = BookingController;
exports.bookingController = new BookingController();
//# sourceMappingURL=booking.js.map