// Web dashboard routes for mama mbogas.
const crypto = require('crypto');
const express = require('express');
const ledger = require('./ledger');
const views = require('./views');
const { normalizePhone } = require('./phone');

const router = express.Router();

// CSRF token per session, checked on every state-changing request.
router.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (req.method === 'POST' && req.session.vendorId) {
    const sent = String((req.body && req.body._csrf) || '');
    const ok = sent.length === req.session.csrf.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.session.csrf));
    if (!ok) return res.status(403).send('Invalid form token. Go back, refresh the page and try again.');
  }
  next();
});

function requireVendor(req, res, next) {
  const vendor = req.session.vendorId && ledger.getVendor(req.session.vendorId);
  if (!vendor) return res.redirect('/login');
  req.vendor = vendor;
  next();
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function startSession(req, res, vendorId) {
  // New session id on login to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) return res.status(500).send('Could not start session.');
    req.session.vendorId = vendorId;
    req.session.csrf = crypto.randomBytes(24).toString('hex');
    res.redirect('/dashboard');
  });
}

router.get('/', (req, res) => res.redirect(req.session.vendorId ? '/dashboard' : '/login'));

router.get('/login', (req, res) => res.send(views.loginPage()));

router.post('/login', (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const vendor = phone && ledger.findVendorByPhone(phone);
  const result = vendor ? ledger.verifyVendorPin(vendor, String(req.body.pin || '')) : 'wrong';
  if (result === 'ok') return startSession(req, res, vendor.id);
  const error = result === 'locked'
    ? 'Too many wrong PINs. Try again in 15 minutes.'
    : 'Phone number or PIN is incorrect.';
  res.status(401).send(views.loginPage({ error, phone: req.body.phone }));
});

router.get('/register', (req, res) => res.send(views.registerPage()));

router.post('/register', (req, res) => {
  const { name, location, pin, pin2 } = req.body;
  const values = { name, location, phone: req.body.phone };
  const phone = normalizePhone(req.body.phone);
  const fail = (error) => res.status(400).send(views.registerPage({ error, values }));
  if (!phone) return fail('Enter a valid phone number, e.g. 0712345678.');
  if (pin !== pin2) return fail('PINs did not match.');
  try {
    const vendor = ledger.createVendor({ name, phone, location, pin });
    startSession(req, res, vendor.id);
  } catch (err) {
    if (err instanceof ledger.LedgerError) return fail(err.message);
    throw err;
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/dashboard', requireVendor, (req, res) => {
  const { vendor } = req;
  const status = ledger.STATUSES.includes(req.query.status) ? req.query.status : '';
  const flash = req.session.flash;
  delete req.session.flash;
  res.send(views.dashboardPage({
    vendor,
    csrf: req.session.csrf,
    flash,
    status,
    summary: ledger.summary(vendor.id),
    pending: ledger.pendingDebts(vendor.id),
    balances: ledger.balancesByCustomer(vendor.id),
    debts: ledger.listDebts(vendor.id, status),
  }));
});

function debtAction(fn) {
  return [requireVendor, (req, res) => {
    const id = Number(req.params.id);
    try {
      setFlash(req, 'ok', fn(req.vendor.id, id, req));
    } catch (err) {
      if (!(err instanceof ledger.LedgerError)) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/dashboard');
  }];
}

router.post('/debts/:id/approve', ...debtAction((vid, id) => {
  const d = ledger.decideDebt(vid, id, true);
  return `Deni #${d.id} of KES ${d.amount} approved. The customer has been notified by SMS.`;
}));

router.post('/debts/:id/reject', ...debtAction((vid, id) => {
  const d = ledger.decideDebt(vid, id, false);
  return `Deni #${d.id} rejected. The customer has been notified by SMS.`;
}));

router.post('/debts/:id/pay', ...debtAction((vid, id, req) => {
  const d = ledger.recordPayment(vid, id, req.body.amount);
  return d.status === 'paid'
    ? `Deni #${d.id} is now fully paid.`
    : `Payment recorded for deni #${d.id}. Balance: KES ${d.balance}.`;
}));

module.exports = router;
