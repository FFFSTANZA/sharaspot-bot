import { seedTamilNaduData } from '../db/seed-sample-data.ts';
import { automatedBotTester } from './automated-bot-tester';
import { logger } from '../utils/logger';

async function runTests() {
  try {
    logger.info('🚀 SharaSpot Bot Testing Suite Starting...');
    logger.info('=' .repeat(60));

    // Step 1: Seed Tamil Nadu data
    logger.info('📊 Step 1: Seeding Tamil Nadu test data...');
    await seedTamilNaduData();
    logger.info('✅ Seed data completed\n');

    // Step 2: Run automated tests
    logger.info('🤖 Step 2: Running automated bot tests...');
    await automatedBotTester.runAllTests();
    logger.info('✅ Automated tests completed\n');

    // Step 3: Test individual components
    logger.info('🔧 Step 3: Testing individual components...');
    await automatedBotTester.testComponent('user-service');
    await automatedBotTester.testComponent('location-service');
    logger.info('✅ Component tests completed\n');

    logger.info('🎉 All tests completed successfully!');
    logger.info('📝 Check the logs above for detailed results');

  } catch (error) {
    logger.error('❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}

export { runTests };
