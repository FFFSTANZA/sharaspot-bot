export declare class QueueWebhookController {
    handleQueueButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void>;
    handleQueueList(whatsappId: string, listId: string, listTitle: string): Promise<void>;
    private routeQueueAction;
    private handleQueueCategory;
    private handleSessionCategory;
    private handleStationCategory;
    private handleSpecificActions;
    private handleQueueStatus;
    private handleJoinQueue;
    private handleQueueCancel;
    private handleConfirmCancel;
    private handleSessionStart;
    private handleSessionStatus;
    private handleSessionStop;
    private handleSessionExtend;
    private handleLiveUpdates;
    private handleSmartActions;
    private handleNotificationActions;
    private handleStationRating;
    private handleSmartSchedule;
    private formatQueueStatus;
    private formatSessionStatus;
    private sendQueueManagementButtons;
    private sendSessionManagementButtons;
    private sendFindStationButtons;
    private getQueueStatusEmoji;
    private getStatusDescription;
    private generateProgressBar;
    private getQueueTip;
    private getSmartRecommendation;
    private calculateExtendedTime;
    private getSimulatedQueueData;
    private getSimulatedSessionData;
    private handleUnknownAction;
    private handleError;
    getHealthStatus(): {
        status: 'healthy' | 'degraded';
        activeQueues: number;
        activeSessions: number;
        lastActivity: string;
    };
}
export declare const queueWebhookController: QueueWebhookController;
//# sourceMappingURL=queue-webhook.d.ts.map