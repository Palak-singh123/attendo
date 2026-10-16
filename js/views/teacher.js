import { h, icon, clear, store } from '../util.js';
import { api, setSession, clearSession, getSession, isRole } from '../api.js';
import { toast, busy, siteFooter, setPage, passwordField, textField, loadingBlock } from '../ui.js';
import { topbar, go, errorCard } from './common.js';
import { renderAttendanceTab } from './attendance.js';
import { renderSubjectsTab } from './subjects.js';
import { renderRecordsTab } from './records.js';

export function renderTeacher(root) {
  setPage('dash');
  clear(root);
  root.className = 'app';
  return isRole('teacher') ? renderDashboard(root) : renderAuth(root);
}

/* ================================================================ auth */

function renderAuth(root) {
  let mode = 'login';
  let prefill = '';
  const holder = h('div');
  root.append(
    topbar({ right: [h('a', { class: 'btn primary', href: '#/' }, 'Go back to home')] }),
    holder,
    siteFooter()
  );

  function draw() {
    clear(holder);
    holder.append(mode === 'login' ? loginForm() : registerForm());
  }

  function loginForm() {
    const user = textField({ id: 'tuser', label: 'Username', placeholder: 'ananyaroy', autocomplete: 'username' });
    const pass = passwordField({ id: 'tpass', label: 'Password', placeholder: 'Enter your password' });
    user.input.value = prefill;
    const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('check'), 'Login');
    const form = h(
      'form',
      { novalidate: true },
      h('h1', { class: 'page-title' }, 'Login using password'),
      h('p', { class: 'page-sub' }, 'Welcome back. Your classes are waiting.'),
      h(
        'div',
        { class: 'card form-card' },
        err,
        user.el,
        pass.el,
        h('hr', { class: 'divider' }),
        h('div', { class: 'btn-row' }, btn, h('button', { class: 'btn secondary', type: 'button', onclick: () => { mode = 'register'; draw(); } }, 'Register instead'))
      )
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      if (!user.input.value.trim() || !pass.input.value) {
        err.textContent = 'Enter your username and password.';
        err.hidden = false;
        return;
      }
      await busy(btn, async () => {
        try {
          const res = await api('teacher-login', { username: user.input.value, password: pass.input.value });
          setSession(res.token, res.user);
          toast('Welcome back!', 'ok');
          go('#/teacher');
        } catch (ex) {
          err.textContent = ex.message;
          err.hidden = false;
        }
      });
    });
    return form;
  }

  function registerForm() {
    const user = textField({ id: 'ruser', label: 'Username', placeholder: 'ananyaroy', autocomplete: 'username', hint: 'Letters, numbers, dot, dash or underscore.' });
    const name = textField({ id: 'rname', label: 'Full name', placeholder: 'Ananya Roy', autocomplete: 'name' });
    const pass = passwordField({ id: 'rpass', label: 'Password', placeholder: 'At least 6 characters', autocomplete: 'new-password' });
    const pass2 = passwordField({ id: 'rpass2', label: 'Confirm password', placeholder: 'Type it again', autocomplete: 'new-password' });
    const err = h('div', { class: 'form-error', hidden: true, role: 'alert' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, icon('check'), 'Register');
    const form = h(
      'form',
      { novalidate: true },
      h('h1', { class: 'page-title' }, 'Register your teacher profile'),
      h('p', { class: 'page-sub' }, 'Create classes, share a code, take attendance in seconds.'),
      h(
        'div',
        { class: 'card form-card' },
        err,
        user.el,
        name.el,
        pass.el,
        pass2.el,
        h('hr', { class: 'divider' }),
        h('div', { class: 'btn-row' }, btn, h('button', { class: 'btn secondary', type: 'button', onclick: () => { mode = 'login'; draw(); } }, 'Login instead'))
      )
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const fail = (t) => {
        err.textContent = t;
        err.hidden = false;
      };
      if (!user.input.value.trim() || !name.input.value.trim() || !pass.input.value || !pass2.input.value) return fail('All fields are required.');
      if (pass.input.value !== pass2.input.value) return fail('The passwords do not match.');
      await busy(btn, async () => {
        try {
          await api('teacher-register', { username: user.input.value, name: name.input.value, password: pass.input.value });
          toast('Account created! Log in now.', 'ok');
          prefill = user.input.value.trim().toLowerCase();
          mode = 'login';
          draw();
        } catch (ex) {
          fail(ex.message);
        }
      });
    });
    return form;
  }

  draw();
  return null;
}

/* ========================================================== dashboard */

const TABS = [
  { id: 'attendance', label: 'Take Attendance', icon: 'scan' },
  { id: 'subjects', label: 'Manage Subjects', icon: 'book' },
  { id: 'records', label: 'Attendance Records', icon: 'clipboard' },
];

function renderDashboard(root) {
  let disposed = false;
  let tabCleanup = null;
  const session = getSession();
  let tab = store.get('attendo.teacherTab', 'attendance');
  if (!TABS.some((t) => t.id === tab)) tab = 'attendance';

  let subjectsCache = null;
  const ctx = {
    async getSubjects(force = false) {
      if (!subjectsCache || force) subjectsCache = (await api('teacher-subjects')).subjects;
      return subjectsCache;
    },
    invalidate() {
      subjectsCache = null;
    },
    goTab(id) {
      setTab(id);
    },
  };

  const content = h('div');
  const tabsEl = h('div', { class: 'tabs', role: 'tablist' });

  const logout = h(
    'button',
    {
      class: 'btn primary',
      type: 'button',
      onclick: () => {
        clearSession();
        go('#/');
      },
    },
    icon('logout'),
    'Logout'
  );

  root.append(topbar({ right: [h('div', { class: 'welcome' }, `Welcome, ${session.user.name}`), logout] }), tabsEl, content, siteFooter());

  function paintTabs() {
    clear(tabsEl);
    for (const t of TABS) {
      tabsEl.append(
        h(
          'button',
          { class: 'tab', type: 'button', role: 'tab', 'aria-selected': t.id === tab ? 'true' : 'false', onclick: () => setTab(t.id) },
          icon(t.icon),
          t.label
        )
      );
    }
  }

  function setTab(id) {
    if (disposed) return;
    tab = id;
    store.set('attendo.teacherTab', id);
    paintTabs();
    if (tabCleanup) {
      try {
        tabCleanup();
      } catch (_) { /* ignore */ }
      tabCleanup = null;
    }
    clear(content);
    const fn = id === 'attendance' ? renderAttendanceTab : id === 'subjects' ? renderSubjectsTab : renderRecordsTab;
    try {
      tabCleanup = fn(content, ctx) || null;
    } catch (e) {
      content.append(errorCard(e.message));
    }
  }

  setTab(tab);
  return () => {
    disposed = true;
    if (tabCleanup) tabCleanup();
  };
}

export { loadingBlock };
