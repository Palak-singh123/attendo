import { h, icon, clear } from './util.js';

/* ------------------------------------------------------------- toasts */
export function toast(message, type = 'info', ms = 3800) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = h(
    'div',
    { class: `toast ${type === 'ok' ? 'ok' : type === 'err' ? 'err' : ''}` },
    icon(type === 'ok' ? 'check' : type === 'err' ? 'alert' : 'info'),
    h('span', null, message)
  );
  root.append(el);
  const remove = () => el.remove();
  setTimeout(remove, ms);
  el.addEventListener('click', remove);
}

/* ------------------------------------------------------------- modals */
export function openModal({ title, body, footer, wide = false, dismissable = true, onClose } = {}) {
  const dialog = h('dialog', { class: 'modal' + (wide ? ' wide' : '') });
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const closeBtn = dismissable
    ? h('button', { class: 'modal-x', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'))
    : null;
  const footEl = footer ? h('div', { class: 'modal-foot' }, footer) : null;
  dialog.append(
    h('div', { class: 'modal-box' }, h('div', { class: 'modal-head' }, h('h3', null, title || ''), closeBtn), bodyEl, footEl)
  );

  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    try {
      dialog.close();
    } catch (_) { /* already closed */ }
    dialog.remove();
    if (onClose) onClose(result);
  }

  dialog.addEventListener('cancel', (e) => {
    if (!dismissable) e.preventDefault();
  });
  dialog.addEventListener('close', () => close());
  dialog.addEventListener('click', (e) => {
    if (dismissable && e.target === dialog) close();
  });

  document.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  return { el: dialog, body: bodyEl, close, setBody(node) { clear(bodyEl); bodyEl.append(node); } };
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    const m = openModal({
      title,
      body: h('p', { style: { padding: '4px 0 10px' } }, message),
      footer: [
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { done(false); m.close(); } }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onclick: () => { done(true); m.close(); } }, confirmText),
      ],
      onClose: () => done(false),
    });
  });
}

/* ------------------------------------------------------------- buttons */
export async function busy(button, fn) {
  if (!button) return fn();
  const original = Array.from(button.childNodes);
  const prevDisabled = button.disabled;
  const width = button.offsetWidth;
  button.disabled = true;
  button.style.minWidth = width + 'px';
  clear(button);
  button.append(h('span', { class: 'spin' }));
  try {
    return await fn();
  } finally {
    clear(button);
    original.forEach((n) => button.append(n));
    button.disabled = prevDisabled;
    button.style.minWidth = '';
  }
}

/* ------------------------------------------------------------- theme */
export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function themeButton() {
  const btn = h('button', { class: 'theme-btn', type: 'button', 'aria-label': 'Switch theme', title: 'Switch theme' });
  const paint = () => {
    clear(btn);
    btn.append(icon(currentTheme() === 'dark' ? 'sun' : 'moon'));
  };
  btn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('attendo.theme', next);
    } catch (_) { /* ignore */ }
    paint();
  });
  paint();
  return btn;
}

/* ------------------------------------------------------------- misc */
export function siteFooter() {
  return h(
    'div',
    { class: 'site-footer' },
    h('span', null, 'Created with \u2764\ufe0f by'),
    h(
      'a',
      { href: 'https://www.linkedin.com/in/palak-singh-3b98913a4/', target: '_blank', rel: 'noopener noreferrer' },
      h('span', { class: 'p' }, 'Palak'),
      ' ',
      h('span', { class: 's' }, 'Singh')
    )
  );
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, icon(iconName), h('h4', null, title), text ? h('p', null, text) : null, action || null);
}

export function loadingBlock(text = 'Loading...') {
  return h('div', { class: 'loading-page' }, h('span', { class: 'spin' }), h('p', null, text));
}

export function passwordField({ id, label, placeholder, autocomplete = 'current-password' }) {
  const input = h('input', { class: 'input', id, type: 'password', placeholder, autocomplete, required: true });
  const toggle = h('button', { class: 'pw-toggle', type: 'button', 'aria-label': 'Show password' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    clear(toggle);
    toggle.append(icon(show ? 'eyeOff' : 'eye'));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });
  return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), h('div', { class: 'pw-wrap' }, input, toggle)) };
}

export function textField({ id, label, placeholder, type = 'text', autocomplete = 'off', maxlength, hint }) {
  const input = h('input', { class: 'input', id, type, placeholder, autocomplete, maxlength });
  return { input, el: h('div', { class: 'field' }, h('label', { for: id }, label), input, hint ? h('p', { class: 'hint' }, hint) : null) };
}

export function setPage(kind) {
  document.body.setAttribute('data-page', kind);
}
