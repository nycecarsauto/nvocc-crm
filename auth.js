'use strict';

// Authentication helpers — sessions in SQLite, scrypt password hashing.
const crypto = require('node:crypto');
const { db, hashPassword } = require('./db');

const SESSION_DAYS = 30;

function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  // constant-time compare
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expires);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function userForToken(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) { destroySession(token); return null; }
  const u = db.prepare('SELECT id, username, role, name, client_id FROM users WHERE id = ?').get(s.user_id);
  return u || null;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(token, clear = false) {
  const base = `sid=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax`;
  return clear ? `${base}; Max-Age=0` : `${base}; Max-Age=${SESSION_DAYS * 86400}`;
}

// Registers a customer (self-signup): creates a client record + a user login.
function registerCustomer({ username, password, name, phone, email, id_number, address, city, country }) {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) throw new Error('That username is already taken');
  const nn = (v) => (v === undefined || v === '' ? null : v);
  const info = db.prepare(
    'INSERT INTO clients (name, phone, email, id_number, address, city, country) VALUES (?,?,?,?,?,?,?)'
  ).run(name || username, nn(phone), nn(email), nn(id_number), nn(address), nn(city), nn(country));
  const clientId = info.lastInsertRowid;
  const { hash, salt } = hashPassword(password);
  const uinfo = db.prepare(
    "INSERT INTO users (username, pass_hash, pass_salt, role, name, client_id) VALUES (?,?,?, 'customer', ?, ?)"
  ).run(username, hash, salt, name || username, clientId);
  return { userId: uinfo.lastInsertRowid, clientId };
}

module.exports = {
  verifyPassword, createSession, destroySession, userForToken,
  parseCookies, cookieHeader, registerCustomer, hashPassword,
};
