"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const app = (0, express_1.default)();
exports.app = app;
const PORT = parseInt(process.env.PORT || '3000', 10);
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'sharaspot_verify_token';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
console.log('🚀 SharaSpot Bot Starting...');
console.log('🔑 WhatsApp Token:', WHATSAPP_TOKEN ? '✅ Present' : '❌ Missing');
console.log('📞 Phone Number ID:', PHONE_NUMBER_ID ? '✅ Present' : '❌ Missing');
console.log('🔐 Verify Token:', VERIFY_TOKEN);
console.log('🌐 Port:', PORT);
app.use(express_1.default.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use((req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    console.log(`📥 ${req.method} ${req.path} | IP: ${ip}`);
    next();
});
app.get('/', (req, res) => {
    res.json({
        status: 'alive',
        message: 'SharaSpot WhatsApp Bot is running!',
        endpoints: {
            webhook: 'POST /webhook',
            verify: 'GET /webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=123'
        },
        env: {
            hasToken: !!WHATSAPP_TOKEN,
            hasPhoneId: !!PHONE_NUMBER_ID
        }
    });
});
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('✅ Webhook verified!');
        return res.send(challenge);
    }
    console.log('❌ Verification failed', { mode, token });
    return res.status(403).send('Forbidden');
});
app.post('/webhook', async (req, res) => {
    try {
        const body = req.body;
        console.log('📬 Webhook received:', JSON.stringify(body, null, 2));
        if (body.entry?.length > 0) {
            for (const entry of body.entry) {
                for (const change of entry.changes || []) {
                    if (change.field === 'messages' && change.value?.messages) {
                        for (const msg of change.value.messages) {
                            const from = msg.from;
                            const text = msg.text?.body || '(no text)';
                            const type = msg.type;
                            console.log(`💬 Message from ${from}: [${type}] ${text}`);
                            if (WHATSAPP_TOKEN && PHONE_NUMBER_ID) {
                                await sendReply(from, `🤖 Got your message: "${text}"`);
                            }
                        }
                    }
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    }
    catch (error) {
        console.error('💥 Webhook processing error:', error);
        res.status(200).send('ERROR_HANDLED');
    }
});
async function sendReply(to, text) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (response.ok && 'messages' in data) {
            console.log('📤 Reply sent! Message ID:', data.messages[0].id);
            return true;
        }
        else {
            const errorMsg = data.error.message;
            console.error('❌ WhatsApp API Error:', errorMsg);
            return false;
        }
    }
    catch (err) {
        console.error('📡 Network error sending reply:', err.message);
        return false;
    }
}
app.use('*', (req, res) => {
    console.log(`🚫 404: ${req.method} ${req.path}`);
    res.status(404).json({ error: 'Not Found' });
});
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('✅✅✅ SERVER IS LIVE AND READY! ✅✅✅');
    console.log(`🔗 Webhook URL: https://your-app.up.railway.app/webhook`);
    console.log(`🔐 Verify Token: ${VERIFY_TOKEN}`);
    console.log(`📱 Send a message to your WhatsApp Business number to test!`);
    console.log('');
});
//# sourceMappingURL=index.js.map