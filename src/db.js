// SQLite via sql.js (pure WebAssembly, no native build needed).
// The whole DB is held in memory and written to disk after every change.
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vendors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL UNIQUE,
  location   TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS customers (
  phone      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS debts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(id),
  customer_phone TEXT NOT NULL,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  amount_paid    INTEGER NOT NULL DEFAULT 0,
  description    TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','paid')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at     TEXT,
  paid_at        TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id    INTEGER NOT NULL REFERENCES debts(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendors_location ON vendors(location);
CREATE INDEX IF NOT EXISTS idx_debts_vendor ON debts(vendor_id, status);
`;

let db = null;
let file = null;

async function init(dbFile) {
  const SQL = await initSqlJs();
  file = dbFile === ':memory:' ? null : dbFile;
  db = file && fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(SCHEMA);
  persist();
}

function persist() {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, file);
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

/** Run a write statement; returns the last inserted row id. */
function run(sql, params = []) {
  db.run(sql, params);
  const { id } = get('SELECT last_insert_rowid() AS id');
  persist();
  return id;
}

/** Run several writes atomically. */
function transaction(fn) {
  db.run('BEGIN');
  try {
    const result = fn({
      run: (sql, params = []) => { db.run(sql, params); return get('SELECT last_insert_rowid() AS id').id; },
      get,
      all,
    });
    db.run('COMMIT');
    persist();
    return result;
  } catch (err) {
    db.run('ROLLBACK');
    throw err;
  }
}

module.exports = { init, all, get, run, transaction };
