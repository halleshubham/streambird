import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, Copy, ExternalLink, ImagePlus, Pencil, Play, Trash2, UserPlus, X } from 'lucide-react';
import {
  addScheduleGuests,
  cancelSchedule,
  deleteScheduledStream,
  getSchedule,
  removeScheduleGuest,
  removeScheduleThumbnail,
  scheduleThumbnailUrl,
  uploadScheduleThumbnail,
  resendScheduleInvite,
  startStream,
  updateSchedule,
} from '../api/streams';
import { ApiError } from '../api/client';
import { BirdLoader } from './BirdLoader';
import { GuestEmailsField } from './GuestEmailsField';
import { PlatformTile, Notice } from './host/HostKit';
import { thumbnailProblem } from './ThumbnailPicker';
import { DURATION_OPTIONS, formatWhen, parseEmails, toLocalInputValue } from '../lib/schedule';
import type { ScheduleDetail } from '../types/api';
import { BirdBusy } from './BirdBusy';
import { Button, Card, Field, Input, SelectField, TextArea, buttonClass, confirm } from './ui';
import { initialsFor } from './ui/helpers';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Everything about a scheduled (not yet started) stream: when it is, who is
 * invited, copy/resend invitations, edit, start now, cancel.
 */
export function ScheduledStreamPanel({
  streamId,
  initialNotice,
  shapeLabel,
}: {
  streamId: string;
  initialNotice?: { text: string; isError: boolean } | null;
  shapeLabel?: string;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ScheduleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState(initialNotice ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [newGuests, setNewGuests] = useState('');
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const thumbInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSchedule(streamId)
      .then(setDetail)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load the schedule.'));
  }, [streamId]);

  const run = useCallback(
    async (key: string, fn: () => Promise<ScheduleDetail | void>, success?: (d: ScheduleDetail | void) => string | null) => {
      setBusy(key);
      setError(null);
      try {
        const result = await fn();
        if (result) {
          setDetail(result);
          const failures = result.emailFailures ?? [];
          const warnings = result.platformWarnings ?? [];
          if (failures.length > 0 || warnings.length > 0) {
            setNotice({
              text: [failures.length > 0 ? `Couldn't send to: ${failures.join(', ')}. Use "Resend" to try again.` : '', ...warnings].filter(Boolean).join(' '),
              isError: true,
            });
            return;
          }
        }
        const message = success?.(result);
        if (message) setNotice({ text: message, isError: false });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  async function handleCopy(text: string, label: string) {
    if (await copyText(text)) {
      setCopyFallback(null);
      setNotice({ text: `${label} copied to the clipboard.`, isError: false });
    } else {
      setCopyFallback(text);
      setNotice({ text: 'Your browser blocked copying -- select the text below and copy it manually.', isError: true });
    }
  }

  if (error && !detail) return <p className="error">{error}</p>;
  if (!detail) return <BirdLoader loading compact label="Loading the schedule…" />;

  const overdue = new Date(detail.scheduledAt).getTime() < Date.now();
  const duration = DURATION_OPTIONS.find((d) => d.value === detail.durationMinutes)?.label ?? (detail.durationMinutes ? `${detail.durationMinutes} min` : null);

  async function handleAddGuests(e: FormEvent) {
    e.preventDefault();
    const { valid, invalid } = parseEmails(newGuests);
    if (invalid.length > 0) return setError(`Fix these email addresses first: ${invalid.join(', ')}`);
    if (valid.length === 0) return setError('Enter at least one email address.');
    await run('add', () => addScheduleGuests(streamId, valid), () => {
      setNewGuests('');
      return `Invited ${valid.length} ${valid.length === 1 ? 'guest' : 'guests'}.`;
    });
  }

  const cancelStream = () => {
    const n = detail.guests.length;
    const onPlatforms = detail.destinations.some((d) => d.onPlatform) ? ' It will also be removed from the platforms.' : '';
    const body = n > 0 ? `${n} invited ${n === 1 ? 'guest' : 'guests'} will get a cancellation email.${onPlatforms}` : `Nobody has been invited yet.${onPlatforms}`;
    void confirm({ title: 'Cancel this stream?', body, confirmLabel: 'Cancel stream', cancelLabel: 'Keep stream', destructive: true }).then((ok) => {
      if (!ok) return;
      void run('cancel', async () => {
        await cancelSchedule(streamId);
        navigate('/dashboard');
      });
    });
  };

  const deleteStream = () => {
    void confirm({
      title: 'Delete this stream?',
      body: `Your guests will not be emailed and the invitation link stops working.${detail.destinations.some((d) => d.onPlatform) ? ' It will also be removed from the platforms.' : ''} This cannot be undone.`,
      confirmLabel: 'Delete stream',
      cancelLabel: 'Keep stream',
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      void run('delete', async () => {
        await deleteScheduledStream(streamId);
        navigate('/streams/upcoming');
      });
    });
  };

  return (
    <div className="scheduled-panel ha-stack">
      {notice && (
        <Notice tone={notice.isError ? 'error' : 'success'} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      {error && (
        <p className="ha-error" role="alert">
          {error}
        </p>
      )}
      {overdue && (
        <Notice tone="warning">
          This stream's start time has passed and it was never started. Start it now, change the time under Edit details, or delete it.
        </Notice>
      )}

      <Card as="section" aria-label="When and where">
        <div className="ha-row ha-row--wrap" style={{ alignItems: 'flex-start' }}>
          <div className="ha-list-main">
            <p className="ha-b" style={{ fontSize: 17 }}>
              {formatWhen(detail.scheduledAt, detail.timezone)}
            </p>
            <p className="ha-sm ha-muted">
              {duration ? `About ${duration.toLowerCase()} · ` : ''}scheduled in {detail.timezone}
            </p>
          </div>
          <div className="ha-actions">
            <Button variant="secondary" icon={editing ? <X size={16} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />} onClick={() => setEditing((v) => !v)}>
              {editing ? 'Close editor' : 'Edit details'}
            </Button>
            <Button icon={<Clapperboard size={16} aria-hidden="true" />} onClick={() => navigate(`/streams/${streamId}/studio`)}>
              Open studio
            </Button>
          </div>
        </div>
        {detail.description && <p style={{ marginTop: 12 }}>{detail.description}</p>}
        {detail.guestNotes && (
          <p className="ha-hint">
            <strong>Note to guests:</strong> {detail.guestNotes}
          </p>
        )}
        <div className="ha-actions" style={{ marginTop: 12, marginLeft: -10 }}>
          <button type="button" className="ha-quiet" disabled={busy !== null} onClick={() => void run('start', async () => { await startStream(streamId); navigate(`/streams/${streamId}/studio`); })}>
            {busy === 'start' ? <BirdBusy /> : <Play size={16} aria-hidden="true" />} Start stream now
          </button>
          <button type="button" className="ha-quiet" disabled={busy !== null} onClick={cancelStream}>
            <Trash2 size={16} aria-hidden="true" /> Cancel stream
          </button>
          {overdue && (
            <button type="button" className="ha-quiet ha-quiet--danger" disabled={busy !== null} title="Removes it without emailing your guests" onClick={deleteStream}>
              {busy === 'delete' ? <BirdBusy /> : <Trash2 size={16} aria-hidden="true" />} Delete (no emails)
            </button>
          )}
        </div>
      </Card>

      {editing && (
        <EditSchedule
          detail={detail}
          busy={busy === 'save'}
          onSave={(patch, notify) =>
            run('save', () => updateSchedule(streamId, { ...patch, notifyGuests: notify }), () => {
              setEditing(false);
              return notify && detail.guests.length > 0 ? 'Saved -- your guests were emailed the update.' : 'Saved.';
            })
          }
        />
      )}

      <div className="ha-detail-grid">
        <div className="ha-stack">
          <Card as="section" aria-labelledby="inv-title">
            <h2 id="inv-title">Invitation</h2>
            <p className="ha-sm ha-muted" style={{ marginTop: 4 }}>
              Share this with anyone, or invite specific people by email below. The join link works in any modern browser, no account needed.
            </p>
            <div className="ha-actions" style={{ marginTop: 14 }}>
              <Button variant="secondary" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void handleCopy(detail.invitationText, 'Invitation')}>
                Copy invitation
              </Button>
              {detail.generalJoinUrl && (
                <Button variant="ghost" icon={<Copy size={14} aria-hidden="true" />} onClick={() => void handleCopy(detail.generalJoinUrl!, 'Join link')}>
                  Copy join link only
                </Button>
              )}
            </div>
            {detail.passwordProtected && <p className="ha-hint">Password-protected -- the password is never included; share it yourself.</p>}
            {copyFallback && <textarea className="copy-fallback ui-input" readOnly rows={8} value={copyFallback} onFocus={(e) => e.currentTarget.select()} />}
          </Card>

          <Card as="section" aria-labelledby="guests-title">
            <div className="ha-section-head" style={{ marginBottom: 0 }}>
              <h2 id="guests-title">Guests</h2>
              <span className="ha-sm ha-muted">{detail.guests.length} invited</span>
            </div>
            {detail.guests.length === 0 ? (
              <p className="ha-sm ha-muted" style={{ marginTop: 6 }}>
                No one invited by email yet.
              </p>
            ) : (
              <ul className="ha-list" style={{ marginTop: 8 }}>
                {detail.guests.map((g) => (
                  <li key={g.id} >
                    <span className="ha-avatar" aria-hidden="true">
                      {initialsFor(g.email)}
                    </span>
                    <div className="ha-list-main">
                      <h3>{g.email}</h3>
                      <p>{g.emailedAt ? `Invite sent ${new Date(g.emailedAt).toLocaleDateString()}` : 'Not sent'}</p>
                    </div>
                    <div className="ha-list-actions">
                      <button type="button" className="ha-quiet" onClick={() => void handleCopy(g.joinUrl, `${g.email}'s link`)}>
                        Copy link
                      </button>
                      <button type="button" className="ha-quiet" disabled={busy !== null} onClick={() => void run(`resend-${g.id}`, () => resendScheduleInvite(streamId, g.id), () => `Invitation re-sent to ${g.email}.`)}>
                        {busy === `resend-${g.id}` && <BirdBusy />} Resend
                      </button>
                      <button
                        type="button"
                        className="ha-quiet ha-quiet--danger"
                        disabled={busy !== null}
                        aria-label={`Remove ${g.email}`}
                        onClick={() => {
                          void confirm({
                            title: `Remove ${g.email}?`,
                            body: 'Their personal join link stops working. You can invite them again later.',
                            confirmLabel: 'Remove guest',
                            destructive: true,
                          }).then((ok) => {
                            if (ok) void run(`rm-${g.id}`, () => removeScheduleGuest(streamId, g.id));
                          });
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={handleAddGuests} className="ha-form" style={{ marginTop: 16 }}>
              <Field label="Invite more guests" id="add-guests">
                {() => <GuestEmailsField id="add-guests" value={newGuests} onChange={setNewGuests} rows={2} />}
              </Field>
              <div>
                <Button type="submit" variant="secondary" busy={busy === 'add'} disabled={busy !== null} icon={<UserPlus size={16} aria-hidden="true" />}>
                  Send invites
                </Button>
              </div>
            </form>
          </Card>
        </div>

        <div className="ha-stack">
          <Card as="section" aria-labelledby="where-title">
            <h2 id="where-title">Destinations</h2>
            <p className="ha-hint">
              <strong>Only YouTube can have a live stream scheduled ahead of time.</strong> Other destinations (Facebook, Twitch) are created when you start the stream.
            </p>
            <ul className="ha-list" style={{ marginTop: 8 }}>
              {detail.destinations.map((d) => (
                <li key={d.id} style={{ flexWrap: 'wrap' }}>
                  <PlatformTile platform={d.platform} size={36} />
                  <div className="ha-list-main">
                    <h3>{d.label}</h3>
                    <p>{d.onPlatform ? 'Created on the platform' : d.canPrecreate ? 'Not created yet' : 'Created at start'}</p>
                    {d.errorMessage && !d.onPlatform && <p className="ha-dest-fail">{d.errorMessage}</p>}
                  </div>
                  {d.watchUrl && (
                    <div className="ha-list-actions">
                      <a href={d.watchUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
                        <ExternalLink size={14} aria-hidden="true" /> Watch page
                      </a>
                      <button type="button" className="ha-quiet" onClick={() => void handleCopy(d.watchUrl!, 'Watch link')}>
                        <Copy size={14} aria-hidden="true" /> Copy link
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {detail.destinations.some((d) => d.canPrecreate) && (
              <div className="precreate-toggle" style={{ marginTop: 12 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  busy={busy === 'precreate'}
                  disabled={busy !== null}
                  onClick={() =>
                    void run(
                      'precreate',
                      () => updateSchedule(streamId, { createOnPlatforms: !detail.precreateOnPlatforms, notifyGuests: true }),
                      () =>
                        detail.precreateOnPlatforms
                          ? 'Removed the broadcasts from the platforms. They will be created when you start the stream.'
                          : 'Created on the platforms. The watch links are in your guests\' invitations.',
                    )
                  }
                >
                  {detail.precreateOnPlatforms ? 'Remove from platforms until start' : 'Create on platforms now'}
                </Button>
                <p className="ha-hint">
                  {detail.precreateOnPlatforms
                    ? 'YouTube shows this as an upcoming stream. Editing, cancelling or deleting here keeps it in sync.'
                    : 'YouTube can show this as an upcoming stream with a watch link for your guests. (Facebook no longer supports scheduled live videos, so it is created when you start.)'}
                </p>
              </div>
            )}
          </Card>

          <Card as="section" aria-labelledby="th-title">
            <h2 id="th-title">Thumbnail</h2>
            <div className="thumbnail-picker ha-stack" style={{ gap: 16, marginTop: 12 }}>
              {detail.hasThumbnail ? (
                <img className="thumbnail-img ha-thumb" src={scheduleThumbnailUrl(streamId, detail.thumbnailUpdatedAt)} alt="Stream thumbnail" />
              ) : (
                <div className="ha-thumb" role="img" aria-label="No thumbnail yet">
                  No thumbnail yet
                </div>
              )}
              <div className="ha-actions">
                <Button variant="secondary" busy={busy === 'thumb'} disabled={busy !== null} icon={<ImagePlus size={16} aria-hidden="true" />} onClick={() => thumbInput.current?.click()}>
                  {detail.hasThumbnail ? 'Replace thumbnail' : 'Upload thumbnail'}
                </Button>
                {detail.hasThumbnail && (
                  <button type="button" className="ha-quiet ha-quiet--danger" disabled={busy !== null} onClick={() => void run('thumb-rm', () => removeScheduleThumbnail(streamId), () => 'Thumbnail removed.')}>
                    Remove
                  </button>
                )}
              </div>
              <input
                ref={thumbInput}
                type="file"
                accept="image/jpeg,image/png"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const problem = thumbnailProblem(file);
                  if (problem) return setError(problem);
                  void run('thumb', () => uploadScheduleThumbnail(streamId, file), () => 'Thumbnail saved and sent to the platforms.');
                }}
              />
              <p className="ha-hint">
                JPG or PNG, up to 2 MB, 1280×720 (16:9) recommended. It is sent to YouTube (which needs a verified channel for custom thumbnails) and, best effort, to Facebook, also on a broadcast created later, e.g. at start. Twitch doesn't take a thumbnail from here.
              </p>
            </div>
          </Card>

          <Card as="section" aria-labelledby="det-title">
            <h2 id="det-title">Details</h2>
            <dl className="ha-kv" style={{ marginTop: 12 }}>
              <dt>Destinations</dt>
              <dd>{detail.destinations.map((d) => d.label).join(', ')}</dd>
              {detail.visibility && (
                <>
                  <dt>Visibility</dt>
                  <dd style={{ textTransform: 'capitalize' }}>{detail.visibility}</dd>
                </>
              )}
              {shapeLabel && (
                <>
                  <dt>Shape</dt>
                  <dd>{shapeLabel}</dd>
                </>
              )}
              <dt>Password</dt>
              <dd>{detail.passwordProtected ? 'Required to join' : 'None'}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}


function EditSchedule({
  detail,
  busy,
  onSave,
}: {
  detail: ScheduleDetail;
  busy: boolean;
  onSave: (
    patch: { title: string; description: string; scheduledAt: string; durationMinutes: number; guestNotes: string; visibility?: 'public' | 'unlisted' | 'private' },
    notifyGuests: boolean,
  ) => Promise<void>;
}) {
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? '');
  const [whenLocal, setWhenLocal] = useState(toLocalInputValue(new Date(detail.scheduledAt)));
  const [duration, setDuration] = useState(detail.durationMinutes ?? 60);
  const [notes, setNotes] = useState(detail.guestNotes ?? '');
  const [notify, setNotify] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const when = new Date(whenLocal);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
      setFormError('Pick a start time in the future.');
      return;
    }
    setFormError(null);
    void onSave(
      { title: title.trim() || detail.title, description: description.trim(), scheduledAt: when.toISOString(), durationMinutes: duration, guestNotes: notes.trim(), visibility: detail.visibility ?? undefined },
      notify,
    );
  }

  return (
    <Card as="form" onSubmit={submit} className="ha-form" aria-label="Edit details">
      <h2>Edit details</h2>
      <Input id="edit-title" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <TextArea id="edit-desc" label="Description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="ha-form-grid">
        <Input
          id="edit-when"
          label="Date and time"
          type="datetime-local"
          value={whenLocal}
          min={toLocalInputValue(new Date())}
          onChange={(e) => setWhenLocal(e.target.value)}
          required
          hint={`Times are in your browser's zone. This stream is scheduled in ${detail.timezone}.`}
        />
        <SelectField id="edit-duration" label="Expected duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {DURATION_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </SelectField>
      </div>
      <TextArea id="edit-notes" label="Message to guests" rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      {detail.guests.length > 0 && (
        <label className="ha-check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email my {detail.guests.length} invited {detail.guests.length === 1 ? 'guest' : 'guests'} about changes
        </label>
      )}
      {formError && (
        <p className="ha-error" role="alert">
          {formError}
        </p>
      )}
      <div>
        <Button type="submit" busy={busy}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}
