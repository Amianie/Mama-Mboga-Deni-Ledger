// Server-rendered HTML for the mama mboga dashboard. All user data goes through esc().
const config = require('./config');
const { localPhone } = require('./phone');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');
const date = (s) => (s ? esc(s.slice(0, 16).replace('T', ' ')) : '');
const customer = (row) =>
  row.customer_name
    ? `${esc(row.customer_name)} <span class="muted">${esc(localPhone(row.customer_phone))}</span>`
    : esc(localPhone(row.customer_phone));

const CSS = `
:root{--bg:#f6f7f4;--surface:#fff;--ink:#1d2321;--ink2:#4a524e;--muted:#737b77;--line:#e3e6e1;
 --brand:#2f7a3d;--brand-ink:#fff;--good:#2f7a3d;--warn:#9a6400;--bad:#b3261e;--info:#3b5b8a}
@media (prefers-color-scheme:dark){:root{--bg:#141816;--surface:#1d2220;--ink:#e8ebe9;--ink2:#bfc6c2;
 --muted:#8d9591;--line:#2e3532;--brand:#5fb36e;--brand-ink:#0d1a10;--good:#6cc27a;--warn:#e0a63a;--bad:#ef7a70;--info:#8fb0e0}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--surface);border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header .brand{font-weight:700;color:var(--brand);font-size:17px}header .who{margin-left:auto;color:var(--ink2)}
main{max-width:1100px;margin:0 auto;padding:20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}.muted{color:var(--muted);font-size:13px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.tile .label{color:var(--ink2);font-size:13px}.tile .value{font-size:28px;font-weight:650;margin-top:4px;font-variant-numeric:tabular-nums}
.tile .sub{color:var(--muted);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink2);font-weight:600}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
.empty{padding:18px;text-align:center;color:var(--muted)}
.badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor}
.badge.pending{color:var(--warn)}.badge.approved{color:var(--info)}.badge.paid{color:var(--good)}.badge.rejected{color:var(--bad)}
form.inline{display:inline-flex;gap:6px;align-items:center;margin:0}
button,.btn{font:inherit;font-weight:600;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);padding:6px 12px;cursor:pointer;text-decoration:none;display:inline-block}
button.primary,.btn.primary{background:var(--brand);border-color:var(--brand);color:var(--brand-ink)}
button.danger{color:var(--bad)}button:hover{filter:brightness(.96)}
input{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink)}
input.amt{width:100px;padding:5px 8px}
.auth{max-width:380px;margin:48px auto}.auth label{display:block;font-size:13px;color:var(--ink2);margin:12px 0 4px}.auth input{width:100%}
.auth button{width:100%;margin-top:18px;padding:10px}
.flash{padding:10px 14px;border-radius:8px;margin:12px 0;border:1px solid}.flash.ok{color:var(--good)}.flash.err{color:var(--bad)}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.filters a{font-size:13px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--ink2);text-decoration:none}
.filters a.on{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.howto{margin-top:28px}.howto code{background:var(--bg);padding:1px 6px;border-radius:4px}
@media (max-width:700px){.hide-sm{display:none}}
`;

function layout(title, body, vendor, csrf) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Mama Mboga Deni Ledger</title><style>${CSS}</style></head><body>
<header><span class="brand">🥬 Mama Mboga Deni Ledger</span>
${vendor ? `<span class="who">${esc(vendor.name)} · ${esc(vendor.location)}</span>
<form class="inline" method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button>Log out</button></form>` : ''}
</header><main>${body}</main></body></html>`;
}

function flashHtml(flash) {
  if (!flash) return '';
  return `<div class="flash ${flash.type === 'error' ? 'err' : 'ok'}" role="status">${flash.type === 'error' ? '⚠ ' : '✓ '}${esc(flash.message)}</div>`;
}

function loginPage({ error, phone } = {}) {
  return layout('Log in', `<div class="auth card">
<h1>Log in</h1><p class="muted">For mama mbogas. Use the phone number and PIN you registered with.</p>
${error ? flashHtml({ type: 'error', message: error }) : ''}
<form method="post" action="/login">
<label for="phone">Phone number</label><input id="phone" name="phone" inputmode="tel" placeholder="0712 345 678" value="${esc(phone)}" required>
<label for="pin">4-digit PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required>
<button class="primary">Log in</button></form>
<p class="muted" style="margin-top:16px">New here? <a href="/register">Create a mama mboga account</a> or dial <b>${esc(config.ussdCode)}</b> and choose 2.</p>
</div>`);
}

function registerPage({ error, values = {} } = {}) {
  return layout('Register', `<div class="auth card">
<h1>Create your account</h1><p class="muted">Customers will find you by your location when they dial <b>${esc(config.ussdCode)}</b>.</p>
${error ? flashHtml({ type: 'error', message: error }) : ''}
<form method="post" action="/register">
<label for="name">Business name</label><input id="name" name="name" maxlength="40" placeholder="Mama Njeri" value="${esc(values.name)}" required>
<label for="phone">Phone number</label><input id="phone" name="phone" inputmode="tel" placeholder="0712 345 678" value="${esc(values.phone)}" required>
<label for="location">Location</label><input id="location" name="location" maxlength="40" placeholder="Kawangware Stage 2" value="${esc(values.location)}" required>
<label for="pin">Create a 4-digit PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required>
<label for="pin2">Confirm PIN</label><input id="pin2" name="pin2" type="password" inputmode="numeric" pattern="\\d{4}" maxlength="4" required>
<button class="primary">Create account</button></form>
<p class="muted" style="margin-top:16px">Already registered? <a href="/login">Log in</a></p>
</div>`);
}

const STATUS_ICON = { pending: '⏳', approved: '●', paid: '✓', rejected: '✕' };
const STATUS_LABEL = { pending: 'Pending', approved: 'Owing', paid: 'Paid', rejected: 'Rejected' };
const badge = (s) => `<span class="badge ${s}">${STATUS_ICON[s]} ${STATUS_LABEL[s]}</span>`;

function dashboardPage({ vendor, csrf, flash, summary, pending, balances, debts, status }) {
  const hidden = `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;

  const tiles = `<div class="tiles">
  <div class="card tile"><div class="label">Total owed to you</div><div class="value">${kes(summary.outstanding)}</div><div class="sub">across approved debts</div></div>
  <div class="card tile"><div class="label">Customers owing</div><div class="value">${summary.customers_owing}</div><div class="sub">with an unpaid balance</div></div>
  <div class="card tile"><div class="label">Waiting for approval</div><div class="value">${summary.pending_count}</div><div class="sub">${kes(summary.pending_amount)} requested</div></div>
  <div class="card tile"><div class="label">Collected (30 days)</div><div class="value">${kes(summary.collected_30d)}</div><div class="sub">payments recorded</div></div>
</div>`;

  const pendingRows = pending.map((d) => `<tr>
<td>#${d.id}</td><td>${customer(d)}</td><td>${esc(d.description) || '<span class="muted">—</span>'}</td>
<td class="num">${kes(d.amount)}</td><td class="hide-sm">${date(d.created_at)}</td>
<td><form class="inline" method="post" action="/debts/${d.id}/approve">${hidden}<button class="primary">Approve</button></form>
<form class="inline" method="post" action="/debts/${d.id}/reject">${hidden}<button class="danger">Reject</button></form></td></tr>`).join('');

  const balanceRows = balances.map((c) => `<tr>
<td>${customer(c)}</td><td class="num">${c.debts}</td><td class="hide-sm">${date(c.oldest)}</td><td class="num"><b>${kes(c.balance)}</b></td></tr>`).join('');

  const filterLink = (s, label) =>
    `<a href="/dashboard${s ? `?status=${s}` : ''}#all" class="${(status || '') === s ? 'on' : ''}">${label}</a>`;

  const debtRows = debts.map((d) => `<tr>
<td>#${d.id}</td><td>${customer(d)}</td><td class="hide-sm">${esc(d.description)}</td>
<td class="num">${kes(d.amount)}</td><td class="num">${kes(d.balance)}</td><td>${badge(d.status)}</td>
<td class="hide-sm">${date(d.created_at)}</td>
<td>${d.status === 'approved' ? `<form class="inline" method="post" action="/debts/${d.id}/pay">${hidden}
<input class="amt" name="amount" inputmode="numeric" pattern="\\d+" placeholder="${d.balance}" value="${d.balance}" aria-label="Amount paid for deni #${d.id}" required>
<button>Record payment</button></form>` : ''}</td></tr>`).join('');

  return layout('Dashboard', `
<h1>Habari, ${esc(vendor.name)}</h1>
<p class="muted">Your deni ledger · <a href="/dashboard">Refresh</a></p>
${flashHtml(flash)}
${tiles}

<h2>Waiting for your approval</h2>
<table><thead><tr><th>Ref</th><th>Customer</th><th>Items</th><th class="num">Amount</th><th class="hide-sm">Requested</th><th>Action</th></tr></thead>
<tbody>${pendingRows || '<tr><td colspan="6" class="empty">No requests waiting. New requests also arrive by SMS.</td></tr>'}</tbody></table>

<h2>Who owes you</h2>
<table><thead><tr><th>Customer</th><th class="num">Debts</th><th class="hide-sm">Oldest since</th><th class="num">Balance</th></tr></thead>
<tbody>${balanceRows || '<tr><td colspan="4" class="empty">Nobody owes you right now.</td></tr>'}</tbody></table>

<h2 id="all">All debts</h2>
<div class="filters">${filterLink('', 'All')}${filterLink('pending', 'Pending')}${filterLink('approved', 'Owing')}${filterLink('paid', 'Paid')}${filterLink('rejected', 'Rejected')}</div>
<table><thead><tr><th>Ref</th><th>Customer</th><th class="hide-sm">Items</th><th class="num">Amount</th><th class="num">Balance</th><th>Status</th><th class="hide-sm">Date</th><th></th></tr></thead>
<tbody>${debtRows || '<tr><td colspan="8" class="empty">No debts yet.</td></tr>'}</tbody></table>

<div class="card howto"><b>How customers record a deni:</b> they dial <code>${esc(config.ussdCode)}</code>, choose <b>1</b>,
type your location (<b>${esc(vendor.location)}</b>), pick your name, then enter the amount. You get an SMS and approve it here
or by dialing <code>${esc(config.ussdCode)}</code> → 3.</div>
`, vendor, csrf);
}

module.exports = { loginPage, registerPage, dashboardPage, esc };
