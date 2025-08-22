// src/services/session.ts
import { db } from '../db/connection';
import { chargingStations, queues } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
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

class SessionService {
  private activeSessions = new Map<string, ChargingSession>();
  private sessionMonitors = new Map<string, NodeJS.Timeout>();

  /**
   * Start a new charging session
   */
  async startSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null> {
    try {
      logger.info('⚡ Starting charging session', { userWhatsapp, stationId });

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
        currentBatteryLevel: 20, // Default start level - in real app, get from car
        targetBatteryLevel: 80, // Default target - user can modify
        chargingRate: stationData.maxPowerKw || 50,
        pricePerKwh: Number(stationData.pricePerKwh),
        totalCost: 0,
        status: 'active',
        efficiency: 95, // Default efficiency
      };

      // Store active session
      this.activeSessions.set(sessionId, session);

      // Start real-time monitoring
      await this.startSessionMonitoring(session);

      // Send initial session notifications
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
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get live session status with real-time data
   */
  async getSessionStatus(sessionId: string): Promise<SessionStatus | null> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const now = new Date();
    const durationMs = now.getTime() - session.startTime.getTime();
    const durationMinutes = Math.floor(durationMs / (1000 * 60));

    // Simulate real charging progress
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
    if (!sessionId) {
      return this.getDefaultCostBreakdown();
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return this.getDefaultCostBreakdown();
    }

    const energyConsumed = session.energyDelivered;
    const energyCost = energyConsumed * session.pricePerKwh;
    const platformFee = Math.max(5, energyCost * 0.05); // 5% or min ₹5
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
      const sessionId = this.generateSessionId(userWhatsapp, stationId);
      const session = this.activeSessions.get(sessionId);

      if (!session || session.status !== 'active') {
        logger.warn('No active session to pause', { userWhatsapp, stationId });
        return false;
      }

      session.status = 'paused';
      this.activeSessions.set(sessionId, session);

      // Stop monitoring temporarily
      const monitor = this.sessionMonitors.get(sessionId);
      if (monitor) {
        clearInterval(monitor);
      }

      // Send pause notification
      await notificationService.sendSessionPausedNotification(userWhatsapp, session);

      // Auto-resume after 10 minutes or manual resume
      setTimeout(async () => {
        const currentSession = this.activeSessions.get(sessionId);
        if (currentSession && currentSession.status === 'paused') {
          await this.resumeSession(userWhatsapp, stationId);
        }
      }, 10 * 60 * 1000); // 10 minutes

      logger.info('⏸️ Session paused', { sessionId, userWhatsapp, stationId });
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
      const sessionId = this.generateSessionId(userWhatsapp, stationId);
      const session = this.activeSessions.get(sessionId);

      if (!session || session.status !== 'paused') {
        logger.warn('No paused session to resume', { userWhatsapp, stationId });
        return false;
      }

      session.status = 'active';
      this.activeSessions.set(sessionId, session);

      // Restart monitoring
      await this.startSessionMonitoring(session);

      // Send resume notification
      await notificationService.sendSessionResumedNotification(userWhatsapp, session);

      logger.info('▶️ Session resumed', { sessionId, userWhatsapp, stationId });
      return true;

    } catch (error) {
      logger.error('❌ Failed to resume session', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Complete charging session
   */
  async completeSession(userWhatsapp: string, stationId: number): Promise<any> {
    try {
      const sessionId = this.generateSessionId(userWhatsapp, stationId);
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        logger.warn('No active session to complete', { userWhatsapp, stationId });
        return null;
      }

      // Stop monitoring
      const monitor = this.sessionMonitors.get(sessionId);
      if (monitor) {
        clearInterval(monitor);
        this.sessionMonitors.delete(sessionId);
      }

      // Mark session as completed
      session.status = 'completed';
      session.endTime = new Date();

      // Calculate final cost
      const costBreakdown = await this.getCostBreakdown(sessionId);
      session.totalCost = costBreakdown.totalCost;

      // Generate session summary
      const summary = {
        sessionId,
        duration: this.formatDuration(
          Math.floor((session.endTime.getTime() - session.startTime.getTime()) / (1000 * 60))
        ),
        energyDelivered: session.energyDelivered,
        finalBatteryLevel: session.currentBatteryLevel,
        totalCost: session.totalCost,
        efficiency: session.efficiency,
        stationName: session.stationName
      };

      // Remove from active sessions
      this.activeSessions.delete(sessionId);

      // Send completion notification
      await notificationService.sendSessionCompletedNotification(userWhatsapp, session, summary);

      // Save to database (in real implementation)
      await this.saveSessionToDatabase(session, summary);

      logger.info('✅ Session completed successfully', { sessionId, summary });
      return summary;

    } catch (error) {
      logger.error('❌ Failed to complete session', { userWhatsapp, stationId, error });
      return null;
    }
  }

  /**
   * Stop session manually
   */
  async stopSession(userWhatsapp: string, stationId: number): Promise<boolean> {
    try {
      const sessionId = this.generateSessionId(userWhatsapp, stationId);
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        logger.warn('No active session to stop', { userWhatsapp, stationId });
        return false;
      }

      session.status = 'stopped';
      await this.completeSession(userWhatsapp, stationId);

      logger.info('🛑 Session stopped by user', { sessionId, userWhatsapp, stationId });
      return true;

    } catch (error) {
      logger.error('❌ Failed to stop session', { userWhatsapp, stationId, error });
      return false;
    }
  }

  /**
   * Extend session time/target
   */
  async extendSession(userWhatsapp: string, stationId: number, newTarget: number): Promise<boolean> {
    try {
      const sessionId = this.generateSessionId(userWhatsapp, stationId);
      const session = this.activeSessions.get(sessionId);

      if (!session || session.status !== 'active') {
        return false;
      }

      session.targetBatteryLevel = newTarget;
      this.activeSessions.set(sessionId, session);

      await notificationService.sendSessionExtendedNotification(userWhatsapp, session, newTarget);

      logger.info('⏰ Session extended', { sessionId, newTarget });
      return true;

    } catch (error) {
      logger.error('❌ Failed to extend session', { userWhatsapp, stationId, error });
      return false;
    }
  }

  // Private helper methods

  private async startSessionMonitoring(session: ChargingSession): Promise<void> {
    const sessionId = session.id;
    
    // Clear existing monitor if any
    const existingMonitor = this.sessionMonitors.get(sessionId);
    if (existingMonitor) {
      clearInterval(existingMonitor);
    }

    // Start new monitoring interval (every 30 seconds)
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
      
      // Simulate realistic charging progress
      const progress = this.calculateChargingProgress(session, durationMinutes);
      
      // Update session data
      session.currentBatteryLevel = progress.currentBatteryLevel;
      session.energyDelivered = progress.energyAdded;
      session.chargingRate = progress.chargingRate;
      session.totalCost = progress.currentCost;

      // Check if target reached
      if (session.currentBatteryLevel >= session.targetBatteryLevel) {
        await this.completeSession(session.userWhatsapp, session.stationId);
        return;
      }

      // Send periodic updates (every 10 minutes)
      if (durationMinutes % 10 === 0 && durationMinutes > 0) {
        await notificationService.sendSessionProgressNotification(session.userWhatsapp, session, progress);
      }

      // Update active session
      this.activeSessions.set(session.id, session);

    } catch (error) {
      logger.error('❌ Failed to update session progress', { sessionId: session.id, error });
    }
  }

  private calculateChargingProgress(session: ChargingSession, durationMinutes: number): any {
    const baseRate = session.chargingRate; // kW
    const startBattery = 20; // Starting battery %
    const targetBattery = session.targetBatteryLevel;
    
    // Simulate charging curve (fast initial, slower as battery fills)
    const batteryRange = targetBattery - startBattery;
    const timeToTarget = (batteryRange / baseRate) * 60; // minutes for full charge
    
    let currentBatteryLevel = startBattery;
    let chargingRate = baseRate;
    
    if (durationMinutes < timeToTarget) {
      // Charging curve: fast to 80%, slower above 80%
      if (currentBatteryLevel < 80) {
        chargingRate = baseRate;
        currentBatteryLevel = startBattery + (durationMinutes / timeToTarget) * batteryRange;
      } else {
        chargingRate = baseRate * 0.5; // Slower after 80%
        currentBatteryLevel = startBattery + (durationMinutes / timeToTarget) * batteryRange;
      }
    } else {
      currentBatteryLevel = targetBattery;
      chargingRate = 0;
    }

    // Calculate energy and cost
    const energyAdded = (currentBatteryLevel - startBattery) * 0.6; // Assume 60kWh battery
    const currentCost = energyAdded * session.pricePerKwh;
    
    // Calculate completion time
    const remainingBattery = targetBattery - currentBatteryLevel;
    const remainingTime = (remainingBattery / chargingRate) * 60; // minutes
    const estimatedCompletion = new Date(Date.now() + remainingTime * 60 * 1000).toLocaleTimeString();
    
    // Efficiency calculation
    const efficiency = Math.max(90, 100 - (durationMinutes * 0.1)); // Slight efficiency loss over time

    // Status message
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
    
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
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
      petrolComparison: this.calculatePetrolComparison(energyConsumed, totalCost)
    };
  }

  private calculateHomeComparison(energyConsumed: number, totalCost: number): string {
    const homeCostPerKwh = 5; // Average home electricity rate
    const homeCost = energyConsumed * homeCostPerKwh;
    const difference = totalCost - homeCost;
    const percentage = Math.round((difference / homeCost) * 100);
    
    return `₹${Math.round(difference)} more (${percentage}% higher)`;
  }

  private calculatePetrolComparison(energyConsumed: number, totalCost: number): string {
    const petrolEfficiency = 15; // km per liter
    const evEfficiency = 4; // km per kWh
    const petrolPrice = 100; // per liter
    
    const kmDriven = energyConsumed * evEfficiency;
    const petrolNeeded = kmDriven / petrolEfficiency;
    const petrolCost = petrolNeeded * petrolPrice;
    
    const savings = petrolCost - totalCost;
    const percentage = Math.round((savings / petrolCost) * 100);
    
    return `₹${Math.round(savings)} saved (${percentage}% cheaper)`;
  }

  private async saveSessionToDatabase(session: ChargingSession, summary: any): Promise<void> {
    try {
      // In real implementation, save session data to database
      logger.info('💾 Session saved to database', { sessionId: session.id, summary });
    } catch (error) {
      logger.error('❌ Failed to save session to database', { sessionId: session.id, error });
    }
  }

  /**
   * Get session history for user
   */
  async getSessionHistory(userWhatsapp: string, limit: number = 10): Promise<ChargingSession[]> {
    try {
      // In real implementation, fetch from database
      // For now, return empty array
      return [];
    } catch (error) {
      logger.error('❌ Failed to get session history', { userWhatsapp, error });
      return [];
    }
  }

  /**
   * Get total energy and cost for user
   */
  async getUserStats(userWhatsapp: string): Promise<any> {
    try {
      // In real implementation, calculate from database
      return {
        totalSessions: 0,
        totalEnergyConsumed: 0,
        totalCostSpent: 0,
        avgSessionTime: 0,
        favoriteStation: null
      };
    } catch (error) {
      logger.error('❌ Failed to get user stats', { userWhatsapp, error });
      return null;
    }
  }

  /**
   * Get all active sessions (for admin/monitoring)
   */
  getActiveSessions(): Map<string, ChargingSession> {
    return this.activeSessions;
  }

  /**
   * Emergency stop all sessions at a station
   */
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
}

export const sessionService = new SessionService();