"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionService = void 0;
const connection_1 = require("../db/connection");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const logger_1 = require("../utils/logger");
const notification_1 = require("./notification");
class SessionService {
    constructor() {
        this.activeSessions = new Map();
        this.sessionMonitors = new Map();
    }
    async startSession(userWhatsapp, stationId, queueId) {
        try {
            logger_1.logger.info('⚡ Starting charging session', { userWhatsapp, stationId, queueId });
            const existingSession = await this.getActiveSession(userWhatsapp, stationId);
            if (existingSession && ['active', 'paused'].includes(existingSession.status)) {
                logger_1.logger.info('Reusing existing session', { sessionId: existingSession.id });
                if (!this.sessionMonitors.has(existingSession.id)) {
                    await this.startSessionMonitoring(existingSession);
                }
                return existingSession;
            }
            const station = await connection_1.db.select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, stationId))
                .limit(1);
            if (!station.length) {
                logger_1.logger.error('Station not found for session', { stationId });
                return null;
            }
            const stationData = station[0];
            const sessionId = this.generateSessionId(userWhatsapp, stationId);
            const session = {
                id: sessionId,
                userWhatsapp,
                stationId,
                stationName: stationData.name,
                startTime: new Date(),
                energyDelivered: 0,
                currentBatteryLevel: 20,
                targetBatteryLevel: 80,
                chargingRate: stationData.maxPowerKw || 50,
                pricePerKwh: Number(stationData.pricePerKwh),
                totalCost: 0,
                status: 'active',
                efficiency: 95,
                queueId
            };
            await this.saveSessionToDatabase(session);
            this.activeSessions.set(sessionId, session);
            await this.startSessionMonitoring(session);
            await notification_1.notificationService.sendSessionStartNotification(userWhatsapp, session);
            logger_1.logger.info('✅ Charging session started successfully', { sessionId, userWhatsapp, stationId });
            return session;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to start charging session', { userWhatsapp, stationId, error });
            return null;
        }
    }
    async getActiveSession(userWhatsapp, stationId) {
        const sessionId = this.generateSessionId(userWhatsapp, stationId);
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            for (const s of this.activeSessions.values()) {
                if (s.userWhatsapp === userWhatsapp && s.stationId === stationId &&
                    ['active', 'paused'].includes(s.status)) {
                    return s;
                }
            }
        }
        return session || null;
    }
    async getSessionStatus(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session)
            return null;
        const now = new Date();
        const durationMinutes = Math.floor((now.getTime() - session.startTime.getTime()) / (1000 * 60));
        const progressData = this.calculateChargingProgress(session, durationMinutes);
        return {
            currentBatteryLevel: progressData.currentBatteryLevel,
            chargingRate: progressData.chargingRate,
            energyAdded: progressData.energyAdded,
            currentCost: progressData.currentCost,
            duration: this.formatDuration(durationMinutes),
            estimatedCompletion: progressData.estimatedCompletion,
            efficiency: progressData.efficiency,
            statusMessage: progressData.statusMessage
        };
    }
    async getCostBreakdown(sessionId) {
        if (!sessionId)
            return this.getDefaultCostBreakdown();
        const session = this.activeSessions.get(sessionId);
        if (!session)
            return this.getDefaultCostBreakdown();
        const energyConsumed = session.energyDelivered;
        const energyCost = energyConsumed * session.pricePerKwh;
        const platformFee = Math.max(5, energyCost * 0.05);
        const gstRate = 18;
        const gst = (energyCost + platformFee) * (gstRate / 100);
        const totalCost = energyCost + platformFee + gst;
        return {
            energyRate: session.pricePerKwh,
            energyConsumed,
            energyCost: Math.round(energyCost * 100) / 100,
            platformFee: Math.round(platformFee * 100) / 100,
            gstRate,
            gst: Math.round(gst * 100) / 100,
            totalCost: Math.round(totalCost * 100) / 100,
            homeComparison: this.calculateHomeComparison(energyConsumed, totalCost),
            petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost)
        };
    }
    async pauseSession(userWhatsapp, stationId) {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (!session || session.status !== 'active') {
                logger_1.logger.warn('No active session to pause', { userWhatsapp, stationId });
                return false;
            }
            session.status = 'paused';
            this.activeSessions.set(session.id, session);
            await this.updateSessionInDatabase(session);
            const monitor = this.sessionMonitors.get(session.id);
            if (monitor)
                clearInterval(monitor);
            await notification_1.notificationService.sendSessionPausedNotification(userWhatsapp, session);
            setTimeout(async () => {
                const currentSession = this.activeSessions.get(session.id);
                if (currentSession && currentSession.status === 'paused') {
                    await this.resumeSession(userWhatsapp, stationId);
                }
            }, 10 * 60 * 1000);
            logger_1.logger.info('⏸️ Session paused', { sessionId: session.id, userWhatsapp, stationId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to pause session', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async resumeSession(userWhatsapp, stationId) {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (!session || session.status !== 'paused') {
                logger_1.logger.warn('No paused session to resume', { userWhatsapp, stationId });
                return false;
            }
            session.status = 'active';
            this.activeSessions.set(session.id, session);
            await this.updateSessionInDatabase(session);
            await this.startSessionMonitoring(session);
            await notification_1.notificationService.sendSessionResumedNotification(userWhatsapp, session);
            logger_1.logger.info('▶️ Session resumed', { sessionId: session.id, userWhatsapp, stationId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to resume session', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async completeSession(userWhatsapp, stationId) {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (!session) {
                logger_1.logger.warn('No active session to complete', { userWhatsapp, stationId });
                return null;
            }
            const monitor = this.sessionMonitors.get(session.id);
            if (monitor) {
                clearInterval(monitor);
                this.sessionMonitors.delete(session.id);
            }
            session.status = 'completed';
            session.endTime = new Date();
            const costBreakdown = await this.getCostBreakdown(session.id);
            session.totalCost = costBreakdown?.totalCost ?? 0;
            const durationMinutes = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60));
            const summary = {
                sessionId: session.id,
                duration: this.formatDuration(durationMinutes),
                energyDelivered: session.energyDelivered,
                finalBatteryLevel: session.currentBatteryLevel,
                totalCost: session.totalCost,
                efficiency: session.efficiency,
                stationName: session.stationName || 'Unknown Station',
                startTime: session.startTime,
                endTime: session.endTime
            };
            this.activeSessions.delete(session.id);
            await this.updateSessionInDatabase(session, true);
            await notification_1.notificationService.sendSessionCompletedNotification(userWhatsapp, session, summary);
            logger_1.logger.info('✅ Session completed successfully', { sessionId: session.id, summary });
            return summary;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to complete session', { userWhatsapp, stationId, error });
            return null;
        }
    }
    async stopSession(userWhatsapp, stationId) {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (!session) {
                logger_1.logger.warn('No active session to stop', { userWhatsapp, stationId });
                return false;
            }
            session.status = 'stopped';
            session.endTime = new Date();
            const durationMinutes = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60));
            session.energyDelivered = Math.floor(durationMinutes * 0.5);
            session.totalCost = session.energyDelivered * 12.5;
            await this.updateSessionInDatabase(session, true);
            this.activeSessions.delete(session.id);
            const monitor = this.sessionMonitors.get(session.id);
            if (monitor) {
                clearInterval(monitor);
                this.sessionMonitors.delete(session.id);
            }
            logger_1.logger.info('Session stopped', {
                sessionId: session.id,
                userWhatsapp,
                stationId,
                duration: durationMinutes
            });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to stop session', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async forceStopSession(userWhatsapp, stationId, reason = 'manual_stop') {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (session) {
                session.status = 'stopped';
                await this.completeSession(userWhatsapp, stationId);
            }
            logger_1.logger.info('🚨 Session force stopped', { userWhatsapp, stationId, reason });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Force stop failed', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async extendSession(userWhatsapp, stationId, newTarget) {
        try {
            const session = await this.getActiveSession(userWhatsapp, stationId);
            if (!session || session.status !== 'active') {
                logger_1.logger.warn('Cannot extend inactive session', { userWhatsapp, stationId });
                return false;
            }
            session.targetBatteryLevel = newTarget;
            this.activeSessions.set(session.id, session);
            await this.updateSessionInDatabase(session);
            await notification_1.notificationService.sendSessionExtendedNotification(userWhatsapp, session, newTarget);
            logger_1.logger.info('⏰ Session extended', { sessionId: session.id, newTarget });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to extend session', { userWhatsapp, stationId, error });
            return false;
        }
    }
    async saveSessionToDatabase(session) {
        try {
            await connection_1.db.insert(schema_1.chargingSessions).values({
                sessionId: session.id,
                stationId: session.stationId,
                userWhatsapp: session.userWhatsapp,
                queueId: session.queueId || null,
                status: session.status,
                startTime: session.startTime,
                endTime: session.endTime || null,
                duration: session.endTime ?
                    Math.floor((session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60)) : null,
                energyDelivered: session.energyDelivered.toString(),
                peakPowerKw: session.chargingRate.toString(),
                averagePowerKw: session.chargingRate.toString(),
                totalCost: session.totalCost.toString(),
                ratePerKwh: session.pricePerKwh.toString()
            });
            logger_1.logger.info('💾 Session saved to database', { sessionId: session.id });
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to save session to database', { sessionId: session.id, error });
            throw error;
        }
    }
    async updateSessionInDatabase(session, isFinal = false) {
        try {
            const updateData = {
                status: session.status,
                energyDelivered: session.energyDelivered.toString(),
                totalCost: session.totalCost.toString(),
                updatedAt: new Date()
            };
            if (isFinal && session.endTime) {
                updateData.endTime = session.endTime;
                updateData.duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60));
            }
            await connection_1.db.update(schema_1.chargingSessions)
                .set(updateData)
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, session.id));
            logger_1.logger.info('🔄 Session updated in database', { sessionId: session.id });
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to update session in database', { sessionId: session.id, error });
        }
    }
    async startSessionMonitoring(session) {
        const sessionId = session.id;
        const existingMonitor = this.sessionMonitors.get(sessionId);
        if (existingMonitor)
            clearInterval(existingMonitor);
        const monitor = setInterval(async () => {
            await this.updateSessionProgress(session);
        }, 30 * 1000);
        this.sessionMonitors.set(sessionId, monitor);
        logger_1.logger.info('🔄 Session monitoring started', { sessionId });
    }
    async updateSessionProgress(session) {
        try {
            if (session.status !== 'active')
                return;
            const now = new Date();
            const durationMinutes = Math.floor((now.getTime() - session.startTime.getTime()) / (1000 * 60));
            const progress = this.calculateChargingProgress(session, durationMinutes);
            session.currentBatteryLevel = progress.currentBatteryLevel;
            session.energyDelivered = progress.energyAdded;
            session.chargingRate = progress.chargingRate;
            session.totalCost = progress.currentCost;
            if (session.currentBatteryLevel >= session.targetBatteryLevel) {
                await this.completeSession(session.userWhatsapp, session.stationId);
                return;
            }
            if (durationMinutes % 10 === 0 && durationMinutes > 0) {
                await notification_1.notificationService.sendSessionProgressNotification(session.userWhatsapp, session, progress);
            }
            this.activeSessions.set(session.id, session);
            if (durationMinutes % 5 === 0) {
                await this.updateSessionInDatabase(session);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to update session progress', { sessionId: session.id, error });
        }
    }
    calculateChargingProgress(session, durationMinutes) {
        const baseRate = session.chargingRate;
        const startBattery = 20;
        const targetBattery = session.targetBatteryLevel;
        const batteryRange = targetBattery - startBattery;
        const timeToTarget = (batteryRange / baseRate) * 60;
        let currentBatteryLevel = startBattery;
        let chargingRate = baseRate;
        if (durationMinutes < timeToTarget) {
            if (currentBatteryLevel < 80) {
                chargingRate = baseRate;
                currentBatteryLevel = startBattery + (durationMinutes / timeToTarget) * batteryRange;
            }
            else {
                chargingRate = baseRate * 0.5;
                currentBatteryLevel = startBattery + (durationMinutes / timeToTarget) * batteryRange;
            }
        }
        else {
            currentBatteryLevel = targetBattery;
            chargingRate = 0;
        }
        const energyAdded = (currentBatteryLevel - startBattery) * 0.6;
        const currentCost = energyAdded * session.pricePerKwh;
        const remainingBattery = targetBattery - currentBatteryLevel;
        const remainingTime = remainingBattery > 0 ? (remainingBattery / chargingRate) * 60 : 0;
        const estimatedCompletion = new Date(Date.now() + remainingTime * 60 * 1000).toLocaleTimeString();
        const efficiency = Math.max(90, 100 - (durationMinutes * 0.1));
        let statusMessage = '';
        if (currentBatteryLevel >= targetBattery) {
            statusMessage = '🎉 Charging complete! Your EV is ready.';
        }
        else if (currentBatteryLevel >= 80) {
            statusMessage = '🔋 Nearly full! Charging is slowing down.';
        }
        else if (chargingRate >= baseRate * 0.8) {
            statusMessage = '⚡ Fast charging in progress!';
        }
        else {
            statusMessage = '🔄 Steady charging progress.';
        }
        return {
            currentBatteryLevel: Math.min(Math.round(currentBatteryLevel), targetBattery),
            chargingRate: Math.round(chargingRate * 10) / 10,
            energyAdded: Math.round(energyAdded * 100) / 100,
            currentCost: Math.round(currentCost * 100) / 100,
            estimatedCompletion,
            efficiency: Math.round(efficiency),
            statusMessage
        };
    }
    generateSessionId(userWhatsapp, stationId) {
        return `session_${userWhatsapp}_${stationId}_${Date.now()}`;
    }
    formatDuration(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }
    getDefaultCostBreakdown() {
        const energyConsumed = 25;
        const energyRate = 12;
        const energyCost = energyConsumed * energyRate;
        const platformFee = energyCost * 0.05;
        const gstRate = 18;
        const gst = (energyCost + platformFee) * (gstRate / 100);
        const totalCost = energyCost + platformFee + gst;
        return {
            energyRate,
            energyConsumed,
            energyCost,
            platformFee,
            gstRate,
            gst,
            totalCost,
            homeComparison: this.calculateHomeComparison(energyConsumed, totalCost),
            petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost)
        };
    }
    calculateHomeComparison(energyConsumed, totalCost) {
        const homeCostPerKwh = 5;
        const homeCost = energyConsumed * homeCostPerKwh;
        const difference = totalCost - homeCost;
        const percentage = Math.round((difference / homeCost) * 100);
        return `₹${Math.round(difference)} more (${percentage}% higher)`;
    }
    calculatePetrolComparison(energyConsumed, totalCost) {
        const petrolEfficiency = 15;
        const evEfficiency = 4;
        const petrolPrice = 100;
        const kmDriven = energyConsumed * evEfficiency;
        const petrolNeeded = kmDriven / petrolEfficiency;
        const petrolCost = petrolNeeded * petrolPrice;
        const savings = petrolCost - totalCost;
        const percentage = Math.round((savings / petrolCost) * 100);
        return `₹${Math.round(savings)} saved (${percentage}% cheaper)`;
    }
    calculatePetrolEquivalentCost(energyKwh) {
        const evEfficiency = 4;
        const petrolEfficiency = 15;
        const petrolPrice = 100;
        const kmDriven = energyKwh * evEfficiency;
        const petrolNeeded = kmDriven / petrolEfficiency;
        return petrolNeeded * petrolPrice;
    }
    getActiveSessions() {
        return this.activeSessions;
    }
    async getSessionById(sessionId) {
        try {
            const sessions = await connection_1.db.select({
                id: schema_1.chargingSessions.sessionId,
                userWhatsapp: schema_1.chargingSessions.userWhatsapp,
                stationId: schema_1.chargingSessions.stationId,
                stationName: schema_1.chargingStations.name,
                startTime: schema_1.chargingSessions.startTime,
                endTime: schema_1.chargingSessions.endTime,
                energyDelivered: schema_1.chargingSessions.energyDelivered,
                totalCost: schema_1.chargingSessions.totalCost,
                status: schema_1.chargingSessions.status,
                ratePerKwh: schema_1.chargingSessions.ratePerKwh
            })
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.sessionId, sessionId))
                .limit(1);
            if (!sessions.length)
                return null;
            const session = sessions[0];
            return {
                id: session.id,
                userWhatsapp: session.userWhatsapp,
                stationId: session.stationId,
                stationName: session.stationName || 'Unknown Station',
                startTime: session.startTime || new Date(),
                endTime: session.endTime || undefined,
                energyDelivered: Number(session.energyDelivered) || 0,
                currentBatteryLevel: 0,
                targetBatteryLevel: 80,
                chargingRate: 0,
                pricePerKwh: Number(session.ratePerKwh) || 0,
                totalCost: Number(session.totalCost) || 0,
                status: session.status,
                efficiency: 95
            };
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to get session by ID', { sessionId, error });
            return null;
        }
    }
    async getSessionHistory(userWhatsapp, limit = 10) {
        try {
            const sessions = await connection_1.db.select({
                id: schema_1.chargingSessions.sessionId,
                userWhatsapp: schema_1.chargingSessions.userWhatsapp,
                stationId: schema_1.chargingSessions.stationId,
                stationName: schema_1.chargingStations.name,
                startTime: schema_1.chargingSessions.startTime,
                endTime: schema_1.chargingSessions.endTime,
                energyDelivered: schema_1.chargingSessions.energyDelivered,
                totalCost: schema_1.chargingSessions.totalCost,
                status: schema_1.chargingSessions.status,
                duration: schema_1.chargingSessions.duration,
                ratePerKwh: schema_1.chargingSessions.ratePerKwh
            })
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, userWhatsapp))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.chargingSessions.createdAt))
                .limit(limit);
            return sessions.map(session => ({
                id: session.id,
                userWhatsapp: session.userWhatsapp,
                stationId: session.stationId,
                stationName: session.stationName || 'Unknown Station',
                startTime: session.startTime || new Date(),
                endTime: session.endTime || undefined,
                energyDelivered: Number(session.energyDelivered) || 0,
                currentBatteryLevel: 0,
                targetBatteryLevel: 80,
                chargingRate: 0,
                pricePerKwh: Number(session.ratePerKwh) || 0,
                totalCost: Number(session.totalCost) || 0,
                status: session.status,
                efficiency: 95
            }));
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to get session history', { userWhatsapp, error });
            return [];
        }
    }
    async getUserStats(userWhatsapp) {
        try {
            const basicStats = await connection_1.db.select({
                totalSessions: (0, drizzle_orm_1.count)(),
                totalEnergyConsumed: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.energyDelivered),
                totalCostSpent: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost),
                avgSessionTime: (0, drizzle_orm_1.avg)(schema_1.chargingSessions.duration)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, userWhatsapp), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const favoriteStationQuery = await connection_1.db.select({
                stationId: schema_1.chargingSessions.stationId,
                stationName: schema_1.chargingStations.name,
                sessionCount: (0, drizzle_orm_1.count)()
            })
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.userWhatsapp, userWhatsapp), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')))
                .groupBy(schema_1.chargingSessions.stationId, schema_1.chargingStations.name)
                .orderBy((0, drizzle_orm_1.desc)((0, drizzle_orm_1.count)()))
                .limit(1);
            const stats = basicStats[0];
            const favoriteStation = favoriteStationQuery[0];
            const totalEnergyKwh = Number(stats.totalEnergyConsumed) || 0;
            const totalCost = Number(stats.totalCostSpent) || 0;
            const petrolEquivalentCost = this.calculatePetrolEquivalentCost(totalEnergyKwh);
            const totalSavings = petrolEquivalentCost - totalCost;
            return {
                totalSessions: Number(stats.totalSessions) || 0,
                totalEnergyConsumed: totalEnergyKwh,
                totalCostSpent: totalCost,
                avgSessionTime: Number(stats.avgSessionTime) || 0,
                favoriteStation: favoriteStation ? {
                    id: favoriteStation.stationId,
                    name: favoriteStation.stationName || 'Unknown Station',
                    sessionCount: Number(favoriteStation.sessionCount)
                } : null,
                totalSavings: Math.max(0, totalSavings),
                avgEfficiency: 95
            };
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to get user stats', { userWhatsapp, error });
            return null;
        }
    }
    async emergencyStopStation(stationId) {
        try {
            let stoppedCount = 0;
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (session.stationId === stationId && session.status === 'active') {
                    await this.stopSession(session.userWhatsapp, stationId);
                    stoppedCount++;
                }
            }
            logger_1.logger.warn('🚨 Emergency stop executed', { stationId, stoppedSessions: stoppedCount });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to execute emergency stop', { stationId, error });
            return false;
        }
    }
    async getSessionsByStation(stationId, limit = 50) {
        try {
            const sessions = await connection_1.db.select({
                id: schema_1.chargingSessions.sessionId,
                userWhatsapp: schema_1.chargingSessions.userWhatsapp,
                stationId: schema_1.chargingSessions.stationId,
                stationName: schema_1.chargingStations.name,
                startTime: schema_1.chargingSessions.startTime,
                endTime: schema_1.chargingSessions.endTime,
                energyDelivered: schema_1.chargingSessions.energyDelivered,
                totalCost: schema_1.chargingSessions.totalCost,
                status: schema_1.chargingSessions.status,
                duration: schema_1.chargingSessions.duration,
                ratePerKwh: schema_1.chargingSessions.ratePerKwh
            })
                .from(schema_1.chargingSessions)
                .leftJoin(schema_1.chargingStations, (0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, schema_1.chargingStations.id))
                .where((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.chargingSessions.createdAt))
                .limit(limit);
            return sessions.map(session => ({
                id: session.id,
                userWhatsapp: session.userWhatsapp,
                stationId: session.stationId,
                stationName: session.stationName || 'Unknown Station',
                startTime: session.startTime || new Date(),
                endTime: session.endTime || undefined,
                energyDelivered: Number(session.energyDelivered) || 0,
                currentBatteryLevel: 0,
                targetBatteryLevel: 80,
                chargingRate: 0,
                pricePerKwh: Number(session.ratePerKwh) || 0,
                totalCost: Number(session.totalCost) || 0,
                status: session.status,
                efficiency: 95
            }));
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to get sessions by station', { stationId, error });
            return [];
        }
    }
    async getStationStats(stationId) {
        try {
            const stats = await connection_1.db.select({
                totalSessions: (0, drizzle_orm_1.count)(),
                totalEnergyDelivered: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.energyDelivered),
                totalRevenue: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost),
                avgSessionTime: (0, drizzle_orm_1.avg)(schema_1.chargingSessions.duration)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed')));
            const currentMonth = new Date();
            currentMonth.setDate(1);
            currentMonth.setHours(0, 0, 0, 0);
            const monthlyStats = await connection_1.db.select({
                monthlySessions: (0, drizzle_orm_1.count)(),
                monthlyRevenue: (0, drizzle_orm_1.sum)(schema_1.chargingSessions.totalCost)
            })
                .from(schema_1.chargingSessions)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingSessions.stationId, stationId), (0, drizzle_orm_1.eq)(schema_1.chargingSessions.status, 'completed'), (0, drizzle_orm_1.sql) `${schema_1.chargingSessions.createdAt} >= ${currentMonth}`));
            const result = stats[0];
            const monthlyResult = monthlyStats[0];
            return {
                totalSessions: Number(result.totalSessions) || 0,
                totalEnergyDelivered: Number(result.totalEnergyDelivered) || 0,
                totalRevenue: Number(result.totalRevenue) || 0,
                avgSessionTime: Number(result.avgSessionTime) || 0,
                monthlySessions: Number(monthlyResult.monthlySessions) || 0,
                monthlyRevenue: Number(monthlyResult.monthlyRevenue) || 0,
                utilizationRate: 85,
                activeSessionsCount: Array.from(this.activeSessions.values())
                    .filter(s => s.stationId === stationId && s.status === 'active').length
            };
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to get station stats', { stationId, error });
            return null;
        }
    }
    async cleanupExpiredSessions() {
        try {
            let cleanedCount = 0;
            const expiredThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
            for (const [sessionId, session] of this.activeSessions.entries()) {
                if (session.startTime < expiredThreshold && session.status !== 'completed') {
                    await this.completeSession(session.userWhatsapp, session.stationId);
                    cleanedCount++;
                }
            }
            logger_1.logger.info('🧹 Session cleanup completed', { cleanedCount });
            return cleanedCount;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to cleanup expired sessions', { error });
            return 0;
        }
    }
    async getRealTimeSessionData() {
        const activeSessions = Array.from(this.activeSessions.values());
        return {
            totalActiveSessions: activeSessions.length,
            totalEnergyBeingDelivered: activeSessions.reduce((sum, s) => sum + s.chargingRate, 0),
            totalCurrentCost: activeSessions.reduce((sum, s) => sum + s.totalCost, 0),
            sessionsByStatus: {
                active: activeSessions.filter(s => s.status === 'active').length,
                paused: activeSessions.filter(s => s.status === 'paused').length
            },
            sessionsByStation: activeSessions.reduce((acc, session) => {
                acc[session.stationId] = (acc[session.stationId] || 0) + 1;
                return acc;
            }, {})
        };
    }
    async forceCompleteSession(sessionId) {
        try {
            const session = this.activeSessions.get(sessionId);
            if (!session)
                return false;
            await this.completeSession(session.userWhatsapp, session.stationId);
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to force complete session', { sessionId, error });
            return false;
        }
    }
}
exports.sessionService = new SessionService();
//# sourceMappingURL=session.js.map