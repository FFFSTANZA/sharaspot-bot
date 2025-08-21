"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testStationSearch = exports.stationSearchService = exports.StationSearchService = void 0;
exports.simpleStationSearch = simpleStationSearch;
const database_1 = require("../../config/database");
const schema_1 = require("../../db/schema");
const logger_1 = require("../../utils/logger");
const drizzle_orm_1 = require("drizzle-orm");
class StationSearchService {
    async searchStations(options) {
        try {
            logger_1.logger.info('Searching stations', {
                userWhatsapp: options.userWhatsapp,
                location: { lat: options.latitude, lng: options.longitude },
                radius: options.radius || 25
            });
            return await this.simpleSearch(options);
        }
        catch (error) {
            logger_1.logger.error('Station search failed', { error, options });
            return this.emptyResult(options);
        }
    }
    async simpleSearch(options) {
        const { latitude, longitude, radius = 25 } = options;
        try {
            const userPrefs = await this.getUserPreferences(options.userWhatsapp);
            const rawStations = await database_1.db
                .select()
                .from(schema_1.chargingStations)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.chargingStations.isActive, true), (0, drizzle_orm_1.ne)(schema_1.chargingStations.isPaused, true)));
            const stations = rawStations.map(station => ({
                ...station,
                isOpen: station.isOpen ?? false,
                isActive: station.isActive ?? false,
                isPaused: station.isPaused ?? false,
            }));
            let filteredStations = this.addDistanceCalculation(stations, latitude, longitude)
                .filter(station => station.distance <= radius);
            filteredStations = this.applyJavaScriptFilters(filteredStations, options);
            const sortedStations = this.sortStations(filteredStations, options.sortBy || 'availability');
            const offset = options.offset || 0;
            const limit = options.maxResults || 10;
            const paginatedStations = sortedStations.slice(offset, offset + limit);
            const processedStations = this.processStationResults(paginatedStations, userPrefs);
            return {
                stations: processedStations,
                totalCount: filteredStations.length,
                hasMore: offset + paginatedStations.length < filteredStations.length,
                searchLocation: {
                    latitude: options.latitude,
                    longitude: options.longitude,
                },
            };
        }
        catch (error) {
            logger_1.logger.error('Simple station search failed', { error, options });
            return this.emptyResult(options);
        }
    }
    async getUserPreferences(userWhatsapp) {
        try {
            const [user] = await database_1.db
                .select()
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, userWhatsapp))
                .limit(1);
            return user || {};
        }
        catch (error) {
            logger_1.logger.warn('Failed to get user preferences', { userWhatsapp, error });
            return {};
        }
    }
    addDistanceCalculation(stations, userLat, userLng) {
        return stations.map(station => ({
            ...station,
            distance: this.calculateDistance(parseFloat(station.latitude || '0'), parseFloat(station.longitude || '0'), userLat, userLng)
        }));
    }
    applyJavaScriptFilters(stations, options) {
        let filtered = stations;
        if (options.availableOnly) {
            filtered = filtered.filter(station => (station.availablePorts || 0) > 0 && (station.isOpen === true));
        }
        if (options.connectorTypes?.length && !options.connectorTypes.includes('Any')) {
            filtered = filtered.filter(station => {
                const connectors = this.parseConnectorTypes(station.connectorTypes);
                return options.connectorTypes.some(type => connectors.includes(type));
            });
        }
        if (options.maxPrice) {
            filtered = filtered.filter(station => parseFloat(station.pricePerKwh || '0') <= options.maxPrice);
        }
        return filtered;
    }
    sortStations(stations, sortBy) {
        return stations.sort((a, b) => {
            switch (sortBy) {
                case 'availability':
                    const aAvailable = (a.availablePorts || 0);
                    const bAvailable = (b.availablePorts || 0);
                    if (aAvailable !== bAvailable) {
                        return bAvailable - aAvailable;
                    }
                    return a.distance - b.distance;
                case 'distance':
                    return a.distance - b.distance;
                case 'price':
                    const aPrice = parseFloat(a.pricePerKwh || '0');
                    const bPrice = parseFloat(b.pricePerKwh || '0');
                    if (aPrice !== bPrice) {
                        return aPrice - bPrice;
                    }
                    return a.distance - b.distance;
                default:
                    return a.distance - b.distance;
            }
        });
    }
    processStationResults(stations, userPrefs) {
        return stations.map(station => {
            const availablePorts = station.availablePorts || 0;
            const totalPorts = station.totalPorts || 1;
            const queueLength = station.currentQueueLength || 0;
            const maxQueue = station.maxQueueLength || 5;
            const avgSession = station.averageSessionMinutes || 45;
            const estimatedWait = availablePorts > 0 ? 0 : Math.ceil((queueLength * avgSession) / totalPorts);
            const isOpen = station.isOpen === true;
            const isAvailable = isOpen && availablePorts > 0 && queueLength < maxQueue;
            const matchScore = this.calculateMatchScore(station, userPrefs, station.distance, isAvailable);
            return {
                id: station.id,
                name: station.name || '',
                address: station.address || '',
                latitude: parseFloat(station.latitude || '0'),
                longitude: parseFloat(station.longitude || '0'),
                distance: Math.round(station.distance * 10) / 10,
                totalPorts,
                availablePorts,
                connectorTypes: this.parseConnectorTypes(station.connectorTypes),
                maxPowerKw: station.maxPowerKw || 50,
                pricePerKwh: parseFloat(station.pricePerKwh || '0'),
                isOpen,
                currentQueueLength: queueLength,
                maxQueueLength: maxQueue,
                estimatedWaitMinutes: estimatedWait,
                isAvailable,
                matchScore,
            };
        });
    }
    parseConnectorTypes(connectorTypes) {
        try {
            if (Array.isArray(connectorTypes)) {
                return connectorTypes.filter(item => typeof item === 'string');
            }
            if (typeof connectorTypes === 'string') {
                const parsed = JSON.parse(connectorTypes);
                return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
            }
            return [];
        }
        catch {
            return [];
        }
    }
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = this.deg2rad(lat2 - lat1);
        const dLng = this.deg2rad(lng2 - lng1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
    deg2rad(deg) {
        return deg * (Math.PI / 180);
    }
    calculateMatchScore(station, userPrefs, distance, isAvailable) {
        let score = 50;
        if (isAvailable)
            score += 30;
        else if (station.isOpen === true)
            score += 15;
        if (distance <= 2)
            score += 15;
        else if (distance <= 5)
            score += 10;
        else if (distance <= 10)
            score += 5;
        else
            score -= Math.min(20, distance - 10);
        if (userPrefs.connectorType && userPrefs.connectorType !== 'Any') {
            const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
            if (stationConnectors.includes(userPrefs.connectorType)) {
                score += 10;
            }
        }
        const queueLength = station.currentQueueLength || 0;
        if (userPrefs.queuePreference) {
            switch (userPrefs.queuePreference) {
                case 'Free Now':
                    score += queueLength === 0 ? 15 : -10;
                    break;
                case 'Wait 15m':
                    score += queueLength <= 2 ? 10 : -5;
                    break;
                case 'Wait 30m':
                    if (queueLength <= 4)
                        score += 5;
                    break;
            }
        }
        const price = parseFloat(station.pricePerKwh || '25');
        if (price <= 20)
            score += 10;
        else if (price <= 25)
            score += 5;
        else if (price >= 35)
            score -= 5;
        const power = station.maxPowerKw || 50;
        if (power >= 100)
            score += 5;
        else if (power >= 50)
            score += 3;
        return Math.max(0, Math.min(100, Math.round(score)));
    }
    emptyResult(options) {
        return {
            stations: [],
            totalCount: 0,
            hasMore: false,
            searchLocation: {
                latitude: options.latitude,
                longitude: options.longitude,
            },
        };
    }
    async getNextStations(options) {
        return this.searchStations({
            ...options,
            offset: (options.offset || 0) + (options.maxResults || 10),
        });
    }
    async getAllNearbyStations(options) {
        return this.searchStations({
            ...options,
            maxResults: 50,
            offset: 0,
        });
    }
    async searchWithExpandedRadius(options) {
        return this.searchStations({
            ...options,
            radius: 50,
            availableOnly: false,
            sortBy: 'distance',
        });
    }
    async searchWithoutFilters(options) {
        return this.searchStations({
            ...options,
            availableOnly: false,
            connectorTypes: undefined,
            maxPrice: undefined,
            sortBy: 'distance',
        });
    }
}
exports.StationSearchService = StationSearchService;
exports.stationSearchService = new StationSearchService();
const testStationSearch = async () => {
    if (process.env.NODE_ENV !== 'development')
        return;
    console.log('Testing station search...');
    const testOptions = {
        userWhatsapp: '1234567890',
        latitude: 28.6315,
        longitude: 77.2167,
        radius: 25,
        maxResults: 5,
    };
    try {
        const result = await exports.stationSearchService.searchStations(testOptions);
        console.log('Test successful:', {
            stationsFound: result.stations.length,
            totalCount: result.totalCount,
            hasMore: result.hasMore,
        });
        return result;
    }
    catch (error) {
        console.error('Test failed:', error);
        return null;
    }
};
exports.testStationSearch = testStationSearch;
async function simpleStationSearch(options) {
    return exports.stationSearchService.searchStations(options);
}
//# sourceMappingURL=station-search.js.map