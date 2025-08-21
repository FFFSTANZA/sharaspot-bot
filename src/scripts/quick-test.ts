import { automatedBotTester } from '../testing/automated-bot-tester';
import { logger } from '../utils/logger';

/**
 * Quick test script for manual testing
 */
export class QuickTester {
  /**
   * Test Chennai user flow
   */
  static async testChennaiUser(): Promise<void> {
    logger.info('🧪 Quick Test: Chennai User Flow');
    
    const scenario = {
      name: 'Quick Chennai Test',
      description: 'Test Chennai user finding nearby stations',
      userId: '919999999901',
      steps: [
        {
          action: 'Greeting',
          message: {
            from: '919999999901',
            type: 'text' as const,
            text: { body: 'hi' },
          },
        },
        {
          action: 'Quick book',
          message: {
            from: '919999999901',
            type: 'interactive' as const,
            interactive: {
              type: 'button_reply' as const,
              button_reply: { id: 'quick_book', title: 'Find Stations' },
            },
          },
        },
        {
          action: 'Anna Nagar location',
          message: {
            from: '919999999901',
            type: 'location' as const,
            location: {
              latitude: 13.0878,
              longitude: 80.2086,
              name: 'Anna Nagar',
              address: 'Anna Nagar, Chennai, Tamil Nadu',
            },
          },
        },
      ],
    };

    await automatedBotTester.runTestScenario(scenario);
  }

  /**
   * Test Coimbatore address search
   */
  static async testCoimbatoreAddressSearch(): Promise<void> {
    logger.info('🧪 Quick Test: Coimbatore Address Search');
    
    const scenario = {
      name: 'Quick Coimbatore Test',
      description: 'Test address-based search in Coimbatore',
      userId: '919999999902',
      steps: [
        {
          action: 'Find command',
          message: {
            from: '919999999902',
            type: 'text' as const,
            text: { body: 'find' },
          },
        },
        {
          action: 'Type address',
          message: {
            from: '919999999902',
            type: 'text' as const,
            text: { body: 'RS Puram Coimbatore' },
          },
        },
      ],
    };

    await automatedBotTester.runTestScenario(scenario);
  }

  /**
   * Test new user onboarding
   */
  static async testNewUserOnboarding(): Promise<void> {
    logger.info('🧪 Quick Test: New User Onboarding');
    
    const scenario = {
      name: 'Quick New User Test',
      description: 'Test complete new user flow',
      userId: '919999999950',
      steps: [
        {
          action: 'Greeting',
          message: {
            from: '919999999950',
            type: 'text' as const,
            text: { body: 'hi' },
          },
        },
        {
          action: 'Provide name',
          message: {
            from: '919999999950',
            type: 'text' as const,
            text: { body: 'Test User New' },
          },
        },
        {
          action: 'Skip EV model',
          message: {
            from: '919999999950',
            type: 'interactive' as const,
            interactive: {
              type: 'button_reply' as const,
              button_reply: { id: 'skip_ev_model', title: 'Skip for Now' },
            },
          },
        },
      ],
    };

    await automatedBotTester.runTestScenario(scenario);
  }

  /**
   * Test geocoding functionality
   */
  static async testGeocoding(): Promise<void> {
    logger.info('🧪 Quick Test: Geocoding Service');
    
    try {
      const { geocodingService } = await import('../services/location/geocoding');
      
      const testAddresses = [
        'Chennai',
        'Anna Nagar Chennai',
        'RS Puram Coimbatore',
        'Marina Beach',
        'Brigade Road Bangalore'
      ];

      for (const address of testAddresses) {
        logger.info(`Testing geocoding for: ${address}`);
        const results = await geocodingService.geocodeText(address);
        
        if (results.length > 0) {
          logger.info(`✅ Found: ${results[0].formattedAddress} (${results[0].latitude}, ${results[0].longitude})`);
        } else {
          logger.warn(`❌ No results for: ${address}`);
        }
      }
    } catch (error) {
      logger.error('❌ Geocoding test failed:', error);
    }
  }

  /**
   * Test station search
   */
  static async testStationSearch(): Promise<void> {
    logger.info('🧪 Quick Test: Station Search Service');
    
    try {
      const { stationSearchService } = await import('../services/location/station-search');
      
      // Test search near Chennai (Anna Nagar)
      const searchOptions = {
        userWhatsapp: '919999999901',
        latitude: 13.0878,
        longitude: 80.2086,
        radius: 25,
        maxResults: 5,
        offset: 0,
      };

      logger.info('Searching stations near Anna Nagar, Chennai...');
      const results = await stationSearchService.searchStations(searchOptions);
      
      logger.info(`✅ Found ${results.stations.length} stations (${results.totalCount} total)`);
      
      for (const station of results.stations.slice(0, 3)) {
        logger.info(`  📍 ${station.name} - ${station.distance}km away - ${station.availablePorts}/${station.totalPorts} ports`);
      }
      
    } catch (error) {
      logger.error('❌ Station search test failed:', error);
    }
  }
}