import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ButtonMessage, ListMessage, LocationMessage } from '../types/whatsapp';

class WhatsAppService {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor() {
    this.baseUrl = `https://graph.facebook.com/v18.0/${env.PHONE_NUMBER_ID}/messages`;
    this.headers = {
      'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send a simple text message
   */
  async sendTextMessage(to: string, message: string): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        text: { body: message },
      };

      const response = await axios.post(this.baseUrl, payload, {
        headers: this.headers,
      });

      logger.info('✅ Text message sent', { to, messageId: response.data.messages[0].id });
      return true;
    } catch (error: any) {
      logger.error('❌ Failed to send text message', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send a button message
   */
  async sendButtonMessage(to: string, body: string, buttons: Array<{id: string, title: string}>, header?: string): Promise<boolean> {
    try {
      const payload: ButtonMessage = {
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

      const response = await axios.post(this.baseUrl, payload, {
        headers: this.headers,
      });

      logger.info('✅ Button message sent', { to, messageId: response.data.messages[0].id });
      return true;
    } catch (error: any) {
      logger.error('❌ Failed to send button message', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send a list message
   */
  async sendListMessage(
    to: string, 
    body: string, 
    buttonText: string,
    sections: Array<{
      title: string;
      rows: Array<{id: string, title: string, description?: string}>;
    }>,
    header?: string
  ): Promise<boolean> {
    try {
      const payload: ListMessage = {
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

      const response = await axios.post(this.baseUrl, payload, {
        headers: this.headers,
      });

      logger.info('✅ List message sent', { to, messageId: response.data.messages[0].id });
      return true;
    } catch (error: any) {
      logger.error('❌ Failed to send list message', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send typing indicator (mark as read)
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };

      await axios.post(this.baseUrl, payload, {
        headers: this.headers,
      });

      logger.debug('✅ Message marked as read', { messageId });
      return true;
    } catch (error: any) {
      logger.error('❌ Failed to mark message as read', {
        messageId,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send location message
   */
  async sendLocationMessage(
    to: string,
    latitude: number,
    longitude: number,
    name: string,
    address: string
  ): Promise<boolean> {
    try {
      const payload: LocationMessage = {
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

      const response = await axios.post(this.baseUrl, payload, {
        headers: this.headers,
      });

      logger.info('✅ Location message sent', { to, messageId: response.data.messages[0].id });
      return true;
    } catch (error: any) {
      logger.error('❌ Failed to send location message', {
        to,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }

  /**
   * Send template message (for notifications)
   */
  async sendTemplateMessage(to: string, templateName: string, parameters: string[] = []): Promise<boolean> {
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

      const response = await axios.post(this.baseUrl, payload, {
        headers: this.headers,
      });

      logger.info('✅ Template message sent', { to, templateName, messageId: response.data.messages[0].id });
      return true;
    } catch (error: any) {
      logger.error('❌ Failed to send template message', {
        to,
        templateName,
        error: error.response?.data || error.message,
      });
      return false;
    }
  }
}

export const whatsappService = new WhatsAppService();