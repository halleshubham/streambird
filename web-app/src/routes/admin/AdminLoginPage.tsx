import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import * as authApi from '../../api/auth';
import { ApiError } from '../../api/client';
import { BirdBusy } from '../../components/BirdBusy';

/** Superadmin login: password, then a code emailed after it checks out -- see
 * AuthController.superadminLogin / superadminVerify. Completely separate from
 * the magic-code LoginPage. */
export function AdminLoginPage() {
  const { status, user, setSession } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated' && user?.role === 'superadmin') {
    return <Navigate to="/admin" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!codeSent) {
        await authApi.superadminLogin(email.trim(), password);
        setCodeSent(true);
        return;
      }
      const res = await authApi.superadminVerify(email.trim(), password, code.trim());
      setSession(res.user, res.accountId);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page admin-auth">
      <div className="auth-card admin-auth-card">
        <div className="admin-auth-brand">
          <img src="/logo.png" alt="" className="admin-auth-logo" />
          <span className="admin-auth-name">StreamBird</span>
          <span className="admin-badge">ADMIN</span>
        </div>
        <h1>{codeSent ? 'Check your email' : 'Sign in'}</h1>
        <p className="admin-subtitle">
          {codeSent ? `Step 2 of 2: enter the 6-digit code we sent to ${email.trim()}.` : 'Step 1 of 2: your admin email and password. A code is emailed next.'}
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            disabled={codeSent}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            disabled={codeSent}
            onChange={(e) => setPassword(e.target.value)}
          />
          {codeSent && (
            <>
              <label htmlFor="code">Code</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" className="admin-auth-submit" disabled={busy || !email.trim() || !password || (codeSent && code.trim().length !== 6)}>
            {busy && <BirdBusy />} {codeSent ? 'Verify and log in' : 'Continue'}
          </button>
          {codeSent && (
            <button type="button" className="link-button" onClick={() => { setCodeSent(false); setCode(''); setError(null); }}>
              Start over
            </button>
          )}
        </form>
        <p className="admin-auth-note">Restricted area. Every admin action is recorded in the audit log.</p>
      </div>
    </div>
  );
}
