const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let onUnauthorized = null;

/**
 * Registered once by AuthContext.
 *
 * A mid-session 401 is the one thing this module knows that the auth layer cannot find out for
 * itself: there is no refresh token, so an expired JWT silently turns every later call into an
 * inline error while the nav still says you are logged in. With a 7-day token and tabs left open,
 * that happens in practice.
 *
 * A registered callback rather than a redirect from here, so AuthContext stays the only thing that
 * owns session state -- and so this module keeps no import of it, which would be a cycle.
 */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export async function apiFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const token = localStorage.getItem('token');

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // /auth/* is excluded deliberately: a wrong password on /auth/login is a 401 and must not
    // trigger a global logout, and AuthContext's own /auth/me revalidation has its own handling.
    if (response.status === 401 && !path.startsWith('/auth/')) {
      onUnauthorized?.();
    }
    throw new ApiError(data?.error?.message || `Request failed with status ${response.status}`, response.status);
  }

  return data;
}
