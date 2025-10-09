// src/db/schema.ts - COMPLETE CORRECTED SCHEMA FOR ALL ERRORS
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
  vehicleType: varchar('vehicle_type', { length: 50 }), // Car, Bike/Scooter, Any
  evModel: varchar('ev_model', { length: 100 }),
  connectorType: varchar('connector_type', { length: 20 }), // CCS2, Type2, CHAdeMO, Any
  chargingIntent: varchar('charging_intent', { length: 50 }), // Quick, Full, Emergency
  queuePreference: varchar('queue_preference', { length: 30 }), // Free, Wait15m, Wait30m, Any
  
  // Profile Status
  isActive: boolean('is_active').default(true),
  isBanned: boolean('is_banned').default(false),
  preferencesCaptured: boolean('preferences_captured').default(false),
  
  // Additional Profile Fields
  profilePicture: text('profile_picture'),
  language: varchar('language', { length: 10 }).default('en'),
  timezone: varchar('timezone', { length: 50 }).default('Asia/Kolkata'),
  
  // Notification Preferences
  notificationsEnabled: boolean('notifications_enabled').default(true),
  smsNotifications: boolean('sms_notifications').default(false),
  emailNotifications: boolean('email_notifications').default(false),
  email: varchar('email', { length: 150 }),
  
  // Usage Stats
  totalBookings: integer('total_bookings').default(0),
  totalSessions: integer('total_sessions').default(0),
  totalEnergyConsumed: decimal('total_energy_consumed', { precision: 10, scale: 3 }).default('0'),
  lastActivityAt: timestamp('last_activity_at').defaultNow(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('users_whatsapp_id_idx').on(table.whatsappId),
  nameIdx: index('users_name_idx').on(table.name),
  activityIdx: index('users_activity_idx').on(table.lastActivityAt),
  preferencesIdx: index('users_preferences_idx').on(table.preferencesCaptured),
}));

// ==================== CHARGING STATIONS TABLE (CORRECTED) ====================
export const chargingStations = pgTable('charging_stations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  address: text('address').notNull(),
  
  // Location (PostGIS will be added later)
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  geohash: varchar('geohash', { length: 12 }), // For faster location queries
  distance: decimal('distance', { precision: 8, scale: 3 }), // ✅ ADDED - Distance from user query
  
  // Station Details - CORRECTED COLUMN NAMES
  totalPorts: integer('total_ports').notNull().default(1),
  availablePorts: integer('available_ports').notNull().default(1),
  totalSlots: integer('total_slots').notNull().default(1), // ✅ ADDED - For backward compatibility
  availableSlots: integer('available_slots').notNull().default(1), // ✅ ADDED - For backward compatibility
  connectorTypes: jsonb('connector_types').notNull(), // ["CCS2", "Type2"]
  maxPowerKw: integer('max_power_kw').notNull().default(50),
  pricePerKwh: decimal('price_per_kwh', { precision: 5, scale: 2 }).notNull().default('10.00'),
  pricePerUnit: decimal('price_per_unit', { precision: 5, scale: 2 }).notNull().default('10.00'), // ✅ ADDED - Alias for pricePerKwh
  
  // Station Status
  isActive: boolean('is_active').default(true),
  isOpen: boolean('is_open').default(true),
  isPaused: boolean('is_paused').default(false),
  maintenanceMode: boolean('maintenance_mode').default(false),
  
  // Queue Management
  currentQueueLength: integer('current_queue_length').default(0),
  maxQueueLength: integer('max_queue_length').default(10),
  averageSessionMinutes: integer('average_session_minutes').default(30),
  
  // Operating Details
  operatingHours: jsonb('operating_hours').default('{"monday": "24/7", "tuesday": "24/7", "wednesday": "24/7", "thursday": "24/7", "friday": "24/7", "saturday": "24/7", "sunday": "24/7"}'),
  amenities: jsonb('amenities').default('[]'), // ["parking", "wifi", "restroom", "food"]
  description: text('description'),
  
  // Owner & Contact
  ownerWhatsappId: varchar('owner_whatsapp_id', { length: 20 }).notNull(),
  contactNumber: varchar('contact_number', { length: 20 }),
  emergencyContact: varchar('emergency_contact', { length: 20 }),
  
  // Analytics & Performance - CORRECTED COLUMN NAMES
  totalSessions: integer('total_sessions').default(0),
  totalEnergyDelivered: decimal('total_energy_delivered', { precision: 12, scale: 3 }).default('0'),
  totalRevenue: decimal('total_revenue', { precision: 12, scale: 2 }).default('0'),
  averageRating: decimal('average_rating', { precision: 3, scale: 2 }).default('0'),
  rating: decimal('rating', { precision: 3, scale: 2 }).default('0'), // ✅ ADDED - Alias for averageRating
  reviewCount: integer('review_count').default(0),
  totalReviews: integer('total_reviews').default(0), // ✅ ADDED - Alias for reviewCount
  
  // Timestamps
  lastMaintenanceAt: timestamp('last_maintenance_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  locationIdx: index('stations_location_idx').on(table.latitude, table.longitude),
  geohashIdx: index('stations_geohash_idx').on(table.geohash),
  ownerIdx: index('stations_owner_idx').on(table.ownerWhatsappId),
  activeIdx: index('stations_active_idx').on(table.isActive, table.isOpen),
  availabilityIdx: index('stations_availability_idx').on(table.availablePorts, table.currentQueueLength),
  priceIdx: index('stations_price_idx').on(table.pricePerKwh),
  ratingIdx: index('stations_rating_idx').on(table.averageRating),
}));

// ==================== QUEUES TABLE (WITH RESERVATION EXPIRY) ====================
export const queues = pgTable('queues', {
  id: serial('id').primaryKey(),
  stationId: integer('station_id').notNull().references(() => chargingStations.id),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  
  // Queue Details
  position: integer('position').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('waiting'), // waiting, ready, charging, completed, cancelled, expired
  estimatedWaitMinutes: integer('estimated_wait_minutes'),
  actualWaitMinutes: integer('actual_wait_minutes'),
  
  // Reservation Details - CORRECTED COLUMN NAME
  reservationExpiry: timestamp('reservation_expiry'), // ✅ FIXED - Added the missing column
  reservation_expiry: timestamp('reservation_expiry_alt'), // ✅ ADDED - Alternative name for compatibility
  reminderSent: boolean('reminder_sent').default(false),
  notificationsSent: integer('notifications_sent').default(0),
  
  // User Preferences for this booking
  requestedConnectorType: varchar('requested_connector_type', { length: 20 }),
  requestedMaxPower: integer('requested_max_power'),
  estimatedSessionMinutes: integer('estimated_session_minutes'),
  
  // Pricing at time of booking
  ratePerKwhAtBooking: decimal('rate_per_kwh_at_booking', { precision: 5, scale: 2 }),
  estimatedCost: decimal('estimated_cost', { precision: 8, scale: 2 }),
  
  // Timestamps
  joinedAt: timestamp('joined_at').defaultNow(),
  readyAt: timestamp('ready_at'),
  expiredAt: timestamp('expired_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  stationPositionIdx: index('queues_station_position_idx').on(table.stationId, table.position),
  statusIdx: index('queues_status_idx').on(table.status),
  expiryIdx: index('queues_expiry_idx').on(table.reservationExpiry),
  userActiveIdx: index('queues_user_active_idx').on(table.userWhatsapp, table.status),
  waitTimeIdx: index('queues_wait_time_idx').on(table.estimatedWaitMinutes),
  // Unique constraint: One active booking per user per station
  userStationUnique: unique('queues_user_station_active').on(table.userWhatsapp, table.stationId),
}));

// ==================== CHARGING SESSIONS TABLE (CORRECTED COLUMNS) ====================
export const chargingSessions = pgTable('charging_sessions', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 50 }).notNull().unique(),
  
  // References
  stationId: integer('station_id').notNull().references(() => chargingStations.id),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  queueId: integer('queue_id').references(() => queues.id),
  
  // Session Details
  status: varchar('status', { length: 20 }).notNull().default('initiated'), // initiated, active, paused, completed, failed, cancelled
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  startedAt: timestamp('started_at'), // ✅ ADDED - For analytics queries
  endedAt: timestamp('ended_at'), // ✅ ADDED - For analytics queries
  duration: integer('duration'), // in minutes
  
  // Charging Data
  connectorUsed: varchar('connector_used', { length: 20 }),
  maxPowerUsed: integer('max_power_used'), // kW
  energyDelivered: decimal('energy_delivered', { precision: 8, scale: 3 }), // kWh
  energyConsumed: decimal('energy_consumed', { precision: 8, scale: 3 }), // ✅ ADDED - Alias for energyDelivered
  peakPowerKw: decimal('peak_power_kw', { precision: 6, scale: 2 }),
  averagePowerKw: decimal('average_power_kw', { precision: 6, scale: 2 }),
  
  // Cost & Billing
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }),
  ratePerKwh: decimal('rate_per_kwh', { precision: 5, scale: 2 }),
  baseCharge: decimal('base_charge', { precision: 6, scale: 2 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 6, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 6, scale: 2 }).default('0'),
  
  // Payment Details
  paymentStatus: varchar('payment_status', { length: 20 }).default('pending'), // pending, completed, failed, refunded
  paymentMethod: varchar('payment_method', { length: 30 }),
  transactionId: varchar('transaction_id', { length: 100 }),
  
  // Session Metadata
  vehicleModel: varchar('vehicle_model', { length: 100 }),
  initialBatteryPercent: integer('initial_battery_percent'),
  finalBatteryPercent: integer('final_battery_percent'),
  stopReason: varchar('stop_reason', { length: 50 }), // completed, user_stopped, error, timeout
  
  // Quality & Issues
  hadIssues: boolean('had_issues').default(false),
  issueDescription: text('issue_description'),
  customerRating: integer('customer_rating'), // 1-5
  customerFeedback: text('customer_feedback'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdx: index('sessions_user_idx').on(table.userWhatsapp),
  stationIdx: index('sessions_station_idx').on(table.stationId),
  statusIdx: index('sessions_status_idx').on(table.status),
  dateIdx: index('sessions_date_idx').on(table.createdAt),
  paymentIdx: index('sessions_payment_idx').on(table.paymentStatus),
  ratingIdx: index('sessions_rating_idx').on(table.customerRating),
  startedAtIdx: index('sessions_started_at_idx').on(table.startedAt), // ✅ ADDED - For analytics
  endedAtIdx: index('sessions_ended_at_idx').on(table.endedAt), // ✅ ADDED - For analytics
}));

// ==================== STATION OWNERS TABLE ====================
export const stationOwners = pgTable('station_owners', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  phoneNumber: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 150 }),
  
  // Business Details
  businessName: varchar('business_name', { length: 200 }),
  businessType: varchar('business_type', { length: 50 }), // individual, corporate, franchise
  businessRegistrationNumber: varchar('business_registration_number', { length: 50 }),
  gstNumber: varchar('gst_number', { length: 20 }),
  
  // Address
  address: text('address'),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 100 }),
  pincode: varchar('pincode', { length: 10 }),
  
  // Verification & KYC
  isVerified: boolean('is_verified').default(false),
  kycStatus: varchar('kyc_status', { length: 20 }).default('pending'), // pending, submitted, approved, rejected
  verificationDocuments: jsonb('verification_documents'),
  verifiedAt: timestamp('verified_at'),
  verifiedBy: varchar('verified_by', { length: 20 }),
  
  // Banking Details
  bankAccountNumber: varchar('bank_account_number', { length: 30 }),
  ifscCode: varchar('ifsc_code', { length: 15 }),
  accountHolderName: varchar('account_holder_name', { length: 100 }),
  
  // Business Metrics
  totalStations: integer('total_stations').default(0),
  totalRevenue: decimal('total_revenue', { precision: 12, scale: 2 }).default('0'),
  averageRating: decimal('average_rating', { precision: 3, scale: 2 }).default('0'),
  
  // Status & Permissions
  isActive: boolean('is_active').default(true),
  permissions: jsonb('permissions').notNull().default('["manage_own_stations"]'),
  subscriptionPlan: varchar('subscription_plan', { length: 30 }).default('basic'),
  subscriptionExpiry: timestamp('subscription_expiry'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('owners_whatsapp_id_idx').on(table.whatsappId),
  verificationIdx: index('owners_verification_idx').on(table.isVerified, table.kycStatus),
  businessIdx: index('owners_business_idx').on(table.businessName),
  locationIdx: index('owners_location_idx').on(table.city, table.state),
}));

// ==================== ADMINS TABLE ====================
export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  whatsappId: varchar('whatsapp_id', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 150 }),
  
  // Role & Permissions
  role: varchar('role', { length: 30 }).notNull().default('admin'), // super_admin, admin, moderator
  permissions: jsonb('permissions').notNull().default('["manage_owners", "manage_users", "view_analytics"]'),
  
  // Access Control
  isActive: boolean('is_active').default(true),
  canAccessFinance: boolean('can_access_finance').default(false),
  canModifyStations: boolean('can_modify_stations').default(false),
  canBanUsers: boolean('can_ban_users').default(false),
  
  // Session Management
  lastLoginAt: timestamp('last_login_at'),
  loginCount: integer('login_count').default(0),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  whatsappIdIdx: index('admins_whatsapp_id_idx').on(table.whatsappId),
  roleIdx: index('admins_role_idx').on(table.role),
  activeIdx: index('admins_active_idx').on(table.isActive),
}));

// ==================== ENHANCED GEOCODE CACHE (V2) ====================
export const geocodeCacheV2 = pgTable('geocode_cache_v2', {
  id: serial('id').primaryKey(),
  searchTerm: text('search_term').notNull().unique(),
  originalAddress: text('original_address').notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  geohash: text('geohash').notNull(),
  
  // Enhanced address components
  formattedAddress: text('formatted_address'),
  locality: text('locality'), // City
  subLocality: text('sub_locality'), // Area/Neighborhood  
  state: text('state'),
  country: text('country').default('India'),
  postalCode: text('postal_code'),
  
  // Quality and usage metrics
  confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.0'),
  source: varchar('source', { length: 30 }).default('google'), // google, mapbox, osm
  hitCount: integer('hit_count').default(1),
  lastUsed: timestamp('last_used').defaultNow(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  searchTermIdx: index('geocode_v2_search_term_idx').on(table.searchTerm),
  geohashIdx: index('geocode_v2_geohash_idx').on(table.geohash),
  localityIdx: index('geocode_v2_locality_idx').on(table.locality),
  locationIdx: index('geocode_v2_location_idx').on(table.latitude, table.longitude),
}));

// ==================== USER SEARCH HISTORY TABLE ====================
export const userSearchHistory = pgTable('user_search_history', {
  id: serial('id').primaryKey(),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  searchTerm: text('search_term').notNull(),
  searchType: varchar('search_type', { length: 20 }).default('address'), // address, gps, station_name
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  resultCount: integer('result_count').default(0),
  selectedStationId: integer('selected_station_id'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdx: index('search_history_user_idx').on(table.userWhatsapp),
  termIdx: index('search_history_term_idx').on(table.searchTerm),
  dateIdx: index('search_history_date_idx').on(table.createdAt),
  typeIdx: index('search_history_type_idx').on(table.searchType),
}));

// ==================== NOTIFICATIONS TABLE ====================
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 20 }).notNull().references(() => users.whatsappId),
  type: varchar('type', { length: 30 }).notNull(), // queue_ready, session_complete, payment_success
  title: varchar('title', { length: 200 }).notNull(),
  message: text('message').notNull(),
  
  // Delivery Details
  status: varchar('status', { length: 20 }).default('pending'), // pending, sent, delivered, failed
  channel: varchar('channel', { length: 20 }).default('whatsapp'), // whatsapp, sms, email
  deliveredAt: timestamp('delivered_at'),
  readAt: timestamp('read_at'),
  
  // Related Data
  relatedId: varchar('related_id', { length: 50 }), // station_id, session_id, queue_id
  relatedType: varchar('related_type', { length: 30 }), // station, session, queue
  metadata: jsonb('metadata'),
  
  // Timestamps
  scheduledFor: timestamp('scheduled_for').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdx: index('notifications_user_idx').on(table.userId),
  statusIdx: index('notifications_status_idx').on(table.status),
  typeIdx: index('notifications_type_idx').on(table.type),
  scheduleIdx: index('notifications_schedule_idx').on(table.scheduledFor),
}));

// ==================== PAYMENTS TABLE ====================
export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  paymentId: varchar('payment_id', { length: 100 }).notNull().unique(),
  sessionId: varchar('session_id', { length: 50 }).notNull().references(() => chargingSessions.sessionId),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull().references(() => users.whatsappId),
  stationId: integer('station_id').notNull().references(() => chargingStations.id),
  
  // Payment Details
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 10 }).default('INR'),
  status: varchar('status', { length: 20 }).default('pending'), // pending, success, failed, refunded
  method: varchar('method', { length: 30 }), // upi, card, wallet, netbanking
  
  // Gateway Details
  gatewayTransactionId: varchar('gateway_transaction_id', { length: 100 }),
  gatewayResponse: jsonb('gateway_response'),
  
  // Refund Details
  refundAmount: decimal('refund_amount', { precision: 10, scale: 2 }).default('0'),
  refundReason: text('refund_reason'),
  refundedAt: timestamp('refunded_at'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdx: index('payments_user_idx').on(table.userWhatsapp),
  stationIdx: index('payments_station_idx').on(table.stationId),
  statusIdx: index('payments_status_idx').on(table.status),
  dateIdx: index('payments_date_idx').on(table.createdAt),
}));

// ==================== AUDIT LOGS TABLE ====================
export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  
  // Actor Details
  actorWhatsappId: varchar('actor_whatsapp_id', { length: 20 }).notNull(),
  actorType: varchar('actor_type', { length: 20 }).notNull(), // user, owner, admin, system
  
  // Action Details
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }), // station, user, queue, session
  resourceId: varchar('resource_id', { length: 50 }),
  
  // Action Data
  oldValues: jsonb('old_values'),
  newValues: jsonb('new_values'),
  metadata: jsonb('metadata'),
  
  // Request Details
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  endpoint: varchar('endpoint', { length: 200 }),
  
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
  searchHistory: many(userSearchHistory),
  notifications: many(notifications),
  payments: many(payments),
}));

export const stationsRelations = relations(chargingStations, ({ many, one }) => ({
  queues: many(queues),
  sessions: many(chargingSessions),
  payments: many(payments),
  owner: one(stationOwners, {
    fields: [chargingStations.ownerWhatsappId],
    references: [stationOwners.whatsappId],
  }),
}));

export const queuesRelations = relations(queues, ({ one, many }) => ({
  station: one(chargingStations, {
    fields: [queues.stationId],
    references: [chargingStations.id],
  }),
  user: one(users, {
    fields: [queues.userWhatsapp],
    references: [users.whatsappId],
  }),
  sessions: many(chargingSessions),
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
  payment: one(payments, {
    fields: [chargingSessions.sessionId],
    references: [payments.sessionId],
  }),
}));

export const ownersRelations = relations(stationOwners, ({ many }) => ({
  stations: many(chargingStations),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  session: one(chargingSessions, {
    fields: [payments.sessionId],
    references: [chargingSessions.sessionId],
  }),
  user: one(users, {
    fields: [payments.userWhatsapp],
    references: [users.whatsappId],
  }),
  station: one(chargingStations, {
    fields: [payments.stationId],
    references: [chargingStations.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.whatsappId],
  }),
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
export type GeocacheCacheV2 = typeof geocodeCacheV2.$inferSelect;
export type NewGeocacheCacheV2 = typeof geocodeCacheV2.$inferInsert;
export type UserSearchHistory = typeof userSearchHistory.$inferSelect;
export type NewUserSearchHistory = typeof userSearchHistory.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;