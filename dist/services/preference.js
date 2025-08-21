"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferenceService = exports.PreferenceService = void 0;
const logger_1 = require("../utils/logger");
const user_1 = require("./user");
class PreferenceService {
    constructor() {
        this.userContexts = new Map();
    }
    async startPreferenceFlow(whatsappId, isOnboarding = false) {
        try {
            this.userContexts.set(whatsappId, {
                whatsappId,
                currentStep: 'ev_model',
                preferenceData: {},
                isOnboarding,
            });
            logger_1.logger.info('Started preference flow', { whatsappId, isOnboarding });
        }
        catch (error) {
            logger_1.logger.error('Failed to start preference flow', { whatsappId, error });
        }
    }
    getUserContext(whatsappId) {
        return this.userContexts.get(whatsappId) || null;
    }
    updateUserContext(whatsappId, updates) {
        const context = this.userContexts.get(whatsappId);
        if (context) {
            this.userContexts.set(whatsappId, { ...context, ...updates });
        }
    }
    clearUserContext(whatsappId) {
        this.userContexts.delete(whatsappId);
    }
    async savePreferences(whatsappId) {
        try {
            const context = this.getUserContext(whatsappId);
            if (!context) {
                logger_1.logger.warn('No context found for saving preferences', { whatsappId });
                return null;
            }
            const updatedUser = await user_1.userService.updateUserPreferences(whatsappId, context.preferenceData);
            if (updatedUser) {
                this.clearUserContext(whatsappId);
                logger_1.logger.info('✅ Preferences saved successfully', { whatsappId });
            }
            return updatedUser;
        }
        catch (error) {
            logger_1.logger.error('Failed to save preferences', { whatsappId, error });
            return null;
        }
    }
    isInPreferenceFlow(whatsappId) {
        return this.userContexts.has(whatsappId);
    }
    getNextStep(currentStep) {
        const stepOrder = [
            'ev_model',
            'connector_type',
            'charging_intent',
            'queue_preference',
            'completed'
        ];
        const currentIndex = stepOrder.indexOf(currentStep);
        return stepOrder[currentIndex + 1] || 'completed';
    }
    getPreviousStep(currentStep) {
        const stepOrder = [
            'ev_model',
            'connector_type',
            'charging_intent',
            'queue_preference',
            'completed'
        ];
        const currentIndex = stepOrder.indexOf(currentStep);
        return stepOrder[currentIndex - 1] || 'ev_model';
    }
}
exports.PreferenceService = PreferenceService;
exports.preferenceService = new PreferenceService();
//# sourceMappingURL=preference.js.map