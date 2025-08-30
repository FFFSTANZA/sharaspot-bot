"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSecurityConfig = exports.getWhatsAppConfig = exports.getDatabaseConfig = exports.validateEnvironment = exports.env = void 0;
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('production'),
    PORT: zod_1.z.string().optional().default('3000'),
    WHATSAPP_TOKEN: zod_1.z.string().optional().default(''),
    PHONE_NUMBER_ID: zod_1.z.string().optional().default(''),
    VERIFY_TOKEN: zod_1.z.string().optional().default('default_verify_token'),
    DATABASE_URL: zod_1.z.string().optional().default(''),
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    ENABLE_QUEUE_SCHEDULER: zod_1.z.string().optional().default('false'),
    RATE_LIMIT_MAX: zod_1.z.string().optional().default('100'),
    RATE_LIMIT_WINDOW: zod_1.z.string().optional().default('60000'),
    ALLOWED_ORIGINS: zod_1.z.string().optional().default('*'),
    ENABLE_HELMET: zod_1.z.string().optional().default('true'),
    REQUEST_SIZE_LIMIT: zod_1.z.string().optional().default('10mb'),
    DB_POOL_MIN: zod_1.z.string().optional().default('2'),
    DB_POOL_MAX: zod_1.z.string().optional().default('10'),
    DB_CONNECTION_TIMEOUT: zod_1.z.string().optional().default('15000'),
    HEALTH_CHECK_TIMEOUT: zod_1.z.string().optional().default('10000'),
    ENABLE_REQUEST_LOGGING: zod_1.z.string().optional().default('true'),
    QUEUE_PROCESS_INTERVAL: zod_1.z.string().optional().default('60000'),
    CLEANUP_INTERVAL: zod_1.z.string().optional().default('300000'),
    ENABLE_COMPRESSION: zod_1.z.string().optional().default('true'),
    TRUST_PROXY: zod_1.z.string().optional().default('true')
});
let rawEnv;
try {
    rawEnv = envSchema.parse(process.env);
    console.log('✅ Environment variables loaded successfully');
}
catch (error) {
    console.warn('⚠️ Some environment variables missing, using defaults');
    console.warn('This is OK for development and initial setup');
    rawEnv = {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || '3000',
        WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN || '',
        PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID || '',
        VERIFY_TOKEN: process.env.VERIFY_TOKEN || 'default_verify_token',
        DATABASE_URL: process.env.DATABASE_URL || '',
        LOG_LEVEL: 'info',
        ENABLE_QUEUE_SCHEDULER: 'false',
        RATE_LIMIT_MAX: '100',
        RATE_LIMIT_WINDOW: '60000',
        ALLOWED_ORIGINS: '*',
        ENABLE_HELMET: 'true',
        REQUEST_SIZE_LIMIT: '10mb',
        DB_POOL_MIN: '2',
        DB_POOL_MAX: '10',
        DB_CONNECTION_TIMEOUT: '15000',
        HEALTH_CHECK_TIMEOUT: '10000',
        ENABLE_REQUEST_LOGGING: 'true',
        QUEUE_PROCESS_INTERVAL: '60000',
        CLEANUP_INTERVAL: '300000',
        ENABLE_COMPRESSION: 'true',
        TRUST_PROXY: 'true'
    };
}
exports.env = {
    NODE_ENV: rawEnv.NODE_ENV,
    PORT: parseInt(rawEnv.PORT || '3000', 10),
    WHATSAPP_TOKEN: rawEnv.WHATSAPP_TOKEN,
    PHONE_NUMBER_ID: rawEnv.PHONE_NUMBER_ID,
    VERIFY_TOKEN: rawEnv.VERIFY_TOKEN,
    DATABASE_URL: rawEnv.DATABASE_URL,
    LOG_LEVEL: rawEnv.LOG_LEVEL,
    ENABLE_QUEUE_SCHEDULER: rawEnv.ENABLE_QUEUE_SCHEDULER !== 'false',
    ENABLE_HELMET: rawEnv.ENABLE_HELMET !== 'false',
    ENABLE_COMPRESSION: rawEnv.ENABLE_COMPRESSION !== 'false',
    ENABLE_REQUEST_LOGGING: rawEnv.ENABLE_REQUEST_LOGGING !== 'false',
    TRUST_PROXY: rawEnv.TRUST_PROXY === 'true' || rawEnv.TRUST_PROXY === '1',
    RATE_LIMIT_MAX: parseInt(rawEnv.RATE_LIMIT_MAX || '100', 10),
    RATE_LIMIT_WINDOW: parseInt(rawEnv.RATE_LIMIT_WINDOW || '60000', 10),
    REQUEST_SIZE_LIMIT: rawEnv.REQUEST_SIZE_LIMIT,
    HEALTH_CHECK_TIMEOUT: parseInt(rawEnv.HEALTH_CHECK_TIMEOUT || '10000', 10),
    DB_POOL_MIN: parseInt(rawEnv.DB_POOL_MIN || '2', 10),
    DB_POOL_MAX: parseInt(rawEnv.DB_POOL_MAX || '10', 10),
    DB_CONNECTION_TIMEOUT: parseInt(rawEnv.DB_CONNECTION_TIMEOUT || '15000', 10),
    QUEUE_PROCESS_INTERVAL: parseInt(rawEnv.QUEUE_PROCESS_INTERVAL || '60000', 10),
    CLEANUP_INTERVAL: parseInt(rawEnv.CLEANUP_INTERVAL || '300000', 10),
    ALLOWED_ORIGINS: rawEnv.ALLOWED_ORIGINS === '*' ? [] :
        rawEnv.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
};
const validateEnvironment = () => {
    const warnings = [];
    const recommendations = [];
    if (!exports.env.WHATSAPP_TOKEN) {
        warnings.push('WHATSAPP_TOKEN not set - WhatsApp integration will not work');
        recommendations.push('Set WHATSAPP_TOKEN for WhatsApp Business API');
    }
    if (!exports.env.PHONE_NUMBER_ID) {
        warnings.push('PHONE_NUMBER_ID not set - WhatsApp integration will not work');
        recommendations.push('Set PHONE_NUMBER_ID for WhatsApp Business API');
    }
    if (!exports.env.DATABASE_URL) {
        warnings.push('DATABASE_URL not set - Database features will not work');
        recommendations.push('Set DATABASE_URL for database connectivity');
    }
    if (exports.env.VERIFY_TOKEN === 'default_verify_token') {
        warnings.push('Using default VERIFY_TOKEN - not secure for production');
        recommendations.push('Set a secure VERIFY_TOKEN for webhook verification');
    }
    if (exports.env.NODE_ENV === 'production') {
        if (exports.env.ALLOWED_ORIGINS.length === 0) {
            warnings.push('CORS is set to allow all origins in production');
            recommendations.push('Set ALLOWED_ORIGINS to restrict CORS for security');
        }
        if (exports.env.LOG_LEVEL === 'debug') {
            recommendations.push('Consider using LOG_LEVEL=info in production');
        }
    }
    return { warnings, recommendations };
};
exports.validateEnvironment = validateEnvironment;
const getDatabaseConfig = () => ({
    url: exports.env.DATABASE_URL,
    pool: {
        min: exports.env.DB_POOL_MIN,
        max: exports.env.DB_POOL_MAX
    },
    connectionTimeout: exports.env.DB_CONNECTION_TIMEOUT
});
exports.getDatabaseConfig = getDatabaseConfig;
const getWhatsAppConfig = () => ({
    token: exports.env.WHATSAPP_TOKEN,
    phoneNumberId: exports.env.PHONE_NUMBER_ID,
    verifyToken: exports.env.VERIFY_TOKEN
});
exports.getWhatsAppConfig = getWhatsAppConfig;
const getSecurityConfig = () => ({
    helmet: exports.env.ENABLE_HELMET,
    cors: {
        origins: exports.env.ALLOWED_ORIGINS.length ? exports.env.ALLOWED_ORIGINS : '*',
        credentials: true
    },
    rateLimit: {
        max: exports.env.RATE_LIMIT_MAX,
        window: exports.env.RATE_LIMIT_WINDOW
    },
    requestSizeLimit: exports.env.REQUEST_SIZE_LIMIT,
    trustProxy: exports.env.TRUST_PROXY
});
exports.getSecurityConfig = getSecurityConfig;
if (process.env.NODE_ENV !== 'test') {
    const validation = (0, exports.validateEnvironment)();
    if (validation.warnings.length > 0) {
        console.warn('⚠️ Environment Warnings:');
        validation.warnings.forEach(warning => console.warn(`  ⚠️ ${warning}`));
    }
    if (validation.recommendations.length > 0) {
        console.info('💡 Recommendations:');
        validation.recommendations.forEach(rec => console.info(`  💡 ${rec}`));
    }
    console.info(`✅ Server starting in ${exports.env.NODE_ENV} mode on port ${exports.env.PORT}`);
}
exports.default = exports.env;
//# sourceMappingURL=env.js.map