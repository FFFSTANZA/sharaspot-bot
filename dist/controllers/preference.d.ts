export declare class PreferenceController {
    startPreferenceGathering(whatsappId: string, isOnboarding?: boolean): Promise<void>;
    handlePreferenceResponse(whatsappId: string, responseType: 'button' | 'text', responseValue: string): Promise<void>;
    private showEVModelStep;
    private handleEVModelResponse;
    private showPopularEVList;
    private showConnectorTypeStep;
    private handleConnectorTypeResponse;
    private showChargingIntentStep;
    private handleChargingIntentResponse;
    private showQueuePreferenceStep;
    private handleQueuePreferenceResponse;
    private completePreferenceSetup;
    private requestLocation;
    showLocationHelp(whatsappId: string): Promise<void>;
    requestAddressInput(whatsappId: string): Promise<void>;
}
export declare const preferenceController: PreferenceController;
//# sourceMappingURL=preference.d.ts.map