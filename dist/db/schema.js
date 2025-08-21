"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ownersRelations = exports.sessionsRelations = exports.queuesRelations = exports.stationsRelations = exports.usersRelations = exports.auditLogs = exports.geocodeCache = exports.admins = exports.stationOwners = exports.chargingSessions = exports.queues = exports.chargingStations = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const drizzle_orm_1 = require("drizzle-orm");
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    whatsappId: (0, pg_core_1.varchar)('whatsapp_id', { length: 20 }).notNull().unique(),
    name: (0, pg_core_1.varchar)('name', { length: 100 }),
    phoneNumber: (0, pg_core_1.varchar)('phone_number', { length: 20 }),
    evModel: (0, pg_core_1.varchar)('ev_model', { length: 100 }),
    connectorType: (0, pg_core_1.varchar)('connector_type', { length: 20 }),
    chargingIntent: (0, pg_core_1.varchar)('charging_intent', { length: 50 }),
    queuePreference: (0, pg_core_1.varchar)('queue_preference', { length: 30 }),
    isActive: (0, pg_core_1.boolean)('is_active').default(true),
    isBanned: (0, pg_core_1.boolean)('is_banned').default(false),
    preferencesCaptured: (0, pg_core_1.boolean)('preferences_captured').default(false),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow(),
}, (table) => ({
    whatsappIdIdx: (0, pg_core_1.index)('users_whatsapp_id_idx').on(table.whatsappId),
    nameIdx: (0, pg_core_1.index)('users_name_idx').on(table.name),
}));
exports.chargingStations = (0, pg_core_1.pgTable)('charging_stations', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    name: (0, pg_core_1.varchar)('name', { length: 200 }).notNull(),
    address: (0, pg_core_1.text)('address').notNull(),
    latitude: (0, pg_core_1.decimal)('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: (0, pg_core_1.decimal)('longitude', { precision: 11, scale: 8 }).notNull(),
    totalPorts: (0, pg_core_1.integer)('total_ports').notNull().default(1),
    availablePorts: (0, pg_core_1.integer)('available_ports').notNull().default(1),
    connectorTypes: (0, pg_core_1.jsonb)('connector_types').notNull(),
    maxPowerKw: (0, pg_core_1.integer)('max_power_kw').notNull().default(50),
    pricePerKwh: (0, pg_core_1.decimal)('price_per_kwh', { precision: 5, scale: 2 }).notNull(),
    isActive: (0, pg_core_1.boolean)('is_active').default(true),
    isOpen: (0, pg_core_1.boolean)('is_open').default(true),
    isPaused: (0, pg_core_1.boolean)('is_paused').default(false),
    maxQueueLength: (0, pg_core_1.integer)('max_queue_length').default(5),
    currentQueueLength: (0, pg_core_1.integer)('current_queue_length').default(0),
    averageSessionMinutes: (0, pg_core_1.integer)('average_session_minutes').default(45),
    ownerWhatsappId: (0, pg_core_1.varchar)('owner_whatsapp_id', { length: 20 }),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow(),
}, (table) => ({
    locationIdx: (0, pg_core_1.index)('stations_location_idx').on(table.latitude, table.longitude),
    ownerIdx: (0, pg_core_1.index)('stations_owner_idx').on(table.ownerWhatsappId),
    activeIdx: (0, pg_core_1.index)('stations_active_idx').on(table.isActive, table.isOpen),
}));
exports.queues = (0, pg_core_1.pgTable)('queues', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    userWhatsapp: (0, pg_core_1.varchar)('user_whatsapp', { length: 20 }).notNull(),
    stationId: (0, pg_core_1.integer)('station_id').references(() => exports.chargingStations.id).notNull(),
    position: (0, pg_core_1.integer)('position').notNull(),
    estimatedWaitMinutes: (0, pg_core_1.integer)('estimated_wait_minutes'),
    reservationExpiry: (0, pg_core_1.timestamp)('reservation_expiry'),
    isReserved: (0, pg_core_1.boolean)('is_reserved').default(false),
    reservedAt: (0, pg_core_1.timestamp)('reserved_at'),
    status: (0, pg_core_1.varchar)('status', { length: 20 }).notNull().default('waiting'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow(),
}, (table) => ({
    userStationIdx: (0, pg_core_1.unique)('queues_user_station_unique').on(table.userWhatsapp, table.stationId),
    stationPositionIdx: (0, pg_core_1.index)('queues_station_position_idx').on(table.stationId, table.position),
    statusIdx: (0, pg_core_1.index)('queues_status_idx').on(table.status),
    expiryIdx: (0, pg_core_1.index)('queues_expiry_idx').on(table.reservationExpiry),
}));
exports.chargingSessions = (0, pg_core_1.pgTable)('charging_sessions', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    userWhatsapp: (0, pg_core_1.varchar)('user_whatsapp', { length: 20 }).notNull(),
    stationId: (0, pg_core_1.integer)('station_id').references(() => exports.chargingStations.id).notNull(),
    queueId: (0, pg_core_1.integer)('queue_id').references(() => exports.queues.id),
    startTime: (0, pg_core_1.timestamp)('start_time'),
    endTime: (0, pg_core_1.timestamp)('end_time'),
    durationMinutes: (0, pg_core_1.integer)('duration_minutes'),
    energyConsumedKwh: (0, pg_core_1.decimal)('energy_consumed_kwh', { precision: 6, scale: 2 }),
    totalCost: (0, pg_core_1.decimal)('total_cost', { precision: 8, scale: 2 }),
    status: (0, pg_core_1.varchar)('status', { length: 20 }).notNull().default('active'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow(),
}, (table) => ({
    userIdx: (0, pg_core_1.index)('sessions_user_idx').on(table.userWhatsapp),
    stationIdx: (0, pg_core_1.index)('sessions_station_idx').on(table.stationId),
    statusIdx: (0, pg_core_1.index)('sessions_status_idx').on(table.status),
    dateIdx: (0, pg_core_1.index)('sessions_date_idx').on(table.createdAt),
}));
exports.stationOwners = (0, pg_core_1.pgTable)('station_owners', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    whatsappId: (0, pg_core_1.varchar)('whatsapp_id', { length: 20 }).notNull().unique(),
    name: (0, pg_core_1.varchar)('name', { length: 100 }).notNull(),
    isActive: (0, pg_core_1.boolean)('is_active').default(true),
    permissions: (0, pg_core_1.jsonb)('permissions').notNull().default('["manage_own_stations"]'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow(),
}, (table) => ({
    whatsappIdIdx: (0, pg_core_1.index)('owners_whatsapp_id_idx').on(table.whatsappId),
}));
exports.admins = (0, pg_core_1.pgTable)('admins', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    whatsappId: (0, pg_core_1.varchar)('whatsapp_id', { length: 20 }).notNull().unique(),
    name: (0, pg_core_1.varchar)('name', { length: 100 }).notNull(),
    isActive: (0, pg_core_1.boolean)('is_active').default(true),
    permissions: (0, pg_core_1.jsonb)('permissions').notNull().default('["manage_owners", "manage_users", "view_analytics"]'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at').defaultNow(),
}, (table) => ({
    whatsappIdIdx: (0, pg_core_1.index)('admins_whatsapp_id_idx').on(table.whatsappId),
}));
exports.geocodeCache = (0, pg_core_1.pgTable)('geocode_cache', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    address: (0, pg_core_1.text)('address').notNull().unique(),
    latitude: (0, pg_core_1.decimal)('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: (0, pg_core_1.decimal)('longitude', { precision: 11, scale: 8 }).notNull(),
    hitCount: (0, pg_core_1.integer)('hit_count').default(1),
    lastUsed: (0, pg_core_1.timestamp)('last_used').defaultNow(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
}, (table) => ({
    addressIdx: (0, pg_core_1.index)('geocode_address_idx').on(table.address),
    locationIdx: (0, pg_core_1.index)('geocode_location_idx').on(table.latitude, table.longitude),
}));
exports.auditLogs = (0, pg_core_1.pgTable)('audit_logs', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    actorWhatsappId: (0, pg_core_1.varchar)('actor_whatsapp_id', { length: 20 }).notNull(),
    actorType: (0, pg_core_1.varchar)('actor_type', { length: 20 }).notNull(),
    action: (0, pg_core_1.varchar)('action', { length: 100 }).notNull(),
    resourceType: (0, pg_core_1.varchar)('resource_type', { length: 50 }),
    resourceId: (0, pg_core_1.varchar)('resource_id', { length: 50 }),
    oldValues: (0, pg_core_1.jsonb)('old_values'),
    newValues: (0, pg_core_1.jsonb)('new_values'),
    metadata: (0, pg_core_1.jsonb)('metadata'),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
}, (table) => ({
    actorIdx: (0, pg_core_1.index)('audit_actor_idx').on(table.actorWhatsappId),
    actionIdx: (0, pg_core_1.index)('audit_action_idx').on(table.action),
    dateIdx: (0, pg_core_1.index)('audit_date_idx').on(table.createdAt),
    resourceIdx: (0, pg_core_1.index)('audit_resource_idx').on(table.resourceType, table.resourceId),
}));
exports.usersRelations = (0, drizzle_orm_1.relations)(exports.users, ({ many }) => ({
    queues: many(exports.queues),
    sessions: many(exports.chargingSessions),
}));
exports.stationsRelations = (0, drizzle_orm_1.relations)(exports.chargingStations, ({ many, one }) => ({
    queues: many(exports.queues),
    sessions: many(exports.chargingSessions),
    owner: one(exports.stationOwners, {
        fields: [exports.chargingStations.ownerWhatsappId],
        references: [exports.stationOwners.whatsappId],
    }),
}));
exports.queuesRelations = (0, drizzle_orm_1.relations)(exports.queues, ({ one }) => ({
    station: one(exports.chargingStations, {
        fields: [exports.queues.stationId],
        references: [exports.chargingStations.id],
    }),
    user: one(exports.users, {
        fields: [exports.queues.userWhatsapp],
        references: [exports.users.whatsappId],
    }),
}));
exports.sessionsRelations = (0, drizzle_orm_1.relations)(exports.chargingSessions, ({ one }) => ({
    station: one(exports.chargingStations, {
        fields: [exports.chargingSessions.stationId],
        references: [exports.chargingStations.id],
    }),
    user: one(exports.users, {
        fields: [exports.chargingSessions.userWhatsapp],
        references: [exports.users.whatsappId],
    }),
    queue: one(exports.queues, {
        fields: [exports.chargingSessions.queueId],
        references: [exports.queues.id],
    }),
}));
exports.ownersRelations = (0, drizzle_orm_1.relations)(exports.stationOwners, ({ many }) => ({
    stations: many(exports.chargingStations),
}));
//# sourceMappingURL=schema.js.map