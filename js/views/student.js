import { h, icon, clear, sleep, store, fmtDate, parseTs, pctClass, fmtPct } from '../util.js';
import { api, setSession, clearSession, getSession, isRole } from '../api.js';
import { toast, openModal, confirmDialog, busy, siteFooter, setPage, loadingBlock, emptyState } from '../ui.js';
import { createCamera, ensureEngine, detectLive, collectSamples } from '../face.js';
import { ring } from '../charts.js';
import { topbar, go, pendingJoin, setPendingJoin, errorCard } from './common.js';

export function renderStudent(root) {
  setPage('dash');
  clear(root);
  root.className = 'app';
  return isRole('student') ? renderDashboard(root) : renderLogin(root);
}

/* ================================================================== login */

function renderLogin(root) {
  let disposed = false;
  let mode = 'scan'; // scan | register
  let loopRunning = false;

  const cam = createCamera({ facing: 'user', mirror: true });
  const status = h('div', { class: 'cam-status', 'aria-live': 'polite' }, 'Starting camera...');
  const regHolder = h('div');
  const scanBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => startLoop() }, icon('scan'), 'Scan my face');
  const flipBtn = h('button', { class: 'btn ghost', type: 'button', onclick: () => cam.flip() }, icon('refresh'), 'Switch camera');

  const setStatus = (text, err = false) => {
    status.textContent = text;
    status.className = 'cam-status' + (err ? ' err' : '');
  };

  root.append(
    topbar({ right: [h('a', { class: 'btn primary', href: '#/' }, 'Go back to home')] }),
    h('h1', { class: 'page-title' }, 'Login with FaceID'),
    h('p', { class: 'page-sub' }, pendingJoin() ? `Log in to join ${pendingJoin()}.` : 'Look at the camera. New here? We will set up your profile.'),
    cam.el,
    status,
    h('div', { class: 'btn-row', style: { justifyContent: 'center', maxWidth: '560px', margin: '0 auto' } }, scanBtn, flipBtn),
    regHolder,
    siteFooter()
  );

  async function startLoop() {
    if (loopRunning || disposed) return;
    mode = 'scan';
    clear(regHolder);
    loopRunning = true;
    try {
      if (!cam.isLive()) {
        const ok = await cam.start();
        if (!ok) {
          setStatus('Camera unavailable. See the message on the camera above.', true);
          return;
        }
      }
      setStatus('Loading face recognition (first time only)...');
      try {
        await ensureEngine('live', (t) => t && setStatus(t));
      } catch (e) {
        setStatus(e.message, true);
        return;
      }
      setStatus('Looking for your face...');
      let stable = 0;
      let waited = 0;
      while (!disposed && mode === 'scan') {
        if (!cam.isLive()) {
          await sleep(300);
          continue;
        }
        const faces = await detectLive(cam.video);
        if (disposed) return;
        if (faces.length === 1) {
          stable += 1;
          setStatus('Hold still...');
          if (stable >= 2) {
            const done = await attemptLogin(faces[0]);
            if (done) return;
            stable = 0;
            return;
          }
        } else {
          stable = 0;
          setStatus(faces.length ? 'Only one person should be in the frame.' : 'Looking for your face...');
        }
        waited += 1;
        if (waited > 60) {
          setStatus('Still no face. Check the light, then tap "Scan my face".', true);
          return;
        }
        await sleep(450);
      }
    } finally {
      loopRunning = false;
    }
  }

  async function attemptLogin(face) {
    setStatus('Checking...');
    try {
      const res = await api('student-login', { descriptor: face.descriptor });
      if (res.matched) {
        setSession(res.token, res.user);
        toast(`Welcome back, ${res.user.name}!`, 'ok');
        go('#/student');
        return true;
      }
      mode = 'register';
      setStatus('We do not recognise this face yet. Create your profile below.');
      showRegister();
    } catch (e) {
      setStatus(e.message, true);
    }
    return false;
  }

  function showRegister() {
    clear(regHolder);
    const name = h('input', { class: 'input', id: 'sname', type: 'text', placeholder: 'E.g. Palak Singh', autocomplete: 'name', maxlength: 60 });
    const hint = h('p', { class: 'cam-status' });
    const dots = h('div', { class: 'samples', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
    const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, icon('check'), 'Create account');

    const form = h(
      'form',
      { class: 'card form-card', style: { marginTop: '20px' }, novalidate: true },
      h('h3', { style: { marginBottom: '14px' } }, 'Register new profile'),
      h('div', { class: 'field' }, h('label', { for: 'sname' }, 'Your name'), name),
      h('p', { class: 'hint', style: { marginBottom: '14px' } }, 'We take 3 quick photos of your face so we can recognise you next time. Face data is stored only as numbers, never as pictures.'),
      err,
      dots,
      hint,
      btn
    );
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const value = name.value.trim().replace(/\s+/g, ' ');
      if (value.length < 2) {
        err.textContent = 'Please enter your name.';
        err.hidden = false;
        name.focus();
        return;
      }
      await busy(btn, async () => {
        try {
          const done = [...dots.children];
          done.forEach((d) => d.classList.remove('done'));
          const samples = await collectSamples(cam, 3, {
            onProgress: (n) => done[n - 1] && done[n - 1].classList.add('done'),
            onHint: (t) => (hint.textContent = t),
          });
          hint.textContent = 'Creating your profile...';
          const res = await api('student-register', { name: value, descriptors: samples });
          setSession(res.token, res.user);
          toast(`Profile created! Hi ${res.user.name}`, 'ok');
          go('#/student');
        } catch (e) {
          hint.textContent = '';
          err.textContent = e.message;
          err.hidden = false;
        }
      });
    });
    regHolder.append(form);
    name.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Kick off automatically.
  startLoop();

  return () => {
    disposed = true;
    cam.stop();
  };
}

/* ============================================================== dashboard */

const targetKey = 'attendo.target';
const getTarget = () => Math.max(50, Math.min(95, Number(store.get(targetKey, 75)) || 75));

function tipFor(sub, target) {
  if (!sub.total) return 'No classes have been marked yet.';
  const t = target / 100;
  if (sub.percent >= target) {
    const spare = Math.floor(sub.attended / t - sub.total + 1e-9);
    if (spare >= 1) return `You can miss ${spare} more class${spare === 1 ? '' : 'es'} and stay above ${target}%.`;
    return `You are right at ${target}%. Try not to miss the next class.`;
  }
  const need = Math.ceil((t * sub.total - sub.attended) / (1 - t) - 1e-9);
  return `Attend the next ${need} class${need === 1 ? '' : 'es'} in a row to reach ${target}%.`;
}

function statusChip(sub, target) {
  if (!sub.total) return h('span', { class: 'status-chip mute' }, 'No classes yet');
  const cls = pctClass(sub.percent, target);
  const text = cls === 'ok' ? 'On track' : cls === 'warn' ? 'Needs attention' : 'Low attendance';
  return h('span', { class: `status-chip ${cls}` }, text);
}

function renderDashboard(root) {
  let disposed = false;
  const session = getSession();
  const content = h('div', null, loadingBlock('Loading your subjects...'));

  const logout = h(
    'button',
    {
      class: 'btn primary',
      type: 'button',
      onclick: () => {
        clearSession();
        setPendingJoin(null);
        go('#/');
      },
    },
    icon('logout'),
    'Logout'
  );

  root.append(
    topbar({ right: [h('div', { class: 'welcome' }, `Welcome, ${session.user.name}`), logout] }),
    h('h1', { class: 'page-title' }, 'Student Dashboard'),
    content,
    siteFooter()
  );

  async function load() {
    clear(content);
    content.append(loadingBlock('Loading your subjects...'));
    try {
      const data = await api('student-dashboard');
      if (disposed) return;
      paint(data);
      const join = pendingJoin();
      if (join) {
        setPendingJoin(null);
        quickEnroll(join);
      }
    } catch (e) {
      if (disposed) return;
      clear(content);
      content.append(errorCard(e.message, load));
    }
  }

  function paint(data) {
    clear(content);
    const target = getTarget();
    const subjects = data.subjects;
    const totalAll = subjects.reduce((n, s) => n + s.total, 0);
    const attendedAll = subjects.reduce((n, s) => n + s.attended, 0);
    const overall = totalAll ? (attendedAll / totalAll) * 100 : null;

    // ---- summary + target slider
    const label = h('b', null, `${target}%`);
    const slider = h('input', { type: 'range', min: 50, max: 95, step: 5, value: target, 'aria-label': 'Attendance target' });
    slider.addEventListener('input', () => {
      label.textContent = `${slider.value}%`;
    });
    slider.addEventListener('change', () => {
      store.set(targetKey, Number(slider.value));
      paint(data);
    });
    content.append(
      h(
        'div',
        { class: 'card summary-card' },
        ring(overall, { size: 80, stroke: 10 }),
        h(
          'div',
          null,
          h('h3', null, overall == null ? 'No attendance yet' : overall >= target ? 'You are on track' : 'Below your target'),
          h('p', { class: 'hint' }, totalAll ? `${attendedAll} of ${totalAll} classes attended across ${subjects.length} subject${subjects.length === 1 ? '' : 's'}.` : 'Join a subject to start tracking.')
        ),
        h('div', { class: 'target-box' }, h('div', { class: 'row' }, h('span', null, 'My target'), label), slider)
      )
    );

    // ---- subjects
    content.append(
      h(
        'div',
        { class: 'card-head', style: { marginTop: '26px' } },
        h('h2', { class: 'section-title' }, 'Your enrolled subjects'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => enrollDialog() }, icon('plus'), 'Enroll in subject')
      ),
      h('hr', { class: 'divider' })
    );

    if (!subjects.length) {
      content.append(
        h('div', { class: 'card' }, emptyState('book', 'No subjects yet', 'Ask your teacher for the subject code or scan their QR code, then tap "Enroll in subject".'))
      );
    } else {
      content.append(h('div', { class: 'grid-2' }, subjects.map((s) => subjectCard(s, target))));
    }

    // ---- face profile
    content.append(
      h(
        'div',
        { class: 'card', style: { marginTop: '26px' } },
        h('div', { class: 'card-head', style: { marginBottom: '0' } },
          h('div', null,
            h('h3', null, 'Face profile'),
            h('p', { class: 'hint', style: { marginTop: '4px' } }, `${data.student.faceSamples} saved sample${data.student.faceSamples === 1 ? '' : 's'}. If you are sometimes marked absent while present, add more samples in different light or with/without glasses.`)),
          h('button', { class: 'btn secondary', type: 'button', onclick: () => addFaceDialog(load) }, icon('camera'), 'Add more samples')
        )
      )
    );
  }

  function subjectCard(sub, target) {
    const dots = sub.history.slice(-24).map((x) => h('span', { class: 'dot' + (x.present ? '' : ' absent'), title: `${fmtDate(parseTs(x.timestamp))}: ${x.present ? 'Present' : 'Absent'}` }));
    const unenroll = h('button', { class: 'btn danger small', type: 'button' }, icon('trash'), 'Unenroll');
    unenroll.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Unenroll from ${sub.name}?`,
        message: 'Your past attendance stays with your teacher. You can join again with the subject code.',
        confirmText: 'Unenroll',
        danger: true,
      });
      if (!ok) return;
      await busy(unenroll, async () => {
        try {
          await api('student-unenroll', { subject_id: sub.subject_id });
          toast(`Unenrolled from ${sub.name}.`, 'ok');
          await load();
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    });

    return h(
      'div',
      { class: 'subject-card' },
      h(
        'div',
        { class: 's-top' },
        h(
          'div',
          { class: 'grow' },
          h('h3', null, sub.name),
          h('div', { class: 'subject-meta' }, h('span', { class: 'code-chip' }, sub.subject_code), h('span', null, `Section ${sub.section}`)),
          sub.teacher ? h('div', { class: 'hint' }, `Taught by ${sub.teacher}`) : null
        ),
        ring(sub.percent, { size: 66, stroke: 10 })
      ),
      h('div', { class: 'stat-row' }, h('span', { class: 'stat' }, '\ud83d\udcc6 ', h('b', null, sub.total), ' Classes'), h('span', { class: 'stat' }, '\u2705 ', h('b', null, sub.attended), ' Attended'), statusChip(sub, target)),
      h('div', { class: 'tip' }, tipFor(sub, target)),
      dots.length ? h('div', { class: 'dots', 'aria-label': 'Recent classes' }, dots) : null,
      h('div', { class: 'card-actions' }, unenroll)
    );
  }

  function enrollDialog() {
    const code = h('input', { class: 'input', id: 'ecode', placeholder: 'E.g. CS101', autocomplete: 'off', maxlength: 40 });
    const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'button' }, 'Enroll now');
    const m = openModal({
      title: 'Enroll in subject',
      body: h('div', null, h('p', { style: { marginBottom: '12px' } }, 'Enter the subject code your teacher shared.'), err, h('div', { class: 'field' }, h('label', { for: 'ecode' }, 'Subject code'), code)),
      footer: [btn],
    });
    const submit = async () => {
      err.hidden = true;
      if (!code.value.trim()) {
        err.textContent = 'Please enter a subject code.';
        err.hidden = false;
        return;
      }
      await busy(btn, async () => {
        try {
          const res = await api('student-enroll', { code: code.value });
          toast(`Enrolled in ${res.subject.name}!`, 'ok');
          m.close();
          await load();
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
        }
      });
    };
    btn.addEventListener('click', submit);
    code.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    setTimeout(() => code.focus(), 50);
  }

  async function quickEnroll(codeValue) {
    let info;
    try {
      info = await api('subject-lookup', { code: codeValue });
    } catch (e) {
      toast(e.message, 'err');
      return;
    }
    if (info.enrolled) {
      toast(`You are already enrolled in ${info.subject.name}.`);
      return;
    }
    const yes = h('button', { class: 'btn primary', type: 'button' }, 'Yes, enroll me');
    const m = openModal({
      title: 'Quick enrollment',
      body: h('p', null, 'Would you like to enroll in ', h('b', null, info.subject.name), ` (${info.subject.subject_code}, section ${info.subject.section})${info.subject.teacher ? ` taught by ${info.subject.teacher}` : ''}?`),
      footer: [h('button', { class: 'btn ghost', type: 'button', onclick: () => m.close() }, 'No thanks'), yes],
    });
    yes.addEventListener('click', () =>
      busy(yes, async () => {
        try {
          await api('student-enroll', { code: codeValue });
          toast(`Joined ${info.subject.name}!`, 'ok');
          m.close();
          await load();
        } catch (e) {
          toast(e.message, 'err');
        }
      })
    );
  }

  load();
  return () => {
    disposed = true;
  };
}

/* ------------------------------------------------- add more face samples */
function addFaceDialog(onDone) {
  const cam = createCamera({ facing: 'user', mirror: true });
  const hint = h('div', { class: 'cam-status' }, 'Starting camera...');
  const dots = h('div', { class: 'samples' }, h('i'), h('i'), h('i'));
  const btn = h('button', { class: 'btn primary', type: 'button' }, icon('camera'), 'Capture 3 samples');
  const m = openModal({
    title: 'Add face samples',
    body: h('div', null, cam.el, hint, dots),
    footer: [btn],
    onClose: () => cam.stop(),
  });
  (async () => {
    if (!(await cam.start())) {
      hint.textContent = '';
      return;
    }
    try {
      await ensureEngine('live', (t) => (hint.textContent = t || 'Look at the camera, then tap Capture.'));
      hint.textContent = 'Look at the camera, then tap Capture.';
    } catch (e) {
      hint.textContent = e.message;
      hint.classList.add('err');
    }
  })();
  btn.addEventListener('click', () =>
    busy(btn, async () => {
      try {
        const done = [...dots.children];
        done.forEach((d) => d.classList.remove('done'));
        const samples = await collectSamples(cam, 3, {
          onProgress: (n) => done[n - 1] && done[n - 1].classList.add('done'),
          onHint: (t) => (hint.textContent = t),
        });
        const res = await api('student-add-face', { descriptors: samples });
        toast(`Saved! You now have ${res.faceSamples} face samples.`, 'ok');
        m.close();
        onDone();
      } catch (e) {
        hint.textContent = e.message;
        hint.classList.add('err');
      }
    })
  );
}
