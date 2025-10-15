// src/services/session.ts - Photo-Based Verification (No Time Tracking)
import { db } from '../db/connection';
import { chargingStations, chargingSessions, users } from '../db/schema';
import { eq, and, desc, sql, count, sum, avg } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { notificationService } from './notification';
import { photoVerificationService } from './photo-verification';

export interface ChargingSession {
  id: string;
  userWhatsapp: string;
  stationId: number;
  stationName?: string;
  startTime?: Date;
  endTime?: Date;
  energyDelivered: number;
  currentBatteryLevel: number;
  targetBatteryLevel: number;
  pricePerKwh: number;
  totalCost: number;
  status: 'initiated' | 'active' | 'completed' | 'stopped';
  queueId?: number;
}

export interface SessionSummary {
  sessionId: string;
  duration: string;
  energyDelivered: number;
  finalBatteryLevel: number;
  totalCost: number;
  stationName: string;
  startTime: Date;
  endTime: Date;
}

class SessionService {
  private activeSessions = new Map<string, ChargingSession>();

  /**
   * ✅ Start session - Creates session and triggers START photo request
   * Status remains 'initiated' until photo verified
   */
  async startSession(
    userWhatsapp: string,
    stationId: number,
    queueId?: number
  ): Promise<ChargingSession | null> {
    try {
      // Check for existing active session
      const existingSession = await this.getActiveSession(userWhatsapp, stationId);
      if (existingSession && ['active', 'initiated'].includes(existingSession.status)) {
        logger.warn('Active session already exists', { userWhatsapp, stationId });
        return existingSession;
      }

      // Get station details
      const station = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);
      if (!station.length) {
        logger.error('Station not found for session', { stationId });
        return null;
      }
      const stationData = station[0];

      // Generate unique session ID
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // ✅ Create session with 'initiated' status - NO startTime yet
      const [newSession] = await db
        .insert(chargingSessions)
        .values({
          sessionId,
          userWhatsapp,
          stationId,
          queueId,
          status: 'initiated',
          verificationStatus: 'pending',
          maxPowerUsed: stationData.maxPowerKw || 50,
          ratePerKwh: stationData.pricePerKwh?.toString() || '12',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      logger.info('Session created, requesting START photo', {
        sessionId,
        userWhatsapp,
        stationId,
      });

      // ✅ Trigger photo verification - NO success message yet
      await photoVerificationService.initiateStartVerification(
        userWhatsapp,
        sessionId,
        stationId
      );

      return this.mapToChargingSession(newSession);
    } catch (error) {
      logger.error('Failed to start session', { error, userWhatsapp, stationId });
      return null;
    }
  }

  /**
   * ✅ Actually activate charging AFTER START photo confirmed
   * This is when we set startTime and status 'active'
   */
  /**
 * ✅ Actually activate charging AFTER START photo confirmed
 * This is when we set startTime and status 'active'
 * ❌ PROBLEM: Wrong parameters passed here
 */
async startChargingAfterVerification(
  sessionId: string,
  startMeterReading: number
): Promise<void> {
  try {
    logger.info('Activating charging after photo verification', {
      sessionId,
      startMeterReading,
    });

    const now = new Date();
    await db
      .update(chargingSessions)
      .set({
        status: 'active',
        verificationStatus: 'start_verified',
        startTime: now,
        startedAt: now,
        startMeterReading: startMeterReading.toString(),
        updatedAt: now,
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    const session = await this.getSessionById(sessionId);
    if (!session) {
      throw new Error('Session not found after verification');
    }

    this.activeSessions.set(sessionId, session);

    logger.info('✅ Charging activated', {
      sessionId,
      userWhatsapp: session.userWhatsapp,
      startReading: startMeterReading,
    });

    // ❌ WRONG: Passing session.stationId instead of session object
    await notificationService.sendChargingStartedNotification(
      session.userWhatsapp,
      session
    );
  } catch (error) {
    logger.error('Failed to activate charging', { error, sessionId });
    throw error;
  }
}

  /**
   * Get active session for user and station
   */
  async getActiveSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null> {
    // Check in-memory first
    for (const s of this.activeSessions.values()) {
      if (
        s.userWhatsapp === userWhatsapp &&
        s.stationId === stationId &&
        ['active', 'initiated'].includes(s.status)
      ) {
        return s;
      }
    }

    // Check database
    try {
      const [dbSession] = await db
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.stationId, stationId),
            sql`${chargingSessions.status} IN ('active', 'initiated')`
          )
        )
        .limit(1);

      return dbSession ? this.mapToChargingSession(dbSession) : null;
    } catch (error) {
      logger.error('Failed to get active session', { error, userWhatsapp, stationId });
      return null;
    }
  }

  /**
   * ✅ Stop session - Triggers END photo request
   */
  async stopSession(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (!session) {
        logger.warn('No active session to stop', { userWhatsapp, stationId });
        return false;
      }

      await db
        .update(chargingSessions)
        .set({
          status: 'active', // Keep active while awaiting END photo
          verificationStatus: 'awaiting_end_photo',
          updatedAt: new Date(),
        })
        .where(eq(chargingSessions.sessionId, session.id));

      logger.info('Stop requested, awaiting END photo', {
        sessionId: session.id,
        userWhatsapp,
      });

      // ✅ Trigger END photo verification
      await photoVerificationService.initiateEndVerification(
        userWhatsapp,
        session.id,
        stationId
      );

      return true;
    } catch (error) {
      logger.error('Failed to stop session', { error, userWhatsapp, stationId });
      return false;
    }
  }

  /**
   * ✅ Complete session AFTER END photo verified
   */
  async completeSessionAfterVerification(
  sessionId: string,
  endMeterReading: number,
  consumption: number
): Promise<void> {
  try {
    // ✅ Fetch session WITH station name via JOIN
    const [result] = await db
      .select({
        session: chargingSessions,
        station: chargingStations,
      })
      .from(chargingSessions)
      .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
      .where(eq(chargingSessions.sessionId, sessionId))
      .limit(1);
    
    if (!result) throw new Error('Session not found');
    
    const session = result.session;
    const station = result.station;

    const startTime = session.startTime || session.startedAt || session.createdAt || new Date();
    const endTime = new Date();
    const durationMinutes = Math.floor((endTime.getTime() - startTime.getTime()) / (1000 * 60));

    const ratePerKwh = parseFloat(session.ratePerKwh || '12');
    const energyCost = consumption * ratePerKwh;
    const platformFee = Math.max(5, energyCost * 0.05);
    const gst = (energyCost + platformFee) * 0.18;
    const totalCost = energyCost + platformFee + gst;

    await db
      .update(chargingSessions)
      .set({
        status: 'completed',
        verificationStatus: 'completed',
        endTime,
        endedAt: endTime,
        duration: durationMinutes,
        endMeterReading: endMeterReading.toString(),
        energyDelivered: consumption.toString(),
        totalCost: totalCost.toFixed(2),
        baseCharge: platformFee.toFixed(2),
        taxAmount: gst.toFixed(2),
        paymentStatus: 'pending',
        updatedAt: new Date(),
      })
      .where(eq(chargingSessions.sessionId, sessionId));

    this.activeSessions.delete(sessionId);

    const summary: SessionSummary = {
      sessionId,
      duration: this.formatDuration(durationMinutes),
      energyDelivered: consumption,
      finalBatteryLevel: session.finalBatteryPercent || 80,
      totalCost,
      stationName: station?.name || 'Charging Station', // ✅ From join
      startTime,
      endTime,
    };

    logger.info('✅ Session completed', {
      sessionId,
      userWhatsapp: session.userWhatsapp,
      consumption,
      totalCost,
    });

    // ✅ Send completion summary
    await notificationService.sendSessionCompletedNotification(
      session.userWhatsapp,
      session,
      summary
    );

    await this.updateUserStats(session.userWhatsapp, consumption, totalCost);
  } catch (error) {
    logger.error('Failed to complete session', { error, sessionId });
    throw error;
  }
}

  // === HELPER METHODS ===

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  private async updateUserStats(
    userWhatsapp: string,
    energyConsumed: number,
    costSpent: number
  ): Promise<void> {
    try {
      await db
        .update(users)
        .set({
          totalSessions: sql`${users.totalSessions} + 1`,
          totalEnergyConsumed: sql`${users.totalEnergyConsumed} + ${energyConsumed}`,
          lastActivityAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.whatsappId, userWhatsapp));
      logger.info('User stats updated', { userWhatsapp, energyConsumed, costSpent });
    } catch (error) {
      logger.error('Failed to update user stats', { error, userWhatsapp });
    }
  }

  private mapToChargingSession(dbSession: any): ChargingSession {
    return {
      id: dbSession.sessionId,
      userWhatsapp: dbSession.userWhatsapp,
      stationId: dbSession.stationId,
      stationName: dbSession.stationName || 'Charging Station',
      startTime: dbSession.startedAt || dbSession.startTime,
      endTime: dbSession.endTime,
      energyDelivered: parseFloat(dbSession.energyDelivered || '0'),
      currentBatteryLevel: dbSession.initialBatteryPercent || 20,
      targetBatteryLevel: dbSession.finalBatteryPercent || 80,
      pricePerKwh: parseFloat(dbSession.ratePerKwh || '12'),
      totalCost: parseFloat(dbSession.totalCost || '0'),
      status: dbSession.status,
      queueId: dbSession.queueId,
    };
  }

  // === PUBLIC QUERY METHODS ===

  async getSessionById(sessionId: string): Promise<ChargingSession | null> {
    try {
      const [session] = await db
        .select()
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.sessionId, sessionId))
        .limit(1);
      if (!session) return null;
      return this.mapToChargingSession(session);
    } catch (error) {
      logger.error('Failed to get session by ID', { sessionId, error });
      return null;
    }
  }

  async getSessionHistory(userWhatsapp: string, limit: number = 10): Promise<ChargingSession[]> {
    try {
      const sessions = await db
        .select()
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.userWhatsapp, userWhatsapp))
        .orderBy(desc(chargingSessions.createdAt))
        .limit(limit);
      return sessions.map(s => this.mapToChargingSession(s));
    } catch (error) {
      logger.error('Failed to get session history', { userWhatsapp, error });
      return [];
    }
  }

  async getUserStats(userWhatsapp: string): Promise<any> {
    try {
      const basicStats = await db
        .select({
          totalSessions: count(),
          totalEnergyConsumed: sum(chargingSessions.energyDelivered),
          totalCostSpent: sum(chargingSessions.totalCost),
          avgSessionTime: avg(chargingSessions.duration),
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.status, 'completed')
          )
        );

      const stats = basicStats[0];
      return {
        totalSessions: Number(stats.totalSessions) || 0,
        totalEnergyConsumed: Number(stats.totalEnergyConsumed) || 0,
        totalCostSpent: Number(stats.totalCostSpent) || 0,
        avgSessionTime: Number(stats.avgSessionTime) || 0,
      };
    } catch (error) {
      logger.error('Failed to get user stats', { userWhatsapp, error });
      return null;
    }
  }

  // === ADMIN METHODS ===

  async emergencyStopStation(stationId: number): Promise<boolean> {
    try {
      let stoppedCount = 0;
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.stationId === stationId && session.status === 'active') {
          await this.stopSession(session.userWhatsapp, stationId);
          stoppedCount++;
        }
      }
      logger.warn('🚨 Emergency stop executed', { stationId, stoppedSessions: stoppedCount });
      return true;
    } catch (error) {
      logger.error('Failed emergency stop', { stationId, error });
      return false;
    }
  }

  async getStationStats(stationId: number): Promise<any> {
    try {
      const stats = await db
        .select({
          totalSessions: count(),
          totalEnergyDelivered: sum(chargingSessions.energyDelivered),
          totalRevenue: sum(chargingSessions.totalCost),
          avgSessionTime: avg(chargingSessions.duration),
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'completed')
          )
        );

      const result = stats[0];
      return {
        totalSessions: Number(result.totalSessions) || 0,
        totalEnergyDelivered: Number(result.totalEnergyDelivered) || 0,
        totalRevenue: Number(result.totalRevenue) || 0,
        avgSessionTime: Number(result.avgSessionTime) || 0,
        activeSessionsCount: Array.from(this.activeSessions.values()).filter(
          s => s.stationId === stationId && s.status === 'active'
        ).length,
      };
    } catch (error) {
      logger.error('Failed to get station stats', { stationId, error });
      return null;
    }
  }

  getActiveSessions(): Map<string, ChargingSession> {
    return this.activeSessions;
  }
}

export const sessionService = new SessionService();