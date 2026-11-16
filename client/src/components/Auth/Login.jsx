// Login.jsx - login and register on one page. Requirement: FR-8.1.
// Accessible by design: every input has a visible <label>; errors are real text
// (role="alert"), not just colour.
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Brand from '../Brand.jsx';
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
    <main className="login">
      <div className="login-card">
        <p className="brand" aria-label="FormLens"><Brand size="hero" /></p>
        <p className="tagline">Digital Form Usability Analyzer</p>
        <h1 className="login-title">{isRegister ? 'Create admin account' : 'Admin login'}</h1>
        <p className="lede">See which field of your form makes people stop, struggle or leave.</p>
      <form onSubmit={handleSubmit} className="stack" style={{ marginTop: 28 }}>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input
            id="email" type="email" required autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input
            id="password" type="password" required minLength={8} value={password}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            aria-describedby={isRegister ? 'password-hint' : undefined}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          {isRegister && <p id="password-hint" className="hint">At least 8 characters.</p>}
        </div>
        {error && <p role="alert" className="error">Error: {error}</p>}
        <button type="submit" disabled={busy} className="btn btn-block">
          {busy ? 'Please wait…' : isRegister ? 'Register' : 'Log in'}
        </button>
      </form>
      <button
        type="button" className="link" style={{ marginTop: 20, fontSize: '0.9375rem' }}
        onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(''); }}
      >
        {isRegister ? 'Already have an account? Log in' : 'New here? Create an account'}
      </button>
      </div>
    </main>
  );
}
