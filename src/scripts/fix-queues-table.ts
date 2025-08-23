// src/scripts/fix-queues-table.ts
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = neon(process.env.DATABASE_URL);

async function fixQueuesTable() {
  try {
    logger.info('🔧 Starting queues table fix...');

    // Check current columns in queues table
    const currentColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'queues' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    logger.info('Current queues table columns:', currentColumns);

    // Define the columns that should exist based on your schema
    const requiredColumns = [
      { name: 'reservation_expiry', definition: 'reservation_expiry TIMESTAMP' },
      { name: 'reminder_sent', definition: 'reminder_sent BOOLEAN DEFAULT false' },
      { name: 'estimated_wait_minutes', definition: 'estimated_wait_minutes INTEGER' }
    ];

    // Add missing columns
    for (const column of requiredColumns) {
      const exists = currentColumns.some((col: any) => col.column_name === column.name);
      
      if (!exists) {
        logger.info(`➕ Adding missing column: ${column.name}`);
        try {
          await sql`ALTER TABLE queues ADD COLUMN ${sql.unsafe(column.definition)}`;
          logger.info(`✅ Successfully added column: ${column.name}`);
        } catch (error) {
          logger.error(`❌ Failed to add column ${column.name}:`, error);
        }
      } else {
        logger.info(`✓ Column ${column.name} already exists`);
      }
    }

    // Verify the table structure after fixes
    const updatedColumns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'queues' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    logger.info('✅ Updated queues table structure:', updatedColumns);

    // Test a simple query to ensure it works
    logger.info('🧪 Testing queues table query...');
    const testQuery = await sql`
      SELECT id, station_id, user_whatsapp, position, status, 
             estimated_wait_minutes, reservation_expiry, reminder_sent, 
             created_at, updated_at 
      FROM queues 
      LIMIT 1;
    `;
    
    logger.info('✅ Test query successful!');

  } catch (error) {
    logger.error('💥 Failed to fix queues table:', error);
    throw error;
  }
}

// Run the fix
if (require.main === module) {
  fixQueuesTable()
    .then(() => {
      logger.info('🎉 Queues table fix completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ Queues table fix failed:', error);
      process.exit(1);
    });
}

export { fixQueuesTable };