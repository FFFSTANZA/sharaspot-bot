import { Request, Response } from 'express';
export declare class WebhookController {
    private readonly waitingUsers;
    verifyWebhook(req: Request, res: Response): Promise<void>;
    handleWebhook(req: Request, res: Response): Promise<void>;
    private extractMessages;
    private processMessage;
    private routeMessage;
    private handleTextMessage;
    private handleButtonMessage;
    private handleListMessage;
    private handleLocationMessage;
    private routeButtonAction;
    private routeListAction;
    private handleStationButton;
    private handleLocationButton;
    private handleCoreButton;
    private handleCommand;
    private handleWaitingInput;
    private handleLocationList;
    private handlePotentialAddress;
    private looksLikeAddress;
    private handleGetDirections;
    private handleNearbyRequest;
    private handleGreeting;
    private startBooking;
    private showHelp;
    private showLocationHelp;
    private requestGPSLocation;
    private requestAddressInput;
    private requestProfileUpdate;
    private processNameInput;
    private processAddressInput;
    private isQueueButton;
    private isLocationButton;
    private isLocationList;
    private sendErrorMessage;
    getWaitingUsersCount(): number;
    cleanup(): void;
    getHealthStatus(): {
        status: 'healthy' | 'degraded';
        waitingUsers: number;
        uptime: string;
    };
}
export declare const webhookController: WebhookController;
//# sourceMappingURL=webhook.d.ts.map