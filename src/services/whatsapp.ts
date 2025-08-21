
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
   * Send button message with 20-char limit validation
   */
  async sendButtonMessage(to: string, body: string, buttons: Array<{id: string, title: string}>, header?: string): Promise<boolean> {
    try {
      // Validate button titles (20 char max)
      const validatedButtons = buttons.map(btn => ({
        ...btn,
        title: btn.title.substring(0, 20) // Truncate to 20 chars
      }));

      const payload: ButtonMessage = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: validatedButtons.map(btn => ({
              type: 'reply',
              reply: {
                id: btn.id,
                title: btn.title,
              },
            })),
          },
        },
      };

      if (header && header.length <= 60) { // WhatsApp header limit
        payload.interactive.header = {
          type: 'text',
          text: header.substring(0, 60),
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
   * Send list message with validation
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
      // Validate all text limits
      const validatedSections = sections.map(section => ({
        title: section.title.substring(0, 24), // Section title limit
        rows: section.rows.map(row => ({
          id: row.id,
          title: row.title.substring(0, 24), // Row title limit
          description: row.description?.substring(0, 72), // Description limit
        })),
      }));

      const payload: ListMessage = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: body.substring(0, 1024) }, // Body limit
          action: {
            button: buttonText.substring(0, 20), // Button text limit
            sections: validatedSections,
          },
        },
      };

      if (header && header.length <= 60) {
        payload.interactive.header = {
          type: 'text',
          text: header.substring(0, 60),
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
   * Send text message
   */
  async sendTextMessage(to: string, message: string): Promise<boolean> {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to,
        text: { body: message.substring(0, 4096) }, // WhatsApp text limit
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
   * Mark message as read
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
}

export const whatsappService = new WhatsAppService();