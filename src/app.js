const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const db = require('./db');
const { ussdRoute } = require('./ussd');
const dashboard = require('./dashboard');
const { outbox } = require('./sms');

async function createApp({ dbFile = config.dbFile, simulator = !config.production } = {}) {
  await db.init(dbFile);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.json({ limit: '20kb' }));

  // Africa's Talking USSD callback (no session/cookies needed).
  app.post('/ussd', ussdRoute);

  if (simulator) {
    app.get('/simulator', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'simulator.html')));
    app.get('/simulator/outbox', (req, res) => res.json(outbox));
    app.get('/simulator/config', (req, res) => res.json({ ussdCode: config.ussdCode }));
  }

  app.use(session({
    name: 'deni.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: 12 * 60 * 60 * 1000 },
  }));
  app.use(dashboard);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong.');
  });

  return app;
}

module.exports = { createApp };
