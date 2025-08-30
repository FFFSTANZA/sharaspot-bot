"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sampleStations = exports.sampleOwners = void 0;
exports.seedSampleData = seedSampleData;
const neon_http_1 = require("drizzle-orm/neon-http");
const serverless_1 = require("@neondatabase/serverless");
const dotenv_1 = require("dotenv");
const logger_1 = require("../utils/logger");
const schema_1 = require("../db/schema");
const ngeohash_1 = __importDefault(require("ngeohash"));
(0, dotenv_1.config)({ path: '.env' });
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}
const sql = (0, serverless_1.neon)(process.env.DATABASE_URL);
const db = (0, neon_http_1.drizzle)(sql);
const sampleOwners = [
    {
        whatsappId: '919876543210',
        name: 'Rajesh Kumar',
        phoneNumber: '919876543210',
        email: 'rajesh.kumar@example.com',
        businessName: 'EV Hub Chennai',
        businessType: 'corporate',
        address: 'Anna Nagar, Chennai, Tamil Nadu',
        city: 'Chennai',
        state: 'Tamil Nadu',
        pincode: '600040',
        isVerified: true,
        kycStatus: 'approved'
    },
    {
        whatsappId: '919876543211',
        name: 'Priya Sundaram',
        phoneNumber: '919876543211',
        email: 'priya.sundaram@example.com',
        businessName: 'Coimbatore EV Solutions',
        businessType: 'corporate',
        address: 'RS Puram, Coimbatore, Tamil Nadu',
        city: 'Coimbatore',
        state: 'Tamil Nadu',
        pincode: '641002',
        isVerified: true,
        kycStatus: 'approved'
    },
    {
        whatsappId: '919876543212',
        name: 'Arunachalam M',
        phoneNumber: '919876543212',
        email: 'arunachalam.m@example.com',
        businessName: 'Madurai Green Energy',
        businessType: 'individual',
        address: 'KK Nagar, Madurai, Tamil Nadu',
        city: 'Madurai',
        state: 'Tamil Nadu',
        pincode: '625020',
        isVerified: true,
        kycStatus: 'approved'
    },
    {
        whatsappId: '919876543213',
        name: 'Lakshmi Narayanan',
        phoneNumber: '919876543213',
        email: 'lakshmi.n@example.com',
        businessName: 'Trichy Charge Point',
        businessType: 'individual',
        address: 'BHEL Township, Trichy, Tamil Nadu',
        city: 'Trichy',
        state: 'Tamil Nadu',
        pincode: '620014',
        isVerified: true,
        kycStatus: 'approved'
    }
];
exports.sampleOwners = sampleOwners;
const sampleStations = [
    {
        name: 'Anna Nagar EV Hub',
        address: 'Anna Nagar West, Chennai, Tamil Nadu 600040',
        latitude: 13.0878,
        longitude: 80.2086,
        geohash: ngeohash_1.default.encode(13.0878, 80.2086, 9),
        totalPorts: 6,
        availablePorts: 4,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 50,
        pricePerKwh: 12.00,
        ownerWhatsappId: '919876543210',
        currentQueueLength: 0,
        maxQueueLength: 8,
        averageSessionMinutes: 45,
        operatingHours: {
            monday: '24/7', tuesday: '24/7', wednesday: '24/7',
            thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
        },
        amenities: ['parking', 'wifi', 'restroom', 'food']
    },
    {
        name: 'T.Nagar Express Charging',
        address: 'T.Nagar, Chennai, Tamil Nadu 600017',
        latitude: 13.0827,
        longitude: 80.2707,
        geohash: ngeohash_1.default.encode(13.0827, 80.2707, 9),
        totalPorts: 8,
        availablePorts: 6,
        connectorTypes: ['CCS2', 'Type2', 'CHAdeMO'],
        maxPowerKw: 75,
        pricePerKwh: 13.50,
        ownerWhatsappId: '919876543210',
        currentQueueLength: 1,
        maxQueueLength: 10,
        averageSessionMinutes: 35,
        operatingHours: {
            monday: '06:00-22:00', tuesday: '06:00-22:00', wednesday: '06:00-22:00',
            thursday: '06:00-22:00', friday: '06:00-22:00', saturday: '24/7', sunday: '24/7'
        },
        amenities: ['parking', 'wifi', 'shopping']
    },
    {
        name: 'Phoenix MarketCity Hub',
        address: 'Velachery Main Road, Chennai, Tamil Nadu 600042',
        latitude: 12.9752,
        longitude: 80.2167,
        geohash: ngeohash_1.default.encode(12.9752, 80.2167, 9),
        totalPorts: 10,
        availablePorts: 7,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 100,
        pricePerKwh: 15.00,
        ownerWhatsappId: '919876543210',
        currentQueueLength: 2,
        maxQueueLength: 12,
        averageSessionMinutes: 30,
        operatingHours: {
            monday: '10:00-22:00', tuesday: '10:00-22:00', wednesday: '10:00-22:00',
            thursday: '10:00-22:00', friday: '10:00-22:00', saturday: '10:00-23:00', sunday: '10:00-23:00'
        },
        amenities: ['parking', 'wifi', 'restroom', 'food', 'shopping', 'cinema']
    },
    {
        name: 'OMR Tech Park Station',
        address: 'Old Mahabalipuram Road, Chennai, Tamil Nadu 600096',
        latitude: 12.8956,
        longitude: 80.2267,
        geohash: ngeohash_1.default.encode(12.8956, 80.2267, 9),
        totalPorts: 12,
        availablePorts: 8,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 60,
        pricePerKwh: 11.50,
        ownerWhatsappId: '919876543210',
        currentQueueLength: 1,
        maxQueueLength: 15,
        averageSessionMinutes: 40,
        operatingHours: {
            monday: '24/7', tuesday: '24/7', wednesday: '24/7',
            thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
        },
        amenities: ['parking', 'wifi', 'food']
    },
    {
        name: 'RS Puram Charging Point',
        address: 'RS Puram, Coimbatore, Tamil Nadu 641002',
        latitude: 11.0168,
        longitude: 76.9558,
        geohash: ngeohash_1.default.encode(11.0168, 76.9558, 9),
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['CCS2', 'CHAdeMO'],
        maxPowerKw: 75,
        pricePerKwh: 10.50,
        ownerWhatsappId: '919876543211',
        currentQueueLength: 1,
        maxQueueLength: 6,
        averageSessionMinutes: 40,
        operatingHours: {
            monday: '06:00-22:00', tuesday: '06:00-22:00', wednesday: '06:00-22:00',
            thursday: '06:00-22:00', friday: '06:00-22:00', saturday: '06:00-22:00', sunday: '06:00-22:00'
        },
        amenities: ['parking', 'wifi']
    },
    {
        name: 'Brookefields Mall Station',
        address: 'Brookefields Mall, Coimbatore, Tamil Nadu 641001',
        latitude: 11.0183,
        longitude: 76.9725,
        geohash: ngeohash_1.default.encode(11.0183, 76.9725, 9),
        totalPorts: 6,
        availablePorts: 4,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 50,
        pricePerKwh: 11.75,
        ownerWhatsappId: '919876543211',
        currentQueueLength: 0,
        maxQueueLength: 8,
        averageSessionMinutes: 45,
        operatingHours: {
            monday: '10:00-22:00', tuesday: '10:00-22:00', wednesday: '10:00-22:00',
            thursday: '10:00-22:00', friday: '10:00-22:00', saturday: '10:00-23:00', sunday: '10:00-23:00'
        },
        amenities: ['parking', 'wifi', 'shopping', 'food', 'restroom']
    },
    {
        name: 'Peelamedu Industrial Hub',
        address: 'Peelamedu, Coimbatore, Tamil Nadu 641004',
        latitude: 11.0256,
        longitude: 77.0233,
        geohash: ngeohash_1.default.encode(11.0256, 77.0233, 9),
        totalPorts: 8,
        availablePorts: 6,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 80,
        pricePerKwh: 10.00,
        ownerWhatsappId: '919876543211',
        currentQueueLength: 0,
        maxQueueLength: 10,
        averageSessionMinutes: 38,
        operatingHours: {
            monday: '24/7', tuesday: '24/7', wednesday: '24/7',
            thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
        },
        amenities: ['parking', 'wifi', 'food']
    },
    {
        name: 'KK Nagar Charging Center',
        address: 'KK Nagar, Madurai, Tamil Nadu 625020',
        latitude: 9.9391,
        longitude: 78.1219,
        geohash: ngeohash_1.default.encode(9.9391, 78.1219, 9),
        totalPorts: 5,
        availablePorts: 3,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 60,
        pricePerKwh: 11.25,
        ownerWhatsappId: '919876543212',
        currentQueueLength: 1,
        maxQueueLength: 7,
        averageSessionMinutes: 42,
        operatingHours: {
            monday: '06:00-22:00', tuesday: '06:00-22:00', wednesday: '06:00-22:00',
            thursday: '06:00-22:00', friday: '06:00-22:00', saturday: '06:00-22:00', sunday: '06:00-22:00'
        },
        amenities: ['parking', 'wifi', 'restroom']
    },
    {
        name: 'Meenakshi Temple Charging',
        address: 'Near Meenakshi Temple, Madurai, Tamil Nadu 625001',
        latitude: 9.9196,
        longitude: 78.1193,
        geohash: ngeohash_1.default.encode(9.9196, 78.1193, 9),
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['Type2', 'CHAdeMO'],
        maxPowerKw: 45,
        pricePerKwh: 12.50,
        ownerWhatsappId: '919876543212',
        currentQueueLength: 2,
        maxQueueLength: 6,
        averageSessionMinutes: 48,
        operatingHours: {
            monday: '06:00-21:00', tuesday: '06:00-21:00', wednesday: '06:00-21:00',
            thursday: '06:00-21:00', friday: '06:00-21:00', saturday: '06:00-21:00', sunday: '06:00-21:00'
        },
        amenities: ['parking']
    },
    {
        name: 'BHEL Township Charging',
        address: 'BHEL Township, Trichy, Tamil Nadu 620014',
        latitude: 10.8055,
        longitude: 78.6978,
        geohash: ngeohash_1.default.encode(10.8055, 78.6978, 9),
        totalPorts: 6,
        availablePorts: 4,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 70,
        pricePerKwh: 10.75,
        ownerWhatsappId: '919876543213',
        currentQueueLength: 0,
        maxQueueLength: 8,
        averageSessionMinutes: 40,
        operatingHours: {
            monday: '24/7', tuesday: '24/7', wednesday: '24/7',
            thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
        },
        amenities: ['parking', 'wifi', 'restroom']
    },
    {
        name: 'Trichy Central Station',
        address: 'Central Bus Stand, Trichy, Tamil Nadu 620001',
        latitude: 10.7905,
        longitude: 78.7047,
        geohash: ngeohash_1.default.encode(10.7905, 78.7047, 9),
        totalPorts: 8,
        availablePorts: 5,
        connectorTypes: ['CCS2', 'Type2', 'CHAdeMO'],
        maxPowerKw: 90,
        pricePerKwh: 11.00,
        ownerWhatsappId: '919876543213',
        currentQueueLength: 1,
        maxQueueLength: 10,
        averageSessionMinutes: 35,
        operatingHours: {
            monday: '05:00-23:00', tuesday: '05:00-23:00', wednesday: '05:00-23:00',
            thursday: '05:00-23:00', friday: '05:00-23:00', saturday: '05:00-23:00', sunday: '05:00-23:00'
        },
        amenities: ['parking', 'wifi', 'food', 'restroom']
    },
    {
        name: 'Salem City Center',
        address: 'City Center, Salem, Tamil Nadu 636001',
        latitude: 11.6643,
        longitude: 78.1460,
        geohash: ngeohash_1.default.encode(11.6643, 78.1460, 9),
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['Type2', 'CHAdeMO'],
        maxPowerKw: 50,
        pricePerKwh: 11.50,
        ownerWhatsappId: '919876543210',
        currentQueueLength: 0,
        maxQueueLength: 6,
        averageSessionMinutes: 45,
        operatingHours: {
            monday: '06:00-22:00', tuesday: '06:00-22:00', wednesday: '06:00-22:00',
            thursday: '06:00-22:00', friday: '06:00-22:00', saturday: '06:00-22:00', sunday: '06:00-22:00'
        },
        amenities: ['parking', 'wifi']
    },
    {
        name: 'Tirunelveli Junction',
        address: 'Railway Station Road, Tirunelveli, Tamil Nadu 627001',
        latitude: 8.7139,
        longitude: 77.7567,
        geohash: ngeohash_1.default.encode(8.7139, 77.7567, 9),
        totalPorts: 3,
        availablePorts: 1,
        connectorTypes: ['Type2'],
        maxPowerKw: 40,
        pricePerKwh: 12.00,
        ownerWhatsappId: '919876543212',
        currentQueueLength: 1,
        maxQueueLength: 5,
        averageSessionMinutes: 50,
        operatingHours: {
            monday: '06:00-21:00', tuesday: '06:00-21:00', wednesday: '06:00-21:00',
            thursday: '06:00-21:00', friday: '06:00-21:00', saturday: '06:00-21:00', sunday: '06:00-21:00'
        },
        amenities: ['parking']
    }
];
exports.sampleStations = sampleStations;
async function seedStationOwners() {
    try {
        logger_1.logger.info('🏢 Seeding station owners...');
        for (const owner of sampleOwners) {
            try {
                const result = await db
                    .insert(schema_1.stationOwners)
                    .values({
                    whatsappId: owner.whatsappId,
                    name: owner.name,
                    phoneNumber: owner.phoneNumber,
                    email: owner.email,
                    businessName: owner.businessName,
                    businessType: owner.businessType,
                    address: owner.address,
                    city: owner.city,
                    state: owner.state,
                    pincode: owner.pincode,
                    isVerified: owner.isVerified,
                    kycStatus: owner.kycStatus,
                    totalStations: 0,
                    totalRevenue: '0',
                    averageRating: '0'
                })
                    .onConflictDoNothing()
                    .returning();
                if (result.length > 0) {
                    logger_1.logger.info(`✅ Created owner: ${owner.name} (${owner.whatsappId})`);
                }
                else {
                    logger_1.logger.info(`ℹ️ Owner already exists: ${owner.name} (${owner.whatsappId})`);
                }
            }
            catch (error) {
                logger_1.logger.error(`❌ Failed to create owner ${owner.name}:`, error);
            }
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to seed station owners:', error);
        throw error;
    }
}
async function seedChargingStations() {
    try {
        logger_1.logger.info('⚡ Seeding charging stations...');
        for (const station of sampleStations) {
            try {
                const result = await db
                    .insert(schema_1.chargingStations)
                    .values({
                    name: station.name,
                    address: station.address,
                    latitude: station.latitude.toString(),
                    longitude: station.longitude.toString(),
                    geohash: station.geohash,
                    totalPorts: station.totalPorts,
                    availablePorts: station.availablePorts,
                    connectorTypes: station.connectorTypes,
                    maxPowerKw: station.maxPowerKw,
                    pricePerKwh: station.pricePerKwh.toString(),
                    ownerWhatsappId: station.ownerWhatsappId,
                    currentQueueLength: station.currentQueueLength,
                    maxQueueLength: station.maxQueueLength,
                    averageSessionMinutes: station.averageSessionMinutes,
                    operatingHours: station.operatingHours,
                    amenities: station.amenities,
                    isActive: true,
                    isOpen: true,
                    isPaused: false,
                    maintenanceMode: false,
                    totalSessions: 0,
                    totalEnergyDelivered: '0',
                    totalRevenue: '0',
                    averageRating: '0',
                    reviewCount: 0
                })
                    .onConflictDoNothing()
                    .returning();
                if (result.length > 0) {
                    logger_1.logger.info(`✅ Created station: ${station.name} (${station.ownerWhatsappId})`);
                }
                else {
                    logger_1.logger.info(`ℹ️ Station already exists: ${station.name}`);
                }
            }
            catch (error) {
                logger_1.logger.error(`❌ Failed to create station ${station.name}:`, error);
            }
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to seed charging stations:', error);
        throw error;
    }
}
async function updateOwnerStationCounts() {
    try {
        logger_1.logger.info('🔄 Updating owner station counts...');
        for (const owner of sampleOwners) {
            const stationCount = sampleStations.filter(s => s.ownerWhatsappId === owner.whatsappId).length;
            if (stationCount > 0) {
                await sql `
          UPDATE station_owners 
          SET total_stations = ${stationCount}
          WHERE whatsapp_id = ${owner.whatsappId}
        `;
                logger_1.logger.info(`✅ Updated ${owner.name}: ${stationCount} stations`);
            }
        }
    }
    catch (error) {
        logger_1.logger.error('❌ Failed to update owner station counts:', error);
        throw error;
    }
}
async function seedSampleData() {
    try {
        logger_1.logger.info('🌱 Starting Tamil Nadu sample data seeding...');
        await seedStationOwners();
        await seedChargingStations();
        await updateOwnerStationCounts();
        logger_1.logger.info('🎉 Tamil Nadu sample data seeding completed successfully!');
        const ownerCount = sampleOwners.length;
        const stationCount = sampleStations.length;
        logger_1.logger.info(`📊 Summary:`);
        logger_1.logger.info(`   - Station Owners: ${ownerCount}`);
        logger_1.logger.info(`   - Charging Stations: ${stationCount}`);
        logger_1.logger.info(`   - Cities Covered: Chennai, Coimbatore, Madurai, Trichy, Salem, Tirunelveli`);
        logger_1.logger.info(`\n📍 Tamil Nadu Test Locations:`);
        logger_1.logger.info(`   - Chennai: 4 stations (Anna Nagar, T.Nagar, Velachery, OMR)`);
        logger_1.logger.info(`   - Coimbatore: 3 stations (RS Puram, Brookefields, Peelamedu)`);
        logger_1.logger.info(`   - Madurai: 2 stations (KK Nagar, Meenakshi Temple)`);
        logger_1.logger.info(`   - Trichy: 2 stations (BHEL Township, Central Bus Stand)`);
        logger_1.logger.info(`   - Salem: 1 station (City Center)`);
        logger_1.logger.info(`   - Tirunelveli: 1 station (Railway Station Road)`);
    }
    catch (error) {
        logger_1.logger.error('💥 Sample data seeding failed:', error);
        throw error;
    }
}
if (require.main === module) {
    seedSampleData()
        .then(() => {
        logger_1.logger.info('👍 Tamil Nadu seeding completed successfully');
        process.exit(0);
    })
        .catch((error) => {
        logger_1.logger.error('👎 Seeding failed:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=seed-sample-data.ts.js.map