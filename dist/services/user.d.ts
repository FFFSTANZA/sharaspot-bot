import { type User, type NewUser } from '../db/schema';
export declare class UserService {
    getUserByWhatsAppId(whatsappId: string): Promise<User | null>;
    createUser(userData: NewUser): Promise<User | null>;
    updateUserPreferences(whatsappId: string, preferences: {
        evModel?: string;
        connectorType?: string;
        chargingIntent?: string;
        queuePreference?: string;
    }): Promise<User | null>;
    updateUserProfile(whatsappId: string, profileData: {
        name?: string;
        phoneNumber?: string;
    }): Promise<User | null>;
    hasCompletedPreferences(whatsappId: string): Promise<boolean>;
    updateUserBanStatus(whatsappId: string, isBanned: boolean, adminWhatsappId: string): Promise<boolean>;
    isUserBanned(whatsappId: string): Promise<boolean>;
    private logUserAction;
}
export declare const userService: UserService;
//# sourceMappingURL=user.d.ts.map