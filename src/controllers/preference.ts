// src/controllers/preference.ts - OPTIMIZED WHATSAPP PREFERENCE CONTROLLER
import { whatsappService } from '../services/whatsapp';
import { preferenceService, type UserContext } from '../services/preference';
import { userService } from '../services/userService';
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
  timestamp: number; // Add timestamp for context cleanup
}

export class PreferenceController {
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

  // Internal context storage with cleanup mechanism
  private contexts = new Map<string, OptimizedUserContext>();
  private lastCleanup = Date.now();
  
  /**
   * Infer vehicle type from model name
   * Helper method to determine vehicle type when retrieving from user service
   */
  private inferVehicleTypeFromModel(evModel?: string): PreferenceData['vehicleType'] {
    if (!evModel) return 'Any';
    
    const bikeModels = this.BIKE_MODELS.map(b => b.id.toLowerCase());
    const carModels = [
      ...this.CAR_MODELS.INDIAN.map(c => c.id.toLowerCase()),
      ...this.CAR_MODELS.LUXURY.map(c => c.id.toLowerCase())
    ];
    
    const modelLower = evModel.toLowerCase();
    
    if (bikeModels.some(bike => modelLower.includes(bike.toLowerCase()))) {
      return 'Bike/Scooter';
    }
    
    if (carModels.some(car => modelLower.includes(car.toLowerCase()))) {
      return 'Car';
    }
    
    // Default to Car for unknown models (more common)
    return 'Car';
  }

  /**
   * Main entry point - Start preference gathering
   */
  async startPreferenceGathering(whatsappId: string, isOnboarding = false): Promise<void> {
    try {
      // Clean up old contexts periodically
      this.maybeCleanupContexts();
      
      // Start preference flow in service
      await preferenceService.startPreferenceFlow(whatsappId, isOnboarding);
      
      // Initialize local context
      await this.initializeContext(whatsappId, isOnboarding);
      
      // Show first step
      await this.showStep(whatsappId, this.STEPS.VEHICLE_TYPE, { isOnboarding });
    } catch (error) {
      logger.error('Failed to start preference gathering', { whatsappId, error: this.formatError(error) });
      await this.sendError(whatsappId, 'Sorry, something went wrong. Please try again with "hi".');
    }
  }

  /**
   * Universal response handler with improved error handling
   */
  async handlePreferenceResponse(whatsappId: string, responseType: 'button' | 'text' | 'list', responseValue: string): Promise<void> {
    try {
      // Validate context
      const context = this.getValidatedContext(whatsappId);
      if (!context) {
        await this.sendSessionExpired(whatsappId);
        return;
      }

      // Handle response based on current step
      switch (context.currentStep) {
        case this.STEPS.VEHICLE_TYPE:
          await this.handleVehicleType(whatsappId, responseValue, context);
          break;
        case this.STEPS.EV_MODEL:
          await this.handleEVModel(whatsappId, responseType, responseValue, context);
          break;
        case this.STEPS.CONNECTOR_TYPE:
          await this.handleConnectorType(whatsappId, responseValue, context);
          break;
        case this.STEPS.CHARGING_INTENT:
          await this.handleChargingIntent(whatsappId, responseValue, context);
          break;
        case this.STEPS.QUEUE_PREFERENCE:
          await this.handleQueuePreference(whatsappId, responseValue, context);
          break;
        case this.STEPS.ADDRESS_INPUT:
          await this.handleAddressInput(whatsappId, responseValue, context);
          break;
        default:
          logger.warn('Unknown preference step', { whatsappId, step: context.currentStep });
          await whatsappService.sendTextMessage(whatsappId, '❓ Not sure what you mean. Type "help" for assistance.');
      }
    } catch (error) {
      logger.error('Failed to handle preference response', { whatsappId, responseValue, error: this.formatError(error) });
      await this.sendError(whatsappId, 'Something went wrong. Type "hi" to restart.');
    }
  }

  /**
   * Dynamic step display system
   */
  private async showStep(whatsappId: string, step: PreferenceStep, options: any = {}): Promise<void> {
    switch (step) {
      case this.STEPS.VEHICLE_TYPE:
        await this.showVehicleTypeStep(whatsappId, options.isOnboarding);
        break;
      case this.STEPS.EV_MODEL:
        // EV model step is shown by vehicle type handler
        break;
      case this.STEPS.CONNECTOR_TYPE:
        await this.showConnectorTypeStep(whatsappId);
        break;
      case this.STEPS.CHARGING_INTENT:
        await this.showChargingIntentStep(whatsappId);
        break;
      case this.STEPS.QUEUE_PREFERENCE:
        await this.showQueuePreferenceStep(whatsappId);
        break;
      default:
        logger.warn('Attempted to show unknown step', { whatsappId, step });
    }
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
    if (!vehicleType) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a vehicle type from the options above.');
      return;
    }

    // Update context
    context.preferenceData.vehicleType = vehicleType;
    this.updateContext(whatsappId, context);
    
    // Confirm selection
    await this.sendConfirmation(whatsappId, `Vehicle type: *${vehicleType}*`);

    // Move to next step
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
      { id: 'type_custom', title: '⌨️ Type Model', description: 'Enter manually' },
      { id: 'back_to_categories', title: '⬅️ Back', description: 'Return to categories' }
    ];

    await whatsappService.sendListMessage(whatsappId, title, 'Select Car', [{ title: 'Models', rows }]);
  }

  /**
   * EV model response handler with improved category navigation
   */
  private async handleEVModel(whatsappId: string, responseType: string, responseValue: string, context: OptimizedUserContext): Promise<void> {
    // Handle category navigation
    if (responseValue === 'indian_cars') {
      await this.showCarCategory(whatsappId, 'indian');
      return;
    } else if (responseValue === 'luxury_cars') {
      await this.showCarCategory(whatsappId, 'luxury'); 
      return;
    } else if (responseValue === 'type_custom') {
      await this.requestCustomModel(whatsappId);
      return;
    } else if (responseValue === 'skip_model') {
      await this.setModel(whatsappId, context, 'Not specified');
      return;
    } else if (responseValue === 'back_to_categories') {
      await this.showCarModelsStep(whatsappId);
      return;
    }

    // Handle model selection (from list or text input)
    if (responseType === 'list' || responseType === 'text') {
      const model = responseValue.trim();
      if (model.length > 2) {
        await this.setModel(whatsappId, context, model);
      } else {
        await whatsappService.sendTextMessage(whatsappId, '❓ Please provide a valid vehicle model (at least 3 characters).');
      }
    }
  }

  /**
   * Set model and proceed
   */
  /**
   * Set model and proceed
   */
  private async setModel(whatsappId: string, context: OptimizedUserContext, model: string): Promise<void> {
    context.preferenceData.evModel = model;
    this.updateContext(whatsappId, context);
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
    const context = this.getValidatedContext(whatsappId);
    if (!context) return;
    
    const isBike = context.preferenceData.vehicleType === 'Bike/Scooter';
    
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
    
    if (!validConnectors.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a connector type from the options above.');
      return;
    }
    
    context.preferenceData.connectorType = responseValue;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Connector: *${responseValue}*`);
    await this.moveToStep(whatsappId, context, this.STEPS.CHARGING_INTENT);
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
    
    if (!validIntents.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a charging style from the options above.');
      return;
    }
    
    context.preferenceData.chargingIntent = responseValue;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Charging style: *${responseValue}*`);
    await this.moveToStep(whatsappId, context, this.STEPS.QUEUE_PREFERENCE);
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
    
    if (!validPreferences.includes(responseValue)) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please select a queue preference from the options above.');
      return;
    }
    
    context.preferenceData.queuePreference = responseValue;
    this.updateContext(whatsappId, context);
    await this.sendConfirmation(whatsappId, `Queue preference: *${responseValue}*`);
    await this.completePreferenceSetup(whatsappId, context);
  }

  /**
   * Complete preference setup with validation
   */
  private async completePreferenceSetup(whatsappId: string, context: OptimizedUserContext): Promise<void> {
    try {
      // Validate preferences before saving
      const validation = this.validatePreferenceData(context.preferenceData);
      if (!validation.isValid) {
        logger.warn('Invalid preference data', { whatsappId, errors: validation.errors });
        await this.sendError(whatsappId, `Unable to save preferences: ${validation.errors.join(', ')}. Please try again.`);
        return;
      }
      
      // Update context step to completed
      context.currentStep = this.STEPS.COMPLETED;
      this.updateContext(whatsappId, context);
      
      // Save preferences to service
      const updatedUser = await preferenceService.savePreferences(whatsappId);
      
      if (!updatedUser) {
        await this.sendError(whatsappId, 'Failed to save preferences. Please try again.');
        return;
      }

      // Send beautiful summary
      await whatsappService.sendTextMessage(whatsappId, this.createSummaryCard(context.preferenceData));

      // Auto-proceed to location
      setTimeout(() => this.requestLocationWithOptions(whatsappId, context.isOnboarding), 2000);

    } catch (error) {
      logger.error('Failed to complete preference setup', { whatsappId, error: this.formatError(error) });
      await this.sendError(whatsappId, 'Something went wrong saving preferences. Please try again.');
    }
  }

  /**
   * Location request with options
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
   * Handle location button presses
   */
  async handleLocationButtonPress(whatsappId: string, buttonId: string): Promise<void> {
    try {
      const context = this.getValidatedContext(whatsappId);
      if (!context) {
        await this.sendSessionExpired(whatsappId);
        return;
      }

      switch (buttonId) {
        case 'gps_location':
          await this.showLocationHelp(whatsappId);
          break;
        case 'type_address':
          await this.requestAddressInput(whatsappId);
          break;
        case 'indian_cars':
          await this.showCarCategory(whatsappId, 'indian');
          break;
        case 'luxury_cars':
          await this.showCarCategory(whatsappId, 'luxury');
          break;
        default:
          await whatsappService.sendTextMessage(whatsappId, '❓ Sorry, I didn\'t understand that option. Please try again.');
      }
    } catch (error) {
      logger.error('Error handling button press', { whatsappId, buttonId, error: this.formatError(error) });
      await this.sendError(whatsappId, 'Something went wrong. Please try again.');
    }
  }

  /**
   * Show location help
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
    const context = this.getValidatedContext(whatsappId);
    if (!context) return;
    
    await whatsappService.sendTextMessage(
      whatsappId,
      '🗺️ *Type Your Location* 📍\n\n' +
      'Examples: Anna Nagar Chennai, RS Puram Coimbatore, Phoenix Mall\n\n' +
      '👇 Just type your address:'
    );

    context.currentStep = this.STEPS.ADDRESS_INPUT;
    this.updateContext(whatsappId, context);
  }

  /**
   * Handle address input
   */
  private async handleAddressInput(whatsappId: string, address: string, context: OptimizedUserContext): Promise<void> {
    if (address.trim().length < 3) {
      await whatsappService.sendTextMessage(whatsappId, '❓ Please provide a more detailed address (at least 3 characters).');
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
   * CONTEXT MANAGEMENT METHODS
   */
  
  /**
   * Initialize context with timestamp
   */
  private async initializeContext(whatsappId: string, isOnboarding: boolean): Promise<void> {
    // Create internal context
    const context: OptimizedUserContext = {
      isOnboarding,
      whatsappId,
      currentStep: this.STEPS.VEHICLE_TYPE,
      preferenceData: {},
      timestamp: Date.now()
    };
    
    // Store in memory (internal tracking)
    this.contexts.set(whatsappId, context);
  }

  /**
   * Move to next step
   */
  private async moveToStep(whatsappId: string, context: OptimizedUserContext, step: PreferenceStep): Promise<void> {
    context.currentStep = step;
    this.updateContext(whatsappId, context);
    await this.showStep(whatsappId, step);
  }

  /**
   * Get context with validation
   */
  private getValidatedContext(whatsappId: string): OptimizedUserContext | null {
    const context = this.contexts.get(whatsappId);
    
    if (!context) {
      logger.warn('No context found for user', { whatsappId });
      return null;
    }
    
    // Validate context has required fields
    if (!context.whatsappId || !context.currentStep) {
      logger.warn('Invalid context structure', { whatsappId, context });
      return null;
    }
    
    return context;
  }

  /**
   * Update context with safe type conversion
   */
  private updateContext(whatsappId: string, context: OptimizedUserContext): void {
    // Update timestamp
    context.timestamp = Date.now();
    
    // Store internally
    this.contexts.set(whatsappId, context);
    
    // Convert and update in preferenceService
    const serviceContext = this.convertToServiceContext(context);
    preferenceService.updateUserContext(whatsappId, serviceContext);
  }
  
  /**
   * Convert to format expected by preference service
   */
  private convertToServiceContext(context: OptimizedUserContext): UserContext {
    // Map our steps to service steps
    const stepMap: Record<PreferenceStep, UserContext['currentStep']> = {
      'vehicle_type': 'ev_model',
      'ev_model': 'ev_model',
      'connector_type': 'connector_type',
      'charging_intent': 'charging_intent', 
      'queue_preference': 'queue_preference',
      'address_input': 'completed',
      'completed': 'completed'
    };
    
    return {
      whatsappId: context.whatsappId,
      isOnboarding: context.isOnboarding,
      currentStep: stepMap[context.currentStep] || 'completed',
      preferenceData: {
        evModel: context.preferenceData.evModel || '',
        connectorType: context.preferenceData.connectorType || '',
        chargingIntent: context.preferenceData.chargingIntent || '',
        queuePreference: context.preferenceData.queuePreference || ''
      }
    };
  }

  /**
   * Create beautiful summary card for preferences
   */
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

  /**
   * Send confirmation message
   */
  private async sendConfirmation(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `✅ ${message}`);
  }

  /**
   * Send error message
   */
  private async sendError(whatsappId: string, message: string): Promise<void> {
    await whatsappService.sendTextMessage(whatsappId, `❌ ${message}`);
  }

  /**
   * Session expired notification
   */
  private async sendSessionExpired(whatsappId: string): Promise<void> {
    logger.warn('No preference context found', { whatsappId });
    await whatsappService.sendTextMessage(whatsappId, '⚠️ Session expired. Please start again with "hi".');
  }

  /**
   * Format error for logging
   */
  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.message} (${error.stack || 'no stack'})`;
    }
    return String(error);
  }

  /**
   * Clean up contexts to prevent memory leaks
   */
  private maybeCleanupContexts(): void {
    const now = Date.now();
    // Only clean up every 10 minutes
    if (now - this.lastCleanup < 10 * 60 * 1000) {
      return;
    }
    
    this.lastCleanup = now;
    const oneHourAgo = now - (60 * 60 * 1000);
    let cleanupCount = 0;
    
    for (const [whatsappId, context] of this.contexts.entries()) {
      // Remove contexts older than 1 hour
      if (context.timestamp < oneHourAgo) {
        this.contexts.delete(whatsappId);
        cleanupCount++;
      }
    }
    
    if (cleanupCount > 0) {
      logger.info(`Cleaned up ${cleanupCount} expired contexts`);
    }
  }

  /**
   * PUBLIC API METHODS
   */

  /**
   * Show preference summary with validation
   */
  async showPreferenceSummary(whatsappId: string): Promise<void> {
    try {
      // First try to get from internal context
      let context = this.getValidatedContext(whatsappId);
      
      // If not found, try to get from user service
      if (!context) {
        const user = await userService.getUserByWhatsAppId(whatsappId);
        if (user) {
          // Convert user preferences to our format
          context = {
            whatsappId,
            isOnboarding: false,
            currentStep: this.STEPS.COMPLETED,
            preferenceData: {
              evModel: user.evModel || undefined,
              connectorType: user.connectorType || undefined,
              chargingIntent: user.chargingIntent || undefined,
              queuePreference: user.queuePreference || undefined,
              vehicleType: this.inferVehicleTypeFromModel(user.evModel || undefined)
            },
            timestamp: Date.now()
          };
        }
      }
      
      if (!context?.preferenceData) {
        await whatsappService.sendTextMessage(whatsappId, '❓ No preferences found. Type "hi" to set up.');
        return;
      }

      // Validate the data
      const validation = this.validatePreferenceData(context.preferenceData);
      if (!validation.isValid) {
        logger.warn('Invalid preference data in summary', { whatsappId, errors: validation.errors });
      }

      const summaryCard = this.createSummaryCard(context.preferenceData);
      await whatsappService.sendTextMessage(
        whatsappId,
        `📋 *Your Current Preferences:*\n\n${summaryCard}\n\n💡 Type "settings" to update.`
      );
    } catch (error) {
      logger.error('Error showing preference summary', { whatsappId, error: this.formatError(error) });
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
      await preferenceService.updateUserContext(whatsappId, {
        whatsappId,
        isOnboarding: false,
        currentStep: 'completed',
        preferenceData: {}
      });

      await whatsappService.sendTextMessage(
        whatsappId,
        '🔄 *Preferences Reset*\n\nYour preferences have been cleared. Type "hi" to set them up again.'
      );
    } catch (error) {
      logger.error('Error resetting preferences', { whatsappId, error: this.formatError(error) });
      await this.sendError(whatsappId, 'Unable to reset preferences. Please try again.');
    }
  }

  /**
   * Quick preference update with validation
   */
  async quickUpdatePreference(whatsappId: string, field: keyof PreferenceData, value: string): Promise<void> {
    try {
      // Get context with validation
      let context = this.getValidatedContext(whatsappId);
      
      // If no context exists, try to get from user service
      if (!context) {
        const user = await userService.getUserByWhatsAppId(whatsappId);
        if (user) {
          // Create a new context
          context = {
            whatsappId,
            isOnboarding: false,
            currentStep: this.STEPS.COMPLETED,
            preferenceData: {
              evModel: user.evModel || undefined,
              connectorType: user.connectorType || undefined,
              chargingIntent: user.chargingIntent || undefined,
              queuePreference: user.queuePreference || undefined,
              vehicleType: this.inferVehicleTypeFromModel(user.evModel || undefined)
            },
            timestamp: Date.now()
          };
          this.contexts.set(whatsappId, context);
        } else {
          await whatsappService.sendTextMessage(whatsappId, '❓ No preferences found. Please set up first with "hi".');
          return;
        }
      }

      // Update the field
      (context.preferenceData as any)[field] = value;
      
      // Validate the update
      const validation = this.validateFieldValue(field, value);
      if (!validation.isValid) {
        await whatsappService.sendTextMessage(
          whatsappId, 
          `❌ Invalid value for ${field}: ${validation.error}. Please try again.`
        );
        return;
      }
      
      // Save the update
      this.updateContext(whatsappId, context);
      await preferenceService.savePreferences(whatsappId);

      await whatsappService.sendTextMessage(
        whatsappId,
        `✅ Updated ${field}: *${value}*\n\nType "profile" to see all preferences.`
      );
    } catch (error) {
      logger.error('Error updating preference', { whatsappId, field, value, error: this.formatError(error) });
      await this.sendError(whatsappId, 'Unable to update preference. Please try again.');
    }
  }

  /**
   * Validate a single field
   */
  private validateFieldValue(field: keyof PreferenceData, value: string): { isValid: boolean; error?: string } {
    switch (field) {
      case 'vehicleType':
        if (!['Car', 'Bike/Scooter', 'Any'].includes(value)) {
          return { isValid: false, error: 'Must be Car, Bike/Scooter, or Any' };
        }
        break;
      case 'connectorType':
        if (!['CCS2', 'Type2', 'CHAdeMO', 'Standard', 'Fast Charge', 'Any'].includes(value)) {
          return { isValid: false, error: 'Invalid connector type' };
        }
        break;
      case 'chargingIntent':
        if (!['Quick Top-up', 'Full Charge', 'Emergency'].includes(value)) {
          return { isValid: false, error: 'Invalid charging intent' };
        }
        break;
      case 'queuePreference':
        if (!['Free Now', 'Wait 15mimport {userService}', 'Wait 30m', 'Any Queue'].includes(value)) {
          return { isValid: false, error: 'Invalid queue preference' };
        }
        break;
      case 'evModel':
        if (value.length < 2 || value.length > 100) {
          return { isValid: false, error: 'Model name must be between 2-100 characters' };
        }
        break;
    }
    return { isValid: true };
  }

  /**
   * Validate preference data
   */
  validatePreferenceData(data: PreferenceData): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Only validate fields that are present
    if (data.vehicleType && !['Car', 'Bike/Scooter', 'Any'].includes(data.vehicleType)) {
      errors.push('Invalid vehicle type');
    }
    
    if (data.connectorType && !['CCS2', 'Type2', 'CHAdeMO', 'Standard', 'Fast Charge', 'Any'].includes(data.connectorType)) {
      errors.push('Invalid connector type');
    }
    
    if (data.chargingIntent && !['Quick Top-up', 'Full Charge', 'Emergency'].includes(data.chargingIntent)) {
      errors.push('Invalid charging intent');
    }
    
    if (data.queuePreference && !['Free Now', 'Wait 15m', 'Wait 30m', 'Any Queue'].includes(data.queuePreference)) {
      errors.push('Invalid queue preference');
    }
    
    if (data.evModel && (data.evModel.length < 2 || data.evModel.length > 100)) {
      errors.push('EV model must be between 2-100 characters');
    }

    return { isValid: errors.length === 0, errors };
  }

  /**
   * Check if user has completed preferences
   */
  hasCompletedPreferences(whatsappId: string): boolean {
    try {
      const context = this.getValidatedContext(whatsappId);
      
      // If no context, try to get from service
      if (!context) {
        // Use sync check to avoid async issues
        return false;
      }
      
      // Check for required fields based on vehicle type
      const hasRequiredFields = !!(
        context.preferenceData.connectorType && 
        context.preferenceData.chargingIntent
      );
      
      // Vehicle type and model checks
      const hasVehicleInfo = !!(
        context.preferenceData.vehicleType &&
        (context.preferenceData.vehicleType === 'Any' || context.preferenceData.evModel)
      );
      
      return context.currentStep === this.STEPS.COMPLETED && 
             hasRequiredFields && 
             hasVehicleInfo;
    } catch (error) {
      logger.error('Error checking preference completion', { whatsappId, error: this.formatError(error) });
      return false;
    }
  }

  /**
   * Get current step for debugging
   */
  getCurrentStep(whatsappId: string): PreferenceStep | null {
    try {
      return this.getValidatedContext(whatsappId)?.currentStep || null;
    } catch (error) {
      logger.error('Error getting current step', { whatsappId, error: this.formatError(error) });
      return null;
    }
  }

  /**
   * Get all active contexts count (for monitoring)
   */
  getActiveContextsCount(): number {
    return this.contexts.size;
  }
}

// Export singleton instance
export const preferenceController = new PreferenceController();