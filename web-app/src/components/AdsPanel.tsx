import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, ImagePlus, Megaphone, Trash2, Undo2 } from 'lucide-react';
import {
  AD_EVERY_SEC_RANGE,
  AD_PLACEMENTS,
  AD_PLACEMENT_LABEL,
  AD_SHOW_SEC_RANGE,
  FREE_PLAN_AD_SCHEDULE,
  describeSchedule,
  scheduleError,
  splitSeconds,
  toSeconds,
  type AdManual,
  type AdPlacement,
  type AdSchedule,
} from '../studio/ads';
import type { AdInfo } from '../studio/adLayer';
import type { BrandKit } from '../types/api';
import { kitSetFor } from '../studio/brandKitSet';
import { slotHelp, type BrandOrientation } from '../studio/brandSizes';

interface Props {
  /** 'free' = the plan carries a StreamBird ad and cannot run its own. */
  plan: 'unknown' | 'free' | 'custom';
  ads: Record<AdPlacement, AdInfo>;
  /** The brand kit applied to this stream (its ads can be picked as the file source). */
  kit: BrandKit | null;
  /** The stream's orientation: decides which set of the kit's ads is offered and which sizes are suggested. */
  orientation: BrandOrientation;
  /** "Shrink picture while ads show" for this stream. */
  shrink: boolean;
  actions: {
    setAdsShrink: (on: boolean) => void;
    setAdEnabled: (p: AdPlacement, enabled: boolean) => void;
    setAdSchedule: (p: AdPlacement, schedule: AdSchedule) => void;
    setAdManual: (p: AdPlacement, manual: AdManual) => void;
    setAdFile: (p: AdPlacement, file: File | null) => Promise<void>;
    useKitAd: (p: AdPlacement) => Promise<void>;
  };
}

const WHERE: Record<AdPlacement, string> = {
  lower_third: 'The bottom third of the picture (above the ticker).',
  side_third: 'The left third of the picture, full height.',
  full_screen: 'The whole picture. It hides the other ads while it is on.',
  l_shape: 'A frame around the picture (a column and/or band with a clear window). The live picture shrinks into the window; lower and left third ads wait while it shows.',
};

export const NO_WINDOW_WARNING = 'No clear window found in this graphic: the picture will not be placed';
export const L_SHAPE_NEEDS_SHRINK = 'L-shaped ads always resize the picture. Turn on "Shrink picture while ads show" to use this ad.';

/** The studio's Ads tab: up to four ads on the broadcast picture, each with its own file, schedule and manual control. */
export function AdsPanel({ plan, ads, kit, orientation, shrink, actions }: Props) {
  if (plan === 'unknown') return <div className="panel" aria-busy="true" />;
  if (plan === 'free') {
    return (
      <div className="panel" data-testid="ads-free-notice">
        <label className="studio-section-label">
          <Megaphone size={14} /> Ads
        </label>
        <p>
          Streams on the Free plan carry a short <strong>StreamBird ad</strong> over the lower third ({describeSchedule(FREE_PLAN_AD_SCHEDULE).toLowerCase()}) and the “Powered by StreamBird” mark. It cannot be
          changed or hidden on this plan.
        </p>
        <ShrinkSwitch shrink={shrink} onChange={actions.setAdsShrink} />
        <p className="field-hint">
          Paid plans and day passes remove it and let you run your own ads (a lower third, a left third, the full screen or an L-shaped frame) from a file or your brand kit.{' '}
          <Link to="/billing" className="chip-link chip-link--sm">See plans</Link>
        </p>
      </div>
    );
  }
  return (
    <div data-testid="ads-panel">
      <div className="panel">
        <label className="studio-section-label">
          <Megaphone size={14} /> Ads
        </label>
        <p className="field-hint">
          Show your own sponsor or promo pictures over the broadcast. Each ad can be on all the time or pop up now and then. Pictures chosen here are used for this stream only; to keep ads for every stream,
          add them to a <Link to="/brand">brand kit</Link>.
        </p>
        <ShrinkSwitch shrink={shrink} onChange={actions.setAdsShrink} />
      </div>
      {AD_PLACEMENTS.map((p) => (
        <AdCard key={p} placement={p} orientation={orientation} info={ads[p]} kitAd={kit ? (kitSetFor(kit, orientation).ads.find((a) => a.placement === p) ?? null) : null} actions={actions} shrink={shrink} />
      ))}
    </div>
  );
}

/** The picture-shrinks-while-an-ad-shows switch (studio Ads tab and brand kit editor share its wording). */
export function ShrinkSwitch({ shrink, onChange }: { shrink: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="ad-shrink">
      <label className="ad-shrink-row">
        <input type="checkbox" checked={shrink} aria-label="Shrink picture while ads show" onChange={(e) => onChange(e.target.checked)} /> Shrink picture while ads show
      </label>
      <p className="field-hint">The live picture is made smaller to fit beside or above a lower-third or left-third ad, so nothing important is hidden. L-shaped frame ads always resize the picture into their window (they need this switch on). Full-screen ads always cover the picture.</p>
    </div>
  );
}

function AdCard({
  placement,
  orientation,
  info,
  kitAd,
  actions,
  shrink,
}: {
  placement: AdPlacement;
  orientation: BrandOrientation;
  info: AdInfo;
  kitAd: BrandKit['ads'][number] | null;
  actions: Props['actions'];
  shrink: boolean;
}) {
  const label = AD_PLACEMENT_LABEL[placement];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const timed = info.schedule.mode === 'interval';
  const frameBlocked = placement === 'l_shape' && !shrink; // an L-shaped frame cannot run with the picture-shrink switch off
  const noWindow = placement === 'l_shape' && info.hasMedia && !info.window;
  const manualNote = info.manual === 'shown' ? 'Showing now (by hand)' : info.manual === 'hidden' ? 'Hidden (by hand)' : info.hasMedia ? describeSchedule(info.schedule) : 'No picture yet';

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await actions.setAdFile(placement, file);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="panel ad-card" role="group" aria-label={`${label} ad`} data-testid={`ad-card-${placement}`} data-state={info.manual ?? (info.enabled ? 'on' : 'off')}>
      <div className="ad-card-head">
        <h3>{label}</h3>
        <label className="checkbox-row ad-toggle">
          <input
            type="checkbox"
            checked={info.enabled}
            disabled={!info.hasMedia}
            aria-label={`${label} ad on`}
            onChange={(e) => actions.setAdEnabled(placement, e.target.checked)}
          />{' '}
          On
        </label>
      </div>
      <p className="field-hint">{WHERE[placement]}</p>
      <p className="field-hint" data-testid={`ad-size-${placement}`}>{slotHelp(orientation, placement)}</p>

      <div className="ad-media">
        <div className={`ad-thumb ad-thumb--${placement}`} aria-hidden="true">
          {placement === 'l_shape' && info.previewUrl && info.window && info.aspect ? (
            <span className="ad-thumb-frame" style={{ aspectRatio: String(info.aspect) }}>
              <img src={info.previewUrl} alt="" />
              <WindowOutline window={info.window} />
            </span>
          ) : info.previewUrl ? (
            <img src={info.previewUrl} alt="" />
          ) : (
            <ImagePlus size={20} />
          )}
        </div>
        <div className="ad-media-info">
          <span className="ad-file-name" title={info.name ?? undefined}>
            {info.hasMedia ? info.name : 'No picture chosen'}
          </span>
          <span className="field-hint">{info.source === 'kit' ? 'From the brand kit' : info.source === 'computer' ? 'From this computer (this stream only)' : 'Choose a source below'}</span>
        </div>
      </div>

      {placement === 'l_shape' && frameBlocked && (
        <p className="field-hint" role="status" data-testid="ad-lshape-needs-shrink">{L_SHAPE_NEEDS_SHRINK}</p>
      )}
      {noWindow && (
        <p className="field-hint error" role="status" data-testid="ad-nowindow-l_shape">{NO_WINDOW_WARNING}. It will cover the whole picture like a full-screen ad.</p>
      )}
      {info.still && <p className="field-hint" data-testid={`ad-still-${placement}`}>This GIF could not be played as an animation here, so its first frame is shown as a still picture.</p>}

      <div className="segmented" role="group" aria-label={`${label} ad: file source`}>
        <button
          type="button"
          className={info.source === 'kit' ? 'active' : ''}
          aria-pressed={info.source === 'kit'}
          disabled={!kitAd}
          title={kitAd ? undefined : 'The applied brand kit has no ad for this place'}
          onClick={() => void actions.useKitAd(placement)}
        >
          From brand kit
        </button>
        <button type="button" className={info.source === 'computer' ? 'active' : ''} aria-pressed={info.source === 'computer'} disabled={busy} onClick={() => fileRef.current?.click()}>
          From this computer
        </button>
      </div>
      <input
        ref={fileRef}
        id={`adFile-${placement}`}
        className="ad-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={`${label} ad file (PNG, JPG, WebP or GIF)`}
        tabIndex={-1}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      {info.hasMedia && (
        <button type="button" className="icon-btn icon-btn--small" aria-label={`Remove the ${label} ad picture`} onClick={() => void actions.setAdFile(placement, null)}>
          <Trash2 size={14} /> Remove picture
        </button>
      )}

      <div className="ad-schedule">
        <span className="ad-label" id={`ad-sched-${placement}`}>
          When
        </span>
        <div className="segmented" role="group" aria-labelledby={`ad-sched-${placement}`}>
          <button type="button" className={!timed ? 'active' : ''} aria-pressed={!timed} onClick={() => actions.setAdSchedule(placement, { mode: 'continuous' })}>
            Always on
          </button>
          <button
            type="button"
            className={timed ? 'active' : ''}
            aria-pressed={timed}
            onClick={() => actions.setAdSchedule(placement, info.schedule.mode === 'interval' ? info.schedule : { mode: 'interval', showSec: 15, everySec: 180 })}
          >
            Now and then
          </button>
        </div>
        {info.schedule.mode === 'interval' && <AdIntervalFields label={label} schedule={info.schedule} onChange={(s) => actions.setAdSchedule(placement, s)} />}
      </div>

      <div className="studio-toolbar ad-manual">
        <button type="button" className={`icon-btn icon-btn--small${info.manual === 'shown' ? ' icon-btn--accent' : ''}`} disabled={!info.hasMedia || !info.enabled || frameBlocked} aria-pressed={info.manual === 'shown'} aria-label={`Show the ${label} ad now`} onClick={() => actions.setAdManual(placement, 'shown')}>
          <Eye size={14} /> Show now
        </button>
        <button type="button" className={`icon-btn icon-btn--small${info.manual === 'hidden' ? ' icon-btn--accent' : ''}`} disabled={!info.hasMedia || !info.enabled || frameBlocked} aria-pressed={info.manual === 'hidden'} aria-label={`Hide the ${label} ad`} onClick={() => actions.setAdManual(placement, 'hidden')}>
          <EyeOff size={14} /> Hide
        </button>
        {info.manual && (
          <button type="button" className="icon-btn icon-btn--small" aria-label={`Let the ${label} ad follow its schedule`} onClick={() => actions.setAdManual(placement, null)}>
            <Undo2 size={14} /> Follow schedule
          </button>
        )}
      </div>
      <p className="field-hint" role="status" data-testid={`ad-status-${placement}`}>
        {frameBlocked && info.hasMedia ? 'Off while the picture does not shrink' : info.hasMedia && !info.enabled ? 'Switched off' : manualNote}
      </p>
    </div>
  );
}

/** The detected window drawn as an outline over a frame picture's thumbnail (fractions of the picture). Percent-positioned, so it needs no size. */
export function WindowOutline({ window: w }: { window: { x: number; y: number; w: number; h: number } }) {
  return (
    <span
      className="ad-window-outline"
      data-testid="ad-window-outline"
      style={{ left: `${w.x * 100}%`, top: `${w.y * 100}%`, width: `${w.w * 100}%`, height: `${w.h * 100}%` }}
    />
  );
}

type Unit = 'sec' | 'min';

/** "Show for [n][sec|min] every [n][sec|min]": typed freely, applied as soon as the numbers are valid (stored in seconds). */
export function AdIntervalFields({ label, schedule, onChange }: { label: string; schedule: Extract<AdSchedule, { mode: 'interval' }>; onChange: (s: AdSchedule) => void }) {
  const show = splitSeconds(schedule.showSec);
  const every = splitSeconds(schedule.everySec);
  const [showVal, setShowVal] = useState(String(show.value));
  const [showUnit, setShowUnit] = useState<Unit>(show.unit);
  const [everyVal, setEveryVal] = useState(String(every.value));
  const [everyUnit, setEveryUnit] = useState<Unit>(every.unit);
  const [error, setError] = useState<string | null>(null);

  // Follow a schedule that changed from outside (a kit applied, a reload) without fighting what is being typed.
  useEffect(() => {
    const a = splitSeconds(schedule.showSec);
    const b = splitSeconds(schedule.everySec);
    // oxlint-disable-next-line react/set-state-in-effect
    setShowVal((v) => (toSeconds(Number(v), showUnit) === schedule.showSec ? v : String(a.value)));
    setShowUnit((u) => (toSeconds(Number(showVal), u) === schedule.showSec ? u : a.unit));
    setEveryVal((v) => (toSeconds(Number(v), everyUnit) === schedule.everySec ? v : String(b.value)));
    setEveryUnit((u) => (toSeconds(Number(everyVal), u) === schedule.everySec ? u : b.unit));
  }, [schedule.showSec, schedule.everySec]);

  function commit(sv: string, su: Unit, ev: string, eu: Unit) {
    const next: AdSchedule = { mode: 'interval', showSec: toSeconds(Number(sv), su), everySec: toSeconds(Number(ev), eu) };
    const problem = sv.trim() === '' || ev.trim() === '' ? 'Enter both numbers.' : scheduleError(next);
    setError(problem);
    if (!problem) onChange(next);
  }

  const maxFor = (range: { max: number }, unit: Unit) => (unit === 'min' ? Math.floor(range.max / 60) : range.max);
  return (
    <div className="ad-interval">
      <div className="ad-interval-row">
        <span className="ad-label">Show for</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={maxFor(AD_SHOW_SEC_RANGE, showUnit)}
          value={showVal}
          aria-label={`${label} ad: show for`}
          onChange={(e) => {
            setShowVal(e.target.value);
            commit(e.target.value, showUnit, everyVal, everyUnit);
          }}
        />
        <select
          value={showUnit}
          aria-label={`${label} ad: show for unit`}
          onChange={(e) => {
            setShowUnit(e.target.value as Unit);
            commit(showVal, e.target.value as Unit, everyVal, everyUnit);
          }}
        >
          <option value="sec">seconds</option>
          <option value="min">minutes</option>
        </select>
      </div>
      <div className="ad-interval-row">
        <span className="ad-label">Then hide for</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={maxFor(AD_EVERY_SEC_RANGE, everyUnit)}
          value={everyVal}
          aria-label={`${label} ad: hide for`}
          onChange={(e) => {
            setEveryVal(e.target.value);
            commit(showVal, showUnit, e.target.value, everyUnit);
          }}
        />
        <select
          value={everyUnit}
          aria-label={`${label} ad: hide for unit`}
          onChange={(e) => {
            setEveryUnit(e.target.value as Unit);
            commit(showVal, showUnit, everyVal, e.target.value as Unit);
          }}
        >
          <option value="sec">seconds</option>
          <option value="min">minutes</option>
        </select>
      </div>
      <p className="field-hint">The first showing comes after the hidden time, counted from when you go live. Then it repeats.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
