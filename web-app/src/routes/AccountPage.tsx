import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMyAccount } from '../api/accounts';
import type { Account } from '../types/api';
import { Button, Card, toast } from '../components/ui';
import { PageHeader } from '../components/host/HostKit';
import { DeleteAccountModal } from '../components/DeleteAccountModal';
import '../styles/account.css';

const ROLE_LABEL: Record<string, string> = { company_admin: 'Company admin', user: 'Member', superadmin: 'Administrator' };

/** The signed-in person's own details, and the danger zone: deleting the account (Google Play / GDPR / DPDP). */
export function AccountPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getMyAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  // A solo account is named after the email address; only a company has a name worth showing.
  const company = account && account.name !== user?.email ? account.name : null;

  function onDeleted() {
    setDeleting(false);
    toast.success('Your account was deleted');
    // Land on the public page. The session is already gone on the server; the auth state is refreshed from THAT page
    // (see AccountDeletedPage). Refreshing here races the navigation: a fast 401 flips this protected page to
    // 'anonymous' before the router has moved, and it redirects to /login instead.
    navigate('/account-deleted', { replace: true });
  }

  return (
    <div className="ha-page page">
      <PageHeader title="Account" subtitle="Your sign-in details and account controls." />

      <Card aria-labelledby="acct-details">
        <h2 id="acct-details">Your details</h2>
        <dl className="acct-details">
          <div>
            <dt>Email</dt>
            <dd data-testid="account-email">{user?.email}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{company ?? 'Personal account'}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{ROLE_LABEL[user?.role ?? 'user'] ?? 'Member'}</dd>
          </div>
        </dl>
      </Card>

      <Card className="acct-danger" aria-labelledby="acct-delete">
        <h2 id="acct-delete">Delete account</h2>
        <p>
          Permanently delete your account and the data linked to it. We email you a code first, and you see exactly what will be removed before anything
          is. <Link to="/delete-account">How deletion works</Link>.
        </p>
        <div>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete account
          </Button>
        </div>
      </Card>

      {deleting && <DeleteAccountModal open onClose={() => setDeleting(false)} onDeleted={onDeleted} />}
    </div>
  );
}
