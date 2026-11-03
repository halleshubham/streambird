import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, ChevronDown, Radio, Save } from 'lucide-react';
import { listConnections } from '../api/connections';
import { listBrandKits } from '../api/assets';
import { getMyLimits } from '../api/plans';
import { createPreset, listPresets } from '../api/presets';
import { seedStudioFromPreset } from '../studio/useHostStudio';
import { MAX_PRESET_NAME, QUALITY_ORDER, QUALITY_SHORT, lookLabel, optionsSummary } from '../lib/presets';
import { createStream, scheduleStream, uploadScheduleThumbnail, uploadStreamThumbnail } from '../api/streams';
import { ThumbnailPicker } from '../components/ThumbnailPicker';
import { rememberThumbnailNotice } from '../lib/thumbnailNotice';
import { GuestEmailsField } from '../components/GuestEmailsField';
import { DURATION_OPTIONS, browserTimeZone, parseEmails, toLocalInputValue } from '../lib/schedule';
import { BirdLoader } from '../components/BirdLoader';
import { ApiError } from '../api/client';
import type { BrandKit, EffectiveLimits, PlatformConnection, PresetConfig, Resolution, StreamPreset } from '../types/api';
import { DocsLink } from '../components/DocsLink';
import { DestinationPicker } from '../components/host/DestinationPicker';
import { Notice, PageHeader } from '../components/host/HostKit';
import { Button, Card, Field, Input, SelectField, TextArea, buttonClass } from '../components/ui';

export function CreateStreamPage() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<PlatformConnection[] | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'private'>('public');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
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
  // "More options": the look and quality choices, folded away so the first screen is just a title and destinations.
  const [moreOpen, setMoreOpen] = useState(false);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [limits, setLimits] = useState<EffectiveLimits | null>(null);
  const [presets, setPresets] = useState<StreamPreset[] | null>(null);
  // '' = the usual look (destination's or account default kit), 'none' = no kit, otherwise a kit id.
  const [kitChoice, setKitChoice] = useState('');
  const [quality, setQuality] = useState<Resolution>('hd');
  const [tickerOn, setTickerOn] = useState(false);
  const [tickerText, setTickerText] = useState('');
  const [presetNaming, setPresetNaming] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetNote, setPresetNote] = useState<string | null>(null);

  useEffect(() => {
    listConnections().then(setConnections);
    // Optional extras: the page works without them.
    listBrandKits().then(setKits).catch(() => {});
    getMyLimits().then(setLimits).catch(() => {});
    listPresets().then(setPresets).catch(() => {});
  }, []);

  const maxQuality = limits?.maxResolution ?? 'hd';
  const qualityChoices = QUALITY_ORDER.filter((q) => QUALITY_ORDER.indexOf(q) <= QUALITY_ORDER.indexOf(maxQuality));
  const effectiveQuality = qualityChoices.includes(quality) ? quality : (qualityChoices[qualityChoices.length - 1] ?? 'hd');
  const tickerActive = tickerOn && tickerText.trim().length > 0;
  // Quality, kit and ticker are studio settings, so they only matter when going live now; a scheduled stream sets them when it starts.
  const summary =
    mode === 'schedule'
      ? `${visibility[0].toUpperCase()}${visibility.slice(1)}${orientation === 'portrait' ? ' · vertical' : ''}`
      : optionsSummary({
          look: lookLabel(kitChoice === 'none' ? null : kitChoice || undefined, kits),
          quality: effectiveQuality,
          tickerOn: tickerActive,
          portrait: orientation === 'portrait',
        });

  /** What this form would save as a preset (everything except the title, which is per stream). */
  function currentConfig(): PresetConfig {
    const config: PresetConfig = {
      orientation,
      destinationIds: (connections ?? []).filter((c) => selected.has(c.id)).map((c) => c.id),
      quality: effectiveQuality,
      tickerEnabled: tickerOn,
      ...(tickerActive ? { tickerText: tickerText.trim() } : {}),
    };
    if (kitChoice === 'none') config.brandKitId = null;
    else if (kitChoice) config.brandKitId = kitChoice;
    return config;
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return setPresetNote('Give the preset a name.');
    if (selected.size === 0) return setPresetNote('Pick at least one destination first.');
    setPresetBusy(true);
    setPresetNote(null);
    try {
      await createPreset(name, currentConfig());
      setPresetNaming(false);
      setPresetName('');
      setPresetNote(`Saved "${name}". Find it on your dashboard under Ready when you are.`);
      listPresets().then(setPresets).catch(() => {});
    } catch (err) {
      setPresetNote(err instanceof ApiError ? err.message : 'Could not save the preset.');
    } finally {
      setPresetBusy(false);
    }
  }

  // Platforms that can hold a broadcast scheduled for later (see StreamProvider.canPrescheduleBroadcast server-side).
  const PRECREATABLE = ['youtube'];
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
          orientation,
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
        orientation,
        destinationConnectionIds: [...selected],
      });
      // Upload in the background: the broadcast already exists, and going live must
      // not wait on (or fail because of) a thumbnail. A failure can be retried from
      // the stream's page.
      if (thumbnail) {
        void uploadStreamThumbnail(stream.id, thumbnail)
          .then((state) => {
            if (state.platformWarnings?.length) rememberThumbnailNotice(stream.id, state.platformWarnings);
          })
          .catch((err) => rememberThumbnailNotice(stream.id, [err instanceof ApiError ? err.message : 'The thumbnail could not be uploaded.']));
      }
      // The quality, ticker and kit chosen here are studio settings kept in this browser: hand them to the new stream's studio.
      const config = currentConfig();
      seedStudioFromPreset(stream.id, config);
      // An account with no preset yet is offered to keep these settings as one (a banner in the studio).
      navigate(`/streams/${stream.id}/studio`, presets && presets.length === 0 ? { state: { offerPreset: config } } : undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create stream.');
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      title="New stream"
      actions={
        connections && connections.length > 0 ? (
          <Link to="/dashboard" className="ha-quiet">
            Start from a preset
          </Link>
        ) : undefined
      }
    />
  );

  const tabs = (
    <div className="ha-tabs" role="tablist" aria-label="When to stream">
      <button type="button" role="tab" aria-selected={mode === 'now'} onClick={() => setMode('now')}>
        Go live now
      </button>
      <button type="button" role="tab" aria-selected={mode === 'schedule'} onClick={() => setMode('schedule')}>
        Schedule
      </button>
    </div>
  );

  if (connections !== null && connections.length === 0) {
    return (
      <div className="ha-page ha-narrow">
        {header}
        <Card className="ha-form" style={{ padding: 32, gap: 28 }}>
          {tabs}
          <Input id="title" label="Title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are you streaming?" />
          <div className="ha-empty-dest">
            <h3>Where should this stream go?</h3>
            <p>You have not connected a platform yet. Connect one to pick it as a destination, or paste a custom RTMP address.</p>
            <div className="ha-row ha-row--wrap">
              <Link to="/connections" className={buttonClass('primary')}>
                Connect a platform
              </Link>
              <Link to="/connections#rtmp" className="ha-quiet">
                Use custom RTMP
              </Link>
            </div>
          </div>
          <div>
            <Button variant="live" size="lg" block disabled>
              Go live now
            </Button>
            <p className="ha-hint" style={{ textAlign: 'center' }}>
              Choose at least one destination to go live.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="ha-page ha-narrow">
      {header}
      <p className="ha-sm ha-muted" style={{ marginTop: -16 }}>
        <DocsLink page={mode === 'schedule' ? 'schedule-and-invite' : 'go-live'}>
          {mode === 'schedule' ? 'How scheduling and guest invites work' : 'How to go live'}
        </DocsLink>
      </p>
      <Card as="div" style={{ padding: 32 }}>
        <form onSubmit={handleSubmit} className="ha-form create-stream-form" style={{ gap: 28 }}>
          {tabs}
          <Input id="title" label="Title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled stream" className="ha-title-input" />

          <fieldset className="ha-fieldset">
            <legend>Stream to</legend>
            {mode === 'schedule' && (
              <Notice tone="info" className="ha-notice--slim">
                <strong>Only YouTube can have a live stream scheduled ahead of time.</strong> Facebook (Meta retired scheduled lives) and Twitch are created when you start the stream.
              </Notice>
            )}
            {!connections ? (
              <BirdLoader loading compact label="Loading your connections…" />
            ) : (
              <div className="ha-row ha-row--wrap" style={{ marginTop: mode === 'schedule' ? 12 : 0 }}>
                <DestinationPicker connections={connections} selected={selected} onToggle={toggle} />
                <Link to="/connections#rtmp" className="ha-quiet">
                  + Custom RTMP
                </Link>
              </div>
            )}
          </fieldset>

          {mode === 'schedule' && (
            <div className="ha-form-grid">
              <Input
                id="when"
                label="Date and time"
                type="datetime-local"
                value={whenLocal}
                min={toLocalInputValue(new Date())}
                onChange={(e) => setWhenLocal(e.target.value)}
                required
                hint={`Your time zone: ${timeZone}. Guests see this time in your zone, and the calendar file adjusts to theirs.`}
              />
              <SelectField id="duration" label="Expected duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </SelectField>
            </div>
          )}

          <div className="ha-more more-options">
            <button type="button" className="ha-more-head more-options-toggle" aria-expanded={moreOpen} aria-controls="more-options-panel" onClick={() => setMoreOpen((o) => !o)}>
              <span className="ha-more-text">
                <b className="more-options-title">More options</b>
                <span className="more-options-summary" data-testid="more-options-summary">
                  {summary}
                </span>
              </span>
              <span className="ha-more-toggle" aria-hidden="true">
                {moreOpen ? 'Hide' : 'Show'} <ChevronDown size={16} style={{ transform: moreOpen ? 'rotate(180deg)' : undefined }} />
              </span>
            </button>
            <div id="more-options-panel" className="ha-more-body" hidden={!moreOpen}>
              <TextArea id="description" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's this stream about?" rows={3} />

              <SelectField
                id="visibility"
                label="Visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'public' | 'unlisted' | 'private')}
                hint="Only platforms that support visibility (e.g. YouTube) use this -- others ignore it."
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </SelectField>

              <SelectField
                id="orientation"
                label="Shape"
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}
                hint={
                  orientation === 'portrait'
                    ? 'The same vertical picture goes to every destination you pick, so Twitch and Facebook get it vertical too. YouTube shows it full-screen on phones. This cannot be changed once the stream is created.'
                    : 'Every destination gets the same 16:9 picture.'
                }
              >
                <option value="landscape">Landscape (16:9) -- the usual</option>
                <option value="portrait">Vertical (9:16) -- phones, YouTube Shorts live</option>
              </SelectField>

              {mode === 'now' && (
                <>
                  {kits.length > 0 && (
                    <SelectField
                      id="brandKit"
                      label="Brand kit"
                      value={kitChoice}
                      onChange={(e) => setKitChoice(e.target.value)}
                      hint={'"Default look" uses the kit of the channel or Page you stream to, else your account default.'}
                    >
                      <option value="">Default look</option>
                      <option value="none">No brand kit</option>
                      {kits.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.name}
                        </option>
                      ))}
                    </SelectField>
                  )}

                  <SelectField
                    id="quality"
                    label="Quality"
                    value={effectiveQuality}
                    onChange={(e) => setQuality(e.target.value as Resolution)}
                    hint="The studio starts at this quality; you can still change it there before you go live."
                  >
                    {qualityChoices.map((q) => (
                      <option key={q} value={q}>
                        {QUALITY_SHORT[q]}
                      </option>
                    ))}
                  </SelectField>

                  <div>
                    <label className="ha-check">
                      <input type="checkbox" checked={tickerOn} onChange={(e) => setTickerOn(e.target.checked)} /> Show a news ticker
                    </label>
                    {tickerOn && (
                      <input type="text" className="ui-input" aria-label="Ticker text" value={tickerText} maxLength={200} placeholder="Text shown along the bottom" onChange={(e) => setTickerText(e.target.value)} />
                    )}
                  </div>
                </>
              )}

              {mode === 'schedule' && (
                <>
                  <Field label="Invite guests by email (optional)" id="guest-emails">
                    {() => <GuestEmailsField value={guestEmailsText} onChange={setGuestEmailsText} />}
                  </Field>

                  <TextArea
                    id="guest-notes"
                    label="Message to guests (optional)"
                    value={guestNotes}
                    onChange={(e) => setGuestNotes(e.target.value)}
                    placeholder="Anything they should know -- topics, dress code, tech check time…"
                    rows={3}
                    maxLength={2000}
                  />

                  <div>
                    <label className="ha-check">
                      <input type="checkbox" checked={createOnPlatforms} disabled={precreatable.length === 0} onChange={(e) => setCreateOnPlatforms(e.target.checked)} /> Create the broadcast on YouTube now
                    </label>
                    <p className="ha-hint">
                      {precreatable.length > 0
                        ? "It shows up there as an upcoming stream at your scheduled time, and its watch link is included in your guests' invites. Other destinations (Twitch, and Facebook -- which no longer supports scheduled live videos) are always created when you start the stream."
                        : 'Select a YouTube destination to use this. Other platforms are created when you start the stream.'}
                    </p>
                  </div>

                  <div>
                    <label className="ha-check">
                      <input type="checkbox" checked={requirePassword} onChange={(e) => setRequirePassword(e.target.checked)} /> Require a password to join
                    </label>
                    {requirePassword && (
                      <div style={{ maxWidth: 320, marginTop: 8 }}>
                        <input type="text" className="ui-input" aria-label="Join password" placeholder="Join password" value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} />
                        <p className="ha-hint">The password is never emailed -- share it with your guests yourself.</p>
                      </div>
                    )}
                  </div>
                </>
              )}

              <div>
                <span className="ui-field-label" style={{ display: 'block', marginBottom: 8 }}>
                  Thumbnail (optional)
                </span>
                <ThumbnailPicker file={thumbnail} onChange={setThumbnail} />
                <p className="ha-hint">JPG or PNG, up to 2 MB, 1280×720 (16:9) recommended. Sent to YouTube (needs a verified channel) and, best effort, to Facebook. Twitch doesn't take a thumbnail from here.</p>
              </div>

              <div className="preset-save">
                {presetNaming ? (
                  <div className="ha-row ha-row--wrap" style={{ alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <input
                        type="text"
                        className="ui-input"
                        aria-label="Preset name"
                        value={presetName}
                        maxLength={MAX_PRESET_NAME}
                        placeholder="Name this preset"
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void savePreset();
                          }
                        }}
                      />
                    </div>
                    <Button variant="secondary" busy={presetBusy} icon={<Save size={16} aria-hidden="true" />} onClick={() => void savePreset()}>
                      Save preset
                    </Button>
                    <Button variant="ghost" disabled={presetBusy} onClick={() => setPresetNaming(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ha-quiet"
                    style={{ paddingLeft: 0 }}
                    onClick={() => {
                      setPresetNaming(true);
                      setPresetNote(null);
                    }}
                  >
                    <Save size={14} aria-hidden="true" /> Save these settings as a preset
                  </button>
                )}
                {presetNote && (
                  <p className="ha-hint" role="status">
                    {presetNote}
                  </p>
                )}
              </div>
            </div>
          </div>

          {error && (
            <p className="ha-error" role="alert">
              {error}
            </p>
          )}
          <div className="ha-submit">
            {mode === 'schedule' ? (
              <Button type="submit" size="lg" busy={busy} icon={<CalendarClock size={16} aria-hidden="true" />}>
                Schedule stream
              </Button>
            ) : (
              <Button type="submit" variant="live" busy={busy} block icon={<Radio size={18} aria-hidden="true" />}>
                Go live now
              </Button>
            )}
            {mode === 'now' && <p className="ha-sm ha-muted" style={{ textAlign: 'center' }}>Opens the studio with your camera ready</p>}
          </div>
        </form>
      </Card>
    </div>
  );
}
