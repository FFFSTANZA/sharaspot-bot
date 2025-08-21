declare class WhatsAppService {
    private readonly baseUrl;
    private readonly headers;
    constructor();
    sendTextMessage(to: string, message: string): Promise<boolean>;
    sendButtonMessage(to: string, body: string, buttons: Array<{
        id: string;
        title: string;
    }>, header?: string): Promise<boolean>;
    sendListMessage(to: string, body: string, buttonText: string, sections: Array<{
        title: string;
        rows: Array<{
            id: string;
            title: string;
            description?: string;
        }>;
    }>, header?: string): Promise<boolean>;
    markAsRead(messageId: string): Promise<boolean>;
    sendLocationMessage(to: string, latitude: number, longitude: number, name: string, address: string): Promise<boolean>;
    sendTemplateMessage(to: string, templateName: string, parameters?: string[]): Promise<boolean>;
}
export declare const whatsappService: WhatsAppService;
export {};
//# sourceMappingURL=whatsapp.d.ts.map