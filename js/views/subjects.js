import { h, icon, clear, fmtPct, fmtDateTime, pctClass } from '../util.js';
import { api } from '../api.js';
import { toast, openModal, confirmDialog, busy, emptyState, loadingBlock } from '../ui.js';
import { errorCard } from './common.js';

export function renderSubjectsTab(root, ctx) {
  let disposed = false;
  const list = h('div');
  root.append(
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'section-title' }, 'Manage subjects'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => createDialog() }, icon('plus'), 'Create new subject')
    ),
    h('hr', { class: 'divider' }),
    list
  );

  async function load(force = false) {
    clear(list);
    list.append(loadingBlock('Loading subjects...'));
    try {
      const subjects = await ctx.getSubjects(force);
      if (disposed) return;
      clear(list);
      if (!subjects.length) {
        list.append(
          h('div', { class: 'card' }, emptyState('book', 'No subjects yet', 'Create your first subject, then share its code with students.', h('button', { class: 'btn primary', type: 'button', onclick: () => createDialog() }, icon('plus'), 'Create subject')))
        );
        return;
      }
      list.append(h('div', { class: 'grid-2' }, subjects.map(card)));
    } catch (e) {
      if (disposed) return;
      clear(list);
      list.append(errorCard(e.message, () => load(true)));
    }
  }

  function card(s) {
    const del = h('button', { class: 'btn danger small', type: 'button', title: 'Delete subject' }, icon('trash'), 'Delete');
    del.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Delete ${s.name}?`,
        message: 'This removes the subject, its student list and ALL its attendance records. This cannot be undone.',
        confirmText: 'Delete subject',
        danger: true,
      });
      if (!ok) return;
      await busy(del, async () => {
        try {
          await api('subject-delete', { subject_id: s.subject_id });
          toast('Subject deleted.', 'ok');
          ctx.invalidate();
          await load(true);
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    });
    return h(
      'div',
      { class: 'subject-card' },
      h('h3', null, s.name),
      h('div', { class: 'subject-meta' }, h('span', { class: 'code-chip' }, s.subject_code), h('span', null, `Section ${s.section}`)),
      h(
        'div',
        { class: 'stat-row' },
        h('span', { class: 'stat' }, '\ud83d\udc65 ', h('b', null, s.total_students), ' Students'),
        h('span', { class: 'stat' }, '\ud83d\udd70\ufe0f ', h('b', null, s.total_classes), ' Classes'),
        s.avg_attendance != null ? h('span', { class: 'stat' }, '\ud83d\udcc8 ', h('b', null, fmtPct(s.avg_attendance)), ' Avg') : null,
        s.at_risk ? h('span', { class: 'status-chip bad' }, `${s.at_risk} below 75%`) : null
      ),
      s.last_session ? h('p', { class: 'hint' }, `Last class: ${fmtDateTime(s.last_session)}`) : null,
      h(
        'div',
        { class: 'card-actions' },
        h('button', { class: 'btn primary small', type: 'button', onclick: () => shareDialog(s) }, icon('share'), 'Share code'),
        h('button', { class: 'btn secondary small', type: 'button', onclick: () => rosterDialog(s) }, icon('users'), 'Students'),
        del
      )
    );
  }

  /* ------------------------------------------------------------- create */
  function createDialog() {
    const code = h('input', { class: 'input', id: 'sc-code', placeholder: 'CS101', maxlength: 20, autocomplete: 'off' });
    const name = h('input', { class: 'input', id: 'sc-name', placeholder: 'Introduction to Computer Science', maxlength: 80, autocomplete: 'off' });
    const section = h('input', { class: 'input', id: 'sc-sec', placeholder: 'A', maxlength: 20, autocomplete: 'off' });
    const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'button' }, 'Create subject');
    const m = openModal({
      title: 'Create new subject',
      body: h(
        'div',
        null,
        err,
        h('div', { class: 'field' }, h('label', { for: 'sc-code' }, 'Subject code'), code, h('p', { class: 'hint' }, 'Students use this code to join. It must be unique.')),
        h('div', { class: 'field' }, h('label', { for: 'sc-name' }, 'Subject name'), name),
        h('div', { class: 'field' }, h('label', { for: 'sc-sec' }, 'Section'), section)
      ),
      footer: [btn],
    });
    const submit = async () => {
      err.hidden = true;
      if (!code.value.trim() || !name.value.trim() || !section.value.trim()) {
        err.textContent = 'Please fill in all the fields.';
        err.hidden = false;
        return;
      }
      await busy(btn, async () => {
        try {
          await api('subject-create', { subject_code: code.value, name: name.value, section: section.value });
          toast('Subject created!', 'ok');
          m.close();
          ctx.invalidate();
          await load(true);
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
        }
      });
    };
    btn.addEventListener('click', submit);
    [code, name, section].forEach((i) => i.addEventListener('keydown', (e) => e.key === 'Enter' && submit()));
    setTimeout(() => code.focus(), 50);
  }

  /* -------------------------------------------------------------- share */
  function loadQR() {
    if (window.QRCode) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('QR library unavailable'));
      document.head.append(s);
    });
  }

  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied.`, 'ok');
    } catch (_) {
      const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand('copy');
        toast(`${label} copied.`, 'ok');
      } catch (e) {
        toast('Copy failed. Select the text and copy it manually.', 'err');
      }
      ta.remove();
    }
  }

  function shareDialog(s) {
    const link = `${location.origin}/?join=${encodeURIComponent(s.subject_code)}`;
    const message = `Join ${s.name} on Attendo. Use code ${s.subject_code} or open: ${link}`;
    const qr = h('div', { class: 'qr-box' }, h('span', { class: 'spin', style: { color: '#6c63ff' } }));
    const row = (text, label) =>
      h('div', { class: 'copy-line' }, h('code', null, text), h('button', { class: 'btn ghost small', type: 'button', onclick: () => copy(text, label) }, icon('copy'), 'Copy'));

    const actions = [h('a', { class: 'btn secondary', href: `https://wa.me/?text=${encodeURIComponent(message)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Share on WhatsApp')];
    if (navigator.share) {
      actions.unshift(h('button', { class: 'btn primary', type: 'button', onclick: () => navigator.share({ title: s.name, text: message, url: link }).catch(() => {}) }, icon('share'), 'Share...'));
    }
    openModal({
      title: `Share ${s.name}`,
      body: h('div', null, h('p', { class: 'label' }, 'Subject code'), row(s.subject_code, 'Code'), h('p', { class: 'label' }, 'Join link'), row(link, 'Link'), h('p', { class: 'label' }, 'Scan to join'), qr),
      footer: actions,
    });
    loadQR()
      .then(() => {
        clear(qr);
        // eslint-disable-next-line no-undef
        new QRCode(qr, { text: link, width: 200, height: 200, colorDark: '#18245c', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      })
      .catch(() => {
        clear(qr);
        qr.append(h('p', { class: 'hint' }, 'QR code could not load. Share the link or code instead.'));
      });
  }

  /* ------------------------------------------------------------- roster */
  async function rosterDialog(s) {
    const body = h('div', null, loadingBlock('Loading students...'));
    const m = openModal({ title: `${s.name} - students`, body, wide: true });
    const render = async () => {
      try {
        const data = await api('subject-roster', { subject_id: s.subject_id });
        clear(body);
        if (!data.students.length) {
          body.append(emptyState('users', 'No students yet', `Share the code ${s.subject_code} so students can join.`));
          return;
        }
        const noFace = data.students.filter((x) => !x.has_face).length;
        if (noFace) body.append(h('div', { class: 'banner warn', style: { marginBottom: '12px' } }, h('span', null, `${noFace} student${noFace === 1 ? ' has' : 's have'} no face profile yet, so face attendance cannot detect ${noFace === 1 ? 'them' : 'them'}. They need to log in once with FaceID.`)));
        const rows = data.students.map((st) => {
          const rm = h('button', { class: 'btn danger small', type: 'button', 'aria-label': `Remove ${st.name}` }, icon('x'));
          rm.addEventListener('click', async () => {
            const ok = await confirmDialog({ title: `Remove ${st.name}?`, message: 'They will be removed from this subject. Past attendance stays in the records.', confirmText: 'Remove', danger: true });
            if (!ok) return;
            await busy(rm, async () => {
              try {
                await api('subject-remove-student', { subject_id: s.subject_id, student_id: st.student_id });
                toast(`${st.name} removed.`, 'ok');
                ctx.invalidate();
                await render();
              } catch (e) {
                toast(e.message, 'err');
              }
            });
          });
          const cls = pctClass(st.percent);
          return h(
            'tr',
            null,
            h('td', null, st.name),
            h('td', { class: 'num' }, `${st.attended}/${st.total}`),
            h('td', null, st.percent == null ? '-' : h('span', null, h('span', { class: `bar ${cls}` }, h('i', { style: { width: `${Math.min(100, st.percent)}%` } })), ' ', fmtPct(st.percent))),
            h('td', null, st.has_face ? h('span', { class: 'status-chip ok' }, 'Face ready') : h('span', { class: 'status-chip warn' }, 'No face')),
            h('td', null, rm)
          );
        });
        body.append(
          h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Student'), h('th', { class: 'num' }, 'Present'), h('th', null, 'Attendance'), h('th', null, 'Face'), h('th', null, ''))), h('tbody', null, rows)))
        );
      } catch (e) {
        clear(body);
        body.append(errorCard(e.message, render));
      }
    };
    render();
    return m;
  }

  load();
  return () => {
    disposed = true;
  };
}
