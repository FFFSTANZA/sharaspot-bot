"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.profileService = exports.ProfileService = void 0;
const whatsapp_1 = require("./whatsapp");
const user_1 = require("./user");
const logger_1 = require("../utils/logger");
class ProfileService {
    async updateUserProfileFromWhatsApp(whatsappId, messageContext) {
        try {
            const profileData = await this.fetchWhatsAppProfile(whatsappId);
            if (profileData) {
                await user_1.userService.updateUserProfile(whatsappId, {
                    name: profileData.name,
                    phoneNumber: profileData.phoneNumber,
                });
                logger_1.logger.info('Profile updated from WhatsApp', { whatsappId, profileData });
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to update profile from WhatsApp', { whatsappId, error });
        }
    }
    async fetchWhatsAppProfile(whatsappId) {
        try {
            return {
                phoneNumber: whatsappId,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to fetch WhatsApp profile', { whatsappId, error });
            return null;
        }
    }
    async requestUserName(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '👋 *What should I call you?*\n\n' +
            'Please tell me your name so I can personalize your experience!\n\n' +
            'Just type your name (e.g., "Ravi" or "Priya")');
    }
    async updateUserName(whatsappId, name) {
        try {
            const cleanName = name.trim();
            if (cleanName.length < 2 || cleanName.length > 50) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid name (2-50 characters).');
                return false;
            }
            const updatedUser = await user_1.userService.updateUserProfile(whatsappId, { name: cleanName });
            if (updatedUser) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ Nice to meet you, *${cleanName}*! 👋\n\nLet's set up your EV charging preferences.`);
                return true;
            }
            return false;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user name', { whatsappId, name, error });
            return false;
        }
    }
    async showProfileSummary(whatsappId) {
        try {
            const user = await user_1.userService.getUserByWhatsAppId(whatsappId);
            if (!user) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Profile not found. Please start with "hi".');
                return;
            }
            const profileText = `👤 *Your Profile*\n\n` +
                `📱 Name: ${user.name || 'Not set'}\n` +
                `📞 Phone: ${user.phoneNumber || whatsappId}\n` +
                `🚗 EV Model: ${user.evModel || 'Not specified'}\n` +
                `🔌 Connector: ${user.connectorType || 'Not set'}\n` +
                `⚡ Charging Style: ${user.chargingIntent || 'Not set'}\n` +
                `🚶‍♂️ Queue Preference: ${user.queuePreference || 'Not set'}\n` +
                `✅ Preferences Complete: ${user.preferencesCaptured ? 'Yes' : 'No'}\n` +
                `📅 Member Since: ${user.createdAt ? user.createdAt.toLocaleDateString() : 'Unknown'}`;
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, profileText, [
                { id: 'update_preferences', title: '🔄 Update Preferences' },
                { id: 'update_profile', title: '✏️ Update Name' },
            ], '👤 Your Profile');
        }
        catch (error) {
            logger_1.logger.error('Failed to show profile summary', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to load profile. Please try again.');
        }
    }
    async handleProfileUpdate(whatsappId, updateType) {
        switch (updateType) {
            case 'update_preferences':
                const { preferenceController } = await Promise.resolve().then(() => __importStar(require('../controllers/preference')));
                await preferenceController.startPreferenceGathering(whatsappId, false);
                break;
            case 'update_profile':
                await this.requestUserName(whatsappId);
                break;
            default:
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Unknown update option. Type "help" for available commands.');
                break;
        }
    }
}
exports.ProfileService = ProfileService;
exports.profileService = new ProfileService();
//# sourceMappingURL=profile.js.map