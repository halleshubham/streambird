import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { setPhone } from '../api/auth';
import { ApiError } from '../api/client';
import { BirdBusy } from '../components/BirdBusy';

/**
 * Shown once, right after a brand-new sign-up (see ProtectedRoute and `needsPhone` on GET /auth/me): asks for a
 * mobile number so the team can reach the person. Accounts created before the number was collected never see it.
 */
export function PhoneStepPage() {
  const { user, setSession, accountId, logout } = useAuth();
  const [phone, setPhoneText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await setPhone(phone.trim());
      setSession(res.user, res.accountId ?? accountId ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your number.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/logo.png" alt="StreamBird" className="auth-logo" />
        <h1>One last thing</h1>
        <form onSubmit={submit}>
          <p>
            What is the best mobile number to reach you on{user ? ` (${user.email})` : ''}? We only use it to help with your
            account and setup, never for marketing.
          </p>
          <label htmlFor="phone">Mobile number</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            required
            value={phone}
            onChange={(e) => setPhoneText(e.target.value)}
            placeholder="98765 43210 or +1 415 555 2671"
          />
          <p className="field-hint">Indian numbers need no country code. For any other country, start with + and the code.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !phone.trim()}>
            {busy && <BirdBusy />} Continue
          </button>
          <button type="button" className="link-button" disabled={busy} onClick={() => void logout()}>
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}
