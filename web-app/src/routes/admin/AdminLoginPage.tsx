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
    <div className="auth-page">
      <div className="auth-card">
        <h1>StreamBird Admin</h1>
        <form onSubmit={handleSubmit}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
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
            required
            value={password}
            disabled={codeSent}
            onChange={(e) => setPassword(e.target.value)}
          />
          {codeSent && (
            <>
              <p>We emailed a 6-digit code to {email.trim()}.</p>
              <label htmlFor="code">Code</label>
              <input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </>
          )}
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || !email.trim() || !password || (codeSent && code.trim().length !== 6)}>
            {busy && <BirdBusy />} {codeSent ? 'Verify and log in' : 'Continue'}
          </button>
          {codeSent && (
            <button type="button" className="link" onClick={() => { setCodeSent(false); setCode(''); setError(null); }}>
              Start over
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
