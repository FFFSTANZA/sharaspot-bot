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
const database_1 = require("../config/database");
const logger_1 = require("../utils/logger");
function toColumnInfoArray(rows) {
    return rows.map(row => ({
        column_name: String(row.column_name || ''),
        data_type: String(row.data_type || ''),
        character_maximum_length: row.character_maximum_length !== null && row.character_maximum_length !== undefined
            ? Number(row.character_maximum_length)
            : null,
        is_nullable: String(row.is_nullable || ''),
        column_default: row.column_default !== null && row.column_default !== undefined
            ? String(row.column_default)
            : null
    }));
}
async function checkAndFixColumnLengths() {
    try {
        logger_1.logger.info('🔍 Checking column lengths for station_owners...');
        const columnInfo = await database_1.db.execute(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length,
        is_nullable,
        column_default
      FROM information_schema.columns 
      WHERE table_name = 'station_owners' 
      AND data_type = 'character varying'
      ORDER BY ordinal_position;
    `);
        logger_1.logger.info('Current VARCHAR column lengths:', { columns: columnInfo.rows });
        const columnInfos = toColumnInfoArray(columnInfo.rows);
        const problematicColumns = columnInfos.filter(col => col.character_maximum_length && col.character_maximum_length < 100);
        if (problematicColumns.length > 0) {
            logger_1.logger.info('📏 Found columns with potentially short lengths:', { columns: problematicColumns });
            for (const col of problematicColumns) {
                const columnName = col.column_name;
                logger_1.logger.info(`🔧 Extending ${columnName} to VARCHAR(255)...`);
                try {
                    await database_1.db.execute(`ALTER TABLE station_owners ALTER COLUMN ${columnName} TYPE VARCHAR(255)`);
                    logger_1.logger.info(`✅ Successfully extended ${columnName} to VARCHAR(255)`);
                }
                catch (error) {
                    logger_1.logger.error(`❌ Failed to extend ${columnName}:`, error);
                }
            }
        }
        else {
            logger_1.logger.info('✅ All VARCHAR columns have adequate lengths');
        }
        const updatedColumnInfo = await database_1.db.execute(`
      SELECT 
        column_name, 
        data_type, 
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'station_owners' 
      AND data_type = 'character varying'
      ORDER BY ordinal_position;
    `);
        logger_1.logger.info('Updated column lengths:', { columns: updatedColumnInfo.rows });
        logger_1.logger.info('🧪 Testing insert with shorter test data...');
        const { stationOwners } = await Promise.resolve().then(() => __importStar(require('../db/schema')));
        const testResult = await database_1.db
            .insert(stationOwners)
            .values({
            whatsappId: 'test_short_' + Date.now().toString().slice(-6),
            name: 'Test Owner',
        })
            .onConflictDoNothing()
            .returning();
        logger_1.logger.info('✅ Test insert successful!', { result: testResult });
        logger_1.logger.info('🎉 Column length fix completed successfully!');
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to check/fix column lengths:', error);
        throw error;
    }
}
if (require.main === module) {
    checkAndFixColumnLengths()
        .then(() => {
        logger_1.logger.info('👍 Script completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        logger_1.logger.error('💥 Script failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=check-column-lengths.js.map