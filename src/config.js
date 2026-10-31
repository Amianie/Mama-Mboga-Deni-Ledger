const crypto = require('crypto');
const path = require('path');

const port = Number(process.env.PORT) || 3000;

module.exports = {
  port,
  // The USSD code customers and mama mbogas dial (set to the one assigned by Africa's Talking).
  ussdCode: process.env.USSD_CODE || '*384*1234#',
  // Public URL of the dashboard, included in SMS messages.
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
  dbFile: process.env.DB_FILE || path.join(__dirname, '..', 'data', 'deni.sqlite'),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  production: process.env.NODE_ENV === 'production',
  at: {
    username: process.env.AT_USERNAME || 'sandbox',
    apiKey: process.env.AT_API_KEY || '',
    senderId: process.env.AT_SENDER_ID || '',
  },
};
