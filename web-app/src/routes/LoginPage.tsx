import { useState } from 'react';
import { CookieSettingsLink } from '../components/CookieSettingsLink';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { DocsLink } from '../components/DocsLink';
import { FacebookLogo, GoogleLogo } from '../components/AuthLogos';
import { AuthHeading, AuthLayout } from '../components/PublicLayout';
import { Button, Input, buttonClass } from '../components/ui';

const GOOGLE_OAUTH_ERRORS: Record<string, string> = {
  google_oauth_failed: 'Google sign-in failed. Please try again.',
  google_email_unverified: "Your Google account's email isn't verified, so we can't use it.",
  facebook_oauth_failed: 'Facebook sign-in failed. Please try again.',
  facebook_email_missing:
    "Facebook didn't share an email address with us. Allow email access, or use another sign-in method.",
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
    <AuthLayout>
      <div className="pub-auth-col">
        {step === 'email' && (
          <>
            <AuthHeading title="Welcome back" lead="Enter your email and we'll send you a one-time login code." />
            <div className="pub-auth-card">
              <form onSubmit={handleRequestCode} className="pub-form">
                <Input
                  id="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  error={error}
                />
                <Button type="submit" size="lg" block busy={busy} disabled={!email.trim()}>
                  Send login code
                </Button>
              </form>

              <div className="auth-divider">or</div>

              <div className="pub-form">
                <a className={buttonClass('secondary', 'lg', 'ui-btn--block')} href={authApi.googleLoginUrl()}>
                  <GoogleLogo /> Sign in with Google
                </a>
                <a className={buttonClass('secondary', 'lg', 'ui-btn--block')} href={authApi.facebookLoginUrl()}>
                  <FacebookLogo /> Continue with Facebook
                </a>
              </div>
            </div>
            <p className="pub-auth-alt">
              New company? <Link to="/signup-company">Create your company account</Link>
            </p>
          </>
        )}

        {step === 'code' && (
          <>
            <AuthHeading
              title="Check your email"
              lead={
                <>
                  We sent a 6-digit code to <strong>{email}</strong>.
                </>
              }
            />
            <div className="pub-auth-card">
              <form onSubmit={handleVerifyCode} className="pub-form">
                <Input
                  id="code"
                  label="Login code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="pub-code-input"
                  autoFocus
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  error={error}
                />
                <Button type="submit" size="lg" block busy={busy} disabled={code.length !== 6}>
                  Log in
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                  }}
                >
                  Use a different email
                </Button>
              </form>
            </div>
          </>
        )}

        <p className="auth-legal-links">
          <DocsLink /> · <Link to="/privacy">Privacy Policy</Link> · <Link to="/terms">Terms of Service</Link>
          <CookieSettingsLink />
        </p>
      </div>
    </AuthLayout>
  );
}
