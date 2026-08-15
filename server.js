'use strict';

// NVOCC CRM — zero-dependency backend (Node built-in http + node:sqlite + node:crypto)
// Run:  node server.js      (needs Node.js 22.5+)

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');
const { priceItem, totalsFor } = require('./pricing');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
// Only these files are served to the browser (keeps server source private).
const STATIC_FILES = new Set(['/index.html', '/barcode.js']);

/* ----------------------------- helpers ----------------------------- */
function sendJSON(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5_000_000) reject(new Error('Body too large')); });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  if (!STATIC_FILES.has(rel)) { res.writeHead(404); return res.end('Not found'); }
  const filePath = path.join(__dirname, rel);
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}
function transaction(fn) {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

/* --------------------------- data access --------------------------- */
const CLIENT_COLS = ['name', 'phone', 'email', 'id_number', 'address', 'city', 'country', 'notes'];
const SHIP_COLS = [
  'client_id', 'owner_client_id', 'created_by', 'shipper_name', 'shipper_phone', 'shipper_email', 'shipper_id', 'from_address',
  'consignee_name', 'consignee_phone', 'consignee_email', 'consignee_id', 'to_address',
  'bl_number', 'pickup_date', 'ship_date', 'dest_port', 'carrier', 'vessel', 'container_number', 'status', 'notes',
];
const ITEM_COLS = [
  'item_type', 'description', 'quantity', 'length', 'width', 'height', 'dim_unit',
  'weight', 'weight_unit', 'declared_value', 'pricing_mode', 'rate', 'volume_each', 'volume_unit', 'line_charge', 'sort_order',
];
function pick(obj, cols) { const o = {}; for (const c of cols) o[c] = obj[c] === undefined ? null : obj[c]; return o; }
function insertRow(table, cols, data) {
  const row = pick(data, cols);
  return db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(row);
}
function saveShipmentItems(shipmentId, rawItems) {
  const priced = (rawItems || []).map((it, i) => priceItem({ ...it, sort_order: it.sort_order ?? i }));
  const totals = totalsFor(priced);
  db.prepare('DELETE FROM items WHERE shipment_id = ?').run(shipmentId);
  const ins = db.prepare(`INSERT INTO items (shipment_id, ${ITEM_COLS.join(',')}) VALUES (@shipment_id, ${ITEM_COLS.map(c => '@' + c).join(',')})`);
  for (const it of priced) ins.run({ shipment_id: shipmentId, ...pick(it, ITEM_COLS) });
  db.prepare(`UPDATE shipments SET total_pieces=@total_pieces, total_weight=@total_weight, total_value=@total_value,
     total_charge=@total_charge, updated_at=datetime('now') WHERE id=@id`).run({ id: shipmentId, ...totals });
  return totals;
}
function getShipment(id) {
  const s = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id);
  if (!s) return null;
  s.items = db.prepare('SELECT * FROM items WHERE shipment_id = ? ORDER BY sort_order, id').all(id);
  return s;
}

/* ------------------------------ routes ----------------------------- */
async function api(req, res, pathname, method) {
  const seg = pathname.replace(/^\/api\//, '').split('/').filter(Boolean);
  const resource = seg[0];
  const id = seg[1] ? Number(seg[1]) : null;
  const body = (method === 'POST' || method === 'PUT') ? await readBody(req) : {};
  const cookies = auth.parseCookies(req);
  const me = auth.userForToken(cookies.sid);

  /* -------- public auth endpoints -------- */
  if (resource === 'me' && method === 'GET') {
    if (!me) return sendJSON(res, 200, { user: null });
    const client = me.client_id ? db.prepare('SELECT * FROM clients WHERE id=?').get(me.client_id) : null;
    return sendJSON(res, 200, { user: me, client });
  }
  if (resource === 'login' && method === 'POST') {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(body.username || '').trim());
    if (!u || !auth.verifyPassword(body.password || '', u.pass_salt, u.pass_hash))
      return sendJSON(res, 401, { error: 'Wrong username or password' });
    const token = auth.createSession(u.id);
    return sendJSON(res, 200, { user: { id: u.id, username: u.username, role: u.role, name: u.name, client_id: u.client_id } },
      { 'Set-Cookie': auth.cookieHeader(token) });
  }
  if (resource === 'register' && method === 'POST') {
    if (!body.username || !body.password) return sendJSON(res, 400, { error: 'Username and password are required' });
    if (String(body.password).length < 6) return sendJSON(res, 400, { error: 'Password must be at least 6 characters' });
    try {
      const { userId } = auth.registerCustomer(body);
      const token = auth.createSession(userId);
      const u = db.prepare('SELECT id, username, role, name, client_id FROM users WHERE id=?').get(userId);
      return sendJSON(res, 201, { user: u }, { 'Set-Cookie': auth.cookieHeader(token) });
    } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  }
  if (resource === 'logout' && method === 'POST') {
    auth.destroySession(cookies.sid);
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader('', true) });
  }

  /* -------- everything below requires login -------- */
  if (!me) return sendJSON(res, 401, { error: 'Please sign in' });
  const isStaff = me.role === 'staff';
  const ownFilter = me.client_id; // customer's client id

  /* change own password */
  if (resource === 'password' && method === 'PUT') {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(me.id);
    if (!auth.verifyPassword(body.current || '', u.pass_salt, u.pass_hash))
      return sendJSON(res, 400, { error: 'Current password is incorrect' });
    if (String(body.next || '').length < 6) return sendJSON(res, 400, { error: 'New password must be at least 6 characters' });
    const { hash, salt } = auth.hashPassword(body.next);
    db.prepare('UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?').run(hash, salt, me.id);
    return sendJSON(res, 200, { ok: true });
  }

  /* staff: manage user accounts */
  if (resource === 'users') {
    if (!isStaff) return sendJSON(res, 403, { error: 'Staff only' });
    if (method === 'GET') return sendJSON(res, 200, db.prepare(
      `SELECT u.id,u.username,u.role,u.name,u.client_id,u.created_at, c.name AS client_name
       FROM users u LEFT JOIN clients c ON c.id=u.client_id ORDER BY u.role, u.username`).all());
    if (method === 'POST') {
      if (!body.username || !body.password) return sendJSON(res, 400, { error: 'Username and password required' });
      const dup = db.prepare('SELECT id FROM users WHERE username=?').get(body.username);
      if (dup) return sendJSON(res, 400, { error: 'Username already taken' });
      const { hash, salt } = auth.hashPassword(body.password);
      const role = body.role === 'staff' ? 'staff' : 'customer';
      let clientId = body.client_id || null;
      if (role === 'customer' && !clientId) {
        clientId = db.prepare('INSERT INTO clients (name,phone,email) VALUES (?,?,?)').run(body.name || body.username, body.phone ?? null, body.email ?? null).lastInsertRowid;
      }
      const uid = db.prepare('INSERT INTO users (username,pass_hash,pass_salt,role,name,client_id) VALUES (?,?,?,?,?,?)')
        .run(body.username, hash, salt, role, body.name || body.username, clientId).lastInsertRowid;
      return sendJSON(res, 201, db.prepare('SELECT id,username,role,name,client_id FROM users WHERE id=?').get(uid));
    }
    if (method === 'DELETE' && id) {
      if (id === me.id) return sendJSON(res, 400, { error: 'You cannot delete your own account' });
      db.prepare('DELETE FROM users WHERE id=?').run(id);
      return sendJSON(res, 200, { ok: true });
    }
  }

  /* settings */
  if (resource === 'settings') {
    if (method === 'GET') return sendJSON(res, 200, db.prepare('SELECT * FROM settings WHERE id=1').get());
    if (method === 'PUT') {
      if (!isStaff) return sendJSON(res, 403, { error: 'Staff only' });
      db.prepare('UPDATE settings SET default_barrel_rate=@a, default_volume_rate=@b, currency=@c WHERE id=1')
        .run({ a: Number(body.default_barrel_rate) || 0, b: Number(body.default_volume_rate) || 0, c: body.currency || 'USD' });
      return sendJSON(res, 200, db.prepare('SELECT * FROM settings WHERE id=1').get());
    }
  }

  /* stats */
  if (resource === 'stats' && method === 'GET') {
    if (isStaff) {
      return sendJSON(res, 200, db.prepare(`SELECT
        (SELECT COUNT(*) FROM clients) AS clients,
        (SELECT COUNT(*) FROM shipments) AS shipments,
        (SELECT COALESCE(SUM(total_pieces),0) FROM shipments) AS pieces,
        (SELECT COALESCE(SUM(total_charge),0) FROM shipments) AS revenue`).get());
    }
    return sendJSON(res, 200, db.prepare(`SELECT
      1 AS clients,
      (SELECT COUNT(*) FROM shipments WHERE owner_client_id=@c) AS shipments,
      (SELECT COALESCE(SUM(total_pieces),0) FROM shipments WHERE owner_client_id=@c) AS pieces,
      (SELECT COALESCE(SUM(total_charge),0) FROM shipments WHERE owner_client_id=@c) AS revenue`).get({ c: ownFilter }));
  }

  /* clients (staff only, except own record) */
  if (resource === 'clients') {
    if (!isStaff) {
      if (method === 'GET' && id && id === ownFilter) return sendJSON(res, 200, db.prepare('SELECT * FROM clients WHERE id=?').get(id));
      if (method === 'PUT' && id && id === ownFilter) {
        db.prepare(`UPDATE clients SET ${CLIENT_COLS.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...pick(body, CLIENT_COLS), id });
        return sendJSON(res, 200, db.prepare('SELECT * FROM clients WHERE id=?').get(id));
      }
      return sendJSON(res, 403, { error: 'Staff only' });
    }
    if (method === 'GET' && !id) {
      const q = new URL(req.url, 'http://x').searchParams.get('q');
      if (q) { const l = `%${q}%`; return sendJSON(res, 200, db.prepare('SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR id_number LIKE ? ORDER BY name').all(l, l, l, l)); }
      return sendJSON(res, 200, db.prepare('SELECT * FROM clients ORDER BY name').all());
    }
    if (method === 'GET' && id) { const c = db.prepare('SELECT * FROM clients WHERE id=?').get(id); return c ? sendJSON(res, 200, c) : sendJSON(res, 404, { error: 'Not found' }); }
    if (method === 'POST') { if (!body.name) return sendJSON(res, 400, { error: 'Client name is required' }); const r = insertRow('clients', CLIENT_COLS, body); return sendJSON(res, 201, db.prepare('SELECT * FROM clients WHERE id=?').get(r.lastInsertRowid)); }
    if (method === 'PUT' && id) { db.prepare(`UPDATE clients SET ${CLIENT_COLS.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...pick(body, CLIENT_COLS), id }); return sendJSON(res, 200, db.prepare('SELECT * FROM clients WHERE id=?').get(id)); }
    if (method === 'DELETE' && id) { db.prepare('DELETE FROM clients WHERE id=?').run(id); return sendJSON(res, 200, { ok: true }); }
  }

  /* shipments */
  if (resource === 'shipments') {
    // ownership guard for single-record ops
    const canSee = (s) => isStaff || (s && s.owner_client_id === ownFilter);

    if (method === 'GET' && !id) {
      const rows = isStaff
        ? db.prepare(`SELECT s.*, c.name AS client_name FROM shipments s LEFT JOIN clients c ON c.id=s.client_id ORDER BY s.created_at DESC, s.id DESC`).all()
        : db.prepare(`SELECT s.*, c.name AS client_name FROM shipments s LEFT JOIN clients c ON c.id=s.client_id WHERE s.owner_client_id=? ORDER BY s.created_at DESC, s.id DESC`).all(ownFilter);
      return sendJSON(res, 200, rows);
    }
    if (method === 'GET' && id) { const s = getShipment(id); if (!s) return sendJSON(res, 404, { error: 'Not found' }); if (!canSee(s)) return sendJSON(res, 403, { error: 'Not allowed' }); return sendJSON(res, 200, s); }
    if (method === 'POST') {
      if (!body.status) body.status = 'Draft';
      body.created_by = me.id;
      if (!isStaff) body.owner_client_id = ownFilter;               // customers own their own
      else if (!body.owner_client_id) body.owner_client_id = body.client_id || null;
      const sid = transaction(() => {
        const r = insertRow('shipments', SHIP_COLS, body);
        const nid = r.lastInsertRowid;
        // Auto-generate a booking / BL number for the client if none was entered.
        if (!body.bl_number) db.prepare('UPDATE shipments SET bl_number=? WHERE id=?').run('NV' + String(nid).padStart(6, '0'), nid);
        saveShipmentItems(nid, body.items);
        return nid;
      });
      return sendJSON(res, 201, getShipment(sid));
    }
    if (method === 'PUT' && id) {
      const existing = db.prepare('SELECT * FROM shipments WHERE id=?').get(id);
      if (!existing) return sendJSON(res, 404, { error: 'Not found' });
      if (!canSee(existing)) return sendJSON(res, 403, { error: 'Not allowed' });
      if (!body.status) body.status = existing.status || 'Draft';
      // customers cannot reassign ownership or change status
      body.owner_client_id = existing.owner_client_id;
      body.created_by = existing.created_by;
      if (!isStaff) { body.status = existing.status; body.client_id = existing.client_id; }
      transaction(() => { db.prepare(`UPDATE shipments SET ${SHIP_COLS.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...pick(body, SHIP_COLS), id }); saveShipmentItems(id, body.items); });
      return sendJSON(res, 200, getShipment(id));
    }
    if (method === 'DELETE' && id) {
      const existing = db.prepare('SELECT * FROM shipments WHERE id=?').get(id);
      if (!existing) return sendJSON(res, 404, { error: 'Not found' });
      if (!canSee(existing)) return sendJSON(res, 403, { error: 'Not allowed' });
      db.prepare('DELETE FROM shipments WHERE id=?').run(id);
      return sendJSON(res, 200, { ok: true });
    }
  }

  return sendJSON(res, 404, { error: 'Unknown endpoint' });
}

/* ------------------------------ server ----------------------------- */
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (pathname.startsWith('/api/')) return await api(req, res, pathname, req.method);
    return serveStatic(req, res, pathname);
  } catch (err) { sendJSON(res, 400, { error: err.message || 'Server error' }); }
});
server.listen(PORT, () => {
  console.log(`\n  NVOCC CRM running →  http://localhost:${PORT}\n  Database: ${require('./db').DB_PATH}\n  Press Ctrl+C to stop.\n`);
});
