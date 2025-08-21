"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferenceController = exports.PreferenceController = void 0;
const whatsapp_1 = require("../services/whatsapp");
const preference_1 = require("../services/preference");
const logger_1 = require("../utils/logger");
class PreferenceController {
    async startPreferenceGathering(whatsappId, isOnboarding = false) {
        try {
            await preference_1.preferenceService.startPreferenceFlow(whatsappId, isOnboarding);
            await this.showEVModelStep(whatsappId, isOnboarding);
        }
        catch (error) {
            logger_1.logger.error('Failed to start preference gathering', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Sorry, something went wrong. Please try again with "hi".');
        }
    }
    async handlePreferenceResponse(whatsappId, responseType, responseValue) {
        try {
            const context = preference_1.preferenceService.getUserContext(whatsappId);
            if (!context) {
                logger_1.logger.warn('No preference context found', { whatsappId });
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⚠️ Session expired. Please start again with "hi".');
                return;
            }
            switch (context.currentStep) {
                case 'ev_model':
                    await this.handleEVModelResponse(whatsappId, responseType, responseValue, context);
                    break;
                case 'connector_type':
                    await this.handleConnectorTypeResponse(whatsappId, responseValue, context);
                    break;
                case 'charging_intent':
                    await this.handleChargingIntentResponse(whatsappId, responseValue, context);
                    break;
                case 'queue_preference':
                    await this.handleQueuePreferenceResponse(whatsappId, responseValue, context);
                    break;
                default:
                    logger_1.logger.warn('Unknown preference step', { whatsappId, step: context.currentStep });
                    break;
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to handle preference response', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong. Type "hi" to restart.');
        }
    }
    async showEVModelStep(whatsappId, isOnboarding) {
        const welcomeText = isOnboarding
            ? "Let's set up your charging preferences! 🚗⚡"
            : "Let's update your charging preferences! 🔄";
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `${welcomeText}\n\n*Step 1/4: What's your EV model?*\n\nThis helps me find compatible charging stations for you.`, [
            { id: 'popular_evs', title: '📱 Choose from Popular' },
            { id: 'type_ev_model', title: '⌨️ Type My Model' },
            { id: 'skip_ev_model', title: '⏭️ Skip for Now' },
        ], '🚗 EV Model Setup');
    }
    async handleEVModelResponse(whatsappId, responseType, responseValue, context) {
        if (responseType === 'button') {
            switch (responseValue) {
                case 'popular_evs':
                    await this.showPopularEVList(whatsappId);
                    return;
                case 'type_ev_model':
                    await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '⌨️ *Type your EV model*\n\nExamples: Tesla Model 3, Tata Nexon EV, MG ZS EV, etc.\n\nJust type the name and I\'ll move to the next step!');
                    return;
                case 'skip_ev_model':
                    context.preferenceData.evModel = 'Any';
                    break;
                default:
                    context.preferenceData.evModel = responseValue;
                    break;
            }
        }
        else {
            const evModel = responseValue.trim();
            if (evModel.length > 2) {
                context.preferenceData.evModel = evModel;
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ Got it! Your EV: *${evModel}*`);
            }
            else {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid EV model name or type "skip" to continue.');
                return;
            }
        }
        context.currentStep = 'connector_type';
        preference_1.preferenceService.updateUserContext(whatsappId, context);
        await this.showConnectorTypeStep(whatsappId);
    }
    async showPopularEVList(whatsappId) {
        await whatsapp_1.whatsappService.sendListMessage(whatsappId, '*Choose your EV model:*\n\nSelect from popular models in India', 'Select EV Model', [
            {
                title: '🏆 Tesla',
                rows: [
                    { id: 'Tesla Model 3', title: 'Model 3', description: 'Most popular Tesla' },
                    { id: 'Tesla Model S', title: 'Model S', description: 'Luxury sedan' },
                    { id: 'Tesla Model X', title: 'Model X', description: 'Premium SUV' },
                ],
            },
            {
                title: '🇮🇳 Indian Brands',
                rows: [
                    { id: 'Tata Nexon EV', title: 'Tata Nexon EV', description: 'Popular compact SUV' },
                    { id: 'Tata Tigor EV', title: 'Tata Tigor EV', description: 'Affordable sedan' },
                    { id: 'Mahindra eXUV300', title: 'Mahindra eXUV300', description: 'Electric SUV' },
                ],
            },
            {
                title: '🌍 International',
                rows: [
                    { id: 'MG ZS EV', title: 'MG ZS EV', description: 'British SUV' },
                    { id: 'Hyundai Kona Electric', title: 'Hyundai Kona Electric', description: 'Korean crossover' },
                    { id: 'Audi e-tron', title: 'Audi e-tron', description: 'Luxury German SUV' },
                ],
            },
            {
                title: '⚡ Other Options',
                rows: [
                    { id: 'skip_ev_model', title: '⏭️ Skip for Now', description: 'Set up later' },
                    { id: 'type_ev_model', title: '⌨️ Type Custom Model', description: 'Enter manually' },
                ],
            },
        ], '🚗 Popular EV Models');
    }
    async showConnectorTypeStep(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Step 2/4: Charging Connector Type* 🔌\n\nWhat type of charging port does your EV have?\n\n• *CCS2* - Most common (DC fast charging)\n• *Type2* - AC charging (slower but widely available)\n• *CHAdeMO* - Mainly Nissan vehicles\n• *Any* - I\'ll find stations with multiple types', [
            { id: 'CCS2', title: '🔌 CCS2 (Most Common)' },
            { id: 'Type2', title: '🔌 Type2 (AC Charging)' },
            { id: 'CHAdeMO', title: '🔌 CHAdeMO (Nissan)' },
        ], '🔌 Connector Type');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Or if you\'re not sure:', [
                { id: 'Any', title: '🔀 Any Connector Type' },
            ]);
        }, 1000);
    }
    async handleConnectorTypeResponse(whatsappId, responseValue, context) {
        const validConnectors = ['CCS2', 'Type2', 'CHAdeMO', 'Any'];
        if (validConnectors.includes(responseValue)) {
            context.preferenceData.connectorType = responseValue;
            context.currentStep = 'charging_intent';
            preference_1.preferenceService.updateUserContext(whatsappId, context);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ Connector type: *${responseValue}*`);
            await this.showChargingIntentStep(whatsappId);
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid connector type from the options above.');
        }
    }
    async showChargingIntentStep(whatsappId) {
        await whatsapp_1.whatsappService.sendListMessage(whatsappId, '*Step 3/4: Charging Intent* ⚡\n\nHow do you typically prefer to charge?', 'Select Charging Style', [
            {
                title: '⚡ Charging Preferences',
                rows: [
                    {
                        id: 'Quick Top-up',
                        title: '⚡ Quick Top-up (15-30 min)',
                        description: 'Fast boost for immediate needs'
                    },
                    {
                        id: 'Full Charge',
                        title: '🔋 Full Charge (1-3 hours)',
                        description: 'Complete charging session'
                    },
                    {
                        id: 'Emergency',
                        title: '🚨 Emergency Only',
                        description: 'Only when battery is very low'
                    },
                ],
            },
        ], '⚡ Charging Intent');
    }
    async handleChargingIntentResponse(whatsappId, responseValue, context) {
        const validIntents = ['Quick Top-up', 'Full Charge', 'Emergency'];
        if (validIntents.includes(responseValue)) {
            context.preferenceData.chargingIntent = responseValue;
            context.currentStep = 'queue_preference';
            preference_1.preferenceService.updateUserContext(whatsappId, context);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ Charging style: *${responseValue}*`);
            await this.showQueuePreferenceStep(whatsappId);
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid charging intent from the list above.');
        }
    }
    async showQueuePreferenceStep(whatsappId) {
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, '*Step 4/4: Queue Preferences* 🚶‍♂️\n\nHow long are you willing to wait if a station is busy?\n\n• *Free Now* - Only show available stations\n• *Wait 15m* - Up to 15 minutes wait time\n• *Wait 30m* - Up to 30 minutes wait time\n• *Any Queue* - Show all stations regardless of wait', [
            { id: 'Free Now', title: '🟢 Free Now Only' },
            { id: 'Wait 15m', title: '🟡 Wait up to 15min' },
            { id: 'Wait 30m', title: '🟠 Wait up to 30min' },
        ], '🚶‍♂️ Queue Preference');
        setTimeout(async () => {
            await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, 'Or:', [
                { id: 'Any Queue', title: '🔀 Any Queue Length' },
            ]);
        }, 1000);
    }
    async handleQueuePreferenceResponse(whatsappId, responseValue, context) {
        const validPreferences = ['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'];
        if (validPreferences.includes(responseValue)) {
            context.preferenceData.queuePreference = responseValue;
            preference_1.preferenceService.updateUserContext(whatsappId, context);
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, `✅ Queue preference: *${responseValue}*`);
            await this.completePreferenceSetup(whatsappId, context);
        }
        else {
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❓ Please select a valid queue preference from the options above.');
        }
    }
    async completePreferenceSetup(whatsappId, context) {
        try {
            const updatedUser = await preference_1.preferenceService.savePreferences(whatsappId);
            if (!updatedUser) {
                await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Failed to save preferences. Please try again.');
                return;
            }
            const { evModel, connectorType, chargingIntent, queuePreference } = context.preferenceData;
            const summaryText = `🎉 *Preferences Saved Successfully!*\n\n` +
                `📋 *Your Setup:*\n` +
                `🚗 EV Model: ${evModel || 'Not specified'}\n` +
                `🔌 Connector: ${connectorType}\n` +
                `⚡ Charging Style: ${chargingIntent}\n` +
                `🚶‍♂️ Queue Preference: ${queuePreference}\n\n` +
                `✅ You're all set! Now let's find you a charging station.`;
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, summaryText);
            setTimeout(async () => {
                await this.requestLocation(whatsappId, context.isOnboarding);
            }, 2000);
        }
        catch (error) {
            logger_1.logger.error('Failed to complete preference setup', { whatsappId, error });
            await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '❌ Something went wrong saving your preferences. Please try again.');
        }
    }
    async requestLocation(whatsappId, isOnboarding) {
        const locationText = isOnboarding
            ? '📍 *Let\'s Find Charging Stations Near You!*\n\nShare your location to see nearby charging stations:'
            : '📍 *Ready to Find Stations!*\n\nShare your current location:';
        await whatsapp_1.whatsappService.sendButtonMessage(whatsappId, `${locationText}\n\n🎯 Tap "Share Location" below or use the 📎 attachment menu to send your location.\n\nYou can also type an address if you prefer!`, [
            { id: 'location_help', title: '❓ How to Share Location' },
            { id: 'type_address', title: '⌨️ Type Address Instead' },
        ], '📍 Location Request');
    }
    async showLocationHelp(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '📍 *How to Share Your Location:*\n\n' +
            '1️⃣ Tap the 📎 *attachment* icon (next to message input)\n' +
            '2️⃣ Select *Location* from the menu\n' +
            '3️⃣ Choose *Send your current location*\n' +
            '4️⃣ Tap *Send*\n\n' +
            '🔒 *Privacy:* Your location is only used to find nearby charging stations and is not stored permanently.\n\n' +
            'Alternatively, you can type your address manually!');
    }
    async requestAddressInput(whatsappId) {
        await whatsapp_1.whatsappService.sendTextMessage(whatsappId, '🗺️ *Type Your Address*\n\n' +
            'Please enter your current location or destination:\n\n' +
            '*Examples:*\n' +
            '• MG Road, Bangalore\n' +
            '• Phoenix Mall, Chennai\n' +
            '• Sector 18, Noida\n' +
            '• Mumbai Central Station\n\n' +
            'Just type the address and I\'ll find charging stations nearby!');
        preference_1.preferenceService.updateUserContext(whatsappId, {
            ...preference_1.preferenceService.getUserContext(whatsappId),
            currentStep: 'completed',
        });
    }
}
exports.PreferenceController = PreferenceController;
exports.preferenceController = new PreferenceController();
//# sourceMappingURL=preference.js.map