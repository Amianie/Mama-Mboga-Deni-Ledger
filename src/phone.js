// Phone helpers. Numbers are stored in international format: +2547XXXXXXXX
function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).replace(/[\s\-()]/g, '');
  if (/^0[17]\d{8}$/.test(p)) p = '+254' + p.slice(1);
  else if (/^[17]\d{8}$/.test(p)) p = '+254' + p;
  else if (/^254\d{9}$/.test(p)) p = '+' + p;
  return /^\+\d{10,15}$/.test(p) ? p : null;
}

/** +254712345678 -> 0712345678 (for short USSD/SMS display). */
function localPhone(p) {
  return p && p.startsWith('+254') ? '0' + p.slice(4) : p;
}

module.exports = { normalizePhone, localPhone };
