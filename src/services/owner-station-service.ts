// src/owner/services/owner-station-service.ts - CLEAN & OPTIMIZED
import { db } from '../config/database';
import { chargingStations, stationOwners, queues, chargingSessions } from '../db/schema';
import { eq, and, gte, count, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

// ===============================================
// INTERFACES
// ===============================================

export interface OwnerStation {
  id: number;
  name: string;
  address: string;
  isActive: boolean;
  isOpen: boolean;
  totalSlots: number;
  availableSlots: number;
  pricePerKwh: string;
  queueLength: number;
  todayRevenue: number;
}

export interface StationAnalytics {
  queueLength: number;
  todaySessions: number;
  todayRevenue: number;
  todayEnergy: number;
  utilizationRate: number;
}

// ===============================================
// OWNER STATION SERVICE
// ===============================================

export class OwnerStationService {
  
  /**
   * Get all stations for owner
   */
  async getOwnerStations(whatsappId: string): Promise<OwnerStation[]> {
    if (!validateWhatsAppId(whatsappId)) return [];

    try {
      // Get owner ID first
      const [owner] = await db
        .select({ id: stationOwners.id })
        .from(stationOwners)
        .where(eq(stationOwners.whatsappId, whatsappId))
        .limit(1);

      if (!owner) return [];

      // Get stations with basic info
      const stations = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.ownerWhatsappId, owner.id.toString()))
        .orderBy(desc(chargingStations.createdAt));

      // Enhance with real-time data
      const enhancedStations = await Promise.all(
        stations.map(async (station) => {
          const [queueCount, todayRevenue] = await Promise.all([
            this.getQueueLength(station.id),
            this.getTodayRevenue(station.id)
          ]);

          return {
            id: station.id,
            name: station.name,
            address: station.address,
            isActive: station.isActive || false,
            isOpen: station.isOpen || false,
            totalSlots: station.totalSlots || 0,
            availableSlots: station.availableSlots || 0,
            pricePerKwh: station.pricePerKwh?.toString() || '0',
            queueLength: queueCount,
            todayRevenue
          };
        })
      );

      return enhancedStations;

    } catch (error) {
      logger.error('Failed to get owner stations', { whatsappId, error });
      return [];
    }
  }

  /**
   * Toggle station status (active/inactive)
   */
  async toggleStationStatus(stationId: number, ownerWhatsappId: string): Promise<boolean> {
    try {
      // Verify ownership and get current status
      const [station] = await db
        .select({ 
          isActive: chargingStations.isActive 
        })
        .from(chargingStations)
        .innerJoin(stationOwners, eq(chargingStations.ownerWhatsappId, stationOwners.id))
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(stationOwners.whatsappId, ownerWhatsappId)
          )
        )
        .limit(1);

      if (!station) {
        logger.warn('Station not found or access denied', { stationId, ownerWhatsappId });
        return false;
      }

      // Toggle status
      await db
        .update(chargingStations)
        .set({
          isActive: !station.isActive,
          updatedAt: new Date()
        })
        .where(eq(chargingStations.id, stationId));

      logger.info('Station status toggled', { 
        stationId, 
        newStatus: !station.isActive, 
        ownerWhatsappId 
      });

      return true;

    } catch (error) {
      logger.error('Failed to toggle station status', { stationId, ownerWhatsappId, error });
      return false;
    }
  }

  /**
   * Get comprehensive station analytics
   */
  async getStationAnalytics(stationId: number): Promise<StationAnalytics> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Parallel queries for efficiency
      const [
        queueLength,
        todaySessions,
        todayRevenue,
        todayEnergy,
        totalSlots
      ] = await Promise.all([
        this.getQueueLength(stationId),
        this.getTodaySessionsCount(stationId),
        this.getTodayRevenue(stationId),
        this.getTodayEnergy(stationId),
        this.getStationSlots(stationId)
      ]);

      // Calculate utilization (active sessions / total slots * 100)
      const activeSessions = await this.getActiveSessionsCount(stationId);
      const utilizationRate = totalSlots > 0 ? 
        Math.round((activeSessions / totalSlots) * 100) : 0;

      return {
        queueLength,
        todaySessions,
        todayRevenue,
        todayEnergy,
        utilizationRate
      };

    } catch (error) {
      logger.error('Failed to get station analytics', { stationId, error });
      return {
        queueLength: 0,
        todaySessions: 0,
        todayRevenue: 0,
        todayEnergy: 0,
        utilizationRate: 0
      };
    }
  }

  /**
   * Get current queue for station
   */
  async getStationQueue(stationId: number, ownerWhatsappId: string): Promise<any[]> {
    try {
      // Verify ownership
      const hasAccess = await this.verifyStationOwnership(stationId, ownerWhatsappId);
      if (!hasAccess) return [];

      const queueEntries = await db
        .select({
          position: queues.position,
          userWhatsapp: queues.userWhatsapp,
          status: queues.status,
          joinedAt: queues.joinedAt,
          estimatedWait: queues.estimatedWaitMinutes
        })
        .from(queues)
        .where(eq(queues.stationId, stationId))
        .orderBy(queues.position);

      return queueEntries;

    } catch (error) {
      logger.error('Failed to get station queue', { stationId, ownerWhatsappId, error });
      return [];
    }
  }

  // ===============================================
  // HELPER METHODS
  // ===============================================

  /**
   * Get current queue length
   */
  private async getQueueLength(stationId: number): Promise<number> {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(queues)
        .where(
          and(
            eq(queues.stationId, stationId),
            eq(queues.status, 'waiting')
          )
        );

      return result?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get today's revenue for station
   */
  private async getTodayRevenue(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sessions = await db
        .select({ totalCost: chargingSessions.totalCost })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today)
          )
        );

      const revenue = sessions.reduce((sum, session) => 
        sum + parseFloat(session.totalCost?.toString() || '0'), 0
      );

      return Math.round(revenue);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get today's sessions count
   */
  private async getTodaySessionsCount(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [result] = await db
        .select({ count: count() })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today)
          )
        );

      return result?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get today's energy delivered
   */
  private async getTodayEnergy(stationId: number): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sessions = await db
        .select({ energyDelivered: chargingSessions.energyDelivered })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            gte(chargingSessions.startTime, today)
          )
        );

      const energy = sessions.reduce((sum, session) => 
        sum + parseFloat(session.energyDelivered?.toString() || '0'), 0
      );

      return Math.round(energy * 100) / 100; // Round to 2 decimal places
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get station total slots
   */
  private async getStationSlots(stationId: number): Promise<number> {
    try {
      const [station] = await db
        .select({ totalSlots: chargingStations.totalSlots })
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      return station?.totalSlots || 4; // Default to 4 slots
    } catch (error) {
      return 4;
    }
  }

  /**
   * Get active sessions count
   */
  private async getActiveSessionsCount(stationId: number): Promise<number> {
    try {
      const [result] = await db
        .select({ count: count() })
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.stationId, stationId),
            eq(chargingSessions.status, 'active')
          )
        );

      return result?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Verify station ownership
   */
  private async verifyStationOwnership(stationId: number, ownerWhatsappId: string): Promise<boolean> {
    try {
      const [result] = await db
        .select({ id: chargingStations.id })
        .from(chargingStations)
        .innerJoin(stationOwners, eq(chargingStations.ownerWhatsappId, stationOwners.id))
        .where(
          and(
            eq(chargingStations.id, stationId),
            eq(stationOwners.whatsappId, ownerWhatsappId)
          )
        )
        .limit(1);

      return !!result;
    } catch (error) {
      return false;
    }
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const ownerStationService = new OwnerStationService();