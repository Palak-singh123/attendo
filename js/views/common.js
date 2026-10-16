import { h, clear } from '../util.js';
import { themeButton } from '../ui.js';

export function topbar({ right = [] } = {}) {
  return h(
    'header',
    { class: 'topbar' },
    h('a', { href: '#/', 'aria-label': 'Attendo home' }, h('img', { class: 'logo', src: '/assets/logo.webp', alt: 'Attendo', width: 200, height: 74 })),
    h('div', { class: 'topbar-right' }, ...right, themeButton())
  );
}

/** Navigate to a hash route, forcing a re-render when we are already there. */
export function go(hash) {
  if (location.hash === hash || (hash === '#/' && !location.hash)) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function pendingJoin() {
  try {
    return sessionStorage.getItem('attendo.join') || null;
  } catch (_) {
    return null;
  }
}
export function setPendingJoin(code) {
  try {
    if (code) sessionStorage.setItem('attendo.join', code);
    else sessionStorage.removeItem('attendo.join');
  } catch (_) { /* ignore */ }
}

export function errorCard(message, retry) {
  return h(
    'div',
    { class: 'card', role: 'alert' },
    h('p', { class: 'form-error' }, message),
    retry ? h('button', { class: 'btn primary', type: 'button', onclick: retry }, 'Try again') : null
  );
}

export { clear };
