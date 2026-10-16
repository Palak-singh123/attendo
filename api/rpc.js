'use strict';
/**
 * Single serverless endpoint:  POST /api/rpc   { "action": "...", ...payload }
 * One function keeps you far below Vercel's free-plan function limit.
 */
const { handle, ApiError } = require('../lib/handlers');
const { DbError } = require('../lib/supabase');

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  // Fallback: read the raw stream.
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 4_000_000) throw new ApiError(413, 'Request too large.');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    return {};
  }
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async (req, res) => {
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
      .split(',')[0]
      .trim();
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const ctx = { ip, token, user: null };

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      if (url.searchParams.get('action') === 'health') {
        return send(res, 200, await handle('health', {}, ctx));
      }
      return send(res, 200, { ok: true, service: 'attendo-api' });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

    const body = await readBody(req);
    const action = typeof body.action === 'string' ? body.action : '';
    if (!action) return send(res, 400, { error: 'Missing action.' });

    const result = await handle(action, body, ctx);
    return send(res, 200, result);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { error: e.message });
    if (e instanceof DbError) {
      console.error('DbError', e.status, e.code, e.message);
      return send(res, e.status >= 400 && e.status < 600 && e.status !== 401 ? Math.max(e.status, 400) : 500, {
        error: e.message,
      });
    }
    console.error('Unhandled error', e);
    return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
};
