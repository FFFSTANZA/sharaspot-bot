// src/controllers/owner-webhook.ts - CORRECTED LIST MESSAGE ORDER
import { whatsappService } from '../services/whatsapp';
import { ownerService } from '../services/owner-service';
import { ownerStationService } from '../services/owner-station-service';
import { ownerAuthService } from '../services/owner-auth-service';
import { logger } from '../utils/logger';
import { validateWhatsAppId } from '../utils/validation';
import { parseOwnerButtonId } from '../utils/owner-button-parser';

// ===============================================
// OWNER FLOW STATES
// ===============================================

enum OwnerFlowState {
  AUTH_REQUIRED = 'auth_required',
  MAIN_MENU = 'main_menu',
  STATION_MANAGEMENT = 'station_management',
  PROFILE_MANAGEMENT = 'profile_management',
  ANALYTICS = 'analytics',
  SETTINGS = 'settings'
}

// ===============================================
// OWNER CONTEXT INTERFACE
// ===============================================

interface OwnerContext {
  whatsappId: string;
  currentState: OwnerFlowState;
  isAuthenticated: boolean;
  ownerId?: number;
  selectedStationId?: number;
  waitingFor?: string;
  sessionData?: any;
  lastActivity: Date;
}

// ===============================================
// MAIN OWNER WEBHOOK CONTROLLER
// ===============================================

export class OwnerWebhookController {
  private ownerContexts = new Map<string, OwnerContext>();
  private readonly CONTEXT_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  // ===============================================
  // MAIN ENTRY POINT
  // ===============================================

  /**
   * Main entry point for owner flow - triggered by "owner" command
   */
  async enterOwnerMode(whatsappId: string): Promise<void> {
    if (!validateWhatsAppId(whatsappId)) {
      logger.error('Invalid WhatsApp ID in owner flow', { whatsappId });
      return;
    }

    logger.info('🏢 Owner mode activated', { whatsappId });

    // Initialize or get existing context
    let context = this.getOwnerContext(whatsappId);
    if (!context) {
      context = this.createOwnerContext(whatsappId);
    }

    // Check if owner is already authenticated
    const isAuthenticated = await ownerAuthService.isAuthenticated(whatsappId);

    if (isAuthenticated) {
      context.isAuthenticated = true;
      context.currentState = OwnerFlowState.MAIN_MENU;
      await this.showOwnerMainMenu(whatsappId);
    } else {
      context.currentState = OwnerFlowState.AUTH_REQUIRED;
      await this.showOwnerAuthentication(whatsappId);
    }

    this.updateContext(whatsappId, context);
  }

  // ===============================================
  // MESSAGE ROUTING
  // ===============================================

  /**
   * Handle owner flow messages
   */
  async handleOwnerMessage(whatsappId: string, messageType: string, content: any): Promise<void> {
    const context = this.getOwnerContext(whatsappId);

    if (!context) {
      // Not in owner flow, ignore
      return;
    }

    try {
      // Update last activity
      context.lastActivity = new Date();
      this.updateContext(whatsappId, context);

      switch (messageType) {
        case 'text':
          await this.handleOwnerText(whatsappId, content, context);
          break;
        case 'button':
          await this.handleOwnerButton(whatsappId, content, context);
          break;
        case 'list':
          await this.handleOwnerList(whatsappId, content, context);
          break;
        default:
          await this.sendOwnerError(whatsappId, 'Unsupported message type in owner mode.');
      }
    } catch (error) {
      logger.error('Owner message handling failed', { whatsappId, error });
      await this.sendOwnerError(whatsappId, 'Something went wrong. Please try again.');
    }
  }

  // ===============================================
  // AUTHENTICATION FLOW
  // ===============================================

  /**
   * Show owner authentication screen
   */
  private async showOwnerAuthentication(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🏢 *SharaSpot Owner Portal*\n\n' +
      '🔐 *Authentication Required*\n\n' +
      'To access owner features, please authenticate yourself.\n\n' +
      '📋 *Options:*\n' +
      '• Register as new owner\n' +
      '• Login with existing credentials\n' +
      '• Get help\n\n' +
      '👆 Choose an option below:'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🔐 *Owner Authentication*',
        [
          { id: 'owner_register', title: '📝 Register' },
          { id: 'owner_login', title: '🔑 Login' },
          { id: 'owner_help', title: '❓ Help' }
        ]
      );
    }, 1500);
  }

  /**
   * Show owner main menu
   */
  private async showOwnerMainMenu(whatsappId: string): Promise<void> {
    const ownerProfile = await ownerService.getOwnerProfile(whatsappId);

    const welcomeMessage =
      `🏢 *Welcome ${ownerProfile?.name || 'Owner'}*\n\n` +
      `📊 *Quick Stats:*\n` +
      `• Stations: ${ownerProfile?.totalStations || 0}\n` +
      `• Status: ${ownerProfile?.isActive ? '🟢 Active' : '🔴 Inactive'}\n` +
      `• Verification: ${ownerProfile?.isVerified ? '✅ Verified' : '⏳ Pending'}\n\n` +
      `🎛️ *Owner Dashboard*\nWhat would you like to manage today?`;

    await whatsappService.sendTextMessage(whatsappId, welcomeMessage);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎛️ *Owner Dashboard*',
        [
          { id: 'owner_stations', title: '🔌 My Stations' },
          { id: 'owner_profile', title: '👤 Profile' },
          { id: 'owner_analytics', title: '📊 Analytics' }
        ]
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '⚙️ *More Options*',
          [
            { id: 'owner_settings', title: '⚙️ Settings' },
            { id: 'owner_help_menu', title: '❓ Help' },
            { id: 'exit_owner_mode', title: '🚪 Exit Owner Mode' }
          ]
        );
      }, 1000);
    }, 1500);
  }

  // ===============================================
  // STATION MANAGEMENT
  // ===============================================

  /**
   * Show station management menu
   */
  private async showStationManagement(whatsappId: string): Promise<void> {
    const context = this.getOwnerContext(whatsappId);
    if (!context?.isAuthenticated) return;

    context.currentState = OwnerFlowState.STATION_MANAGEMENT;
    this.updateContext(whatsappId, context);

    const stations = await ownerStationService.getOwnerStations(whatsappId);

    if (!stations || stations.length === 0) {
      await whatsappService.sendTextMessage(
        whatsappId,
        '🔌 *Station Management*\n\n' +
        '📭 *No stations found*\n\n' +
        'You haven\'t registered any charging stations yet.\n' +
        'Contact our support team to add your first station.'
      );

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          '🔌 *Station Actions*',
          [
            { id: 'owner_add_station', title: '➕ Add Station' },
            { id: 'owner_main_menu', title: '🏠 Main Menu' },
            { id: 'owner_contact_support', title: '📞 Contact Support' }
          ]
        );
      }, 1500);
      return;
    }

    // Show stations list
    await whatsappService.sendTextMessage(
      whatsappId,
      `🔌 *Your Stations (${stations.length})*\n\n` +
      stations.map((station, index) =>
        `${index + 1}. *${station.name}*\n` +
        `   📍 ${station.address}\n` +
        `   ${station.isActive ? '🟢 Active' : '🔴 Inactive'} • ` +
        `${station.isOpen ? '🔓 Open' : '🔒 Closed'}\n` +
        `   💡 ${station.availableSlots}/${station.totalSlots} slots free\n`
      ).join('\n')
    );

    // Show station management buttons
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '🎛️ *Station Management*',
        [
          { id: 'owner_station_status', title: '📊 View Status' },
          { id: 'owner_station_toggle', title: '🔄 Toggle Active' },
          { id: 'owner_station_settings', title: '⚙️ Settings' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // BUTTON HANDLERS
  // ===============================================

  /**
   * Handle owner button clicks
   */
  private async handleOwnerButton(whatsappId: string, button: any, context: OwnerContext): Promise<void> {
    const { id: buttonId, title } = button;
    logger.info('🏢 Owner button pressed', { whatsappId, buttonId, title });

    const parsed = parseOwnerButtonId(buttonId);

    switch (parsed.action) {
      case 'register':
        await this.handleOwnerRegistration(whatsappId);
        break;
      case 'login':
        await this.handleOwnerLogin(whatsappId);
        break;
      case 'stations':
        await this.showStationManagement(whatsappId);
        break;
      case 'profile':
        await this.showOwnerProfile(whatsappId);
        break;
      case 'analytics':
        await this.showOwnerAnalytics(whatsappId);
        break;
      case 'settings':
        await this.showOwnerSettings(whatsappId);
        break;
      case 'station_status':
        await this.showStationStatus(whatsappId);
        break;
      case 'station_toggle':
        await this.handleStationToggle(whatsappId);
        break;
      case 'station_settings':
        await this.showStationSettings(whatsappId);
        break;
      case 'main_menu':
        await this.showOwnerMainMenu(whatsappId);
        break;
      case 'exit_owner_mode':
        await this.exitOwnerMode(whatsappId);
        break;
      case 'help':
      case 'help_menu':
        await this.showOwnerHelp(whatsappId);
        break;
      default:
        await this.sendOwnerError(whatsappId, 'Unknown action. Please try again.');
    }
  }

  // ===============================================
  // STATION OPERATIONS
  // ===============================================

  /**
   * Show detailed station status
   */
  private async showStationStatus(whatsappId: string): Promise<void> {
    const stations = await ownerStationService.getOwnerStations(whatsappId);

    if (!stations?.length) {
      await this.sendOwnerError(whatsappId, 'No stations found.');
      return;
    }

    for (const station of stations) {
      const analytics = await ownerStationService.getStationAnalytics(station.id);

      const statusMessage =
        `📊 *${station.name} Status*\n\n` +
        `🔋 *Current Status:*\n` +
        `• Active: ${station.isActive ? '🟢 Yes' : '🔴 No'}\n` +
        `• Open: ${station.isOpen ? '🟢 Yes' : '🔴 No'}\n` +
        `• Available: ${station.availableSlots}/${station.totalSlots} slots\n` +
        `• Queue: ${analytics?.queueLength || 0} waiting\n\n` +
        `📈 *Today's Stats:*\n` +
        `• Sessions: ${analytics?.todaySessions || 0}\n` +
        `• Revenue: ₹${analytics?.todayRevenue || 0}\n` +
        `• Energy: ${analytics?.todayEnergy || 0} kWh\n\n` +
        `📍 *Location:* ${station.address}`;

      await whatsappService.sendTextMessage(whatsappId, statusMessage);

      setTimeout(async () => {
        await whatsappService.sendButtonMessage(
          whatsappId,
          `🎛️ *Control ${station.name}*`,
          [
            { id: `owner_toggle_station_${station.id}`, title: station.isActive ? '🔴 Deactivate' : '🟢 Activate' },
            { id: `owner_station_details_${station.id}`, title: '📋 Details' },
            { id: `owner_station_queue_${station.id}`, title: '👥 View Queue' }
          ]
        );
      }, 1500);
    }
  }

  /**
   * Handle station toggle (activate/deactivate)
   */
  private async handleStationToggle(whatsappId: string, stationId?: number): Promise<void> {
    if (stationId) {
      const success = await ownerStationService.toggleStationStatus(stationId, whatsappId);

      if (success) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '✅ *Station status updated successfully!*\n\nThe changes will take effect immediately.'
        );
        setTimeout(() => this.showStationStatus(whatsappId), 2000);
      } else {
        await this.sendOwnerError(whatsappId, 'Failed to update station status. Please try again.');
      }
    } else {
      const stations = await ownerStationService.getOwnerStations(whatsappId);

      if (!stations?.length) {
        await this.sendOwnerError(whatsappId, 'No stations found.');
        return;
      }

      const sections = [
        {
          title: 'Select Station to Toggle',
          rows: stations.map((station) => ({
            id: `owner_toggle_station_${station.id}`,
            title: station.name,
            description: `${station.isActive ? '🟢 Active' : '🔴 Inactive'} • ${station.address}`
          }))
        }
      ];

      // ✅ CORRECTED ORDER: to, header, sections, body, footer
      await whatsappService.sendListMessage(
        whatsappId,
        '🔄 *Toggle Station Status*',
        sections,
        'Select a station to activate or deactivate.',
        'Select Station'
      );
    }
  }

  // ===============================================
  // PROFILE & ANALYTICS
  // ===============================================

  private async showOwnerProfile(whatsappId: string): Promise<void> {
    const profile = await ownerService.getOwnerProfile(whatsappId);

    if (!profile) {
      await this.sendOwnerError(whatsappId, 'Profile not found.');
      return;
    }

    const profileMessage =
      `👤 *Your Profile*\n\n` +
      `📋 *Basic Info:*\n` +
      `• Name: ${profile.name}\n` +
      `• Business: ${profile.businessName || 'Not specified'}\n` +
      `• Phone: ${profile.phoneNumber}\n` +
      `• Email: ${profile.email || 'Not specified'}\n\n` +
      `🏢 *Business Details:*\n` +
      `• Type: ${profile.businessType || 'Not specified'}\n` +
      `• GST: ${profile.gstNumber || 'Not provided'}\n\n` +
      `📊 *Account Status:*\n` +
      `• Verified: ${profile.isVerified ? '✅ Yes' : '⏳ Pending'}\n` +
      `• Active: ${profile.isActive ? '🟢 Yes' : '🔴 No'}\n` +
      `• KYC: ${profile.kycStatus}\n` +
      `• Stations: ${profile.totalStations}\n\n` +
      `💰 *Financial:*\n` +
      `• Total Revenue: ₹${profile.totalRevenue || 0}\n` +
      `• Rating: ${profile.averageRating || 'N/A'} ⭐`;

    await whatsappService.sendTextMessage(whatsappId, profileMessage);

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '👤 *Profile Actions*',
        [
          { id: 'owner_edit_profile', title: '✏️ Edit Profile' },
          { id: 'owner_kyc_status', title: '📋 KYC Status' },
          { id: 'owner_main_menu', title: '🏠 Main Menu' }
        ]
      );
    }, 2000);
  }

  private async showOwnerAnalytics(whatsappId: string): Promise<void> {
    // Placeholder: implement actual analytics service
    await whatsappService.sendTextMessage(
      whatsappId,
      '📊 *Owner Analytics*\n\n' +
      'Detailed analytics are currently being loaded.\n\n' +
      'This feature will show revenue, utilization, and customer insights.'
    );
  }

  // ===============================================
  // UTILITY METHODS
  // ===============================================

  isInOwnerMode(whatsappId: string): boolean {
    return this.ownerContexts.has(whatsappId);
  }

  private async exitOwnerMode(whatsappId: string): Promise<void> {
    this.ownerContexts.delete(whatsappId);

    await whatsappService.sendTextMessage(
      whatsappId,
      '👋 *Exited Owner Mode*\n\n' +
      'You have successfully exited the owner portal.\n' +
      'You\'re now back to the regular user interface.\n\n' +
      'Type "owner" anytime to re-enter owner mode.\n' +
      'Type "help" for regular user commands.'
    );

    logger.info('Owner mode exited', { whatsappId });
  }

  private async sendOwnerError(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      `🏢 *Owner Portal Error*\n\n❌ ${message}\n\nType "help" for assistance or "exit" to leave owner mode.`
    );
  }

  private async showOwnerHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '❓ *Owner Portal Help*\n\n' +
      '🏢 *Available Commands:*\n' +
      '• My Stations - View and manage stations\n' +
      '• Profile - Update business information\n' +
      '• Analytics - View performance data\n' +
      '• Settings - Configure preferences\n' +
      '• Exit - Leave owner mode\n\n' +
      '🔧 *Station Management:*\n' +
      '• View real-time status\n' +
      '• Toggle active/inactive\n' +
      '• Monitor queues\n' +
      '• Track earnings\n\n' +
      '📞 *Need Support?*\n' +
      'Contact: support@sharaspot.com\n' +
      'Phone: +91-XXXX-XXXX'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        '❓ *Help Options*',
        [
          { id: 'owner_contact_support', title: '📞 Contact Support' },
          { id: 'owner_main_menu', title: '🏠 Main Menu' },
          { id: 'exit_owner_mode', title: '🚪 Exit Owner Mode' }
        ]
      );
    }, 2000);
  }

  // ===============================================
  // CONTEXT MANAGEMENT
  // ===============================================

  private getOwnerContext(whatsappId: string): OwnerContext | null {
    const context = this.ownerContexts.get(whatsappId);
    if (context && Date.now() - context.lastActivity.getTime() > this.CONTEXT_TIMEOUT) {
      this.ownerContexts.delete(whatsappId);
      return null;
    }
    return context || null;
  }

  private createOwnerContext(whatsappId: string): OwnerContext {
    const context: OwnerContext = {
      whatsappId,
      currentState: OwnerFlowState.AUTH_REQUIRED,
      isAuthenticated: false,
      lastActivity: new Date()
    };
    this.ownerContexts.set(whatsappId, context);
    return context;
  }

  private updateContext(whatsappId: string, context: OwnerContext): void {
    context.lastActivity = new Date();
    this.ownerContexts.set(whatsappId, context);
  }

  // ===============================================
  // CLEANUP & MONITORING
  // ===============================================

  cleanupExpiredContexts(): void {
    const now = Date.now();
    for (const [whatsappId, context] of this.ownerContexts.entries()) {
      if (now - context.lastActivity.getTime() > this.CONTEXT_TIMEOUT) {
        this.ownerContexts.delete(whatsappId);
        logger.info('Owner context expired and cleaned up', { whatsappId });
      }
    }
  }

  getActiveContextsCount(): number {
    return this.ownerContexts.size;
  }

  // ===============================================
  // PLACEHOLDER HANDLERS
  // ===============================================

  private async handleOwnerRegistration(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📝 *Owner Registration*\n\n' +
      'Registration is currently handled by our support team.\n\n' +
      '📞 Please contact:\n' +
      '• Email: onboarding@sharaspot.com\n' +
      '• Phone: +91-XXXX-XXXX\n\n' +
      'Our team will guide you through the complete registration process.'
    );
  }

  private async handleOwnerLogin(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🔑 *Owner Login*\n\n' +
      'Please provide your registered business name or owner ID.\n\n' +
      'Type your business name to continue.'
    );

    const context = this.getOwnerContext(whatsappId);
    if (context) {
      context.waitingFor = 'business_name';
      this.updateContext(whatsappId, context);
    }
  }

  private async handleOwnerText(whatsappId: string, text: string, context: OwnerContext): Promise<void> {
    if (context.waitingFor === 'business_name') {
      const authenticated = await ownerAuthService.authenticateByBusinessName(whatsappId, text);

      if (authenticated) {
        context.isAuthenticated = true;
        context.currentState = OwnerFlowState.MAIN_MENU;
        context.waitingFor = undefined;
        this.updateContext(whatsappId, context);

        await whatsappService.sendTextMessage(whatsappId, '✅ Authentication successful!');
        setTimeout(() => this.showOwnerMainMenu(whatsappId), 1000);
      } else {
        await this.sendOwnerError(whatsappId, 'Authentication failed. Please check your business name or contact support.');
      }
    } else {
      await this.sendOwnerError(whatsappId, 'Please use the buttons to navigate or type "help" for assistance.');
    }
  }

  private async handleOwnerList(whatsappId: string, list: any, context: OwnerContext): Promise<void> {
    const { id: listId } = list;

    if (listId.startsWith('owner_toggle_station_')) {
      const stationId = parseInt(listId.split('_')[3]);
      await this.handleStationToggle(whatsappId, stationId);
    } else {
      await this.sendOwnerError(whatsappId, 'Unknown selection. Please try again.');
    }
  }

  private async showOwnerSettings(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⚙️ *Owner Settings*\n\n' +
      'Settings panel coming soon...\n' +
      'This will include notification preferences, payment settings, and more.'
    );
  }

  private async showStationSettings(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⚙️ *Station Settings*\n\n' +
      'Station configuration panel coming soon...\n' +
      'This will include pricing, operating hours, and maintenance settings.'
    );
  }
}

// ===============================================
// EXPORT SINGLETON
// ===============================================
export const ownerWebhookController = new OwnerWebhookController();