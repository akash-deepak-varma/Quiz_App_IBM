import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { apiFetch } from '../api/client.js';

vi.mock('../api/client.js', () => ({ apiFetch: vi.fn() }));

function Probe() {
  const { user, isAuthenticated, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="auth-status">{isAuthenticated ? 'in' : 'out'}</span>
      <span data-testid="user-name">{user?.name || ''}</span>
      <button onClick={() => login('ada@example.com', 'supersecret')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear();
    apiFetch.mockReset();
  });

  it('login() stores the token/user and flips isAuthenticated', async () => {
    // Base resolution covers the AuthProvider's own /auth/me refresh effect (fired whenever
    // `token` changes, including right after login sets it) -- the Once value below is only
    // for the login() call itself.
    apiFetch.mockResolvedValue({ user: { id: 'u1', name: 'Ada Lovelace' } });
    apiFetch.mockResolvedValueOnce({ token: 'tok-123', user: { id: 'u1', name: 'Ada Lovelace' } });
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(screen.getByTestId('auth-status')).toHaveTextContent('out');

    await user.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('in'));
    expect(screen.getByTestId('user-name')).toHaveTextContent('Ada Lovelace');
    expect(localStorage.getItem('token')).toBe('tok-123');
    expect(JSON.parse(localStorage.getItem('user'))).toMatchObject({ name: 'Ada Lovelace' });
    expect(apiFetch).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: { email: 'ada@example.com', password: 'supersecret' },
    });
  });

  it('logout() clears the token/user from state and localStorage', async () => {
    apiFetch.mockResolvedValue({ user: { id: 'u2', name: 'Grace Hopper' } });
    apiFetch.mockResolvedValueOnce({ token: 'tok-456', user: { id: 'u2', name: 'Grace Hopper' } });
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('in'));

    await user.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('auth-status')).toHaveTextContent('out'));
    expect(screen.getByTestId('user-name')).toHaveTextContent('');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });
});
