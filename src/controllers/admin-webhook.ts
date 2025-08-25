// src/controllers/admin-webhook.ts - Simple Admin Controller
import { whatsappService } from '../services/whatsapp';
import { adminService } from '../services/admin-service';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';

// ===============================================
// ADMIN FLOW STATES
// ===============================================

enum AdminFlowState {
  AUTH_REQUIRED = 'auth_required',
  MAIN_MENU = 'main_menu',
  USER_MANAGEMENT = 'user_management',
  STATION_MANAGEMENT = 'station_management',
  SYSTEM_MANAGEMENT = 'system_management',
  ANALYTICS = 'analytics'
}

// ===============================================
// ADMIN CONTEXT INTERFACE
// ===============================================

interface AdminContext {
  whatsappId: string;
  currentState: AdminFlowState;
  isAuthenticated: boolean;
  adminId?: string;
  selectedUserId?: string;
  selectedStationId?: number;
  waitingFor?: string;
  sessionData?: any;
  lastActivity: Date;
}

// ===============================================
// MAIN ADMIN WEBHOOK CONTROLLER
// ===============================================

export class AdminWebhookController {
  private adminContexts = new Map<string, AdminContext>();
  private readonly CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly ADMIN_WHITELIST = [
    '917010101010', // Add your admin WhatsApp IDs here
    '919876543210'  // Example admin ID
  ];

  // ===============================================
  // MAIN ENTRY POINT
  // ===============================================

  /**
   * Main entry point for admin flow - triggered by "admin" command
   */
  async enterAdminMode(whatsappId: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID in admin flow', { whatsappId });
      return;
    }

    // Check if user is authorized admin
    if (!this.isAuthorizedAdmin(whatsappId)) {
      await whatsappService.sendTextMessage(
        whatsappId, 
        '🚫 Access denied. You are not authorized to use admin commands.'
      );
      return;
    }

    logger.info('🔐 Admin mode activated', { whatsappId });

    // Initialize or get existing context
    let context = this.getAdminContext(whatsappId);
    if (!context) {
      context = this.createAdminContext(whatsappId);
    }

    // Always show main menu (simple approach - no separate auth)
    context.isAuthenticated = true;
    context.currentState = AdminFlowState.MAIN_MENU;
    await this.showAdminMainMenu(whatsappId);

    this.updateContext(whatsappId, context);
  }

  // ===============================================
  // MESSAGE ROUTING
  // ===============================================

  /**
   * Handle admin flow messages
   */
  async handleAdminMessage(whatsappId: string, messageType: string, content: any): Promise<void> {
    const context = this.getAdminContext(whatsappId);

    if (!context || !this.isAuthorizedAdmin(whatsappId)) {
      return;
    }

    try {
      // Update last activity
      context.lastActivity = new Date();
      this.updateContext(whatsappId, context);

      switch (messageType) {
        case 'text':
          await this.handleAdminText(whatsappId, content, context);
          break;
        case 'button':
          await this.handleAdminButton(whatsappId, content, context);
          break;
        default:
          await this.sendAdminError(whatsappId, 'Unsupported message type in admin mode.');
      }
    } catch (error) {
      logger.error('Admin message handling failed', { whatsappId, error });
      await this.sendAdminError(whatsappId, 'Something went wrong. Please try again.');
    }
  }

  // ===============================================
  // TEXT COMMAND HANDLERS
  // ===============================================

  private async handleAdminText(whatsappId: string, text: string, context: AdminContext): Promise<void> {
    const command = text.toLowerCase().trim();

    // Handle waiting for input
    if (context.waitingFor) {
      await this.handleWaitingInput(whatsappId, text, context);
      return;
    }

    // Quick commands (can be used anytime)
    switch (command) {
      case 'menu':
      case 'main':
        context.currentState = AdminFlowState.MAIN_MENU;
        await this.showAdminMainMenu(whatsappId);
        break;

      case 'exit':
      case 'quit':
        await this.exitAdminMode(whatsappId);
        break;

      case 'help':
        await this.showAdminHelp(whatsappId);
        break;

      // Quick stats commands
      case 'stats':
        await this.showQuickStats(whatsappId);
        break;

      case 'users':
        await this.showUserStats(whatsappId);
        break;

      case 'stations':
        await this.showStationStats(whatsappId);
        break;

      // System commands
      case 'status':
        await this.showSystemStatus(whatsappId);
        break;

      default:
        await this.handleContextBasedText(whatsappId, text, context);
    }

    this.updateContext(whatsappId, context);
  }

  // ===============================================
  // BUTTON HANDLERS
  // ===============================================

  private async handleAdminButton(whatsappId: string, buttonData: any, context: AdminContext): Promise<void> {
    const buttonId = buttonData.id || buttonData;
    
    // Parse admin button IDs (simple format: admin_action_param)
    const parts = buttonId.replace(/^admin_/, '').split('_');
    const action = parts[0];

    switch (action) {
      case 'users':
        context.currentState = AdminFlowState.USER_MANAGEMENT;
        await this.showUserManagement(whatsappId);
        break;

      case 'stations':
        context.currentState = AdminFlowState.STATION_MANAGEMENT;
        await this.showStationManagement(whatsappId);
        break;

      case 'system':
        context.currentState = AdminFlowState.SYSTEM_MANAGEMENT;
        await this.showSystemManagement(whatsappId);
        break;

      case 'analytics':
        context.currentState = AdminFlowState.ANALYTICS;
        await this.showAnalytics(whatsappId);
        break;

      case 'back':
        await this.handleBackButton(whatsappId, context);
        break;

      case 'refresh':
        await this.handleRefreshButton(whatsappId, context);
        break;

      default:
        await this.handleSpecificAction(whatsappId, buttonId, context);
    }

    this.updateContext(whatsappId, context);
  }

  // ===============================================
  // ADMIN MENU DISPLAYS
  // ===============================================

  private async showAdminMainMenu(whatsappId: string): Promise<void> {
    const menuText = `🔐 *Admin Control Panel*

Available Commands:
• *stats* - Quick system statistics
• *users* - User management  
• *stations* - Station management
• *status* - System status check
• *help* - Show all commands
• *exit* - Exit admin mode

Or use the buttons below:`;

    await whatsappService.sendButtonMessage(whatsappId, menuText, [
      { id: 'admin_users', title: '👥 Users' },
      { id: 'admin_stations', title: '🔌 Stations' },
      { id: 'admin_system', title: '⚙️ System' }
    ]);
  }

  private async showUserManagement(whatsappId: string): Promise<void> {
    const stats = await adminService.getUserStats();
    
    const text = `👥 *User Management*

📊 *Current Statistics:*
• Total Users: ${stats.totalUsers}
• Active Today: ${stats.activeToday}
• New This Week: ${stats.newThisWeek}
• In Onboarding: ${stats.inOnboarding}

*Commands:*
• \`user <phone>\` - View user details
• \`block <phone>\` - Block user
• \`unblock <phone>\` - Unblock user
• \`reset <phone>\` - Reset user data`;

    await whatsappService.sendButtonMessage(whatsappId, text, [
      { id: 'admin_user_list', title: '📋 Recent Users' },
      { id: 'admin_user_blocked', title: '🚫 Blocked Users' },
      { id: 'admin_back', title: '◀️ Back' }
    ]);
  }

  private async showStationManagement(whatsappId: string): Promise<void> {
    const stats = await adminService.getStationStats();

    const text = `🔌 *Station Management*

📊 *Current Statistics:*
• Total Stations: ${stats.totalStations}
• Active: ${stats.activeStations}
• Offline: ${stats.offlineStations}
• Avg Utilization: ${stats.avgUtilization}%

*Commands:*
• \`station <id>\` - View station details
• \`toggle <id>\` - Toggle station status
• \`refresh\` - Refresh all data`;

    await whatsappService.sendButtonMessage(whatsappId, text, [
      { id: 'admin_station_list', title: '📋 All Stations' },
      { id: 'admin_station_offline', title: '⚠️ Offline' },
      { id: 'admin_back', title: '◀️ Back' }
    ]);
  }

  private async showSystemManagement(whatsappId: string): Promise<void> {
    const status = await adminService.getSystemStatus();

    const text = `⚙️ *System Management*

💾 *Database:* ${status.database}
🌐 *WhatsApp API:* ${status.whatsapp}
📊 *Active Sessions:* ${status.activeSessions}
🔄 *Uptime:* ${status.uptime}

*Commands:*
• \`clear cache\` - Clear system cache
• \`restart\` - Restart services (careful!)
• \`logs\` - View recent logs`;

    await whatsappService.sendButtonMessage(whatsappId, text, [
      { id: 'admin_logs', title: '📄 View Logs' },
      { id: 'admin_cache_clear', title: '🗑️ Clear Cache' },
      { id: 'admin_back', title: '◀️ Back' }
    ]);
  }

  // ===============================================
  // QUICK COMMAND HANDLERS
  // ===============================================

  private async showQuickStats(whatsappId: string): Promise<void> {
    const stats = await adminService.getQuickStats();

    const text = `📊 *Quick Statistics*

👥 *Users:* ${stats.totalUsers} (${stats.activeToday} today)
🔌 *Stations:* ${stats.totalStations} (${stats.activeStations} active)
⚡ *Sessions:* ${stats.totalSessions} (${stats.activeSessions} active)
💰 *Revenue:* ₹${stats.todayRevenue} (today)

Use \`menu\` to return to main menu.`;

    await whatsappService.sendTextMessage(whatsappId, text);
  }

  private async showSystemStatus(whatsappId: string): Promise<void> {
    const status = await adminService.getSystemStatus();

    const statusText = `🔍 *System Status*

${status.database === 'connected' ? '✅' : '❌'} Database
${status.whatsapp === 'connected' ? '✅' : '❌'} WhatsApp API  
${status.services === 'running' ? '✅' : '❌'} Core Services

📊 Active Sessions: ${status.activeSessions}
🕐 Uptime: ${status.uptime}
💾 Memory Usage: ${status.memoryUsage}%`;

    await whatsappService.sendTextMessage(whatsappId, statusText);
  }

  // ===============================================
  // CONTEXT MANAGEMENT
  // ===============================================

  private createAdminContext(whatsappId: string): AdminContext {
    const context: AdminContext = {
      whatsappId,
      currentState: AdminFlowState.AUTH_REQUIRED,
      isAuthenticated: false,
      lastActivity: new Date()
    };

    this.adminContexts.set(whatsappId, context);
    return context;
  }

  public getAdminContext(whatsappId: string): AdminContext | null {
    const context = this.adminContexts.get(whatsappId);
    
    if (!context) return null;

    // Check if context has expired
    const timeSinceLastActivity = Date.now() - context.lastActivity.getTime();
    if (timeSinceLastActivity > this.CONTEXT_TIMEOUT) {
      this.adminContexts.delete(whatsappId);
      return null;
    }

    return context;
  }

  private updateContext(whatsappId: string, context: AdminContext): void {
    context.lastActivity = new Date();
    this.adminContexts.set(whatsappId, context);
  }

  private async exitAdminMode(whatsappId: string): Promise<void> {
    this.adminContexts.delete(whatsappId);
    await whatsappService.sendTextMessage(
      whatsappId, 
      '👋 Exited admin mode. Type "admin" to re-enter.'
    );
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  private isAuthorizedAdmin(whatsappId: string): boolean {
    return this.ADMIN_WHITELIST.includes(whatsappId);
  }

  private async sendAdminError(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
  }

  private async showAdminHelp(whatsappId: string): Promise<void> {
    const helpText = `🔐 *Admin Commands Help*

*Navigation:*
• \`menu\` - Main admin menu
• \`exit\` - Exit admin mode
• \`help\` - This help message

*Quick Commands:*
• \`stats\` - System statistics
• \`users\` - User statistics  
• \`stations\` - Station overview
• \`status\` - System health

*User Management:*
• \`user <phone>\` - User details
• \`block <phone>\` - Block user
• \`unblock <phone>\` - Unblock user

*Station Management:*
• \`station <id>\` - Station details
• \`toggle <id>\` - Toggle station

*System:*
• \`logs\` - Recent logs
• \`clear cache\` - Clear cache`;

    await whatsappService.sendTextMessage(whatsappId, helpText);
  }

  // ===============================================
  // HELPER HANDLERS (STUBS FOR EXTENSION)
  // ===============================================

  private async handleWaitingInput(whatsappId: string, input: string, context: AdminContext): Promise<void> {
    // Handle specific waiting states
    switch (context.waitingFor) {
      case 'user_phone':
        await this.handleUserLookup(whatsappId, input);
        break;
      case 'station_id':
        await this.handleStationLookup(whatsappId, input);
        break;
      default:
        break;
    }
    
    context.waitingFor = undefined;
  }

  private async handleContextBasedText(whatsappId: string, text: string, context: AdminContext): Promise<void> {
    // Handle text based on current state
    switch (context.currentState) {
      case AdminFlowState.USER_MANAGEMENT:
        await this.handleUserCommand(whatsappId, text);
        break;
      case AdminFlowState.STATION_MANAGEMENT:
        await this.handleStationCommand(whatsappId, text);
        break;
      default:
        await whatsappService.sendTextMessage(whatsappId, '❓ Unknown command. Type "help" for available commands.');
    }
  }

  private async handleUserCommand(whatsappId: string, command: string): Promise<void> {
    // Parse user management commands
    const parts = command.split(' ');
    const action = parts[0].toLowerCase();
    const phone = parts[1];

    switch (action) {
      case 'user':
        if (phone) {
          await adminService.getUserDetails(whatsappId, phone);
        }
        break;
      case 'block':
        if (phone) {
          await adminService.blockUser(whatsappId, phone);
        }
        break;
      case 'unblock':
        if (phone) {
          await adminService.unblockUser(whatsappId, phone);
        }
        break;
      default:
        await whatsappService.sendTextMessage(whatsappId, '❓ Use: user/block/unblock <phone>');
    }
  }

  private async handleStationCommand(whatsappId: string, command: string): Promise<void> {
    const parts = command.split(' ');
    const action = parts[0].toLowerCase();
    const stationId = parts[1] ? parseInt(parts[1]) : null;

    switch (action) {
      case 'station':
        if (stationId) {
          await adminService.getStationDetails(whatsappId, stationId);
        }
        break;
      case 'toggle':
        if (stationId) {
          await adminService.toggleStation(whatsappId, stationId);
        }
        break;
      default:
        await whatsappService.sendTextMessage(whatsappId, '❓ Use: station/toggle <id>');
    }
  }

  private async handleBackButton(whatsappId: string, context: AdminContext): Promise<void> {
    context.currentState = AdminFlowState.MAIN_MENU;
    await this.showAdminMainMenu(whatsappId);
  }

  private async handleRefreshButton(whatsappId: string, context: AdminContext): Promise<void> {
    switch (context.currentState) {
      case AdminFlowState.USER_MANAGEMENT:
        await this.showUserManagement(whatsappId);
        break;
      case AdminFlowState.STATION_MANAGEMENT:
        await this.showStationManagement(whatsappId);
        break;
      case AdminFlowState.SYSTEM_MANAGEMENT:
        await this.showSystemManagement(whatsappId);
        break;
      default:
        await this.showAdminMainMenu(whatsappId);
    }
  }

  private async handleSpecificAction(whatsappId: string, buttonId: string, context: AdminContext): Promise<void> {
    // Handle specific button actions based on full button ID
    logger.info('Handling specific admin action', { whatsappId, buttonId });
    // Implementation depends on specific actions needed
  }

  private async handleUserLookup(whatsappId: string, phone: string): Promise<void> {
    await adminService.getUserDetails(whatsappId, phone);
  }

  private async handleStationLookup(whatsappId: string, stationIdStr: string): Promise<void> {
    const stationId = parseInt(stationIdStr);
    if (!isNaN(stationId)) {
      await adminService.getStationDetails(whatsappId, stationId);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❌ Invalid station ID format');
    }
  }

  private async showUserStats(whatsappId: string): Promise<void> {
    const stats = await adminService.getUserStats();
    
    const text = `👥 *User Statistics*

📊 Total Users: ${stats.totalUsers}
✅ Active Today: ${stats.activeToday}
🆕 New This Week: ${stats.newThisWeek}
🔄 In Onboarding: ${stats.inOnboarding}
🚫 Blocked: ${stats.blockedUsers}

Use \`users\` for detailed management.`;

    await whatsappService.sendTextMessage(whatsappId, text);
  }

  private async showStationStats(whatsappId: string): Promise<void> {
    const stats = await adminService.getStationStats();

    const text = `🔌 *Station Statistics*

📊 Total Stations: ${stats.totalStations}
✅ Active: ${stats.activeStations}
❌ Offline: ${stats.offlineStations}
⚡ Avg Utilization: ${stats.avgUtilization}%
💰 Today's Revenue: ₹${stats.todayRevenue}

Use \`stations\` for detailed management.`;

    await whatsappService.sendTextMessage(whatsappId, text);
  }

  private async showAnalytics(whatsappId: string): Promise<void> {
    const analytics = await adminService.getAnalytics();

    const text = `📈 *System Analytics*

📊 *Usage (Last 24h):*
• Messages: ${analytics.messages24h}
• New Users: ${analytics.newUsers24h}
• Sessions: ${analytics.sessions24h}

💰 *Revenue:*
• Today: ₹${analytics.revenueToday}
• This Week: ₹${analytics.revenueWeek}
• This Month: ₹${analytics.revenueMonth}

⚡ *Performance:*
• Avg Response Time: ${analytics.avgResponseTime}ms
• Success Rate: ${analytics.successRate}%`;

    await whatsappService.sendButtonMessage(whatsappId, text, [
      { id: 'admin_analytics_detailed', title: '📊 Detailed' },
      { id: 'admin_back', title: '◀️ Back' }
    ]);
  }
}

// Create and export singleton instance
export const adminWebhookController = new AdminWebhookController();