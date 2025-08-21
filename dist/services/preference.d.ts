import { type User } from '../db/schema';
export interface PreferenceStep {
    step: 'ev_model' | 'connector_type' | 'charging_intent' | 'queue_preference' | 'completed';
    data?: any;
}
export interface UserContext {
    whatsappId: string;
    currentStep: PreferenceStep['step'];
    preferenceData: {
        evModel?: string;
        connectorType?: string;
        chargingIntent?: string;
        queuePreference?: string;
    };
    isOnboarding: boolean;
}
export declare class PreferenceService {
    private userContexts;
    startPreferenceFlow(whatsappId: string, isOnboarding?: boolean): Promise<void>;
    getUserContext(whatsappId: string): UserContext | null;
    updateUserContext(whatsappId: string, updates: Partial<UserContext>): void;
    clearUserContext(whatsappId: string): void;
    savePreferences(whatsappId: string): Promise<User | null>;
    isInPreferenceFlow(whatsappId: string): boolean;
    getNextStep(currentStep: PreferenceStep['step']): PreferenceStep['step'];
    getPreviousStep(currentStep: PreferenceStep['step']): PreferenceStep['step'];
}
export declare const preferenceService: PreferenceService;
//# sourceMappingURL=preference.d.ts.map