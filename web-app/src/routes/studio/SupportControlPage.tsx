import { Component, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Megaphone, RadioTower } from 'lucide-react';
import { AD_EVERY_SEC_RANGE, AD_PLACEMENTS, AD_PLACEMENT_LABEL, AD_SHOW_SEC_RANGE, describeSchedule, scheduleError, type AdManual, type AdPlacement, type AdSchedule } from '../../studio/ads';
import { ShrinkSwitch } from '../../components/AdsPanel';
import { ClockFields } from '../../components/ClockFields';
import { BirdLoader } from '../../components/BirdLoader';
import { BRANDING_RANGES, LAYOUTS, WALLPAPER_RANGES } from '../../studio/compose';
import { useSupportControl, type CommandEntry } from '../../studio/useSupportControl';
import type { SupportCommandType, SupportState } from '../../studio/supportControl';
import '../../components/ui/support.css';

type Send = (type: SupportCommandType, payload: Record<string, unknown>, label: string) => void;

/**
 * The CONTROL-ONLY studio shown to a superadmin in an ACT-mode support session instead of the host studio: no camera,
 * no microphone, no publishing and no host token. It renders controls from the host studio's state snapshot and sends
 * whitelisted commands through the server (see `.claude/docs/studio.md` "Support remote control").
 */
export function SupportControlPage({ streamId, mode }: { streamId: string | undefined; mode: 'view' | 'act' }) {
  if (mode !== 'act') {
    return (
      <div className="support-control" data-testid="support-control-view-only">
        <h1 className="support-control-title">View-only support session</h1>
        <p>The live studio cannot be controlled in a view-only support session. Start an "Act as" session to change a live stream's look.</p>
        <Link to="/dashboard" className="chip-link chip-link--sm">Back to the dashboard</Link>
      </div>
    );
  }
  return (
    <ControlErrorBoundary>
      <ControlStudio streamId={streamId} />
    </ControlErrorBoundary>
  );
}

/** A panel that throws must not blank the whole page: the admin gets a message and a reload button. */
class ControlErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="support-control" data-testid="support-control-crashed">
        <h1 className="support-control-title">Support control</h1>
        <p className="error">Something went wrong showing the controls.</p>
        <button type="button" className="chip-link chip-link--sm" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}

function ControlStudio({ streamId }: { streamId: string | undefined }) {
  const { phase, error, stream, connected, hostConnected, state, ended, log, send, retry } = useSupportControl(streamId);

  if (phase === 'loading') {
    return (
      <div className="support-control">
        <BirdLoader loading compact />
      </div>
    );
  }
  if (phase === 'not-live' || phase === 'error') {
    return (
      <div className="support-control" data-testid="studio-support-note">
        <h1 className="support-control-title">{stream?.title ?? 'Live studio'}</h1>
        <p className={phase === 'error' ? 'error' : undefined}>
          {phase === 'not-live' ? 'Remote control is only available while the stream is live. Starting and stopping streams is not allowed while acting as a customer.' : (error ?? 'Could not open the control page.')}
        </p>
        <Link to="/dashboard" className="chip-link chip-link--sm">Back to the dashboard</Link>
      </div>
    );
  }

  const title = stream?.title ?? 'Live stream';
  return (
    <div className="support-control" data-testid="support-control">
      <header className="support-control-head">
        <h1 className="support-control-title" data-testid="support-control-header">
          <RadioTower size={18} aria-hidden="true" /> Support control: {title} <span className="support-control-live">(LIVE)</span>
        </h1>
        <p className="support-control-host" data-testid="support-host-status" data-connected={hostConnected ? '1' : '0'}>
          {ended ? 'The support session has ended' : hostConnected ? 'host studio connected' : 'The host studio is not connected'}
          {!connected && !ended && ' · connecting to the server…'}
        </p>
        <p className="field-hint">
          No camera, microphone or publishing here: you change the picture the customer is broadcasting. Everything you change is recorded in the audit log. If the host changes the same setting, the host wins.
        </p>
        {error && !ended && (
          <p className="error" data-testid="support-control-error">
            {error}{' '}
            {!connected && (
              <button type="button" className="chip-link chip-link--sm" data-testid="support-control-retry" onClick={retry}>
                Retry
              </button>
            )}
          </p>
        )}
      </header>

      {ended ? (
        <section className="panel" data-testid="support-ended">
          <h2 className="studio-section-label">Support session ended</h2>
          <p>The support session is over, so these controls are switched off. Nothing more can be changed.</p>
          <Link to="/admin" className="chip-link chip-link--sm">Back to the admin area</Link>
        </section>
      ) : !state || !hostConnected ? (
        <p className="panel" data-testid="support-waiting">
          {hostConnected ? 'Waiting for the host studio to report its settings…' : 'The host studio is not connected. Controls appear when the host opens the studio.'}
        </p>
      ) : (
        <div className="support-control-grid">
          <LayoutPanel state={state} send={send} />
          <AdsControls state={state} send={send} />
          <KitPanel state={state} send={send} />
          <TickerPanel state={state} send={send} />
          <LowerThirdPanel state={state} send={send} />
          <ClockPanel state={state} send={send} />
          <LogoPanel state={state} send={send} />
        </div>
      )}
      <CommandLog log={log} />
    </div>
  );
}

function CommandLog({ log }: { log: CommandEntry[] }) {
  return (
    <section className="panel support-log" aria-label="Command status" data-testid="support-command-log">
      <h2 className="studio-section-label">Command status</h2>
      {log.length === 0 && <p className="field-hint">Nothing sent yet.</p>}
      <ul>
        {log.map((e) => (
          <li key={e.id} data-status={e.status} data-testid="support-command-entry">
            <span>{e.label}</span>{' '}
            <strong>{e.status === 'sending' ? 'sending…' : e.status === 'applied' ? 'applied' : `failed: ${e.error ?? 'unknown error'}`}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LayoutPanel({ state, send }: { state: SupportState; send: Send }) {
  return (
    <section className="panel" aria-label="Layout">
      <h2 className="studio-section-label">Layout</h2>
      <select aria-label="Layout" data-testid="support-layout" value={state.layout} onChange={(e) => send('layout.set', { mode: e.target.value }, `Layout: ${LAYOUTS.find((l) => l.id === e.target.value)?.name ?? e.target.value}`)}>
        {LAYOUTS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.group}: {l.name}
          </option>
        ))}
      </select>
    </section>
  );
}

function AdsControls({ state, send }: { state: SupportState; send: Send }) {
  if (state.adsPlan !== 'custom') {
    return (
      <section className="panel" aria-label="Ads" data-testid="support-ads-unavailable">
        <h2 className="studio-section-label">
          <Megaphone size={14} /> Ads
        </h2>
        <p className="field-hint">This plan carries a StreamBird ad; the customer's own ads cannot be run or controlled.</p>
        <ShrinkSwitch shrink={state.adsShrink} onChange={(on) => send('ads.shrink', { on }, `Shrink picture ${on ? 'on' : 'off'}`)} />
      </section>
    );
  }
  return (
    <section className="panel" aria-label="Ads" data-testid="support-ads">
      <h2 className="studio-section-label">
        <Megaphone size={14} /> Ads
      </h2>
      <ShrinkSwitch shrink={state.adsShrink} onChange={(on) => send('ads.shrink', { on }, `Shrink picture ${on ? 'on' : 'off'}`)} />
      {AD_PLACEMENTS.map((p) => (
        <AdCard key={p} placement={p} ad={state.ads[p]} send={send} />
      ))}
    </section>
  );
}

function AdCard({ placement, ad, send }: { placement: AdPlacement; ad: SupportState['ads'][AdPlacement]; send: Send }) {
  const label = AD_PLACEMENT_LABEL[placement];
  const [mode, setMode] = useState<'continuous' | 'interval'>(ad.schedule.mode);
  const [showSec, setShowSec] = useState(ad.schedule.mode === 'interval' ? ad.schedule.showSec : 15);
  const [everySec, setEverySec] = useState(ad.schedule.mode === 'interval' ? ad.schedule.everySec : 180);
  // The card follows the host's schedule when it changes from the host's side.
  useEffect(() => {
    setMode(ad.schedule.mode);
    if (ad.schedule.mode === 'interval') {
      setShowSec(ad.schedule.showSec);
      setEverySec(ad.schedule.everySec);
    }
  }, [ad.schedule]);
  const schedule: AdSchedule = mode === 'interval' ? { mode: 'interval', showSec, everySec } : { mode: 'continuous' };
  const problem = scheduleError(schedule);
  const manual = (m: AdManual, text: string) => send('ads.manual', { placement, manual: m }, `${label} ad: ${text}`);
  return (
    <div className="support-ad" data-testid={`support-ad-${placement}`}>
      <h3>{label}</h3>
      {!ad.hasMedia ? (
        <p className="field-hint">No picture loaded for this ad (the customer adds it in the studio or a brand kit).</p>
      ) : (
        <>
          <p className="field-hint">
            {ad.name ?? 'Ad picture'} · {ad.enabled ? describeSchedule(ad.schedule) : 'switched off'}
          </p>
          <label className="checkbox-row">
            <input type="checkbox" checked={ad.enabled} aria-label={`${label} ad on`} onChange={(e) => send('ads.enabled', { placement, enabled: e.target.checked }, `${label} ad ${e.target.checked ? 'on' : 'off'}`)} /> On
          </label>
          <div className="segmented" role="group" aria-label={`${label} show now`}>
            <button type="button" className={ad.manual === 'shown' ? 'active' : ''} aria-pressed={ad.manual === 'shown'} data-testid={`support-ad-${placement}-show`} onClick={() => manual('shown', 'show now')}>
              <Eye size={14} /> Show now
            </button>
            <button type="button" className={ad.manual === 'hidden' ? 'active' : ''} aria-pressed={ad.manual === 'hidden'} data-testid={`support-ad-${placement}-hide`} onClick={() => manual('hidden', 'hide')}>
              <EyeOff size={14} /> Hide
            </button>
            <button type="button" className={ad.manual === null ? 'active' : ''} aria-pressed={ad.manual === null} data-testid={`support-ad-${placement}-follow`} onClick={() => manual(null, 'follow schedule')}>
              Follow schedule
            </button>
          </div>
          <div className="support-row">
            <select aria-label={`${label} schedule`} value={mode} onChange={(e) => setMode(e.target.value as 'continuous' | 'interval')}>
              <option value="continuous">Always on</option>
              <option value="interval">Now and then</option>
            </select>
            {mode === 'interval' && (
              <>
                <input type="number" aria-label={`${label} show for (seconds)`} min={AD_SHOW_SEC_RANGE.min} max={AD_SHOW_SEC_RANGE.max} value={showSec} onChange={(e) => setShowSec(Number(e.target.value))} />
                <input type="number" aria-label={`${label} hidden for (seconds)`} min={AD_EVERY_SEC_RANGE.min} max={AD_EVERY_SEC_RANGE.max} value={everySec} onChange={(e) => setEverySec(Number(e.target.value))} />
              </>
            )}
            <button
              type="button"
              className="chip-link chip-link--sm"
              disabled={!!problem}
              data-testid={`support-ad-${placement}-schedule`}
              onClick={() => send('ads.schedule', mode === 'interval' ? { placement, mode, showSec, everySec } : { placement, mode }, `${label} ad schedule`)}
            >
              Apply schedule
            </button>
          </div>
          {problem && <p className="error">{problem}</p>}
        </>
      )}
    </div>
  );
}

function KitPanel({ state, send }: { state: SupportState; send: Send }) {
  const [kitId, setKitId] = useState(state.activeKitId ?? '');
  useEffect(() => setKitId(state.activeKitId ?? ''), [state.activeKitId]);
  return (
    <section className="panel" aria-label="Brand kit">
      <h2 className="studio-section-label">Brand kit</h2>
      {state.kits.length === 0 ? (
        <p className="field-hint">The customer has no brand kits.</p>
      ) : (
        <div className="support-row">
          <select aria-label="Brand kit" data-testid="support-kit" value={kitId} onChange={(e) => setKitId(e.target.value)}>
            <option value="">Choose a kit…</option>
            {state.kits.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          <button type="button" className="chip-link chip-link--sm" disabled={!kitId} data-testid="support-kit-apply" onClick={() => send('kit.apply', { kitId }, `Apply brand kit "${state.kits.find((k) => k.id === kitId)?.name ?? ''}"`)}>
            Apply kit
          </button>
        </div>
      )}
      <p className="field-hint">Applying a kit loads its logo, clock, lower-third look, wallpaper and ads, as if the host picked it.</p>
    </section>
  );
}

function TickerPanel({ state, send }: { state: SupportState; send: Send }) {
  const [text, setText] = useState(state.ticker.text);
  useEffect(() => setText(state.ticker.text), [state.ticker.text]);
  return (
    <section className="panel" aria-label="Ticker">
      <h2 className="studio-section-label">Ticker</h2>
      <input type="text" aria-label="Ticker text" data-testid="support-ticker-text" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="support-row">
        <button type="button" className="chip-link chip-link--sm" disabled={!text.trim()} data-testid="support-ticker-show" onClick={() => send('ticker.set', { text, on: true }, 'Ticker: show')}>
          {state.ticker.on ? 'Update ticker' : 'Show ticker'}
        </button>
        <button type="button" className="chip-link chip-link--sm" disabled={!state.ticker.on} data-testid="support-ticker-hide" onClick={() => send('ticker.set', { on: false }, 'Ticker: hide')}>
          Hide ticker
        </button>
      </div>
    </section>
  );
}

function LowerThirdPanel({ state, send }: { state: SupportState; send: Send }) {
  const [name, setName] = useState(state.lowerThird.name);
  const [title, setTitle] = useState(state.lowerThird.title);
  useEffect(() => setName(state.lowerThird.name), [state.lowerThird.name]);
  useEffect(() => setTitle(state.lowerThird.title), [state.lowerThird.title]);
  if (!state.lowerThird.allowed) {
    return (
      <section className="panel" aria-label="Lower third">
        <h2 className="studio-section-label">Lower third</h2>
        <p className="field-hint">Animated lower thirds are not part of this customer's plan.</p>
      </section>
    );
  }
  return (
    <section className="panel" aria-label="Lower third">
      <h2 className="studio-section-label">Lower third</h2>
      <input type="text" aria-label="Lower third name" data-testid="support-lt-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input type="text" aria-label="Lower third title" data-testid="support-lt-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
      <div className="support-row">
        <button type="button" className="chip-link chip-link--sm" disabled={!name.trim()} data-testid="support-lt-show" onClick={() => send('lowerThird.set', { name, title, show: true }, 'Lower third: show')}>
          Show
        </button>
        <button type="button" className="chip-link chip-link--sm" disabled={!state.lowerThird.live} data-testid="support-lt-hide" onClick={() => send('lowerThird.set', { show: false }, 'Lower third: hide')}>
          Hide
        </button>
      </div>
    </section>
  );
}

function ClockPanel({ state, send }: { state: SupportState; send: Send }) {
  return (
    <section className="panel" aria-label="Date and time">
      <h2 className="studio-section-label">Date and time</h2>
      <ClockFields value={state.clock} onChange={(patch) => send('clock.set', patch as Record<string, unknown>, `Clock: ${Object.keys(patch).join(', ')}`)} idPrefix="supportClock" variant="studio" />
    </section>
  );
}

function LogoPanel({ state, send }: { state: SupportState; send: Send }) {
  return (
    <section className="panel" aria-label="Logo and wallpaper">
      <h2 className="studio-section-label">Logo</h2>
      {!state.logo.has && <p className="field-hint">No logo is loaded in the studio.</p>}
      <div className="segmented" role="group" aria-label="Logo position">
        {(['left', 'right'] as const).map((pos) => (
          <button key={pos} type="button" className={state.logo.position === pos ? 'active' : ''} aria-pressed={state.logo.position === pos} data-testid={`support-logo-${pos}`} onClick={() => send('logo.set', { position: pos }, `Logo: ${pos}`)}>
            {pos === 'left' ? 'Left' : 'Right'}
          </button>
        ))}
      </div>
      <NumberSend label="Logo size" testId="support-logo-size" min={BRANDING_RANGES.logoSize.min} max={BRANDING_RANGES.logoSize.max} value={state.logo.size} onSend={(n) => send('logo.set', { size: n }, 'Logo size')} />
      <NumberSend label="Wallpaper dim (%)" testId="support-wallpaper-dim" min={WALLPAPER_RANGES.dim.min} max={WALLPAPER_RANGES.dim.max} value={state.wallpaper.dim} onSend={(n) => send('wallpaper.dim', { n }, 'Wallpaper dim')} />
    </section>
  );
}

/** A whole number with its own "Set" button: the value is sent only when asked, never while typing. */
function NumberSend({ label, testId, min, max, value, onSend }: { label: string; testId: string; min: number; max: number; value: number; onSend: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
  return (
    <div className="support-row">
      <label>
        {label}
        <input type="number" data-testid={testId} min={min} max={max} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="button" className="chip-link chip-link--sm" disabled={!valid} data-testid={`${testId}-set`} onClick={() => onSend(n)}>
        Set
      </button>
    </div>
  );
}
