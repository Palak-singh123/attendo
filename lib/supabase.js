'use strict';
/**
 * Tiny Supabase (PostgREST) client built on fetch.
 * No SDK needed -> fewer dependencies -> fewer deploy errors.
 *
 * Env vars (set in Vercel -> Project -> Settings -> Environment Variables):
 *   SUPABASE_URL           https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY   service_role key (server only, never sent to browser)
 *                          (SUPABASE_KEY is also accepted so your old secret name works)
 */

class DbError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.name = 'DbError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Forgive common copy/paste mistakes in SUPABASE_URL. */
function normalizeUrl(raw) {
  let u = String(raw || '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!u) return '';
  if (/^[a-z0-9]{15,30}$/i.test(u)) u = `https://${u}.supabase.co`; // only the project ref was pasted
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).origin; // drops paths like /rest/v1 or trailing slashes
  } catch (_) {
    return u.replace(/\/+$/, '');
  }
}

function cfg() {
  const url = normalizeUrl(process.env.SUPABASE_URL);
  const key = String(
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || ''
  )
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
  return { url, key };
}

function hostOf() {
  try {
    return new URL(cfg().url).host;
  } catch (_) {
    return '';
  }
}

function isConfigured() {
  const { url, key } = cfg();
  return Boolean(url && key);
}

/** Only allow plain ids inside filters (prevents filter injection). */
function safeId(value) {
  const s = String(value);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) {
    throw new DbError('Invalid id', 400, 'bad_id');
  }
  return s;
}

function inList(values) {
  const list = [...new Set(values.map(safeId))];
  return `in.(${list.join(',')})`;
}

async function rest(table, opts = {}) {
  const { url, key } = cfg();
  if (!url || !key) {
    throw new DbError(
      'Server is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_KEY in Vercel environment variables.',
      500,
      'not_configured'
    );
  }
  const { method = 'GET', params, body, prefer } = opts;
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;

  let res;
  try {
    res = await fetch(`${url}/rest/v1/${table}${qs}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || 'unknown';
    throw new DbError(`Could not reach the database at "${hostOf() || 'EMPTY'}" (${why}). Check SUPABASE_URL.`, 502, 'network', String(why));
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Database error (${res.status})`;
    throw new DbError(msg, res.status, data && data.code, data && (data.details || data.hint));
  }
  return data;
}

/** Fetch every row (Supabase caps a single response at 1000 rows). */
async function selectAll(table, params, orderBy) {
  const pageSize = 1000;
  const out = [];
  for (let offset = 0; offset < 200000; offset += pageSize) {
    const page = await rest(table, {
      params: { ...params, order: orderBy, limit: String(pageSize), offset: String(offset) },
    });
    if (!Array.isArray(page)) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

const select = (table, params) => rest(table, { params });
const insert = (table, rows) =>
  rest(table, { method: 'POST', body: rows, prefer: 'return=representation' });
const update = (table, params, patch) =>
  rest(table, { method: 'PATCH', params, body: patch, prefer: 'return=representation' });
const remove = (table, params) =>
  rest(table, { method: 'DELETE', params, prefer: 'return=representation' });

module.exports = { DbError, hostOf, isConfigured, safeId, inList, rest, selectAll, select, insert, update, remove };
