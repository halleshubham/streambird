import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as teamApi from '../api/team';
import { BirdLoader } from '../components/BirdLoader';
import { ApiError } from '../api/client';
import type { TeamMember } from '../types/api';
import { BirdBusy } from '../components/BirdBusy';
import { Button, Card, EmptyState, Input, confirm, toast } from '../components/ui';
import { PageHeader } from '../components/host/HostKit';

const ROLE_LABEL: Record<string, string> = { company_admin: 'Admin', user: 'Member', superadmin: 'Superadmin' };

/**
 * Company Admin's own team management -- the backend (TeamController)
 * scopes every one of these calls to the caller's own company/account
 * already, so there's no "which company" concept to plumb through here
 * at all.
 */
export function TeamPage() {
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setMembers(await teamApi.listTeam());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load team.');
    }
  }

  useEffect(() => {
    // Fetching team members on mount -- the textbook useEffect+setState
    // case ("synchronizing with an external system"), not a synchronous
    // mirror of a prop/derivable value: this can only happen via an async
    // network call, never during render itself.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, []);

  if (user?.role !== 'company_admin') {
    return (
      <div className="ha-page page">
        <EmptyState title="Only a Company Admin can manage the team">Ask your company admin to add or remove people.</EmptyState>
      </div>
    );
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await teamApi.inviteTeamMember(email.trim());
      const invited = email.trim();
      setEmail('');
      await load();
      toast.success(`${invited} added to your team`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to invite that email.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId: string, email: string) {
    const ok = await confirm({
      title: `Remove ${email}?`,
      body: "They lose access to your company's connections and brand kits immediately. Their own streams are kept.",
      confirmLabel: 'Remove member',
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(userId);
    setError(null);
    try {
      await teamApi.removeTeamMember(userId);
      await load();
      toast.success(`${email} removed`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove that user.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="ha-page page">
      <PageHeader title="Team" subtitle="People in your company who can stream with your connections and brand kits." />

      <Card as="section" aria-labelledby="invite-title">
        <h2 id="invite-title">Invite a teammate</h2>
        <form className="ha-invite inline-form" style={{ marginTop: 16 }} onSubmit={handleInvite}>
          <Input id="invite-email" label="Email" type="email" required placeholder="teammate@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" busy={busy} disabled={!email.trim()} style={{ marginBottom: 2 }}>
            Invite
          </Button>
        </form>
        {error && (
          <p className="ha-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
      </Card>

      <Card as="section" aria-labelledby="members-title">
        <h2 id="members-title">Members</h2>
        {members === null ? (
          <BirdLoader loading compact label="Loading your team…" />
        ) : members.length === 0 ? (
          <p className="ha-muted" style={{ marginTop: 6 }}>
            No team members yet. Invite a teammate above.
          </p>
        ) : (
          <div className="ha-table-wrap table-scroll" style={{ marginTop: 12 }}>
            <table className="ha-table data-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Added</th>
                  <th scope="col">
                    <span className="ui-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td className="ha-b">
                      {m.email}
                      {m.email === user?.email && <span className="ha-sm ha-muted" style={{ fontWeight: 400 }}> (you)</span>}
                    </td>
                    <td>
                      <span className="ha-tag">{ROLE_LABEL[m.role] ?? m.role}</span>
                    </td>
                    <td>{new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td style={{ textAlign: 'right' }}>
                      {m.role === 'user' && (
                        <button
                          type="button"
                          className="ha-quiet ha-quiet--danger"
                          aria-label={`Remove ${m.email}`}
                          disabled={removingId !== null}
                          onClick={() => void handleRemove(m.id, m.email)}
                        >
                          {removingId === m.id && <BirdBusy />} Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
