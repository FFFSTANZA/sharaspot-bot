"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const zod_1 = require("zod");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'production', 'test']).default('development'),
    PORT: zod_1.z.string().transform(Number).default('3000'),
    WHATSAPP_TOKEN: zod_1.z.string().min(1, 'WhatsApp token is required'),
    PHONE_NUMBER_ID: zod_1.z.string().min(1, 'Phone number ID is required'),
    VERIFY_TOKEN: zod_1.z.string().min(1, 'Verify token is required'),
    DATABASE_URL: zod_1.z.string().url('Valid database URL is required'),
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});
exports.env = envSchema.parse(process.env);
//# sourceMappingURL=env.js.map