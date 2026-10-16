import { h, icon, clear, store, fmtDateTime, fmtPct, pctClass, parseTs, download, toCsv, slug } from '../util.js';
import { api } from '../api.js';
import { toast, openModal, confirmDialog, busy, emptyState, loadingBlock } from '../ui.js';
import { lineChart } from '../charts.js';
import { errorCard } from './common.js';

const GOAL = 75;

export function renderRecordsTab(root, ctx) {
  let disposed = false;
  let subjects = [];
  let selected = store.get('attendo.recordsSubject', 'all');

  const filters = h('div', { class: 'filters' });
  const body = h('div', null, loadingBlock('Loading records...'));
  root.append(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'section-title' }, 'Attendance records')), filters, body));

  async function init() {
    try {
      subjects = await ctx.getSubjects();
      if (disposed) return;
      if (!subjects.length) {
        clear(body);
        body.append(emptyState('clipboard', 'No subjects yet', 'Create a subject and take attendance to see records here.'));
        return;
      }
      if (selected !== 'all' && !subjects.some((s) => String(s.subject_id) === String(selected))) selected = 'all';
      paintFilters();
      await load();
    } catch (e) {
      if (disposed) return;
      clear(body);
      body.append(errorCard(e.message, init));
    }
  }

  function paintFilters() {
    clear(filters);
    const select = h(
      'select',
      { class: 'input', id: 'rec-subject', 'aria-label': 'Subject' },
      h('option', { value: 'all', selected: selected === 'all' }, 'All subjects'),
      subjects.map((s) => h('option', { value: s.subject_id, selected: String(s.subject_id) === String(selected) }, `${s.name} - ${s.subject_code}`))
    );
    select.addEventListener('change', () => {
      selected = select.value;
      store.set('attendo.recordsSubject', selected);
      load();
    });
    filters.append(
      h('div', { class: 'field' }, h('label', { for: 'rec-subject' }, 'Subject'), select),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => exportCsv() }, icon('download'), 'Export CSV'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => window.print() }, icon('printer'), 'Print')
    );
  }

  let current = { sessions: [], roster: null };

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading records...'));
    try {
      const payload = selected === 'all' ? {} : { subject_id: selected };
      const [recs, roster] = await Promise.all([api('attendance-records', payload), selected === 'all' ? Promise.resolve(null) : api('subject-roster', { subject_id: selected })]);
      if (disposed) return;
      current = { sessions: recs.sessions, roster, subjects: recs.subjects };
      paint();
    } catch (e) {
      if (disposed) return;
      clear(body);
      body.append(errorCard(e.message, load));
    }
  }

  const subjectName = (id) => {
    const s = subjects.find((x) => String(x.subject_id) === String(id));
    return s ? `${s.name} (${s.subject_code})` : 'Subject';
  };

  function paint() {
    clear(body);
    const { sessions, roster } = current;
    if (!sessions.length) {
      body.append(emptyState('clipboard', 'No attendance saved yet', 'Take attendance from the first tab and it will show up here.'));
      return;
    }
    const present = sessions.reduce((n, s) => n + s.present, 0);
    const total = sessions.reduce((n, s) => n + s.total, 0);
    const avg = total ? (present / total) * 100 : null;
    const atRisk = roster ? roster.students.filter((s) => s.total >= 3 && s.percent != null && s.percent < GOAL).length : null;

    body.append(
      h(
        'div',
        { class: 'counter-row' },
        h('div', { class: 'counter' }, h('b', null, sessions.length), h('span', null, sessions.length === 1 ? 'Class held' : 'Classes held')),
        h('div', { class: 'counter ' + (avg != null && avg >= GOAL ? 'ok' : 'bad') }, h('b', null, fmtPct(avg)), h('span', null, 'Average attendance')),
        roster ? h('div', { class: 'counter' }, h('b', null, roster.students.length), h('span', null, 'Students')) : null,
        atRisk != null ? h('div', { class: 'counter ' + (atRisk ? 'bad' : 'ok') }, h('b', null, atRisk), h('span', null, `Below ${GOAL}%`)) : null
      )
    );

    if (selected !== 'all' && sessions.length >= 2) {
      const pts = [...sessions].reverse().map((s) => ({ ts: s.timestamp, value: s.total ? (s.present / s.total) * 100 : 0 }));
      body.append(h('h3', { style: { margin: '10px 0 6px' } }, 'Attendance trend'), h('div', { class: 'table-wrap', style: { padding: '12px' } }, lineChart(pts, { goal: GOAL })));
    }

    // Sessions
    const rows = sessions.map((s) => {
      const p = s.total ? (s.present / s.total) * 100 : 0;
      const del = h('button', { class: 'btn danger small', type: 'button', 'aria-label': 'Delete class record' }, icon('trash'));
      del.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Delete this class record?', message: `${fmtDateTime(s.timestamp)} for ${subjectName(s.subject_id)} will be removed for every student.`, confirmText: 'Delete', danger: true });
        if (!ok) return;
        await busy(del, async () => {
          try {
            await api('session-delete', { subject_id: s.subject_id, timestamp: s.timestamp });
            toast('Class record deleted.', 'ok');
            ctx.invalidate();
            await load();
          } catch (e) {
            toast(e.message, 'err');
          }
        });
      });
      return h(
        'tr',
        null,
        h('td', null, fmtDateTime(s.timestamp)),
        selected === 'all' ? h('td', null, subjectName(s.subject_id)) : null,
        h('td', { class: 'num' }, `${s.present}/${s.total}`),
        h('td', null, h('span', { class: `bar ${pctClass(p, GOAL)}` }, h('i', { style: { width: `${Math.min(100, p)}%` } })), ' ', fmtPct(p)),
        h('td', null, h('div', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn ghost small', type: 'button', onclick: () => sessionDialog(s) }, icon('pencil'), 'View / edit'), del))
      );
    });
    body.append(
      h('h3', { style: { margin: '18px 0 8px' } }, 'Classes'),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Date and time'), selected === 'all' ? h('th', null, 'Subject') : null, h('th', { class: 'num' }, 'Present'), h('th', null, 'Attendance'), h('th', null, ''))), h('tbody', null, rows)))
    );

    // Students
    if (roster && roster.students.length) {
      const sorted = [...roster.students].sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101));
      const srows = sorted.map((st) => {
        const cls = pctClass(st.percent, GOAL);
        return h(
          'tr',
          null,
          h('td', null, st.name),
          h('td', { class: 'num' }, `${st.attended}/${st.total}`),
          h('td', null, st.percent == null ? '-' : h('span', null, h('span', { class: `bar ${cls}` }, h('i', { style: { width: `${Math.min(100, st.percent)}%` } })), ' ', fmtPct(st.percent))),
          h('td', null, st.percent == null ? h('span', { class: 'status-chip mute' }, 'No data') : st.total < 3 ? h('span', { class: 'status-chip mute' }, 'Too early') : h('span', { class: `status-chip ${cls}` }, cls === 'ok' ? 'On track' : cls === 'warn' ? 'Watch' : 'At risk'))
        );
      });
      body.append(
        h('h3', { style: { margin: '22px 0 8px' } }, 'Students (lowest attendance first)'),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', { class: 'num' }, 'Present'), h('th', null, 'Attendance'), h('th', null, 'Status'))), h('tbody', null, srows)))
      );
    }
  }

  /* ----------------------------------------------------- session editor */
  async function sessionDialog(s) {
    const box = h('div', null, loadingBlock('Loading class...'));
    const saveBtn = h('button', { class: 'btn primary', type: 'button' }, icon('check'), 'Save changes');
    saveBtn.disabled = true;
    const m = openModal({ title: `${fmtDateTime(s.timestamp)}`, wide: true, body: box, footer: [saveBtn] });
    try {
      const data = await api('session-detail', { subject_id: s.subject_id, timestamp: s.timestamp });
      const original = new Map(data.entries.map((e) => [String(e.student_id), e.is_present]));
      const state = data.entries.map((e) => ({ ...e }));
      const dirty = () => state.some((e) => original.get(String(e.student_id)) !== e.is_present);
      const rows = state.map((e) => {
        const p = h('button', { type: 'button', class: 'p' }, 'Present');
        const a = h('button', { type: 'button', class: 'a' }, 'Absent');
        const paint = () => {
          p.setAttribute('aria-pressed', e.is_present ? 'true' : 'false');
          a.setAttribute('aria-pressed', e.is_present ? 'false' : 'true');
          saveBtn.disabled = !dirty();
        };
        p.addEventListener('click', () => { e.is_present = true; paint(); });
        a.addEventListener('click', () => { e.is_present = false; paint(); });
        paint();
        return h('tr', null, h('td', null, e.name), h('td', null, h('div', { class: 'toggle', role: 'group' }, p, a)));
      });
      saveBtn.disabled = true;
      clear(box);
      box.append(
        h('p', { class: 'hint', style: { marginBottom: '10px' } }, `${subjectName(s.subject_id)}. Fix any mistakes and save.`),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', null, 'Status'))), h('tbody', null, rows)))
      );
      saveBtn.addEventListener('click', () =>
        busy(saveBtn, async () => {
          try {
            const changed = state.filter((e) => original.get(String(e.student_id)) !== e.is_present);
            await api('session-update', { subject_id: s.subject_id, timestamp: s.timestamp, entries: changed.map((e) => ({ student_id: e.student_id, is_present: e.is_present })) });
            toast('Attendance updated.', 'ok');
            m.close();
            ctx.invalidate();
            await load();
          } catch (e) {
            toast(e.message, 'err');
          }
        })
      );
    } catch (e) {
      clear(box);
      box.append(errorCard(e.message));
    }
  }

  /* ------------------------------------------------------------- export */
  async function exportCsv() {
    try {
      if (selected === 'all') {
        const rows = [['Date and time', 'Subject', 'Present', 'Total', 'Attendance %']];
        current.sessions.forEach((s) => rows.push([fmtDateTime(s.timestamp), subjectName(s.subject_id), s.present, s.total, s.total ? Math.round((s.present / s.total) * 1000) / 10 : '']));
        if (rows.length === 1) return toast('Nothing to export yet.', 'err');
        download('attendance-sessions.csv', toCsv(rows));
        return;
      }
      const m = await api('subject-matrix', { subject_id: selected });
      if (!m.sessions.length) return toast('Nothing to export yet.', 'err');
      const head = ['Student', ...m.sessions.map((t) => fmtDateTime(t)), 'Present', 'Total', 'Attendance %'];
      const rows = [head];
      m.students.forEach((st) => {
        const present = st.marks.filter((x) => x === 1).length;
        const total = st.marks.filter((x) => x !== null).length;
        rows.push([st.name, ...st.marks.map((x) => (x === 1 ? 'P' : x === 0 ? 'A' : '-')), present, total, total ? Math.round((present / total) * 1000) / 10 : '']);
      });
      download(`attendance-${slug(m.subject.subject_code)}.csv`, toCsv(rows));
      toast('CSV downloaded.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  init();
  return () => {
    disposed = true;
  };
}

export { parseTs };
