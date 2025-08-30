interface ScheduledTask {
    id: string;
    type: 'cleanup' | 'optimization' | 'notification' | 'analytics';
    scheduledTime: Date;
    retries: number;
    maxRetries: number;
}
declare class QueueScheduler {
    private isRunning;
    private startTime;
    private intervals;
    private tasks;
    private readonly processes;
    start(): Promise<void>;
    stop(): Promise<void>;
    private startProcess;
    private cleanupExpiredReservations;
    private optimizeQueues;
    private optimizeStationQueue;
    private processNotifications;
    private updateAnalytics;
    private monitorSessions;
    private checkAvailabilityAlerts;
    private monitorPerformance;
    private countActiveQueues;
    private getCacheSize;
    private cleanupCache;
    scheduleTask(type: ScheduledTask['type'], scheduledTime: Date, maxRetries?: number): string;
    private executeTask;
    getStatus(): {
        isRunning: boolean;
        uptime: number;
        activeProcesses: string[];
        scheduledTasks: number;
        processes: {
            name: string;
            interval: string;
        }[];
    };
    healthCheck(): Promise<boolean>;
}
export declare const queueScheduler: QueueScheduler;
export {};
//# sourceMappingURL=queue-scheduler.d.ts.map