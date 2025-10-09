export interface ChargingSession {
    id: string;
    userWhatsapp: string;
    stationId: number;
    stationName?: string;
    startTime: Date;
    endTime?: Date;
    energyDelivered: number;
    currentBatteryLevel: number;
    targetBatteryLevel: number;
    chargingRate: number;
    pricePerKwh: number;
    totalCost: number;
    status: 'active' | 'paused' | 'completed' | 'stopped';
    efficiency: number;
    estimatedCompletion?: Date;
    queueId?: number;
}
export interface SessionStatus {
    currentBatteryLevel: number;
    chargingRate: number;
    energyAdded: number;
    currentCost: number;
    duration: string;
    estimatedCompletion: string;
    efficiency: number;
    statusMessage: string;
}
export interface CostBreakdown {
    energyRate: number;
    energyConsumed: number;
    energyCost: number;
    platformFee: number;
    gstRate: number;
    gst: number;
    totalCost: number;
    homeComparison: string;
    petrolComparison: string;
}
export interface UserStats {
    totalSessions: number;
    totalEnergyConsumed: number;
    totalCostSpent: number;
    avgSessionTime: number;
    favoriteStation: {
        id: number;
        name: string;
        sessionCount: number;
    } | null;
    totalSavings: number;
    avgEfficiency: number;
}
export interface SessionSummary {
    sessionId: string;
    duration: string;
    energyDelivered: number;
    finalBatteryLevel: number;
    totalCost: number;
    efficiency: number;
    stationName: string;
    startTime: Date;
    endTime: Date;
}
declare class SessionService {
    private activeSessions;
    private sessionMonitors;
    startSession(userWhatsapp: string, stationId: number, queueId?: number): Promise<ChargingSession | null>;
    getActiveSession(userWhatsapp: string, stationId: number): Promise<ChargingSession | null>;
    getSessionStatus(sessionId: string): Promise<SessionStatus | null>;
    getCostBreakdown(sessionId?: string): Promise<CostBreakdown>;
    pauseSession(userWhatsapp: string, stationId: number): Promise<boolean>;
    resumeSession(userWhatsapp: string, stationId: number): Promise<boolean>;
    completeSession(userWhatsapp: string, stationId: number): Promise<SessionSummary | null>;
    stopSession(userWhatsapp: string, stationId: number): Promise<boolean>;
    forceStopSession(userWhatsapp: string, stationId: number, reason?: string): Promise<boolean>;
    extendSession(userWhatsapp: string, stationId: number, newTarget: number): Promise<boolean>;
    private saveSessionToDatabase;
    private updateSessionInDatabase;
    private startSessionMonitoring;
    private updateSessionProgress;
    private calculateChargingProgress;
    private generateSessionId;
    private formatDuration;
    private getDefaultCostBreakdown;
    private calculateHomeComparison;
    private calculatePetrolComparison;
    private calculatePetrolEquivalentCost;
    getActiveSessions(): Map<string, ChargingSession>;
    getSessionById(sessionId: string): Promise<ChargingSession | null>;
    getSessionHistory(userWhatsapp: string, limit?: number): Promise<ChargingSession[]>;
    getUserStats(userWhatsapp: string): Promise<UserStats | null>;
    emergencyStopStation(stationId: number): Promise<boolean>;
    getSessionsByStation(stationId: number, limit?: number): Promise<ChargingSession[]>;
    getStationStats(stationId: number): Promise<any>;
    cleanupExpiredSessions(): Promise<number>;
    getRealTimeSessionData(): Promise<any>;
    forceCompleteSession(sessionId: string): Promise<boolean>;
}
export declare const sessionService: SessionService;
export {};
//# sourceMappingURL=session.d.ts.map