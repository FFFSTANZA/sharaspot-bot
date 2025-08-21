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
    biasLocation?: {
        lat: number;
        lng: number;
    };
}
export declare class GeocodingService {
    private readonly indianCities;
    geocodeText(searchTerm: string, options?: LocationSearchOptions): Promise<GeocodeResult[]>;
    private cleanSearchTerm;
    private searchIndianCities;
    private calculateSimilarity;
    private levenshteinDistance;
    private generateGeohash;
    private getCachedResult;
    private cacheGeocodeResult;
    private updateCacheUsage;
    private saveUserSearchHistory;
    getUserRecentSearches(userWhatsapp: string, limit?: number): Promise<string[]>;
}
export declare const geocodingService: GeocodingService;
//# sourceMappingURL=geocoding.d.ts.map