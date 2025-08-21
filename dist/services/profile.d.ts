export declare class ProfileService {
    updateUserProfileFromWhatsApp(whatsappId: string, messageContext?: any): Promise<void>;
    private fetchWhatsAppProfile;
    requestUserName(whatsappId: string): Promise<void>;
    updateUserName(whatsappId: string, name: string): Promise<boolean>;
    showProfileSummary(whatsappId: string): Promise<void>;
    handleProfileUpdate(whatsappId: string, updateType: string): Promise<void>;
}
export declare const profileService: ProfileService;
//# sourceMappingURL=profile.d.ts.map