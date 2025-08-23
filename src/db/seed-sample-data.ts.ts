// src/scripts/seed-sample-data.ts - Comprehensive Sample Data for Location Testing
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { logger } from '../utils/logger';
import { stationOwners, chargingStations, users } from './schema';
import geohash from 'ngeohash'; // You may need to install: npm i ngeohash @types/ngeohash

// Load environment variables
config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

// ===============================================
// SAMPLE DATA DEFINITIONS
// ===============================================

// Station Owners Data
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
    name: 'Priya Sharma',
    phoneNumber: '919876543211',
    email: 'priya.sharma@example.com',
    businessName: 'Green Power Bangalore',
    businessType: 'corporate',
    address: 'Brigade Road, Bangalore, Karnataka',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    isVerified: true,
    kycStatus: 'approved'
  },
  {
    whatsappId: '919876543212',
    name: 'Arjun Patel',
    phoneNumber: '919876543212',
    email: 'arjun.patel@example.com',
    businessName: 'Coimbatore EV Solutions',
    businessType: 'individual',
    address: 'RS Puram, Coimbatore, Tamil Nadu',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    pincode: '641002',
    isVerified: true,
    kycStatus: 'approved'
  },
  {
    whatsappId: '919876543213',
    name: 'Lakshmi Narayanan',
    phoneNumber: '919876543213',
    email: 'lakshmi.n@example.com',
    businessName: 'Mumbai Charge Network',
    businessType: 'corporate',
    address: 'Andheri East, Mumbai, Maharashtra',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400069',
    isVerified: true,
    kycStatus: 'approved'
  },
  {
    whatsappId: '919876543214',
    name: 'Vikram Singh',
    phoneNumber: '919876543214',
    email: 'vikram.singh@example.com',
    businessName: 'Delhi Fast Charge',
    businessType: 'corporate',
    address: 'Connaught Place, New Delhi',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110001',
    isVerified: true,
    kycStatus: 'approved'
  }
];

// Test Users Data
const sampleUsers = [
  {
    whatsappId: '919999999901',
    name: 'Arun Krishnan',
    phoneNumber: '919999999901',
    evModel: 'Tata Nexon EV',
    connectorType: 'CCS2',
    chargingIntent: 'Daily Commute',
    queuePreference: 'Free Now',
    preferencesCaptured: true
  },
  {
    whatsappId: '919999999902',
    name: 'Sneha Reddy',
    phoneNumber: '919999999902',
    evModel: 'MG ZS EV',
    connectorType: 'Type2',
    chargingIntent: 'Long Trip',
    queuePreference: 'Short Queue',
    preferencesCaptured: true
  },
  {
    whatsappId: '919999999903',
    name: 'Rahul Gupta',
    phoneNumber: '919999999903',
    evModel: 'Hyundai Kona Electric',
    connectorType: 'CCS2',
    chargingIntent: 'Emergency',
    queuePreference: 'Free Now',
    preferencesCaptured: true
  },
  {
    whatsappId: '919999999904',
    name: 'Deepika Iyer',
    phoneNumber: '919999999904',
    evModel: 'Mahindra eXUV300',
    connectorType: 'Type2',
    chargingIntent: 'Weekly Top-up',
    queuePreference: 'Short Queue',
    preferencesCaptured: true
  }
];

// Charging Stations Data - Major cities with realistic locations
const sampleStations = [
  // CHENNAI STATIONS
  {
    name: 'Anna Nagar EV Hub',
    address: 'Anna Nagar West, Chennai, Tamil Nadu 600040',
    latitude: 13.0878,
    longitude: 80.2086,
    geohash: geohash.encode(13.0878, 80.2086, 9),
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
    geohash: geohash.encode(13.0827, 80.2707, 9),
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
    geohash: geohash.encode(12.9752, 80.2167, 9),
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
    geohash: geohash.encode(12.8956, 80.2267, 9),
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

  // BANGALORE STATIONS
  {
    name: 'Brigade Road Fast Charge',
    address: 'Brigade Road, Bangalore, Karnataka 560001',
    latitude: 12.9716,
    longitude: 77.5946,
    geohash: geohash.encode(12.9716, 77.5946, 9),
    totalPorts: 8,
    availablePorts: 6,
    connectorTypes: ['Type2', 'CCS2', 'CHAdeMO'],
    maxPowerKw: 80,
    pricePerKwh: 11.00,
    ownerWhatsappId: '919876543211',
    currentQueueLength: 0,
    maxQueueLength: 10,
    averageSessionMinutes: 50,
    operatingHours: {
      monday: '24/7', tuesday: '24/7', wednesday: '24/7',
      thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
    },
    amenities: ['parking', 'wifi', 'restroom', 'food', 'shopping']
  },
  {
    name: 'Forum Mall Charging Center',
    address: 'Hosur Road, Bangalore, Karnataka 560029',
    latitude: 12.9279,
    longitude: 77.6271,
    geohash: geohash.encode(12.9279, 77.6271, 9),
    totalPorts: 6,
    availablePorts: 3,
    connectorTypes: ['CCS2', 'Type2', 'CHAdeMO'],
    maxPowerKw: 90,
    pricePerKwh: 9.75,
    ownerWhatsappId: '919876543211',
    currentQueueLength: 1,
    maxQueueLength: 8,
    averageSessionMinutes: 42,
    operatingHours: {
      monday: '10:00-22:00', tuesday: '10:00-22:00', wednesday: '10:00-22:00',
      thursday: '10:00-22:00', friday: '10:00-22:00', saturday: '10:00-23:00', sunday: '10:00-23:00'
    },
    amenities: ['parking', 'wifi', 'restroom', 'food', 'shopping', 'cinema']
  },
  {
    name: 'Electronic City Hub',
    address: 'Electronic City Phase 1, Bangalore, Karnataka 560100',
    latitude: 12.8456,
    longitude: 77.6603,
    geohash: geohash.encode(12.8456, 77.6603, 9),
    totalPorts: 14,
    availablePorts: 10,
    connectorTypes: ['CCS2', 'Type2'],
    maxPowerKw: 120,
    pricePerKwh: 10.25,
    ownerWhatsappId: '919876543211',
    currentQueueLength: 2,
    maxQueueLength: 16,
    averageSessionMinutes: 35,
    operatingHours: {
      monday: '24/7', tuesday: '24/7', wednesday: '24/7',
      thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
    },
    amenities: ['parking', 'wifi', 'food']
  },

  // COIMBATORE STATIONS
  {
    name: 'RS Puram Charging Point',
    address: 'RS Puram, Coimbatore, Tamil Nadu 641002',
    latitude: 11.0168,
    longitude: 76.9558,
    geohash: geohash.encode(11.0168, 76.9558, 9),
    totalPorts: 4,
    availablePorts: 2,
    connectorTypes: ['CCS2', 'CHAdeMO'],
    maxPowerKw: 75,
    pricePerKwh: 10.50,
    ownerWhatsappId: '919876543212',
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
    geohash: geohash.encode(11.0183, 76.9725, 9),
    totalPorts: 6,
    availablePorts: 4,
    connectorTypes: ['CCS2', 'Type2'],
    maxPowerKw: 50,
    pricePerKwh: 11.75,
    ownerWhatsappId: '919876543212',
    currentQueueLength: 0,
    maxQueueLength: 8,
    averageSessionMinutes: 45,
    operatingHours: {
      monday: '10:00-22:00', tuesday: '10:00-22:00', wednesday: '10:00-22:00',
      thursday: '10:00-22:00', friday: '10:00-22:00', saturday: '10:00-23:00', sunday: '10:00-23:00'
    },
    amenities: ['parking', 'wifi', 'shopping', 'food', 'restroom']
  },

  // MUMBAI STATIONS
  {
    name: 'Andheri East PowerHub',
    address: 'Andheri East, Mumbai, Maharashtra 400069',
    latitude: 19.1136,
    longitude: 72.8697,
    geohash: geohash.encode(19.1136, 72.8697, 9),
    totalPorts: 10,
    availablePorts: 7,
    connectorTypes: ['CCS2', 'Type2', 'CHAdeMO'],
    maxPowerKw: 100,
    pricePerKwh: 14.50,
    ownerWhatsappId: '919876543213',
    currentQueueLength: 1,
    maxQueueLength: 12,
    averageSessionMinutes: 38,
    operatingHours: {
      monday: '24/7', tuesday: '24/7', wednesday: '24/7',
      thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
    },
    amenities: ['parking', 'wifi', 'restroom', 'food']
  },
  {
    name: 'Phoenix Mills Charging Hub',
    address: 'Phoenix Mills, Lower Parel, Mumbai, Maharashtra 400013',
    latitude: 19.0144,
    longitude: 72.8312,
    geohash: geohash.encode(19.0144, 72.8312, 9),
    totalPorts: 12,
    availablePorts: 8,
    connectorTypes: ['CCS2', 'Type2'],
    maxPowerKw: 150,
    pricePerKwh: 16.00,
    ownerWhatsappId: '919876543213',
    currentQueueLength: 2,
    maxQueueLength: 15,
    averageSessionMinutes: 28,
    operatingHours: {
      monday: '10:00-23:00', tuesday: '10:00-23:00', wednesday: '10:00-23:00',
      thursday: '10:00-23:00', friday: '10:00-23:00', saturday: '10:00-23:30', sunday: '10:00-23:30'
    },
    amenities: ['parking', 'wifi', 'restroom', 'food', 'shopping', 'cinema']
  },

  // DELHI STATIONS
  {
    name: 'Connaught Place Central',
    address: 'Connaught Place, New Delhi, Delhi 110001',
    latitude: 28.6304,
    longitude: 77.2177,
    geohash: geohash.encode(28.6304, 77.2177, 9),
    totalPorts: 8,
    availablePorts: 5,
    connectorTypes: ['CCS2', 'Type2', 'CHAdeMO'],
    maxPowerKw: 120,
    pricePerKwh: 13.25,
    ownerWhatsappId: '919876543214',
    currentQueueLength: 1,
    maxQueueLength: 10,
    averageSessionMinutes: 42,
    operatingHours: {
      monday: '24/7', tuesday: '24/7', wednesday: '24/7',
      thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
    },
    amenities: ['parking', 'wifi', 'restroom', 'food', 'shopping']
  },
  {
    name: 'Cyber City Gurgaon Hub',
    address: 'DLF Cyber City, Gurgaon, Haryana 122002',
    latitude: 28.4948,
    longitude: 77.0850,
    geohash: geohash.encode(28.4948, 77.0850, 9),
    totalPorts: 16,
    availablePorts: 11,
    connectorTypes: ['CCS2', 'Type2'],
    maxPowerKw: 180,
    pricePerKwh: 12.50,
    ownerWhatsappId: '919876543214',
    currentQueueLength: 3,
    maxQueueLength: 20,
    averageSessionMinutes: 32,
    operatingHours: {
      monday: '24/7', tuesday: '24/7', wednesday: '24/7',
      thursday: '24/7', friday: '24/7', saturday: '24/7', sunday: '24/7'
    },
    amenities: ['parking', 'wifi', 'food']
  }
];

// ===============================================
// SEEDER FUNCTIONS
// ===============================================

async function seedStationOwners() {
  try {
    logger.info('🏢 Seeding station owners...');
    
    for (const owner of sampleOwners) {
      try {
        const result = await db
          .insert(stationOwners)
          .values({
            whatsappId: owner.whatsappId,
            name: owner.name,
            phoneNumber: owner.phoneNumber,
            email: owner.email,
            businessName: owner.businessName,
            businessType: owner.businessType as 'individual' | 'corporate' | 'franchise',
            address: owner.address,
            city: owner.city,
            state: owner.state,
            pincode: owner.pincode,
            isVerified: owner.isVerified,
            kycStatus: owner.kycStatus as 'pending' | 'submitted' | 'approved' | 'rejected',
            totalStations: 0,
            totalRevenue: '0',
            averageRating: '0'
          })
          .onConflictDoNothing()
          .returning();

        if (result.length > 0) {
          logger.info(`✅ Created owner: ${owner.name} (${owner.whatsappId})`);
        } else {
          logger.info(`ℹ️ Owner already exists: ${owner.name} (${owner.whatsappId})`);
        }
      } catch (error) {
        logger.error(`❌ Failed to create owner ${owner.name}:`, error);
      }
    }
  } catch (error) {
    logger.error('❌ Failed to seed station owners:', error);
    throw error;
  }
}

async function seedUsers() {
  try {
    logger.info('👥 Seeding test users...');
    
    for (const user of sampleUsers) {
      try {
        const result = await db
          .insert(users)
          .values({
            whatsappId: user.whatsappId,
            name: user.name,
            phoneNumber: user.phoneNumber,
            evModel: user.evModel,
            connectorType: user.connectorType as 'Type2' | 'CCS2' | 'CHAdeMO',
            chargingIntent: user.chargingIntent,
            queuePreference: user.queuePreference as 'Free Now' | 'Short Queue' | 'Any',
            preferencesCaptured: user.preferencesCaptured,
            totalBookings: 0,
            totalSessions: 0,
            totalEnergyConsumed: '0'
          })
          .onConflictDoNothing()
          .returning();

        if (result.length > 0) {
          logger.info(`✅ Created user: ${user.name} (${user.whatsappId})`);
        } else {
          logger.info(`ℹ️ User already exists: ${user.name} (${user.whatsappId})`);
        }
      } catch (error) {
        logger.error(`❌ Failed to create user ${user.name}:`, error);
      }
    }
  } catch (error) {
    logger.error('❌ Failed to seed users:', error);
    throw error;
  }
}

async function seedChargingStations() {
  try {
    logger.info('⚡ Seeding charging stations...');
    
    for (const station of sampleStations) {
      try {
        const result = await db
          .insert(chargingStations)
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
          logger.info(`✅ Created station: ${station.name} (${station.ownerWhatsappId})`);
        } else {
          logger.info(`ℹ️ Station already exists: ${station.name}`);
        }
      } catch (error) {
        logger.error(`❌ Failed to create station ${station.name}:`, error);
      }
    }
  } catch (error) {
    logger.error('❌ Failed to seed charging stations:', error);
    throw error;
  }
}

async function updateOwnerStationCounts() {
  try {
    logger.info('🔄 Updating owner station counts...');
    
    // Count stations per owner and update
    for (const owner of sampleOwners) {
      const stationCount = sampleStations.filter(s => s.ownerWhatsappId === owner.whatsappId).length;
      
      if (stationCount > 0) {
        await sql`
          UPDATE station_owners 
          SET total_stations = ${stationCount}
          WHERE whatsapp_id = ${owner.whatsappId}
        `;
        logger.info(`✅ Updated ${owner.name}: ${stationCount} stations`);
      }
    }
  } catch (error) {
    logger.error('❌ Failed to update owner station counts:', error);
    throw error;
  }
}

// ===============================================
// MAIN SEEDER FUNCTION
// ===============================================

async function seedSampleData() {
  try {
    logger.info('🌱 Starting sample data seeding...');
    
    // Seed in order: owners -> users -> stations -> update counts
    await seedStationOwners();
    await seedUsers();
    await seedChargingStations();
    await updateOwnerStationCounts();
    
    logger.info('🎉 Sample data seeding completed successfully!');
    
    // Show summary
    const ownerCount = sampleOwners.length;
    const userCount = sampleUsers.length;
    const stationCount = sampleStations.length;
    
    logger.info(`📊 Summary:`);
    logger.info(`   - Station Owners: ${ownerCount}`);
    logger.info(`   - Test Users: ${userCount}`);
    logger.info(`   - Charging Stations: ${stationCount}`);
    logger.info(`   - Cities Covered: Chennai, Bangalore, Coimbatore, Mumbai, Delhi`);
    
    // Test user information
    logger.info(`\n🧪 Test User WhatsApp IDs:`);
    sampleUsers.forEach(user => {
      logger.info(`   - ${user.name}: ${user.whatsappId} (${user.evModel}, ${user.connectorType})`);
    });
    
    logger.info(`\n📍 Test Locations:`);
    logger.info(`   - Anna Nagar, Chennai - Multiple stations nearby`);
    logger.info(`   - Brigade Road, Bangalore - Fast charging available`);
    logger.info(`   - RS Puram, Coimbatore - Smaller city testing`);
    logger.info(`   - Andheri East, Mumbai - Metropolitan area`);
    logger.info(`   - Connaught Place, Delhi - Central location`);

  } catch (error) {
    logger.error('💥 Sample data seeding failed:', error);
    throw error;
  }
}

// ===============================================
// CLI RUNNER
// ===============================================

if (require.main === module) {
  seedSampleData()
    .then(() => {
      logger.info('👍 Seeding completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('👎 Seeding failed:', error);
      process.exit(1);
    });
}

export { seedSampleData, sampleOwners, sampleUsers, sampleStations };