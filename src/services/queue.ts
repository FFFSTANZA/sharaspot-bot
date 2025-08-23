// src/services/queue.ts - FIXED VERSION
import { db } from '../db/connection';
import { queues, chargingStations } from '../db/schema';
import { eq, and, desc, asc, sql, lt, gte } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { notificationService } from '../services/notification';

export interface QueuePosition {
  id: number;
  userWhatsapp: string;
  stationId: number;
  position: number;
  estimatedWaitMinutes: number;
  status: 'waiting' | 'reserved' | 'charging' | 'completed' | 'cancelled';
  isReserved: boolean;
  reservationExpiry?: Date;
  createdAt: Date;
  stationName?: string;
  stationAddress?: string;
}

export interface QueueStats {
  totalInQueue: number;
  averageWaitTime: number;
  peakHours: string[];
  userPosition?: number;
  estimatedTime?: number;
}

class QueueService {
  /**
   * Add user to queue at a charging station
   */
  async joinQueue(userWhatsapp: string, stationId: number): Promise<QueuePosition | null> {
    try {
      // Check if user is already in queue for this station
      const existingQueue = await db.select()
        .from(queues)
        .where(and(
          eq(queues.userWhatsapp, userWhatsapp),
          eq(queues.stationId, stationId),
          sql`status NOT IN ('completed', 'cancelled')`
        ))
        .limit(1);

      if (existingQueue.length > 0) {
        logger.info('User already in queue', { userWhatsapp, stationId });
        return this.formatQueuePosition(existingQueue[0]);
      }

      // Get station details
      const station = await db.select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (!station.length || !station[0].isActive || !station[0].isOpen) {
        logger.warn('Station not available for booking', { stationId, station: station[0] });
        return null;
      }

      // Check if queue is full
      const currentQueueCount = await this.getQueueLength(stationId);
      if (currentQueueCount >= (station[0].maxQueueLength || 5)) {
        logger.warn('Queue is full', { stationId, currentQueueCount, maxLength: station[0].maxQueueLength });
        return null;
      }

      // Get next position in queue
      const nextPosition = await this.getNextPosition(stationId);
      const estimatedWaitTime = this.calculateWaitTime(nextPosition, station[0].averageSessionMinutes || 45);

      // Add to queue
      const newQueueEntry = await db.insert(queues).values({
        userWhatsapp,
        stationId,
        position: nextPosition,
        estimatedWaitMinutes: estimatedWaitTime,
        status: 'waiting',
      }).returning();

      // Update station queue count
      await this.updateStationQueueCount(stationId);

      const queuePosition = this.formatQueuePosition(newQueueEntry[0], station[0]);

      // Send notifications
      await notificationService.sendQueueJoinedNotification(userWhatsapp, queuePosition);
      await notificationService.notifyStationOwner(stationId, 'queue_joined', { userWhatsapp, position: nextPosition });

      logger.info('User joined queue successfully', { userWhatsapp, stationId, position: nextPosition });
      return queuePosition;

    } catch (error) {
      logger.error('Failed to join queue', { userWhatsapp, stationId, error });
      return null;
    }
  }

  /**
   * Remove user from queue
   */
  async leaveQueue(userWhatsapp: string, stationId: number, reason: 'user_cancelled' | 'expired' | 'completed' = 'user_cancelled'): Promise<boolean> {
    try {
      const result = await db.update(queues)
        .set({ 
          status: reason === 'completed' ? 'completed' : 'cancelled',
          updatedAt: new Date()
        })
        .where(and(
          eq(queues.userWhatsapp, userWhatsapp),
          eq(queues.stationId, stationId),
          sql`status NOT IN ('completed', 'cancelled')`
        ))
        .returning();

      if (result.length === 0) {
        logger.warn('No active queue entry found to cancel', { userWhatsapp, stationId });
        return false;
      }

      const queueEntry = result[0];

      // Reposition remaining queue
      await this.reorderQueue(stationId, queueEntry.position);

      // Update station queue count
      await this.updateStationQueueCount(stationId);

      // Send notifications
      await notificationService.sendQueueLeftNotification(userWhatsapp, stationId, reason);
      await notificationService.notifyStationOwner(stationId, 'queue_left', { userWhatsapp, reason, position: queueEntry.position });

      // Notify users that moved up in queue
      await this.notifyQueueProgress(stationId);

      logger.info('User left queue', { userWhatsapp, stationId, reason, oldPosition: queueEntry.position });
      return true;

    } catch (error) {
      logger.error('Failed to leave queue', { userWhatsapp, stationId, reason, error });
      return false;
    }
  }

  /**
   * Reserve charging slot for user
   * FIXED: Removed isReserved field as it's not in the schema
   */
  async reserveSlot(userWhatsapp: string, stationId: number, reservationMinutes: number = 15): Promise<boolean> {
    try {
      // Check if user is first in queue
      const queueEntry = await db.select()
        .from(queues)
        .where(and(
          eq(queues.userWhatsapp, userWhatsapp),
          eq(queues.stationId, stationId),
          eq(queues.position, 1),
          eq(queues.status, 'waiting')
        ))
        .limit(1);

      if (!queueEntry.length) {
        logger.warn('User not eligible for reservation', { userWhatsapp, stationId });
        return false;
      }

      const expiryTime = new Date(Date.now() + (reservationMinutes * 60 * 1000));

      // FIXED: Using only fields that exist in the schema
      const result = await db.update(queues)
        .set({
          status: 'reserved',
          reservationExpiry: expiryTime,
          updatedAt: new Date()
        })
        .where(eq(queues.id, queueEntry[0].id))
        .returning();

      if (result.length === 0) {
        return false;
      }

      // Schedule expiry notification
      await notificationService.scheduleReservationExpiry(userWhatsapp, stationId, expiryTime);

      // Send immediate notification
      await notificationService.sendReservationConfirmation(userWhatsapp, stationId, reservationMinutes);
      await notificationService.notifyStationOwner(stationId, 'slot_reserved', { userWhatsapp, expiryTime });

      logger.info('Slot reserved successfully', { userWhatsapp, stationId, expiryTime });
      return true;

    } catch (error) {
      logger.error('Failed to reserve slot', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Start charging session
   */
  async startCharging(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const result = await db.update(queues)
        .set({
          status: 'charging',
          updatedAt: new Date()
        })
        .where(and(
          eq(queues.userWhatsapp, userWhatsapp),
          eq(queues.stationId, stationId),
          eq(queues.status, 'reserved')
        ))
        .returning();

      if (result.length === 0) {
        logger.warn('No valid reservation found to start charging', { userWhatsapp, stationId });
        return false;
      }

      // Send notifications
      await notificationService.sendChargingStartedNotification(userWhatsapp, stationId);
      await notificationService.notifyStationOwner(stationId, 'charging_started', { userWhatsapp });

      // Promote next user in queue if any
      await this.promoteNextInQueue(stationId);

      logger.info('Charging session started', { userWhatsapp, stationId });
      return true;

    } catch (error) {
      logger.error('Failed to start charging', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Complete charging session
   */
  async completeCharging(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const result = await db.update(queues)
        .set({
          status: 'completed',
          updatedAt: new Date()
        })
        .where(and(
          eq(queues.userWhatsapp, userWhatsapp),
          eq(queues.stationId, stationId),
          eq(queues.status, 'charging')
        ))
        .returning();

      if (result.length === 0) {
        logger.warn('No active charging session found', { userWhatsapp, stationId });
        return false;
      }

      // Update station queue count
      await this.updateStationQueueCount(stationId);

      // Send notifications
      await notificationService.sendChargingCompletedNotification(userWhatsapp, stationId);
      await notificationService.notifyStationOwner(stationId, 'charging_completed', { userWhatsapp });

      // Promote next user in queue
      await this.promoteNextInQueue(stationId);

      logger.info('Charging session completed', { userWhatsapp, stationId });
      return true;

    } catch (error) {
      logger.error('Failed to complete charging', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Get user's current queue status
   */
  async getUserQueueStatus(userWhatsapp: string): Promise<QueuePosition[]> {
    try {
      const userQueues = await db.select({
        id: queues.id,
        userWhatsapp: queues.userWhatsapp,
        stationId: queues.stationId,
        position: queues.position,
        estimatedWaitMinutes: queues.estimatedWaitMinutes,
        status: queues.status,
        reservationExpiry: queues.reservationExpiry,
        createdAt: queues.createdAt,
        stationName: chargingStations.name,
        stationAddress: chargingStations.address,
      })
      .from(queues)
      .leftJoin(chargingStations, eq(queues.stationId, chargingStations.id))
      .where(and(
        eq(queues.userWhatsapp, userWhatsapp),
        sql`status NOT IN ('completed', 'cancelled')`
      ))
      .orderBy(desc(queues.createdAt));

      return userQueues.map(q => this.formatQueuePosition(q));

    } catch (error) {
      logger.error('Failed to get user queue status', { userWhatsapp, error });
      return [];
    }
  }

  /**
   * Get queue statistics for a station
   */
  async getQueueStats(stationId: number): Promise<QueueStats> {
    try {
      const queueCount = await this.getQueueLength(stationId);
      const avgWaitTime = await this.getAverageWaitTime(stationId);
      const peakHours = await this.getPeakHours(stationId);

      return {
        totalInQueue: queueCount,
        averageWaitTime: avgWaitTime,
        peakHours
      };

    } catch (error) {
      logger.error('Failed to get queue stats', { stationId, error });
      return {
        totalInQueue: 0,
        averageWaitTime: 0,
        peakHours: []
      };
    }
  }

  /**
   * Clean up expired reservations
   */
  async cleanupExpiredReservations(): Promise<void> {
    try {
      const expiredReservations = await db.select()
        .from(queues)
        .where(and(
          eq(queues.status, 'reserved'),
          lt(queues.reservationExpiry, new Date())
        ));

      for (const reservation of expiredReservations) {
        await this.leaveQueue(reservation.userWhatsapp, reservation.stationId, 'expired');
        logger.info('Expired reservation cleaned up', { 
          userWhatsapp: reservation.userWhatsapp, 
          stationId: reservation.stationId 
        });
      }

    } catch (error) {
      logger.error('Failed to cleanup expired reservations', { error });
    }
  }

  // Private helper methods

  private async getQueueLength(stationId: number): Promise<number> {
    const result = await db.select({ count: sql`count(*)` })
      .from(queues)
      .where(and(
        eq(queues.stationId, stationId),
        sql`status IN ('waiting', 'reserved')`
      ));

    return Number(result[0]?.count || 0);
  }

  private async getNextPosition(stationId: number): Promise<number> {
    const result = await db.select({ maxPosition: sql`coalesce(max(position), 0)` })
      .from(queues)
      .where(and(
        eq(queues.stationId, stationId),
        sql`status IN ('waiting', 'reserved', 'charging')`
      ));

    return Number(result[0]?.maxPosition || 0) + 1;
  }

  private calculateWaitTime(position: number, avgSessionMinutes: number): number {
    // Position 1 = minimal wait (station setup time ~5 min)
    // Position 2+ = (position-1) * avgSessionMinutes + setup time
    if (position === 1) return 5;
    return ((position - 1) * avgSessionMinutes) + 5;
  }

  private async reorderQueue(stationId: number, removedPosition: number): Promise<void> {
    await db.update(queues)
      .set({ 
        position: sql`position - 1`,
        updatedAt: new Date()
      })
      .where(and(
        eq(queues.stationId, stationId),
        sql`position > ${removedPosition}`,
        sql`status IN ('waiting', 'reserved')`
      ));
  }

  private async updateStationQueueCount(stationId: number): Promise<void> {
    const queueLength = await this.getQueueLength(stationId);
    
    await db.update(chargingStations)
      .set({ 
        currentQueueLength: queueLength,
        updatedAt: new Date()
      })
      .where(eq(chargingStations.id, stationId));
  }

  private async promoteNextInQueue(stationId: number): Promise<void> {
    // Find next person in queue (position 2, since position 1 just left)
    const nextInQueue = await db.select()
      .from(queues)
      .where(and(
        eq(queues.stationId, stationId),
        eq(queues.position, 2),
        eq(queues.status, 'waiting')
      ))
      .limit(1);

    if (nextInQueue.length > 0) {
      // Auto-reserve for 15 minutes
      await this.reserveSlot(nextInQueue[0].userWhatsapp, stationId, 15);
      
      // Reorder remaining queue
      await this.reorderQueue(stationId, 1);
    }
  }

  private async notifyQueueProgress(stationId: number): Promise<void> {
    const waitingUsers = await db.select()
      .from(queues)
      .where(and(
        eq(queues.stationId, stationId),
        eq(queues.status, 'waiting')
      ))
      .orderBy(asc(queues.position));

    for (const user of waitingUsers) {
      const newWaitTime = this.calculateWaitTime(user.position, 45);
      
      // Update estimated wait time
      await db.update(queues)
        .set({ 
          estimatedWaitMinutes: newWaitTime,
          updatedAt: new Date()
        })
        .where(eq(queues.id, user.id));

      // Send progress notification
      await notificationService.sendQueueProgressNotification(
        user.userWhatsapp, 
        stationId, 
        user.position, 
        newWaitTime
      );
    }
  }

  private async getAverageWaitTime(stationId: number): Promise<number> {
    const result = await db.select({ 
      avgWait: sql`avg(estimated_wait_minutes)` 
    })
    .from(queues)
    .where(and(
      eq(queues.stationId, stationId),
      sql`status = 'completed'`,
      gte(queues.createdAt, sql`now() - interval '7 days'`)
    ));

    return Number(result[0]?.avgWait || 45);
  }
   

  async getStationQueueInfo(stationId: number): Promise<{
  stationId: number;
  totalInQueue: number;
  availablePorts: number;
  totalPorts: number;
  averageWaitTime: number;
  turnoverRate?: string;
}> {
  try {
    const [queueCount, station] = await Promise.all([
      this.getQueueLength(stationId),
      db.select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1)
    ]);

    if (!station.length) {
      throw new Error(`Station ${stationId} not found`);
    }

    const stationData = station[0];
    const avgWaitTime = await this.getAverageWaitTime(stationId);

    return {
      stationId,
      totalInQueue: queueCount,
      availablePorts: stationData.availablePorts || 0,
      totalPorts: stationData.totalPorts || 1,
      averageWaitTime: avgWaitTime,
      turnoverRate: `${Math.round(60 / (avgWaitTime || 45))} sessions/hour`
    };
  } catch (error) {
    logger.error('Failed to get station queue info', { stationId, error });
    return {
      stationId,
      totalInQueue: 0,
      availablePorts: 0,
      totalPorts: 1,
      averageWaitTime: 45
    };
  }
}

/**
 * Get user's queue position at a specific station
 */
async getUserQueueAtStation(userWhatsapp: string, stationId: number): Promise<QueuePosition | null> {
  try {
    const userQueue = await db.select({
      id: queues.id,
      userWhatsapp: queues.userWhatsapp,
      stationId: queues.stationId,
      position: queues.position,
      estimatedWaitMinutes: queues.estimatedWaitMinutes,
      status: queues.status,
      reservationExpiry: queues.reservationExpiry,
      createdAt: queues.createdAt,
      stationName: chargingStations.name,
      stationAddress: chargingStations.address,
    })
    .from(queues)
    .leftJoin(chargingStations, eq(queues.stationId, chargingStations.id))
    .where(and(
      eq(queues.userWhatsapp, userWhatsapp),
      eq(queues.stationId, stationId),
      sql`status NOT IN ('completed', 'cancelled')`
    ))
    .limit(1);

    if (!userQueue.length) {
      return null;
    }

    return this.formatQueuePosition(userQueue[0]);
  } catch (error) {
    logger.error('Failed to get user queue at station', { userWhatsapp, stationId, error });
    return null;
  }
}

  private async getPeakHours(stationId: number): Promise<string[]> {
    const result = await db.select({ 
      hour: sql`extract(hour from created_at)`,
      count: sql`count(*)`
    })
    .from(queues)
    .where(and(
      eq(queues.stationId, stationId),
      gte(queues.createdAt, sql`now() - interval '30 days'`)
    ))
    .groupBy(sql`extract(hour from created_at)`)
    .orderBy(sql`count(*) desc`)
    .limit(3);

    return result.map(r => `${r.hour}:00-${Number(r.hour) + 1}:00`);
  }

  /**
   * Format queue position data with safe handling of isReserved
   * FIXED: Derive isReserved from status rather than expecting it from the DB
   */
  private formatQueuePosition(queueData: any, stationData?: any): QueuePosition {
    return {
      id: queueData.id,
      userWhatsapp: queueData.userWhatsapp,
      stationId: queueData.stationId,
      position: queueData.position,
      estimatedWaitMinutes: queueData.estimatedWaitMinutes,
      status: queueData.status,
      // FIXED: Derive isReserved from status instead of using a field that doesn't exist
      isReserved: queueData.status === 'reserved',
      reservationExpiry: queueData.reservationExpiry,
      createdAt: queueData.createdAt,
      stationName: queueData.stationName || stationData?.name,
      stationAddress: queueData.stationAddress || stationData?.address,
    };
  }
}

export const queueService = new QueueService();