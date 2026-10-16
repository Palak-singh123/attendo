import { h, icon, clear, toLocalInput, parseTs } from '../util.js';
import { api } from '../api.js';
import { toast, openModal, busy } from '../ui.js';

const COLORS = { matched: '#22c55e', not_enrolled: '#f59e0b', unknown: '#ef4444', duplicate: '#94a3b8' };

/** Draw boxes + names on a copy of the photo. */
function annotate(photo) {
  const src = photo.canvas;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  const lw = Math.max(2, src.width / 320);
  const fs = Math.max(12, Math.round(src.width / 62));
  g.lineWidth = lw;
  g.font = `600 ${fs}px Poppins, system-ui, sans-serif`;
  g.textBaseline = 'top';
  photo.faces.forEach((f, i) => {
    const m = photo.matches[i] || { status: 'unknown' };
    const color = COLORS[m.status] || COLORS.unknown;
    g.strokeStyle = color;
    g.strokeRect(f.box.x, f.box.y, f.box.w, f.box.h);
    let label = '';
    if (m.status === 'matched') label = m.name;
    else if (m.status === 'not_enrolled') label = `${m.name} (not in class)`;
    else if (m.status === 'unknown') label = '?';
    if (!label) return;
    const pad = Math.round(fs * 0.3);
    const tw = g.measureText(label).width + pad * 2;
    const th = fs + pad * 2;
    const ty = f.box.y - th >= 0 ? f.box.y - th : f.box.y + f.box.h;
    g.fillStyle = color;
    g.fillRect(f.box.x, ty, tw, th);
    g.fillStyle = '#fff';
    g.fillText(label, f.box.x + pad, ty + pad);
  });
  c.className = 'annot';
  c.setAttribute('role', 'img');
  c.setAttribute('aria-label', `Photo with ${photo.faces.length} detected face${photo.faces.length === 1 ? '' : 's'}`);
  return c;
}

/**
 * rows: [{ student_id, name, present, score?, photos?, has_face?, note? }]
 * photos: [{ canvas, faces, matches }]   (face attendance only)
 */
export function openReview({ subject, rows, photos = [], source = 'manual', onSaved }) {
  const state = rows.map((r) => ({ ...r }));
  let touched = false;

  /* ---- counters */
  const cPresent = h('b', null, '0');
  const cAbsent = h('b', null, '0');
  const counters = h(
    'div',
    { class: 'counter-row' },
    h('div', { class: 'counter ok' }, cPresent, h('span', null, 'Present')),
    h('div', { class: 'counter bad' }, cAbsent, h('span', null, 'Absent'))
  );
  if (photos.length) {
    const faces = photos.reduce((n, p) => n + p.faces.length, 0);
    const unknown = photos.reduce((n, p) => n + p.matches.filter((m) => m.status === 'unknown' || m.status === 'not_enrolled').length, 0);
    counters.append(
      h('div', { class: 'counter' }, h('b', null, faces), h('span', null, 'Faces found')),
      h('div', { class: 'counter' }, h('b', null, unknown), h('span', null, 'Not matched'))
    );
  }

  /* ---- photo viewer */
  let photoBox = null;
  if (photos.length) {
    const view = h('div');
    const show = (i) => {
      clear(view);
      view.append(annotate(photos[i]));
      [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', j === i ? 'true' : 'false'));
    };
    const tabs = h('div', { class: 'seg', role: 'tablist' }, photos.map((_, i) => h('button', { type: 'button', role: 'tab', onclick: () => show(i) }, `Photo ${i + 1}`)));
    photoBox = h(
      'div',
      { style: { marginBottom: '14px' } },
      photos.length > 1 ? tabs : null,
      view,
      h(
        'div',
        { class: 'legend' },
        h('span', { style: { '--c': COLORS.matched } }, 'Recognised'),
        h('span', { style: { '--c': COLORS.not_enrolled } }, 'Other subject'),
        h('span', { style: { '--c': COLORS.unknown } }, 'Not recognised')
      )
    );
    show(0);
  }

  /* ---- table */
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search student', 'aria-label': 'Search student', style: { maxWidth: '260px', height: '40px' } });
  const rowEls = [];
  const tbody = h('tbody');
  state.forEach((r) => {
    const pBtn = h('button', { type: 'button', class: 'p' }, 'Present');
    const aBtn = h('button', { type: 'button', class: 'a' }, 'Absent');
    const paint = () => {
      pBtn.setAttribute('aria-pressed', r.present ? 'true' : 'false');
      aBtn.setAttribute('aria-pressed', r.present ? 'false' : 'true');
    };
    const set = (v) => {
      r.present = v;
      paint();
      recount();
    };
    pBtn.addEventListener('click', () => set(true));
    aBtn.addEventListener('click', () => set(false));
    paint();

    let info = '';
    if (source === 'face') {
      if (r.present) info = `${r.score}% match - photo ${r.photos.join(', ')}`;
      else if (r.has_face === false) info = 'No face profile yet';
      else info = 'Not seen in photos';
    } else if (r.note) info = r.note;
    const tr = h('tr', null, h('td', null, r.name), h('td', null, h('div', { class: 'toggle', role: 'group', 'aria-label': `Attendance for ${r.name}` }, pBtn, aBtn)), h('td', { class: 'hint' }, info));
    rowEls.push({ tr, name: r.name.toLowerCase() });
    tbody.append(tr);
  });
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    rowEls.forEach((x) => (x.tr.hidden = q && !x.name.includes(q)));
  });

  function recount() {
    const p = state.filter((r) => r.present).length;
    cPresent.textContent = p;
    cAbsent.textContent = state.length - p;
  }
  recount();

  const bulk = h(
    'div',
    { class: 'btn-row', style: { margin: '0 0 12px', alignItems: 'center' } },
    search,
    h('button', { class: 'btn ghost small', type: 'button', style: { flex: '0 0 auto' }, onclick: () => setAll(true) }, 'All present'),
    h('button', { class: 'btn ghost small', type: 'button', style: { flex: '0 0 auto' }, onclick: () => setAll(false) }, 'All absent')
  );
  function setAll(v) {
    state.forEach((r) => (r.present = v));
    [...tbody.querySelectorAll('tr')].forEach((tr, i) => {
      const [p, a] = tr.querySelectorAll('button');
      p.setAttribute('aria-pressed', state[i].present ? 'true' : 'false');
      a.setAttribute('aria-pressed', state[i].present ? 'false' : 'true');
    });
    recount();
  }

  /* ---- when */
  const when = h('input', { class: 'input', id: 'rv-when', type: 'datetime-local', value: toLocalInput(), max: toLocalInput() });
  when.addEventListener('input', () => (touched = true));
  const warn = h('div', { class: 'banner warn', hidden: true, style: { margin: '0 0 12px' } });

  const noFace = source === 'face' ? state.filter((r) => r.has_face === false).length : 0;

  const body = h(
    'div',
    null,
    warn,
    photoBox,
    counters,
    noFace ? h('p', { class: 'hint', style: { marginBottom: '10px' } }, `${noFace} student${noFace === 1 ? ' has' : 's have'} no face profile, so please mark them by hand if they are in class.`) : null,
    bulk,
    h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Status'), h('th', null, 'Details'))), tbody)),
    h('div', { class: 'field', style: { marginTop: '16px' } }, h('label', { for: 'rv-when' }, 'Class date and time'), when, h('p', { class: 'hint' }, 'Leave as it is to save for right now, or pick an earlier time to record a missed class.'))
  );

  const saveBtn = h('button', { class: 'btn primary', type: 'button' }, icon('check'), 'Confirm and save');
  const m = openModal({
    title: source === 'voice' ? 'Voice attendance - review' : source === 'face' ? 'Attendance report - review' : 'Mark attendance',
    wide: true,
    body,
    footer: [h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'Discard'), saveBtn],
  });

  // Gentle warning if attendance for this subject was already taken today.
  api('attendance-records', { subject_id: subject.subject_id })
    .then((res) => {
      const today = new Date().toDateString();
      const n = res.sessions.filter((s) => {
        const d = parseTs(s.timestamp);
        return d && d.toDateString() === today;
      }).length;
      if (n) {
        warn.textContent = `Attendance for ${subject.name} was already saved ${n} time${n === 1 ? '' : 's'} today. Save again only if this is a different class.`;
        warn.hidden = false;
      }
    })
    .catch(() => {});

  saveBtn.addEventListener('click', () =>
    busy(saveBtn, async () => {
      try {
        const payload = {
          subject_id: subject.subject_id,
          entries: state.map((r) => ({ student_id: r.student_id, is_present: r.present })),
        };
        if (touched && when.value) {
          const d = new Date(when.value);
          if (Number.isNaN(d.getTime())) throw new Error('Pick a valid date and time.');
          payload.timestamp = d.toISOString();
        }
        const res = await api('attendance-save', payload);
        toast(`Attendance saved: ${res.present} of ${res.saved} present.`, 'ok');
        m.close();
        if (onSaved) onSaved(res);
      } catch (e) {
        toast(e.message, 'err');
      }
    })
  );
  return m;
}
