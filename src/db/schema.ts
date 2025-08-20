import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  decimal,
  jsonb,
  uuid,
  serial,
  index,
  unique
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ==================== USERS TABLE ====================
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }),
  phoneNumber: varchar('phone_number', { length: 20 }),
  
  // User Preferences (Phase 2)
  evModel: varchar('ev_model', { length: 100 }),
  connectorType: varchar('connector_type', { length: 20 }), // CCS2, Type2, CHAdeMO, Any
  chargingIntent: varchar('charging_intent', { length: 50 }), // Quick, Full, Emergency
  queuePreference: varchar('queue_preference', { length: 30 }), // Free, Wait15m, Wait30m, Any
  
  // Profile Status
  isActive: boolean('is_active').default(true),
  isBanned: boolean('is_banned').default(false),
  preferencesCaptured: boolean('preferences_captured').default(false),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('users_whatsapp_id_idx').on(table.whatsappId),
  nameIdx: index('users_name_idx').on(table.name),
}));

// ==================== CHARGING STATIONS TABLE ====================
export const chargingStations = pgTable('charging_stations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  address: text('address').notNull(),
  
  // Location (PostGIS will be added later)
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  
  // Station Details
  totalPorts: integer('total_ports').notNull().default(1),
  availablePorts: integer('available_ports').notNull().default(1),
  connectorTypes: jsonb('connector_types').notNull(), // ["CCS2", "Type2"]
  maxPowerKw: integer('max_power_kw').notNull().default(50),
  pricePerKwh: decimal('price_per_kwh', { precision: 5, scale: 2 }).notNull(),
  
  // Operational Status
  isActive: boolean('is_active').default(true),
  isOpen: boolean('is_open').default(true),
  isPaused: boolean('is_paused').default(false), // Owner pause feature
  
  // Queue Management
  maxQueueLength: integer('max_queue_length').default(5),
  currentQueueLength: integer('current_queue_length').default(0),
  averageSessionMinutes: integer('average_session_minutes').default(45),
  
  // Owner Info
  ownerWhatsappId: varchar('owner_whatsapp_id', { length: 20 }),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  locationIdx: index('stations_location_idx').on(table.latitude, table.longitude),
  ownerIdx: index('stations_owner_idx').on(table.ownerWhatsappId),
  activeIdx: index('stations_active_idx').on(table.isActive, table.isOpen),
}));

// ==================== QUEUES TABLE ====================
export const queues = pgTable('queues', {
  id: serial('id').primaryKey(),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull(),
  stationId: integer('station_id').references(() => chargingStations.id).notNull(),
  
  // Queue Details
  position: integer('position').notNull(),
  estimatedWaitMinutes: integer('estimated_wait_minutes'),
  
  // Reservation Details
  reservationExpiry: timestamp('reservation_expiry'),
  isReserved: boolean('is_reserved').default(false),
  reservedAt: timestamp('reserved_at'),
  
  // Status Tracking
  status: varchar('status', { length: 20 }).notNull().default('waiting'), // waiting, reserved, charging, completed, cancelled
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userStationIdx: unique('queues_user_station_unique').on(table.userWhatsapp, table.stationId),
  stationPositionIdx: index('queues_station_position_idx').on(table.stationId, table.position),
  statusIdx: index('queues_status_idx').on(table.status),
  expiryIdx: index('queues_expiry_idx').on(table.reservationExpiry),
}));

// ==================== CHARGING SESSIONS TABLE ====================
export const chargingSessions = pgTable('charging_sessions', {
  id: serial('id').primaryKey(),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull(),
  stationId: integer('station_id').references(() => chargingStations.id).notNull(),
  queueId: integer('queue_id').references(() => queues.id),
  
  // Session Details
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  durationMinutes: integer('duration_minutes'),
  energyConsumedKwh: decimal('energy_consumed_kwh', { precision: 6, scale: 2 }),
  totalCost: decimal('total_cost', { precision: 8, scale: 2 }),
  
  // Status
  status: varchar('status', { length: 20 }).notNull().default('active'), // active, completed, interrupted
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdx: index('sessions_user_idx').on(table.userWhatsapp),
  stationIdx: index('sessions_station_idx').on(table.stationId),
  statusIdx: index('sessions_status_idx').on(table.status),
  dateIdx: index('sessions_date_idx').on(table.createdAt),
}));

// ==================== STATION OWNERS TABLE ====================
export const stationOwners = pgTable('station_owners', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  
  // Owner Status
  isActive: boolean('is_active').default(true),
  permissions: jsonb('permissions').notNull().default('["manage_own_stations"]'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('owners_whatsapp_id_idx').on(table.whatsappId),
}));

// ==================== ADMINS TABLE ====================
export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  
  // Admin Status
  isActive: boolean('is_active').default(true),
  permissions: jsonb('permissions').notNull().default('["manage_owners", "manage_users", "view_analytics"]'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('admins_whatsapp_id_idx').on(table.whatsappId),
}));

// ==================== GEOCODE CACHE TABLE ====================
export const geocodeCache = pgTable('geocode_cache', {
  id: serial('id').primaryKey(),
  address: text('address').notNull().unique(),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  
  // Cache Management
  hitCount: integer('hit_count').default(1),
  lastUsed: timestamp('last_used').defaultNow(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  addressIdx: index('geocode_address_idx').on(table.address),
  locationIdx: index('geocode_location_idx').on(table.latitude, table.longitude),
}));

// ==================== AUDIT LOGS TABLE ====================
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  
  // Actor Details
  actorWhatsappId: varchar('actor_whatsapp_id', { length: 20 }).notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(), // user, owner, admin
  
  // Action Details
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }), // station, user, queue
  resourceId: varchar('resource_id', { length: 50 }),
  
  // Action Data
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  metadata: jsonb('metadata'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  actorIdx: index('audit_actor_idx').on(table.actorWhatsappId),
  actionIdx: index('audit_action_idx').on(table.action),
  dateIdx: index('audit_date_idx').on(table.createdAt),
  resourceIdx: index('audit_resource_idx').on(table.resourceType, table.resourceId),
}));

// ==================== DRIZZLE RELATIONS ====================
export const usersRelations = relations(users, ({ many }) => ({
  queues: many(queues),
  sessions: many(chargingSessions),
}));

export const stationsRelations = relations(chargingStations, ({ many, one }) => ({
  queues: many(queues),
  sessions: many(chargingSessions),
  owner: one(stationOwners, {
    fields: [chargingStations.ownerWhatsappId],
    references: [stationOwners.whatsappId],
  }),
}));

export const queuesRelations = relations(queues, ({ one }) => ({
  station: one(chargingStations, {
    fields: [queues.stationId],
    references: [chargingStations.id],
  }),
  user: one(users, {
    fields: [queues.userWhatsapp],
    references: [users.whatsappId],
  }),
}));

export const sessionsRelations = relations(chargingSessions, ({ one }) => ({
  station: one(chargingStations, {
    fields: [chargingSessions.stationId],
    references: [chargingStations.id],
  }),
  user: one(users, {
    fields: [chargingSessions.userWhatsapp],
    references: [users.whatsappId],
  }),
  queue: one(queues, {
    fields: [chargingSessions.queueId],
    references: [queues.id],
  }),
}));

export const ownersRelations = relations(stationOwners, ({ many }) => ({
  stations: many(chargingStations),
}));

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChargingStation = typeof chargingStations.$inferSelect;
export type NewChargingStation = typeof chargingStations.$inferInsert;
export type Queue = typeof queues.$inferSelect;
export type NewQueue = typeof queues.$inferInsert;
export type ChargingSession = typeof chargingSessions.$inferSelect;
export type NewChargingSession = typeof chargingSessions.$inferInsert;
export type StationOwner = typeof stationOwners.$inferSelect;
export type NewStationOwner = typeof stationOwners.$inferInsert;
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
