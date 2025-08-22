// src/scripts/fix-station-owners-columns.ts
import { db } from '../config/database'; // Changed from '@/lib/database'
import { logger } from '../utils/logger'; // Changed from '@/lib/logger'

async function fixStationOwnersColumns() {
  try {
    logger.info('🔧 Starting station_owners table column fix...');

    // First, check current columns
    logger.info('📋 Checking current station_owners columns...');
    const currentColumns = await db.execute(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'station_owners'
      ORDER BY ordinal_position;
    `);
    
    logger.info('Current columns:', { columns: currentColumns.rows });

    // Add missing columns one by one
    const missingColumns = [
      'phone_number VARCHAR',
      'email VARCHAR',
      'business_name VARCHAR',
      'business_type VARCHAR',
      'is_verified BOOLEAN DEFAULT false',
      'verification_documents JSONB DEFAULT \'[]\'::jsonb'
    ];

    for (const column of missingColumns) {
      const columnName = column.split(' ')[0];
      
      // Check if column already exists
      const columnExists = await db.execute(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'station_owners' AND column_name = '${columnName}'
      `);

      if (columnExists.rows.length === 0) {
        logger.info(`➕ Adding missing column: ${columnName}`);
        try {
          await db.execute(`ALTER TABLE station_owners ADD COLUMN ${column}`);
          logger.info(`✅ Successfully added column: ${columnName}`);
        } catch (error) {
          logger.error(`❌ Failed to add column ${columnName}:`, error);
        }
      } else {
        logger.info(`✓ Column ${columnName} already exists`);
      }
    }

    // Verify all columns are now present
    logger.info('🔍 Verifying updated table structure...');
    const updatedColumns = await db.execute(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'station_owners'
      ORDER BY ordinal_position;
    `);
    
    logger.info('Updated columns:', { columns: updatedColumns.rows });

    // Test insert with Drizzle - import schema from correct location
    logger.info('🧪 Testing Drizzle insert after fix...');
    const { stationOwners } = await import('../db/schema'); // Changed from '@/lib/database/schema'
    
    const testResult = await db
      .insert(stationOwners)
      .values({
        whatsappId: 'test_after_fix_' + Date.now(),
        name: 'Test Owner After Fix',
      })
      .onConflictDoNothing()
      .returning();

    logger.info('✅ Test insert successful!', { result: testResult });

    logger.info('🎉 station_owners table fix completed successfully!');

  } catch (error) {
    logger.error('❌ Failed to fix station_owners table:', error);
    throw error;
  }
}

if (require.main === module) {
  fixStationOwnersColumns()
    .then(() => {
      logger.info('👍 Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Script failed:', error);
      process.exit(1);
    });
}