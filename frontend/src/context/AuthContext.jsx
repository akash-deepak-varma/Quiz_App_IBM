import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(true);

  // Trust localStorage for the initial render (avoids a logged-out flash), but confirm
  // the token is still good against the server -- it may have expired or the DB may have
  // been reseeded since it was issued.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch('/auth/me')
      .then((data) => {
        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
      })
      .catch((err) => {
        // Only a 401 means the token is actually bad.
        //
        // This used to log out on *any* failure, which is wrong the moment the API is not on
        // localhost: a free-tier host that sleeps when idle takes up to a minute to answer the
        // first request, and a network blip is not evidence that a session expired. The old
        // behaviour threw away a perfectly valid session on the first request of every visit after
        // a quiet spell -- i.e. for every user, every time they came back.
        if (err?.status !== 401) return;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = useCallback(async (email, password) => {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }, []);

  const signup = useCallback(async (name, email, password, inviteCode) => {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: { name, email, password, inviteCode },
    });
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  }, []);

  // Lets api/client.js end the session when any authenticated call comes back 401. `logout` is a
  // stable useCallback, so this registers once rather than on every render. No navigate() here:
  // clearing the token flips isAuthenticated, and RequireAuth redirects on the next render.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const value = {
    user,
    token,
    loading,
    isAuthenticated: Boolean(token),
    login,
    signup,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
