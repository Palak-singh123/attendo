// Browser-side face recognition using face-api.js (@vladmandic fork).
// The library + model weights are fetched from a public CDN the first time they are needed
// and then cached by the browser. Matching happens on the server (lib/face.js).

import { h, sleep } from './util.js';

const VER = '1.7.12';
const BASES = [
  `https://cdn.jsdelivr.net/npm/@vladmandic/face-api@${VER}`,
  `https://unpkg.com/@vladmandic/face-api@${VER}`,
];

let libPromise = null;
const netPromises = new Map();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      s.remove();
      reject(new Error('Could not load ' + src));
    };
    document.head.append(s);
  });
}

async function loadLibrary() {
  if (window.faceapi) return window.faceapi;
  for (const base of BASES) {
    try {
      await loadScript(`${base}/dist/face-api.js`);
      if (window.faceapi) return window.faceapi;
    } catch (_) { /* try next CDN */ }
  }
  for (const base of BASES) {
    try {
      const mod = await import(/* webpackIgnore: true */ `${base}/dist/face-api.esm.js`);
      if (mod && mod.nets) return mod;
    } catch (_) { /* try next CDN */ }
  }
  throw new Error('Could not download the face recognition engine. Check your internet connection and try again.');
}

export function getFaceApi() {
  if (!libPromise) {
    libPromise = loadLibrary()
      .then(async (fa) => {
        if (fa.tf && typeof fa.tf.ready === 'function') await fa.tf.ready();
        return fa;
      })
      .catch((e) => {
        libPromise = null;
        throw e;
      });
  }
  return libPromise;
}

async function loadNet(fa, key) {
  if (!netPromises.has(key)) {
    const p = (async () => {
      let lastErr;
      for (const base of BASES) {
        try {
          await fa.nets[key].loadFromUri(`${base}/model/`);
          return;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('Could not download face model: ' + key);
    })();
    p.catch(() => netPromises.delete(key));
    netPromises.set(key, p);
  }
  return netPromises.get(key);
}

/**
 * kind: 'live'  -> fast detector for one person in front of a camera
 *       'group' -> accurate detector for classroom photos
 */
export async function ensureEngine(kind, onStatus = () => {}) {
  onStatus('Loading face engine (first time only)...');
  const fa = await getFaceApi();
  onStatus('Loading face models...');
  const detector = kind === 'group' ? 'ssdMobilenetv1' : 'tinyFaceDetector';
  await Promise.all([loadNet(fa, detector), loadNet(fa, 'faceLandmark68Net'), loadNet(fa, 'faceRecognitionNet')]);
  onStatus('');
  return fa;
}

/* ----------------------------------------------------------- detection */

function pack(r, dx = 0, dy = 0) {
  const b = r.detection.box;
  return {
    descriptor: Array.from(r.descriptor),
    box: { x: b.x + dx, y: b.y + dy, w: b.width, h: b.height },
    score: r.detection.score,
  };
}

/** Faces in a video frame / canvas, for login & registration. Drops far-away bystanders. */
export async function detectLive(input) {
  const fa = await ensureEngine('live');
  const opts = new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
  const res = await fa.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors();
  const faces = res.map((r) => pack(r));
  if (!faces.length) return [];
  const biggest = Math.max(...faces.map((f) => f.box.w));
  return faces.filter((f) => f.box.w >= biggest * 0.45);
}

function fitCanvas(source, maxSide) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return Math.max(union > 0 ? inter / union : 0, minArea > 0 ? (inter / minArea) * 0.8 : 0);
}

function nms(faces, limit = 0.4) {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of sorted) if (!kept.some((k) => iou(k.box, f.box) > limit)) kept.push(f);
  return kept;
}

/**
 * Find every face in a classroom photo (File/Blob-decoded <img> or <canvas>).
 * Scans the whole picture plus four overlapping zoomed-in tiles so small faces at the
 * back of the room are not missed.
 */
export async function detectGroup(source, onProgress = () => {}) {
  const fa = await ensureEngine('group', onProgress);
  const canvas = fitCanvas(source, 2000);
  const regions = [{ x: 0, y: 0, w: canvas.width, h: canvas.height }];
  if (Math.max(canvas.width, canvas.height) >= 900) {
    const tw = Math.round(canvas.width * 0.6);
    const th = Math.round(canvas.height * 0.6);
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      regions.push({ x: fx * (canvas.width - tw), y: fy * (canvas.height - th), w: tw, h: th });
    }
  }
  const opts = new fa.SsdMobilenetv1Options({ minConfidence: 0.45 });
  const all = [];
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    onProgress(`Scanning faces (${i + 1}/${regions.length})...`);
    let input = canvas;
    if (i > 0) {
      input = document.createElement('canvas');
      input.width = r.w;
      input.height = r.h;
      input.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    }
    const res = await fa.detectAllFaces(input, opts).withFaceLandmarks().withFaceDescriptors();
    for (const x of res) all.push(pack(x, r.x, r.y));
    await sleep(0);
  }
  const faces = nms(all).filter((f) => f.box.w >= 28 && f.box.h >= 28);
  return { faces, canvas };
}

/* ----------------------------------------------------------- camera widget */

function cameraError(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access is blocked. Allow the camera for this site in your browser settings, then tap "Try again".';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and tap "Try again".';
  return 'Could not start the camera. ' + ((e && e.message) || '');
}

export function createCamera({ facing = 'user', mirror = true, wide = false, guide = true } = {}) {
  const video = h('video', { autoplay: true, playsinline: true, muted: true, class: mirror ? 'mirror' : '' });
  video.muted = true;
  video.setAttribute('playsinline', '');
  const msg = h('div', { class: 'cam-msg' }, h('span', null, 'Starting camera...'));
  const flash = h('div', { class: 'flash' });
  const el = h('div', { class: 'camera' + (wide ? ' wide' : '') }, video, guide ? h('div', { class: 'guide' }, h('i')) : null, flash, msg);
  let stream = null;
  let currentFacing = facing;

  function showMsg(text, retry) {
    msg.replaceChildren(h('span', null, text));
    if (retry) msg.append(h('button', { class: 'btn secondary small', type: 'button', onclick: () => start() }, 'Try again'));
    msg.hidden = false;
  }

  async function start() {
    stop();
    msg.replaceChildren(h('span', null, 'Starting camera...'));
    msg.hidden = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMsg('Camera is not available here. Open Attendo over HTTPS in an up-to-date browser.');
      return false;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing, width: { ideal: wide ? 1920 : 1280 }, height: { ideal: wide ? 1080 : 720 } },
        audio: false,
      });
    } catch (e) {
      try {
        // Some devices reject constraints: retry with the simplest request.
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e2) {
        showMsg(cameraError(e2), true);
        return false;
      }
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch (_) { /* autoplay will start once visible */ }
    msg.hidden = true;
    return true;
  }

  function stop() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function isLive() {
    return Boolean(stream) && video.readyState >= 2 && video.videoWidth > 0;
  }

  function capture() {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    return c;
  }

  async function flip() {
    currentFacing = currentFacing === 'user' ? 'environment' : 'user';
    video.classList.toggle('mirror', currentFacing === 'user' && mirror);
    return start();
  }

  return { el, video, start, stop, isLive, capture, flip };
}

/**
 * Take `count` face samples from a live camera, ~0.7s apart. Needs exactly one face each time.
 * Returns an array of descriptors, or throws with a user-friendly message.
 */
export async function collectSamples(camera, count = 3, { onProgress = () => {}, onHint = () => {}, spacing = 700 } = {}) {
  const samples = [];
  let misses = 0;
  while (samples.length < count) {
    if (!camera.isLive()) throw new Error('The camera is not ready.');
    const frame = camera.capture();
    const faces = await detectLive(frame);
    if (faces.length === 1) {
      samples.push(faces[0].descriptor);
      misses = 0;
      onProgress(samples.length, count);
      if (samples.length < count) onHint('Great! Turn your head slightly and hold still...');
    } else {
      misses += 1;
      onHint(faces.length === 0 ? 'No face found. Look at the camera in good light.' : 'Only one person should be in the frame.');
      if (misses > 12) throw new Error('Could not get a clear photo of your face. Move to a brighter place and try again.');
    }
    await sleep(spacing);
  }
  return samples;
}
