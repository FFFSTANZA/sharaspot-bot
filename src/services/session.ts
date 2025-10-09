// src/services/session.ts - Clean, Optimized Implementation
import { db } from '../db/connection';
import { chargingStations, chargingSessions } from '../db/schema';
import { eq, and, desc, sql, count, sum, avg } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { notificationService } from './notification';

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
  status: 'active' | 'paused' | 'completed' | 'stopped';
  efficiency: number;
  estimatedCompletion?: Date;
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
   * Start a new charging session or reuse existing one
   */
  async startSession(userWhatsapp: string, stationId: number, queueId?: number): Promise<ChargingSession | null> {
    try {
      logger.info('⚡ Starting charging session', { userWhatsapp, stationId, queueId });

      // Check for existing active session
      const existingSession = await this.getActiveSession(userWhatsapp, stationId);
      if (existingSession && ['active', 'paused'].includes(existingSession.status)) {
        logger.info('Reusing existing session', { sessionId: existingSession.id });
        if (!this.sessionMonitors.has(existingSession.id)) {
          await this.startSessionMonitoring(existingSession);
        }
        return existingSession;
      }

      // Get station details
      const station = await db.select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (!station.length) {
        logger.error('Station not found for session', { stationId });
        return null;
      }

      const stationData = station[0];
      const sessionId = this.generateSessionId(userWhatsapp, stationId);

      // Create session object
      const session: ChargingSession = {
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

      // Save to database and memory
      await this.saveSessionToDatabase(session);
      this.activeSessions.set(sessionId, session);
      await this.startSessionMonitoring(session);
      await notificationService.sendSessionStartNotification(userWhatsapp, session);

      logger.info('✅ Charging session started successfully', { sessionId, userWhatsapp, stationId });
      return session;

    } catch (error) {
      logger.error('❌ Failed to start charging session', { userWhatsapp, stationId, error });
      return null;
    }
  }

  /**
   * Get active session for user and station
   */
  async getActiveSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null> {
    const sessionId = this.generateSessionId(userWhatsapp, stationId);
    const session = this.activeSessions.get(sessionId);
    
    if (!session) {
      // Fallback: search by user + station combination
      for (const s of this.activeSessions.values()) {
        if (s.userWhatsapp === userWhatsapp && s.stationId === stationId && 
            ['active', 'paused'].includes(s.status)) {
          return s;
        }
      }
    }
    return session || null;
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
      statusMessage: progressData.statusMessage
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
      petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost)
    };
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

      const monitor = this.sessionMonitors.get(session.id);
      if (monitor) clearInterval(monitor);

      await notificationService.sendSessionPausedNotification(userWhatsapp, session);

      // Auto-resume after 10 minutes
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
/**
 * Resume a paused charging session
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
 * Complete an active charging session and generate summary
 */
async completeSession(userWhatsapp: string, stationId: number): Promise<SessionSummary | null> {
  try {
    const session = await this.getActiveSession(userWhatsapp, stationId);
    if (!session) {
      logger.warn('No active session to complete', { userWhatsapp, stationId });
      return null;
    }

    // Stop monitoring interval if exists
    const monitor = this.sessionMonitors.get(session.id);
    if (monitor) {
      clearInterval(monitor);
      this.sessionMonitors.delete(session.id);
    }

    // Update session data
    session.status = 'completed';
    session.endTime = new Date();
    const costBreakdown = await this.getCostBreakdown(session.id);
    session.totalCost = costBreakdown?.totalCost ?? 0;

    // Generate session summary
    const durationMinutes = Math.floor(
      (session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60)
    );

    const summary: SessionSummary = {
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

    // Cleanup from memory
    this.activeSessions.delete(session.id);

    // Persist changes
    await this.updateSessionInDatabase(session, true);

    // Notify user
    await notificationService.sendSessionCompletedNotification(userWhatsapp, session, summary);

    logger.info('✅ Session completed successfully', { sessionId: session.id, summary });
    return summary;

  } catch (error) {
    logger.error('❌ Failed to complete session', { userWhatsapp, stationId, error });
    return null;
  }
}

/**
 * Stop session manually by user
 */
// ONLY ADD THIS METHOD TO SessionService class in src/services/session.ts

/**
 * Simple stop session - mirrors start session approach  
 */
async stopSession(userWhatsapp: string, stationId: number): Promise<boolean> {
  try {
    const session = await this.getActiveSession(userWhatsapp, stationId);
    if (!session) {
      logger.warn('No active session to stop', { userWhatsapp, stationId });
      return false;
    }

    // Simple status update
    session.status = 'stopped';
    session.endTime = new Date();
    
    // Calculate totals
    const durationMinutes = Math.floor(
      (session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60)
    );
    
    session.energyDelivered = Math.floor(durationMinutes * 0.5);
    session.totalCost = session.energyDelivered * 12.5;

    // Update database
    await this.updateSessionInDatabase(session, true);
    
    // Clean up memory
    this.activeSessions.delete(session.id);
    
    // Stop monitoring
    const monitor = this.sessionMonitors.get(session.id);
    if (monitor) {
      clearInterval(monitor);
      this.sessionMonitors.delete(session.id);
    }

    logger.info('Session stopped', { 
      sessionId: session.id, 
      userWhatsapp, 
      stationId,
      duration: durationMinutes
    });

    return true;

  } catch (error) {
    logger.error('Failed to stop session', { userWhatsapp, stationId, error });
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
      session.status = 'stopped';
      await this.completeSession(userWhatsapp, stationId);
    }

    // Optional: integrate with queue service if needed
    // await queueService.completeCharging(userWhatsapp, stationId);

    logger.info('🚨 Session force stopped', { userWhatsapp, stationId, reason });
    return true;
  } catch (error) {
    logger.error('Force stop failed', { userWhatsapp, stationId, error });
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
  // === DATABASE METHODS ===

  private async saveSessionToDatabase(session: ChargingSession): Promise<void> {
    try {
      await db.insert(chargingSessions).values({
        sessionId: session.id,
        stationId: session.stationId,
        userWhatsapp: session.userWhatsapp,
        queueId: session.queueId || null,
        status: session.status as any,
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
      logger.info('💾 Session saved to database', { sessionId: session.id });
    } catch (error) {
      logger.error('❌ Failed to save session to database', { sessionId: session.id, error });
      throw error;
    }
  }

  private async updateSessionInDatabase(session: ChargingSession, isFinal: boolean = false): Promise<void> {
    try {
      const updateData: any = {
        status: session.status as any,
        energyDelivered: session.energyDelivered.toString(),
        totalCost: session.totalCost.toString(),
        updatedAt: new Date()
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

  // === UTILITY METHODS ===

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
        await this.completeSession(session.userWhatsapp, session.stationId);
        return;
      }

      if (durationMinutes % 10 === 0 && durationMinutes > 0) {
        await notificationService.sendSessionProgressNotification(session.userWhatsapp, session, progress);
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
    const remainingBattery = targetBattery - currentBatteryLevel;
    const remainingTime = remainingBattery > 0 ? (remainingBattery / chargingRate) * 60 : 0;
    const estimatedCompletion = new Date(Date.now() + remainingTime * 60 * 1000).toLocaleTimeString();
    const efficiency = Math.max(90, 100 - (durationMinutes * 0.1));

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
      statusMessage
    };
  }

  private generateSessionId(userWhatsapp: string, stationId: number): string {
    return `session_${userWhatsapp}_${stationId}_${Date.now()}`;
  }

  private formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  // === HELPER METHODS ===

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
      petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost)
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

  // === PUBLIC METHODS ===

  getActiveSessions(): Map<string, ChargingSession> {
    return this.activeSessions;
  }

  async getSessionById(sessionId: string): Promise<ChargingSession | null> {
    try {
      const sessions = await db.select({
        id: chargingSessions.sessionId,
        userWhatsapp: chargingSessions.userWhatsapp,
        stationId: chargingSessions.stationId,
        stationName: chargingStations.name,
        startTime: chargingSessions.startTime,
        endTime: chargingSessions.endTime,
        energyDelivered: chargingSessions.energyDelivered,
        totalCost: chargingSessions.totalCost,
        status: chargingSessions.status,
        ratePerKwh: chargingSessions.ratePerKwh
      })
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.sessionId, sessionId))
        .limit(1);

      if (!sessions.length) return null;

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
        status: session.status as any,
        efficiency: 95
      };

    } catch (error) {
      logger.error('❌ Failed to get session by ID', { sessionId, error });
      return null;
    }
  }

  async getSessionHistory(userWhatsapp: string, limit: number = 10): Promise<ChargingSession[]> {
    try {
      const sessions = await db.select({
        id: chargingSessions.sessionId,
        userWhatsapp: chargingSessions.userWhatsapp,
        stationId: chargingSessions.stationId,
        stationName: chargingStations.name,
        startTime: chargingSessions.startTime,
        endTime: chargingSessions.endTime,
        energyDelivered: chargingSessions.energyDelivered,
        totalCost: chargingSessions.totalCost,
        status: chargingSessions.status,
        duration: chargingSessions.duration,
        ratePerKwh: chargingSessions.ratePerKwh
      })
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.userWhatsapp, userWhatsapp))
        .orderBy(desc(chargingSessions.createdAt))
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
        status: session.status as any,
        efficiency: 95
      }));

    } catch (error) {
      logger.error('❌ Failed to get session history', { userWhatsapp, error });
      return [];
    }
  }

  async getUserStats(userWhatsapp: string): Promise<UserStats | null> {
    try {
      const basicStats = await db.select({
        totalSessions: count(),
        totalEnergyConsumed: sum(chargingSessions.energyDelivered),
        totalCostSpent: sum(chargingSessions.totalCost),
        avgSessionTime: avg(chargingSessions.duration)
      })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.userWhatsapp, userWhatsapp),
            eq(chargingSessions.status, 'completed')
          )
        );

      const favoriteStationQuery = await db.select({
        stationId: chargingSessions.stationId,
        stationName: chargingStations.name,
        sessionCount: count()
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
        favoriteStation: favoriteStation ? {
          id: favoriteStation.stationId,
          name: favoriteStation.stationName || 'Unknown Station',
          sessionCount: Number(favoriteStation.sessionCount)
        } : null,
        totalSavings: Math.max(0, totalSavings),
        avgEfficiency: 95
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
      const sessions = await db.select({
        id: chargingSessions.sessionId,
        userWhatsapp: chargingSessions.userWhatsapp,
        stationId: chargingSessions.stationId,
        stationName: chargingStations.name,
        startTime: chargingSessions.startTime,
        endTime: chargingSessions.endTime,
        energyDelivered: chargingSessions.energyDelivered,
        totalCost: chargingSessions.totalCost,
        status: chargingSessions.status,
        duration: chargingSessions.duration,
        ratePerKwh: chargingSessions.ratePerKwh
      })
        .from(chargingSessions)
        .leftJoin(chargingStations, eq(chargingSessions.stationId, chargingStations.id))
        .where(eq(chargingSessions.stationId, stationId))
        .orderBy(desc(chargingSessions.createdAt))
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
        status: session.status as any,
        efficiency: 95
      }));

    } catch (error) {
      logger.error('❌ Failed to get sessions by station', { stationId, error });
      return [];
    }
  }

  async getStationStats(stationId: number): Promise<any> {
    try {
      const stats = await db.select({
        totalSessions: count(),
        totalEnergyDelivered: sum(chargingSessions.energyDelivered),
        totalRevenue: sum(chargingSessions.totalCost),
        avgSessionTime: avg(chargingSessions.duration)
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

      const monthlyStats = await db.select({
        monthlySessions: count(),
        monthlyRevenue: sum(chargingSessions.totalCost)
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
        activeSessionsCount: Array.from(this.activeSessions.values())
          .filter(s => s.stationId === stationId && s.status === 'active').length
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
          await this.completeSession(session.userWhatsapp, session.stationId);
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
        active: activeSessions.filter(s => s.status === 'active').length,
        paused: activeSessions.filter(s => s.status === 'paused').length
      },
      sessionsByStation: activeSessions.reduce((acc, session) => {
        acc[session.stationId] = (acc[session.stationId] || 0) + 1;
        return acc;
      }, {} as Record<number, number>)
    };
  }

  async forceCompleteSession(sessionId: string): Promise<boolean> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) return false;

      await this.completeSession(session.userWhatsapp, session.stationId);
      return true;

    } catch (error) {
      logger.error('❌ Failed to force complete session', { sessionId, error });
      return false;
    }
  }
}

export const sessionService = new SessionService();