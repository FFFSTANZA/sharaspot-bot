// src/scripts/comprehensive-database-fix.ts
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = neon(process.env.DATABASE_URL);

async function comprehensiveDatabaseFix() {
  try {
    logger.info('🔧 Starting comprehensive database fix...');

    // === PHASE 1: ANALYZE CURRENT STATE ===
    logger.info('📊 Phase 1: Analyzing current database state...');
    
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    
    logger.info('Found tables:', tables.map(t => t.table_name));

    // === PHASE 2: FIX QUEUES TABLE ===
    logger.info('📋 Phase 2: Fixing queues table...');
    
    // Check current queues columns
    const queuesColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'queues' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    logger.info('Current queues columns:', queuesColumns);

    // Define required columns for queues table
    const requiredQueuesColumns = [
      { 
        name: 'reservation_expiry', 
        definition: 'reservation_expiry TIMESTAMP',
        check: (cols: any[]) => cols.some(c => c.column_name === 'reservation_expiry')
      },
      { 
        name: 'reminder_sent', 
        definition: 'reminder_sent BOOLEAN DEFAULT false',
        check: (cols: any[]) => cols.some(c => c.column_name === 'reminder_sent')
      },
      { 
        name: 'estimated_wait_minutes', 
        definition: 'estimated_wait_minutes INTEGER',
        check: (cols: any[]) => cols.some(c => c.column_name === 'estimated_wait_minutes')
      }
    ];

    // Add missing columns to queues table
    for (const column of requiredQueuesColumns) {
      const exists = column.check(queuesColumns);
      
      if (!exists) {
        logger.info(`➕ Adding missing column: ${column.name} to queues table`);
        try {
          await sql`ALTER TABLE queues ADD COLUMN ${sql.unsafe(column.definition)}`;
          logger.info(`✅ Successfully added column: ${column.name}`);
        } catch (error) {
          logger.error(`❌ Failed to add column ${column.name}:`, error);
        }
      } else {
        logger.info(`✓ Column ${column.name} already exists in queues table`);
      }
    }

    // === PHASE 3: VERIFY USERS TABLE ===
    logger.info('👤 Phase 3: Verifying users table...');
    
    const usersColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    logger.info('Users table columns:', usersColumns);

    // === PHASE 4: CHECK FOR SCHEMA INCONSISTENCIES ===
    logger.info('🔍 Phase 4: Checking for schema inconsistencies...');
    
    // Check if queues table has the old 'is_reserved' column that should be removed
    const hasOldColumns = queuesColumns.some(c => c.column_name === 'is_reserved' || c.column_name === 'reserved_at');
    
    if (hasOldColumns) {
      logger.warn('⚠️ Found deprecated columns in queues table. Consider cleaning up:');
      logger.warn('- is_reserved (replaced by status field)');
      logger.warn('- reserved_at (replaced by reservation_expiry)');
    }

    // === PHASE 5: TEST CRITICAL QUERIES ===
    logger.info('🧪 Phase 5: Testing critical queries...');
    
    try {
      // Test the problematic query from the logs
      const testQuery1 = await sql`
        SELECT id, station_id, user_whatsapp, position, status, 
               estimated_wait_minutes, reservation_expiry, reminder_sent, 
               created_at, updated_at 
        FROM queues 
        WHERE status = 'waiting'
        LIMIT 1;
      `;
      logger.info('✅ Queues SELECT query test passed');

      // Test users unique constraint query
      const testQuery2 = await sql`
        SELECT id, whatsapp_id, name
        FROM users 
        WHERE whatsapp_id = 'test_user_12345'
        LIMIT 1;
      `;
      logger.info('✅ Users SELECT query test passed');

    } catch (queryError) {
      logger.error('❌ Query testing failed:', queryError);
    }

    // === PHASE 6: PROVIDE MIGRATION RECOMMENDATIONS ===
    logger.info('📝 Phase 6: Migration recommendations...');
    
    // Check if we need to run drizzle migrations
    const needsMigration = await checkIfMigrationNeeded();
    
    if (needsMigration) {
      logger.info('🚨 RECOMMENDATION: Run the following commands:');
      logger.info('   npm run db:generate    # Generate new migration');
      logger.info('   npm run db:push        # Push schema to database');
      logger.info('   npm run db:migrate     # Apply pending migrations');
    }

    // === FINAL VERIFICATION ===
    logger.info('✅ Phase 7: Final verification...');
    
    const finalQueuesColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'queues' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const hasAllRequiredColumns = requiredQueuesColumns.every(col => 
      col.check(finalQueuesColumns)
    );
    
    if (hasAllRequiredColumns) {
      logger.info('🎉 SUCCESS: All required columns are now present!');
      logger.info('📊 Final queues table structure:', finalQueuesColumns);
    } else {
      logger.error('❌ FAILURE: Some columns are still missing');
      const missing = requiredQueuesColumns.filter(col => !col.check(finalQueuesColumns));
      logger.error('Missing columns:', missing.map(c => c.name));
    }

  } catch (error) {
    logger.error('💥 Comprehensive database fix failed:', error);
    throw error;
  }
}

async function checkIfMigrationNeeded(): Promise<boolean> {
  try {
    // Check if drizzle migrations table exists
    const migrationTable = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = '__drizzle_migrations' 
      AND table_schema = 'public';
    `;
    
    if (migrationTable.length === 0) {
      logger.info('🔄 Drizzle migrations table not found - migrations recommended');
      return true;
    }
    
    // Could add more sophisticated migration checking here
    return false;
    
  } catch (error) {
    logger.warn('⚠️ Could not check migration status:', error);
    return true; // Assume migration needed if we can't check
  }
}

// Run if this file is executed directly
if (require.main === module) {
  comprehensiveDatabaseFix()
    .then(() => {
      logger.info('🎊 Comprehensive database fix completed successfully!');
      logger.info('🚀 You can now start the bot with: npm run dev');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('💥 Comprehensive database fix failed:', error);
      logger.error('🛠️  Please check the error above and try running individual fixes');
      process.exit(1);
    });
}

export { comprehensiveDatabaseFix };