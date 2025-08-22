// src/db/seed-tamil-nadu-data.ts - FIXED VERSION TO MATCH CURRENT SCHEMA
import { db } from '../config/database';
import { users, stationOwners, chargingStations } from './schema';
import { logger } from '../utils/logger';

export async function seedTamilNaduData(): Promise<void> {
  try {
    logger.info('🌱 Seeding Tamil Nadu EV charging stations...');

    // Step 1: Create station owners (ONLY whatsappId and name - matches current schema)
    const owners = [
      { whatsappId: '919876543210', name: 'TN Green Energy Solutions' },
      { whatsappId: '919876543211', name: 'Chennai PowerHub' },
      { whatsappId: '919876543212', name: 'Coimbatore EcoCharge' },
      { whatsappId: '919876543213', name: 'Madurai FastCharge' },
      { whatsappId: '919876543214', name: 'Salem EV Station' },
    ];

    await db.insert(stationOwners).values(owners).onConflictDoNothing();
    logger.info(`✅ Created ${owners.length} station owners`);

    // Step 2: Create test users
    const testUsers = [
      { whatsappId: '919999999901', name: 'Chennai User', phoneNumber: '919999999901' },
      { whatsappId: '919999999902', name: 'Coimbatore User', phoneNumber: '919999999902' },
      { whatsappId: '919999999903', name: 'Madurai User', phoneNumber: '919999999903' },
      { whatsappId: '919999999904', name: 'Salem User', phoneNumber: '919999999904' },
    ];

    await db.insert(users).values(testUsers).onConflictDoNothing();
    logger.info(`✅ Created ${testUsers.length} test users`);

    // Step 3: Create charging stations
    const stations = [
      // Chennai Stations
      {
        name: 'Anna Nagar EV Hub',
        address: 'Anna Nagar, Chennai, Tamil Nadu 600040',
        latitude: '13.0878',
        longitude: '80.2086',
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 50,
        pricePerKwh: '12.00',
        ownerWhatsappId: '919876543211',
      },
      {
        name: 'T Nagar Fast Charge',
        address: 'T Nagar, Chennai, Tamil Nadu 600017',
        latitude: '13.0418',
        longitude: '80.2341',
        totalPorts: 6,
        availablePorts: 4,
        connectorTypes: ['CCS2', 'CHAdeMO'],
        maxPowerKw: 100,
        pricePerKwh: '15.00',
        ownerWhatsappId: '919876543211',
      },
      {
        name: 'Velachery Power Station',
        address: 'Velachery, Chennai, Tamil Nadu 600042',
        latitude: '12.9754',
        longitude: '80.2212',
        totalPorts: 3,
        availablePorts: 1,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '10.00',
        ownerWhatsappId: '919876543211',
      },

      // Coimbatore Stations
      {
        name: 'RS Puram EV Center',
        address: 'RS Puram, Coimbatore, Tamil Nadu 641002',
        latitude: '11.0049',
        longitude: '76.9618',
        totalPorts: 5,
        availablePorts: 3,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 75,
        pricePerKwh: '11.00',
        ownerWhatsappId: '919876543212',
      },
      {
        name: 'Gandhipuram Quick Charge',
        address: 'Gandhipuram, Coimbatore, Tamil Nadu 641012',
        latitude: '11.0183',
        longitude: '76.9725',
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['CCS2'],
        maxPowerKw: 60,
        pricePerKwh: '13.50',
        ownerWhatsappId: '919876543212',
      },
      {
        name: 'Peelamedu EV Station',
        address: 'Peelamedu, Coimbatore, Tamil Nadu 641004',
        latitude: '11.0301',
        longitude: '77.0081',
        totalPorts: 2,
        availablePorts: 1,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '9.50',
        ownerWhatsappId: '919876543212',
      },

      // Madurai Stations
      {
        name: 'Madurai Central EV Hub',
        address: 'Anna Nagar, Madurai, Tamil Nadu 625020',
        latitude: '9.9252',
        longitude: '78.1198',
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 50,
        pricePerKwh: '11.50',
        ownerWhatsappId: '919876543213',
      },
      {
        name: 'Meenakshi Mission Hospital Charger',
        address: 'Lake Area, Madurai, Tamil Nadu 625020',
        latitude: '9.9197',
        longitude: '78.1092',
        totalPorts: 3,
        availablePorts: 3,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '10.00',
        ownerWhatsappId: '919876543213',
      },

      // Salem Stations
      {
        name: 'Salem Junction EV Point',
        address: 'Junction, Salem, Tamil Nadu 636001',
        latitude: '11.664',
        longitude: '78.146',
        totalPorts: 3,
        availablePorts: 1,
        connectorTypes: ['CCS2'],
        maxPowerKw: 50,
        pricePerKwh: '12.00',
        ownerWhatsappId: '919876543214',
      },
      {
        name: 'Salem Steel Plant Charger',
        address: 'Steel Plant Area, Salem, Tamil Nadu 636001',
        latitude: '11.6854',
        longitude: '78.1832',
        totalPorts: 6,
        availablePorts: 4,
        connectorTypes: ['CCS2', 'Type2', 'CHAdeMO'],
        maxPowerKw: 120,
        pricePerKwh: '14.00',
        ownerWhatsappId: '919876543214',
      },

      // Other Tamil Nadu Cities
      {
        name: 'Tirupur Textile Hub Charger',
        address: 'Tirupur, Tamil Nadu 641601',
        latitude: '11.1085',
        longitude: '77.3411',
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '10.50',
        ownerWhatsappId: '919876543210',
      },
      {
        name: 'Erode Bus Stand EV Station',
        address: 'Erode, Tamil Nadu 638001',
        latitude: '11.341',
        longitude: '77.717',
        totalPorts: 3,
        availablePorts: 2,
        connectorTypes: ['CCS2'],
        maxPowerKw: 50,
        pricePerKwh: '11.00',
        ownerWhatsappId: '919876543210',
      },
      {
        name: 'Vellore Fort EV Point',
        address: 'Vellore, Tamil Nadu 632001',
        latitude: '12.9165',
        longitude: '79.1325',
        totalPorts: 2,
        availablePorts: 1,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '10.00',
        ownerWhatsappId: '919876543210',
      },
      {
        name: 'Thanjavur Heritage Charger',
        address: 'Thanjavur, Tamil Nadu 613001',
        latitude: '10.7870',
        longitude: '79.1378',
        totalPorts: 3,
        availablePorts: 3,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '9.00',
        ownerWhatsappId: '919876543210',
      },
      {
        name: 'Trichy Rock Fort Station',
        address: 'Tiruchirappalli, Tamil Nadu 620001',
        latitude: '10.7905',
        longitude: '78.7047',
        totalPorts: 4,
        availablePorts: 2,
        connectorTypes: ['CCS2', 'Type2'],
        maxPowerKw: 50,
        pricePerKwh: '11.50',
        ownerWhatsappId: '919876543210',
      },
      {
        name: 'Thoothukudi Port EV Hub',
        address: 'Thoothukudi, Tamil Nadu 628001',
        latitude: '8.7642',
        longitude: '78.1348',
        totalPorts: 5,
        availablePorts: 3,
        connectorTypes: ['CCS2', 'CHAdeMO'],
        maxPowerKw: 75,
        pricePerKwh: '13.00',
        ownerWhatsappId: '919876543210',
      },
      {
        name: 'Kanyakumari Sunrise Point Charger',
        address: 'Kanyakumari, Tamil Nadu 629001',
        latitude: '8.0883',
        longitude: '77.5385',
        totalPorts: 2,
        availablePorts: 2,
        connectorTypes: ['Type2'],
        maxPowerKw: 22,
        pricePerKwh: '12.00',
        ownerWhatsappId: '919876543210',
      },
    ];

    await db.insert(chargingStations).values(stations).onConflictDoNothing();
    logger.info(`✅ Created ${stations.length} charging stations`);

    // Summary
    const cities = ['Chennai', 'Coimbatore', 'Madurai', 'Salem', 'Tirupur', 'Erode', 'Vellore', 'Thanjavur', 'Trichy', 'Thoothukudi', 'Kanyakumari'];
    logger.info(`📍 Created ${stations.length} charging stations across Tamil Nadu`);
    logger.info(`🏢 Cities covered: ${cities.join(', ')}`);
    logger.info(`👥 Created ${testUsers.length} test users for automated testing`);
    logger.info('✅ Tamil Nadu seed data created successfully!');

  } catch (error) {
    logger.error('❌ Failed to seed Tamil Nadu data', { error });
    throw error;
  }
}