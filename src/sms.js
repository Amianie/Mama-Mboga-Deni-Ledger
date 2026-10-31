// Sends SMS through Africa's Talking. Without an API key, messages are logged
// and kept in an in-memory outbox (shown on the /simulator page).
const config = require('./config');

const outbox = [];

async function sendSms(to, message) {
  outbox.unshift({ to, message, at: new Date().toISOString() });
  outbox.length = Math.min(outbox.length, 50);

  if (!config.at.apiKey) {
    console.log(`[SMS -> ${to}] ${message}`);
    return;
  }
  const host = config.at.username === 'sandbox'
    ? 'https://api.sandbox.africastalking.com'
    : 'https://api.africastalking.com';
  const body = new URLSearchParams({ username: config.at.username, to, message });
  if (config.at.senderId) body.set('from', config.at.senderId);
  try {
    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey: config.at.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) console.error(`SMS to ${to} failed: HTTP ${res.status} ${await res.text()}`);
  } catch (err) {
    console.error(`SMS to ${to} failed:`, err.message);
  }
}

/** Fire-and-forget so USSD responses are never delayed by SMS delivery. */
function notify(to, message) {
  sendSms(to, message).catch(() => {});
}

module.exports = { notify, outbox };
