import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import * as teamApi from '../api/team';
import { BirdLoader } from '../components/BirdLoader';
import { ApiError } from '../api/client';
import type { TeamMember } from '../types/api';

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
    void load();
  }, []);

  if (user?.role !== 'company_admin') {
    return (
      <div className="page">
        <p>Only a Company Admin can manage the team.</p>
      </div>
    );
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await teamApi.inviteTeamMember(email.trim());
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to invite that email.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId: string, email: string) {
    if (!window.confirm(`Remove ${email} from your team? They'll immediately lose access.`)) return;
    setRemovingId(userId);
    setError(null);
    try {
      await teamApi.removeTeamMember(userId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove that user.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="page">
      <h1>Team</h1>
      <p>Add or remove people from your company's StreamBird account.</p>

      <form className="inline-form" onSubmit={handleInvite}>
        <input
          type="email"
          required
          placeholder="teammate@yourcompany.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" disabled={busy || !email.trim()}>
          Invite
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      {members === null ? (
        <BirdLoader loading compact label="Loading your team…" />
      ) : members.length === 0 ? (
        <p>No team members yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.email}</td>
                <td>
                  <span className="badge">{m.role}</span>
                </td>
                <td>
                  {m.role === 'user' && (
                    <button
                      type="button"
                      className="danger-button"
                      disabled={removingId !== null}
                      onClick={() => void handleRemove(m.id, m.email)}
                    >
                      {removingId === m.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
