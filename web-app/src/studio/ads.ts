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
 * Priority (`resolveAdAlphas`): while full_screen is visible it hides the other two: their alpha is multiplied
 *   by (1 - alpha of full_screen), so they cross-fade away with it and are gone once it is at alpha 1.
 *   Draw order on the canvas (bottom to top): tiles, logo, ticker, name lower-third banner, then the ads
 *   lower_third, side_third, full_screen (so side_third draws above lower_third), and finally the Free plan's
 *   "Powered by StreamBird" mark, always on top.
 */

export const AD_PLACEMENTS = ['lower_third', 'side_third', 'full_screen'] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/** Draw order, first = bottom. */
export const AD_DRAW_ORDER: readonly AdPlacement[] = AD_PLACEMENTS;

export const AD_FADE_SEC = 0.3;
export const AD_SHOW_SEC_RANGE = { min: 1, max: 3600 } as const;
export const AD_EVERY_SEC_RANGE = { min: 1, max: 86400 } as const;

export type AdSchedule = { mode: 'continuous' } | { mode: 'interval'; showSec: number; everySec: number };

export const AD_PLACEMENT_LABEL: Record<AdPlacement, string> = {
  lower_third: 'Lower third',
  side_third: 'Left third',
  full_screen: 'Full screen',
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
  if (schedule.mode === 'continuous') return 1;
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
  out: Record<AdPlacement, number> = { lower_third: 0, side_third: 0, full_screen: 0 },
): Record<AdPlacement, number> {
  out.lower_third = 0;
  out.side_third = 0;
  out.full_screen = 0;
  for (const slot of slots) out[slot.placement] = adTargetAlpha(elapsedSec, slot);
  const cover = out.full_screen;
  out.lower_third *= 1 - cover;
  out.side_third *= 1 - cover;
  return out;
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
