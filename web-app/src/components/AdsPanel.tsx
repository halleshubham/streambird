import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronUp, Eye, EyeOff, ImagePlus, Megaphone, Plus, Trash2, Undo2 } from 'lucide-react';
import {
  AD_DWELL_RANGE,
  AD_EVERY_SEC_RANGE,
  AD_PLACEMENTS,
  AD_PLACEMENT_LABEL,
  AD_SHOW_SEC_RANGE,
  FREE_PLAN_AD_SCHEDULE,
  MAX_ADS_PER_PLACEMENT,
  describeSchedule,
  formatCountdown,
  scheduleError,
  splitSeconds,
  toSeconds,
  type AdManual,
  type AdPlacement,
  type AdSchedule,
} from '../studio/ads';
import type { AdInfo, AdPlacementInfo } from '../studio/adLayer';
import type { BrandKit } from '../types/api';
import { kitAdSequence } from '../studio/brandKitSet';
import { slotHelp, type BrandOrientation } from '../studio/brandSizes';
import { animatedNotice } from '../studio/animatedImage';
import { adOffWarning } from '../studio/adOff';

interface Props {
  /** 'free' = the plan carries a StreamBird ad and cannot run its own. */
  plan: 'unknown' | 'free' | 'custom';
  ads: Record<AdPlacement, AdPlacementInfo>;
  /** The brand kit applied to this stream (its ads can be picked as the file source). */
  kit: BrandKit | null;
  /** The stream's orientation: decides which set of the kit's ads is offered and which sizes are suggested. */
  orientation: BrandOrientation;
  /** "Shrink picture while ads show" for this stream. */
  shrink: boolean;
  actions: {
    setAdsShrink: (on: boolean) => void;
    /** `index` = one ad of the placement's sequence (0 = the first); omitted = all of them. */
    setAdEnabled: (p: AdPlacement, enabled: boolean, index?: number) => void;
    setAdSchedule: (p: AdPlacement, schedule: AdSchedule) => void;
    /** One ad's own seconds: shown for ("now and then") or before the next ad ("always on"). */
    setAdShowSec: (p: AdPlacement, index: number, sec: number) => void;
    setAdManual: (p: AdPlacement, manual: AdManual) => void;
    moveAd: (p: AdPlacement, from: number, to: number) => void;
    adTiming: (p: AdPlacement) => { visible: boolean; secondsLeft: number } | null;
    /** The ad of the placement showing now (or next, while a "now and then" sequence is hidden): its index in the sequence. */
    adCurrent: (p: AdPlacement) => number | null;
    /** `index` = its place in the sequence; the length of the sequence adds one more; null removes that ad. */
    setAdFile: (p: AdPlacement, file: File | null, index?: number) => Promise<void>;
    useKitAd: (p: AdPlacement) => Promise<void>;
  };
}

const WHERE: Record<AdPlacement, string> = {
  lower_third: 'The bottom third of the picture (above the ticker).',
  side_third: 'The left third of the picture, full height.',
  full_screen: 'The whole picture. It hides the other ads while it is on.',
  l_shape: 'A frame around the picture (a column and/or band with a clear window). The live picture fits into the window (whatever the shrink switch says); lower and left third ads wait while it shows.',
};

export const NO_WINDOW_WARNING = 'No clear window found in this graphic: the picture will not be placed';

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
        <AdCard key={p} placement={p} orientation={orientation} info={ads[p]} kitAds={kit ? kitAdSequence(kit, orientation, p) : []} actions={actions} />
      ))}
    </div>
  );
}

/** The picture-shrinks-while-an-ad-shows switch (studio Ads tab and brand kit editor share its wording). */
export function ShrinkSwitch({ shrink, onChange }: { shrink: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="ad-shrink">
      <label className="ad-shrink-row">
        <input type="checkbox" checked={shrink} aria-label="Shrink picture while ads show" onChange={(e) => onChange(e.target.checked)} /> Shrink picture while lower-third and left-third ads show
      </label>
      <p className="field-hint">The live picture is made smaller to fit above or beside them, so nothing important is hidden. The L-shaped frame always fits the picture in its window, whatever this switch says. Full-screen ads always cover the picture.</p>
    </div>
  );
}

function AdCard({
  placement,
  orientation,
  info,
  kitAds,
  actions,
}: {
  placement: AdPlacement;
  orientation: BrandOrientation;
  info: AdPlacementInfo;
  kitAds: BrandKit['ads'];
  actions: Props['actions'];
}) {
  const kitAd = kitAds[0] ?? null;
  const label = AD_PLACEMENT_LABEL[placement];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const timed = info.schedule.mode === 'interval';
  const all: AdInfo[] = [info, ...info.more];
  const live = all.map((a, i) => ({ a, i })).filter(({ a }) => a.hasMedia && a.enabled);
  const sequence = info.hasMedia && info.more.length > 0;
  /** Something of this placement is on: the Show now / Hide buttons need that. */
  const placementOn = live.length > 0;
  const addRef = useRef<HTMLInputElement>(null);
  const switchedOff = info.hasMedia && (sequence ? !placementOn : !info.enabled);
  const noWindow = placement === 'l_shape' && info.hasMedia && !info.window;
  const manualNote = info.manual === 'shown' ? 'Showing now (by hand)' : info.manual === 'hidden' ? 'Hidden (by hand)' : info.hasMedia ? describeSchedule(info.schedule) : 'No picture yet';

  // A "now and then" ad is hidden until its first showing: say when that is, counting down live.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!(timed || sequence) || !info.hasMedia) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [timed, sequence, info.hasMedia]);
  const timing = timed && info.hasMedia && placementOn ? actions.adTiming(placement) : null;
  const currentIdx = sequence ? actions.adCurrent(placement) : null;
  const currentPos = currentIdx === null ? -1 : live.findIndex((x) => x.i === currentIdx);
  const hiddenPhase = timed && !info.manual && !!timing && !timing.visible;
  const nowNote = sequence && live.length > 1 && currentPos >= 0 ? `${hiddenPhase ? 'Next up' : 'Now showing'} ${currentPos + 1} of ${live.length}` : null;
  const timingNote =
    info.manual || !timing
      ? null
      : timing.visible
        ? `Showing now; hides in ${formatCountdown(timing.secondsLeft)}.`
        : `Hidden for now; shows in ${formatCountdown(timing.secondsLeft)} for ${describeSchedule(info.schedule).replace(/^Shown for (.*?),.*$/, '$1')}.`;

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
        <h3>
          {label}
          {switchedOff && <span className="badge badge-warning ad-off-badge" data-testid={`ad-off-badge-${placement}`}>Off</span>}
        </h3>
        <label className="checkbox-row ad-toggle">
          <input
            type="checkbox"
            checked={info.enabled}
            disabled={!info.hasMedia}
            aria-label={`${label} ad on`}
            onChange={(e) => actions.setAdEnabled(placement, e.target.checked, 0)}
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

      {switchedOff && (
        <p className="ad-off-warning" role="status" data-testid={`ad-off-${placement}`}>
          <AlertTriangle size={14} aria-hidden="true" /> {adOffWarning(placement)}
        </p>
      )}
      {sequence && !info.enabled && placementOn && (
        <p className="ad-off-warning" role="status" data-testid={`ad-off-${placement}-1`}>
          <AlertTriangle size={14} aria-hidden="true" /> {adOffWarning(placement)} (the other ads of this place still play)
        </p>
      )}
      {noWindow && (
        <p className="field-hint error" role="status" data-testid="ad-nowindow-l_shape">{NO_WINDOW_WARNING}. It will cover the whole picture like a full-screen ad.</p>
      )}
      {info.still && animatedNotice(info.stillReason) && <p className="field-hint" role="status" data-testid={`ad-still-${placement}`}>{animatedNotice(info.stillReason)}</p>}

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

      {info.hasMedia && (
        <AdSequence
          placement={placement}
          label={label}
          all={all}
          timed={timed}
          currentIdx={currentIdx}
          actions={actions}
          onAdd={() => addRef.current?.click()}
        />
      )}
      <input
        ref={addRef}
        id={`adFileMore-${placement}`}
        className="ad-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        aria-label={`${label} another ad file (PNG, JPG, WebP or GIF)`}
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void actions.setAdFile(placement, f, all.length);
          e.target.value = '';
        }}
      />

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
        {info.schedule.mode === 'interval' && <AdIntervalFields label={label} schedule={info.schedule} hideShow={sequence} onChange={(s) => actions.setAdSchedule(placement, s)} />}
      </div>

      <div className="studio-toolbar ad-manual">
        <button type="button" className={`icon-btn icon-btn--small${info.manual === 'shown' ? ' icon-btn--accent' : ''}`} disabled={!info.hasMedia || !placementOn} aria-pressed={info.manual === 'shown'} aria-label={`Show the ${label} ad now`} onClick={() => actions.setAdManual(placement, 'shown')}>
          <Eye size={14} /> Show now
        </button>
        <button type="button" className={`icon-btn icon-btn--small${info.manual === 'hidden' ? ' icon-btn--accent' : ''}`} disabled={!info.hasMedia || !placementOn} aria-pressed={info.manual === 'hidden'} aria-label={`Hide the ${label} ad`} onClick={() => actions.setAdManual(placement, 'hidden')}>
          <EyeOff size={14} /> Hide
        </button>
        {info.manual && (
          <button type="button" className="icon-btn icon-btn--small" aria-label={`Let the ${label} ad follow its schedule`} onClick={() => actions.setAdManual(placement, null)}>
            <Undo2 size={14} /> Follow schedule
          </button>
        )}
      </div>
      <p className="field-hint" role="status" data-testid={`ad-status-${placement}`}>
        {switchedOff ? 'Switched off' : manualNote}
      </p>
      {nowNote && (
        <p className="field-hint" role="status" data-testid={`ad-now-${placement}`}>
          {nowNote}
        </p>
      )}
      {timingNote && (
        <p className="field-hint" role="status" data-testid={`ad-timing-${placement}`}>
          {timingNote} Use Show now to see it straight away. This preview timer starts again when you go live.
        </p>
      )}
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
export function AdIntervalFields({
  label,
  schedule,
  hideShow = false,
  onChange,
}: {
  label: string;
  schedule: Extract<AdSchedule, { mode: 'interval' }>;
  /** An ad sequence sets each ad's show time on its own row. */
  hideShow?: boolean;
  onChange: (s: AdSchedule) => void;
}) {
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
      {!hideShow && (
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
      )}
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
      <p className="field-hint">
        {hideShow
          ? 'The first showing comes after the hidden time, counted from when you go live. Each time it comes round, the next ad of this place shows.'
          : 'The first showing comes after the hidden time, counted from when you go live. Then it repeats.'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The ads of one placement as a list, once there is more than one, plus "Add another" up to the limit. Ad 1 is the main card
 * above (its On switch and Remove button live there).
 */
function AdSequence({
  placement,
  label,
  all,
  timed,
  currentIdx,
  actions,
  onAdd,
}: {
  placement: AdPlacement;
  label: string;
  all: AdInfo[];
  timed: boolean;
  currentIdx: number | null;
  actions: Props['actions'];
  onAdd: () => void;
}) {
  const many = all.length > 1;
  return (
    <div className="ad-sequence" data-testid={`ad-seq-${placement}`}>
      {many && (
        <>
          <span className="ad-label">{`${all.length} ads, played in turn`}</span>
          <ol className="ad-seq-list">
            {all.map((a, i) => {
              const n = i + 1;
              return (
                <li key={`${i}-${a.assetId ?? a.name ?? ''}`} className={`ad-seq-row${currentIdx === i ? ' ad-seq-row--current' : ''}`} data-testid={`ad-seq-row-${placement}-${n}`}>
                  <span className="ad-seq-thumb" aria-hidden="true">
                    {a.previewUrl ? <img src={a.previewUrl} alt="" /> : <ImagePlus size={14} />}
                  </span>
                  <span className="ad-seq-name" title={a.name ?? undefined}>
                    {n}. {a.hasMedia ? a.name : 'No picture'}
                  </span>
                  {n > 1 && (
                    <label className="checkbox-row ad-toggle">
                      <input type="checkbox" checked={a.enabled} disabled={!a.hasMedia} aria-label={`${label} ad ${n} on`} onChange={(e) => actions.setAdEnabled(placement, e.target.checked, i)} /> On
                    </label>
                  )}
                  <SecondsField
                    ariaLabel={`${label} ad ${n}: seconds`}
                    title={timed ? 'Seconds this ad is shown each time' : 'Seconds this ad is shown before the next one'}
                    value={a.showSec}
                    min={timed ? 1 : AD_DWELL_RANGE.min}
                    max={timed ? 3600 : AD_DWELL_RANGE.max}
                    onCommit={(sec) => actions.setAdShowSec(placement, i, sec)}
                  />
                  <button type="button" className="icon-btn icon-btn--small" aria-label={`Move ${label} ad ${n} up`} disabled={i === 0} onClick={() => actions.moveAd(placement, i, i - 1)}>
                    <ChevronUp size={14} />
                  </button>
                  <button type="button" className="icon-btn icon-btn--small" aria-label={`Move ${label} ad ${n} down`} disabled={i === all.length - 1} onClick={() => actions.moveAd(placement, i, i + 1)}>
                    <ChevronDown size={14} />
                  </button>
                  {n > 1 && (
                    <button type="button" className="icon-btn icon-btn--small" aria-label={`Remove ${label} ad ${n}`} onClick={() => void actions.setAdFile(placement, null, i)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                  {n > 1 && a.hasMedia && !a.enabled && (
                    <p className="ad-off-warning" role="status" data-testid={`ad-off-${placement}-${n}`}>
                      <AlertTriangle size={14} aria-hidden="true" /> {adOffWarning(placement, n)}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="field-hint">{timed ? 'Seconds = how long each ad is shown when its turn comes.' : 'Seconds = how long each ad is shown before the next one takes over.'}</p>
        </>
      )}
      {all.length < MAX_ADS_PER_PLACEMENT && (
        <button type="button" className="icon-btn icon-btn--small" aria-label={`Add another ${label} ad`} onClick={onAdd}>
          <Plus size={14} /> Add another
        </button>
      )}
    </div>
  );
}

/** A small whole-number field (seconds) that commits when the value is valid and follows changes made elsewhere. */
export function SecondsField({ ariaLabel, title, value, min, max, onCommit }: { ariaLabel: string; title: string; value: number; min: number; max: number; onCommit: (sec: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  const bad = text.trim() === '' || !Number.isInteger(Number(text)) || Number(text) < min || Number(text) > max;
  return (
    <span className="ad-seq-secs" title={title}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        aria-label={ariaLabel}
        aria-invalid={bad}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onCommit(n);
        }}
      />
      <span className="field-hint">s</span>
    </span>
  );
}
