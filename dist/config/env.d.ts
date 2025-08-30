export declare const env: {
    NODE_ENV: "development" | "production" | "test";
    PORT: number;
    WHATSAPP_TOKEN: string;
    PHONE_NUMBER_ID: string;
    VERIFY_TOKEN: string;
    DATABASE_URL: string;
    LOG_LEVEL: "error" | "warn" | "info" | "debug";
    ENABLE_QUEUE_SCHEDULER: boolean;
    ENABLE_HELMET: boolean;
    ENABLE_COMPRESSION: boolean;
    ENABLE_REQUEST_LOGGING: boolean;
    TRUST_PROXY: boolean;
    RATE_LIMIT_MAX: number;
    RATE_LIMIT_WINDOW: number;
    REQUEST_SIZE_LIMIT: string;
    HEALTH_CHECK_TIMEOUT: number;
    DB_POOL_MIN: number;
    DB_POOL_MAX: number;
    DB_CONNECTION_TIMEOUT: number;
    QUEUE_PROCESS_INTERVAL: number;
    CLEANUP_INTERVAL: number;
    ALLOWED_ORIGINS: string[];
};
export declare const validateEnvironment: () => {
    warnings: string[];
    recommendations: string[];
};
export declare const getDatabaseConfig: () => {
    url: string;
    pool: {
        min: number;
        max: number;
    };
    connectionTimeout: number;
};
export declare const getWhatsAppConfig: () => {
    token: string;
    phoneNumberId: string;
    verifyToken: string;
};
export declare const getSecurityConfig: () => {
    helmet: boolean;
    cors: {
        origins: string | string[];
        credentials: boolean;
    };
    rateLimit: {
        max: number;
        window: number;
    };
    requestSizeLimit: string;
    trustProxy: boolean;
};
export default env;
//# sourceMappingURL=env.d.ts.map