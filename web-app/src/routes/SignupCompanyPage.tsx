import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { AuthHeading, AuthLayout } from '../components/PublicLayout';
import { Button, Input } from '../components/ui';

/**
 * Distinct sign-up path for a brand-new company (vs. the plain magic-code
 * LoginPage, which is for an already-existing identity -- either a
 * returning solo user or an invited team member). Reuses the SAME
 * request-code endpoint as magic-code login for step 1 (it's identical:
 * "email me a 6-digit code"), then calls the distinct signup-company
 * endpoint for step 2, which actually creates the Company + Account +
 * unapproved company_admin User.
 */
export function SignupCompanyPage() {
  const { status, setSession } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<'details' | 'code'>('details');
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleCreateCompany(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.signupCompany(companyName.trim(), email.trim(), code.trim());
      setSession(res.user, res.accountId);
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
        <AuthHeading
          eyebrow={step === 'details' ? 'Step 1 of 2' : 'Step 2 of 2'}
          title="Create your company account"
          lead={
            step === 'details' ? (
              "Set up StreamBird for your company. You'll be the first admin."
            ) : (
              <>
                We sent a 6-digit code to <strong>{email}</strong>.
              </>
            )
          }
        />
        <div className="pub-auth-card">
          {step === 'details' && (
            <form onSubmit={handleRequestCode} className="pub-form">
              <Input
                id="companyName"
                label="Company name"
                type="text"
                autoComplete="organization"
                autoFocus
                required
                maxLength={200}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme Inc"
              />
              <Input
                id="email"
                label="Your email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@acme.com"
                error={error}
              />
              <Button type="submit" size="lg" block busy={busy} disabled={!companyName.trim() || !email.trim()}>
                Send verification code
              </Button>
              <p className="pub-fine">
                By continuing you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.
              </p>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleCreateCompany} className="pub-form">
              <Input
                id="code"
                label="Verification code"
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
                Create company account
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStep('details');
                  setCode('');
                  setError(null);
                }}
              >
                Back to details
              </Button>
            </form>
          )}
        </div>
        <p className="pub-auth-alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
