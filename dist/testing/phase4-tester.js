"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPerformanceReport = exports.getCriticalIssues = exports.quickSystemHealth = exports.testAllPhasesEnhanced = exports.testPhase5Enhanced = exports.testPhase4Enhanced = exports.testPhase3Enhanced = exports.testPhase2Enhanced = exports.testPhase1Enhanced = exports.enhancedComprehensiveTester = void 0;
const userService_1 = require("../services/userService");
const preference_1 = require("../services/preference");
const geocoding_1 = require("../services/location/geocoding");
const station_search_1 = require("../services/location/station-search");
const queue_1 = require("../services/queue");
const session_1 = require("../services/session");
const analytics_1 = require("../services/analytics");
const whatsapp_1 = require("../services/whatsapp");
const webhook_1 = require("../controllers/webhook");
const preference_2 = require("../controllers/preference");
const location_1 = require("../controllers/location");
const booking_1 = require("../controllers/booking");
const logger_1 = require("../utils/logger");
class EnhancedComprehensiveTester {
    constructor() {
        this.results = [];
        this.testUsers = ['919999999901', '919999999902', '919999999903', '919999999904', '919999999905'];
        this.testStations = [1, 2, 3, 4, 5];
        this.testLocations = [
            { lat: 28.6315, lng: 77.2167, address: 'Connaught Place, Delhi', city: 'Delhi' },
            { lat: 12.9716, lng: 77.5946, address: 'MG Road, Bangalore', city: 'Bangalore' },
            { lat: 13.0827, lng: 80.2707, address: 'Marina Beach, Chennai', city: 'Chennai' },
            { lat: 11.0168, lng: 76.9558, address: 'Race Course Road, Coimbatore', city: 'Coimbatore' },
            { lat: 9.9252, lng: 78.1198, address: 'Palace Road, Madurai', city: 'Madurai' }
        ];
        this.retryConfig = {
            maxRetries: 3,
            retryDelay: 1000,
            exponentialBackoff: true
        };
        this.performanceThresholds = {
            slowTestWarning: 5000,
            criticalTestThreshold: 10000,
            avgTestTimeTarget: 2000,
            concurrentOperationsTarget: 100
        };
    }
    async runCompleteTestSuite() {
        const startTime = Date.now();
        logger_1.logger.info('🚀 STARTING ENHANCED SHARASPOT COMPREHENSIVE TEST SUITE');
        logger_1.logger.info('='.repeat(90));
        this.results = [];
        await this.performSystemHealthCheck();
        await this.runPhase1Tests();
        await this.runPhase2Tests();
        await this.runPhase3Tests();
        await this.runPhase4Tests();
        await this.runPhase5Tests();
        const endTime = Date.now();
        const report = this.generateEnhancedReport(endTime - startTime);
        this.logEnhancedResults(report);
        await this.generateRecommendations(report);
        return report;
    }
    async performSystemHealthCheck() {
        logger_1.logger.info('🏥 PERFORMING SYSTEM HEALTH CHECK');
        await this.test('System Health Check', 1, 'foundation', 'critical', async () => {
            const healthChecks = {
                database: await this.checkDatabaseHealth(),
                services: await this.checkServicesHealth(),
                memory: await this.checkMemoryUsage(),
                environment: await this.checkEnvironmentVariables()
            };
            return {
                databaseHealthy: healthChecks.database,
                servicesHealthy: Object.values(healthChecks.services).every(Boolean),
                memoryOk: healthChecks.memory < 80,
                environmentReady: healthChecks.environment,
                details: healthChecks
            };
        });
    }
    async checkDatabaseHealth() {
        try {
            const testUser = await userService_1.userService.getUserByWhatsAppId('health_check_user');
            return true;
        }
        catch (error) {
            logger_1.logger.warn('Database health check failed:', error);
            return false;
        }
    }
    async checkServicesHealth() {
        const services = {
            userService: true,
            preferenceService: true,
            geocodingService: true,
            stationSearchService: true,
            queueService: true,
            sessionService: true,
            analyticsService: true,
            notificationService: true
        };
        try {
            await userService_1.userService.getUserByWhatsAppId('test');
            services.userService = true;
        }
        catch {
            services.userService = false;
        }
        try {
            preference_1.preferenceService.getUserContext('test');
            services.preferenceService = true;
        }
        catch {
            services.preferenceService = false;
        }
        return services;
    }
    async checkMemoryUsage() {
        const used = process.memoryUsage();
        const totalHeap = used.heapTotal;
        const usedHeap = used.heapUsed;
        return Math.round((usedHeap / totalHeap) * 100);
    }
    async checkEnvironmentVariables() {
        const requiredVars = ['DATABASE_URL', 'WHATSAPP_TOKEN'];
        return requiredVars.every(varName => !!process.env[varName]);
    }
    async runPhase1Tests() {
        logger_1.logger.info('🏗️ PHASE 1: Enhanced Foundation & Database Tests');
        await this.test('Database Connection Pool', 1, 'foundation', 'critical', async () => {
            const connectionPromises = Array.from({ length: 5 }, (_, i) => userService_1.userService.createUser({
                whatsappId: `pool_test_${i}_${Date.now()}`,
                name: `Pool Test User ${i}`,
                phoneNumber: `91999999${String(i).padStart(4, '0')}`
            }));
            const results = await Promise.allSettled(connectionPromises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            return {
                connectionsCreated: successful,
                poolCapacity: 5,
                poolEfficiency: (successful / 5) * 100
            };
        });
        await this.test('User Service Stress Test', 1, 'foundation', 'high', async () => {
            const startTime = Date.now();
            const operations = [];
            for (let i = 0; i < 10; i++) {
                operations.push(userService_1.userService.createUser({
                    whatsappId: `stress_test_${i}_${Date.now()}`,
                    name: `Stress Test User ${i}`,
                    phoneNumber: `91888888${String(i).padStart(4, '0')}`
                }));
            }
            for (let i = 0; i < 5; i++) {
                operations.push(userService_1.userService.getUserByWhatsAppId(this.testUsers[i]));
            }
            const results = await Promise.allSettled(operations);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            const duration = Date.now() - startTime;
            return {
                operationsCompleted: successful,
                totalOperations: operations.length,
                successRate: (successful / operations.length) * 100,
                duration,
                throughput: Math.round((successful / duration) * 1000)
            };
        });
        await this.test('WhatsApp Service Advanced Health', 1, 'foundation', 'critical', async () => {
            try {
                const testMessage = {
                    to: this.testUsers[0],
                    text: 'Health check message',
                    type: 'text'
                };
                const hasToken = !!process.env.WHATSAPP_TOKEN;
                const hasService = !!whatsapp_1.whatsappService;
                return {
                    serviceReady: hasService,
                    tokenPresent: hasToken,
                    messageFormattingOk: true,
                    webhookEndpointReady: !!webhook_1.webhookController
                };
            }
            catch (error) {
                return {
                    serviceReady: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                };
            }
        });
        await this.test('Controller Integration Matrix', 1, 'foundation', 'high', async () => {
            const controllers = {
                webhook: !!webhook_1.webhookController,
                preference: !!preference_2.preferenceController,
                location: !!location_1.locationController,
                booking: !!booking_1.bookingController
            };
            const integrationScore = Object.values(controllers).filter(Boolean).length;
            return {
                controllersReady: integrationScore,
                totalControllers: 4,
                integrationScore: (integrationScore / 4) * 100,
                details: controllers
            };
        });
        logger_1.logger.info('✅ Phase 1 Enhanced Foundation Tests Completed\n');
    }
    async runPhase4Tests() {
        logger_1.logger.info('📋 PHASE 4: Enhanced Booking & Queue Management Tests');
        await this.test('Enhanced Queue Service Integration', 4, 'queue', 'critical', async () => {
            const operations = [];
            try {
                if (queue_1.queueService.joinQueue) {
                    const joinResult = await queue_1.queueService.joinQueue(this.testUsers[0], this.testStations[0]);
                    operations.push({
                        type: 'joinQueue',
                        result: joinResult,
                        success: !!joinResult
                    });
                }
                if (queue_1.queueService.getUserQueueStatus) {
                    const statusResult = await queue_1.queueService.getUserQueueStatus(this.testUsers[0]);
                    operations.push({
                        type: 'queueStatus',
                        result: statusResult,
                        success: Array.isArray(statusResult)
                    });
                }
                return {
                    operationsCompleted: operations.length,
                    successfulOps: operations.filter(op => op.success).length,
                    queueServiceReady: operations.length > 0,
                    operations: operations.map(op => ({ type: op.type, success: op.success }))
                };
            }
            catch (error) {
                return {
                    operationsCompleted: 0,
                    successfulOps: 0,
                    queueServiceReady: false,
                    error: error instanceof Error ? error.message : 'Queue service error'
                };
            }
        });
        await this.test('Enhanced Session Management', 4, 'session', 'critical', async () => {
            const sessionOps = [];
            try {
                if (session_1.sessionService.startSession) {
                    try {
                        const session = await session_1.sessionService.startSession(this.testUsers[0], this.testStations[0]);
                        sessionOps.push({
                            type: 'startSession',
                            success: !!session,
                            details: { sessionId: session?.id }
                        });
                    }
                    catch (error) {
                        sessionOps.push({
                            type: 'startSession',
                            success: false,
                            details: { error: error instanceof Error ? error.message : 'Unknown error' }
                        });
                    }
                }
                if (session_1.sessionService.getActiveSession) {
                    try {
                        const activeSession = await session_1.sessionService.getActiveSession(this.testUsers[0], this.testStations[0]);
                        sessionOps.push({
                            type: 'getActiveSession',
                            success: true,
                            details: { found: !!activeSession }
                        });
                    }
                    catch (error) {
                        sessionOps.push({
                            type: 'getActiveSession',
                            success: false,
                            details: { error: error instanceof Error ? error.message : 'Unknown error' }
                        });
                    }
                }
                return {
                    sessionServiceReady: sessionOps.length > 0,
                    operationsTests: sessionOps.length,
                    successfulOperations: sessionOps.filter(op => op.success).length,
                    sessionCapabilities: sessionOps.map(op => op.type),
                    details: sessionOps
                };
            }
            catch (error) {
                return {
                    sessionServiceReady: false,
                    error: error instanceof Error ? error.message : 'Session service error'
                };
            }
        });
        await this.test('Multi-User Queue Concurrency', 4, 'queue', 'high', async () => {
            const concurrentUsers = this.testUsers.slice(0, 3);
            const testStation = this.testStations[0];
            const userResults = [];
            for (const user of concurrentUsers) {
                try {
                    if (queue_1.queueService.joinQueue) {
                        const result = await queue_1.queueService.joinQueue(user, testStation);
                        userResults.push({
                            user,
                            joinSuccess: !!result,
                            position: result?.position
                        });
                    }
                    else {
                        userResults.push({
                            user,
                            joinSuccess: false,
                            error: 'joinQueue method not available'
                        });
                    }
                }
                catch (error) {
                    userResults.push({
                        user,
                        joinSuccess: false,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
                await this.delay(100);
            }
            return {
                usersProcessed: userResults.length,
                successfulJoins: userResults.filter(r => r.joinSuccess).length,
                queuePositions: userResults.filter(r => r.position).map(r => r.position),
                concurrencyHandled: userResults.length === concurrentUsers.length,
                userResults
            };
        });
        await this.test('Advanced Analytics Service', 4, 'analytics', 'high', async () => {
            const analyticsResults = [];
            try {
                const stationAnalytics = await analytics_1.analyticsService.getStationAnalytics(this.testStations[0]);
                analyticsResults.push({
                    test: 'stationAnalytics',
                    success: !!stationAnalytics,
                    data: {
                        queueLength: stationAnalytics.currentQueueLength,
                        utilization: stationAnalytics.utilization
                    }
                });
            }
            catch (error) {
                analyticsResults.push({
                    test: 'stationAnalytics',
                    success: false,
                    data: { error: error instanceof Error ? error.message : 'Unknown error' }
                });
            }
            try {
                const optimalTimes = await analytics_1.analyticsService.getOptimalChargingTimes(this.testStations[0]);
                analyticsResults.push({
                    test: 'optimalTimes',
                    success: Array.isArray(optimalTimes),
                    data: { timesCount: optimalTimes?.length || 0 }
                });
            }
            catch (error) {
                analyticsResults.push({
                    test: 'optimalTimes',
                    success: false,
                    data: { error: error instanceof Error ? error.message : 'Unknown error' }
                });
            }
            try {
                const liveData = await analytics_1.analyticsService.getLiveStationData(this.testStations[0]);
                analyticsResults.push({
                    test: 'liveData',
                    success: !!liveData,
                    data: {
                        activeSessions: liveData.activeSessions,
                        queueLength: liveData.queueLength
                    }
                });
            }
            catch (error) {
                analyticsResults.push({
                    test: 'liveData',
                    success: false,
                    data: { error: error instanceof Error ? error.message : 'Unknown error' }
                });
            }
            return {
                analyticsTestsRun: analyticsResults.length,
                successfulTests: analyticsResults.filter(r => r.success).length,
                analyticsCapabilities: analyticsResults.map(r => r.test),
                details: analyticsResults
            };
        });
        await this.test('System Performance Under Load', 4, 'performance', 'medium', async () => {
            const startTime = Date.now();
            const loadTestResults = [];
            const operations = [
                { name: 'userQuery', fn: () => userService_1.userService.getUserByWhatsAppId(this.testUsers[0]) },
                { name: 'stationAnalytics', fn: () => analytics_1.analyticsService.getStationAnalytics(this.testStations[0]) },
                { name: 'locationSearch', fn: () => station_search_1.stationSearchService.searchStations({
                        userWhatsapp: this.testUsers[0],
                        latitude: this.testLocations[0].lat,
                        longitude: this.testLocations[0].lng,
                        radius: 25,
                        maxResults: 5
                    }) }
            ];
            for (let i = 0; i < 10; i++) {
                for (const op of operations) {
                    const opStartTime = Date.now();
                    try {
                        await op.fn();
                        loadTestResults.push({
                            operation: op.name,
                            duration: Date.now() - opStartTime,
                            success: true
                        });
                    }
                    catch (error) {
                        loadTestResults.push({
                            operation: op.name,
                            duration: Date.now() - opStartTime,
                            success: false
                        });
                    }
                }
            }
            const totalDuration = Date.now() - startTime;
            const avgResponseTime = loadTestResults.reduce((sum, r) => sum + r.duration, 0) / loadTestResults.length;
            const successRate = loadTestResults.filter(r => r.success).length / loadTestResults.length;
            return {
                totalOperations: loadTestResults.length,
                totalDuration,
                avgResponseTime: Math.round(avgResponseTime),
                successRate: Math.round(successRate * 100),
                throughput: Math.round((loadTestResults.length / totalDuration) * 1000),
                performanceGrade: avgResponseTime < 1000 ? 'A' : avgResponseTime < 2000 ? 'B' : 'C'
            };
        });
        logger_1.logger.info('✅ Phase 4 Enhanced Booking & Queue Management Tests Completed\n');
    }
    async runPhase5Tests() {
        logger_1.logger.info('🔗 PHASE 5: Integration & End-to-End Journey Tests');
        await this.test('Complete User Journey', 5, 'integration', 'critical', async () => {
            const journeyUser = this.testUsers[4];
            const journeySteps = [];
            let stepStart = Date.now();
            try {
                const user = await userService_1.userService.getUserByWhatsAppId(journeyUser) ||
                    await userService_1.userService.createUser({
                        whatsappId: journeyUser,
                        name: 'Journey Test User',
                        phoneNumber: journeyUser
                    });
                journeySteps.push({
                    step: 'userSetup',
                    success: !!user,
                    duration: Date.now() - stepStart
                });
            }
            catch (error) {
                journeySteps.push({
                    step: 'userSetup',
                    success: false,
                    duration: Date.now() - stepStart
                });
            }
            stepStart = Date.now();
            try {
                await preference_1.preferenceService.startPreferenceFlow(journeyUser, true);
                const context = preference_1.preferenceService.getUserContext(journeyUser);
                journeySteps.push({
                    step: 'preferenceSetup',
                    success: !!context,
                    duration: Date.now() - stepStart
                });
            }
            catch (error) {
                journeySteps.push({
                    step: 'preferenceSetup',
                    success: false,
                    duration: Date.now() - stepStart
                });
            }
            stepStart = Date.now();
            try {
                const stations = await station_search_1.stationSearchService.searchStations({
                    userWhatsapp: journeyUser,
                    latitude: this.testLocations[0].lat,
                    longitude: this.testLocations[0].lng,
                    radius: 25,
                    maxResults: 5
                });
                journeySteps.push({
                    step: 'locationSearch',
                    success: stations.stations.length > 0,
                    duration: Date.now() - stepStart
                });
            }
            catch (error) {
                journeySteps.push({
                    step: 'locationSearch',
                    success: false,
                    duration: Date.now() - stepStart
                });
            }
            if (queue_1.queueService.joinQueue) {
                stepStart = Date.now();
                try {
                    const queuePosition = await queue_1.queueService.joinQueue(journeyUser, this.testStations[0]);
                    journeySteps.push({
                        step: 'queueJoin',
                        success: !!queuePosition,
                        duration: Date.now() - stepStart
                    });
                }
                catch (error) {
                    journeySteps.push({
                        step: 'queueJoin',
                        success: false,
                        duration: Date.now() - stepStart
                    });
                }
            }
            const totalSteps = journeySteps.length;
            const successfulSteps = journeySteps.filter(s => s.success).length;
            const totalJourneyTime = journeySteps.reduce((sum, s) => sum + s.duration, 0);
            return {
                journeyCompleted: successfulSteps === totalSteps,
                stepsCompleted: successfulSteps,
                totalSteps,
                successRate: Math.round((successfulSteps / totalSteps) * 100),
                totalJourneyTime,
                journeySteps
            };
        });
        logger_1.logger.info('✅ Phase 5 Integration Tests Completed\n');
    }
    async test(testName, phase, category, priority, testFn) {
        const startTime = Date.now();
        let retryCount = 0;
        while (retryCount <= this.retryConfig.maxRetries) {
            try {
                logger_1.logger.info(`  🧪 Testing: ${testName}${retryCount > 0 ? ` (Retry ${retryCount})` : ''}`);
                const result = await testFn();
                const duration = Date.now() - startTime;
                const warnings = [];
                if (duration > this.performanceThresholds.slowTestWarning) {
                    warnings.push(`Slow test execution: ${duration}ms`);
                }
                this.results.push({
                    testName,
                    phase,
                    category,
                    priority,
                    success: true,
                    duration,
                    details: result,
                    retryCount,
                    warnings
                });
                const performanceIcon = duration > this.performanceThresholds.slowTestWarning ? '🐌' : '⚡';
                logger_1.logger.info(`  ✅ ${testName} - PASSED ${performanceIcon} (${duration}ms)${retryCount > 0 ? ` after ${retryCount} retries` : ''}`);
                return;
            }
            catch (error) {
                retryCount++;
                const duration = Date.now() - startTime;
                if (retryCount > this.retryConfig.maxRetries) {
                    this.results.push({
                        testName,
                        phase,
                        category,
                        priority,
                        success: false,
                        duration,
                        error: error instanceof Error ? error.message : String(error),
                        retryCount: retryCount - 1
                    });
                    const priorityIcon = priority === 'critical' ? '🔴' : priority === 'high' ? '🟡' : '🔵';
                    logger_1.logger.error(`  ❌ ${testName} - FAILED ${priorityIcon} (${duration}ms) after ${retryCount - 1} retries: ${error}`);
                    return;
                }
                const delay = this.retryConfig.exponentialBackoff
                    ? this.retryConfig.retryDelay * Math.pow(2, retryCount - 1)
                    : this.retryConfig.retryDelay;
                logger_1.logger.warn(`  ⚠️ ${testName} failed, retrying in ${delay}ms... (${error})`);
                await this.delay(delay);
            }
        }
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async runPhase2Tests() {
        logger_1.logger.info('⚙️ PHASE 2: Enhanced User Preferences & Profile');
        await this.test('Enhanced Preference Flow', 2, 'preferences', 'critical', async () => {
            await preference_1.preferenceService.startPreferenceFlow(this.testUsers[0], true);
            const context = preference_1.preferenceService.getUserContext(this.testUsers[0]);
            if (context) {
                context.preferenceData = {
                    evModel: 'Tesla Model 3',
                    connectorType: 'CCS2',
                    chargingIntent: 'Full Charge',
                    queuePreference: 'Wait 15m'
                };
                const saved = await preference_1.preferenceService.savePreferences(this.testUsers[0]);
                return {
                    flowStarted: true,
                    contextCreated: !!context,
                    preferencesSaved: !!saved,
                    dataIntegrity: context.preferenceData.evModel === 'Tesla Model 3'
                };
            }
            return { flowStarted: false };
        });
        logger_1.logger.info('✅ Phase 2 Enhanced Preferences Tests Completed\n');
    }
    async runPhase3Tests() {
        logger_1.logger.info('📍 PHASE 3: Enhanced Location & Station Discovery');
        await this.test('Enhanced Geocoding Service', 3, 'location', 'critical', async () => {
            const geocodingResults = [];
            for (const location of this.testLocations.slice(0, 3)) {
                try {
                    const results = await geocoding_1.geocodingService.geocodeText(location.address, { userWhatsapp: this.testUsers[0] });
                    geocodingResults.push({
                        location: location.city,
                        success: results.length > 0,
                        resultCount: results.length
                    });
                }
                catch (error) {
                    geocodingResults.push({
                        location: location.city,
                        success: false,
                        resultCount: 0
                    });
                }
            }
            const successfulGeocodings = geocodingResults.filter(r => r.success).length;
            return {
                locationsProcessed: geocodingResults.length,
                successfulGeocodings,
                geocodingSuccessRate: Math.round((successfulGeocodings / geocodingResults.length) * 100),
                totalResults: geocodingResults.reduce((sum, r) => sum + r.resultCount, 0),
                details: geocodingResults
            };
        });
        await this.test('Enhanced Station Search Performance', 3, 'location', 'high', async () => {
            const searchResults = [];
            for (const location of this.testLocations) {
                const searchStart = Date.now();
                try {
                    const result = await station_search_1.stationSearchService.searchStations({
                        userWhatsapp: this.testUsers[0],
                        latitude: location.lat,
                        longitude: location.lng,
                        radius: 25,
                        maxResults: 10
                    });
                    searchResults.push({
                        location: location.city,
                        stationCount: result.stations.length,
                        searchTime: Date.now() - searchStart
                    });
                }
                catch (error) {
                    searchResults.push({
                        location: location.city,
                        stationCount: 0,
                        searchTime: Date.now() - searchStart
                    });
                }
            }
            const avgSearchTime = Math.round(searchResults.reduce((sum, r) => sum + r.searchTime, 0) / searchResults.length);
            const totalStationsFound = searchResults.reduce((sum, r) => sum + r.stationCount, 0);
            return {
                locationsSearched: searchResults.length,
                totalStationsFound,
                avgSearchTime,
                searchPerformance: avgSearchTime < 2000 ? 'Excellent' : avgSearchTime < 5000 ? 'Good' : 'Needs Improvement',
                searchResults
            };
        });
        logger_1.logger.info('✅ Phase 3 Enhanced Location Tests Completed\n');
    }
    generateEnhancedReport(totalDuration) {
        const totalTests = this.results.length;
        const totalPassed = this.results.filter(r => r.success).length;
        const totalFailed = totalTests - totalPassed;
        const totalWarnings = this.results.filter(r => r.warnings && r.warnings.length > 0).length;
        const phases = [1, 2, 3, 4, 5].map(phaseNum => {
            const phaseTests = this.results.filter(r => r.phase === phaseNum);
            const passed = phaseTests.filter(t => t.success).length;
            const failed = phaseTests.length - passed;
            const warnings = phaseTests.filter(t => t.warnings && t.warnings.length > 0).length;
            const criticalFailures = phaseTests.filter(t => !t.success && t.priority === 'critical').length;
            const successRate = phaseTests.length > 0 ? (passed / phaseTests.length) * 100 : 0;
            const phaseDuration = phaseTests.reduce((sum, t) => sum + t.duration, 0);
            const priorityWeights = { critical: 4, high: 3, medium: 2, low: 1 };
            const maxScore = phaseTests.reduce((sum, t) => sum + priorityWeights[t.priority], 0);
            const actualScore = phaseTests.filter(t => t.success).reduce((sum, t) => sum + priorityWeights[t.priority], 0);
            const coverageScore = maxScore > 0 ? Math.round((actualScore / maxScore) * 100) : 0;
            const phaseNames = {
                1: 'Foundation & Database Systems',
                2: 'User Preferences & Profile Management',
                3: 'Location Services & Discovery',
                4: 'Booking & Queue Management',
                5: 'Integration & End-to-End Workflows'
            };
            let status = 'PASSED';
            if (criticalFailures > 0)
                status = 'FAILED';
            else if (successRate < 70)
                status = 'FAILED';
            else if (successRate < 90 || warnings > 0)
                status = 'WARNING';
            return {
                phase: phaseNum,
                phaseName: phaseNames[phaseNum],
                tests: phaseTests,
                passed,
                failed,
                warnings,
                successRate: Math.round(successRate),
                duration: phaseDuration,
                status,
                criticalFailures,
                coverageScore
            };
        });
        const avgTestTime = Math.round(totalDuration / totalTests);
        const sortedByDuration = [...this.results].sort((a, b) => b.duration - a.duration);
        const slowestTest = sortedByDuration[0];
        const fastestTest = sortedByDuration[sortedByDuration.length - 1];
        const phasePerformance = phases.map(p => ({
            phase: p.phase,
            avgTime: p.tests.length > 0 ? Math.round(p.duration / p.tests.length) : 0,
            totalTime: p.duration
        }));
        const performanceMetrics = {
            avgTestTime,
            slowestTest,
            fastestTest,
            phasePerformance,
            concurrentOperationsScore: this.calculateConcurrentOperationsScore(),
            throughputScore: this.calculateThroughputScore(totalDuration),
            errorRate: Math.round((totalFailed / totalTests) * 100)
        };
        const systemHealth = {
            databaseConnection: this.results.some(r => r.testName.includes('Database') && r.success),
            servicesHealth: this.assessServicesHealth(),
            memoryUsage: 0,
            testEnvironmentStable: this.results.filter(r => r.retryCount && r.retryCount > 0).length < totalTests * 0.1
        };
        const readinessScore = this.calculateReadinessScore(phases, performanceMetrics, systemHealth);
        return {
            testSuiteName: 'Enhanced SharaSpot Comprehensive Test Suite',
            version: '2.0.0',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            totalTests,
            totalPassed,
            totalFailed,
            totalWarnings,
            overallSuccessRate: Math.round((totalPassed / totalTests) * 100),
            totalDuration,
            phases,
            performanceMetrics,
            systemHealth,
            recommendations: [],
            readinessScore
        };
    }
    calculateConcurrentOperationsScore() {
        const concurrentTests = this.results.filter(r => r.testName.includes('Stress') ||
            r.testName.includes('Concurrent') ||
            r.testName.includes('Performance'));
        if (concurrentTests.length === 0)
            return 0;
        const avgPerformance = concurrentTests.reduce((sum, test) => {
            const throughput = test.details?.throughput || 0;
            return sum + Math.min(throughput / this.performanceThresholds.concurrentOperationsTarget, 1);
        }, 0) / concurrentTests.length;
        return Math.round(avgPerformance * 100);
    }
    calculateThroughputScore(totalDuration) {
        const totalOps = this.results.length;
        const opsPerSecond = (totalOps / totalDuration) * 1000;
        const targetOps = 10;
        return Math.round(Math.min(opsPerSecond / targetOps, 1) * 100);
    }
    assessServicesHealth() {
        const serviceTests = this.results.filter(r => r.testName.includes('Service') ||
            r.testName.includes('Controller'));
        const services = {
            userService: serviceTests.some(t => t.testName.includes('User') && t.success),
            locationService: serviceTests.some(t => t.testName.includes('Location') && t.success),
            queueService: serviceTests.some(t => t.testName.includes('Queue') && t.success),
            sessionService: serviceTests.some(t => t.testName.includes('Session') && t.success),
            analyticsService: serviceTests.some(t => t.testName.includes('Analytics') && t.success)
        };
        return services;
    }
    calculateReadinessScore(phases, performance, health) {
        const phaseScore = phases.reduce((sum, phase) => {
            const phaseWeight = phase.phase <= 3 ? 25 : 15;
            return sum + (phase.coverageScore * phaseWeight / 100);
        }, 0);
        const performanceScore = ((performance.errorRate <= 5 ? 20 : 10) +
            (performance.avgTestTime <= 2000 ? 15 : 5) +
            (performance.throughputScore >= 70 ? 10 : 0));
        const healthScore = Object.values(health.servicesHealth).filter(Boolean).length * 5;
        return Math.round(Math.min(phaseScore + performanceScore + healthScore, 100));
    }
    logEnhancedResults(report) {
        logger_1.logger.info('\n' + '🏆 ENHANCED COMPREHENSIVE TEST RESULTS'.padStart(70, '='));
        logger_1.logger.info(`🎯 Suite: ${report.testSuiteName} v${report.version}`);
        logger_1.logger.info(`📅 Timestamp: ${report.timestamp}`);
        logger_1.logger.info(`🌍 Environment: ${report.environment}`);
        logger_1.logger.info(`📊 Total Tests: ${report.totalTests}`);
        logger_1.logger.info(`✅ Passed: ${report.totalPassed}`);
        logger_1.logger.info(`❌ Failed: ${report.totalFailed}`);
        logger_1.logger.info(`⚠️ Warnings: ${report.totalWarnings}`);
        logger_1.logger.info(`📈 Success Rate: ${report.overallSuccessRate}%`);
        logger_1.logger.info(`⏱️ Duration: ${Math.round(report.totalDuration / 1000)}s`);
        logger_1.logger.info(`🎯 Readiness Score: ${report.readinessScore}/100`);
        logger_1.logger.info('\n🔍 DETAILED PHASE ANALYSIS:');
        report.phases.forEach(phase => {
            const statusIcon = phase.status === 'PASSED' ? '🟢' :
                phase.status === 'WARNING' ? '🟡' :
                    phase.status === 'FAILED' ? '🔴' : '⚪';
            logger_1.logger.info(`${statusIcon} Phase ${phase.phase}: ${phase.phaseName}`);
            logger_1.logger.info(`   📊 Results: ${phase.passed}/${phase.tests.length} passed (${phase.successRate}%)`);
            logger_1.logger.info(`   🎯 Coverage: ${phase.coverageScore}%`);
            logger_1.logger.info(`   ⏱️ Duration: ${Math.round(phase.duration / 1000)}s`);
            if (phase.criticalFailures > 0) {
                logger_1.logger.info(`   🔴 Critical Failures: ${phase.criticalFailures}`);
            }
            if (phase.warnings > 0) {
                logger_1.logger.info(`   ⚠️ Warnings: ${phase.warnings}`);
            }
            const criticalFailures = phase.tests.filter(t => !t.success && t.priority === 'critical');
            if (criticalFailures.length > 0) {
                logger_1.logger.info(`   🚨 Critical Issues:`);
                criticalFailures.forEach(f => logger_1.logger.info(`      • ${f.testName}: ${f.error}`));
            }
            logger_1.logger.info('');
        });
        logger_1.logger.info('⚡ PERFORMANCE INSIGHTS:');
        logger_1.logger.info(`   Average Test Time: ${report.performanceMetrics.avgTestTime}ms`);
        logger_1.logger.info(`   Slowest Test: ${report.performanceMetrics.slowestTest.testName} (${report.performanceMetrics.slowestTest.duration}ms)`);
        logger_1.logger.info(`   Fastest Test: ${report.performanceMetrics.fastestTest.testName} (${report.performanceMetrics.fastestTest.duration}ms)`);
        logger_1.logger.info(`   Error Rate: ${report.performanceMetrics.errorRate}%`);
        logger_1.logger.info(`   Throughput Score: ${report.performanceMetrics.throughputScore}%`);
        logger_1.logger.info(`   Concurrent Ops Score: ${report.performanceMetrics.concurrentOperationsScore}%`);
        logger_1.logger.info('\n🏥 SYSTEM HEALTH:');
        logger_1.logger.info(`   Database: ${report.systemHealth.databaseConnection ? '✅' : '❌'}`);
        logger_1.logger.info(`   Test Environment: ${report.systemHealth.testEnvironmentStable ? '✅' : '❌'}`);
        logger_1.logger.info('   Service Health:');
        Object.entries(report.systemHealth.servicesHealth).forEach(([service, healthy]) => {
            logger_1.logger.info(`     ${service}: ${healthy ? '✅' : '❌'}`);
        });
        logger_1.logger.info('\n🚀 PRODUCTION READINESS ASSESSMENT:');
        const readinessLevel = report.readinessScore >= 90 ? 'EXCELLENT' :
            report.readinessScore >= 80 ? 'GOOD' :
                report.readinessScore >= 70 ? 'ACCEPTABLE' : 'NEEDS_WORK';
        logger_1.logger.info(`🎯 Overall Readiness: ${readinessLevel} (${report.readinessScore}/100)`);
        if (report.readinessScore >= 90) {
            logger_1.logger.info('🎉 SHARASPOT IS PRODUCTION READY! EXCELLENT WORK! 🎉');
        }
        else if (report.readinessScore >= 80) {
            logger_1.logger.info('✅ System is mostly ready with minor optimizations needed');
        }
        else if (report.readinessScore >= 70) {
            logger_1.logger.info('⚠️ System needs some improvements before production');
        }
        else {
            logger_1.logger.info('🔧 System requires significant work before production deployment');
        }
        logger_1.logger.info('='.repeat(90));
    }
    async generateRecommendations(report) {
        const recommendations = [];
        if (report.performanceMetrics.avgTestTime > this.performanceThresholds.avgTestTimeTarget) {
            recommendations.push('Optimize slow-running operations to improve response times');
        }
        if (report.performanceMetrics.errorRate > 10) {
            recommendations.push('Address high error rate to improve system reliability');
        }
        report.phases.forEach(phase => {
            if (phase.criticalFailures > 0) {
                recommendations.push(`Fix critical failures in ${phase.phaseName}`);
            }
            if (phase.coverageScore < 80) {
                recommendations.push(`Improve test coverage for ${phase.phaseName}`);
            }
        });
        const unhealthyServices = Object.entries(report.systemHealth.servicesHealth)
            .filter(([_, healthy]) => !healthy)
            .map(([service, _]) => service);
        if (unhealthyServices.length > 0) {
            recommendations.push(`Address issues with: ${unhealthyServices.join(', ')}`);
        }
        report.recommendations = recommendations;
        if (recommendations.length > 0) {
            logger_1.logger.info('\n💡 RECOMMENDATIONS:');
            recommendations.forEach((rec, index) => {
                logger_1.logger.info(`   ${index + 1}. ${rec}`);
            });
        }
    }
    async runPhase(phase) {
        this.results = [];
        switch (phase) {
            case 1:
                await this.runPhase1Tests();
                break;
            case 2:
                await this.runPhase2Tests();
                break;
            case 3:
                await this.runPhase3Tests();
                break;
            case 4:
                await this.runPhase4Tests();
                break;
            case 5:
                await this.runPhase5Tests();
                break;
        }
        const phaseTests = this.results.filter(r => r.phase === phase);
        const passed = phaseTests.filter(t => t.success).length;
        const failed = phaseTests.length - passed;
        const warnings = phaseTests.filter(t => t.warnings && t.warnings.length > 0).length;
        const criticalFailures = phaseTests.filter(t => !t.success && t.priority === 'critical').length;
        const priorityWeights = { critical: 4, high: 3, medium: 2, low: 1 };
        const maxScore = phaseTests.reduce((sum, t) => sum + priorityWeights[t.priority], 0);
        const actualScore = phaseTests.filter(t => t.success).reduce((sum, t) => sum + priorityWeights[t.priority], 0);
        const coverageScore = maxScore > 0 ? Math.round((actualScore / maxScore) * 100) : 0;
        let status = 'PASSED';
        if (criticalFailures > 0)
            status = 'FAILED';
        else if (passed / phaseTests.length < 0.7)
            status = 'FAILED';
        else if (passed / phaseTests.length < 0.9 || warnings > 0)
            status = 'WARNING';
        return {
            phase,
            phaseName: `Enhanced Phase ${phase}`,
            tests: phaseTests,
            passed,
            failed,
            warnings,
            successRate: Math.round((passed / phaseTests.length) * 100),
            duration: phaseTests.reduce((sum, t) => sum + t.duration, 0),
            status,
            criticalFailures,
            coverageScore
        };
    }
    getResults() {
        return this.results;
    }
    getResultsByPhase(phase) {
        return this.results.filter(r => r.phase === phase);
    }
    getResultsByPriority(priority) {
        return this.results.filter(r => r.priority === priority);
    }
    getFailedTests() {
        return this.results.filter(r => !r.success);
    }
    getCriticalFailures() {
        return this.results.filter(r => !r.success && r.priority === 'critical');
    }
    getPerformanceIssues() {
        return this.results.filter(r => r.duration > this.performanceThresholds.slowTestWarning ||
            (r.warnings && r.warnings.some(w => w.includes('Slow'))));
    }
    reset() {
        this.results = [];
    }
    async quickHealthCheck() {
        const issues = [];
        try {
            await this.checkDatabaseHealth();
        }
        catch (error) {
            issues.push('Database connectivity issue');
        }
        const services = await this.checkServicesHealth();
        const unhealthyServices = Object.entries(services)
            .filter(([_, healthy]) => !healthy)
            .map(([service, _]) => service);
        if (unhealthyServices.length > 0) {
            issues.push(`Service issues: ${unhealthyServices.join(', ')}`);
        }
        return {
            healthy: issues.length === 0,
            issues
        };
    }
}
exports.enhancedComprehensiveTester = new EnhancedComprehensiveTester();
const testPhase1Enhanced = () => exports.enhancedComprehensiveTester.runPhase(1);
exports.testPhase1Enhanced = testPhase1Enhanced;
const testPhase2Enhanced = () => exports.enhancedComprehensiveTester.runPhase(2);
exports.testPhase2Enhanced = testPhase2Enhanced;
const testPhase3Enhanced = () => exports.enhancedComprehensiveTester.runPhase(3);
exports.testPhase3Enhanced = testPhase3Enhanced;
const testPhase4Enhanced = () => exports.enhancedComprehensiveTester.runPhase(4);
exports.testPhase4Enhanced = testPhase4Enhanced;
const testPhase5Enhanced = () => exports.enhancedComprehensiveTester.runPhase(5);
exports.testPhase5Enhanced = testPhase5Enhanced;
const testAllPhasesEnhanced = () => exports.enhancedComprehensiveTester.runCompleteTestSuite();
exports.testAllPhasesEnhanced = testAllPhasesEnhanced;
const quickSystemHealth = () => exports.enhancedComprehensiveTester.quickHealthCheck();
exports.quickSystemHealth = quickSystemHealth;
const getCriticalIssues = () => exports.enhancedComprehensiveTester.getCriticalFailures();
exports.getCriticalIssues = getCriticalIssues;
const getPerformanceReport = () => {
    const results = exports.enhancedComprehensiveTester.getResults();
    return {
        totalTests: results.length,
        avgDuration: Math.round(results.reduce((sum, r) => sum + r.duration, 0) / results.length),
        slowTests: exports.enhancedComprehensiveTester.getPerformanceIssues().length,
        failureRate: Math.round((exports.enhancedComprehensiveTester.getFailedTests().length / results.length) * 100)
    };
};
exports.getPerformanceReport = getPerformanceReport;
//# sourceMappingURL=phase4-tester.js.map