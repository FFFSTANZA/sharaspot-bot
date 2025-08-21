"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const env_1 = require("./config/env");
const logger_1 = require("./utils/logger");
const webhook_1 = require("./controllers/webhook");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: env_1.env.NODE_ENV === 'production' ? false : '*',
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
    logger_1.logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
    });
    next();
});
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: env_1.env.NODE_ENV,
        service: 'sharaspot-bot',
    });
});
app.get('/webhook', webhook_1.webhookController.verifyWebhook.bind(webhook_1.webhookController));
app.post('/webhook', webhook_1.webhookController.handleWebhook.bind(webhook_1.webhookController));
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'The requested endpoint does not exist',
        path: req.originalUrl,
    });
});
app.use((err, req, res, next) => {
    logger_1.logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
    });
    res.status(500).json({
        error: 'Internal Server Error',
        message: env_1.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    });
});
const PORT = env_1.env.PORT || 3000;
app.listen(PORT, () => {
    logger_1.logger.info(`🚀 SharaSpot Bot server started on port ${PORT}`);
    logger_1.logger.info(`📝 Environment: ${env_1.env.NODE_ENV}`);
    logger_1.logger.info(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
    logger_1.logger.info(`❤️ Health check: http://localhost:${PORT}/health`);
});
process.on('SIGTERM', () => {
    logger_1.logger.info('SIGTERM received, shutting down gracefully...');
    process.exit(0);
});
process.on('SIGINT', () => {
    logger_1.logger.info('SIGINT received, shutting down gracefully...');
    process.exit(0);
});
//# sourceMappingURL=index.js.map