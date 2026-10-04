import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { BirdBusy } from '../components/BirdBusy';

const GOOGLE_OAUTH_ERRORS: Record<string, string> = {
  google_oauth_failed: 'Google sign-in failed. Please try again.',
  google_email_unverified: "Your Google account's email isn't verified, so we can't use it.",
};

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    () => GOOGLE_OAUTH_ERRORS[searchParams.get('error') ?? ''] ?? null,
  );

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleRequestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.requestCode(email.trim());
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), code.trim());
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="StreamBird" className="auth-logo" />
        <h1>StreamBird</h1>

        {step === 'email' && (
          <>
            <form onSubmit={handleRequestCode}>
              <p>Enter your email and we'll send you a one-time login code.</p>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              {error && <p className="error">{error}</p>}
              <button type="submit" disabled={busy || !email.trim()}>
                {busy && <BirdBusy />} Send login code
              </button>
            </form>

            <div className="auth-divider">or</div>

            <a className="button-like google-button" href={authApi.googleLoginUrl()}>
              Sign in with Google
            </a>

            <p>
              New company? <Link to="/signup-company">Create your company account</Link>
            </p>
          </>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode}>
            <p>
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <label htmlFor="code">Login code</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoFocus
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy || code.length !== 6}>
              {busy && <BirdBusy />} Log in
            </button>
            <button
              type="button"
              className="link-button"
              disabled={busy}
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}

        <p className="auth-legal-links">
          <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}
