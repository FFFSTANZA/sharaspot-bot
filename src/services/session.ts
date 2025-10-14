// src/services/session.ts - Fully Integrated, Optimized Implementation
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
  startTime: Date;
  endTime?: Date;
  energyDelivered: number;
  currentBatteryLevel: number;
  targetBatteryLevel: number;
  chargingRate: number;
  pricePerKwh: number;
  totalCost: number;
  status: 'initiated' | 'active' | 'paused' | 'completed' | 'stopped' | 'stopping';
  efficiency: number;
  estimatedCompletion?: string;
  queueId?: number;
}

export interface SessionStatus {
  currentBatteryLevel: number;
  chargingRate: number;
  energyAdded: number;
  currentCost: number;
  duration: string;
  estimatedCompletion: string;
  efficiency: number;
  statusMessage: string;
}

export interface CostBreakdown {
  energyRate: number;
  energyConsumed: number;
  energyCost: number;
  platformFee: number;
  gstRate: number;
  gst: number;
  totalCost: number;
  homeComparison: string;
  petrolComparison: string;
}

export interface UserStats {
  totalSessions: number;
  totalEnergyConsumed: number;
  totalCostSpent: number;
  avgSessionTime: number;
  favoriteStation: {
    id: number;
    name: string;
    sessionCount: number;
  } | null;
  totalSavings: number;
  avgEfficiency: number;
}

export interface SessionSummary {
  sessionId: string;
  duration: string;
  energyDelivered: number;
  finalBatteryLevel: number;
  totalCost: number;
  efficiency: number;
  stationName: string;
  startTime: Date;
  endTime: Date;
}

class SessionService {
  private activeSessions = new Map<string, ChargingSession>();
  private sessionMonitors = new Map<string, NodeJS.Timeout>();

  /**
   * MODIFIED: Start session - Now initiates photo verification first
   */
  async startSession(
    userWhatsapp: string,
    stationId: number,
    queueId?: number
  ): Promise<ChargingSession | null> {
    try {
      // Check for existing active session
      const existingSession = await this.getActiveSession(userWhatsapp, stationId);
      if (existingSession && ['active', 'paused'].includes(existingSession.status)) {
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

      // Create session in database with 'initiated' status
      const [newSession] = await db
        .insert(chargingSessions)
        .values({
          sessionId,
          userWhatsapp,
          stationId,
          queueId,
          status: 'initiated',
          verificationStatus: 'pending',
          startTime: new Date(),
          maxPowerUsed: stationData.maxPowerKw || 50,
          ratePerKwh: stationData.pricePerKwh?.toString() || '12',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      logger.info('Session created, initiating photo verification', {
        sessionId,
        userWhatsapp,
        stationId,
      });

      // ✅ Initiate photo verification flow
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
   * ✅ Actually start charging after photo verification is confirmed
   */
  async startChargingAfterVerification(
    sessionId: string,
    startMeterReading: number
  ): Promise<void> {
    try {
      logger.info('Starting charging after photo verification', {
        sessionId,
        startMeterReading,
      });

      const now = new Date();
      await db
        .update(chargingSessions)
        .set({
          status: 'active',
          verificationStatus: 'charging',
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
      await this.startSessionMonitoring(session);

      logger.info('Charging started successfully', {
        sessionId,
        userWhatsapp: session.userWhatsapp,
      });

      await notificationService.sendSessionStartNotification(
        session.userWhatsapp,
        session
      );
    } catch (error) {
      logger.error('Failed to start charging after verification', {
        error,
        sessionId,
      });
      throw error;
    }
  }

  /**
   * Get active session for user and station
   */
  async getActiveSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null> {
    for (const s of this.activeSessions.values()) {
      if (
        s.userWhatsapp === userWhatsapp &&
        s.stationId === stationId &&
        ['active', 'paused', 'initiated'].includes(s.status)
      ) {
        return s;
      }
    }
    return null;
  }

  /**
   * Get live session status with real-time data
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

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
      statusMessage: progressData.statusMessage,
    };
  }

  /**
   * Get detailed cost breakdown
   */
  async getCostBreakdown(sessionId?: string): Promise<CostBreakdown> {
    if (!sessionId) return this.getDefaultCostBreakdown();

    const session = this.activeSessions.get(sessionId);
    if (!session) return this.getDefaultCostBreakdown();

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
      petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost),
    };
  }

  /**
   * MODIFIED: Stop session - Now initiates end photo verification
   */
  async stopSession(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (!session) {
        logger.warn('No active session to stop', { userWhatsapp, stationId });
        return false;
      }

      this.stopSessionMonitoring(session.id);

      await db
        .update(chargingSessions)
        .set({
          status: 'paused',
          verificationStatus: 'awaiting_end_photo',
          updatedAt: new Date(),
        })
        .where(eq(chargingSessions.sessionId, session.id));

      logger.info('Stop session requested, initiating end photo verification', {
        sessionId: session.id,
        userWhatsapp,
      });

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
   * ✅ Complete session after end photo verification is confirmed
   */
  async completeSessionAfterVerification(
    sessionId: string,
    endMeterReading: number,
    consumption: number
  ): Promise<void> {
    try {
      const [session] = await db
        .select()
        .from(chargingSessions)
        .where(eq(chargingSessions.sessionId, sessionId))
        .limit(1);
      if (!session) throw new Error('Session not found');

      const startTime = session.startedAt || session.startTime || session.createdAt || new Date();
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
          efficiency: 90,
          stationName: 'Charging Station', // ← hardcoded fallback
          startTime,
          endTime,
};

      logger.info('Session completed successfully', {
        sessionId,
        userWhatsapp: session.userWhatsapp,
        consumption,
        totalCost,
      });

      await notificationService.sendSessionCompletedNotification(
        session.userWhatsapp,
        session,
        summary
      );

      await this.updateUserStats(session.userWhatsapp, consumption, totalCost);
    } catch (error) {
      logger.error('Failed to complete session after verification', {
        error,
        sessionId,
      });
      throw error;
    }
  }

  /**
   * Pause charging session
   */
  async pauseSession(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (!session || session.status !== 'active') {
        logger.warn('No active session to pause', { userWhatsapp, stationId });
        return false;
      }

      session.status = 'paused';
      this.activeSessions.set(session.id, session);
      await this.updateSessionInDatabase(session);

      this.stopSessionMonitoring(session.id);

      await notificationService.sendSessionPausedNotification(userWhatsapp, session);

      setTimeout(async () => {
        const currentSession = this.activeSessions.get(session.id);
        if (currentSession && currentSession.status === 'paused') {
          await this.resumeSession(userWhatsapp, stationId);
        }
      }, 10 * 60 * 1000);

      logger.info('⏸️ Session paused', { sessionId: session.id, userWhatsapp, stationId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to pause session', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Resume paused session
   */
  async resumeSession(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (!session || session.status !== 'paused') {
        logger.warn('No paused session to resume', { userWhatsapp, stationId });
        return false;
      }

      session.status = 'active';
      this.activeSessions.set(session.id, session);
      await this.updateSessionInDatabase(session);
      await this.startSessionMonitoring(session);

      await notificationService.sendSessionResumedNotification(userWhatsapp, session);
      logger.info('▶️ Session resumed', { sessionId: session.id, userWhatsapp, stationId });
      return true;
    } catch (error) {
      logger.error('❌ Failed to resume session', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Extend session target battery level
   */
  async extendSession(userWhatsapp: string, stationId: number, newTarget: number): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (!session || session.status !== 'active') {
        logger.warn('Cannot extend inactive session', { userWhatsapp, stationId });
        return false;
      }

      session.targetBatteryLevel = newTarget;
      this.activeSessions.set(session.id, session);
      await this.updateSessionInDatabase(session);

      await notificationService.sendSessionExtendedNotification(userWhatsapp, session, newTarget);
      logger.info('⏰ Session extended', { sessionId: session.id, newTarget });
      return true;
    } catch (error) {
      logger.error('❌ Failed to extend session', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Force stop session for reliability or system-level intervention
   */
  async forceStopSession(userWhatsapp: string, stationId: number, reason: string = 'manual_stop'): Promise<boolean> {
    try {
      const session = await this.getActiveSession(userWhatsapp, stationId);
      if (session) {
        this.stopSessionMonitoring(session.id);
        session.status = 'stopped';
        session.endTime = new Date();
        this.activeSessions.delete(session.id);
        await this.updateSessionInDatabase(session, true);
      }
      logger.info('🚨 Session force stopped', { userWhatsapp, stationId, reason });
      return true;
    } catch (error) {
      logger.error('Force stop failed', { userWhatsapp, stationId, error });
      return false;
    }
  }

  // === DATABASE METHODS ===

  private async updateSessionInDatabase(session: ChargingSession, isFinal: boolean = false): Promise<void> {
    try {
      const updateData: any = {
        status: session.status as any,
        energyDelivered: session.energyDelivered.toString(),
        totalCost: session.totalCost.toString(),
        updatedAt: new Date(),
      };
      if (isFinal && session.endTime) {
        updateData.endTime = session.endTime;
        updateData.duration = Math.floor((session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60));
      }
      await db.update(chargingSessions)
        .set(updateData)
        .where(eq(chargingSessions.sessionId, session.id));
      logger.info('🔄 Session updated in database', { sessionId: session.id });
    } catch (error) {
      logger.error('❌ Failed to update session in database', { sessionId: session.id, error });
    }
  }

  // === MONITORING & UTILITIES ===

  private async startSessionMonitoring(session: ChargingSession): Promise<void> {
    const sessionId = session.id;
    const existingMonitor = this.sessionMonitors.get(sessionId);
    if (existingMonitor) clearInterval(existingMonitor);

    const monitor = setInterval(async () => {
      await this.updateSessionProgress(session);
    }, 30 * 1000);

    this.sessionMonitors.set(sessionId, monitor);
    logger.info('🔄 Session monitoring started', { sessionId });
  }

  private stopSessionMonitoring(sessionId: string): void {
    const monitor = this.sessionMonitors.get(sessionId);
    if (monitor) {
      clearInterval(monitor);
      this.sessionMonitors.delete(sessionId);
    }
  }

  private async updateSessionProgress(session: ChargingSession): Promise<void> {
    try {
      if (session.status !== 'active') return;

      const now = new Date();
      const durationMinutes = Math.floor((now.getTime() - session.startTime.getTime()) / (1000 * 60));
      const progress = this.calculateChargingProgress(session, durationMinutes);

      session.currentBatteryLevel = progress.currentBatteryLevel;
      session.energyDelivered = progress.energyAdded;
      session.chargingRate = progress.chargingRate;
      session.totalCost = progress.currentCost;

      if (session.currentBatteryLevel >= session.targetBatteryLevel) {
        await this.stopSession(session.userWhatsapp, session.stationId);
        return;
      }

      if (durationMinutes % 10 === 0 && durationMinutes > 0) {
        await notificationService.sendSessionProgressNotification(
          session.userWhatsapp,
          session,
          progress
        );
      }

      this.activeSessions.set(session.id, session);
      if (durationMinutes % 5 === 0) {
        await this.updateSessionInDatabase(session);
      }
    } catch (error) {
      logger.error('❌ Failed to update session progress', { sessionId: session.id, error });
    }
  }

  private calculateChargingProgress(session: ChargingSession, durationMinutes: number): any {
    const baseRate = session.chargingRate;
    const startBattery = session.currentBatteryLevel || 20;
    const targetBattery = session.targetBatteryLevel;
    const batteryRange = targetBattery - startBattery;
    const timeToTarget = batteryRange > 0 ? (batteryRange / baseRate) * 60 : 0;

    let currentBatteryLevel = startBattery;
    let chargingRate = baseRate;

    if (durationMinutes < timeToTarget) {
      if (currentBatteryLevel < 80) {
        chargingRate = baseRate;
        currentBatteryLevel = startBattery + (durationMinutes / timeToTarget) * batteryRange;
      } else {
        chargingRate = baseRate * 0.5;
        currentBatteryLevel = startBattery + (durationMinutes / timeToTarget) * batteryRange;
      }
    } else {
      currentBatteryLevel = targetBattery;
      chargingRate = 0;
    }

    const energyAdded = (currentBatteryLevel - startBattery) * 0.6;
    const currentCost = energyAdded * session.pricePerKwh;
    const remainingTime = Math.max(0, (targetBattery - currentBatteryLevel) / chargingRate) * 60;
    const estimatedCompletion = new Date(Date.now() + remainingTime * 60 * 1000).toLocaleTimeString();
    const efficiency = Math.max(90, 100 - durationMinutes * 0.1);

    let statusMessage = '';
    if (currentBatteryLevel >= targetBattery) {
      statusMessage = '🎉 Charging complete! Your EV is ready.';
    } else if (currentBatteryLevel >= 80) {
      statusMessage = '🔋 Nearly full! Charging is slowing down.';
    } else if (chargingRate >= baseRate * 0.8) {
      statusMessage = '⚡ Fast charging in progress!';
    } else {
      statusMessage = '🔄 Steady charging progress.';
    }

    return {
      currentBatteryLevel: Math.min(Math.round(currentBatteryLevel), targetBattery),
      chargingRate: Math.round(chargingRate * 10) / 10,
      energyAdded: Math.round(energyAdded * 100) / 100,
      currentCost: Math.round(currentCost * 100) / 100,
      estimatedCompletion,
      efficiency: Math.round(efficiency),
      statusMessage,
    };
  }

  // === HELPERS ===

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  private getDefaultCostBreakdown(): CostBreakdown {
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
      petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost),
    };
  }

  private calculateHomeComparison(energyConsumed: number, totalCost: number): string {
    const homeCostPerKwh = 5;
    const homeCost = energyConsumed * homeCostPerKwh;
    const difference = totalCost - homeCost;
    const percentage = Math.round((difference / homeCost) * 100);
    return `₹${Math.round(difference)} more (${percentage}% higher)`;
  }

  private calculatePetrolComparison(energyConsumed: number, totalCost: number): string {
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

  private calculatePetrolEquivalentCost(energyKwh: number): number {
    const evEfficiency = 4;
    const petrolEfficiency = 15;
    const petrolPrice = 100;
    const kmDriven = energyKwh * evEfficiency;
    const petrolNeeded = kmDriven / petrolEfficiency;
    return petrolNeeded * petrolPrice;
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
      startTime: dbSession.startedAt || dbSession.startTime || dbSession.createdAt,
      endTime: dbSession.endTime,
      energyDelivered: parseFloat(dbSession.energyDelivered || '0'),
      currentBatteryLevel: dbSession.initialBatteryPercent || 20,
      targetBatteryLevel: dbSession.finalBatteryPercent || 80,
      chargingRate: dbSession.maxPowerUsed || 50,
      pricePerKwh: parseFloat(dbSession.ratePerKwh || '12'),
      totalCost: parseFloat(dbSession.totalCost || '0'),
      status: dbSession.status,
      efficiency: 90,
      queueId: dbSession.queueId,
    };
  }

  // === PUBLIC METHODS ===

  getActiveSessions(): Map<string, ChargingSession> {
    return this.activeSessions;
  }

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
      logger.error('❌ Failed to get session by ID', { sessionId, error });
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
      return sessions.map(this.mapToChargingSession);
    } catch (error) {
      logger.error('❌ Failed to get session history', { userWhatsapp, error });
      return [];
    }
  }

  async getUserStats(userWhatsapp: string): Promise<UserStats | null> {
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

      const favoriteStationQuery = await db
        .select({
          stationId: chargingSessions.stationId,
          stationName: chargingStations.name,
          sessionCount: count(),
        })
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.status, 'completed')
          )
        )
        .groupBy(chargingSessions.stationId, chargingStations.name)
        .orderBy(desc(count()))
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
        favoriteStation: favoriteStation
          ? {
              id: favoriteStation.stationId,
              name: favoriteStation.stationName || 'Unknown Station',
              sessionCount: Number(favoriteStation.sessionCount),
            }
          : null,
        totalSavings: Math.max(0, totalSavings),
        avgEfficiency: 95,
      };
    } catch (error) {
      logger.error('❌ Failed to get user stats', { userWhatsapp, error });
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
      logger.error('❌ Failed to execute emergency stop', { stationId, error });
      return false;
    }
  }

  async getSessionsByStation(stationId: number, limit: number = 50): Promise<ChargingSession[]> {
    try {
      const sessions = await db
        .select()
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.stationId, stationId))
        .orderBy(desc(chargingSessions.createdAt))
        .limit(limit);
      return sessions.map(this.mapToChargingSession);
    } catch (error) {
      logger.error('❌ Failed to get sessions by station', { stationId, error });
      return [];
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

      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);
      const monthlyStats = await db
        .select({
          monthlySessions: count(),
          monthlyRevenue: sum(chargingSessions.totalCost),
        })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'completed'),
            sql`${chargingSessions.createdAt} >= ${currentMonth}`
          )
        );

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
        activeSessionsCount: Array.from(this.activeSessions.values()).filter(
          (s) => s.stationId === stationId && s.status === 'active'
        ).length,
      };
    } catch (error) {
      logger.error('❌ Failed to get station stats', { stationId, error });
      return null;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      let cleanedCount = 0;
      const expiredThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.startTime < expiredThreshold && session.status !== 'completed') {
          await this.stopSession(session.userWhatsapp, session.stationId);
          cleanedCount++;
        }
      }
      logger.info('🧹 Session cleanup completed', { cleanedCount });
      return cleanedCount;
    } catch (error) {
      logger.error('❌ Failed to cleanup expired sessions', { error });
      return 0;
    }
  }

  async getRealTimeSessionData(): Promise<any> {
    const activeSessions = Array.from(this.activeSessions.values());
    return {
      totalActiveSessions: activeSessions.length,
      totalEnergyBeingDelivered: activeSessions.reduce((sum, s) => sum + s.chargingRate, 0),
      totalCurrentCost: activeSessions.reduce((sum, s) => sum + s.totalCost, 0),
      sessionsByStatus: {
        active: activeSessions.filter((s) => s.status === 'active').length,
        paused: activeSessions.filter((s) => s.status === 'paused').length,
      },
      sessionsByStation: activeSessions.reduce((acc, session) => {
        acc[session.stationId] = (acc[session.stationId] || 0) + 1;
        return acc;
      }, {} as Record<number, number>),
    };
  }

  async forceCompleteSession(sessionId: string): Promise<boolean> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) return false;
      await this.stopSession(session.userWhatsapp, session.stationId);
      return true;
    } catch (error) {
      logger.error('❌ Failed to force complete session', { sessionId, error });
      return false;
    }
  }
}

export const sessionService = new SessionService();