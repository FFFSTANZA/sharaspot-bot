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
exports.QuickTester = void 0;
const automated_bot_tester_1 = require("../testing/automated-bot-tester");
const logger_1 = require("../utils/logger");
class QuickTester {
    static async testChennaiUser() {
        logger_1.logger.info('🧪 Quick Test: Chennai User Flow');
        const scenario = {
            name: 'Quick Chennai Test',
            description: 'Test Chennai user finding nearby stations',
            userId: '919999999901',
            steps: [
                {
                    action: 'Greeting',
                    message: {
                        from: '919999999901',
                        type: 'text',
                        text: { body: 'hi' },
                    },
                },
                {
                    action: 'Quick book',
                    message: {
                        from: '919999999901',
                        type: 'interactive',
                        interactive: {
                            type: 'button_reply',
                            button_reply: { id: 'quick_book', title: 'Find Stations' },
                        },
                    },
                },
                {
                    action: 'Anna Nagar location',
                    message: {
                        from: '919999999901',
                        type: 'location',
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
        await automated_bot_tester_1.automatedBotTester.runTestScenario(scenario);
    }
    static async testCoimbatoreAddressSearch() {
        logger_1.logger.info('🧪 Quick Test: Coimbatore Address Search');
        const scenario = {
            name: 'Quick Coimbatore Test',
            description: 'Test address-based search in Coimbatore',
            userId: '919999999902',
            steps: [
                {
                    action: 'Find command',
                    message: {
                        from: '919999999902',
                        type: 'text',
                        text: { body: 'find' },
                    },
                },
                {
                    action: 'Type address',
                    message: {
                        from: '919999999902',
                        type: 'text',
                        text: { body: 'RS Puram Coimbatore' },
                    },
                },
            ],
        };
        await automated_bot_tester_1.automatedBotTester.runTestScenario(scenario);
    }
    static async testNewUserOnboarding() {
        logger_1.logger.info('🧪 Quick Test: New User Onboarding');
        const scenario = {
            name: 'Quick New User Test',
            description: 'Test complete new user flow',
            userId: '919999999950',
            steps: [
                {
                    action: 'Greeting',
                    message: {
                        from: '919999999950',
                        type: 'text',
                        text: { body: 'hi' },
                    },
                },
                {
                    action: 'Provide name',
                    message: {
                        from: '919999999950',
                        type: 'text',
                        text: { body: 'Test User New' },
                    },
                },
                {
                    action: 'Skip EV model',
                    message: {
                        from: '919999999950',
                        type: 'interactive',
                        interactive: {
                            type: 'button_reply',
                            button_reply: { id: 'skip_ev_model', title: 'Skip for Now' },
                        },
                    },
                },
            ],
        };
        await automated_bot_tester_1.automatedBotTester.runTestScenario(scenario);
    }
    static async testGeocoding() {
        logger_1.logger.info('🧪 Quick Test: Geocoding Service');
        try {
            const { geocodingService } = await Promise.resolve().then(() => __importStar(require('../services/location/geocoding')));
            const testAddresses = [
                'Chennai',
                'Anna Nagar Chennai',
                'RS Puram Coimbatore',
                'Marina Beach',
                'Brigade Road Bangalore'
            ];
            for (const address of testAddresses) {
                logger_1.logger.info(`Testing geocoding for: ${address}`);
                const results = await geocodingService.geocodeText(address);
                if (results.length > 0) {
                    logger_1.logger.info(`✅ Found: ${results[0].formattedAddress} (${results[0].latitude}, ${results[0].longitude})`);
                }
                else {
                    logger_1.logger.warn(`❌ No results for: ${address}`);
                }
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Geocoding test failed:', error);
        }
    }
    static async testStationSearch() {
        logger_1.logger.info('🧪 Quick Test: Station Search Service');
        try {
            const { stationSearchService } = await Promise.resolve().then(() => __importStar(require('../services/location/station-search')));
            const searchOptions = {
                userWhatsapp: '919999999901',
                latitude: 13.0878,
                longitude: 80.2086,
                radius: 25,
                maxResults: 5,
                offset: 0,
            };
            logger_1.logger.info('Searching stations near Anna Nagar, Chennai...');
            const results = await stationSearchService.searchStations(searchOptions);
            logger_1.logger.info(`✅ Found ${results.stations.length} stations (${results.totalCount} total)`);
            for (const station of results.stations.slice(0, 3)) {
                logger_1.logger.info(`  📍 ${station.name} - ${station.distance}km away - ${station.availablePorts}/${station.totalPorts} ports`);
            }
        }
        catch (error) {
            logger_1.logger.error('❌ Station search test failed:', error);
        }
    }
}
exports.QuickTester = QuickTester;
//# sourceMappingURL=quick-test.js.map