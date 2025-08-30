// whatsapp-diagnostic.ts - Fixed Type-Safe WhatsApp Integration Tester
import https from 'https';
import { IncomingHttpHeaders } from 'http';
import { URL } from 'url';

// ==============================
// CONFIGURATION
// ==============================
const WHATSAPP_TOKEN = 'EAAJfWUoNU4EBPcKKnfPmLP0jTSZAlmnjbwOOcmZCUI0ZBTg76vFHpTfjd0XC30c0uZAdUsfUB3t5qW2mrLPrHVWcY6pDkdaFeqaJZAG6F5Jls5QWm8pZA5DUqe7ovIuFNCcHQyJ2xPOKI3yXI0DqeDFiChkfvemNLSCfozsb9p5WoTxuSCRM1hooIjqiSsz8PznzsXbIZBw3e3nhBvoIj5MRZAfqbZBlH7VhWLKR49ig21HXcVQZDZD';
const PHONE_NUMBER_ID = '635969472939258';
const VERIFY_TOKEN = 'sharaspot';
const WEBHOOK_URL = 'https://successful-adventure-production.up.railway.app/webhook';

console.log('🔍 Testing WhatsApp Integration with your credentials...');
console.log('=====================================================');

// ==============================
// TYPES
// ==============================
interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface HttpResponse {
  status: number;
  data: string;
  headers: IncomingHttpHeaders; // ✅ Fixed: uses correct type
}

// ==============================
// MAKE HTTPS REQUEST
// ==============================
async function makeRequest(url: string, options: RequestOptions = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode || 500,
          data,
          headers: res.headers // ✅ Now type-safe
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// ==============================
// RUN TESTS
// ==============================
async function runTests(): Promise<void> {
  console.log('🧪 Test 1: Check if your Railway app is accessible...');
  try {
    const response = await makeRequest('https://successful-adventure-production.up.railway.app/');
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ Server is accessible - Status: ${response.status}`);
    } else {
      console.log(`❌ Server returned error: ${response.status} - ${response.data}`);
    }
  } catch (error: any) {
    console.log(`❌ Cannot reach server: ${error.message}`);
    return;
  }

  console.log('\n🧪 Test 2: Test webhook verification...');
  try {
    const verifyUrl = `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=test123`;
    const response = await makeRequest(verifyUrl);
    
    if (response.status === 200 && response.data === 'test123') {
      console.log('✅ Webhook verification is working correctly');
    } else {
      console.log(`❌ Webhook verification failed - Status: ${response.status}, Response: ${response.data}`);
    }
  } catch (error: any) {
    console.log(`❌ Webhook verification error: ${error.message}`);
  }

  console.log('\n🧪 Test 3: Test WhatsApp API token...');
  try {
    const apiUrl = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}`;
    const response = await makeRequest(apiUrl, {
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`
      }
    });
    
    if (response.status === 200) {
      const data = JSON.parse(response.data);
      console.log('✅ WhatsApp API token is VALID');
      console.log(`📞 Phone Number: ${data.display_phone_number}`);
      console.log(`🔗 Phone Number ID: ${data.id}`);
    } else if (response.status === 401) {
      console.log('❌ WhatsApp API token is INVALID or EXPIRED');
    } else {
      console.log(`⚠️ Unexpected response: ${response.status} - ${response.data}`);
    }
  } catch (error: any) {
    console.log(`❌ WhatsApp API test failed: ${error.message}`);
  }

  console.log('\n🧪 Test 4: Test sending a message to webhook...');
  try {
    const testMessage = {
      entry: [{
        changes: [{
          field: 'messages',
          value: {
            messages: [{
              id: 'test_msg_123',
              from: '1234567890',
              type: 'text',
              text: { body: 'Test message from diagnostic' },
              timestamp: Math.floor(Date.now() / 1000).toString()
            }]
          }
        }]
      }]
    };

    const response = await makeRequest(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-Diagnostic/1.0'
      },
      body: JSON.stringify(testMessage)
    });

    if (response.status === 200) {
      console.log('✅ Webhook accepts POST messages correctly');
    } else {
      console.log(`❌ Webhook POST failed - Status: ${response.status} - ${response.data}`);
    }
  } catch (error: any) {
    console.log(`❌ Webhook POST test failed: ${error.message}`);
  }

  console.log('\n🧪 Test 5: Try sending a real WhatsApp message...');
  try {
    const messagePayload = {
      messaging_product: 'whatsapp',
      to: '16315551234', // Replace with your test number
      type: 'text',
      text: { body: 'Test message from diagnostic tool' }
    };

    const response = await makeRequest(`https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(messagePayload)
    });

    console.log(`📤 WhatsApp send test - Status: ${response.status}`);
    console.log(`📄 Response: ${response.data}`);
    
  } catch (error: any) {
    console.log(`⚠️ WhatsApp send test failed: ${error.message}`);
  }

  console.log('\n🎯 DIAGNOSIS & NEXT STEPS:');
  console.log('==========================');
  console.log('1. Check if ALL tests above passed ✅');
  console.log('2. If webhook verification failed ❌: Check VERIFY_TOKEN in Meta for Developers');
  console.log('3. If WhatsApp API failed ❌: Generate new token in Meta for Developers');
  console.log('4. If all pass but still single tick, check these in Meta for Developers:');
  console.log('   • App is in "Live" mode (not Development)');
  console.log('   • Webhook URL is exactly: ' + WEBHOOK_URL);
  console.log('   • "messages" field is subscribed');
  console.log('   • Your phone number is verified');
  console.log('   • If Development mode: your test number is added');
  console.log('');
  console.log('📞 WhatsApp Business Phone: +63 5969 472939 258');
  console.log('🔗 Webhook URL: ' + WEBHOOK_URL);
  console.log('🔑 Verify Token: ' + VERIFY_TOKEN);
}

// ==============================
// RUN
// ==============================
runTests().catch(err => {
  console.error('Test suite failed:', err);
});