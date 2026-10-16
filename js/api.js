import { store } from './util.js';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const KEY = 'attendo.session';
let session = store.get(KEY, null);

export const getSession = () => session;
export const isRole = (role) => Boolean(session && session.token && session.role === role);

export function setSession(token, user) {
  session = { token, role: user.role, user };
  store.set(KEY, session);
}

export function clearSession() {
  session = null;
  store.del(KEY);
}

let onExpired = null;
export function onSessionExpired(fn) {
  onExpired = fn;
}

export async function api(action, payload = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session && session.token) headers.Authorization = 'Bearer ' + session.token;

  let res;
  try {
    res = await fetch('/api/rpc', { method: 'POST', headers, body: JSON.stringify({ action, ...payload }) });
  } catch (_) {
    throw new ApiError('No internet connection. Check your network and try again.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }

  if (!res.ok) {
    if (data === null) {
      throw new ApiError(
        res.status === 404
          ? 'The Attendo server (API) was not found. Deploy the project on Vercel or run "vercel dev".'
          : `Server error (${res.status}). Please try again.`,
        res.status
      );
    }
    if (res.status === 401 && session && session.token) {
      const role = session.role;
      clearSession();
      if (onExpired) onExpired(role);
    }
    throw new ApiError(data.error || `Server error (${res.status}).`, res.status);
  }
  return data;
}

export async function health() {
  const res = await fetch('/api/rpc?action=health', { cache: 'no-store' });
  return res.json();
}
