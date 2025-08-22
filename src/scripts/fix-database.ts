// src/scripts/fix-database.ts - Database Fix Script
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

async function fixDatabaseSchema() {
  try {
    logger.info('🔧 Starting database schema fix...');

    // Check if tables exist
    const tableCheckSQL = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('geocode_cache_v2', 'user_search_history');
    `;

    const existingTables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('geocode_cache_v2', 'user_search_history')
    `;
    logger.info('📋 Existing tables:', existingTables);

    // Create geocode_cache_v2 table if it doesn't exist
    if (!existingTables.some((t: any) => t.table_name === 'geocode_cache_v2')) {
      logger.info('📦 Creating geocode_cache_v2 table...');
      
      await sql`
        CREATE TABLE "geocode_cache_v2" (
          "id" serial PRIMARY KEY NOT NULL,
          "search_term" text NOT NULL,
          "original_address" text NOT NULL,
          "latitude" numeric(10, 8) NOT NULL,
          "longitude" numeric(11, 8) NOT NULL,
          "geohash" text NOT NULL,
          "formatted_address" text,
          "locality" text,
          "sub_locality" text,
          "state" text,
          "country" text DEFAULT 'India',
          "postal_code" text,
          "confidence" numeric(3, 2) DEFAULT '1.0',
          "hit_count" integer DEFAULT 1,
          "last_used" timestamp DEFAULT now(),
          "created_at" timestamp DEFAULT now(),
          CONSTRAINT "geocode_cache_v2_search_term_unique" UNIQUE("search_term")
        );
      `;

      // Create indexes
      await sql`CREATE INDEX "geocode_v2_search_term_idx" ON "geocode_cache_v2" USING btree ("search_term");`;
      await sql`CREATE INDEX "geocode_v2_geohash_idx" ON "geocode_cache_v2" USING btree ("geohash");`;
      await sql`CREATE INDEX "geocode_v2_locality_idx" ON "geocode_cache_v2" USING btree ("locality");`;
      
      logger.info('✅ geocode_cache_v2 table created successfully');
    } else {
      logger.info('✓ geocode_cache_v2 table already exists');
    }

    // Create user_search_history table if it doesn't exist
    if (!existingTables.some((t: any) => t.table_name === 'user_search_history')) {
      logger.info('📦 Creating user_search_history table...');
      
      await sql`
        CREATE TABLE "user_search_history" (
          "id" serial PRIMARY KEY NOT NULL,
          "user_whatsapp" varchar(20) NOT NULL,
          "search_term" text NOT NULL,
          "latitude" numeric(10, 8) NOT NULL,
          "longitude" numeric(11, 8) NOT NULL,
          "result_count" integer DEFAULT 0,
          "created_at" timestamp DEFAULT now()
        );
      `;

      // Create indexes
      await sql`CREATE INDEX "search_history_user_idx" ON "user_search_history" USING btree ("user_whatsapp");`;
      await sql`CREATE INDEX "search_history_term_idx" ON "user_search_history" USING btree ("search_term");`;
      await sql`CREATE INDEX "search_history_date_idx" ON "user_search_history" USING btree ("created_at");`;
      
      logger.info('✅ user_search_history table created successfully');
    } else {
      logger.info('✓ user_search_history table already exists');
    }

    // Verify all tables exist
    const finalCheck = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('geocode_cache_v2', 'user_search_history')
    `;
    logger.info('🎯 Final table verification:', finalCheck);

    if (finalCheck.length === 2) {
      logger.info('✅ All missing tables created successfully!');
    } else {
      logger.error('❌ Some tables are still missing');
    }

    // Test a simple insert/select to verify functionality
    try {
      await sql`
        INSERT INTO geocode_cache_v2 (search_term, original_address, latitude, longitude, geohash)
        VALUES ('test', 'Test Address', 13.0827, 80.2707, 'test_geohash')
        ON CONFLICT (search_term) DO NOTHING;
      `;

      const testResult = await sql`
        SELECT * FROM geocode_cache_v2 WHERE search_term = 'test' LIMIT 1;
      `;

      if (testResult.length > 0) {
        logger.info('✅ Table functionality test passed');
        
        // Clean up test data
        await sql`DELETE FROM geocode_cache_v2 WHERE search_term = 'test';`;
      }
    } catch (error) {
      logger.error('❌ Table functionality test failed:', error);
    }

    logger.info('🎉 Database schema fix completed!');
    
  } catch (error) {
    logger.error('💥 Database schema fix failed:', error);
    throw error;
  }
}

// Run if this file is executed directly
if (require.main === module) {
  fixDatabaseSchema()
    .then(() => {
      logger.info('👍 Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('👎 Script failed:', error);
      process.exit(1);
    });
}

export { fixDatabaseSchema };