import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  
  // WhatsApp Configuration
  WHATSAPP_TOKEN: z.string().min(1, 'WhatsApp token is required'),
  PHONE_NUMBER_ID: z.string().min(1, 'Phone number ID is required'),
  VERIFY_TOKEN: z.string().min(1, 'Verify token is required'),
  
  // Database
  DATABASE_URL: z.string().url('Valid database URL is required'),
  
  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export const env = envSchema.parse(process.env);
