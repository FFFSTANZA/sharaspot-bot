
import { whatsappService } from '../services/whatsapp';
import { preferenceService, type UserContext } from '../services/preference';
import { userService } from '../services/user';
import { logger } from '../utils/logger';

export class PreferenceController {
  /**
   * Start preference gathering for new or existing users
   */
  async startPreferenceGathering(whatsappId: string, isOnboarding: boolean = false): Promise<void> {
    try {
      await preferenceService.startPreferenceFlow(whatsappId, isOnboarding);
      await this.showEVModelStep(whatsappId, isOnboarding);
    } catch (error) {
      logger.error('Failed to start preference gathering', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Sorry, something went wrong. Please try again with "hi".'
      );
    }
  }

  /**
   * Handle preference step responses - MISSING METHOD ADDED
   */
  async handlePreferenceResponse(whatsappId: string, responseType: 'button' | 'text', responseValue: string): Promise<void> {
    try {
      const context = preferenceService.getUserContext(whatsappId);
      if (!context) {
        logger.warn('No preference context found', { whatsappId });
        await whatsappService.sendTextMessage(
          whatsappId,
          '⚠️ Session expired. Please start again with "hi".'
        );
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
          logger.warn('Unknown preference step', { whatsappId, step: context.currentStep });
          break;
      }
    } catch (error) {
      logger.error('Failed to handle preference response', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong. Type "hi" to restart.'
      );
    }
  }

  /**
   * Step 1: EV Model Selection - FIXED BUTTON TITLES
   */
  private async showEVModelStep(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const welcomeText = isOnboarding 
      ? "Let's set up your charging preferences! 🚗⚡"
      : "Let's update your charging preferences! 🔄";

    await whatsappService.sendButtonMessage(
      whatsappId,
      `${welcomeText}\n\n*Step 1/4: What's your EV model?*\n\nThis helps me find compatible charging stations for you.`,
      [
        { id: 'popular_evs', title: '📱 Popular Models' }, // Fixed: 18 chars
        { id: 'type_ev_model', title: '⌨️ Type Model' }, // Fixed: 13 chars  
        { id: 'skip_ev_model', title: '⏭️ Skip' }, // Fixed: 7 chars
      ],
      '🚗 EV Model Setup'
    );
  }

  /**
   * Handle EV Model response
   */
  private async handleEVModelResponse(whatsappId: string, responseType: 'button' | 'text', responseValue: string, context: UserContext): Promise<void> {
    if (responseType === 'button') {
      switch (responseValue) {
        case 'popular_evs':
          await this.showPopularEVList(whatsappId);
          return;
        case 'type_ev_model':
          await whatsappService.sendTextMessage(
            whatsappId,
            '⌨️ *Type your EV model*\n\nExamples: Tesla Model 3, Tata Nexon EV, MG ZS EV, etc.\n\nJust type the name and I\'ll move to the next step!'
          );
          return;
        case 'skip_ev_model':
          context.preferenceData.evModel = 'Any';
          break;
        default:
          // Handle popular EV selection
          context.preferenceData.evModel = responseValue;
          break;
      }
    } else {
      // Text input for custom EV model
      const evModel = responseValue.trim();
      if (evModel.length > 2) {
        context.preferenceData.evModel = evModel;
        await whatsappService.sendTextMessage(
          whatsappId,
          `✅ Got it! Your EV: *${evModel}*`
        );
      } else {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❓ Please provide a valid EV model name or type "skip" to continue.'
        );
        return;
      }
    }

    // Move to next step
    context.currentStep = 'connector_type';
    preferenceService.updateUserContext(whatsappId, context);
    await this.showConnectorTypeStep(whatsappId);
  }

  /**
   * Show popular EV list - FIXED LIST TITLES
   */
  private async showPopularEVList(whatsappId: string): Promise<void> {
    await whatsappService.sendListMessage(
      whatsappId,
      '*Choose your EV model:*\n\nSelect from popular models in India',
      'Select Model', // Fixed: 12 chars
      [
        {
          title: '🏆 Tesla', // Fixed: 9 chars
          rows: [
            { id: 'Tesla Model 3', title: 'Model 3', description: 'Most popular Tesla' },
            { id: 'Tesla Model S', title: 'Model S', description: 'Luxury sedan' },
            { id: 'Tesla Model X', title: 'Model X', description: 'Premium SUV' },
          ],
        },
        {
          title: '🇮🇳 Indian Cars', // Fixed: 15 chars
          rows: [
            { id: 'Tata Nexon EV', title: 'Tata Nexon EV', description: 'Popular compact SUV' },
            { id: 'Tata Tigor EV', title: 'Tata Tigor EV', description: 'Affordable sedan' },
            { id: 'Mahindra eXUV300', title: 'Mahindra eXUV300', description: 'Electric SUV' },
          ],
        },
        {
          title: '🌍 International', // Fixed: 16 chars
          rows: [
            { id: 'MG ZS EV', title: 'MG ZS EV', description: 'British SUV' },
            { id: 'Hyundai Kona Electric', title: 'Hyundai Kona', description: 'Korean crossover' },
            { id: 'Audi e-tron', title: 'Audi e-tron', description: 'Luxury German SUV' },
          ],
        },
        {
          title: '⚡ Options', // Fixed: 11 chars
          rows: [
            { id: 'skip_ev_model', title: '⏭️ Skip', description: 'Set up later' },
            { id: 'type_ev_model', title: '⌨️ Type Custom', description: 'Enter manually' },
          ],
        },
      ],
      '🚗 Popular EV Models'
    );
  }

  /**
   * Step 2: Connector Type Selection - FIXED BUTTON TITLES
   */
  private async showConnectorTypeStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 2/4: Charging Connector Type* 🔌\n\nWhat type of charging port does your EV have?\n\n• *CCS2* - Most common (DC fast charging)\n• *Type2* - AC charging (slower but widely available)\n• *CHAdeMO* - Mainly Nissan vehicles\n• *Any* - I\'ll find stations with multiple types',
      [
        { id: 'CCS2', title: '🔌 CCS2' }, // Fixed: 8 chars
        { id: 'Type2', title: '🔌 Type2' }, // Fixed: 9 chars
        { id: 'CHAdeMO', title: '🔌 CHAdeMO' }, // Fixed: 11 chars
      ],
      '🔌 Connector'
    );

    // Send additional button for "Any"
    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Or if you\'re not sure:',
        [
          { id: 'Any', title: '🔀 Any Type' }, // Fixed: 11 chars
        ]
      );
    }, 1000);
  }

  /**
   * Handle Connector Type response
   */
  private async handleConnectorTypeResponse(whatsappId: string, responseValue: string, context: UserContext): Promise<void> {
    const validConnectors = ['CCS2', 'Type2', 'CHAdeMO', 'Any'];
    
    if (validConnectors.includes(responseValue)) {
      context.preferenceData.connectorType = responseValue;
      context.currentStep = 'charging_intent';
      preferenceService.updateUserContext(whatsappId, context);

      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Connector type: *${responseValue}*`
      );

      await this.showChargingIntentStep(whatsappId);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ Please select a valid connector type from the options above.'
      );
    }
  }

  /**
   * Step 3: Charging Intent Selection - FIXED LIST TITLES
   */
  private async showChargingIntentStep(whatsappId: string): Promise<void> {
    await whatsappService.sendListMessage(
      whatsappId,
      '*Step 3/4: Charging Intent* ⚡\n\nHow do you typically prefer to charge?',
      'Select Style', // Fixed: 12 chars
      [
        {
          title: '⚡ Charging', // Fixed: 12 chars
          rows: [
            { 
              id: 'Quick Top-up', 
              title: '⚡ Quick Top-up', // Fixed: 15 chars
              description: 'Fast boost 15-30 min' // Fixed: 21 chars
            },
            { 
              id: 'Full Charge', 
              title: '🔋 Full Charge', // Fixed: 15 chars
              description: 'Complete charge 1-3 hrs' // Fixed: 24 chars
            },
            { 
              id: 'Emergency', 
              title: '🚨 Emergency', // Fixed: 13 chars
              description: 'Only when battery low' // Fixed: 21 chars
            },
          ],
        },
      ],
      '⚡ Charging Intent'
    );
  }

  /**
   * Handle Charging Intent response
   */
  private async handleChargingIntentResponse(whatsappId: string, responseValue: string, context: UserContext): Promise<void> {
    const validIntents = ['Quick Top-up', 'Full Charge', 'Emergency'];
    
    if (validIntents.includes(responseValue)) {
      context.preferenceData.chargingIntent = responseValue;
      context.currentStep = 'queue_preference';
      preferenceService.updateUserContext(whatsappId, context);

      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Charging style: *${responseValue}*`
      );

      await this.showQueuePreferenceStep(whatsappId);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ Please select a valid charging intent from the list above.'
      );
    }
  }

  /**
   * Step 4: Queue Preference Selection - FIXED BUTTON TITLES
   */
  private async showQueuePreferenceStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 4/4: Queue Preferences* 🚶‍♂️\n\nHow long are you willing to wait if a station is busy?\n\n• *Free Now* - Only show available stations\n• *Wait 15m* - Up to 15 minutes wait time\n• *Wait 30m* - Up to 30 minutes wait time\n• *Any Queue* - Show all stations regardless of wait',
      [
        { id: 'Free Now', title: '🟢 Free Now' }, // Fixed: 12 chars
        { id: 'Wait 15m', title: '🟡 Wait 15min' }, // Fixed: 13 chars
        { id: 'Wait 30m', title: '🟠 Wait 30min' }, // Fixed: 13 chars
      ],
      '🚶‍♂️ Queue'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Or:',
        [
          { id: 'Any Queue', title: '🔀 Any Queue' }, // Fixed: 12 chars
        ]
      );
    }, 1000);
  }

  /**
   * Handle Queue Preference response
   */
  private async handleQueuePreferenceResponse(whatsappId: string, responseValue: string, context: UserContext): Promise<void> {
    const validPreferences = ['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'];
    
    if (validPreferences.includes(responseValue)) {
      context.preferenceData.queuePreference = responseValue;
      preferenceService.updateUserContext(whatsappId, context);

      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Queue preference: *${responseValue}*`
      );

      await this.completePreferenceSetup(whatsappId, context);
    } else {
      await whatsappService.sendTextMessage(
        whatsappId,
        '❓ Please select a valid queue preference from the options above.'
      );
    }
  }

  /**
   * Complete preference setup
   */
  private async completePreferenceSetup(whatsappId: string, context: UserContext): Promise<void> {
    try {
      // Save preferences to database
      const updatedUser = await preferenceService.savePreferences(whatsappId);
      
      if (!updatedUser) {
        await whatsappService.sendTextMessage(
          whatsappId,
          '❌ Failed to save preferences. Please try again.'
        );
        return;
      }

      // Show summary
      const { evModel, connectorType, chargingIntent, queuePreference } = context.preferenceData;
      
      const summaryText = `🎉 *Preferences Saved Successfully!*\n\n` +
        `📋 *Your Setup:*\n` +
        `🚗 EV Model: ${evModel || 'Not specified'}\n` +
        `🔌 Connector: ${connectorType}\n` +
        `⚡ Charging Style: ${chargingIntent}\n` +
        `🚶‍♂️ Queue Preference: ${queuePreference}\n\n` +
        `✅ You're all set! Now let's find you a charging station.`;

      await whatsappService.sendTextMessage(whatsappId, summaryText);

      // Automatically proceed to location request
      setTimeout(async () => {
        await this.requestLocation(whatsappId, context.isOnboarding);
      }, 2000);

    } catch (error) {
      logger.error('Failed to complete preference setup', { whatsappId, error });
      await whatsappService.sendTextMessage(
        whatsappId,
        '❌ Something went wrong saving your preferences. Please try again.'
      );
    }
  }

  /**
   * Request location after preferences - FIXED BUTTON TITLES
   */
  private async requestLocation(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const locationText = isOnboarding 
      ? '📍 *Let\'s Find Charging Stations Near You!*\n\nShare your location to see nearby charging stations:'
      : '📍 *Ready to Find Stations!*\n\nShare your current location:';

    await whatsappService.sendButtonMessage(
      whatsappId,
      `${locationText}\n\n🎯 Tap "Share Location" below or use the 📎 attachment menu to send your location.\n\nYou can also type an address if you prefer!`,
      [
        { id: 'location_help', title: '❓ How to Share' }, // Fixed: 15 chars
        { id: 'type_address', title: '⌨️ Type Address' }, // Fixed: 15 chars
      ],
      '📍 Location'
    );
  }

  /**
   * Show location sharing help
   */
  async showLocationHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📍 *How to Share Your Location:*\n\n' +
      '1️⃣ Tap the 📎 *attachment* icon (next to message input)\n' +
      '2️⃣ Select *Location* from the menu\n' +
      '3️⃣ Choose *Send your current location*\n' +
      '4️⃣ Tap *Send*\n\n' +
      '🔒 *Privacy:* Your location is only used to find nearby charging stations and is not stored permanently.\n\n' +
      'Alternatively, you can type your address manually!'
    );
  }

  /**
   * Handle address input request
   */
  async requestAddressInput(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🗺️ *Type Your Address*\n\n' +
      'Please enter your current location or destination:\n\n' +
      '*Examples:*\n' +
      '• Anna Nagar Chennai\n' +
      '• RS Puram Coimbatore\n' +
      '• T Nagar Chennai\n' +
      '• Gandhipuram Coimbatore\n\n' +
      'Just type the address and I\'ll find charging stations nearby!'
    );

    // Set a flag to handle address input
    preferenceService.updateUserContext(whatsappId, {
      ...preferenceService.getUserContext(whatsappId)!,
      currentStep: 'completed',
    });
  }
}

export const preferenceController = new PreferenceController();