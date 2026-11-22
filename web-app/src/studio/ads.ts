/**
 * Advertisements on the broadcast picture: placements, geometry and the show/hide schedule.
 * Pure logic (no DOM, no canvas) so it is unit-tested and can be ported 1:1 to the Android app.
 *
 * THE SPEC (W x H = the canvas pixels of the stream, landscape 16:9 or vertical 9:16)
 *
 * Placement areas (`adRect`), origin top-left:
 *   lower_third  x = 0,  y = H - tickerBarHeight - round(H / 3),  w = W,             h = round(H / 3)
 *   side_third   x = 0,  y = 0,                                   w = round(W / 3),  h = H
 *   full_screen  x = 0,  y = 0,                                   w = W,             h = H
 *   The lower third keeps its full height and moves UP by the ticker bar's height while the ticker is showing
 *   (tickerBarHeight = 0 when it is not). The other two ignore the ticker.
 *
 * Picture inside its area (`fitAd`): scaled up or down to fit entirely inside the area, aspect ratio kept
 *   (contain; the unused part stays transparent, nothing is cropped). lower_third is anchored bottom-centre,
 *   side_third and full_screen are centred.
 *
 * Schedule (`adVisibility`), time base = seconds since going live (`elapsedSec`):
 *   continuous                -> always visible, alpha 1.
 *   interval {showSec, everySec}:
 *     cycle = everySec + showSec;  t = elapsedSec mod cycle   (negative elapsed counts as 0)
 *     t <  everySec  -> hidden (alpha 0)             -- hidden first, for everySec seconds,
 *     t >= everySec  -> shown, for showSec seconds   -- then shown, then it repeats.
 *     Inside the shown window u = t - everySec (0 .. showSec) there is a fade of f = min(0.3, showSec / 2) seconds:
 *       alpha = clamp(min(u / f, (showSec - u) / f), 0, 1)     (fade in, hold at 1, fade out; never pops)
 *   Examples (show 15, every 180, cycle 195):  t=0..179.99 hidden · t=180 alpha 0 · t=180.15 alpha 0.5 ·
 *     t=180.3..194.7 alpha 1 · t=194.85 alpha 0.5 · t=195 -> next cycle, hidden again until t=375.
 *
 * Priority (`resolveAdAlphas`): while full_screen is visible it hides the others: their alpha is multiplied
 *   by (1 - alpha of full_screen), so they cross-fade away with it and are gone once it is at alpha 1.
 *   The L-shaped frame (l_shape) is second: while it is visible lower_third and side_third are suppressed the same way
 *   (their alpha is multiplied by (1 - alpha of l_shape), AFTER l_shape itself was reduced by full_screen).
 *   Draw order on the canvas (bottom to top): background, wallpaper, THE L-SHAPED FRAME (a base layer: it is drawn
 *   BEFORE the scene), the scene (tiles, logo, name lower-third banner, scaled into the frame's window), ticker, then
 *   the ads lower_third, side_third, full_screen (so side_third draws above lower_third), and finally the Free plan's
 *   "Powered by StreamBird" mark, always on top.
 *
 * Ad SEQUENCES (several ads of one placement, up to MAX_ADS_PER_PLACEMENT = 5, `adSequenceState` / `adSequenceTargets`):
 *   The ads of a placement play in list order, round-robin; only ads with a picture that are switched On take part (disabled
 *   ones are skipped, none on = the placement is off). One enabled ad behaves exactly as above. The placement has ONE mode and
 *   ONE everySec (the first ad's); every ad has its own showSec.
 *   interval:   ad k of the n enabled ads has its own cycle = everySec + showSec_k (hidden for everySec, then shown for showSec_k,
 *               fades as above). The cycles run one after the other and the whole round repeats:
 *               t = elapsedSec mod sum(everySec + showSec_k); the ad whose cycle t falls in is the "current" one (while it is still
 *               in its hidden part it is the ad that will show next). Each time the show window comes round the NEXT ad shows.
 *   continuous: showSec_k is the dwell: ad k is shown for showSec_k seconds (default 20, range 5..300), then the next one.
 *               t = elapsedSec mod sum(showSec_k). At each change the new ad fades in over f = min(0.3, showSec_k / 2) seconds while
 *               the previous one fades out over the same time (alphas sum to 1: a cross-fade, never a gap or a flash). The very start
 *               of the stream (elapsedSec < f) shows the first ad at alpha 1 with no fade-in.
 *   Manual 'shown' (interval) shows the current/next ad at alpha 1; 'hidden' hides the whole placement; both act on the placement.
 *   Priority and shrinking use the placement's alpha = min(1, sum of its ads' alphas). For an l_shape sequence the scene rect eases
 *   between the ads' windows by the alpha shares (smoothstep), so it never jumps.
 *
 * L-shaped frame (`l_shape`): the ad image is a FULL-FRAME graphic (a coloured column and/or band around a clear window,
 *   e.g. a news channel's frame). It is drawn contain-fitted over the whole canvas (same orientation set as the other
 *   ads: landscape set for 16:9 streams, portrait set for 9:16) and the scene is scaled, aspect kept, into the window.
 *   The window is detected from the image itself (adWindow.ts `detectWindow`): the clear region (transparent or white)
 *   around the image centre, as a 0..1 rectangle. If none is found the graphic is drawn as a full-screen overlay and
 *   the scene is not shrunk. The switch "Shrink picture while ads show"
 *   does NOT affect the frame (it only governs lower_third and side_third): the frame always fits the scene into its window.
 *   Window on the canvas = fitAd rect origin + window * fitAd size; scene = `lShapeSceneRect` (contain, centred).
 */

export const AD_PLACEMENTS = ['lower_third', 'side_third', 'full_screen', 'l_shape'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/** Draw order of the overlay ads, first = bottom. l_shape is a base layer drawn under the scene (it is only an overlay when its graphic has no window). */
export const AD_DRAW_ORDER: readonly AdPlacement[] = ['lower_third', 'side_third', 'l_shape', 'full_screen'];

export const AD_FADE_SEC = 0.3;
/** Most ads one placement plays in turn (per orientation set), the same limit as the server's. */
export const MAX_ADS_PER_PLACEMENT = 5;
/** Always-on sequences: seconds each ad is shown before the next one (the ad's `showSec`). */
export const AD_DWELL_RANGE = { min: 5, max: 300 } as const;
export const AD_DWELL_DEFAULT = 20;
export const AD_SHOW_SEC_RANGE = { min: 1, max: 3600 } as const;
export const AD_EVERY_SEC_RANGE = { min: 1, max: 86400 } as const;

export type AdSchedule = { mode: 'continuous' } | { mode: 'interval'; showSec: number; everySec: number };

export const AD_PLACEMENT_LABEL: Record<AdPlacement, string> = {
  lower_third: 'Lower third',
  side_third: 'Left third',
  full_screen: 'Full screen',
  l_shape: 'L-shaped frame',
};

export interface AdRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The area an ad placement occupies on a W x H canvas; `tickerBarHeight` is 0 when no ticker is showing. */
export function adRect(placement: AdPlacement, W: number, H: number, tickerBarHeight = 0): AdRect {
  switch (placement) {
    case 'lower_third': {
      const h = Math.round(H / 3);
      return { x: 0, y: H - Math.max(0, tickerBarHeight) - h, w: W, h };
    }
    case 'side_third':
      return { x: 0, y: 0, w: Math.round(W / 3), h: H };
    case 'full_screen':
    case 'l_shape':
      return { x: 0, y: 0, w: W, h: H };
  }
}

/** Where a picture of imgW x imgH is drawn inside its area: contain, bottom-centre for lower_third, centred otherwise. */
export function fitAd(placement: AdPlacement, imgW: number, imgH: number, area: AdRect): AdRect {
  if (!(imgW > 0) || !(imgH > 0) || !(area.w > 0) || !(area.h > 0)) return { x: area.x, y: area.y, w: 0, h: 0 };
  const scale = Math.min(area.w / imgW, area.h / imgH);
  const w = imgW * scale;
  const h = imgH * scale;
  const x = area.x + (area.w - w) / 2;
  const y = placement === 'lower_third' ? area.y + area.h - h : area.y + (area.h - h) / 2;
  return { x, y, w, h };
}

export interface AdVisibility {
  /** Inside the shown window (t >= everySec) or continuous. */
  visible: boolean;
  /** 0..1 opacity to draw with (300 ms fades at both ends of the shown window). */
  alpha: number;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The schedule's opacity at `elapsedSec` without allocating (the draw loop calls this every frame). -1 = outside the shown window. */
function scheduleAlpha(elapsedSec: number, schedule: AdSchedule): number {
  if (!schedule || schedule.mode !== 'interval') return 1; // continuous (or a broken saved value: never throw in the draw loop)
  const { showSec, everySec } = schedule;
  if (!(showSec > 0) || !(everySec > 0)) return -1;
  const cycle = everySec + showSec;
  const e = Number.isFinite(elapsedSec) && elapsedSec > 0 ? elapsedSec : 0;
  const t = e % cycle;
  if (t < everySec) return -1;
  const u = t - everySec;
  const fade = Math.min(AD_FADE_SEC, showSec / 2);
  return clamp01(Math.min(u / fade, (showSec - u) / fade));
}

export function adVisibility(elapsedSec: number, schedule: AdSchedule): AdVisibility {
  const a = scheduleAlpha(elapsedSec, schedule);
  return a < 0 ? { visible: false, alpha: 0 } : { visible: true, alpha: a };
}

/** Where an interval schedule is at `elapsedSec`: shown or hidden, and whole seconds until that flips (null for "always on"). */
export function adScheduleTiming(elapsedSec: number, schedule: AdSchedule): { visible: boolean; secondsLeft: number } | null {
  if (!schedule || schedule.mode !== 'interval') return null;
  const { showSec, everySec } = schedule;
  if (!(showSec > 0) || !(everySec > 0)) return null;
  const cycle = everySec + showSec;
  const e = Number.isFinite(elapsedSec) && elapsedSec > 0 ? elapsedSec : 0;
  const t = e % cycle;
  return t < everySec ? { visible: false, secondsLeft: Math.ceil(everySec - t) } : { visible: true, secondsLeft: Math.ceil(cycle - t) };
}

/** m:ss for a countdown ("2:41"). */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What the host did by hand in the studio: null = follow the schedule. Never saved; a reload goes back to the schedule. */
export type AdManual = 'shown' | 'hidden' | null;

export interface AdSlot {
  placement: AdPlacement;
  /** The ad has a picture and the host/kit has it switched on. */
  enabled: boolean;
  schedule: AdSchedule;
  manual?: AdManual;
}

/** The opacity wanted for one ad right now, before priority: not enabled = 0, then manual, then the schedule. */
export function adTargetAlpha(elapsedSec: number, slot: AdSlot): number {
  if (!slot.enabled) return 0;
  if (slot.manual === 'shown') return 1;
  if (slot.manual === 'hidden') return 0;
  return Math.max(0, scheduleAlpha(elapsedSec, slot.schedule));
}

/** Target opacity of each placement after priority: full_screen fades the other two away while it is visible. Pass `out` to reuse an object. */
export function resolveAdAlphas(
  elapsedSec: number,
  slots: readonly AdSlot[],
  out: Record<AdPlacement, number> = { lower_third: 0, side_third: 0, full_screen: 0, l_shape: 0 },
): Record<AdPlacement, number> {
  out.lower_third = 0;
  out.side_third = 0;
  out.full_screen = 0;
  out.l_shape = 0;
  for (const slot of slots) out[slot.placement] = adTargetAlpha(elapsedSec, slot);
  return applyAdPriority(out);
}

/** How much each placement is multiplied by under the priority rule: full_screen > l_shape > lower_third / side_third (each fades the ones below it away). The argument holds the placements own opacities. */
export function adPriorityFactors(alphas: Record<AdPlacement, number>, out: Record<AdPlacement, number> = { lower_third: 1, side_third: 1, full_screen: 1, l_shape: 1 }): Record<AdPlacement, number> {
  const cover = alphas.full_screen;
  const frame = alphas.l_shape * (1 - cover);
  out.full_screen = 1;
  out.l_shape = 1 - cover;
  out.lower_third = (1 - cover) * (1 - frame);
  out.side_third = (1 - cover) * (1 - frame);
  return out;
}

/** The priority rule on placement opacities, in place. */
export function applyAdPriority(alphas: Record<AdPlacement, number>): Record<AdPlacement, number> {
  const f = adPriorityFactors(alphas);
  alphas.l_shape *= f.l_shape;
  alphas.lower_third *= f.lower_third;
  alphas.side_third *= f.side_third;
  return alphas;
}

// ---- Ad sequences: several ads of one placement played in turn ------------------------------------------------

/** One ad of a sequence, as the scheduler sees it. `showSec` = the show window (interval) or the dwell before the next ad (continuous). */
export interface SeqAd {
  /** Has a picture AND is switched on; anything else is skipped. */
  enabled: boolean;
  showSec: number;
}
/** The placement's schedule: the first ad's mode, plus the pause between showings for interval. */
export type SeqSchedule = { mode: 'continuous' } | { mode: 'interval'; everySec: number };

export interface SeqState {
  /** The ad (index into the list given) that is showing, or in interval mode's hidden part the one that shows next; -1 = no ad is on. */
  index: number;
  /** That ad's target opacity 0..1 (interval: the fade formula above; continuous: 1, or the fade-in share while cross-fading). */
  alpha: number;
  /** True while `index` is inside its shown window (always true in continuous mode when an ad is on). */
  visible: boolean;
  /** The ad fading out during a continuous cross-fade (-1 = none) and its opacity. */
  from: number;
  fromAlpha: number;
  /** Whole seconds until the current ad appears / disappears (interval), until the next ad (continuous); 0 with no ad. */
  secondsLeft: number;
}

export const newSeqState = (): SeqState => ({ index: -1, alpha: 0, visible: false, from: -1, fromAlpha: 0, secondsLeft: 0 });

const dwellOf = (showSec: number) => (showSec > 0 ? showSec : AD_DWELL_DEFAULT);

/** The scheduler: which ad of a sequence is current at `elapsedSec`, and how opaque it (and the one fading out) is. Pure; no allocation when `st` is passed (the draw loop does). `n` = how many entries of `ads` count. */
export function adSequenceState(elapsedSec: number, ads: readonly SeqAd[], schedule: SeqSchedule, n: number = ads.length, st: SeqState = newSeqState()): SeqState {
  st.index = -1;
  st.alpha = 0;
  st.visible = false;
  st.from = -1;
  st.fromAlpha = 0;
  st.secondsLeft = 0;
  let count = 0;
  let only = -1;
  for (let i = 0; i < n; i++) {
    if (ads[i].enabled) {
      count++;
      only = i;
    }
  }
  if (count === 0) return st;
  const e = Number.isFinite(elapsedSec) && elapsedSec > 0 ? elapsedSec : 0;

  if (!schedule || schedule.mode !== 'interval') {
    st.visible = true;
    if (count === 1) {
      st.index = only;
      st.alpha = 1;
      return st;
    }
    let total = 0;
    for (let i = 0; i < n; i++) if (ads[i].enabled) total += dwellOf(ads[i].showSec);
    const t = e % total;
    let start = 0;
    let prev = -1;
    for (let i = 0; i < n; i++) {
      if (!ads[i].enabled) continue;
      const d = dwellOf(ads[i].showSec);
      if (t < start + d || i === only) {
        const u = t - start;
        const f = Math.min(AD_FADE_SEC, d / 2);
        st.index = i;
        st.secondsLeft = Math.ceil(start + d - t);
        if (u < f && e >= f) {
          // Cross-fade: the ad before this one (cyclically) fades out while this one fades in.
          st.alpha = clamp01(u / f);
          st.from = prev >= 0 ? prev : lastEnabled(ads, n);
          st.fromAlpha = 1 - st.alpha;
        } else st.alpha = 1;
        break;
      }
      start += d;
      prev = i;
    }
    return st;
  }

  const { everySec } = schedule;
  if (!(everySec > 0)) return st;
  let total = 0;
  for (let i = 0; i < n; i++) if (ads[i].enabled && ads[i].showSec > 0) total += everySec + ads[i].showSec;
  if (!(total > 0)) return st;
  let t = e % total;
  for (let i = 0; i < n; i++) {
    if (!ads[i].enabled || !(ads[i].showSec > 0)) continue;
    const showSec = ads[i].showSec;
    const len = everySec + showSec;
    if (t < len || i === only) {
      st.index = i;
      if (t < everySec) {
        st.secondsLeft = Math.ceil(everySec - t);
        return st;
      }
      const u = t - everySec;
      const fade = Math.min(AD_FADE_SEC, showSec / 2);
      st.visible = true;
      st.alpha = clamp01(Math.min(u / fade, (showSec - u) / fade));
      st.secondsLeft = Math.ceil(len - t);
      return st;
    }
    t -= len;
  }
  return st;
}

function lastEnabled(ads: readonly SeqAd[], n: number): number {
  for (let i = n - 1; i >= 0; i--) if (ads[i].enabled) return i;
  return -1;
}

/**
 * Target opacity of every ad of a placement into `out` (indices as in `ads`): the schedule, then the manual override.
 * 'hidden' = all 0; 'shown' = the current/next ad at 1 (interval) or the running rotation (continuous).
 * Returns the placement's opacity min(1, sum) for the priority rule.
 */
export function adSequenceTargets(elapsedSec: number, ads: readonly SeqAd[], n: number, schedule: SeqSchedule, manual: AdManual, out: number[], st: SeqState = newSeqState()): number {
  for (let i = 0; i < out.length; i++) out[i] = 0;
  if (manual === 'hidden') return 0;
  adSequenceState(elapsedSec, ads, schedule, n, st);
  if (st.index < 0) return 0;
  out[st.index] = manual === 'shown' && schedule.mode === 'interval' ? 1 : st.alpha;
  if (st.from >= 0) out[st.from] = st.fromAlpha;
  const sum = out[st.index] + (st.from >= 0 ? st.fromAlpha : 0);
  return sum > 1 ? 1 : sum;
}

/** Moves `current` toward `target` by at most dtSec / AD_FADE_SEC: manual Show/Hide fades the same way the schedule does. */
export function stepAlpha(current: number, target: number, dtSec: number): number {
  const step = Math.max(0, dtSec) / AD_FADE_SEC;
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

/** The StreamBird ad every Free stream carries in the lower third: shown 15 s, then hidden 180 s (hidden first). */
export const FREE_PLAN_AD_SCHEDULE: AdSchedule = { mode: 'interval', showSec: 15, everySec: 180 };

/** Seconds <-> the number + unit the UI shows. Whole minutes show as minutes. */
export function splitSeconds(sec: number): { value: number; unit: 'sec' | 'min' } {
  return sec >= 60 && sec % 60 === 0 ? { value: sec / 60, unit: 'min' } : { value: sec, unit: 'sec' };
}
export function toSeconds(value: number, unit: 'sec' | 'min'): number {
  return Math.round(value * (unit === 'min' ? 60 : 1));
}

/** A schedule in words, e.g. "Always on" / "Shown for 15 sec, then hidden for 3 min". */
export function describeSchedule(schedule: AdSchedule): string {
  if (schedule.mode === 'continuous') return 'Always on';
  const fmt = (sec: number) => {
    const { value, unit } = splitSeconds(sec);
    return `${value} ${unit}`;
  };
  return `Shown for ${fmt(schedule.showSec)}, then hidden for ${fmt(schedule.everySec)}`;
}

/** Validates a schedule against the server's ranges; returns an error message or null. */
export function scheduleError(schedule: AdSchedule): string | null {
  if (schedule.mode === 'continuous') return null;
  const { showSec, everySec } = schedule;
  if (!Number.isInteger(showSec) || showSec < AD_SHOW_SEC_RANGE.min || showSec > AD_SHOW_SEC_RANGE.max) return 'Show time must be between 1 second and 60 minutes.';
  if (!Number.isInteger(everySec) || everySec < AD_EVERY_SEC_RANGE.min || everySec > AD_EVERY_SEC_RANGE.max) return 'Time between showings must be between 1 second and 24 hours.';
  return null;
}

// ---- Reserving space: the picture shrinks while an ad shows -------------------------------------------------
//
// SHRINK RULE (switch "Shrink picture while ads show", default on). While a lower_third or side_third ad is visible,
// the SCENE (camera tiles / layout / slides, the logo and the name lower-third banner) is scaled down, aspect ratio
// kept, to fit the area the ad leaves free, and centred in it. The wallpaper / canvas colour stay full-frame behind
// it (letterbox). The ticker stays at the very bottom edge (the ad stands on it), and the Free plan's mark is always
// on top. full_screen never shrinks anything (it is meant to cover).
//   lower_third: free area = x 0..W, y 0..top of the DRAWN ad picture (`fitAd` result, already above the ticker)
//   side_third:  free area = the right two thirds, x round(W/3)..W, full height
//   both at once: the intersection (right two thirds, above the lower third)
// Progress: each ad's current opacity (0..1, the 300 ms schedule/manual fade) through `shrinkEase` (smoothstep), so
// the picture eases in and out in step with the fade. insets = full inset * eased progress.

/** Smoothstep of an ad's opacity: 0 -> 0, 1 -> 1, gentle at both ends. */
export function shrinkEase(alpha: number): number {
  const t = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return t * t * (3 - 2 * t);
}

export interface SceneInsets {
  /** Pixels taken from the left edge. */
  left: number;
  /** Pixels taken from the bottom edge (includes the ticker bar the ad stands on). */
  bottom: number;
}

/**
 * The room an ad takes at full progress. `fitted` = where the ad picture is actually drawn (fitAd); without it the
 * placement's whole area is used. full_screen reserves nothing.
 */
export function adReserve(placement: AdPlacement, W: number, H: number, tickerBarHeight = 0, fitted: AdRect | null = null): SceneInsets {
  switch (placement) {
    case 'lower_third': {
      const top = fitted && fitted.h > 0 ? fitted.y : adRect('lower_third', W, H, tickerBarHeight).y;
      return { left: 0, bottom: Math.max(0, H - top) };
    }
    case 'side_third':
      return { left: adRect('side_third', W, H).w, bottom: 0 };
    case 'full_screen':
    case 'l_shape': // the frame has its own rule (`lShapeSceneRect`)
      return { left: 0, bottom: 0 };
  }
}

/**
 * Where the scene goes inside an L-shaped frame's window (a rectangle in canvas pixels): the W x H scene, scaled to
 * fit, aspect ratio kept, centred in the window (it may be smaller than the window when the shapes differ; the frame
 * graphic shows around it). Never larger than the canvas.
 */
export function lShapeSceneRect(W: number, H: number, win: AdRect): AdRect {
  if (!(win.w > 0) || !(win.h > 0)) return { x: 0, y: 0, w: W, h: H };
  const scale = Math.min(1, win.w / W, win.h / H);
  const w = W * scale;
  const h = H * scale;
  return { x: win.x + (win.w - w) / 2, y: win.y + (win.h - h) / 2, w, h };
}

/** The window (normalised 0..1 of the picture, see adWindow.ts) on the canvas, given where the picture is drawn (fitAd). */
export function windowOnCanvas(fitted: AdRect, win: { x: number; y: number; w: number; h: number }): AdRect {
  return { x: fitted.x + win.x * fitted.w, y: fitted.y + win.y * fitted.h, w: win.w * fitted.w, h: win.h * fitted.h };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Contain-fits the W x H scene into what is left after the insets, centred both ways. Never larger than the canvas. */
export function sceneRect(W: number, H: number, insets: SceneInsets): AdRect {
  const areaX = Math.min(Math.max(0, insets.left), W - 1);
  const areaW = W - areaX;
  const areaH = Math.max(1, H - Math.max(0, insets.bottom));
  const scale = Math.min(1, areaW / W, areaH / H);
  const w = W * scale;
  const h = H * scale;
  return { x: areaX + (areaW - w) / 2, y: (areaH - h) / 2, w, h };
}

export interface AdShrinkInput {
  /** The ad's current opacity 0..1 (after priority), 0 when it is not showing. */
  alpha: number;
  /** Where the ad picture is drawn; null = use the placement's whole area. */
  fitted?: AdRect | null;
  /** l_shape only: the frame's window in canvas pixels (windowOnCanvas). Without it the ad does not shrink the scene. */
  window?: AdRect | null;
}

/**
 * Where the scene is drawn while the given ads show (any subset of the four; missing = not showing). Returns the
 * whole canvas when nothing shrinks it. `tickerBarHeight` only matters for a lower_third without `fitted`.
 */
export function sceneRectFor(W: number, H: number, ads: Partial<Record<AdPlacement, AdShrinkInput>>, tickerBarHeight = 0): AdRect {
  let left = 0;
  let bottom = 0;
  for (const p of AD_PLACEMENTS) {
    const a = ads[p];
    if (!a || !(a.alpha > 0)) continue;
    const full = adReserve(p, W, H, tickerBarHeight, a.fitted ?? null);
    const k = shrinkEase(a.alpha);
    left = Math.max(left, full.left * k);
    bottom = Math.max(bottom, full.bottom * k);
  }
  const base: AdRect = left === 0 && bottom === 0 ? { x: 0, y: 0, w: W, h: H } : sceneRect(W, H, { left, bottom });
  const frame = ads.l_shape;
  if (!frame || !(frame.alpha > 0) || !frame.window) return base;
  // The frame eases the scene from wherever the other ads left it to the window, in step with its own fade.
  const target = lShapeSceneRect(W, H, frame.window);
  const k = shrinkEase(frame.alpha);
  return { x: lerp(base.x, target.x, k), y: lerp(base.y, target.y, k), w: lerp(base.w, target.w, k), h: lerp(base.h, target.h, k) };
}
