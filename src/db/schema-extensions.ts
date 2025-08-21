import { sql } from 'drizzle-orm';
import { 
  pgTable, 
  text, 
  decimal, 
  integer, 
  index, 
  serial,
  varchar,
  timestamp
} from 'drizzle-orm/pg-core';
import { chargingStations } from './schema';

// Add PostGIS point column to existing charging_stations table
export const stationLocations = pgTable('station_locations', {
  stationId: integer('station_id').primaryKey().references(() => chargingStations.id),
  location: text('location'), // PostGIS POINT type
  geohash: text('geohash'), // For faster proximity searches
}, (table) => ({
  locationIdx: index('station_locations_gist_idx').using('gist', table.location),
  geohashIdx: index('station_locations_geohash_idx').on(table.geohash),
}));

// Enhanced geocode cache with geohash
export const geocodeCacheEnhanced = pgTable('geocode_cache_v2', {
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
  hitCount: integer('hit_count').default(1),
  lastUsed: timestamp('last_used').defaultNow(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  searchTermIdx: index('geocode_search_term_idx').on(table.searchTerm),
  geohashIdx: index('geocode_geohash_idx').on(table.geohash),
  localityIdx: index('geocode_locality_idx').on(table.locality),
}));

// User search history for better suggestions
export const userSearchHistory = pgTable('user_search_history', {
  id: serial('id').primaryKey(),
  userWhatsapp: varchar('user_whatsapp', { length: 20 }).notNull(),
  searchTerm: text('search_term').notNull(),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  resultCount: integer('result_count').default(0),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdx: index('search_history_user_idx').on(table.userWhatsapp),
  termIdx: index('search_history_term_idx').on(table.searchTerm),
  dateIdx: index('search_history_date_idx').on(table.createdAt),
}));

// Export types
export type StationLocation = typeof stationLocations.$inferSelect;
export type NewStationLocation = typeof stationLocations.$inferInsert;
export type GeocodeCache = typeof geocodeCacheEnhanced.$inferSelect;
export type NewGeocodeCache = typeof geocodeCacheEnhanced.$inferInsert;
export type UserSearchHistory = typeof userSearchHistory.$inferSelect;
export type NewUserSearchHistory = typeof userSearchHistory.$inferInsert;
