'use strict';
const crypto = require('crypto');

let bcrypt = null;
try {
  // Listed in package.json. Compatible with hashes created by the old Python (bcrypt) app.
  bcrypt = require('bcryptjs');
} catch (_) {
  bcrypt = null;
}

/* ---------------------------------------------------------------- tokens */

function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Fallback so a missing SESSION_SECRET never breaks the app.
  const base =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    'attendo-dev-secret';
  return crypto.createHash('sha256').update('attendo-session:' + base).digest('hex');
}

function sign(payload, ttlSeconds) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || token.length > 2000) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

/* ------------------------------------------------------------- passwords */

function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

function scryptVerify(password, stored) {
  const [, saltHex, hashHex] = stored.split('$');
  if (!saltHex || !hashHex) return false;
  const dk = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const want = Buffer.from(hashHex, 'hex');
  return dk.length === want.length && crypto.timingSafeEqual(dk, want);
}

async function hashPassword(password) {
  if (bcrypt) return bcrypt.hash(password, 10);
  return scryptHash(password);
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  try {
    if (stored.startsWith('scrypt$')) return scryptVerify(password, stored);
    if (stored.startsWith('$2')) {
      if (!bcrypt) return false;
      return await bcrypt.compare(password, stored);
    }
  } catch (_) {
    return false;
  }
  return false;
}

/* ---------------------------------------------------------- rate limiting */
// Best-effort, per serverless instance. Enough to slow down password guessing.

const buckets = new Map();

function tooMany(key, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) return false;
  return b.count >= limit;
}

function recordFailure(key, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) buckets.set(key, { count: 1, reset: now + windowMs });
  else b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }
}

function clearFailures(key) {
  buckets.delete(key);
}

module.exports = {
  sign,
  verify,
  hashPassword,
  verifyPassword,
  tooMany,
  recordFailure,
  clearFailures,
  hasBcrypt: () => Boolean(bcrypt),
};
