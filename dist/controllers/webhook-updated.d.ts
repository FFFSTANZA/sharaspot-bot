import { Request, Response } from 'express';
export declare class WebhookControllerUpdated {
    private usersWaitingForName;
    private usersWaitingForAddress;
    verifyWebhook(req: Request, res: Response): void;
    handleWebhook(req: Request, res: Response): Promise<void>;
    private processWebhookAsync;
    private processMessage;
    private routeMessage;
    private handleTextInput;
    private handleTextCommand;
    private looksLikeAddress;
    private handleGreeting;
    private handleNameInput;
    private handleAddressInput;
    private handleHelpCommand;
    private handleStatusCommand;
    private handleBookCommand;
    private handleCancelCommand;
    private handleButtonReply;
    private handleListReply;
    private handleLocationMessage;
    private requestLocation;
}
export declare const webhookControllerUpdated: WebhookControllerUpdated;
//# sourceMappingURL=webhook-updated.d.ts.map