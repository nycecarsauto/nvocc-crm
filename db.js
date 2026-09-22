'use strict';

// NVOCC CRM — database layer (Node.js built-in SQLite, no external deps)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.NVOCC_DB || path.join(__dirname, 'nvocc.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'customer',   -- 'staff' | 'customer'
  name          TEXT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL, -- for customers
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  id_number     TEXT,               -- passport / national ID
  address       TEXT,
  city          TEXT,
  country       TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shipments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id          INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  owner_client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL, -- which customer owns/sees it
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Shipper (FROM)
  shipper_first      TEXT,
  shipper_last       TEXT,
  shipper_name       TEXT,
  shipper_phone      TEXT,
  shipper_email      TEXT,
  shipper_id         TEXT,
  from_address       TEXT,
  from_city          TEXT,
  from_state         TEXT,
  from_zip           TEXT,
  from_country       TEXT,

  -- Consignee (TO)
  consignee_first    TEXT,
  consignee_last     TEXT,
  consignee_name     TEXT,
  consignee_phone    TEXT,
  consignee_email    TEXT,
  consignee_id       TEXT,
  to_address         TEXT,
  to_city            TEXT,
  to_state           TEXT,
  to_zip             TEXT,
  to_country         TEXT,

  -- Shipment / tracking
  bl_number          TEXT,
  pickup_date        TEXT,          -- date the CUSTOMER requests pickup
  pickup_time        TEXT,          -- preferred pickup time window
  ship_date          TEXT,
  dest_port          TEXT,
  carrier            TEXT,
  vessel             TEXT,
  container_number   TEXT,
  status             TEXT NOT NULL DEFAULT 'Draft',
  notes              TEXT,

  -- Waybill Input Form (office / backend) fields
  origin             TEXT,          -- origin port / city
  called_in_by       TEXT,
  signed_date        TEXT,
  signed_time        TEXT,
  signed_by          TEXT,
  invoice_number     TEXT,
  invoice_date       TEXT,
  deliver_time       TEXT,          -- delivery time window (pairs with ship_date)
  from_company       TEXT,
  from_other         TEXT,
  from_ref           TEXT,
  from_close         TEXT,
  to_company         TEXT,
  to_other           TEXT,
  to_ref             TEXT,
  to_close           TEXT,
  contents           TEXT,          -- short contents summary
  special_instructions TEXT,
  billto_name        TEXT,
  billto_contact     TEXT,
  billto_address     TEXT,
  service_request    TEXT,
  payment_method     TEXT,

  -- Dispatch tracking (dispatch board)
  driver             TEXT,
  ready_at           TEXT,
  close_at           TEXT,
  conf_pieces        INTEGER,
  conf_weight        REAL,
  conf_unit          TEXT DEFAULT 'lb',
  dispatch_status    TEXT,          -- 'Unassigned' | 'Assigned' | 'Picked up' | 'Delivered'

  -- Pricing snapshot (authoritative, recomputed from items on save)
  total_pieces       INTEGER NOT NULL DEFAULT 0,
  total_weight       REAL NOT NULL DEFAULT 0,
  total_value        REAL NOT NULL DEFAULT 0,
  total_charge       REAL NOT NULL DEFAULT 0,
  total_cost         REAL DEFAULT 0,   -- office-entered cost, for profit calc

  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id    INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  item_type      TEXT NOT NULL DEFAULT 'barrel',  -- 'barrel' | 'box' | 'other'
  description    TEXT,
  quantity       INTEGER NOT NULL DEFAULT 1,

  -- Dimensions (used for volume-priced items)
  length         REAL,
  width          REAL,
  height         REAL,
  dim_unit       TEXT DEFAULT 'in',   -- 'in' | 'cm'

  weight         REAL,                -- per piece
  weight_unit    TEXT DEFAULT 'lb',   -- 'lb' | 'kg'
  declared_value REAL,                -- per piece

  -- Pricing
  pricing_mode   TEXT NOT NULL DEFAULT 'flat',  -- 'flat' (barrels) | 'volume'
  rate           REAL NOT NULL DEFAULT 0,        -- $/barrel (flat) or $/ft3 or $/CBM (volume)
  volume_each    REAL NOT NULL DEFAULT 0,        -- computed L*W*H per piece in volume_unit
  volume_unit    TEXT DEFAULT 'ft3',             -- 'ft3' (inches) | 'CBM' (cm)
  line_charge    REAL NOT NULL DEFAULT 0,        -- computed charge for the whole line

  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_shipment ON items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipments_client ON shipments(client_id);

-- Pickup / delivery agents (mirrors the waybill program's Agents)
CREATE TABLE IF NOT EXISTS agents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location    TEXT,               -- location / airport code
  name        TEXT NOT NULL,
  attention   TEXT,
  address     TEXT,
  city        TEXT,
  state       TEXT,
  zip         TEXT,
  phone       TEXT,
  fax         TEXT,
  comments    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Accounting: cash receipts & credit memos
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'receipt',  -- 'receipt' | 'credit'
  pay_date      TEXT,
  check_number  TEXT,
  amount        REAL NOT NULL DEFAULT 0,
  invoice_ref   TEXT,             -- waybill / invoice number this applies to
  memo          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);

-- App-wide default rates (single row, id = 1)
CREATE TABLE IF NOT EXISTS settings (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  default_barrel_rate REAL NOT NULL DEFAULT 75,   -- flat $/barrel
  default_volume_rate REAL NOT NULL DEFAULT 8,    -- $/ft3
  currency           TEXT NOT NULL DEFAULT 'USD',
  -- Company details shown on the printable invoice (editable in Settings)
  company_name       TEXT DEFAULT 'Scotty''s Caribbean Shipping',
  company_tagline    TEXT DEFAULT 'To the Caribbean & the rest of the world',
  company_agent      TEXT DEFAULT 'Agents for D.A.D Caribbean Shipping Inc.',
  company_address    TEXT DEFAULT '961 East 51 Street, Brooklyn, NY 11203',
  company_phone      TEXT DEFAULT '718.941.8443 · 347.200.9626',
  company_email      TEXT DEFAULT 'scottyscaribbean@aol.com',
  invoice_terms      TEXT DEFAULT 'Freight charges not paid for within 2 weeks will be collected at destination.'
);
INSERT OR IGNORE INTO settings (id) VALUES (1);
`);

// --- lightweight migrations for pre-existing databases (ignore if present) ---
for (const stmt of [
  "ALTER TABLE shipments ADD COLUMN owner_client_id INTEGER",
  "ALTER TABLE shipments ADD COLUMN created_by INTEGER",
  "ALTER TABLE shipments ADD COLUMN pickup_date TEXT",
  "ALTER TABLE shipments ADD COLUMN pickup_time TEXT",
  "ALTER TABLE shipments ADD COLUMN origin TEXT",
  "ALTER TABLE shipments ADD COLUMN called_in_by TEXT",
  "ALTER TABLE shipments ADD COLUMN signed_date TEXT",
  "ALTER TABLE shipments ADD COLUMN signed_time TEXT",
  "ALTER TABLE shipments ADD COLUMN signed_by TEXT",
  "ALTER TABLE shipments ADD COLUMN invoice_number TEXT",
  "ALTER TABLE shipments ADD COLUMN invoice_date TEXT",
  "ALTER TABLE shipments ADD COLUMN deliver_time TEXT",
  "ALTER TABLE shipments ADD COLUMN from_company TEXT",
  "ALTER TABLE shipments ADD COLUMN from_other TEXT",
  "ALTER TABLE shipments ADD COLUMN from_ref TEXT",
  "ALTER TABLE shipments ADD COLUMN from_close TEXT",
  "ALTER TABLE shipments ADD COLUMN to_company TEXT",
  "ALTER TABLE shipments ADD COLUMN to_other TEXT",
  "ALTER TABLE shipments ADD COLUMN to_ref TEXT",
  "ALTER TABLE shipments ADD COLUMN to_close TEXT",
  "ALTER TABLE shipments ADD COLUMN contents TEXT",
  "ALTER TABLE shipments ADD COLUMN special_instructions TEXT",
  "ALTER TABLE shipments ADD COLUMN billto_name TEXT",
  "ALTER TABLE shipments ADD COLUMN billto_contact TEXT",
  "ALTER TABLE shipments ADD COLUMN billto_address TEXT",
  "ALTER TABLE shipments ADD COLUMN service_request TEXT",
  "ALTER TABLE shipments ADD COLUMN payment_method TEXT",
  "ALTER TABLE shipments ADD COLUMN total_cost REAL DEFAULT 0",
  "ALTER TABLE shipments ADD COLUMN driver TEXT",
  "ALTER TABLE shipments ADD COLUMN ready_at TEXT",
  "ALTER TABLE shipments ADD COLUMN close_at TEXT",
  "ALTER TABLE shipments ADD COLUMN conf_pieces INTEGER",
  "ALTER TABLE shipments ADD COLUMN conf_weight REAL",
  "ALTER TABLE shipments ADD COLUMN conf_unit TEXT DEFAULT 'lb'",
  "ALTER TABLE shipments ADD COLUMN dispatch_status TEXT",
  "ALTER TABLE shipments ADD COLUMN shipper_first TEXT",
  "ALTER TABLE shipments ADD COLUMN shipper_last TEXT",
  "ALTER TABLE shipments ADD COLUMN from_city TEXT",
  "ALTER TABLE shipments ADD COLUMN from_state TEXT",
  "ALTER TABLE shipments ADD COLUMN from_zip TEXT",
  "ALTER TABLE shipments ADD COLUMN from_country TEXT",
  "ALTER TABLE shipments ADD COLUMN consignee_first TEXT",
  "ALTER TABLE shipments ADD COLUMN consignee_last TEXT",
  "ALTER TABLE shipments ADD COLUMN to_city TEXT",
  "ALTER TABLE shipments ADD COLUMN to_state TEXT",
  "ALTER TABLE shipments ADD COLUMN to_zip TEXT",
  "ALTER TABLE shipments ADD COLUMN to_country TEXT",
  "ALTER TABLE settings ADD COLUMN company_name TEXT DEFAULT 'Scotty''s Caribbean Shipping'",
  "ALTER TABLE settings ADD COLUMN company_tagline TEXT DEFAULT 'To the Caribbean & the rest of the world'",
  "ALTER TABLE settings ADD COLUMN company_agent TEXT DEFAULT 'Agents for D.A.D Caribbean Shipping Inc.'",
  "ALTER TABLE settings ADD COLUMN company_address TEXT DEFAULT '961 East 51 Street, Brooklyn, NY 11203'",
  "ALTER TABLE settings ADD COLUMN company_phone TEXT DEFAULT '718.941.8443 · 347.200.9626'",
  "ALTER TABLE settings ADD COLUMN company_email TEXT DEFAULT 'scottyscaribbean@aol.com'",
  "ALTER TABLE settings ADD COLUMN invoice_terms TEXT DEFAULT 'Freight charges not paid for within 2 weeks will be collected at destination.'",
]) {
  try { db.exec(stmt); } catch (_) { /* column already exists */ }
}

// --- seed a staff admin account on first run ---
const crypto = require('node:crypto');
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { hash, salt };
}
const haveStaff = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='staff'").get().n;
if (!haveStaff) {
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || 'admin123';
  const { hash, salt } = hashPassword(password);
  db.prepare("INSERT INTO users (username, pass_hash, pass_salt, role, name) VALUES (?,?,?, 'staff', 'Administrator')")
    .run(username, hash, salt);
  console.log(`  Seeded staff login →  username: ${username}  password: ${password}  (change it in Settings)`);
}

module.exports = { db, DB_PATH, hashPassword };
