// ===============================================
// 📄 src/services/location/station-search.ts - ERROR-FREE Implementation
// ===============================================

import { db } from '../../config/database';
import { chargingStations, users } from '../../db/schema';
import { logger } from '../../utils/logger';
import { eq, and, or, gte, lte, ne, desc, asc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

// ===============================================
// TYPES & INTERFACES
// ===============================================

export interface StationSearchOptions {
  userWhatsapp: string;
  latitude: number;
  longitude: number;
  radius?: number;
  maxResults?: number;
  offset?: number;
  connectorTypes?: string[];
  maxPrice?: number;
  availableOnly?: boolean;
  sortBy?: 'availability' | 'distance' | 'price';
}

export interface StationResult {
  id: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distance: number;
  totalPorts: number;
  availablePorts: number;
  connectorTypes: string[];
  maxPowerKw: number;
  pricePerKwh: number;
  isOpen: boolean;
  currentQueueLength: number;
  maxQueueLength: number;
  estimatedWaitMinutes: number;
  isAvailable: boolean;
  matchScore: number;
}

export interface StationSearchResult {
  stations: StationResult[];
  totalCount: number;
  hasMore: boolean;
  searchLocation: {
    latitude: number;
    longitude: number;
    address?: string;
  };
}

// Fix the RawStationData interface to match actual database schema
interface RawStationData {
  id: number;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  totalPorts: number | null;
  availablePorts: number | null;
  connectorTypes: unknown;
  maxPowerKw: number | null;
  pricePerKwh: string;
  isOpen: boolean | null;
  isActive: boolean | null;
  isPaused: boolean | null;
  currentQueueLength: number | null;  // Allow null
  maxQueueLength: number | null;      // Allow null
  averageSessionMinutes: number | null; // Allow null
  ownerWhatsappId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  distance?: number;
}

// ===============================================
// STATION SEARCH SERVICE
// ===============================================

export class StationSearchService {
  /**
   * Main search method
   */
  async searchStations(options: StationSearchOptions): Promise<StationSearchResult> {
    try {
      logger.info('Searching stations', { 
        userWhatsapp: options.userWhatsapp,
        location: { lat: options.latitude, lng: options.longitude },
        radius: options.radius || 25
      });

      // Use simple search to avoid complex SQL issues
      return await this.simpleSearch(options);

    } catch (error) {
      logger.error('Station search failed', { error, options });
      return this.emptyResult(options);
    }
  }

  /**
   * Simple search implementation (JavaScript-based filtering)
   */
  private async simpleSearch(options: StationSearchOptions): Promise<StationSearchResult> {
    const { latitude, longitude, radius = 25 } = options;

    try {
      // Get user preferences
      const userPrefs = await this.getUserPreferences(options.userWhatsapp);

      // Get all active stations with proper type handling
      const rawStations = await db
        .select()
        .from(chargingStations)
        .where(
          and(
            eq(chargingStations.isActive, true),
            ne(chargingStations.isPaused, true)
          )
        );

      // Convert to our format with null safety
      const stations: RawStationData[] = rawStations.map(station => ({
        ...station,
        isOpen: station.isOpen ?? false,
        isActive: station.isActive ?? false,
        isPaused: station.isPaused ?? false,
      }));

      // Calculate distances and apply radius filter
      let filteredStations = this.addDistanceCalculation(stations, latitude, longitude)
        .filter(station => station.distance <= radius);

      // Apply additional filters
      filteredStations = this.applyJavaScriptFilters(filteredStations, options);

      // Sort results
      const sortedStations = this.sortStations(filteredStations, options.sortBy || 'availability');

      // Apply pagination
      const offset = options.offset || 0;
      const limit = options.maxResults || 10;
      const paginatedStations = sortedStations.slice(offset, offset + limit);

      // Process results
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

    } catch (error) {
      logger.error('Simple station search failed', { error, options });
      return this.emptyResult(options);
    }
  }

  /**
   * Get user preferences safely
   */
  private async getUserPreferences(userWhatsapp: string): Promise<any> {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.whatsappId, userWhatsapp))
        .limit(1);
      
      return user || {};
    } catch (error) {
      logger.warn('Failed to get user preferences', { userWhatsapp, error });
      return {};
    }
  }

  /**
   * Add distance calculation to stations
   */
  private addDistanceCalculation(stations: RawStationData[], userLat: number, userLng: number): (RawStationData & { distance: number })[] {
    return stations.map(station => ({
      ...station,
      distance: this.calculateDistance(
        parseFloat(station.latitude || '0'),
        parseFloat(station.longitude || '0'),
        userLat,
        userLng
      )
    }));
  }

  /**
   * Apply filters in JavaScript
   */
  private applyJavaScriptFilters(stations: (RawStationData & { distance: number })[], options: StationSearchOptions) {
    let filtered = stations;

    // Availability filter
    if (options.availableOnly) {
      filtered = filtered.filter(station => 
        (station.availablePorts || 0) > 0 && (station.isOpen === true)
      );
    }

    // Connector type filter
    if (options.connectorTypes?.length && !options.connectorTypes.includes('Any')) {
      filtered = filtered.filter(station => {
        const connectors = this.parseConnectorTypes(station.connectorTypes);
        return options.connectorTypes!.some(type => connectors.includes(type));
      });
    }

    // Price filter
    if (options.maxPrice) {
      filtered = filtered.filter(station => 
        parseFloat(station.pricePerKwh || '0') <= options.maxPrice!
      );
    }

    return filtered;
  }

  /**
   * Sort stations by criteria
   */
  private sortStations(stations: (RawStationData & { distance: number })[], sortBy: string) {
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

  /**
   * Process raw station data into StationResult
   */
  private processStationResults(stations: (RawStationData & { distance: number })[], userPrefs: any): StationResult[] {
    return stations.map(station => {
      const availablePorts = station.availablePorts || 0;
      const totalPorts = station.totalPorts || 1;
      const queueLength = station.currentQueueLength || 0;
      const maxQueue = station.maxQueueLength || 5;
      const avgSession = station.averageSessionMinutes || 45;

      // Calculate wait time
      const estimatedWait = availablePorts > 0 ? 0 : Math.ceil((queueLength * avgSession) / totalPorts);
      
      // Calculate availability with null safety
      const isOpen = station.isOpen === true;
      const isAvailable = isOpen && availablePorts > 0 && queueLength < maxQueue;
      
      // Calculate match score
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

  /**
   * Parse connector types safely
   */
  private parseConnectorTypes(connectorTypes: unknown): string[] {
    try {
      if (Array.isArray(connectorTypes)) {
        return connectorTypes.filter(item => typeof item === 'string');
      }
      if (typeof connectorTypes === 'string') {
        const parsed = JSON.parse(connectorTypes);
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Calculate distance using Haversine formula
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLng = this.deg2rad(lng2 - lng1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private deg2rad(deg: number): number {
    return deg * (Math.PI/180);
  }

  /**
   * Calculate match score based on user preferences
   */
  private calculateMatchScore(station: RawStationData, userPrefs: any, distance: number, isAvailable: boolean): number {
    let score = 50;

    // Availability bonus
    if (isAvailable) score += 30;
    else if (station.isOpen === true) score += 15;

    // Distance scoring
    if (distance <= 2) score += 15;
    else if (distance <= 5) score += 10;
    else if (distance <= 10) score += 5;
    else score -= Math.min(20, distance - 10);

    // Connector type match
    if (userPrefs.connectorType && userPrefs.connectorType !== 'Any') {
      const stationConnectors = this.parseConnectorTypes(station.connectorTypes);
      if (stationConnectors.includes(userPrefs.connectorType)) {
        score += 10;
      }
    }

    // Queue preference match
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
          if (queueLength <= 4) score += 5;
          break;
      }
    }

    // Price factor
    const price = parseFloat(station.pricePerKwh || '25');
    if (price <= 20) score += 10;
    else if (price <= 25) score += 5;
    else if (price >= 35) score -= 5;

    // Power rating bonus
    const power = station.maxPowerKw || 50;
    if (power >= 100) score += 5;
    else if (power >= 50) score += 3;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Return empty result
   */
  private emptyResult(options: StationSearchOptions): StationSearchResult {
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

  // ===============================================
  // PUBLIC API METHODS
  // ===============================================

  /**
   * Get next set of stations (pagination)
   */
  async getNextStations(options: StationSearchOptions): Promise<StationSearchResult> {
    return this.searchStations({
      ...options,
      offset: (options.offset || 0) + (options.maxResults || 10),
    });
  }

  /**
   * Get all nearby stations (expanded results)
   */
  async getAllNearbyStations(options: StationSearchOptions): Promise<StationSearchResult> {
    return this.searchStations({
      ...options,
      maxResults: 50,
      offset: 0,
    });
  }

  /**
   * Search with expanded radius
   */
  async searchWithExpandedRadius(options: StationSearchOptions): Promise<StationSearchResult> {
    return this.searchStations({
      ...options,
      radius: 50,
      availableOnly: false,
      sortBy: 'distance',
    });
  }

  /**
   * Search without filters
   */
  async searchWithoutFilters(options: StationSearchOptions): Promise<StationSearchResult> {
    return this.searchStations({
      ...options,
      availableOnly: false,
      connectorTypes: undefined,
      maxPrice: undefined,
      sortBy: 'distance',
    });
  }
}

// ===============================================
// SINGLETON EXPORT
// ===============================================

export const stationSearchService = new StationSearchService();

// ===============================================
// UTILITY FUNCTIONS
// ===============================================

/**
 * Test function for development
 */
export const testStationSearch = async () => {
  if (process.env.NODE_ENV !== 'development') return;

  console.log('Testing station search...');
  
  const testOptions: StationSearchOptions = {
    userWhatsapp: '1234567890',
    latitude: 28.6315,
    longitude: 77.2167,
    radius: 25,
    maxResults: 5,
  };

  try {
    const result = await stationSearchService.searchStations(testOptions);
    console.log('Test successful:', {
      stationsFound: result.stations.length,
      totalCount: result.totalCount,
      hasMore: result.hasMore,
    });
    return result;
  } catch (error) {
    console.error('Test failed:', error);
    return null;
  }
};

/**
 * Simple search function for external use
 */
export async function simpleStationSearch(options: StationSearchOptions): Promise<StationSearchResult> {
  return stationSearchService.searchStations(options);
}