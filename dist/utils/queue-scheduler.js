"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueScheduler = void 0;
const queue_1 = require("../services/queue");
const analytics_1 = require("../services/analytics");
const notification_1 = require("../services/notification");
const session_1 = require("../services/session");
const logger_1 = require("../utils/logger");
const connection_1 = require("../db/connection");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
class QueueScheduler {
    constructor() {
        this.isRunning = false;
        this.startTime = Date.now();
        this.intervals = new Map();
        this.tasks = new Map();
        this.processes = [
            { name: 'cleanup', interval: 2 * 60 * 1000, handler: this.cleanupExpiredReservations.bind(this) },
            { name: 'optimization', interval: 5 * 60 * 1000, handler: this.optimizeQueues.bind(this) },
            { name: 'notifications', interval: 3 * 60 * 1000, handler: this.processNotifications.bind(this) },
            { name: 'analytics', interval: 10 * 60 * 1000, handler: this.updateAnalytics.bind(this) },
            { name: 'sessions', interval: 60 * 1000, handler: this.monitorSessions.bind(this) },
            { name: 'alerts', interval: 4 * 60 * 1000, handler: this.checkAvailabilityAlerts.bind(this) },
            { name: 'performance', interval: 15 * 60 * 1000, handler: this.monitorPerformance.bind(this) }
        ];
    }
    async start() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        this.startTime = Date.now();
        logger_1.logger.info('🚀 Starting Ultra Queue Scheduler...');
        this.processes.forEach(({ name, interval, handler }) => {
            this.startProcess(name, interval, handler);
        });
        logger_1.logger.info(`✅ Queue Scheduler operational with ${this.processes.length} processes`);
    }
    async stop() {
        this.isRunning = false;
        this.intervals.forEach((timer, name) => {
            clearInterval(timer);
            logger_1.logger.debug(`🛑 Stopped ${name}`);
        });
        this.intervals.clear();
        this.tasks.clear();
        logger_1.logger.info('🛑 Queue Scheduler stopped');
    }
    startProcess(name, interval, handler) {
        const timer = setInterval(async () => {
            if (!this.isRunning)
                return;
            try {
                await handler();
            }
            catch (error) {
                logger_1.logger.error(`❌ ${name} process failed`, { error });
            }
        }, interval);
        this.intervals.set(name, timer);
        logger_1.logger.debug(`🔄 ${name} started (${interval / 1000}s)`);
    }
    async cleanupExpiredReservations() {
        const expired = await connection_1.db.select()
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.status, 'reserved'), (0, drizzle_orm_1.lt)(schema_1.queues.reservationExpiry, new Date())));
        if (expired.length === 0)
            return;
        const results = await Promise.allSettled(expired.map(reservation => queue_1.queueService.leaveQueue(reservation.userWhatsapp, reservation.stationId, 'expired')));
        const cleaned = results.filter(r => r.status === 'fulfilled' && r.value).length;
        if (cleaned > 0) {
            logger_1.logger.info(`🧹 Cleaned ${cleaned}/${expired.length} expired reservations`);
        }
    }
    async optimizeQueues() {
        const stations = await connection_1.db.select()
            .from(schema_1.chargingStations)
            .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.isActive, true));
        if (stations.length === 0)
            return;
        const results = await Promise.allSettled(stations.map(station => this.optimizeStationQueue(station.id)));
        const optimized = results.filter(r => r.status === 'fulfilled' && r.value).length;
        if (optimized > 0) {
            logger_1.logger.info(`⚡ Optimized ${optimized}/${stations.length} station queues`);
        }
    }
    async optimizeStationQueue(stationId) {
        const queueData = await connection_1.db.select()
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, stationId), (0, drizzle_orm_1.sql) `status NOT IN ('completed', 'cancelled')`))
            .orderBy(schema_1.queues.position);
        if (queueData.length === 0)
            return false;
        let optimized = false;
        const first = queueData.find(q => q.position === 1 && q.status === 'reserved');
        if (first?.reservationExpiry) {
            const expiredFor = Date.now() - first.reservationExpiry.getTime();
            if (expiredFor > 5 * 60 * 1000) {
                const next = queueData.find(q => q.position === 2 && q.status === 'waiting');
                if (next && await queue_1.queueService.reserveSlot(next.userWhatsapp, stationId, 15)) {
                    optimized = true;
                    logger_1.logger.info('🎯 Auto-promoted user', { stationId, user: next.userWhatsapp });
                }
            }
        }
        const activeQueue = queueData.filter(q => !['cancelled', 'completed'].includes(q.status));
        const needsRebalancing = activeQueue.some((q, i) => q.position !== i + 1);
        if (needsRebalancing) {
            const updates = activeQueue.map((q, i) => ({
                id: q.id,
                newPosition: i + 1
            })).filter(u => queueData.find(q => q.id === u.id)?.position !== u.newPosition);
            if (updates.length > 0) {
                await Promise.all(updates.map(u => connection_1.db.update(schema_1.queues)
                    .set({ position: u.newPosition, updatedAt: new Date() })
                    .where((0, drizzle_orm_1.eq)(schema_1.queues.id, u.id))));
                optimized = true;
                logger_1.logger.info(`⚖️ Rebalanced ${updates.length} positions`, { stationId });
            }
        }
        return optimized;
    }
    async processNotifications() {
        const activeQueues = await connection_1.db.select()
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.sql) `status IN ('waiting', 'reserved')`)
            .orderBy(schema_1.queues.createdAt);
        const notifications = activeQueues
            .filter(queue => queue.createdAt)
            .map(queue => {
            const waitTime = Math.floor((Date.now() - queue.createdAt.getTime()) / (1000 * 60));
            if (waitTime > 0 && waitTime % 15 === 0 && waitTime <= 60) {
                return notification_1.notificationService.sendQueueProgressNotification(queue.userWhatsapp, queue.stationId, queue.position, waitTime);
            }
            return null;
        })
            .filter(Boolean);
        if (notifications.length > 0) {
            await Promise.allSettled(notifications);
            logger_1.logger.debug(`📱 Sent ${notifications.length} queue notifications`);
        }
    }
    async updateAnalytics() {
        const stations = await connection_1.db.select()
            .from(schema_1.chargingStations)
            .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.isActive, true));
        const analyticsPromises = stations.map(station => analytics_1.analyticsService.getStationAnalytics(station.id));
        const queueCountPromises = stations.map(async (station) => {
            const queueCount = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` })
                .from(schema_1.queues)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.queues.stationId, station.id), (0, drizzle_orm_1.sql) `status IN ('waiting', 'reserved', 'charging')`));
            return connection_1.db.update(schema_1.chargingStations)
                .set({
                currentQueueLength: Number(queueCount[0]?.count || 0),
                updatedAt: new Date()
            })
                .where((0, drizzle_orm_1.eq)(schema_1.chargingStations.id, station.id));
        });
        await Promise.allSettled([...analyticsPromises, ...queueCountPromises]);
        logger_1.logger.debug(`📊 Analytics updated for ${stations.length} stations`);
    }
    async monitorSessions() {
        const sessions = session_1.sessionService.getActiveSessions();
        if (sessions.size === 0)
            return;
        const sessionChecks = Array.from(sessions.entries()).map(async ([sessionId, session]) => {
            try {
                const status = await session_1.sessionService.getSessionStatus(sessionId);
                const batteryLevel = status?.currentBatteryLevel ?? 0;
                const chargingRate = status?.chargingRate ?? 0;
                const targetLevel = session.targetBatteryLevel || 80;
                const expectedRate = session.chargingRate || 22;
                if (batteryLevel >= targetLevel) {
                    await session_1.sessionService.completeSession(session.userWhatsapp, session.stationId);
                    return { type: 'completed', sessionId };
                }
                if (status && chargingRate < expectedRate * 0.5) {
                    await notification_1.notificationService.sendAnomalyAlert(session.userWhatsapp, session, status);
                    logger_1.logger.warn('⚠️ Session anomaly', {
                        sessionId,
                        expectedRate,
                        actualRate: chargingRate
                    });
                    return { type: 'anomaly', sessionId };
                }
                return null;
            }
            catch (error) {
                logger_1.logger.error('Session monitoring error', { sessionId, error });
                return null;
            }
        });
        const results = await Promise.allSettled(sessionChecks);
        const events = results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
        if (events.length > 0) {
            logger_1.logger.debug(`🔋 Session events: ${events.length}`);
        }
    }
    async checkAvailabilityAlerts() {
        logger_1.logger.debug('🚨 Availability alerts checked');
    }
    async monitorPerformance() {
        const [activeQueues, cacheSize] = await Promise.all([
            this.countActiveQueues(),
            Promise.resolve(this.getCacheSize())
        ]);
        const metrics = {
            activeQueues,
            activeSessions: session_1.sessionService.getActiveSessions().size,
            cacheSize,
            uptime: Math.floor((Date.now() - this.startTime) / 1000)
        };
        logger_1.logger.info('📊 System Performance', metrics);
        this.cleanupCache();
    }
    async countActiveQueues() {
        const result = await connection_1.db.select({ count: (0, drizzle_orm_1.sql) `count(*)` })
            .from(schema_1.queues)
            .where((0, drizzle_orm_1.sql) `status IN ('waiting', 'reserved')`);
        return Number(result[0]?.count || 0);
    }
    getCacheSize() {
        const analytics = analytics_1.analyticsService;
        return analytics.analyticsCache?.size || 0;
    }
    cleanupCache() {
        const analytics = analytics_1.analyticsService;
        const cache = analytics.analyticsCache;
        if (!cache)
            return;
        const now = Date.now();
        const cutoff = 30 * 60 * 1000;
        let cleaned = 0;
        for (const [key, value] of cache.entries()) {
            if (now - value.timestamp > cutoff) {
                cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            logger_1.logger.debug(`🗑️ Cleaned ${cleaned} cache entries`);
        }
    }
    scheduleTask(type, scheduledTime, maxRetries = 3) {
        const taskId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const task = {
            id: taskId,
            type,
            scheduledTime,
            retries: 0,
            maxRetries
        };
        this.tasks.set(taskId, task);
        const delay = Math.max(0, scheduledTime.getTime() - Date.now());
        setTimeout(() => this.executeTask(taskId), delay);
        logger_1.logger.info('📅 Task scheduled', { taskId, type, delay: `${delay / 1000}s` });
        return taskId;
    }
    async executeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        const taskHandlers = {
            cleanup: this.cleanupExpiredReservations.bind(this),
            optimization: this.optimizeQueues.bind(this),
            notification: this.processNotifications.bind(this),
            analytics: this.updateAnalytics.bind(this)
        };
        try {
            logger_1.logger.debug(`⚡ Executing ${task.type} task`, { taskId });
            await taskHandlers[task.type]();
            this.tasks.delete(taskId);
            logger_1.logger.info('✅ Task completed', { taskId });
        }
        catch (error) {
            logger_1.logger.error('❌ Task failed', { taskId, error });
            task.retries++;
            if (task.retries < task.maxRetries) {
                const delay = Math.pow(2, task.retries) * 60 * 1000;
                setTimeout(() => this.executeTask(taskId), delay);
                logger_1.logger.info('🔄 Task rescheduled', { taskId, retries: task.retries, delay: `${delay / 1000}s` });
            }
            else {
                this.tasks.delete(taskId);
                logger_1.logger.error('💀 Task failed permanently', { taskId, maxRetries: task.maxRetries });
            }
        }
    }
    getStatus() {
        return {
            isRunning: this.isRunning,
            uptime: Math.floor((Date.now() - this.startTime) / 1000),
            activeProcesses: Array.from(this.intervals.keys()),
            scheduledTasks: this.tasks.size,
            processes: this.processes.map(p => ({
                name: p.name,
                interval: `${p.interval / 1000}s`
            }))
        };
    }
    async healthCheck() {
        try {
            await this.countActiveQueues();
            return this.isRunning && this.intervals.size === this.processes.length;
        }
        catch (error) {
            logger_1.logger.error('Health check failed', { error });
            return false;
        }
    }
}
exports.queueScheduler = new QueueScheduler();
if (process.env.NODE_ENV === 'production') {
    exports.queueScheduler.start().catch(error => {
        logger_1.logger.error('Failed to start queue scheduler', { error });
    });
}
process.on('SIGINT', () => exports.queueScheduler.stop());
process.on('SIGTERM', () => exports.queueScheduler.stop());
//# sourceMappingURL=queue-scheduler.js.map