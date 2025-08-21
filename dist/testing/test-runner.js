"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTests = runTests;
const seed_tamil_nadu_data_1 = require("../db/seed-tamil-nadu-data");
const automated_bot_tester_1 = require("./automated-bot-tester");
const logger_1 = require("../utils/logger");
async function runTests() {
    try {
        logger_1.logger.info('🚀 SharaSpot Bot Testing Suite Starting...');
        logger_1.logger.info('='.repeat(60));
        logger_1.logger.info('📊 Step 1: Seeding Tamil Nadu test data...');
        await (0, seed_tamil_nadu_data_1.seedTamilNaduData)();
        logger_1.logger.info('✅ Seed data completed\n');
        logger_1.logger.info('🤖 Step 2: Running automated bot tests...');
        await automated_bot_tester_1.automatedBotTester.runAllTests();
        logger_1.logger.info('✅ Automated tests completed\n');
        logger_1.logger.info('🔧 Step 3: Testing individual components...');
        await automated_bot_tester_1.automatedBotTester.testComponent('user-service');
        await automated_bot_tester_1.automatedBotTester.testComponent('location-service');
        logger_1.logger.info('✅ Component tests completed\n');
        logger_1.logger.info('🎉 All tests completed successfully!');
        logger_1.logger.info('📝 Check the logs above for detailed results');
    }
    catch (error) {
        logger_1.logger.error('❌ Test suite failed:', error);
        process.exit(1);
    }
}
if (require.main === module) {
    runTests();
}
//# sourceMappingURL=test-runner.js.map