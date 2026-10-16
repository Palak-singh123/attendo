import { h, icon, clear } from '../util.js';
import { siteFooter, themeButton, setPage } from '../ui.js';
import { getSession, health } from '../api.js';
import { pendingJoin } from './common.js';

function roleCard(kind) {
  const student = kind === 'student';
  return h(
    'a',
    { class: `role-card role-${kind}`, href: `#/${kind}`, 'aria-label': student ? 'I am a student' : 'I am a teacher' },
    h('img', { src: student ? '/assets/student.webp' : '/assets/teacher.webp', alt: '', width: 140, height: 130 }),
    h(
      'div',
      null,
      h('h2', { class: 'role-title' }, "I'm a ", h('span', { class: student ? 'accent-s' : 'accent-t' }, student ? 'Student' : 'Teacher')),
      h(
        'p',
        { class: 'role-desc' },
        student ? ['Check your attendance, join classes', h('br'), 'and stay above your target.'] : ['Take attendance with a photo, a voice', h('br'), 'or a tap and see who needs help.']
      )
    ),
    h('span', { class: 'role-arrow', 'aria-hidden': 'true' }, icon('arrow'))
  );
}

export function renderHome(root) {
  setPage('home');
  clear(root);
  root.className = 'app home';

  const join = pendingJoin();
  const session = getSession();

  const nodes = [
    h('div', { class: 'home-tools' }, themeButton()),
    h('img', { class: 'hero-logo', src: '/assets/logo.webp', alt: 'Attendo', width: 340, height: 127 }),
  ];

  if (join) {
    const loggedStudent = session && session.role === 'student';
    nodes.push(
      h(
        'div',
        { class: 'banner', role: 'status' },
        h('span', null, loggedStudent ? `Ready to join ${join}? Open your student dashboard to finish.` : `Log in as a student to join ${join}.`),
        h('a', { class: 'btn primary small', href: '#/student' }, loggedStudent ? 'Open dashboard' : 'Go to student login')
      )
    );
  }

  nodes.push(
    h('div', { class: 'role-list' }, roleCard('student'), roleCard('teacher')),
    h(
      'div',
      { class: 'home-features' },
      h('span', { class: 'pill' }, icon('scan'), 'Face recognition'),
      h('span', { class: 'pill' }, icon('mic'), 'Voice roll call'),
      h('span', { class: 'pill' }, icon('chart'), 'Attendance insights'),
      h('span', { class: 'pill' }, icon('shield'), 'Your face data stays private')
    ),
    siteFooter()
  );
  const status = h('div', { 'aria-live': 'polite' });
  nodes.unshift(status);
  root.append(...nodes);

  // Tell the owner right away if the database is not connected yet.
  health()
    .then((r) => {
      if (r && r.ok) return;
      const hint = (r && r.hint) || 'Supabase is not connected yet.';
      status.append(
        h(
          'div',
          { class: 'banner warn', role: 'alert' },
          h('span', null, h('b', null, 'Database not connected. '), hint, ' See README.md, step 1 and 3.')
        )
      );
    })
    .catch(() => {
      status.append(
        h(
          'div',
          { class: 'banner warn', role: 'alert' },
          h('span', null, h('b', null, 'Server (API) not reachable. '), 'Open the site from your Vercel link, not by double-clicking index.html.')
        )
      );
    });
  return null;
}
