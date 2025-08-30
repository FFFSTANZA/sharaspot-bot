// src/config/env.ts - RAILWAY-FRIENDLY VERSION
import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ===============================================
// RELAXED ENVIRONMENT SCHEMA FOR RAILWAY
// ===============================================

const envSchema = z.object({
  // Core Application Settings
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.string().optional().default('3000'),
  
  // WhatsApp Configuration - RELAXED VALIDATION
  WHATSAPP_TOKEN: z.string().optional().default(''),
  PHONE_NUMBER_ID: z.string().optional().default(''),
  VERIFY_TOKEN: z.string().optional().default('default_verify_token'),
  
  // Database Configuration - RELAXED VALIDATION
  DATABASE_URL: z.string().optional().default(''),
  
  // Logging Configuration
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  
  // Optional Settings with Safe Defaults
  ENABLE_QUEUE_SCHEDULER: z.string().optional().default('false'),
  RATE_LIMIT_MAX: z.string().optional().default('100'),
  RATE_LIMIT_WINDOW: z.string().optional().default('60000'),
  ALLOWED_ORIGINS: z.string().optional().default('*'),
  ENABLE_HELMET: z.string().optional().default('true'),
  REQUEST_SIZE_LIMIT: z.string().optional().default('10mb'),
  
  // Database Pool Settings
  DB_POOL_MIN: z.string().optional().default('2'),
  DB_POOL_MAX: z.string().optional().default('10'),
  DB_CONNECTION_TIMEOUT: z.string().optional().default('15000'),
  
  // Health Check Settings
  HEALTH_CHECK_TIMEOUT: z.string().optional().default('10000'),
  ENABLE_REQUEST_LOGGING: z.string().optional().default('true'),
  
  // Background Job Settings
  QUEUE_PROCESS_INTERVAL: z.string().optional().default('60000'),
  CLEANUP_INTERVAL: z.string().optional().default('300000'),
  
  // Performance Settings
  ENABLE_COMPRESSION: z.string().optional().default('true'),
  TRUST_PROXY: z.string().optional().default('true')
});

// ===============================================
// SAFE ENVIRONMENT PARSING
// ===============================================

let rawEnv: z.infer<typeof envSchema>;

try {
  rawEnv = envSchema.parse(process.env);
  console.log('✅ Environment variables loaded successfully');
} catch (error) {
  console.warn('⚠️ Some environment variables missing, using defaults');
  console.warn('This is OK for development and initial setup');
  
  // Use defaults for missing variables
  rawEnv = {
    NODE_ENV: (process.env.NODE_ENV as any) || 'production',
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

// ===============================================
// PROCESSED ENVIRONMENT OBJECT
// ===============================================

export const env = {
  // Core Settings
  NODE_ENV: rawEnv.NODE_ENV,
  PORT: parseInt(rawEnv.PORT || '3000', 10),
  
  // WhatsApp Configuration
  WHATSAPP_TOKEN: rawEnv.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: rawEnv.PHONE_NUMBER_ID,
  VERIFY_TOKEN: rawEnv.VERIFY_TOKEN,
  
  // Database
  DATABASE_URL: rawEnv.DATABASE_URL,
  
  // Logging
  LOG_LEVEL: rawEnv.LOG_LEVEL,
  
  // Features
  ENABLE_QUEUE_SCHEDULER: rawEnv.ENABLE_QUEUE_SCHEDULER !== 'false',
  ENABLE_HELMET: rawEnv.ENABLE_HELMET !== 'false',
  ENABLE_COMPRESSION: rawEnv.ENABLE_COMPRESSION !== 'false',
  ENABLE_REQUEST_LOGGING: rawEnv.ENABLE_REQUEST_LOGGING !== 'false',
  TRUST_PROXY: rawEnv.TRUST_PROXY === 'true' || rawEnv.TRUST_PROXY === '1',
  
  // Limits and Timeouts
  RATE_LIMIT_MAX: parseInt(rawEnv.RATE_LIMIT_MAX || '100', 10),
  RATE_LIMIT_WINDOW: parseInt(rawEnv.RATE_LIMIT_WINDOW || '60000', 10),
  REQUEST_SIZE_LIMIT: rawEnv.REQUEST_SIZE_LIMIT,
  HEALTH_CHECK_TIMEOUT: parseInt(rawEnv.HEALTH_CHECK_TIMEOUT || '10000', 10),
  
  // Database Pool
  DB_POOL_MIN: parseInt(rawEnv.DB_POOL_MIN || '2', 10),
  DB_POOL_MAX: parseInt(rawEnv.DB_POOL_MAX || '10', 10),
  DB_CONNECTION_TIMEOUT: parseInt(rawEnv.DB_CONNECTION_TIMEOUT || '15000', 10),
  
  // Background Jobs
  QUEUE_PROCESS_INTERVAL: parseInt(rawEnv.QUEUE_PROCESS_INTERVAL || '60000', 10),
  CLEANUP_INTERVAL: parseInt(rawEnv.CLEANUP_INTERVAL || '300000', 10),
  
  // CORS
  ALLOWED_ORIGINS: rawEnv.ALLOWED_ORIGINS === '*' ? [] : 
                   rawEnv.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
};

// ===============================================
// VALIDATION WARNINGS (NON-BLOCKING)
// ===============================================

export const validateEnvironment = () => {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  
  // Check for missing critical variables (warn but don't crash)
  if (!env.WHATSAPP_TOKEN) {
    warnings.push('WHATSAPP_TOKEN not set - WhatsApp integration will not work');
    recommendations.push('Set WHATSAPP_TOKEN for WhatsApp Business API');
  }
  
  if (!env.PHONE_NUMBER_ID) {
    warnings.push('PHONE_NUMBER_ID not set - WhatsApp integration will not work');
    recommendations.push('Set PHONE_NUMBER_ID for WhatsApp Business API');
  }
  
  if (!env.DATABASE_URL) {
    warnings.push('DATABASE_URL not set - Database features will not work');
    recommendations.push('Set DATABASE_URL for database connectivity');
  }
  
  if (env.VERIFY_TOKEN === 'default_verify_token') {
    warnings.push('Using default VERIFY_TOKEN - not secure for production');
    recommendations.push('Set a secure VERIFY_TOKEN for webhook verification');
  }
  
  // Production-specific warnings
  if (env.NODE_ENV === 'production') {
    if (env.ALLOWED_ORIGINS.length === 0) {
      warnings.push('CORS is set to allow all origins in production');
      recommendations.push('Set ALLOWED_ORIGINS to restrict CORS for security');
    }
    
    if (env.LOG_LEVEL === 'debug') {
      recommendations.push('Consider using LOG_LEVEL=info in production');
    }
  }
  
  return { warnings, recommendations };
};

// ===============================================
// CONFIGURATION HELPERS
// ===============================================

export const getDatabaseConfig = () => ({
  url: env.DATABASE_URL,
  pool: {
    min: env.DB_POOL_MIN,
    max: env.DB_POOL_MAX
  },
  connectionTimeout: env.DB_CONNECTION_TIMEOUT
});

export const getWhatsAppConfig = () => ({
  token: env.WHATSAPP_TOKEN,
  phoneNumberId: env.PHONE_NUMBER_ID,
  verifyToken: env.VERIFY_TOKEN
});

export const getSecurityConfig = () => ({
  helmet: env.ENABLE_HELMET,
  cors: {
    origins: env.ALLOWED_ORIGINS.length ? env.ALLOWED_ORIGINS : '*',
    credentials: true
  },
  rateLimit: {
    max: env.RATE_LIMIT_MAX,
    window: env.RATE_LIMIT_WINDOW
  },
  requestSizeLimit: env.REQUEST_SIZE_LIMIT,
  trustProxy: env.TRUST_PROXY
});

// ===============================================
// STARTUP VALIDATION (NON-BLOCKING)
// ===============================================

if (process.env.NODE_ENV !== 'test') {
  const validation = validateEnvironment();
  
  if (validation.warnings.length > 0) {
    console.warn('⚠️ Environment Warnings:');
    validation.warnings.forEach(warning => console.warn(`  ⚠️ ${warning}`));
  }
  
  if (validation.recommendations.length > 0) {
    console.info('💡 Recommendations:');
    validation.recommendations.forEach(rec => console.info(`  💡 ${rec}`));
  }
  
  console.info(`✅ Server starting in ${env.NODE_ENV} mode on port ${env.PORT}`);
}

// ===============================================
// EXPORT DEFAULT
// ===============================================

export default env;