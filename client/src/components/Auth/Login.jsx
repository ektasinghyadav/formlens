// Login.jsx - login and register on one page. Requirement: FR-8.1.
// Accessible by design: every input has a visible <label>; errors are real text
// (role="alert"), not just colour.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { register } from '../../api/auth.js';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') await register(email, password);
      await login(email, password); // after registering we log straight in
      navigate(location.state?.from || '/admin/forms', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const isRegister = mode === 'register';

  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-4 text-2xl font-bold">{isRegister ? 'Create admin account' : 'Admin login'}</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input
            id="email" type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-gray-400 px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">Password</label>
          <input
            id="password" type="password" required minLength={8} value={password}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            aria-describedby={isRegister ? 'password-hint' : undefined}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-gray-400 px-3 py-2"
          />
          {isRegister && <p id="password-hint" className="mt-1 text-xs text-gray-600">At least 8 characters.</p>}
        </div>
        {error && <p role="alert" className="text-sm font-medium text-red-700">Error: {error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded bg-blue-700 px-3 py-2 font-medium text-white disabled:opacity-60">
          {busy ? 'Please wait…' : isRegister ? 'Register' : 'Log in'}
        </button>
      </form>
      <button
        type="button" className="mt-4 text-sm text-blue-800 underline"
        onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(''); }}
      >
        {isRegister ? 'Already have an account? Log in' : 'New here? Create an account'}
      </button>
    </main>
  );
}
