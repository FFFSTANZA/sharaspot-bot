"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userSearchHistory = exports.geocodeCacheEnhanced = exports.stationLocations = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const schema_1 = require("./schema");
exports.stationLocations = (0, pg_core_1.pgTable)('station_locations', {
    stationId: (0, pg_core_1.integer)('station_id').primaryKey().references(() => schema_1.chargingStations.id),
    location: (0, pg_core_1.text)('location'),
    geohash: (0, pg_core_1.text)('geohash'),
}, (table) => ({
    locationIdx: (0, pg_core_1.index)('station_locations_gist_idx').using('gist', table.location),
    geohashIdx: (0, pg_core_1.index)('station_locations_geohash_idx').on(table.geohash),
}));
exports.geocodeCacheEnhanced = (0, pg_core_1.pgTable)('geocode_cache_v2', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    searchTerm: (0, pg_core_1.text)('search_term').notNull().unique(),
    originalAddress: (0, pg_core_1.text)('original_address').notNull(),
    latitude: (0, pg_core_1.decimal)('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: (0, pg_core_1.decimal)('longitude', { precision: 11, scale: 8 }).notNull(),
    geohash: (0, pg_core_1.text)('geohash').notNull(),
    formattedAddress: (0, pg_core_1.text)('formatted_address'),
    locality: (0, pg_core_1.text)('locality'),
    subLocality: (0, pg_core_1.text)('sub_locality'),
    state: (0, pg_core_1.text)('state'),
    country: (0, pg_core_1.text)('country').default('India'),
    postalCode: (0, pg_core_1.text)('postal_code'),
    confidence: (0, pg_core_1.decimal)('confidence', { precision: 3, scale: 2 }).default('1.0'),
    hitCount: (0, pg_core_1.integer)('hit_count').default(1),
    lastUsed: (0, pg_core_1.timestamp)('last_used').defaultNow(),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
}, (table) => ({
    searchTermIdx: (0, pg_core_1.index)('geocode_search_term_idx').on(table.searchTerm),
    geohashIdx: (0, pg_core_1.index)('geocode_geohash_idx').on(table.geohash),
    localityIdx: (0, pg_core_1.index)('geocode_locality_idx').on(table.locality),
}));
exports.userSearchHistory = (0, pg_core_1.pgTable)('user_search_history', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    userWhatsapp: (0, pg_core_1.varchar)('user_whatsapp', { length: 20 }).notNull(),
    searchTerm: (0, pg_core_1.text)('search_term').notNull(),
    latitude: (0, pg_core_1.decimal)('latitude', { precision: 10, scale: 8 }).notNull(),
    longitude: (0, pg_core_1.decimal)('longitude', { precision: 11, scale: 8 }).notNull(),
    resultCount: (0, pg_core_1.integer)('result_count').default(0),
    createdAt: (0, pg_core_1.timestamp)('created_at').defaultNow(),
}, (table) => ({
    userIdx: (0, pg_core_1.index)('search_history_user_idx').on(table.userWhatsapp),
    termIdx: (0, pg_core_1.index)('search_history_term_idx').on(table.searchTerm),
    dateIdx: (0, pg_core_1.index)('search_history_date_idx').on(table.createdAt),
}));
//# sourceMappingURL=schema-extensions.js.map