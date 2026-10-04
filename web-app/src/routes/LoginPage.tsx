import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { BirdBusy } from '../components/BirdBusy';
import { DocsLink } from '../components/DocsLink';

const GOOGLE_OAUTH_ERRORS: Record<string, string> = {
  google_oauth_failed: 'Google sign-in failed. Please try again.',
  google_email_unverified: "Your Google account's email isn't verified, so we can't use it.",
  facebook_oauth_failed: 'Facebook sign-in failed. Please try again.',
  facebook_email_missing:
    "Facebook didn't share an email address with us. Allow email access, or use another sign-in method.",
};

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}

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
              <GoogleLogo /> Sign in with Google
            </a>
            <a className="button-like google-button" href={authApi.facebookLoginUrl()} style={{ marginTop: 10 }}>
              <FacebookLogo /> Continue with Facebook
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
          <DocsLink /> · <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
        </p>
      </div>
    </div>
  );
}
