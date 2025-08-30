interface TestResult {
    testName: string;
    phase: 1 | 2 | 3 | 4 | 5;
    category: 'foundation' | 'preferences' | 'location' | 'booking' | 'queue' | 'session' | 'analytics' | 'automation' | 'integration' | 'performance';
    priority: 'critical' | 'high' | 'medium' | 'low';
    success: boolean;
    duration: number;
    details?: any;
    error?: string;
    retryCount?: number;
    warnings?: string[];
}
interface PhaseResult {
    phase: number;
    phaseName: string;
    tests: TestResult[];
    passed: number;
    failed: number;
    warnings: number;
    successRate: number;
    duration: number;
    status: 'PASSED' | 'FAILED' | 'WARNING' | 'SKIPPED';
    criticalFailures: number;
    coverageScore: number;
}
interface PerformanceMetrics {
    avgTestTime: number;
    slowestTest: TestResult;
    fastestTest: TestResult;
    phasePerformance: {
        phase: number;
        avgTime: number;
        totalTime: number;
    }[];
    concurrentOperationsScore: number;
    throughputScore: number;
    errorRate: number;
}
interface ComprehensiveReport {
    testSuiteName: string;
    version: string;
    timestamp: string;
    environment: string;
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalWarnings: number;
    overallSuccessRate: number;
    totalDuration: number;
    phases: PhaseResult[];
    performanceMetrics: PerformanceMetrics;
    systemHealth: {
        databaseConnection: boolean;
        servicesHealth: Record<string, boolean>;
        memoryUsage: number;
        testEnvironmentStable: boolean;
    };
    recommendations: string[];
    readinessScore: number;
}
declare class EnhancedComprehensiveTester {
    private results;
    private readonly testUsers;
    private readonly testStations;
    private readonly testLocations;
    private retryConfig;
    private performanceThresholds;
    runCompleteTestSuite(): Promise<ComprehensiveReport>;
    private performSystemHealthCheck;
    private checkDatabaseHealth;
    private checkServicesHealth;
    private checkMemoryUsage;
    private checkEnvironmentVariables;
    private runPhase1Tests;
    private runPhase4Tests;
    private runPhase5Tests;
    private test;
    private delay;
    private runPhase2Tests;
    private runPhase3Tests;
    private generateEnhancedReport;
    private calculateConcurrentOperationsScore;
    private calculateThroughputScore;
    private assessServicesHealth;
    private calculateReadinessScore;
    private logEnhancedResults;
    private generateRecommendations;
    runPhase(phase: 1 | 2 | 3 | 4 | 5): Promise<PhaseResult>;
    getResults(): TestResult[];
    getResultsByPhase(phase: number): TestResult[];
    getResultsByPriority(priority: TestResult['priority']): TestResult[];
    getFailedTests(): TestResult[];
    getCriticalFailures(): TestResult[];
    getPerformanceIssues(): TestResult[];
    reset(): void;
    quickHealthCheck(): Promise<{
        healthy: boolean;
        issues: string[];
    }>;
}
export declare const enhancedComprehensiveTester: EnhancedComprehensiveTester;
export declare const testPhase1Enhanced: () => Promise<PhaseResult>;
export declare const testPhase2Enhanced: () => Promise<PhaseResult>;
export declare const testPhase3Enhanced: () => Promise<PhaseResult>;
export declare const testPhase4Enhanced: () => Promise<PhaseResult>;
export declare const testPhase5Enhanced: () => Promise<PhaseResult>;
export declare const testAllPhasesEnhanced: () => Promise<ComprehensiveReport>;
export declare const quickSystemHealth: () => Promise<{
    healthy: boolean;
    issues: string[];
}>;
export declare const getCriticalIssues: () => TestResult[];
export declare const getPerformanceReport: () => {
    totalTests: number;
    avgDuration: number;
    slowTests: number;
    failureRate: number;
};
export {};
//# sourceMappingURL=phase4-tester.d.ts.map