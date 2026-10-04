import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import * as authApi from '../api/auth';
import { ApiError } from '../api/client';
import { BirdBusy } from '../components/BirdBusy';

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
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="StreamBird" className="auth-logo" />
        <h1>Create your company account</h1>

        {step === 'details' && (
          <form onSubmit={handleRequestCode}>
            <p>Set up StreamBird for your company. You'll be the first admin.</p>
            <label htmlFor="companyName">Company name</label>
            <input
              id="companyName"
              type="text"
              autoFocus
              required
              maxLength={200}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Inc"
            />
            <label htmlFor="email">Your email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@acme.com"
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy || !companyName.trim() || !email.trim()}>
              {busy && <BirdBusy />} Send verification code
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleCreateCompany}>
            <p>
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <label htmlFor="code">Verification code</label>
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
              {busy && <BirdBusy />} Create company account
            </button>
          </form>
        )}

        <p>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
