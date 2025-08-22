// src/controllers/preference.ts - OPTIMIZED WHATSAPP PREFERENCE CONTROLLER
import { whatsappService } from '../services/whatsapp';
import { preferenceService, type UserContext } from '../services/preference';
import { userService } from '../services/user';
import { logger } from '../utils/logger';

// Streamlined types that work with existing UserContext
interface PreferenceData {
  vehicleType?: 'Car' | 'Bike/Scooter' | 'Any';
  evModel?: string;
  connectorType?: string; // Keep as string to match UserContext
  chargingIntent?: string; // Keep as string to match UserContext
  queuePreference?: string; // Keep as string to match UserContext
}

type PreferenceStep = 'vehicle_type' | 'ev_model' | 'connector_type' | 'charging_intent' | 'queue_preference' | 'address_input' | 'completed';

// Use composition instead of inheritance to avoid type conflicts
interface OptimizedUserContext {
  isOnboarding: boolean;
  whatsappId: string;
  preferenceData: PreferenceData;
  currentStep: PreferenceStep;
}

export class OptimizedPreferenceController {
  // Configuration objects for cleaner code
  private readonly STEPS = {
    VEHICLE_TYPE: 'vehicle_type' as const,
    EV_MODEL: 'ev_model' as const,
    CONNECTOR_TYPE: 'connector_type' as const,
    CHARGING_INTENT: 'charging_intent' as const,
    QUEUE_PREFERENCE: 'queue_preference' as const,
    ADDRESS_INPUT: 'address_input' as const,
    COMPLETED: 'completed' as const
  };

  private readonly VEHICLE_TYPES = {
    CARS: { id: 'ev_cars', title: '🚗 Electric Cars', value: 'Car' as const },
    BIKES: { id: 'ev_bikes', title: '🛵 Bikes/Scooters', value: 'Bike/Scooter' as const },
    SKIP: { id: 'skip_type', title: '⏭️ Skip', value: 'Any' as const }
  };

  private readonly CAR_MODELS = {
    INDIAN: [
      { id: 'Tata Nexon EV', title: 'Nexon EV', desc: 'Compact SUV - Most popular' },
      { id: 'Tata Tigor EV', title: 'Tigor EV', desc: 'Sedan - Affordable' },
      { id: 'Tata Punch EV', title: 'Punch EV', desc: 'Micro SUV - Latest' },
      { id: 'MG ZS EV', title: 'MG ZS EV', desc: 'Premium SUV' }
    ],
    LUXURY: [
      { id: 'Tesla Model 3', title: 'Model 3', desc: 'Most popular Tesla' },
      { id: 'Tesla Model S', title: 'Model S', desc: 'Luxury sedan' },
      { id: 'Audi e-tron', title: 'Audi e-tron', desc: 'Luxury SUV' },
      { id: 'BMW iX', title: 'BMW iX', desc: 'Premium SUV' }
    ]
  };

  private readonly BIKE_MODELS = [
    { id: 'Ather 450X', title: 'Ather 450X', desc: 'Premium smart scooter' },
    { id: 'Ola S1 Pro', title: 'Ola S1 Pro', desc: 'High-performance scooter' },
    { id: 'TVS iQube', title: 'TVS iQube', desc: 'Connected scooter' },
    { id: 'Bajaj Chetak', title: 'Bajaj Chetak', desc: 'Classic electric scooter' }
  ];

  /**
   * Main entry point - Start preference gathering
   */
  async startPreferenceGathering(whatsappId: string, isOnboarding = false): Promise<void> {
    try {
      await preferenceService.startPreferenceFlow(whatsappId, isOnboarding);
      await this.initializeContext(whatsappId, isOnboarding);
      await this.showStep(whatsappId, this.STEPS.VEHICLE_TYPE, { isOnboarding });
    } catch (error) {
      logger.error('Failed to start preference gathering', { whatsappId, error });
      await this.sendError(whatsappId, 'Sorry, something went wrong. Please try again with "hi".');
    }
  }

  /**
   * Universal response handler
   */
  async handlePreferenceResponse(whatsappId: string, responseType: 'button' | 'text' | 'list', responseValue: string): Promise<void> {
    try {
      const context = this.getContext(whatsappId);
      if (!context) {
        await this.sendSessionExpired(whatsappId);
        return;
      }

      const handlers = {
        [this.STEPS.VEHICLE_TYPE]: () => this.handleVehicleType(whatsappId, responseValue, context),
        [this.STEPS.EV_MODEL]: () => this.handleEVModel(whatsappId, responseType, responseValue, context),
        [this.STEPS.CONNECTOR_TYPE]: () => this.handleConnectorType(whatsappId, responseValue, context),
        [this.STEPS.CHARGING_INTENT]: () => this.handleChargingIntent(whatsappId, responseValue, context),
        [this.STEPS.QUEUE_PREFERENCE]: () => this.handleQueuePreference(whatsappId, responseValue, context),
        [this.STEPS.ADDRESS_INPUT]: () => this.handleAddressInput(whatsappId, responseValue, context)
      };

      const handler = handlers[context.currentStep as keyof typeof handlers];
      if (handler) await handler();
      else logger.warn('Unknown preference step', { whatsappId, step: context.currentStep });

    } catch (error) {
      logger.error('Failed to handle preference response', { whatsappId, error });
      await this.sendError(whatsappId, 'Something went wrong. Type "hi" to restart.');
    }
  }

  /**
   * Dynamic step display system
   */
  private async showStep(whatsappId: string, step: PreferenceStep, options: any = {}): Promise<void> {
    const stepHandlers = {
      [this.STEPS.VEHICLE_TYPE]: () => this.showVehicleTypeStep(whatsappId, options.isOnboarding),
      [this.STEPS.CONNECTOR_TYPE]: () => this.showConnectorTypeStep(whatsappId),
      [this.STEPS.CHARGING_INTENT]: () => this.showChargingIntentStep(whatsappId),
      [this.STEPS.QUEUE_PREFERENCE]: () => this.showQueuePreferenceStep(whatsappId)
    };

    const handler = stepHandlers[step as keyof typeof stepHandlers];
    if (handler) await handler();
  }

  /**
   * Step 1: Vehicle Type Selection
   */
  private async showVehicleTypeStep(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const welcomeText = isOnboarding 
      ? "🎉 Welcome to SharaSpot! Let's set up your charging preferences! 🚗⚡"
      : "🔄 Let's update your charging preferences!";

    await whatsappService.sendButtonMessage(
      whatsappId,
      `${welcomeText}\n\n*Step 1/5: What type of electric vehicle do you have?*\n\n🚗 Cars - 4-wheelers (Tesla, Tata, etc.)\n🛵 Bikes/Scooters - 2-wheelers (Ather, Ola, etc.)`,
      [
        { id: this.VEHICLE_TYPES.CARS.id, title: this.VEHICLE_TYPES.CARS.title },
        { id: this.VEHICLE_TYPES.BIKES.id, title: this.VEHICLE_TYPES.BIKES.title },
        { id: this.VEHICLE_TYPES.SKIP.id, title: this.VEHICLE_TYPES.SKIP.title }
      ],
      '🚗 Vehicle Type'
    );
  }

  /**
   * Vehicle type response handler
   */
  private async handleVehicleType(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const typeMap = {
      [this.VEHICLE_TYPES.CARS.id]: this.VEHICLE_TYPES.CARS.value,
      [this.VEHICLE_TYPES.BIKES.id]: this.VEHICLE_TYPES.BIKES.value,
      [this.VEHICLE_TYPES.SKIP.id]: this.VEHICLE_TYPES.SKIP.value
    };

    const vehicleType = typeMap[responseValue as keyof typeof typeMap];
    if (!vehicleType) return;

    context.preferenceData.vehicleType = vehicleType;
    await this.sendConfirmation(whatsappId, `Vehicle type: *${vehicleType}*`);

    if (vehicleType === 'Any') {
      await this.moveToStep(whatsappId, context, this.STEPS.CONNECTOR_TYPE);
    } else {
      await this.moveToStep(whatsappId, context, this.STEPS.EV_MODEL);
      vehicleType === 'Car' ? await this.showCarModelsStep(whatsappId) : await this.showBikeModelsStep(whatsappId);
    }
  }

  /**
   * Car models display with categories
   */
  private async showCarModelsStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 2/5: Choose Your Car Model* 🚗\n\nSelect a category or type your model:',
      [
        { id: 'indian_cars', title: '🇮🇳 Indian Cars' },
        { id: 'luxury_cars', title: '✨ Luxury Cars' },
        { id: 'type_custom', title: '⌨️ Type Model' }
      ],
      '🚗 Car Models'
    );
  }

  /**
   * Bike models display
   */
  private async showBikeModelsStep(whatsappId: string): Promise<void> {
    const rows = [
      ...this.BIKE_MODELS.map(bike => ({ 
        id: bike.id, 
        title: bike.title, 
        description: bike.desc 
      })),
      { id: 'type_custom', title: '⌨️ Type Model', description: 'Enter manually' },
      { id: 'skip_model', title: '⏭️ Skip', description: 'Set up later' }
    ];

    await whatsappService.sendListMessage(
      whatsappId,
      '*Step 2/5: Choose Your Bike/Scooter* 🛵',
      'Select Model',
      [{ title: '🛵 Electric Two-Wheelers', rows }],
      '🛵 Models'
    );
  }

  /**
   * Show car model categories
   */
  async showCarCategory(whatsappId: string, category: 'indian' | 'luxury'): Promise<void> {
    const models = category === 'indian' ? this.CAR_MODELS.INDIAN : this.CAR_MODELS.LUXURY;
    const title = category === 'indian' ? '*Indian Electric Cars* 🇮🇳' : '*Luxury Electric Cars* ✨';
    
    const rows = [
      ...models.map(car => ({ id: car.id, title: car.title, description: car.desc })),
      { id: 'type_custom', title: '⌨️ Type Model', description: 'Enter manually' }
    ];

    await whatsappService.sendListMessage(whatsappId, title, 'Select Car', [{ title: 'Models', rows }]);
  }

  /**
   * EV model response handler
   */
  private async handleEVModel(whatsappId: string, responseType: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    // Handle category navigation
    const categoryHandlers = {
      'indian_cars': async () => { await this.showCarCategory(whatsappId, 'indian'); },
      'luxury_cars': async () => { await this.showCarCategory(whatsappId, 'luxury'); },
      'type_custom': async () => { await this.requestCustomModel(whatsappId); },
      'skip_model': async () => { await this.setModel(whatsappId, context, 'Not specified'); }
    };

    const handler = categoryHandlers[responseValue as keyof typeof categoryHandlers];
    if (handler) {
      await handler();
      return;
    }

    // Handle model selection
    if (responseType === 'list' || responseType === 'text') {
      const model = responseValue.trim();
      if (model.length > 2) {
        await this.setModel(whatsappId, context, model);
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid vehicle model.');
      }
    }
  }

  /**
   * Set model and proceed
   */
  private async setModel(whatsappId: string, context: OptimizedUserContext, model: string): Promise<void> {
    context.preferenceData.evModel = model;
    await this.sendConfirmation(whatsappId, `Your vehicle: *${model}*`);
    await this.moveToStep(whatsappId, context, this.STEPS.CONNECTOR_TYPE);
  }

  /**
   * Request custom model input
   */
  private async requestCustomModel(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '⌨️ *Type Your Vehicle Model*\n\nExamples: Tesla Model 3, Ather 450X, Tata Nexon EV\n\nJust type the name:'
    );
  }

  /**
   * Connector type step
   */
  private async showConnectorTypeStep(whatsappId: string): Promise<void> {
    const context = this.getContext(whatsappId);
    const isBike = context?.preferenceData.vehicleType === 'Bike/Scooter';
    
    const buttons = isBike 
      ? [
          { id: 'Standard', title: '🔌 Standard' },
          { id: 'Fast Charge', title: '⚡ Fast Charge' },
          { id: 'Any', title: '🔀 Any Type' }
        ]
      : [
          { id: 'CCS2', title: '🔌 CCS2' },
          { id: 'Type2', title: '🔌 Type2' },
          { id: 'CHAdeMO', title: '🔌 CHAdeMO' }
        ];

    await whatsappService.sendButtonMessage(
      whatsappId,
      `*Step 3/5: Charging Port Type* 🔌\n\n${isBike ? 'For bikes/scooters:' : 'What connector does your car use?'}`,
      buttons,
      '🔌 Charging Port'
    );

    // Send "Any" option for cars separately to avoid button limit
    if (!isBike) {
      setTimeout(async () => {
        await whatsappService.sendButtonMessage(whatsappId, 'Not sure?', [{ id: 'Any', title: '🔀 Any Type' }]);
      }, 1500);
    }
  }

  /**
   * Connector type handler
   */
  private async handleConnectorType(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validConnectors = ['CCS2', 'Type2', 'CHAdeMO', 'Standard', 'Fast Charge', 'Any'];
    
    if (validConnectors.includes(responseValue)) {
      context.preferenceData.connectorType = responseValue;
      await this.sendConfirmation(whatsappId, `Connector: *${responseValue}*`);
      await this.moveToStep(whatsappId, context, this.STEPS.CHARGING_INTENT);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a connector type from the options above.');
    }
  }

  /**
   * Charging intent step
   */
  private async showChargingIntentStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 4/5: How do you prefer to charge?* ⚡\n\n⚡ *Quick* - Fast top-up (15-30 min)\n🔋 *Full* - Complete charge (1-3 hrs)\n🚨 *Emergency* - Only when battery low',
      [
        { id: 'Quick Top-up', title: '⚡ Quick' },
        { id: 'Full Charge', title: '🔋 Full' },
        { id: 'Emergency', title: '🚨 Emergency' }
      ],
      '⚡ Charging Style'
    );
  }

  /**
   * Charging intent handler
   */
  private async handleChargingIntent(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validIntents = ['Quick Top-up', 'Full Charge', 'Emergency'];
    
    if (validIntents.includes(responseValue)) {
      context.preferenceData.chargingIntent = responseValue;
      await this.sendConfirmation(whatsappId, `Charging style: *${responseValue}*`);
      await this.moveToStep(whatsappId, context, this.STEPS.QUEUE_PREFERENCE);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a charging style from the options above.');
    }
  }

  /**
   * Queue preference step
   */
  private async showQueuePreferenceStep(whatsappId: string): Promise<void> {
    await whatsappService.sendButtonMessage(
      whatsappId,
      '*Step 5/5: Queue Preferences* 🚶‍♂️\n\nHow long are you willing to wait if a station is busy?\n\n🟢 *Free Now* - Only available stations\n🟡 *Wait 15m* - Up to 15 minutes\n🟠 *Wait 30m* - Up to 30 minutes',
      [
        { id: 'Free Now', title: '🟢 Free Now' },
        { id: 'Wait 15m', title: '🟡 Wait 15m' },
        { id: 'Wait 30m', title: '🟠 Wait 30m' }
      ],
      '🚶‍♂️ Queue Preference'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(whatsappId, 'Or if flexible:', [{ id: 'Any Queue', title: '🔀 Any Queue' }]);
    }, 1500);
  }

  /**
   * Queue preference handler
   */
  private async handleQueuePreference(whatsappId: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    const validPreferences = ['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'];
    
    if (validPreferences.includes(responseValue)) {
      context.preferenceData.queuePreference = responseValue;
      await this.sendConfirmation(whatsappId, `Queue preference: *${responseValue}*`);
      await this.completePreferenceSetup(whatsappId, context);
    } else {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a queue preference from the options above.');
    }
  }

  /**
   * Complete preference setup
   */
  private async completePreferenceSetup(whatsappId: string, context: OptimizedUserContext): Promise<void> {
    try {
      // Save preferences with proper type conversion
      const standardContext = this.convertToStandardContext(context);
      this.updateContext(whatsappId, standardContext);
      const updatedUser = await preferenceService.savePreferences(whatsappId);
      
      if (!updatedUser) {
        await this.sendError(whatsappId, 'Failed to save preferences. Please try again.');
        return;
      }

      // Send beautiful summary
      await whatsappService.sendTextMessage(whatsappId, this.createSummaryCard(context.preferenceData));

      // Auto-proceed to location
      setTimeout(() => this.requestLocationWithOptions(whatsappId, context.isOnboarding), 2500);

    } catch (error) {
      logger.error('Failed to complete preference setup', { whatsappId, error });
      await this.sendError(whatsappId, 'Something went wrong saving preferences. Please try again.');
    }
  }

  /**
   * Simplified location request (removed popular areas)
   */
  private async requestLocationWithOptions(whatsappId: string, isOnboarding: boolean): Promise<void> {
    const locationText = isOnboarding ? '📍 *Let\'s Find Charging Stations!*' : '📍 *Ready to Find Stations!*';

    await whatsappService.sendTextMessage(
      whatsappId,
      `${locationText}\n\n🎯 *Choose how to share your location:*\n\n📱 *GPS Location* - Most accurate\n🗺️ *Type Address* - Manual entry`
    );

    await whatsappService.sendButtonMessage(
      whatsappId,
      'How would you like to share your location?',
      [
        { id: 'gps_location', title: '📱 Share GPS' },
        { id: 'type_address', title: '🗺️ Type Address' }
      ],
      '📍 Location Options'
    );
  }

  /**
   * Handle location button presses (simplified)
   */
  async handleLocationButtonPress(whatsappId: string, buttonId: string): Promise<void> {
    try {
      const handlers = {
        'gps_location': async () => { await this.showLocationHelp(whatsappId); },
        'type_address': async () => { await this.requestAddressInput(whatsappId); },
        'indian_cars': async () => { await this.showCarCategory(whatsappId, 'indian'); },
        'luxury_cars': async () => { await this.showCarCategory(whatsappId, 'luxury'); }
      };

      const handler = handlers[buttonId as keyof typeof handlers];
      if (handler) {
        await handler();
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Sorry, I didn\'t understand that option. Please try again.');
      }
    } catch (error) {
      logger.error('Error handling button press', { whatsappId, buttonId, error });
      await this.sendError(whatsappId, 'Something went wrong. Please try again.');
    }
  }

  /**
   * Show simplified location help
   */
  private async showLocationHelp(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '📍 *How to Share GPS Location:*\n\n' +
      '🔹 *iPhone:* + button → Location → Share Current\n' +
      '🔹 *Android:* 📎 → Location → Send current\n\n' +
      '🔒 Location used only for finding nearby stations'
    );

    setTimeout(async () => {
      await whatsappService.sendButtonMessage(
        whatsappId,
        'Or choose alternative:',
        [{ id: 'type_address', title: '🗺️ Type Address' }]
      );
    }, 2000);
  }

  /**
   * Request address input
   */
  private async requestAddressInput(whatsappId: string): Promise<void> {
    await whatsappService.sendTextMessage(
      whatsappId,
      '🗺️ *Type Your Location* 📍\n\n' +
      'Examples: Anna Nagar Chennai, RS Puram Coimbatore, Phoenix Mall\n\n' +
      '👇 Just type your address:'
    );

    const context = this.getContext(whatsappId);
    if (context) {
      context.currentStep = this.STEPS.ADDRESS_INPUT;
      this.updateContext(whatsappId, context);
    }
  }

  /**
   * Handle address input
   */
  private async handleAddressInput(whatsappId: string, address: string, context: OptimizedUserContext): Promise<void> {
    if (address.trim().length < 3) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please provide a more detailed address.');
      return;
    }

    await whatsappService.sendTextMessage(
      whatsappId,
      `📍 Got it! Searching near: *${address.trim()}*\n\n🔍 Please wait...`
    );

    context.currentStep = this.STEPS.COMPLETED;
    this.updateContext(whatsappId, context);
    logger.info('Address input received', { whatsappId, address: address.trim() });
  }

  /**
   * Utility Methods
   */
  
  private async initializeContext(whatsappId: string, isOnboarding: boolean): Promise<void> {
    // Create internal context
    const context: OptimizedUserContext = {
      isOnboarding,
      whatsappId,
      currentStep: this.STEPS.VEHICLE_TYPE,
      preferenceData: {}
    };
    
    // Store in memory (internal tracking)
    this.contexts.set(whatsappId, context);
  }

  private async moveToStep(whatsappId: string, context: OptimizedUserContext, step: PreferenceStep): Promise<void> {
    context.currentStep = step;
    this.updateContext(whatsappId, context);
    await this.showStep(whatsappId, step);
  }

  // Internal context storage
  private contexts = new Map<string, OptimizedUserContext>();

  private getContext(whatsappId: string): OptimizedUserContext | null {
    return this.contexts.get(whatsappId) || null;
  }

    private updateContext(whatsappId: string, context: OptimizedUserContext): void {
    // Store internally
    this.contexts.set(whatsappId, context);
    
    // Convert and update in preferenceService
    const compatibleContext = this.convertToStandardContext(context);
    preferenceService.updateUserContext(whatsappId, compatibleContext);
  }
  
  private convertToStandardContext(context: OptimizedUserContext): UserContext {
    return {
      whatsappId: context.whatsappId, // Add the missing whatsappId field
      isOnboarding: context.isOnboarding,
      currentStep: context.currentStep === 'vehicle_type' ? 'ev_model' : 
                  context.currentStep === 'address_input' ? 'completed' :
                  context.currentStep as UserContext['currentStep'],
      preferenceData: {
        evModel: context.preferenceData.evModel,
        connectorType: context.preferenceData.connectorType,
        chargingIntent: context.preferenceData.chargingIntent,
        queuePreference: context.preferenceData.queuePreference
      }
    };
  }

  private createSummaryCard(data: PreferenceData): string {
    return `🎉 *Setup Complete!* 🎉\n\n` +
      `╭─ 📋 *Your Profile* ─╮\n` +
      `│ 🚗 Type: ${data.vehicleType || 'Any'}\n` +
      `│ 🏷️ Model: ${data.evModel || 'Not specified'}\n` +
      `│ 🔌 Connector: ${data.connectorType || 'Any'}\n` +
      `│ ⚡ Style: ${data.chargingIntent || 'Any'}\n` +
      `│ 🚶‍♂️ Queue: ${data.queuePreference || 'Flexible'}\n` +
      `╰────────────────────╯\n\n` +
      `✅ Perfect! Now let's find charging stations near you.`;
  }

  private async sendConfirmation(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `✅ ${message}`);
  }

  private async sendError(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
  }

  private async sendSessionExpired(whatsappId: string): Promise<void> {
    logger.warn('No preference context found', { whatsappId });
    await whatsappService.sendTextMessage(whatsappId, '⚠️ Session expired. Please start again with "hi".');
  }

  /**
   * Public API Methods
   */

  /**
   * Show preference summary
   */
  async showPreferenceSummary(whatsappId: string): Promise<void> {
    try {
      const context = this.getContext(whatsappId);
      if (!context?.preferenceData) {
        await whatsappService.sendTextMessage(whatsappId, '❓ No preferences found. Type "hi" to set up.');
        return;
      }

      const summaryCard = this.createSummaryCard(context.preferenceData);
      await whatsappService.sendTextMessage(
        whatsappId,
        `📋 *Your Current Preferences:*\n\n${summaryCard}\n\n💡 Type "settings" to update.`
      );
    } catch (error) {
      logger.error('Error showing preference summary', { whatsappId, error });
      await this.sendError(whatsappId, 'Unable to show preferences. Please try again.');
    }
  }

  /**
   * Reset user preferences
   */
  async resetPreferences(whatsappId: string): Promise<void> {
    try {
      // Clear internal context
      this.contexts.delete(whatsappId);
      
      // Clear service context
      preferenceService.updateUserContext(whatsappId, {
        isOnboarding: false,
        currentStep: 'completed',
        preferenceData: {}
      });

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔄 *Preferences Reset*\n\nYour preferences have been cleared. Type "hi" to set them up again.'
      );
    } catch (error) {
      logger.error('Error resetting preferences', { whatsappId, error });
      await this.sendError(whatsappId, 'Unable to reset preferences. Please try again.');
    }
  }

  /**
   * Quick preference update
   */
  async quickUpdatePreference(whatsappId: string, field: keyof PreferenceData, value: string): Promise<void> {
    try {
      const context = this.getContext(whatsappId);
      if (!context) {
        await whatsappService.sendTextMessage(whatsappId, '❓ No preferences found. Please set up first.');
        return;
      }

      // Type-safe field update
      (context.preferenceData as any)[field] = value;
      this.updateContext(whatsappId, context);
      await preferenceService.savePreferences(whatsappId);

      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Updated ${field}: *${value}*\n\nType "profile" to see all preferences.`
      );
    } catch (error) {
      logger.error('Error updating preference', { whatsappId, field, value, error });
      await this.sendError(whatsappId, 'Unable to update preference. Please try again.');
    }
  }

  /**
   * Validate preference data
   */
  validatePreferenceData(data: PreferenceData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    const validations = [
      { field: 'vehicleType', valid: !data.vehicleType || ['Car', 'Bike/Scooter', 'Any'].includes(data.vehicleType) },
      { field: 'connectorType', valid: !data.connectorType || ['CCS2', 'Type2', 'CHAdeMO', 'Standard', 'Fast Charge', 'Any'].includes(data.connectorType) },
      { field: 'chargingIntent', valid: !data.chargingIntent || ['Quick Top-up', 'Full Charge', 'Emergency'].includes(data.chargingIntent) },
      { field: 'queuePreference', valid: !data.queuePreference || ['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'].includes(data.queuePreference) }
    ];

    validations.forEach(({ field, valid }) => {
      if (!valid) errors.push(`Invalid ${field}`);
    });

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Check if user has completed preferences
   */
  hasCompletedPreferences(whatsappId: string): boolean {
    try {
      const context = this.getContext(whatsappId);
      return context?.currentStep === this.STEPS.COMPLETED && 
             !!(context?.preferenceData?.evModel && 
                context?.preferenceData?.connectorType && 
                context?.preferenceData?.chargingIntent);
    } catch (error) {
      logger.error('Error checking preference completion', { whatsappId, error });
      return false;
    }
  }

  /**
   * Get current step for debugging
   */
  getCurrentStep(whatsappId: string): PreferenceStep | null {
    try {
      return this.getContext(whatsappId)?.currentStep || null;
    } catch (error) {
      logger.error('Error getting current step', { whatsappId, error });
      return null;
    }
  }

  /**
   * Export/Import methods for backup
   */
  async exportPreferences(whatsappId: string): Promise<PreferenceData | null> {
    try {
      return this.getContext(whatsappId)?.preferenceData || null;
    } catch (error) {
      logger.error('Error exporting preferences', { whatsappId, error });
      return null;
    }
  }

  async importPreferences(whatsappId: string, data: PreferenceData): Promise<boolean> {
    try {
      const validation = this.validatePreferenceData(data);
      if (!validation.isValid) {
        logger.warn('Invalid preference data for import', { whatsappId, errors: validation.errors });
        return false;
      }

      const context = this.getContext(whatsappId);
      if (context) {
        context.preferenceData = data;
        this.updateContext(whatsappId, context);
        await preferenceService.savePreferences(whatsappId);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error importing preferences', { whatsappId, error });
      return false;
    }
  }

  /**
   * Clean up contexts (call this periodically to prevent memory leaks)
   */
  cleanupContexts(): void {
    // Remove contexts older than 1 hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [whatsappId, context] of this.contexts.entries()) {
      // You could add a timestamp to contexts and clean based on that
      // For now, just keep a reasonable size limit
      if (this.contexts.size > 1000) {
        this.contexts.delete(whatsappId);
        break;
      }
    }
  }

  /**
   * Get all active contexts count (for monitoring)
   */
  getActiveContextsCount(): number {
    return this.contexts.size;
  }
}

// Export instances
export const optimizedPreferenceController = new OptimizedPreferenceController();

// Backward compatibility
export const enhancedPreferenceController = optimizedPreferenceController;
export const preferenceController = optimizedPreferenceController;