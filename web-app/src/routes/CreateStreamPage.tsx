import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Radio } from 'lucide-react';
import { listConnections } from '../api/connections';
import { createStream, scheduleStream, uploadScheduleThumbnail } from '../api/streams';
import { ThumbnailPicker } from '../components/ThumbnailPicker';
import { GuestEmailsField } from '../components/GuestEmailsField';
import { DURATION_OPTIONS, browserTimeZone, parseEmails, toLocalInputValue } from '../lib/schedule';
import { PlatformBadge } from '../components/PlatformBadge';
import { BirdLoader } from '../components/BirdLoader';
import { ApiError } from '../api/client';
import type { PlatformConnection } from '../types/api';

export function CreateStreamPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('unlisted');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [whenLocal, setWhenLocal] = useState(() => toLocalInputValue(new Date(Date.now() + 60 * 60_000)));
  const [duration, setDuration] = useState(60);
  const [guestNotes, setGuestNotes] = useState('');
  const [guestEmailsText, setGuestEmailsText] = useState('');
  const [createOnPlatforms, setCreateOnPlatforms] = useState(false);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [requirePassword, setRequirePassword] = useState(false);
  const [invitePassword, setInvitePassword] = useState('');
  const timeZone = browserTimeZone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listConnections().then(setConnections);
  }, []);

  // Platforms that can hold a broadcast scheduled for later (see StreamProvider.canPrescheduleBroadcast server-side).
  const PRECREATABLE = ['youtube', 'facebook'];
  const precreatable = (connections ?? []).filter((c) => selected.has(c.id) && PRECREATABLE.includes(c.platform));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.size === 0) {
      setError('Pick at least one destination.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === 'schedule') {
        const when = new Date(whenLocal);
        if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() + 60_000) {
          setError('Pick a start time in the future.');
          setBusy(false);
          return;
        }
        const { valid, invalid } = parseEmails(guestEmailsText);
        if (invalid.length > 0) {
          setError(`Fix these email addresses first: ${invalid.join(', ')}`);
          setBusy(false);
          return;
        }
        if (requirePassword && !invitePassword.trim()) {
          setError('Enter a password, or untick "Require a password".');
          setBusy(false);
          return;
        }

        const detail = await scheduleStream({
          title: title.trim() || 'Untitled stream',
          description: description.trim() || undefined,
          visibility,
          scheduledAt: when.toISOString(),
          timezone: timeZone,
          durationMinutes: duration,
          guestNotes: guestNotes.trim() || undefined,
          destinationConnectionIds: [...selected],
          guestEmails: valid.length > 0 ? valid : undefined,
          invitePassword: requirePassword ? invitePassword.trim() : undefined,
          createOnPlatforms: createOnPlatforms && precreatable.length > 0 ? true : undefined,
        });
        // The stream now exists, so the thumbnail can be uploaded (and pushed to any
        // broadcast just created). A failure here must not lose the schedule.
        const warnings = [...(detail.platformWarnings ?? [])];
        if (thumbnail) {
          try {
            const withThumb = await uploadScheduleThumbnail(detail.id, thumbnail);
            warnings.push(...(withThumb.platformWarnings ?? []));
          } catch (err) {
            warnings.push(`The thumbnail wasn't saved (${err instanceof ApiError ? err.message : 'upload failed'}) -- add it on the next page.`);
          }
        }
        navigate(`/streams/${detail.id}`, {
          state: { justScheduled: true, emailFailures: detail.emailFailures ?? [], platformWarnings: warnings },
        });
        return;
      }

      const stream = await createStream({
        title: title.trim() || 'Untitled stream',
        description: description.trim() || undefined,
        visibility,
        destinationConnectionIds: [...selected],
      });
      navigate(`/streams/${stream.id}/studio`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create stream.');
      setBusy(false);
    }
  }

  if (connections !== null && connections.length === 0) {
    return (
      <div>
        <h1>Create a stream</h1>
        <p className="empty-state">
          Connect at least one platform before creating a stream. <Link to="/connections">Connect one</Link>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>{mode === 'schedule' ? 'Schedule a stream' : 'Create a stream'}</h1>
      <div className="mode-toggle" role="tablist" aria-label="When to stream">
        <button type="button" role="tab" aria-selected={mode === 'now'} className={mode === 'now' ? 'active' : ''} onClick={() => setMode('now')}>
          <Radio size={14} /> Go live now
        </button>
        <button type="button" role="tab" aria-selected={mode === 'schedule'} className={mode === 'schedule' ? 'active' : ''} onClick={() => setMode('schedule')}>
          <CalendarClock size={14} /> Schedule for later
        </button>
      </div>
      <form onSubmit={handleSubmit} className="create-stream-form">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled stream"
        />

        <label htmlFor="description">Description</label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this stream about?"
          rows={3}
        />

        <label htmlFor="visibility">Visibility</label>
        <select
          id="visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'public' | 'unlisted' | 'private')}
        >
          <option value="public">Public</option>
          <option value="unlisted">Unlisted</option>
          <option value="private">Private</option>
        </select>
        <p className="field-hint">Only platforms that support visibility (e.g. YouTube) use this -- others ignore it.</p>

        {mode === 'schedule' && (
          <>
            <label htmlFor="when">Date and time</label>
            <input
              id="when"
              type="datetime-local"
              value={whenLocal}
              min={toLocalInputValue(new Date())}
              onChange={(e) => setWhenLocal(e.target.value)}
              required
            />
            <p className="field-hint">Your time zone: {timeZone}. Guests see this time in your zone, and the calendar file adjusts to theirs.</p>

            <label>Thumbnail (optional)</label>
            <ThumbnailPicker file={thumbnail} onChange={setThumbnail} />
            <p className="field-hint">JPG or PNG, up to 2 MB, 1280×720 (16:9) recommended. Shown on YouTube and as Facebook's scheduled-live image.</p>

            <label htmlFor="duration">Expected duration</label>
            <select id="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATION_OPTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </>
        )}

        <label>Destinations</label>
        {!connections ? (
          <BirdLoader loading compact label="Loading your connections…" />
        ) : (
          <div className="destination-checkboxes">
            {connections.map((c) => (
              <label key={c.id} className="destination-checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <PlatformBadge platform={c.platform} />
                {c.label}
              </label>
            ))}
          </div>
        )}

        {mode === 'schedule' && (
          <>
            <label htmlFor="guest-emails">Invite guests by email (optional)</label>
            <GuestEmailsField value={guestEmailsText} onChange={setGuestEmailsText} />

            <label htmlFor="guest-notes">Message to guests (optional)</label>
            <textarea
              id="guest-notes"
              value={guestNotes}
              onChange={(e) => setGuestNotes(e.target.value)}
              placeholder="Anything they should know -- topics, dress code, tech check time…"
              rows={3}
              maxLength={2000}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={createOnPlatforms}
                disabled={precreatable.length === 0}
                onChange={(e) => setCreateOnPlatforms(e.target.checked)}
              />{' '}
              Create the broadcast on {precreatable.length > 0 ? [...new Set(precreatable.map((c) => (c.platform === 'youtube' ? 'YouTube' : 'Facebook')))].join(' and ') : 'YouTube / Facebook'} now
            </label>
            <p className="field-hint">
              {precreatable.length > 0
                ? 'It shows up there as an upcoming stream at your scheduled time, and its watch link is included in your guests\' invites. Facebook only allows scheduling up to 7 days ahead. Other destinations (e.g. Twitch) are always created when you start the stream.'
                : 'Select a YouTube or Facebook destination to use this. Other platforms are created when you start the stream.'}
            </p>

            <label className="checkbox-row">
              <input type="checkbox" checked={requirePassword} onChange={(e) => setRequirePassword(e.target.checked)} /> Require a password to join
            </label>
            {requirePassword && (
              <input type="text" placeholder="Join password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
            )}
            {requirePassword && <p className="field-hint">The password is never emailed -- share it with your guests yourself.</p>}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit" className="icon-btn" disabled={busy}>
          {mode === 'schedule' ? <CalendarClock size={16} /> : <Radio size={16} />}{' '}
          {busy ? (mode === 'schedule' ? 'Scheduling…' : 'Creating…') : mode === 'schedule' ? 'Schedule stream' : 'Create and open studio'}
        </button>
      </form>
    </div>
  );
}
