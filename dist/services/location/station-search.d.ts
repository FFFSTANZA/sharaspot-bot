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
export declare class StationSearchService {
    searchStations(options: StationSearchOptions): Promise<StationSearchResult>;
    private simpleSearch;
    private getUserPreferences;
    private addDistanceCalculation;
    private applyJavaScriptFilters;
    private sortStations;
    private processStationResults;
    private parseConnectorTypes;
    private calculateDistance;
    private deg2rad;
    private calculateMatchScore;
    private emptyResult;
    getNextStations(options: StationSearchOptions): Promise<StationSearchResult>;
    getAllNearbyStations(options: StationSearchOptions): Promise<StationSearchResult>;
    searchWithExpandedRadius(options: StationSearchOptions): Promise<StationSearchResult>;
    searchWithoutFilters(options: StationSearchOptions): Promise<StationSearchResult>;
}
export declare const stationSearchService: StationSearchService;
export declare const testStationSearch: () => Promise<StationSearchResult | null | undefined>;
export declare function simpleStationSearch(options: StationSearchOptions): Promise<StationSearchResult>;
//# sourceMappingURL=station-search.d.ts.map