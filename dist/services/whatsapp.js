"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappService = void 0;
const axios_1 = __importDefault(require("axios"));
const env_1 = require("../config/env");
const logger_1 = require("../utils/logger");
class WhatsAppService {
    constructor() {
        this.baseUrl = `https://graph.facebook.com/v18.0/${env_1.env.PHONE_NUMBER_ID}/messages`;
        this.headers = {
            'Authorization': `Bearer ${env_1.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
        };
    }
    async sendTextMessage(to, message) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                text: { body: message },
            };
            const response = await axios_1.default.post(this.baseUrl, payload, {
                headers: this.headers,
            });
            logger_1.logger.info('✅ Text message sent', { to, messageId: response.data.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send text message', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendButtonMessage(to, body, buttons, header) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: body },
                    action: {
                        buttons: buttons.map(btn => ({
                            type: 'reply',
                            reply: {
                                id: btn.id,
                                title: btn.title,
                            },
                        })),
                    },
                },
            };
            if (header) {
                payload.interactive.header = {
                    type: 'text',
                    text: header,
                };
            }
            const response = await axios_1.default.post(this.baseUrl, payload, {
                headers: this.headers,
            });
            logger_1.logger.info('✅ Button message sent', { to, messageId: response.data.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send button message', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendListMessage(to, body, buttonText, sections, header) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'interactive',
                interactive: {
                    type: 'list',
                    body: { text: body },
                    action: {
                        button: buttonText,
                        sections,
                    },
                },
            };
            if (header) {
                payload.interactive.header = {
                    type: 'text',
                    text: header,
                };
            }
            const response = await axios_1.default.post(this.baseUrl, payload, {
                headers: this.headers,
            });
            logger_1.logger.info('✅ List message sent', { to, messageId: response.data.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send list message', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async markAsRead(messageId) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                status: 'read',
                message_id: messageId,
            };
            await axios_1.default.post(this.baseUrl, payload, {
                headers: this.headers,
            });
            logger_1.logger.debug('✅ Message marked as read', { messageId });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to mark message as read', {
                messageId,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendLocationMessage(to, latitude, longitude, name, address) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'location',
                location: {
                    latitude,
                    longitude,
                    name,
                    address,
                },
            };
            const response = await axios_1.default.post(this.baseUrl, payload, {
                headers: this.headers,
            });
            logger_1.logger.info('✅ Location message sent', { to, messageId: response.data.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send location message', {
                to,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
    async sendTemplateMessage(to, templateName, parameters = []) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to,
                type: 'template',
                template: {
                    name: templateName,
                    language: {
                        code: 'en',
                    },
                    components: parameters.length > 0 ? [
                        {
                            type: 'body',
                            parameters: parameters.map(param => ({
                                type: 'text',
                                text: param,
                            })),
                        },
                    ] : [],
                },
            };
            const response = await axios_1.default.post(this.baseUrl, payload, {
                headers: this.headers,
            });
            logger_1.logger.info('✅ Template message sent', { to, templateName, messageId: response.data.messages[0].id });
            return true;
        }
        catch (error) {
            logger_1.logger.error('❌ Failed to send template message', {
                to,
                templateName,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
}
exports.whatsappService = new WhatsAppService();
//# sourceMappingURL=whatsapp.js.map