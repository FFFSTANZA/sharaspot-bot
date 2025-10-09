"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDatabaseStructure = checkDatabaseStructure;
const neon_http_1 = require("drizzle-orm/neon-http");
const serverless_1 = require("@neondatabase/serverless");
const dotenv_1 = require("dotenv");
const logger_1 = require("../utils/logger");
(0, dotenv_1.config)({ path: '.env' });
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}
const sql = (0, serverless_1.neon)(process.env.DATABASE_URL);
const db = (0, neon_http_1.drizzle)(sql);
async function checkDatabaseStructure() {
    try {
        logger_1.logger.info('🔍 Checking actual database structure...');
        logger_1.logger.info('\n📋 1. Checking station_owners table structure:');
        const stationOwnersColumns = await sql `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'station_owners' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
        if (stationOwnersColumns.length === 0) {
            logger_1.logger.error('❌ station_owners table does not exist!');
        }
        else {
            logger_1.logger.info('✅ station_owners table found with columns:');
            stationOwnersColumns.forEach((col) => {
                logger_1.logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
            });
        }
        logger_1.logger.info('\n📋 2. Checking users table structure:');
        const usersColumns = await sql `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
        if (usersColumns.length === 0) {
            logger_1.logger.error('❌ users table does not exist!');
        }
        else {
            logger_1.logger.info('✅ users table found with columns:');
            usersColumns.forEach((col) => {
                logger_1.logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
            });
        }
        logger_1.logger.info('\n📋 3. Checking charging_stations table structure:');
        const stationsColumns = await sql `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'charging_stations' 
      AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
        if (stationsColumns.length === 0) {
            logger_1.logger.error('❌ charging_stations table does not exist!');
        }
        else {
            logger_1.logger.info('✅ charging_stations table found with columns:');
            stationsColumns.forEach((col) => {
                logger_1.logger.info(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
            });
        }
        logger_1.logger.info('\n📋 4. All tables in the database:');
        const allTables = await sql `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
        allTables.forEach((table) => {
            logger_1.logger.info(`   - ${table.table_name}`);
        });
        logger_1.logger.info('\n🧪 5. Testing simple insert into station_owners:');
        try {
            const testInsert = await sql `
        INSERT INTO station_owners (whatsapp_id, name) 
        VALUES ('test123', 'Test Owner') 
        ON CONFLICT (whatsapp_id) DO NOTHING
        RETURNING *;
      `;
            if (testInsert.length > 0) {
                logger_1.logger.info('✅ Simple insert successful! Columns that work:');
                Object.keys(testInsert[0]).forEach(key => {
                    logger_1.logger.info(`   - ${key}: ${testInsert[0][key]}`);
                });
                await sql `DELETE FROM station_owners WHERE whatsapp_id = 'test123';`;
            }
            else {
                logger_1.logger.info('ℹ️ Insert was ignored (ON CONFLICT)');
            }
        }
        catch (insertError) {
            logger_1.logger.error('❌ Simple insert failed:', insertError);
        }
        logger_1.logger.info('\n🎯 Summary:');
        logger_1.logger.info('Database structure check completed. Check the logs above for details.');
    }
    catch (error) {
        logger_1.logger.error('💥 Database structure check failed:', error);
        throw error;
    }
}
if (require.main === module) {
    checkDatabaseStructure()
        .then(() => {
        logger_1.logger.info('👍 Database check completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        logger_1.logger.error('👎 Database check failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=check-database.js.map