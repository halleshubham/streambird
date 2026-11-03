import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { setPhone } from '../api/auth';
import { ApiError } from '../api/client';
import { AuthHeading, AuthLayout } from '../components/PublicLayout';
import { Button, Input } from '../components/ui';

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
    <AuthLayout
      headerAction={
        <Button variant="ghost" disabled={busy} onClick={() => void logout()}>
          Log out
        </Button>
      }
    >
      <div className="pub-auth-col">
        <AuthHeading
          title="One last thing"
          lead={
            <>
              What is the best mobile number to reach you on{user ? ` (${user.email})` : ''}? We only use it to help with
              your account and setup, never for marketing.
            </>
          }
        />
        <div className="pub-auth-card">
          <form onSubmit={submit} className="pub-form">
            <Input
              id="phone"
              label="Mobile number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              required
              value={phone}
              onChange={(e) => setPhoneText(e.target.value)}
              placeholder="98765 43210"
              hint="Indian numbers need no country code. For any other country, start with + and the code."
              error={error}
            />
            <Button type="submit" size="lg" block busy={busy} disabled={!phone.trim()}>
              Continue
            </Button>
          </form>
        </div>
      </div>
    </AuthLayout>
  );
}
