// Voice attendance: the browser's speech recognition turns speech into text,
// then we look for each enrolled student's name in what was heard.

export function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export const LANGS = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'hi-IN', label: 'Hindi' },
];

/** Start listening. Returns { stop }. Calls onText(finalText, interimText) as speech comes in. */
export function listen({ lang = 'en-IN', onText, onError, onEnd }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;

  let finalText = '';
  let wantStop = false;
  let restarts = 0;

  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      // Keep a couple of alternatives: names are often mis-heard.
      const best = Array.from({ length: Math.min(r.length, 3) }, (_, k) => r[k].transcript).join(' ');
      if (r.isFinal) finalText += ' ' + best;
      else interim += ' ' + r[0].transcript;
    }
    onText(finalText.trim(), interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    wantStop = true;
    const map = {
      'not-allowed': 'Microphone access is blocked. Allow the microphone for this site and try again.',
      'service-not-allowed': 'Speech recognition is not allowed in this browser.',
      'audio-capture': 'No microphone was found.',
      network: 'Speech recognition needs an internet connection.',
    };
    onError(map[e.error] || 'Speech recognition error: ' + e.error);
  };
  rec.onend = () => {
    // Chrome stops after silence; keep going until the teacher presses Stop.
    if (!wantStop && restarts < 60) {
      restarts += 1;
      try {
        rec.start();
        return;
      } catch (_) { /* fall through */ }
    }
    onEnd();
  };

  try {
    rec.start();
  } catch (e) {
    onError('Could not start the microphone.');
  }
  return {
    stop() {
      wantStop = true;
      try {
        rec.stop();
      } catch (_) { /* ignore */ }
    },
  };
}

/* ---------------------------------------------------------- name matching */

const norm = (str) =>
  String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\u0900-\u097f\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function fuzzyHas(words, token) {
  const allow = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0;
  return words.some((w) => Math.abs(w.length - token.length) <= allow && lev(w, token) <= allow);
}

/**
 * roster: [{ student_id, name }]. Returns Map(student_id -> 'heard' | 'maybe').
 * 'maybe' = only a shared first name was heard, so we ask the teacher to confirm.
 */
export function matchNames(transcript, roster) {
  const words = norm(transcript).split(' ').filter(Boolean);
  const result = new Map();
  if (!words.length) return result;

  const tokens = roster.map((r) => ({ r, parts: norm(r.name).split(' ').filter((t) => t.length >= 2) }));
  const firstCount = new Map();
  for (const t of tokens) {
    const f = t.parts[0];
    if (f) firstCount.set(f, (firstCount.get(f) || 0) + 1);
  }

  for (const { r, parts } of tokens) {
    if (!parts.length) continue;
    const allHeard = parts.every((p) => fuzzyHas(words, p));
    if (allHeard && parts.length > 1) {
      result.set(r.student_id, 'heard');
      continue;
    }
    if (fuzzyHas(words, parts[0])) {
      const shared = (firstCount.get(parts[0]) || 0) > 1;
      const lastHeard = parts.length > 1 && fuzzyHas(words, parts[parts.length - 1]);
      if (!shared || lastHeard) result.set(r.student_id, 'heard');
      else result.set(r.student_id, 'maybe');
    }
  }
  return result;
}
