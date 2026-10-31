// Business logic shared by the USSD menu and the web dashboard.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const { notify } = require('./sms');
const { localPhone } = require('./phone');

const MAX_DEBT = 100000; // KES, sanity limit for a single deni

class LedgerError extends Error {}

// ---------- PINs ----------
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function checkPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

const isValidPin = (pin) => /^\d{4}$/.test(pin);

// Lock an account for 15 minutes after 5 wrong PINs (USSD and web share the counter).
const failedLogins = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

/** Returns 'ok' | 'wrong' | 'locked'. */
function verifyVendorPin(vendor, pin) {
  const now = Date.now();
  let rec = failedLogins.get(vendor.id);
  if (rec && rec.lockedUntil > now) return 'locked';
  if (rec && rec.lockedUntil && rec.lockedUntil <= now) rec = null; // lock expired, start over
  if (checkPin(pin, vendor.pin_hash)) {
    failedLogins.delete(vendor.id);
    return 'ok';
  }
  const count = (rec ? rec.count : 0) + 1;
  const locked = count >= MAX_ATTEMPTS;
  failedLogins.set(vendor.id, { count, lockedUntil: locked ? now + LOCK_MS : 0 });
  return locked ? 'locked' : 'wrong';
}

// ---------- Vendors (mama mbogas) ----------
function createVendor({ name, phone, location, pin }) {
  name = String(name || '').trim().slice(0, 40);
  location = String(location || '').trim().slice(0, 40);
  if (!name) throw new LedgerError('Business name is required.');
  if (!location) throw new LedgerError('Location is required.');
  if (!isValidPin(pin)) throw new LedgerError('PIN must be exactly 4 digits.');
  if (findVendorByPhone(phone)) throw new LedgerError('This phone number is already registered.');
  const id = db.run(
    'INSERT INTO vendors (name, phone, location, pin_hash) VALUES (?, ?, ?, ?)',
    [name, phone, location, hashPin(pin)]
  );
  return getVendor(id);
}

const getVendor = (id) => db.get('SELECT * FROM vendors WHERE id = ?', [id]);
const findVendorByPhone = (phone) => db.get('SELECT * FROM vendors WHERE phone = ?', [phone]);

/** Case-insensitive partial match on location. Stable ordering so USSD menu numbers stay valid. */
function searchVendors(location, limit = 5) {
  const q = String(location || '').trim();
  if (!q) return [];
  const pattern = '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  return db.all(
    `SELECT id, name, phone, location FROM vendors
     WHERE location LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE, id LIMIT ?`,
    [pattern, limit]
  );
}

// ---------- Customers ----------
const getCustomer = (phone) => db.get('SELECT * FROM customers WHERE phone = ?', [phone]);

function saveCustomer(phone, name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return;
  db.run(
    `INSERT INTO customers (phone, name) VALUES (?, ?)
     ON CONFLICT(phone) DO UPDATE SET name = excluded.name`,
    [phone, name]
  );
}

function customerLabel(phone) {
  const c = getCustomer(phone);
  return c ? `${c.name} (${localPhone(phone)})` : localPhone(phone);
}

// ---------- Debts ----------
function parseAmount(input) {
  const s = String(input || '').trim().replace(/,/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= MAX_DEBT ? n : null;
}

const DEBT_SELECT = `
  SELECT d.*, d.amount - d.amount_paid AS balance, c.name AS customer_name
  FROM debts d LEFT JOIN customers c ON c.phone = d.customer_phone`;

function getDebt(vendorId, debtId) {
  return db.get(`${DEBT_SELECT} WHERE d.id = ? AND d.vendor_id = ?`, [debtId, vendorId]);
}

/** Customer requests a deni; the mama mboga is prompted (SMS) to approve it. */
function requestDebt({ vendorId, customerPhone, amount, description }) {
  const vendor = getVendor(vendorId);
  if (!vendor) throw new LedgerError('Mama mboga not found.');
  if (vendor.phone === customerPhone) throw new LedgerError('You cannot record a deni with yourself.');
  const amt = parseAmount(amount);
  if (!amt) throw new LedgerError(`Amount must be a whole number between 1 and ${MAX_DEBT}.`);
  description = String(description || '').trim().slice(0, 60);

  const id = db.run(
    'INSERT INTO debts (vendor_id, customer_phone, amount, description) VALUES (?, ?, ?, ?)',
    [vendorId, customerPhone, amt, description]
  );
  notify(
    vendor.phone,
    `Deni request #${id}: ${customerLabel(customerPhone)} wants KES ${amt}` +
      (description ? ` for ${description}` : '') +
      `. To approve dial ${config.ussdCode} > 3 > Pending approvals, or open ${config.publicUrl}/dashboard`
  );
  return getDebt(vendorId, id);
}

function decideDebt(vendorId, debtId, approve) {
  const debt = getDebt(vendorId, debtId);
  if (!debt) throw new LedgerError('Deni not found.');
  if (debt.status !== 'pending') throw new LedgerError(`Deni #${debtId} was already ${debt.status}.`);
  const status = approve ? 'approved' : 'rejected';
  db.run("UPDATE debts SET status = ?, decided_at = datetime('now') WHERE id = ?", [status, debtId]);
  const vendor = getVendor(vendorId);
  notify(
    debt.customer_phone,
    approve
      ? `${vendor.name} approved your deni #${debtId} of KES ${debt.amount}. Please pay on time. Asante!`
      : `${vendor.name} did not approve your deni request #${debtId} of KES ${debt.amount}.`
  );
  return getDebt(vendorId, debtId);
}

function recordPayment(vendorId, debtId, amount) {
  const debt = getDebt(vendorId, debtId);
  if (!debt) throw new LedgerError('Deni not found.');
  if (debt.status !== 'approved') throw new LedgerError(`Deni #${debtId} is ${debt.status}, not outstanding.`);
  const amt = parseAmount(amount);
  if (!amt) throw new LedgerError('Enter a valid payment amount.');
  if (amt > debt.balance) throw new LedgerError(`Payment exceeds the balance of KES ${debt.balance}.`);

  db.transaction((tx) => {
    tx.run('INSERT INTO payments (debt_id, amount) VALUES (?, ?)', [debtId, amt]);
    tx.run(
      `UPDATE debts SET
         status  = CASE WHEN amount_paid + ? >= amount THEN 'paid' ELSE status END,
         paid_at = CASE WHEN amount_paid + ? >= amount THEN datetime('now') ELSE paid_at END,
         amount_paid = amount_paid + ?
       WHERE id = ?`,
      [amt, amt, amt, debtId]
    );
  });
  const updated = getDebt(vendorId, debtId);
  const vendor = getVendor(vendorId);
  notify(
    debt.customer_phone,
    updated.status === 'paid'
      ? `${vendor.name}: received KES ${amt}. Deni #${debtId} is fully paid. Asante!`
      : `${vendor.name}: received KES ${amt} for deni #${debtId}. Balance KES ${updated.balance}.`
  );
  return updated;
}

const pendingDebts = (vendorId) =>
  db.all(`${DEBT_SELECT} WHERE d.vendor_id = ? AND d.status = 'pending' ORDER BY d.id`, [vendorId]);

const outstandingDebts = (vendorId) =>
  db.all(`${DEBT_SELECT} WHERE d.vendor_id = ? AND d.status = 'approved' ORDER BY d.id`, [vendorId]);

const STATUSES = ['pending', 'approved', 'rejected', 'paid'];

function listDebts(vendorId, status) {
  if (STATUSES.includes(status)) {
    return db.all(
      `${DEBT_SELECT} WHERE d.vendor_id = ? AND d.status = ? ORDER BY d.id DESC LIMIT 200`,
      [vendorId, status]
    );
  }
  return db.all(`${DEBT_SELECT} WHERE d.vendor_id = ? ORDER BY d.id DESC LIMIT 200`, [vendorId]);
}

/** Outstanding balance per customer, largest first. */
function balancesByCustomer(vendorId) {
  return db.all(
    `SELECT d.customer_phone, c.name AS customer_name,
            SUM(d.amount - d.amount_paid) AS balance, COUNT(*) AS debts,
            MIN(d.created_at) AS oldest
     FROM debts d LEFT JOIN customers c ON c.phone = d.customer_phone
     WHERE d.vendor_id = ? AND d.status = 'approved'
     GROUP BY d.customer_phone ORDER BY balance DESC`,
    [vendorId]
  );
}

function summary(vendorId) {
  const s = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'approved' THEN amount - amount_paid END), 0) AS outstanding,
       COUNT(DISTINCT CASE WHEN status = 'approved' THEN customer_phone END)       AS customers_owing,
       COUNT(CASE WHEN status = 'pending' THEN 1 END)                              AS pending_count,
       COALESCE(SUM(CASE WHEN status = 'pending' THEN amount END), 0)              AS pending_amount
     FROM debts WHERE vendor_id = ?`,
    [vendorId]
  );
  const { collected } = db.get(
    `SELECT COALESCE(SUM(p.amount), 0) AS collected
     FROM payments p JOIN debts d ON d.id = p.debt_id
     WHERE d.vendor_id = ? AND p.created_at >= datetime('now', '-30 days')`,
    [vendorId]
  );
  return { ...s, collected_30d: collected };
}

module.exports = {
  LedgerError, STATUSES, isValidPin, verifyVendorPin, parseAmount,
  createVendor, getVendor, findVendorByPhone, searchVendors,
  getCustomer, saveCustomer, customerLabel,
  requestDebt, decideDebt, recordPayment, getDebt,
  pendingDebts, outstandingDebts, listDebts, balancesByCustomer, summary,
};
