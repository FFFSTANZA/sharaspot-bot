export declare class WebhookLocationController {
    handleLocationButton(whatsappId: string, buttonId: string, buttonTitle: string): Promise<void>;
    handleLocationList(whatsappId: string, listId: string, listTitle: string): Promise<void>;
    private backToTopResult;
    private expandSearchRadius;
    private removeFilters;
    private startNewSearch;
    private requestGPSLocation;
    private requestAddressInput;
    private handleStationSelection;
    private handleStationBooking;
    private showStationDetails;
}
export declare const webhookLocationController: WebhookLocationController;
//# sourceMappingURL=webhook-location.d.ts.map