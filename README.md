# Mama Mboga Deni Ledger

A USSD app that lets customers record a **deni** (debt) with their mama mboga, and lets the mama mboga approve it and track who owes what.

## How it works

One USSD code (e.g. `*384*1234#`) serves everyone:

```
Karibu Mama Mboga Deni Ledger
1. Record a deni (Customer)
2. Register as Mama Mboga
3. Mama Mboga account
```

**Mama mboga registration** (USSD option 2 or the web `/register` page): business name → location → 4-digit PIN.

**Customer records a deni** (option 1):
1. Type a location, e.g. `Kawangware`. Partial, case-insensitive matches are fine.
2. Pick a mama mboga from the list.
3. First-time customers also enter their name.
4. Enter the amount (KES) and what they took, then confirm.
5. The mama mboga gets an **SMS approval prompt**. The deni stays *pending* until she approves it.

**Mama mboga account** (option 3, needs her PIN):
- `1. Pending approvals`: approve or reject each request. The customer gets an SMS either way.
- `2. Debt summary`: total owed, customers owing, amount collected in the last 30 days, and the top debtors.
- `3. Record payment`: full or partial payment. The customer gets an SMS with the remaining balance.

**Web dashboard** (`/login`, phone number + PIN): stat tiles, a pending-approvals table with Approve/Reject buttons, a "Who owes you" list, and a full debt history with status filters and payment recording.

Navigation on any USSD screen: `0` = back, `00` = home.

## Run it locally

```bash
npm install
npm start            # or: node --env-file=.env server.js
```

- Dashboard: http://localhost:3000/login
- **USSD simulator**: http://localhost:3000/simulator. A phone-style screen that sends the same requests Africa's Talking would, plus an SMS outbox. Use one phone number as the mama mboga and a different one as the customer.
- Tests: `npm test`

Data is stored in SQLite at `data/deni.sqlite`. It uses `sql.js`, so there are no native modules to compile.

## Go live with Africa's Talking

1. Create an Africa's Talking account and get a USSD service code. Use the sandbox first.
2. Deploy this app somewhere with HTTPS, or expose it locally with `ngrok http 3000`.
3. In the AT dashboard, set the USSD **callback URL** to `https://<your-host>/ussd`.
4. Copy `.env.example` to `.env` and set `USSD_CODE`, `PUBLIC_URL`, `AT_USERNAME`, `AT_API_KEY`, and `SESSION_SECRET`. Set `NODE_ENV=production` to turn off the simulator and require HTTPS cookies.

Without `AT_API_KEY`, SMS messages are printed to the console and shown in the simulator outbox instead of being sent.

## Project layout

```
server.js            entry point
src/app.js           Express app wiring
src/ussd.js          USSD menu state machine (Africa's Talking CON/END format)
src/ledger.js        business logic: vendors, debts, approvals, payments, PIN checks
src/dashboard.js     web dashboard routes (sessions, CSRF)
src/views.js         dashboard HTML
src/sms.js           Africa's Talking SMS sender
src/db.js            SQLite schema and helpers
public/simulator.html  browser USSD simulator
test/flow.test.js    end-to-end tests
```

## Notes

- **Why approval is by SMS:** USSD sessions are started by the user. Most aggregators, including Africa's Talking by default, do not let an app push a USSD menu to another phone. So the mama mboga gets an SMS and approves by dialing the code (option 3) or from the dashboard.
- PINs are hashed with scrypt. After 5 wrong PINs the account is locked for 15 minutes, on both USSD and web.
- Login sessions and the PIN-lockout counter are kept in memory, so restarting the server logs everyone out and resets the counter. For a multi-server setup, use a persistent session store and a database such as PostgreSQL.
