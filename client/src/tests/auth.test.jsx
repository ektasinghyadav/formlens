// @vitest-environment jsdom
// Client auth tests. Requirement: FR-8.1. (Sprint 1)
// The API layer is mocked, so these test the screens and redirects, not the server.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import api, { setAuthToken } from '../api/client.js';
import { AuthProvider } from '../components/Auth/AuthContext.jsx';
import * as authApi from '../api/auth.js';

vi.mock('../api/auth.js');

afterEach(() => {
  cleanup();
  setAuthToken(null);
  vi.resetAllMocks();
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>
  );
}

function fillAndSubmit(email, password) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('protected routes', () => {
  it('redirects to the login page when not logged in', () => {
    renderAt('/admin/forms');
    expect(screen.getByRole('heading', { name: 'Admin login' })).toBeTruthy();
    expect(screen.queryByText('Your forms')).toBeNull();
  });

  it('keeps the public form page open without login', () => {
    renderAt('/f/abc123');
    expect(screen.getByRole('heading', { name: 'Form' })).toBeTruthy();
  });
});

describe('login form', () => {
  it('shows the server error as text when login fails', async () => {
    authApi.login.mockRejectedValue({ response: { data: { error: 'Invalid credentials' } } });
    renderAt('/login');
    fillAndSubmit('a@b.co', 'password123');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid credentials');
  });

  it('logs in, opens the admin page, then logs out back to login', async () => {
    authApi.login.mockResolvedValue({ data: { token: 'fake-token' } });
    authApi.getMe.mockResolvedValue({ data: { adminId: '1', email: 'a@b.co' } });
    renderAt('/admin/forms');
    fillAndSubmit('a@b.co', 'password123'); // redirected to /login first
    expect(await screen.findByText('Your forms')).toBeTruthy(); // sent back where they were going
    expect(screen.getByText(/Signed in as a@b.co/)).toBeTruthy();
    expect(window.localStorage.length).toBe(0); // token is in memory only
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Admin login' })).toBeTruthy());
  });
});

describe('Axios interceptor', () => {
  it('attaches the Bearer token only while one is set', async () => {
    // a fake "network" that just echoes back the Authorization header it was given
    const echo = (config) => Promise.resolve({ data: config.headers.Authorization ?? null, status: 200, statusText: 'OK', headers: {}, config });
    setAuthToken('abc');
    expect((await api.get('/x', { adapter: echo })).data).toBe('Bearer abc');
    setAuthToken(null);
    expect((await api.get('/x', { adapter: echo })).data).toBeNull();
  });
});
