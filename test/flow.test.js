// End-to-end: mama mboga registers, customer records a deni, mama approves, pays, dashboard works.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const { outbox } = require('../src/sms');
const { parseInputs } = require('../src/ussd');

let server, base;
const MAMA = '+254700000001';
const CUSTOMER = '+254711111111';

before(async () => {
  const app = await createApp({ dbFile: ':memory:', simulator: true });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function ussd(phoneNumber, text) {
  const res = await fetch(`${base}/ussd`, {
    method: 'POST',
    body: new URLSearchParams({ sessionId: 's1', serviceCode: '*384*1234#', phoneNumber, text }),
  });
  return res.text();
}

test('navigation: 0 goes back, 00 goes home', () => {
  assert.deepStrictEqual(parseInputs('1*Kawa*0*Kangemi'), ['1', 'Kangemi']);
  assert.deepStrictEqual(parseInputs('1*Kawa*00*2'), ['2']);
  assert.deepStrictEqual(parseInputs(''), []);
});

test('main menu', async () => {
  const r = await ussd(CUSTOMER, '');
  assert.match(r, /^CON /);
  assert.match(r, /1\. Record a deni/);
});

test('mama mboga registers via USSD', async () => {
  assert.match(await ussd(MAMA, '2'), /business name/);
  assert.match(await ussd(MAMA, '2*Mama Njeri*Kawangware Stage 2*1234'), /Confirm your PIN/);
  assert.match(await ussd(MAMA, '2*Mama Njeri*Kawangware Stage 2*1234*9999'), /^END PINs did not match/);
  assert.match(await ussd(MAMA, '2*Mama Njeri*Kawangware Stage 2*1234*1234'), /^END Karibu Mama Njeri/);
  assert.match(await ussd(MAMA, '2'), /already registered/);
});

test('customer records a deni and mama mboga gets an approval SMS', async () => {
  assert.match(await ussd(CUSTOMER, '1'), /Enter your location/);
  assert.match(await ussd(CUSTOMER, '1*nairobi'), /No Mama Mboga found/);
  assert.match(await ussd(CUSTOMER, '1*kawangware'), /1\. Mama Njeri/);
  assert.match(await ussd(CUSTOMER, '1*kawangware*1'), /Enter your name/); // first-time customer
  assert.match(await ussd(CUSTOMER, '1*kawangware*1*Jane'), /Enter deni amount/);
  assert.match(await ussd(CUSTOMER, '1*kawangware*1*Jane*abc'), /^END Invalid amount/);
  assert.match(await ussd(CUSTOMER, '1*kawangware*1*Jane*350'), /What did you take/);
  assert.match(await ussd(CUSTOMER, '1*kawangware*1*Jane*350*sukuma'), /KES 350 - sukuma[\s\S]*1\. Confirm/);
  assert.match(await ussd(CUSTOMER, '1*kawangware*1*Jane*350*sukuma*1'), /^END Request #1 sent/);

  const sms = outbox.find((m) => m.to === MAMA);
  assert.ok(sms, 'mama mboga should receive an SMS');
  assert.match(sms.message, /Jane \(0711111111\) wants KES 350 for sukuma/);

  // Returning customer is not asked for their name again.
  assert.match(await ussd(CUSTOMER, '1*kawangware*1'), /Enter deni amount/);
  assert.match(await ussd(CUSTOMER, '1*kawangware*1*200*unga*1'), /^END Request #2 sent/);
});

test('mama mboga approves / rejects via USSD', async () => {
  assert.match(await ussd(MAMA, '3*0000'), /^END Wrong PIN/);
  assert.match(await ussd(MAMA, '3*1234'), /Pending approvals \(2\)/);
  assert.match(await ussd(MAMA, '3*1234*1'), /1\. Jane KES 350\n2\. Jane KES 200/);
  assert.match(await ussd(MAMA, '3*1234*1*1'), /Deni #1[\s\S]*1\. Approve/);
  assert.match(await ussd(MAMA, '3*1234*1*1*1'), /^END Deni #1 of KES 350 approved/);
  assert.match(outbox[0].message, /approved your deni #1/);
  assert.strictEqual(outbox[0].to, CUSTOMER);
  // #2 is now first in the pending list
  assert.match(await ussd(MAMA, '3*1234*1*1*2'), /^END Deni #2 rejected/);
});

test('summary and partial / full payment via USSD', async () => {
  assert.match(await ussd(MAMA, '3*1234*2'), /Outstanding: KES 350[\s\S]*Customers owing: 1/);
  assert.match(await ussd(MAMA, '3*1234*3*1*100'), /balance: KES 250/);
  assert.match(await ussd(MAMA, '3*1234*3*1*999'), /^END Payment exceeds/);
  assert.match(await ussd(MAMA, '3*1234*3*1*250'), /fully paid/);
  assert.match(await ussd(MAMA, '3*1234*3'), /No outstanding debts/);
});

test('mama mboga cannot record a deni with herself', async () => {
  assert.match(await ussd(MAMA, '1*kawangware*1'), /^END You cannot record a deni with yourself/);
});

test('dashboard: login, view debts, approve with CSRF token', async () => {
  // a new pending deni to approve from the web
  await ussd(CUSTOMER, '1*kawangware*1*500*nyanya*1');

  const bad = await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ phone: '0700000001', pin: '1111' }) });
  assert.strictEqual(bad.status, 401);

  const login = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ phone: '0700 000 001', pin: '1234' }),
  });
  assert.strictEqual(login.status, 302);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const page = await (await fetch(`${base}/dashboard`, { headers: { cookie } })).text();
  assert.match(page, /Habari, Mama Njeri/);
  assert.match(page, /Waiting for approval<\/div><div class="value">1/);
  assert.match(page, /nyanya/);
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];

  const noToken = await fetch(`${base}/debts/3/approve`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.strictEqual(noToken.status, 403);

  const ok = await fetch(`${base}/debts/3/approve`, {
    method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.strictEqual(ok.status, 302);
  const after = await (await fetch(`${base}/dashboard`, { headers: { cookie } })).text();
  assert.match(after, /Deni #3 of KES 500 approved/);
  assert.match(after, /Total owed to you<\/div><div class="value">KES 500/);
});

test('dashboard: web registration and HTML escaping', async () => {
  const res = await fetch(`${base}/register`, {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ name: '<script>x</script>', phone: '0722000000', location: 'Kangemi', pin: '4321', pin2: '4321' }),
  });
  assert.strictEqual(res.status, 302);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${base}/dashboard`, { headers: { cookie } })).text();
  assert.ok(!page.includes('<script>x</script>'));
  assert.match(page, /&lt;script&gt;/);
});
