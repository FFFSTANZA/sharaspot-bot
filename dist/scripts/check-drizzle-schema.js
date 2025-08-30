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
exports.checkDrizzleSchema = checkDrizzleSchema;
exports.testManualInsert = testManualInsert;
const logger_1 = require("../utils/logger");
const schema_1 = require("../db/schema");
const drizzle_orm_1 = require("drizzle-orm");
function checkDrizzleSchema() {
    try {
        logger_1.logger.info('🔍 Checking Drizzle schema definitions...');
        logger_1.logger.info('\n📋 1. Drizzle stationOwners schema:');
        const stationOwnersConfig = schema_1.stationOwners[Symbol.for('drizzle:Table')];
        const stationOwnersColumns = stationOwnersConfig?.columns || {};
        Object.keys(stationOwnersColumns).forEach(columnKey => {
            const column = stationOwnersColumns[columnKey];
            logger_1.logger.info(`   - ${columnKey} (${column.name}): ${column.dataType} ${column.notNull ? 'NOT NULL' : 'NULLABLE'}`);
        });
        logger_1.logger.info('\n📋 2. Drizzle users schema:');
        const usersConfig = schema_1.users[Symbol.for('drizzle:Table')];
        const usersColumns = usersConfig?.columns || {};
        Object.keys(usersColumns).forEach(columnKey => {
            const column = usersColumns[columnKey];
            logger_1.logger.info(`   - ${columnKey} (${column.name}): ${column.dataType} ${column.notNull ? 'NOT NULL' : 'NULLABLE'}`);
        });
        logger_1.logger.info('\n📋 3. Drizzle chargingStations schema:');
        const stationsConfig = schema_1.chargingStations[Symbol.for('drizzle:Table')];
        const stationsColumns = stationsConfig?.columns || {};
        Object.keys(stationsColumns).forEach(columnKey => {
            const column = stationsColumns[columnKey];
            logger_1.logger.info(`   - ${columnKey} (${column.name}): ${column.dataType} ${column.notNull ? 'NOT NULL' : 'NULLABLE'}`);
        });
        logger_1.logger.info('\n📋 4. Drizzle table names:');
        logger_1.logger.info(`   - stationOwners table name: ${stationOwnersConfig?.name}`);
        logger_1.logger.info(`   - users table name: ${usersConfig?.name}`);
        logger_1.logger.info(`   - chargingStations table name: ${stationsConfig?.name}`);
        logger_1.logger.info('\n📋 5. What Drizzle expects for station_owners insert:');
        logger_1.logger.info('   Expected columns for insert:');
        Object.keys(stationOwnersColumns).forEach(columnKey => {
            const column = stationOwnersColumns[columnKey];
            if (!column.generated) {
                logger_1.logger.info(`   - ${column.name}`);
            }
        });
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to check Drizzle schema:', error);
    }
}
async function testManualInsert() {
    try {
        logger_1.logger.info('\n🧪 Testing manual insert with minimal data...');
        const { db } = await Promise.resolve().then(() => __importStar(require('../config/database')));
        const simpleOwner = {
            whatsappId: 'test_manual_123',
            name: 'Test Manual Owner'
        };
        logger_1.logger.info('Attempting insert with data:', simpleOwner);
        const result = await db.insert(schema_1.stationOwners).values(simpleOwner).onConflictDoNothing().returning();
        if (result.length > 0) {
            logger_1.logger.info('✅ Manual insert successful:', result[0]);
            await db.delete(schema_1.stationOwners).where((0, drizzle_orm_1.eq)(schema_1.stationOwners.whatsappId, 'test_manual_123'));
            logger_1.logger.info('✅ Test data cleaned up');
        }
        else {
            logger_1.logger.info('ℹ️ Insert was ignored (conflict)');
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Manual insert test failed:', error);
    }
}
if (require.main === module) {
    checkDrizzleSchema();
    testManualInsert()
        .then(() => {
        logger_1.logger.info('👍 Schema check completed');
        process.exit(0);
    })
        .catch((error) => {
        logger_1.logger.error('👎 Schema check failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=check-drizzle-schema.js.map