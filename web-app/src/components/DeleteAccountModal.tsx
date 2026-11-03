import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { deleteMyAccount, getDeletionPreview, requestDeletionCode } from '../api/accountDeletion';
import type { DeletionPreview } from '../types/api';
import { Button, Input, Modal, Skeleton } from './ui';
import { Notice } from './host/HostKit';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const renewalText = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ` (next renewal ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })})`;
};

/** The lines of the warning, from the counts the server returned (no names or titles). */
function deletionWarnings(p: DeletionPreview): string[] {
  const lines: string[] = [];
  if (!p.isOnlyAdmin) {
    lines.push('Your sign-in, email address and mobile number are removed.');
    lines.push('What you created (streams, connections, brand files) stays with your company account.');
    return lines;
  }
  const others = p.memberCount - 1;
  lines.push('Your whole account is permanently deleted, with everything in it.');
  if (others > 0) lines.push(`${plural(others, 'other person', 'other people')} on this company lose${others === 1 ? 's' : ''} access, and their sign-ins are deleted too.`);
  if (p.liveStream) lines.push('A stream is live right now. It will be ended.');
  if (p.activeSubscription) {
    lines.push(`Your ${p.activeSubscription.plan} autopay is cancelled${renewalText(p.activeSubscription.nextRenewal)}. Any paid time left is lost and not refunded.`);
  }
  lines.push(`${plural(p.connectionsCount, 'connected channel')} are disconnected and their access tokens deleted.`.replace(/^1 connected channel are/, '1 connected channel is'));
  lines.push(`${plural(p.assetsCount, 'uploaded brand file')}, your brand kits, presets, scheduled streams, guest invites and stream history are deleted.`);
  lines.push('Payment records are kept without your name or email, because accounting law requires it.');
  return lines;
}

/**
 * "Delete account" flow in one dialog: shows what will be deleted (from GET /account/delete/preview), emails a
 * confirmation code, takes the code, asks for an explicit tick when it deletes a company that has other people, and
 * only then offers the destructive button.
 */
export function DeleteAccountModal({ open, onClose, onDeleted }: { open: boolean; onClose: () => void; onDeleted: () => void }) {
  const { user } = useAuth();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState('');
  const [confirmCompany, setConfirmCompany] = useState(false);
  const [needsCompanyTick, setNeedsCompanyTick] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The parent mounts this dialog fresh each time it opens, so there is no state to reset here.
    let cancelled = false;
    getDeletionPreview()
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof ApiError ? e.message : 'Could not load what will be deleted. Try again.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const tickRequired = needsCompanyTick || (!!preview?.isOnlyAdmin && preview.memberCount > 1);

  async function sendCode() {
    setSending(true);
    setError(null);
    try {
      await requestDeletionCode();
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send the code. Try again.');
    } finally {
      setSending(false);
    }
  }

  async function submit() {
    setDeleting(true);
    setError(null);
    try {
      await deleteMyAccount(code.trim(), tickRequired && confirmCompany);
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNeedsCompanyTick(true);
      setError(e instanceof ApiError ? e.message : 'Could not delete the account. Try again.');
      setDeleting(false);
    }
  }

  const ready = /^\d{6}$/.test(code.trim()) && (!tickRequired || confirmCompany) && !!preview;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!deleting) onClose();
      }}
      title="Delete your account"
      role="alertdialog"
      testId="delete-account-dialog"
      description="This cannot be undone."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" busy={deleting} disabled={!ready} onClick={() => void submit()}>
            Delete account permanently
          </Button>
        </>
      }
    >
      <div className="acct-del">
        {loadError && <Notice tone="error">{loadError}</Notice>}
        {!preview && !loadError && (
          <div role="status" aria-label="Loading what will be deleted">
            <Skeleton height={96} />
          </div>
        )}
        {preview && (
          <>
            <p className="acct-del-lead">{preview.isOnlyAdmin ? 'You are the owner of this account, so deleting it deletes all of this:' : 'Deleting your account does this:'}</p>
            <ul className="acct-del-list" data-testid="delete-warnings">
              {deletionWarnings(preview).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {tickRequired && (
              <label className="checkbox-row acct-del-tick">
                <input type="checkbox" checked={confirmCompany} onChange={(e) => setConfirmCompany(e.target.checked)} />
                <span>
                  I understand this deletes the whole company account for {preview.memberCount > 1 ? `all ${preview.memberCount} people` : 'everyone'} on it
                </span>
              </label>
            )}

            <div className="acct-del-code">
              {!sent ? (
                <Button variant="secondary" busy={sending} onClick={() => void sendCode()}>
                  Send confirmation code
                </Button>
              ) : (
                <>
                  <p role="status" className="acct-del-sent">
                    We sent a 6-digit code to {user?.email ?? 'your email'}. It expires in 10 minutes.
                  </p>
                  <Input
                    label="Confirmation code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    data-autofocus
                  />
                  <Button variant="ghost" size="sm" busy={sending} onClick={() => void sendCode()}>
                    Send a new code
                  </Button>
                </>
              )}
            </div>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
