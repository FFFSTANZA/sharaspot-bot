"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userService = exports.UserService = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const database_1 = require("../config/database");
const schema_1 = require("../db/schema");
const logger_1 = require("../utils/logger");
const validation_1 = require("../utils/validation");
class UserService {
    async getUserByWhatsAppId(whatsappId) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(whatsappId)) {
                logger_1.logger.warn('Invalid WhatsApp ID format', { whatsappId });
                return null;
            }
            const [user] = await database_1.db
                .select()
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .limit(1);
            return user || null;
        }
        catch (error) {
            logger_1.logger.error('Failed to get user by WhatsApp ID', { whatsappId, error });
            return null;
        }
    }
    async createUser(userData) {
        try {
            if (!(0, validation_1.validateWhatsAppId)(userData.whatsappId)) {
                logger_1.logger.warn('Invalid WhatsApp ID format during user creation', { whatsappId: userData.whatsappId });
                return null;
            }
            const [newUser] = await database_1.db
                .insert(schema_1.users)
                .values({
                ...userData,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
                .returning();
            await this.logUserAction(userData.whatsappId, 'user_created', null, newUser);
            logger_1.logger.info('✅ User created successfully', {
                whatsappId: newUser.whatsappId,
                userId: newUser.id
            });
            return newUser;
        }
        catch (error) {
            logger_1.logger.error('Failed to create user', { userData, error });
            return null;
        }
    }
    async updateUserPreferences(whatsappId, preferences) {
        try {
            const validationResult = validation_1.userPreferencesSchema.safeParse(preferences);
            if (!validationResult.success) {
                logger_1.logger.warn('Invalid user preferences', { whatsappId, preferences, errors: validationResult.error });
                return null;
            }
            const currentUser = await this.getUserByWhatsAppId(whatsappId);
            if (!currentUser) {
                logger_1.logger.warn('User not found for preferences update', { whatsappId });
                return null;
            }
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set({
                ...preferences,
                preferencesCaptured: true,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            await this.logUserAction(whatsappId, 'preferences_updated', currentUser, updatedUser);
            logger_1.logger.info('✅ User preferences updated', {
                whatsappId,
                preferences,
                userId: updatedUser.id
            });
            return updatedUser;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user preferences', { whatsappId, preferences, error });
            return null;
        }
    }
    async updateUserProfile(whatsappId, profileData) {
        try {
            const currentUser = await this.getUserByWhatsAppId(whatsappId);
            if (!currentUser) {
                logger_1.logger.warn('User not found for profile update', { whatsappId });
                return null;
            }
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set({
                ...profileData,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            await this.logUserAction(whatsappId, 'profile_updated', currentUser, updatedUser);
            logger_1.logger.info('✅ User profile updated', {
                whatsappId,
                profileData,
                userId: updatedUser.id
            });
            return updatedUser;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user profile', { whatsappId, profileData, error });
            return null;
        }
    }
    async hasCompletedPreferences(whatsappId) {
        try {
            const user = await this.getUserByWhatsAppId(whatsappId);
            return user?.preferencesCaptured || false;
        }
        catch (error) {
            logger_1.logger.error('Failed to check user preferences completion', { whatsappId, error });
            return false;
        }
    }
    async updateUserBanStatus(whatsappId, isBanned, adminWhatsappId) {
        try {
            const currentUser = await this.getUserByWhatsAppId(whatsappId);
            if (!currentUser) {
                logger_1.logger.warn('User not found for ban status update', { whatsappId });
                return false;
            }
            const [updatedUser] = await database_1.db
                .update(schema_1.users)
                .set({
                isBanned,
                updatedAt: new Date(),
            })
                .where((0, drizzle_orm_1.eq)(schema_1.users.whatsappId, whatsappId))
                .returning();
            await database_1.db.insert(schema_1.auditLogs).values({
                actorWhatsappId: adminWhatsappId,
                actorType: 'admin',
                action: isBanned ? 'user_banned' : 'user_unbanned',
                resourceType: 'user',
                resourceId: whatsappId,
                oldValues: { isBanned: currentUser.isBanned },
                newValues: { isBanned },
                createdAt: new Date(),
            });
            logger_1.logger.info(`✅ User ${isBanned ? 'banned' : 'unbanned'}`, {
                whatsappId,
                adminWhatsappId,
                userId: updatedUser.id
            });
            return true;
        }
        catch (error) {
            logger_1.logger.error('Failed to update user ban status', { whatsappId, isBanned, adminWhatsappId, error });
            return false;
        }
    }
    async isUserBanned(whatsappId) {
        try {
            const user = await this.getUserByWhatsAppId(whatsappId);
            return user?.isBanned || false;
        }
        catch (error) {
            logger_1.logger.error('Failed to check user ban status', { whatsappId, error });
            return false;
        }
    }
    async logUserAction(whatsappId, action, oldValues, newValues) {
        try {
            await database_1.db.insert(schema_1.auditLogs).values({
                actorWhatsappId: whatsappId,
                actorType: 'user',
                action,
                resourceType: 'user',
                resourceId: whatsappId,
                oldValues,
                newValues,
                createdAt: new Date(),
            });
        }
        catch (error) {
            logger_1.logger.error('Failed to log user action', { whatsappId, action, error });
        }
    }
}
exports.UserService = UserService;
exports.userService = new UserService();
//# sourceMappingURL=user.js.map