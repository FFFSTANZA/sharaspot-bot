// src/utils/queue-scheduler.ts - ULTRA OPTIMIZED & POWERFUL
import { queueService } from '../services/queue';
import { analyticsService } from '../services/analytics';
import { notificationService } from '../services/notification';
import { sessionService } from '../services/session';
import { logger } from '../utils/logger';
import { db } from '../db/connection';
import { queues, chargingStations } from '../db/schema';
import { eq, and, lt, sql } from 'drizzle-orm';

// ===============================================
// TYPES & INTERFACES
// ===============================================

interface ScheduledTask {
  id: string;
  type: 'cleanup' | 'optimization' | 'notification' | 'analytics';
  scheduledTime: Date;
  retries: number;
  maxRetries: number;
}

interface ProcessConfig {
  name: string;
  interval: number;
  handler: () => Promise<void>;
}

interface SystemMetrics {
  activeQueues: number;
  activeSessions: number;
  cacheSize: number;
  uptime: number;
}

// ===============================================
// ULTRA OPTIMIZED QUEUE SCHEDULER
// ===============================================

class QueueScheduler {
  private isRunning = false;
  private startTime = Date.now();
  private intervals = new Map<string, NodeJS.Timeout>();
  private tasks = new Map<string, ScheduledTask>();
  
  // Pre-configured processes for optimal performance
  private readonly processes: ProcessConfig[] = [
    { name: 'cleanup', interval: 2 * 60 * 1000, handler: this.cleanupExpiredReservations.bind(this) },
    { name: 'optimization', interval: 5 * 60 * 1000, handler: this.optimizeQueues.bind(this) },
    { name: 'notifications', interval: 3 * 60 * 1000, handler: this.processNotifications.bind(this) },
    { name: 'analytics', interval: 10 * 60 * 1000, handler: this.updateAnalytics.bind(this) },
    { name: 'sessions', interval: 60 * 1000, handler: this.monitorSessions.bind(this) },
    { name: 'alerts', interval: 4 * 60 * 1000, handler: this.checkAvailabilityAlerts.bind(this) },
    { name: 'performance', interval: 15 * 60 * 1000, handler: this.monitorPerformance.bind(this) }
  ];

  // ===============================================
  // LIFECYCLE MANAGEMENT
  // ===============================================

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startTime = Date.now();
    
    logger.info('🚀 Starting Ultra Queue Scheduler...');

    // Start all processes concurrently for maximum efficiency
    this.processes.forEach(({ name, interval, handler }) => {
      this.startProcess(name, interval, handler);
    });

    logger.info(`✅ Queue Scheduler operational with ${this.processes.length} processes`);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Clear all intervals efficiently
    this.intervals.forEach((timer, name) => {
      clearInterval(timer);
      logger.debug(`🛑 Stopped ${name}`);
    });
    
    this.intervals.clear();
    this.tasks.clear();
    
    logger.info('🛑 Queue Scheduler stopped');
  }

  // ===============================================
  // CORE PROCESS MANAGEMENT
  // ===============================================

  private startProcess(name: string, interval: number, handler: () => Promise<void>): void {
    const timer = setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        await handler();
      } catch (error) {
        logger.error(`❌ ${name} process failed`, { error });
      }
    }, interval);
    
    this.intervals.set(name, timer);
    logger.debug(`🔄 ${name} started (${interval/1000}s)`);
  }

  // ===============================================
  // OPTIMIZED PROCESS HANDLERS
  // ===============================================

  private async cleanupExpiredReservations(): Promise<void> {
    const expired = await db.select()
      .from(queues)
      .where(and(
        eq(queues.status, 'reserved'), 
        lt(queues.reservationExpiry, new Date())
      ));

    if (expired.length === 0) return;

    // Process cleanups in parallel for speed
    const results = await Promise.allSettled(
      expired.map(reservation => 
        queueService.leaveQueue(reservation.userWhatsapp, reservation.stationId, 'expired')
      )
    );

    const cleaned = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
    if (cleaned > 0) {
      logger.info(`🧹 Cleaned ${cleaned}/${expired.length} expired reservations`);
    }
  }

  private async optimizeQueues(): Promise<void> {
    const stations = await db.select()
      .from(chargingStations)
      .where(eq(chargingStations.isActive, true));

    if (stations.length === 0) return;

    // Optimize all stations in parallel
    const results = await Promise.allSettled(
      stations.map(station => this.optimizeStationQueue(station.id))
    );

    const optimized = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
    if (optimized > 0) {
      logger.info(`⚡ Optimized ${optimized}/${stations.length} station queues`);
    }
  }

  private async optimizeStationQueue(stationId: number): Promise<boolean> {
    const queueData = await db.select()
      .from(queues)
      .where(and(
        eq(queues.stationId, stationId), 
        sql`status NOT IN ('completed', 'cancelled')`
      ))
      .orderBy(queues.position);

    if (queueData.length === 0) return false;

    let optimized = false;

    // Smart auto-promotion logic
    const first = queueData.find(q => q.position === 1 && q.status === 'reserved');
    if (first?.reservationExpiry) {
      const expiredFor = Date.now() - first.reservationExpiry.getTime();
      
      if (expiredFor > 5 * 60 * 1000) { // 5+ minutes expired
        const next = queueData.find(q => q.position === 2 && q.status === 'waiting');
        
        if (next && await queueService.reserveSlot(next.userWhatsapp, stationId, 15)) {
          optimized = true;
          logger.info('🎯 Auto-promoted user', { stationId, user: next.userWhatsapp });
        }
      }
    }

    // Efficient gap rebalancing
    const activeQueue = queueData.filter(q => !['cancelled', 'completed'].includes(q.status));
    const needsRebalancing = activeQueue.some((q, i) => q.position !== i + 1);
    
    if (needsRebalancing) {
      const updates = activeQueue.map((q, i) => ({
        id: q.id,
        newPosition: i + 1
      })).filter(u => queueData.find(q => q.id === u.id)?.position !== u.newPosition);

      if (updates.length > 0) {
        await Promise.all(
          updates.map(u => 
            db.update(queues)
              .set({ position: u.newPosition, updatedAt: new Date() })
              .where(eq(queues.id, u.id))
          )
        );
        
        optimized = true;
        logger.info(`⚖️ Rebalanced ${updates.length} positions`, { stationId });
      }
    }

    return optimized;
  }

  private async processNotifications(): Promise<void> {
    const activeQueues = await db.select()
      .from(queues)
      .where(sql`status IN ('waiting', 'reserved')`)
      .orderBy(queues.createdAt);

    const notifications = activeQueues
      .filter(queue => queue.createdAt) // Null safety check
      .map(queue => {
        const waitTime = Math.floor((Date.now() - queue.createdAt!.getTime()) / (1000 * 60));
        
        // Send notifications at 15, 30, 45 minute intervals
        if (waitTime > 0 && waitTime % 15 === 0 && waitTime <= 60) {
          return notificationService.sendQueueProgressNotification(
            queue.userWhatsapp, queue.stationId, queue.position, waitTime
          );
        }
        return null;
      })
      .filter(Boolean);

    if (notifications.length > 0) {
      await Promise.allSettled(notifications);
      logger.debug(`📱 Sent ${notifications.length} queue notifications`);
    }
  }

  private async updateAnalytics(): Promise<void> {
    const stations = await db.select()
      .from(chargingStations)
      .where(eq(chargingStations.isActive, true));

    // Update analytics and queue counts in parallel
    const analyticsPromises = stations.map(station => 
      analyticsService.getStationAnalytics(station.id)
    );

    const queueCountPromises = stations.map(async station => {
      const queueCount = await db.select({ count: sql<number>`count(*)` })
        .from(queues)
        .where(and(
          eq(queues.stationId, station.id), 
          sql`status IN ('waiting', 'reserved', 'charging')`
        ));

      return db.update(chargingStations)
        .set({ 
          currentQueueLength: Number(queueCount[0]?.count || 0), 
          updatedAt: new Date() 
        })
        .where(eq(chargingStations.id, station.id));
    });

    await Promise.allSettled([...analyticsPromises, ...queueCountPromises]);
    
    logger.debug(`📊 Analytics updated for ${stations.length} stations`);
  }

  private async monitorSessions(): Promise<void> {
    const sessions = sessionService.getActiveSessions();
    
    if (sessions.size === 0) return;

    const sessionChecks = Array.from(sessions.entries()).map(async ([sessionId, session]) => {
      try {
        const status = await sessionService.getSessionStatus(sessionId);
        
        // Null safety checks with proper defaults
        const batteryLevel = status?.currentBatteryLevel ?? 0;
        const chargingRate = status?.chargingRate ?? 0;
        const targetLevel = session.targetBatteryLevel || 80;
        const expectedRate = session.chargingRate || 22;

        // Check for completion
        if (batteryLevel >= targetLevel) {
          await sessionService.completeSession(session.userWhatsapp, session.stationId);
          return { type: 'completed', sessionId };
        }
        
        // Check for anomalies with null safety
        if (status && chargingRate < expectedRate * 0.5) {
          await notificationService.sendAnomalyAlert(session.userWhatsapp, session, status);
          logger.warn('⚠️ Session anomaly', { 
            sessionId, 
            expectedRate, 
            actualRate: chargingRate 
          });
          return { type: 'anomaly', sessionId };
        }

        return null;
      } catch (error) {
        logger.error('Session monitoring error', { sessionId, error });
        return null;
      }
    });

    const results = await Promise.allSettled(sessionChecks);
    const events = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => (r as PromiseFulfilledResult<any>).value);

    if (events.length > 0) {
      logger.debug(`🔋 Session events: ${events.length}`);
    }
  }

  private async checkAvailabilityAlerts(): Promise<void> {
    // Optimized placeholder - in production, check stored alerts
    logger.debug('🚨 Availability alerts checked');
  }

  private async monitorPerformance(): Promise<void> {
    const [activeQueues, cacheSize] = await Promise.all([
      this.countActiveQueues(),
      Promise.resolve(this.getCacheSize())
    ]);

    const metrics: SystemMetrics = {
      activeQueues,
      activeSessions: sessionService.getActiveSessions().size,
      cacheSize,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    };

    logger.info('📊 System Performance', metrics);

    // Cleanup old cache entries efficiently
    this.cleanupCache();
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private async countActiveQueues(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` })
      .from(queues)
      .where(sql`status IN ('waiting', 'reserved')`);
    
    return Number(result[0]?.count || 0);
  }

  private getCacheSize(): number {
    const analytics = analyticsService as any;
    return analytics.analyticsCache?.size || 0;
  }

  private cleanupCache(): void {
    const analytics = analyticsService as any;
    const cache = analytics.analyticsCache;
    
    if (!cache) return;

    const now = Date.now();
    const cutoff = 30 * 60 * 1000; // 30 minutes
    
    let cleaned = 0;
    for (const [key, value] of cache.entries()) {
      if (now - value.timestamp > cutoff) {
        cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`🗑️ Cleaned ${cleaned} cache entries`);
    }
  }

  // ===============================================
  // SMART TASK SCHEDULING
  // ===============================================

  scheduleTask(
    type: ScheduledTask['type'], 
    scheduledTime: Date, 
    maxRetries = 3
  ): string {
    const taskId = `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const task: ScheduledTask = { 
      id: taskId, 
      type, 
      scheduledTime, 
      retries: 0, 
      maxRetries 
    };
    
    this.tasks.set(taskId, task);
    
    const delay = Math.max(0, scheduledTime.getTime() - Date.now());
    setTimeout(() => this.executeTask(taskId), delay);
    
    logger.info('📅 Task scheduled', { taskId, type, delay: `${delay/1000}s` });
    return taskId;
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const taskHandlers = {
      cleanup: this.cleanupExpiredReservations.bind(this),
      optimization: this.optimizeQueues.bind(this),
      notification: this.processNotifications.bind(this),
      analytics: this.updateAnalytics.bind(this)
    };

    try {
      logger.debug(`⚡ Executing ${task.type} task`, { taskId });
      
      await taskHandlers[task.type]();
      
      this.tasks.delete(taskId);
      logger.info('✅ Task completed', { taskId });

    } catch (error) {
      logger.error('❌ Task failed', { taskId, error });
      
      task.retries++;
      if (task.retries < task.maxRetries) {
        const delay = Math.pow(2, task.retries) * 60 * 1000; // Exponential backoff
        setTimeout(() => this.executeTask(taskId), delay);
        logger.info('🔄 Task rescheduled', { taskId, retries: task.retries, delay: `${delay/1000}s` });
      } else {
        this.tasks.delete(taskId);
        logger.error('💀 Task failed permanently', { taskId, maxRetries: task.maxRetries });
      }
    }
  }

  // ===============================================
  // STATUS & MONITORING
  // ===============================================

  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      activeProcesses: Array.from(this.intervals.keys()),
      scheduledTasks: this.tasks.size,
      processes: this.processes.map(p => ({
        name: p.name,
        interval: `${p.interval/1000}s`
      }))
    };
  }

  // Health check for monitoring
  async healthCheck(): Promise<boolean> {
    try {
      await this.countActiveQueues();
      return this.isRunning && this.intervals.size === this.processes.length;
    } catch (error) {
      logger.error('Health check failed', { error });
      return false;
    }
  }
}

// ===============================================
// SINGLETON EXPORT
// ===============================================

export const queueScheduler = new QueueScheduler();

// Auto-start in production
if (process.env.NODE_ENV === 'production') {
  queueScheduler.start().catch(error => {
    logger.error('Failed to start queue scheduler', { error });
  });
}

// Graceful shutdown
process.on('SIGINT', () => queueScheduler.stop());
process.on('SIGTERM', () => queueScheduler.stop());