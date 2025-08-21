"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geocodingService = exports.GeocodingService = void 0;
const database_1 = require("../../config/database");
const schema_extensions_1 = require("../../db/schema-extensions");
const logger_1 = require("../../utils/logger");
const drizzle_orm_1 = require("drizzle-orm");
class GeocodingService {
    constructor() {
        this.indianCities = [
            { name: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lng: 72.8777 },
            { name: 'Delhi', state: 'Delhi', lat: 28.7041, lng: 77.1025 },
            { name: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
            { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
            { name: 'Hyderabad', state: 'Telangana', lat: 17.3850, lng: 78.4867 },
            { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
            { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
            { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
            { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
            { name: 'Surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311 },
            { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
            { name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462 },
            { name: 'Kanpur', state: 'Uttar Pradesh', lat: 26.4499, lng: 80.3319 },
            { name: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lng: 79.0882 },
            { name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577 },
            { name: 'Thane', state: 'Maharashtra', lat: 19.2183, lng: 72.9781 },
            { name: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lng: 77.4126 },
            { name: 'Visakhapatnam', state: 'Andhra Pradesh', lat: 17.6868, lng: 83.2185 },
            { name: 'Patna', state: 'Bihar', lat: 25.5941, lng: 85.1376 },
            { name: 'Vadodara', state: 'Gujarat', lat: 22.3072, lng: 73.1812 },
            { name: 'Ludhiana', state: 'Punjab', lat: 30.9010, lng: 75.8573 },
            { name: 'Agra', state: 'Uttar Pradesh', lat: 27.1767, lng: 78.0081 },
            { name: 'Nashik', state: 'Maharashtra', lat: 19.9975, lng: 73.7898 },
            { name: 'Faridabad', state: 'Haryana', lat: 28.4089, lng: 77.3178 },
            { name: 'Meerut', state: 'Uttar Pradesh', lat: 28.9845, lng: 77.7064 },
            { name: 'Rajkot', state: 'Gujarat', lat: 22.3039, lng: 70.8022 },
            { name: 'Varanasi', state: 'Uttar Pradesh', lat: 25.3176, lng: 82.9739 },
            { name: 'Aurangabad', state: 'Maharashtra', lat: 19.8762, lng: 75.3433 },
            { name: 'Amritsar', state: 'Punjab', lat: 31.6340, lng: 74.8723 },
            { name: 'Allahabad', state: 'Uttar Pradesh', lat: 25.4358, lng: 81.8463 },
            { name: 'Prayagraj', state: 'Uttar Pradesh', lat: 25.4358, lng: 81.8463 },
            { name: 'Ranchi', state: 'Jharkhand', lat: 23.3441, lng: 85.3096 },
            { name: 'Coimbatore', state: 'Tamil Nadu', lat: 11.0168, lng: 76.9558 },
            { name: 'Jabalpur', state: 'Madhya Pradesh', lat: 23.1815, lng: 79.9864 },
            { name: 'Gwalior', state: 'Madhya Pradesh', lat: 26.2183, lng: 78.1828 },
            { name: 'Vijayawada', state: 'Andhra Pradesh', lat: 16.5062, lng: 80.6480 },
            { name: 'Jodhpur', state: 'Rajasthan', lat: 26.2389, lng: 73.0243 },
            { name: 'Madurai', state: 'Tamil Nadu', lat: 9.9252, lng: 78.1198 },
            { name: 'Raipur', state: 'Chhattisgarh', lat: 21.2514, lng: 81.6296 },
            { name: 'Kota', state: 'Rajasthan', lat: 25.2138, lng: 75.8648 },
            { name: 'Chandigarh', state: 'Chandigarh', lat: 30.7333, lng: 76.7794 },
            { name: 'Guwahati', state: 'Assam', lat: 26.1445, lng: 91.7362 },
            { name: 'Connaught Place', state: 'Delhi', lat: 28.6315, lng: 77.2167 },
            { name: 'India Gate', state: 'Delhi', lat: 28.6129, lng: 77.2295 },
            { name: 'Marine Drive', state: 'Maharashtra', lat: 18.9434, lng: 72.8234 },
            { name: 'Brigade Road', state: 'Karnataka', lat: 12.9716, lng: 77.6081 },
            { name: 'MG Road', state: 'Karnataka', lat: 12.9716, lng: 77.6195 },
            { name: 'Park Street', state: 'West Bengal', lat: 22.5535, lng: 88.3617 },
            { name: 'Banjara Hills', state: 'Telangana', lat: 17.4126, lng: 78.4482 },
            { name: 'Anna Nagar', state: 'Tamil Nadu', lat: 13.0878, lng: 80.2086 },
        ];
    }
    async geocodeText(searchTerm, options = {}) {
        try {
            const cleanTerm = this.cleanSearchTerm(searchTerm);
            const cached = await this.getCachedResult(cleanTerm);
            if (cached) {
                await this.updateCacheUsage(cleanTerm);
                return [cached];
            }
            const results = await this.searchIndianCities(cleanTerm);
            if (results.length > 0) {
                await this.cacheGeocodeResult(cleanTerm, searchTerm, results[0]);
                if (options.userWhatsapp) {
                    await this.saveUserSearchHistory(options.userWhatsapp, searchTerm, results[0]);
                }
                return results;
            }
            logger_1.logger.warn('No geocoding results found', { searchTerm, cleanTerm });
            return [];
        }
        catch (error) {
            logger_1.logger.error('Geocoding failed', { searchTerm, error });
            return [];
        }
    }
    cleanSearchTerm(term) {
        return term
            .toLowerCase()
            .trim()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async searchIndianCities(cleanTerm) {
        const results = [];
        for (const city of this.indianCities) {
            const cityName = city.name.toLowerCase();
            const stateName = city.state.toLowerCase();
            if (cityName === cleanTerm ||
                `${cityName} ${stateName}` === cleanTerm ||
                cleanTerm.includes(cityName)) {
                results.push({
                    latitude: city.lat,
                    longitude: city.lng,
                    formattedAddress: `${city.name}, ${city.state}, India`,
                    locality: city.name,
                    state: city.state,
                    confidence: cityName === cleanTerm ? 1.0 : 0.9,
                    geohash: this.generateGeohash(city.lat, city.lng),
                });
            }
        }
        if (results.length === 0) {
            for (const city of this.indianCities) {
                const cityName = city.name.toLowerCase();
                if (this.calculateSimilarity(cityName, cleanTerm) > 0.7) {
                    results.push({
                        latitude: city.lat,
                        longitude: city.lng,
                        formattedAddress: `${city.name}, ${city.state}, India`,
                        locality: city.name,
                        state: city.state,
                        confidence: 0.8,
                        geohash: this.generateGeohash(city.lat, city.lng),
                    });
                }
            }
        }
        return results
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, 3);
    }
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        if (longer.length === 0)
            return 1.0;
        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }
    levenshteinDistance(str1, str2) {
        const matrix = [];
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                }
                else {
                    matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                }
            }
        }
        return matrix[str2.length][str1.length];
    }
    generateGeohash(lat, lng, precision = 7) {
        const latRange = [-90, 90];
        const lngRange = [-180, 180];
        let geohash = '';
        let even = true;
        for (let i = 0; i < precision * 5; i++) {
            if (even) {
                const mid = (lngRange[0] + lngRange[1]) / 2;
                if (lng >= mid) {
                    geohash += '1';
                    lngRange[0] = mid;
                }
                else {
                    geohash += '0';
                    lngRange[1] = mid;
                }
            }
            else {
                const mid = (latRange[0] + latRange[1]) / 2;
                if (lat >= mid) {
                    geohash += '1';
                    latRange[0] = mid;
                }
                else {
                    geohash += '0';
                    latRange[1] = mid;
                }
            }
            even = !even;
        }
        return geohash;
    }
    async getCachedResult(searchTerm) {
        try {
            const [cached] = await database_1.db
                .select()
                .from(schema_extensions_1.geocodeCacheEnhanced)
                .where((0, drizzle_orm_1.eq)(schema_extensions_1.geocodeCacheEnhanced.searchTerm, searchTerm))
                .limit(1);
            if (cached) {
                return {
                    latitude: parseFloat(cached.latitude),
                    longitude: parseFloat(cached.longitude),
                    formattedAddress: cached.formattedAddress || cached.originalAddress,
                    locality: cached.locality || undefined,
                    state: cached.state || undefined,
                    confidence: parseFloat(cached.confidence || '1.0'),
                    geohash: cached.geohash,
                };
            }
            return null;
        }
        catch (error) {
            logger_1.logger.error('Failed to get cached result', { searchTerm, error });
            return null;
        }
    }
    async cacheGeocodeResult(searchTerm, originalAddress, result) {
        try {
            await database_1.db.insert(schema_extensions_1.geocodeCacheEnhanced).values({
                searchTerm,
                originalAddress,
                latitude: result.latitude.toString(),
                longitude: result.longitude.toString(),
                geohash: result.geohash,
                formattedAddress: result.formattedAddress,
                locality: result.locality,
                state: result.state,
                confidence: result.confidence.toString(),
                createdAt: new Date(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to cache geocode result', { searchTerm, error });
        }
    }
    async updateCacheUsage(searchTerm) {
        try {
            await database_1.db
                .update(schema_extensions_1.geocodeCacheEnhanced)
                .set({
                hitCount: (0, drizzle_orm_1.sql) `${schema_extensions_1.geocodeCacheEnhanced.hitCount} + 1`,
                lastUsed: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_extensions_1.geocodeCacheEnhanced.searchTerm, searchTerm));
        }
        catch (error) {
            logger_1.logger.error('Failed to update cache usage', { searchTerm, error });
        }
    }
    async saveUserSearchHistory(userWhatsapp, searchTerm, result) {
        try {
            await database_1.db.insert(schema_extensions_1.userSearchHistory).values({
                userWhatsapp,
                searchTerm,
                latitude: result.latitude.toString(),
                longitude: result.longitude.toString(),
                resultCount: 1,
                createdAt: new Date(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to save user search history', { userWhatsapp, searchTerm, error });
        }
    }
    async getUserRecentSearches(userWhatsapp, limit = 5) {
        try {
            const recent = await database_1.db
                .select({ searchTerm: schema_extensions_1.userSearchHistory.searchTerm })
                .from(schema_extensions_1.userSearchHistory)
                .where((0, drizzle_orm_1.eq)(schema_extensions_1.userSearchHistory.userWhatsapp, userWhatsapp))
                .orderBy((0, drizzle_orm_1.desc)(schema_extensions_1.userSearchHistory.createdAt))
                .limit(limit);
            return recent.map(r => r.searchTerm);
        }
        catch (error) {
            logger_1.logger.error('Failed to get user recent searches', { userWhatsapp, error });
            return [];
        }
    }
}
exports.GeocodingService = GeocodingService;
exports.geocodingService = new GeocodingService();
//# sourceMappingURL=geocoding.js.map