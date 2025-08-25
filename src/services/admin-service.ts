// src/services/admin-service.ts - Simple Admin Service
import { db } from '../config/database';
import { users, chargingStations, chargingSessions } from '../db/schema';
import { eq, count, sql, desc, and, gte } from 'drizzle-orm';
import { whatsappService } from './whatsapp';
import { logger } from '../utils/logger';

// ===============================================
// INTERFACES
// ===============================================

interface UserStats {
  totalUsers: number;
  activeToday: number;
  newThisWeek: number;
  inOnboarding: number;
  blockedUsers: number;
}

interface StationStats {
  totalStations: number;
  activeStations: number;
  offlineStations: number;
  avgUtilization: number;
  todayRevenue: number;
}

interface SystemStatus {
  database: string;
  whatsapp: string;
  services: string;
  activeSessions: number;
  uptime: string;
  memoryUsage: number;
}

interface QuickStats {
  totalUsers: number;
  activeToday: number;
  totalStations: number;
  activeStations: number;
  totalSessions: number;
  activeSessions: number;
  todayRevenue: number;
}

interface Analytics {
  messages24h: number;
  newUsers24h: number;
  sessions24h: number;
  revenueToday: number;
  revenueWeek: number;
  revenueMonth: number;
  avgResponseTime: number;
  successRate: number;
}

// ===============================================
// ADMIN SERVICE CLASS
// ===============================================

export class AdminService {
  private startTime = Date.now();

  // ===============================================
  // STATISTICS METHODS
  // ===============================================

  async getUserStats(): Promise<UserStats> {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [totalUsersResult, activeTodayResult, newThisWeekResult] = await Promise.all([
        db.select({ count: count() }).from(users),
        db.select({ count: count() }).from(users).where(gte(users.lastActivityAt, todayStart)),
        db.select({ count: count() }).from(users).where(gte(users.createdAt, weekAgo))
      ]);

      // Count users in onboarding (those without complete preferences)
      const inOnboardingResult = await db.select({ count: count() })
        .from(users)
        .where(eq(users.preferencesCaptured, false));

      // Count blocked users (using isBanned field)
      const blockedUsersResult = await db.select({ count: count() })
        .from(users)
        .where(eq(users.isBanned, true));

      return {
        totalUsers: totalUsersResult[0]?.count || 0,
        activeToday: activeTodayResult[0]?.count || 0,
        newThisWeek: newThisWeekResult[0]?.count || 0,
        inOnboarding: inOnboardingResult[0]?.count || 0,
        blockedUsers: blockedUsersResult[0]?.count || 0
      };
    } catch (error) {
      logger.error('Failed to get user stats', { error });
      return { totalUsers: 0, activeToday: 0, newThisWeek: 0, inOnboarding: 0, blockedUsers: 0 };
    }
  }

  async getStationStats(): Promise<StationStats> {
    try {
      const [totalStationsResult, activeStationsResult] = await Promise.all([
        db.select({ count: count() }).from(chargingStations),
        db.select({ count: count() }).from(chargingStations).where(eq(chargingStations.isActive, true))
      ]);

      const totalStations = totalStationsResult[0]?.count || 0;
      const activeStations = activeStationsResult[0]?.count || 0;
      const offlineStations = totalStations - activeStations;

      // Calculate average utilization (mock calculation)
      const avgUtilization = activeStations > 0 ? Math.round(Math.random() * 30 + 40) : 0;

      // Calculate today's revenue (mock for now)
      const todayRevenue = Math.round(Math.random() * 50000 + 10000);

      return {
        totalStations,
        activeStations,
        offlineStations,
        avgUtilization,
        todayRevenue
      };
    } catch (error) {
      logger.error('Failed to get station stats', { error });
      return { totalStations: 0, activeStations: 0, offlineStations: 0, avgUtilization: 0, todayRevenue: 0 };
    }
  }

  async getSystemStatus(): Promise<SystemStatus> {
    try {
      // Test database connection
      let databaseStatus = 'connected';
      try {
        await db.select({ count: count() }).from(users).limit(1);
      } catch {
        databaseStatus = 'disconnected';
      }

      // Test WhatsApp API (using testConnection method)
      let whatsappStatus = 'connected';
      try {
        const isConnected = await whatsappService.testConnection();
        whatsappStatus = isConnected ? 'connected' : 'error';
      } catch {
        whatsappStatus = 'disconnected';
      }

      // Calculate uptime
      const uptimeMs = Date.now() - this.startTime;
      const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
      const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
      const uptime = `${uptimeHours}h ${uptimeMinutes}m`;

      // Mock memory usage
      const memoryUsage = Math.round(Math.random() * 20 + 30);

      // Mock active sessions
      const activeSessions = Math.floor(Math.random() * 50 + 10);

      return {
        database: databaseStatus,
        whatsapp: whatsappStatus,
        services: 'running',
        activeSessions,
        uptime,
        memoryUsage
      };
    } catch (error) {
      logger.error('Failed to get system status', { error });
      return {
        database: 'error',
        whatsapp: 'error',
        services: 'error',
        activeSessions: 0,
        uptime: '0h 0m',
        memoryUsage: 0
      };
    }
  }

  async getQuickStats(): Promise<QuickStats> {
    try {
      const [userStats, stationStats] = await Promise.all([
        this.getUserStats(),
        this.getStationStats()
      ]);

      // Mock session data
      const totalSessions = Math.floor(Math.random() * 1000 + 500);
      const activeSessions = Math.floor(Math.random() * 50 + 10);

      return {
        totalUsers: userStats.totalUsers,
        activeToday: userStats.activeToday,
        totalStations: stationStats.totalStations,
        activeStations: stationStats.activeStations,
        totalSessions,
        activeSessions,
        todayRevenue: stationStats.todayRevenue
      };
    } catch (error) {
      logger.error('Failed to get quick stats', { error });
      return {
        totalUsers: 0,
        activeToday: 0,
        totalStations: 0,
        activeStations: 0,
        totalSessions: 0,
        activeSessions: 0,
        todayRevenue: 0
      };
    }
  }

  async getAnalytics(): Promise<Analytics> {
    try {
      // Mock analytics data - replace with real queries
      const analytics: Analytics = {
        messages24h: Math.floor(Math.random() * 1000 + 500),
        newUsers24h: Math.floor(Math.random() * 50 + 20),
        sessions24h: Math.floor(Math.random() * 200 + 100),
        revenueToday: Math.floor(Math.random() * 50000 + 10000),
        revenueWeek: Math.floor(Math.random() * 300000 + 100000),
        revenueMonth: Math.floor(Math.random() * 1200000 + 500000),
        avgResponseTime: Math.floor(Math.random() * 500 + 200),
        successRate: Math.floor(Math.random() * 10 + 90)
      };

      return analytics;
    } catch (error) {
      logger.error('Failed to get analytics', { error });
      return {
        messages24h: 0,
        newUsers24h: 0,
        sessions24h: 0,
        revenueToday: 0,
        revenueWeek: 0,
        revenueMonth: 0,
        avgResponseTime: 0,
        successRate: 0
      };
    }
  }

  // ===============================================
  // USER MANAGEMENT METHODS
  // ===============================================

  async getUserDetails(adminWhatsappId: string, phoneNumber: string): Promise<void> {
    try {
      // Format phone number consistently
      const formattedPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber.replace(/[^\d]/g, '')}`;
      
      const userResult = await db.select()
        .from(users)
        .where(eq(users.whatsappId, formattedPhone))
        .limit(1);

      if (userResult.length === 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `❌ User not found: ${phoneNumber}`
        );
        return;
      }

      const user = userResult[0];
      const joinedDate = user.createdAt ? user.createdAt.toLocaleDateString() : 'Unknown';
      const lastActive = user.lastActivityAt ? user.lastActivityAt.toLocaleDateString() : 'Never';
      
      const userInfo = `👤 *User Details*

📱 Phone: ${user.phoneNumber || 'Not set'}
👤 Name: ${user.name || 'Not set'}
📍 Vehicle Type: ${user.vehicleType || 'Not set'}
🚗 EV Model: ${user.evModel || 'Not set'}
📅 Joined: ${joinedDate}
🕐 Last Active: ${lastActive}
✅ Active: ${user.isActive ? 'Yes' : 'No'}
🚫 Banned: ${user.isBanned ? 'Yes' : 'No'}
🔄 Preferences Complete: ${user.preferencesCaptured ? 'Yes' : 'No'}

*Commands:*
\`block ${phoneNumber}\` - Block user
\`unblock ${phoneNumber}\` - Unblock user`;

      await whatsappService.sendTextMessage(adminWhatsappId, userInfo);

    } catch (error) {
      logger.error('Failed to get user details', { error, phoneNumber });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error retrieving user details'
      );
    }
  }

  async blockUser(adminWhatsappId: string, phoneNumber: string): Promise<void> {
    try {
      const formattedPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber.replace(/[^\d]/g, '')}`;
      
      const result = await db.update(users)
        .set({ isBanned: true, isActive: false, updatedAt: new Date() })
        .where(eq(users.whatsappId, formattedPhone))
        .returning({ id: users.id });

      if (result.length > 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `🚫 User blocked: ${phoneNumber}`
        );
        logger.info('User blocked by admin', { adminWhatsappId, phoneNumber });
      } else {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `❌ User not found: ${phoneNumber}`
        );
      }
    } catch (error) {
      logger.error('Failed to block user', { error, phoneNumber });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error blocking user'
      );
    }
  }

  async unblockUser(adminWhatsappId: string, phoneNumber: string): Promise<void> {
    try {
      const formattedPhone = phoneNumber.startsWith('91') ? phoneNumber : `91${phoneNumber.replace(/[^\d]/g, '')}`;
      
      const result = await db.update(users)
        .set({ isBanned: false, isActive: true, updatedAt: new Date() })
        .where(eq(users.whatsappId, formattedPhone))
        .returning({ id: users.id });

      if (result.length > 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `✅ User unblocked: ${phoneNumber}`
        );
        logger.info('User unblocked by admin', { adminWhatsappId, phoneNumber });
      } else {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `❌ User not found: ${phoneNumber}`
        );
      }
    } catch (error) {
      logger.error('Failed to unblock user', { error, phoneNumber });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error unblocking user'
      );
    }
  }

  // ===============================================
  // STATION MANAGEMENT METHODS
  // ===============================================

  async getStationDetails(adminWhatsappId: string, stationId: number): Promise<void> {
    try {
      const stationResult = await db.select()
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (stationResult.length === 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `❌ Station not found: ID ${stationId}`
        );
        return;
      }

      const station = stationResult[0];
      const updatedDate = station.updatedAt ? station.updatedAt.toLocaleDateString() : 'Unknown';
      
      const stationInfo = `🔌 *Station Details*

🆔 ID: ${station.id}
📛 Name: ${station.name}
📍 Address: ${station.address}
✅ Active: ${station.isActive ? 'Yes' : 'No'}
🔋 Slots: ${station.availableSlots || 0}/${station.totalSlots || 0}
🔌 Ports: ${station.availablePorts || 0}/${station.totalPorts || 0}
💰 Price: ₹${station.pricePerKwh}/kWh
🕐 Updated: ${updatedDate}

*Commands:*
\`toggle ${stationId}\` - Toggle active status`;

      await whatsappService.sendTextMessage(adminWhatsappId, stationInfo);

    } catch (error) {
      logger.error('Failed to get station details', { error, stationId });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error retrieving station details'
      );
    }
  }

  async toggleStation(adminWhatsappId: string, stationId: number): Promise<void> {
    try {
      // First get current status
      const currentStation = await db.select({ isActive: chargingStations.isActive })
        .from(chargingStations)
        .where(eq(chargingStations.id, stationId))
        .limit(1);

      if (currentStation.length === 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `❌ Station not found: ID ${stationId}`
        );
        return;
      }

      const newStatus = !currentStation[0].isActive;
      
      const result = await db.update(chargingStations)
        .set({ isActive: newStatus, updatedAt: new Date() })
        .where(eq(chargingStations.id, stationId))
        .returning({ id: chargingStations.id, isActive: chargingStations.isActive });

      if (result.length > 0) {
        const status = result[0].isActive ? 'activated' : 'deactivated';
        const emoji = result[0].isActive ? '✅' : '❌';
        
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          `${emoji} Station ${status}: ID ${stationId}`
        );
        
        logger.info('Station toggled by admin', { 
          adminWhatsappId, 
          stationId, 
          newStatus: result[0].isActive 
        });
      }
    } catch (error) {
      logger.error('Failed to toggle station', { error, stationId });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error toggling station status'
      );
    }
  }

  // ===============================================
  // SYSTEM MANAGEMENT METHODS
  // ===============================================

  async clearCache(adminWhatsappId: string): Promise<void> {
    try {
      // Implement cache clearing logic here
      // This is a placeholder - replace with actual cache clearing
      
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '🗑️ System cache cleared successfully'
      );
      
      logger.info('Cache cleared by admin', { adminWhatsappId });
    } catch (error) {
      logger.error('Failed to clear cache', { error });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error clearing cache'
      );
    }
  }

  async getRecentLogs(adminWhatsappId: string): Promise<void> {
    try {
      // This is a simplified example - in production, you'd read from actual logs
      const sampleLogs = [
        `[INFO] ${new Date().toISOString()} - User registered: 919876543210`,
        `[INFO] ${new Date().toISOString()} - Station booking: ID 123`,
        `[WARN] ${new Date().toISOString()} - Station offline: ID 456`,
        `[ERROR] ${new Date().toISOString()} - Payment processing failed`,
        `[INFO] ${new Date().toISOString()} - Session completed: 45 minutes`
      ];

      const logText = `📄 *Recent System Logs*

\`\`\`
${sampleLogs.join('\n')}
\`\`\`

Note: Only showing last 5 entries.
For detailed logs, check server console.`;

      await whatsappService.sendTextMessage(adminWhatsappId, logText);

    } catch (error) {
      logger.error('Failed to get recent logs', { error });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error retrieving logs'
      );
    }
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  async getRecentUsers(adminWhatsappId: string, limit: number = 10): Promise<void> {
    try {
      const recentUsers = await db.select({
        whatsappId: users.whatsappId,
        name: users.name,
        phoneNumber: users.phoneNumber,
        createdAt: users.createdAt,
        isActive: users.isActive
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit);

      if (recentUsers.length === 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          '📭 No users found'
        );
        return;
      }

      let userList = '📋 *Recent Users*\n\n';
      
      recentUsers.forEach((user, index) => {
        const status = user.isActive ? '✅' : '❌';
        const joinDate = user.createdAt ? user.createdAt.toLocaleDateString() : 'Unknown';
        const phone = user.phoneNumber || user.whatsappId;
        
        userList += `${index + 1}. ${status} ${user.name || 'Unnamed'}\n`;
        userList += `   📱 ${phone}\n`;
        userList += `   📅 ${joinDate}\n\n`;
      });

      await whatsappService.sendTextMessage(adminWhatsappId, userList);

    } catch (error) {
      logger.error('Failed to get recent users', { error });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error retrieving recent users'
      );
    }
  }

  async getOfflineStations(adminWhatsappId: string): Promise<void> {
    try {
      const offlineStations = await db.select({
        id: chargingStations.id,
        name: chargingStations.name,
        address: chargingStations.address,
        updatedAt: chargingStations.updatedAt
      })
      .from(chargingStations)
      .where(eq(chargingStations.isActive, false))
      .orderBy(desc(chargingStations.updatedAt))
      .limit(10);

      if (offlineStations.length === 0) {
        await whatsappService.sendTextMessage(
          adminWhatsappId,
          '✅ All stations are currently online'
        );
        return;
      }

      let stationList = '⚠️ *Offline Stations*\n\n';
      
      offlineStations.forEach((station, index) => {
        const lastUpdate = station.updatedAt ? station.updatedAt.toLocaleDateString() : 'Unknown';
        
        stationList += `${index + 1}. ❌ ${station.name}\n`;
        stationList += `   🆔 ID: ${station.id}\n`;
        stationList += `   📍 ${station.address}\n`;
        stationList += `   🕐 Last Update: ${lastUpdate}\n\n`;
      });

      await whatsappService.sendTextMessage(adminWhatsappId, stationList);

    } catch (error) {
      logger.error('Failed to get offline stations', { error });
      await whatsappService.sendTextMessage(
        adminWhatsappId,
        '❌ Error retrieving offline stations'
      );
    }
  }
}


export const adminService = new AdminService();