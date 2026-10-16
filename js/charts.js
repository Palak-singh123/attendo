// Tiny SVG charts (no libraries).
import { fmtShort } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Circular progress ring. Returns a <div class="ring">. */
export function ring(percent, { size = 84, stroke = 9, label, color } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'ring';
  wrap.style.width = wrap.style.height = size + 'px';
  const r = (100 - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const col = color || (percent == null ? 'var(--line)' : percent >= 75 ? '#22c55e' : percent >= 60 ? '#f59e0b' : '#ef4444');
  const svg = s('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': label || (percent == null ? 'No data' : `${Math.round(p)} percent`) });
  svg.append(
    s('circle', { class: 'track', cx: 50, cy: 50, r, fill: 'none', 'stroke-width': stroke }),
    s('circle', {
      cx: 50, cy: 50, r, fill: 'none', stroke: col, 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': `${(c * p) / 100} ${c}`,
    })
  );
  const val = document.createElement('div');
  val.className = 'val';
  val.textContent = percent == null ? '-' : `${Math.round(p)}%`;
  wrap.append(svg, val);
  return wrap;
}

/**
 * Line chart of attendance % per class.
 * points: [{ ts, value }]  (value 0-100). goal: dashed target line.
 */
export function lineChart(points, { goal = 75, height = 200 } = {}) {
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 14, t: 12, b: 28 };
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Attendance percentage per class' });
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const y = (v) => pad.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

  for (const g of [0, 25, 50, 75, 100]) {
    svg.append(s('line', { class: 'axis', x1: pad.l, x2: W - pad.r, y1: y(g), y2: y(g) }));
    svg.append(s('text', { x: pad.l - 6, y: y(g) + 4, 'text-anchor': 'end' }, String(g)));
  }
  if (goal != null) svg.append(s('line', { class: 'goal', x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal) }));
  if (!points.length) return svg;

  const x = (i) => (points.length === 1 ? pad.l + iw / 2 : pad.l + (i / (points.length - 1)) * iw);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  svg.append(s('path', { class: 'area', d: `${d} L${x(points.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z` }));
  svg.append(s('path', { class: 'line', d }));

  const step = Math.max(1, Math.ceil(points.length / 7));
  points.forEach((p, i) => {
    const dot = s('circle', { class: 'pt', cx: x(i), cy: y(p.value), r: points.length > 40 ? 2.5 : 4.5 });
    dot.append(s('title', {}, `${fmtShort(p.ts)}: ${Math.round(p.value)}%`));
    svg.append(dot);
    if (i % step === 0 || i === points.length - 1) {
      svg.append(s('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, fmtShort(p.ts)));
    }
  });
  return svg;
}
