import { onSessionExpired } from './api.js';
import { toast } from './ui.js';
import { renderHome } from './views/home.js';
import { renderStudent } from './views/student.js';
import { renderTeacher } from './views/teacher.js';
import { go, setPendingJoin } from './views/common.js';

// Capture ?join=CODE (or the old ?join-code=CODE) from a shared link, then tidy the URL.
(function captureJoinCode() {
  try {
    const params = new URLSearchParams(location.search);
    const code = params.get('join') || params.get('join-code');
    if (code) {
      setPendingJoin(code.trim().toUpperCase().slice(0, 40));
      params.delete('join');
      params.delete('join-code');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    }
  } catch (_) { /* ignore */ }
})();

const routes = {
  '#/': renderHome,
  '#/student': renderStudent,
  '#/teacher': renderTeacher,
};

let cleanup = null;

function render() {
  if (cleanup) {
    try {
      cleanup();
    } catch (_) { /* ignore */ }
    cleanup = null;
  }
  const root = document.getElementById('app');
  const view = routes[location.hash] || renderHome;
  window.scrollTo(0, 0);
  try {
    cleanup = view(root) || null;
  } catch (e) {
    console.error(e);
    root.textContent = 'Something went wrong while loading this page. Please refresh.';
  }
}

onSessionExpired((role) => {
  toast('Your session expired. Please log in again.', 'err');
  go(role === 'teacher' ? '#/teacher' : '#/student');
});

window.addEventListener('hashchange', render);
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', render);
else render();

window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});
