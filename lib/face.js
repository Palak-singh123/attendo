'use strict';
/**
 * Face matching on 128-d descriptors produced in the browser by face-api.js.
 * Matching happens on the server so stored face data never reaches any browser.
 */

const DIM = 128;

function euclid(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Validate + round one descriptor. Returns number[128] or null. */
function sanitize(d) {
  if (!d || typeof d !== 'object' || d.length !== DIM) return null;
  const out = new Array(DIM);
  for (let i = 0; i < DIM; i++) {
    const n = Number(d[i]);
    if (!Number.isFinite(n) || Math.abs(n) > 10) return null;
    out[i] = Math.round(n * 1e5) / 1e5;
  }
  return out;
}

/** Stored value -> array of descriptors. Accepts [[..],[..]] or [..] or JSON string. */
function parseStored(value) {
  if (value == null) return [];
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(v) || v.length === 0) return [];
  if (typeof v[0] === 'number') {
    const one = sanitize(v);
    return one ? [one] : [];
  }
  const out = [];
  for (const item of v) {
    const s = sanitize(item);
    if (s) out.push(s);
  }
  return out;
}

function minDistance(query, samples) {
  let best = Infinity;
  for (const s of samples) {
    const d = euclid(query, s);
    if (d < best) best = d;
  }
  return best;
}

/**
 * candidates: [{ student_id, name, samples: number[128][] }]
 * Returns { best, distance, runnerUp } where best may be null if nothing is close enough.
 */
function matchOne(query, candidates, { threshold = 0.5, margin = 0.04 } = {}) {
  let best = null;
  let bestD = Infinity;
  let second = Infinity;
  for (const c of candidates) {
    const d = minDistance(query, c.samples);
    if (d < bestD) {
      second = bestD;
      bestD = d;
      best = c;
    } else if (d < second) {
      second = d;
    }
  }
  if (!best || bestD > threshold) return { best: null, distance: bestD, runnerUp: second };
  if (second !== Infinity && second - bestD < margin) {
    // Two different people look almost equally similar: too risky to decide.
    return { best: null, distance: bestD, runnerUp: second, ambiguous: true };
  }
  return { best, distance: bestD, runnerUp: second };
}

/** Distance -> friendly 0-100 score for the UI. */
function score(distance) {
  if (!Number.isFinite(distance)) return 0;
  const s = 1 - Math.pow(distance / 0.9, 2);
  return Math.max(0, Math.min(100, Math.round(s * 100)));
}

module.exports = { DIM, euclid, sanitize, parseStored, minDistance, matchOne, score };
