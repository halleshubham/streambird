import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Clapperboard, Copy, ExternalLink, ImagePlus, Mail, Pencil, Play, Trash2, UserPlus, X } from 'lucide-react';
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
import { PlatformBadge } from './PlatformBadge';
import { thumbnailProblem } from './ThumbnailPicker';
import { DURATION_OPTIONS, formatWhen, parseEmails, toLocalInputValue } from '../lib/schedule';
import type { ScheduleDetail } from '../types/api';

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
}: {
  streamId: string;
  initialNotice?: { text: string; isError: boolean } | null;
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

  return (
    <div className="scheduled-panel">
      {notice && <p className={`notice${notice.isError ? ' error' : ''}`}>{notice.text}</p>}
      {error && <p className="error">{error}</p>}

      {overdue && (
        <p className="notice error">
          This stream's start time has passed and it was never started. Start it now, change the time under Edit details, or delete it.
        </p>
      )}

      <div className="panel scheduled-summary">
        <div className="scheduled-when">
          <CalendarClock size={18} />
          <div>
            <strong>{formatWhen(detail.scheduledAt, detail.timezone)}</strong>
            <div className="field-hint">
              {duration ? `About ${duration.toLowerCase()} · ` : ''}scheduled in {detail.timezone}
            </div>
          </div>
        </div>
        {detail.description && <p>{detail.description}</p>}
        {detail.guestNotes && (
          <p className="field-hint">
            <strong>Note to guests:</strong> {detail.guestNotes}
          </p>
        )}
        <div className="destination-status-list">
          {detail.destinations.map((d) => (
            <div key={d.id} className="destination-status-row">
              <span className="destination-checkbox">
                <PlatformBadge platform={d.platform} /> {d.label}
              </span>
              {d.onPlatform ? (
                <span className="badge badge-accent">Created on the platform</span>
              ) : (
                <span className="badge">{d.canPrecreate ? 'Not created yet' : 'Created at start'}</span>
              )}
              {d.watchUrl && (
                <>
                  <a href={d.watchUrl} target="_blank" rel="noopener noreferrer" className="icon-btn icon-btn--small">
                    <ExternalLink size={14} /> Watch page
                  </a>
                  <button type="button" className="icon-btn icon-btn--small" onClick={() => void handleCopy(d.watchUrl!, 'Watch link')}>
                    <Copy size={14} /> Copy link
                  </button>
                </>
              )}
              {d.errorMessage && !d.onPlatform && <span className="field-hint error">{d.errorMessage}</span>}
            </div>
          ))}
          {detail.visibility && <span className="field-hint">Visibility: {detail.visibility}</span>}
          {detail.destinations.some((d) => d.canPrecreate) && (
            <div className="precreate-toggle">
              <button
                type="button"
                className="icon-btn icon-btn--small"
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
                {busy === 'precreate' ? 'Working…' : detail.precreateOnPlatforms ? 'Remove from platforms until start' : 'Create on platforms now'}
              </button>
              <p className="field-hint">
                {detail.precreateOnPlatforms
                  ? 'YouTube/Facebook show this as an upcoming stream. Editing, cancelling or deleting here keeps them in sync.'
                  : 'YouTube and Facebook can show this as an upcoming stream with a watch link for your guests.'}
              </p>
            </div>
          )}
        </div>

        <div className="scheduled-actions">
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            disabled={busy !== null}
            onClick={() =>
              void run('start', async () => {
                await startStream(streamId);
                navigate(`/streams/${streamId}/studio`);
              })
            }
          >
            <Play size={16} /> {busy === 'start' ? 'Starting…' : 'Start stream now'}
          </button>
          <button type="button" className="icon-btn" onClick={() => navigate(`/streams/${streamId}/studio`)}>
            <Clapperboard size={16} /> Open studio
          </button>
          <button type="button" className="icon-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? <X size={16} /> : <Pencil size={16} />} {editing ? 'Close editor' : 'Edit details'}
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            disabled={busy !== null}
            onClick={() => {
              const n = detail.guests.length;
              const onPlatforms = detail.destinations.some((d) => d.onPlatform) ? ' It will also be removed from the platforms.' : '';
              const msg = n > 0 ? `Cancel this stream? ${n} invited ${n === 1 ? 'guest' : 'guests'} will get a cancellation email.${onPlatforms}` : `Cancel this stream?${onPlatforms}`;
              if (!window.confirm(msg)) return;
              void run('cancel', async () => {
                await cancelSchedule(streamId);
                navigate('/dashboard');
              });
            }}
          >
            <Trash2 size={16} /> Cancel stream
          </button>
          {overdue && (
            <button
              type="button"
              className="icon-btn icon-btn--danger"
              disabled={busy !== null}
              title="Removes it without emailing your guests"
              onClick={() => {
                if (!window.confirm(`Delete this stream? Your guests will not be emailed.${detail.destinations.some((d) => d.onPlatform) ? ' It will also be removed from the platforms.' : ''}`)) return;
                void run('delete', async () => {
                  await deleteScheduledStream(streamId);
                  navigate('/streams/upcoming');
                });
              }}
            >
              <Trash2 size={16} /> {busy === 'delete' ? 'Deleting…' : 'Delete (no emails)'}
            </button>
          )}
        </div>
      </div>

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

      <section className="panel">
        <div className="section-header">
          <h2>Thumbnail</h2>
        </div>
        <div className="thumbnail-picker">
          {detail.hasThumbnail ? (
            <img className="thumbnail-img" src={scheduleThumbnailUrl(streamId, detail.thumbnailUpdatedAt)} alt="Stream thumbnail" />
          ) : (
            <p className="empty-state">No thumbnail yet.</p>
          )}
          <div className="scheduled-actions">
            <button type="button" className="icon-btn" disabled={busy !== null} onClick={() => thumbInput.current?.click()}>
              <ImagePlus size={16} /> {busy === 'thumb' ? 'Uploading…' : detail.hasThumbnail ? 'Replace thumbnail' : 'Upload thumbnail'}
            </button>
            {detail.hasThumbnail && (
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                disabled={busy !== null}
                onClick={() => void run('thumb-rm', () => removeScheduleThumbnail(streamId), () => 'Thumbnail removed.')}
              >
                <Trash2 size={16} /> Remove
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
          <p className="field-hint">
            JPG or PNG, up to 2 MB, 1280×720 (16:9) recommended. YouTube needs a verified channel for custom thumbnails; Facebook uses it as the scheduled-live image. It is also applied to broadcasts created later, e.g. at start.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Invitation</h2>
        </div>
        <p className="field-hint">Share this with anyone, or invite specific people by email below.</p>
        <div className="scheduled-actions">
          <button type="button" className="icon-btn" onClick={() => void handleCopy(detail.invitationText, 'Invitation')}>
            <Copy size={14} /> Copy invitation
          </button>
          {detail.generalJoinUrl && (
            <button type="button" className="icon-btn" onClick={() => void handleCopy(detail.generalJoinUrl!, 'Join link')}>
              <Copy size={14} /> Copy join link only
            </button>
          )}
        </div>
        {detail.passwordProtected && <p className="field-hint">Password-protected -- the password is never included; share it yourself.</p>}
        {copyFallback && <textarea className="copy-fallback" readOnly rows={8} value={copyFallback} onFocus={(e) => e.currentTarget.select()} />}
      </section>

      <section className="panel">
        <div className="section-header">
          <h2>Guests</h2>
        </div>
        {detail.guests.length === 0 ? (
          <p className="empty-state">No one invited by email yet.</p>
        ) : (
          <div className="participant-list">
            {detail.guests.map((g) => (
              <div key={g.id} className="participant-row">
                <span className="participant-row-name">
                  <Mail size={14} /> <span>{g.email}</span>
                </span>
                <span className={`badge${g.emailedAt ? '' : ' badge-warning'}`}>
                  {g.emailedAt ? `Invited ${new Date(g.emailedAt).toLocaleDateString()}` : 'Not sent'}
                </span>
                <button type="button" className="icon-btn icon-btn--small" onClick={() => void handleCopy(g.joinUrl, `${g.email}'s link`)}>
                  <Copy size={14} /> Copy link
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--small"
                  disabled={busy !== null}
                  onClick={() => void run(`resend-${g.id}`, () => resendScheduleInvite(streamId, g.id), () => `Invitation re-sent to ${g.email}.`)}
                >
                  <Mail size={14} /> {busy === `resend-${g.id}` ? 'Sending…' : 'Resend'}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--small icon-btn--danger"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm(`Remove ${g.email}? Their link will stop working.`)) void run(`rm-${g.id}`, () => removeScheduleGuest(streamId, g.id));
                  }}
                >
                  <Trash2 size={14} /> Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddGuests} className="create-stream-form" style={{ marginTop: 16 }}>
          <label htmlFor="add-guests">Invite more guests</label>
          <GuestEmailsField id="add-guests" value={newGuests} onChange={setNewGuests} rows={2} />
          <button type="submit" className="icon-btn" disabled={busy !== null}>
            <UserPlus size={16} /> {busy === 'add' ? 'Sending…' : 'Send invites'}
          </button>
        </form>
      </section>
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
    <form onSubmit={submit} className="panel create-stream-form">
      <h2>Edit details</h2>
      <label htmlFor="edit-title">Title</label>
      <input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="edit-desc">Description</label>
      <textarea id="edit-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <label htmlFor="edit-when">Date and time</label>
      <input id="edit-when" type="datetime-local" value={whenLocal} min={toLocalInputValue(new Date())} onChange={(e) => setWhenLocal(e.target.value)} required />
      <p className="field-hint">Times are in your browser's zone. This stream is scheduled in {detail.timezone}.</p>
      <label htmlFor="edit-duration">Expected duration</label>
      <select id="edit-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
        {DURATION_OPTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <label htmlFor="edit-notes">Message to guests</label>
      <textarea id="edit-notes" rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      {detail.guests.length > 0 && (
        <label className="checkbox-row">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email my {detail.guests.length} invited {detail.guests.length === 1 ? 'guest' : 'guests'} about changes
        </label>
      )}
      {formError && <p className="error">{formError}</p>}
      <button type="submit" className="icon-btn icon-btn--accent" disabled={busy}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
