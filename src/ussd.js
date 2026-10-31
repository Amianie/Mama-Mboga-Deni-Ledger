// USSD menu, Africa's Talking format.
// AT POSTs { sessionId, serviceCode, phoneNumber, text } on every step, where `text`
// is everything the user has typed this session joined by '*' (e.g. "1*Kawangware*2").
// We reply with plain text starting with "CON " (keep session open) or "END " (close it).
const ledger = require('./ledger');
const config = require('./config');
const { normalizePhone, localPhone } = require('./phone');

const con = (msg) => `CON ${msg}`;
const end = (msg) => `END ${msg}`;
const NAV = '\n0. Back  00. Home';

/** Apply navigation: "0" removes the previous input, "00" returns to the main menu. */
function parseInputs(text) {
  const out = [];
  for (const raw of String(text || '').split('*')) {
    const v = raw.trim();
    if (v === '') continue;
    if (v === '00') out.length = 0;
    else if (v === '0') out.pop();
    else out.push(v);
  }
  return out;
}

function mainMenu() {
  return con(
    'Karibu Mama Mboga Deni Ledger\n' +
      '1. Record a deni (Customer)\n' +
      '2. Register as Mama Mboga\n' +
      '3. Mama Mboga account'
  );
}

function handleUssd(phoneNumber, text) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return end('Sorry, we could not read your phone number.');
  const inputs = parseInputs(text);
  if (inputs.length === 0) return mainMenu();

  const [choice, ...rest] = inputs;
  try {
    switch (choice) {
      case '1': return customerFlow(phone, rest);
      case '2': return registerFlow(phone, rest);
      case '3': return vendorFlow(phone, rest);
      default: return end('Invalid choice. Please dial again.');
    }
  } catch (err) {
    if (err instanceof ledger.LedgerError) return end(err.message);
    throw err;
  }
}

// ---------------- 1. Customer records a deni ----------------
function customerFlow(phone, rest) {
  // Step 1: location
  if (rest.length === 0) return con('Enter your location\n(e.g. Kawangware):' + NAV);
  const location = rest[0];
  const vendors = ledger.searchVendors(location);
  if (vendors.length === 0) {
    return con(`No Mama Mboga found in "${location.slice(0, 20)}".\n0. Try another location\n00. Home`);
  }

  // Step 2: pick a mama mboga
  if (rest.length === 1) {
    const list = vendors.map((v, i) => `${i + 1}. ${v.name.slice(0, 18)} - ${v.location.slice(0, 14)}`).join('\n');
    return con(`Select Mama Mboga:\n${list}` + NAV);
  }
  const vendor = vendors[Number(rest[1]) - 1];
  if (!vendor) return end('Invalid selection. Please dial again.');
  if (vendor.phone === phone) return end('You cannot record a deni with yourself.');

  // Step 2b: first-time customers give their name (so the mama mboga knows who they are)
  let i = 2;
  let newName = null;
  if (!ledger.getCustomer(phone)) {
    if (rest.length === 2) return con('Enter your name:' + NAV);
    newName = rest[2].slice(0, 40);
    i = 3;
  }

  // Step 3: amount
  if (rest.length === i) return con(`Enter deni amount (KES)\nfor ${vendor.name}:` + NAV);
  const amount = ledger.parseAmount(rest[i]);
  if (!amount) return end('Invalid amount. Please dial again and enter whole shillings, e.g. 250.');

  // Step 4: what was taken
  if (rest.length === i + 1) return con('What did you take?\n(e.g. sukuma, nyanya)' + NAV);
  const description = rest[i + 1].slice(0, 60);

  // Step 5: confirm
  if (rest.length === i + 2) {
    return con(
      `Confirm deni:\n${vendor.name}\nKES ${amount} - ${description}\n1. Confirm\n2. Cancel`
    );
  }
  if (rest[i + 2] !== '1') return end('Cancelled. No deni was recorded.');

  if (newName) ledger.saveCustomer(phone, newName);
  const debt = ledger.requestDebt({ vendorId: vendor.id, customerPhone: phone, amount, description });
  return end(
    `Request #${debt.id} sent. ${vendor.name} will approve your deni of KES ${amount}. You will get an SMS.`
  );
}

// ---------------- 2. Mama mboga registration ----------------
function registerFlow(phone, rest) {
  const existing = ledger.findVendorByPhone(phone);
  if (existing) return end(`This number is already registered as ${existing.name}. Dial again and choose 3.`);

  if (rest.length === 0) return con('Enter your business name\n(e.g. Mama Njeri):' + NAV);
  if (rest.length === 1) return con('Enter your location\n(e.g. Kawangware Stage 2):' + NAV);
  if (rest.length === 2) return con('Create a 4-digit PIN:' + NAV);
  if (!ledger.isValidPin(rest[2])) return end('PIN must be exactly 4 digits. Please dial again.');
  if (rest.length === 3) return con('Confirm your PIN:');
  if (rest[3] !== rest[2]) return end('PINs did not match. Please dial again.');

  const vendor = ledger.createVendor({ name: rest[0], location: rest[1], pin: rest[2], phone });
  return end(
    `Karibu ${vendor.name}! Customers in ${vendor.location} can now find you. ` +
      `Dashboard: ${config.publicUrl}`
  );
}

// ---------------- 3. Mama mboga account ----------------
function vendorFlow(phone, rest) {
  const vendor = ledger.findVendorByPhone(phone);
  if (!vendor) return end('This number is not registered. Dial again and choose 2 to register.');

  if (rest.length === 0) return con('Enter your PIN:');
  const pinResult = ledger.verifyVendorPin(vendor, rest[0]);
  if (pinResult === 'locked') return end('Too many wrong PINs. Try again in 15 minutes.');
  if (pinResult !== 'ok') return end('Wrong PIN.');

  if (rest.length === 1) {
    const s = ledger.summary(vendor.id);
    return con(
      `${vendor.name}\n` +
        `1. Pending approvals (${s.pending_count})\n` +
        `2. Debt summary\n` +
        `3. Record payment`
    );
  }

  const [, option, ...sub] = rest;
  switch (option) {
    case '1': return pendingMenu(vendor, sub);
    case '2': return summaryScreen(vendor);
    case '3': return paymentMenu(vendor, sub);
    default: return end('Invalid choice.');
  }
}

const who = (d) => (d.customer_name ? d.customer_name.slice(0, 12) : localPhone(d.customer_phone));

function pendingMenu(vendor, sub) {
  const pending = ledger.pendingDebts(vendor.id).slice(0, 4);
  if (pending.length === 0) return end('No deni requests waiting for approval.');

  if (sub.length === 0) {
    const list = pending.map((d, i) => `${i + 1}. ${who(d)} KES ${d.amount}`).join('\n');
    return con(`Pending approvals:\n${list}` + NAV);
  }
  const debt = pending[Number(sub[0]) - 1];
  if (!debt) return end('Invalid selection.');

  if (sub.length === 1) {
    return con(
      `Deni #${debt.id}\n${(debt.customer_name || '').slice(0, 15)} ${localPhone(debt.customer_phone)}\n` +
        `KES ${debt.amount} - ${(debt.description || '-').slice(0, 30)}\n1. Approve\n2. Reject` + NAV
    );
  }
  if (sub[1] === '1') {
    ledger.decideDebt(vendor.id, debt.id, true);
    return end(`Deni #${debt.id} of KES ${debt.amount} approved. ${who(debt)} has been notified.`);
  }
  if (sub[1] === '2') {
    ledger.decideDebt(vendor.id, debt.id, false);
    return end(`Deni #${debt.id} rejected. ${who(debt)} has been notified.`);
  }
  return end('Invalid choice.');
}

function summaryScreen(vendor) {
  const s = ledger.summary(vendor.id);
  const top = ledger.balancesByCustomer(vendor.id).slice(0, 3)
    .map((c) => `${(c.customer_name || localPhone(c.customer_phone)).slice(0, 12)} KES ${c.balance}`)
    .join('\n');
  return end(
    `Outstanding: KES ${s.outstanding}\nCustomers owing: ${s.customers_owing}\n` +
      `Pending: ${s.pending_count}\nCollected 30d: KES ${s.collected_30d}` +
      (top ? `\nTop:\n${top}` : '')
  );
}

function paymentMenu(vendor, sub) {
  const debts = ledger.outstandingDebts(vendor.id).slice(0, 4);
  if (debts.length === 0) return end('No outstanding debts. Hongera!');

  if (sub.length === 0) {
    const list = debts.map((d, i) => `${i + 1}. #${d.id} ${who(d)} KES ${d.balance}`).join('\n');
    return con(`Who paid?\n${list}` + NAV);
  }
  const debt = debts[Number(sub[0]) - 1];
  if (!debt) return end('Invalid selection.');

  if (sub.length === 1) {
    return con(`Deni #${debt.id} - ${who(debt)}\nBalance KES ${debt.balance}\nEnter amount paid:` + NAV);
  }
  const updated = ledger.recordPayment(vendor.id, debt.id, sub[1]);
  return end(
    updated.status === 'paid'
      ? `Deni #${debt.id} fully paid. Asante!`
      : `Payment recorded. Deni #${debt.id} balance: KES ${updated.balance}.`
  );
}

/** Express handler for POST /ussd */
function ussdRoute(req, res) {
  const { phoneNumber, text } = req.body || {};
  let reply;
  try {
    reply = handleUssd(phoneNumber, text);
  } catch (err) {
    console.error('USSD error:', err);
    reply = end('Sorry, something went wrong. Please try again.');
  }
  res.set('Content-Type', 'text/plain').send(reply);
}

module.exports = { ussdRoute, handleUssd, parseInputs };
