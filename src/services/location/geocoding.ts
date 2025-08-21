import { db } from '../../config/database';
import { geocodeCacheEnhanced, userSearchHistory } from '../../db/schema-extensions';
import { logger } from '../../utils/logger';
import { eq, sql, desc } from 'drizzle-orm';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  locality?: string;
  subLocality?: string;
  state?: string;
  confidence: number;
  geohash: string;
}

export interface LocationSearchOptions {
  userWhatsapp?: string;
  maxResults?: number;
  biasLocation?: { lat: number; lng: number };
}

export class GeocodingService {
  // Indian cities database for text search
  private readonly indianCities = [
    // Major metros
    { name: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lng: 72.8777 },
    { name: 'Delhi', state: 'Delhi', lat: 28.7041, lng: 77.1025 },
    { name: 'Bangalore', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
    { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
    { name: 'Hyderabad', state: 'Telangana', lat: 17.3850, lng: 78.4867 },
    { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
    { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
    { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
    
    // Tier 1 cities
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
    
    // Add common areas/landmarks
    { name: 'Connaught Place', state: 'Delhi', lat: 28.6315, lng: 77.2167 },
    { name: 'India Gate', state: 'Delhi', lat: 28.6129, lng: 77.2295 },
    { name: 'Marine Drive', state: 'Maharashtra', lat: 18.9434, lng: 72.8234 },
    { name: 'Brigade Road', state: 'Karnataka', lat: 12.9716, lng: 77.6081 },
    { name: 'MG Road', state: 'Karnataka', lat: 12.9716, lng: 77.6195 },
    { name: 'Park Street', state: 'West Bengal', lat: 22.5535, lng: 88.3617 },
    { name: 'Banjara Hills', state: 'Telangana', lat: 17.4126, lng: 78.4482 },
    { name: 'Anna Nagar', state: 'Tamil Nadu', lat: 13.0878, lng: 80.2086 },
  ];

  /**
   * Geocode text address/place name
   */
  async geocodeText(searchTerm: string, options: LocationSearchOptions = {}): Promise<GeocodeResult[]> {
    try {
      const cleanTerm = this.cleanSearchTerm(searchTerm);
      
      // Check cache first
      const cached = await this.getCachedResult(cleanTerm);
      if (cached) {
        await this.updateCacheUsage(cleanTerm);
        return [cached];
      }

      // Search in our Indian cities database
      const results = await this.searchIndianCities(cleanTerm);
      
      if (results.length > 0) {
        // Cache the best result
        await this.cacheGeocodeResult(cleanTerm, searchTerm, results[0]);
        
        // Save to user search history
        if (options.userWhatsapp) {
          await this.saveUserSearchHistory(options.userWhatsapp, searchTerm, results[0]);
        }
        
        return results;
      }

      logger.warn('No geocoding results found', { searchTerm, cleanTerm });
      return [];

    } catch (error) {
      logger.error('Geocoding failed', { searchTerm, error });
      return [];
    }
  }

  /**
   * Clean and normalize search term
   */
  private cleanSearchTerm(term: string): string {
    return term
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Search in Indian cities database
   */
  private async searchIndianCities(cleanTerm: string): Promise<GeocodeResult[]> {
    const results: GeocodeResult[] = [];
    
    // Exact matches first
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

    // Fuzzy matches
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

    // Sort by confidence
    return results
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);
  }

  /**
   * Calculate string similarity (simple algorithm)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  private levenshteinDistance(str1: string, str2: string): number {
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
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Generate geohash for location
   */
  private generateGeohash(lat: number, lng: number, precision: number = 7): string {
    // Simple geohash implementation for clustering nearby locations
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
        } else {
          geohash += '0';
          lngRange[1] = mid;
        }
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (lat >= mid) {
          geohash += '1';
          latRange[0] = mid;
        } else {
          geohash += '0';
          latRange[1] = mid;
        }
      }
      even = !even;
    }
    
    return geohash;
  }

  /**
   * Get cached geocode result
   */
  private async getCachedResult(searchTerm: string): Promise<GeocodeResult | null> {
    try {
      const [cached] = await db
        .select()
        .from(geocodeCacheEnhanced)
        .where(eq(geocodeCacheEnhanced.searchTerm, searchTerm))
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
    } catch (error) {
      logger.error('Failed to get cached result', { searchTerm, error });
      return null;
    }
  }

  /**
   * Cache geocode result
   */
  private async cacheGeocodeResult(searchTerm: string, originalAddress: string, result: GeocodeResult): Promise<void> {
    try {
      await db.insert(geocodeCacheEnhanced).values({
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
    } catch (error) {
      logger.error('Failed to cache geocode result', { searchTerm, error });
    }
  }

  /**
   * Update cache usage stats
   */
  private async updateCacheUsage(searchTerm: string): Promise<void> {
    try {
      await db
        .update(geocodeCacheEnhanced)
        .set({
          hitCount: sql`${geocodeCacheEnhanced.hitCount} + 1`,
          lastUsed: new Date(),
        })
        .where(eq(geocodeCacheEnhanced.searchTerm, searchTerm));
    } catch (error) {
      logger.error('Failed to update cache usage', { searchTerm, error });
    }
  }

  /**
   * Save user search history
   */
  private async saveUserSearchHistory(userWhatsapp: string, searchTerm: string, result: GeocodeResult): Promise<void> {
    try {
      await db.insert(userSearchHistory).values({
        userWhatsapp,
        searchTerm,
        latitude: result.latitude.toString(),
        longitude: result.longitude.toString(),
        resultCount: 1,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to save user search history', { userWhatsapp, searchTerm, error });
    }
  }

  /**
   * Get user's recent searches for suggestions
   */
  async getUserRecentSearches(userWhatsapp: string, limit: number = 5): Promise<string[]> {
    try {
      const recent = await db
        .select({ searchTerm: userSearchHistory.searchTerm })
        .from(userSearchHistory)
        .where(eq(userSearchHistory.userWhatsapp, userWhatsapp))
        .orderBy(desc(userSearchHistory.createdAt))
        .limit(limit);

      return recent.map(r => r.searchTerm);
    } catch (error) {
      logger.error('Failed to get user recent searches', { userWhatsapp, error });
      return [];
    }
  }
}

export const geocodingService = new GeocodingService();