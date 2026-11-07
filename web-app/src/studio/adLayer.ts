// The advertisement layer of the broadcast canvas: holds the (up to three) ad pictures, decodes animated GIF ads
// once, and draws them every frame with the opacity the schedule asks for (see ads.ts for the exact rules).
// No React in here. The draw path allocates nothing per frame: pictures and GIF frames are cached, the slot
// objects (including the Free plan's) are reused and rectangles are only recomputed when the canvas, ticker or
// picture size changes.

import {
  AD_DRAW_ORDER,
  FREE_PLAN_AD_SCHEDULE,
  adRect,
  adTargetAlpha,
  fitAd,
  resolveAdAlphas,
  sceneRectFor,
  stepAlpha,
  windowOnCanvas,
  type AdManual,
  type AdPlacement,
  type AdRect,
  type AdShrinkInput,
  type AdSchedule,
  type AdSlot,
} from './ads';
import { decodeAnimatedImage, type AnimatedImage } from './animatedImage';
import type { NormRect } from './adWindow';
import { windowOfImage } from './adWindowDom';

/**
 * Tests can pin the ad clock with `window.__SB_TEST_AD_ELAPSED__` (seconds), but only after they arm it with the
 * localStorage key below, and never on the Free plan (its StreamBird ad cannot be retimed). Without the key the
 * property is ignored, so a stray global in production does nothing.
 */
declare global {
  interface Window {
    __SB_TEST_AD_ELAPSED__?: number;
  }
}
export const AD_TEST_ARM_KEY = 'streambird:test:adclock';

export const FREE_AD_URL = '/streambird-ad-lower-third.png';
/** Where a custom ad's picture came from: the brand kit (library asset) or a file picked on this computer. */
export type AdSource = 'kit' | 'computer';
/** A computer-picked picture may not be bigger than the server allows for library files. */
export const MAX_AD_SIDE = 8192;
const FREE_AD_RETRY_MS = 10_000;
/** The placements that make room for themselves (full screen covers instead). */
const SHRINKING: readonly AdPlacement[] = ['lower_third', 'side_third'];
interface Runtime {
  img: HTMLImageElement | null;
  blob: Blob | null;
  anim: { image: AnimatedImage; startedAt: number } | null;
  /** A GIF whose animation was not (or could not be) decoded: it is drawn as a still picture. */
  still: boolean;
  animStarted: boolean;
  token: number;
  enabled: boolean;
  schedule: AdSchedule;
  manual: AdManual;
  alpha: number;
  /** First frame after the picture arrived: jump to the target instead of fading in from nothing. */
  snap: boolean;
  source: AdSource | null;
  assetId: string | null;
  name: string | null;
  /** Object URL of the picture, also used for the small thumbnail in the studio. Revoked on replace. */
  previewUrl: string | null;
  rect: AdRect;
  /** l_shape only: the detected window as fractions of the picture (null = none found, see ads.ts). */
  win: NormRect | null;
  /** The window on the canvas (pixels), kept up to date by fit(). */
  winPx: AdRect | null;
  keyW: number;
  keyH: number;
  keyBar: number;
  keyIw: number;
  keyIh: number;
}

const newRuntime = (): Runtime => ({
  img: null,
  blob: null,
  anim: null,
  still: false,
  animStarted: false,
  token: 0,
  enabled: true,
  schedule: { mode: 'continuous' },
  manual: null,
  alpha: 0,
  snap: true,
  source: null,
  assetId: null,
  name: null,
  previewUrl: null,
  rect: { x: 0, y: 0, w: 0, h: 0 },
  win: null,
  winPx: null,
  keyW: -1,
  keyH: -1,
  keyBar: -1,
  keyIw: -1,
  keyIh: -1,
});

export interface AdInfo {
  hasMedia: boolean;
  source: AdSource | null;
  assetId: string | null;
  name: string | null;
  previewUrl: string | null;
  enabled: boolean;
  schedule: AdSchedule;
  manual: AdManual;
  /** An animated GIF that is being shown as a still picture (no animation support here, or too heavy). */
  still: boolean;
  /** l_shape only: the window found in the picture (0..1 of it); null with media = no clear window was found. */
  window: NormRect | null;
  /** width / height of the picture (for the thumbnail outline); null without a picture. */
  aspect: number | null;
}

export type SetMediaResult = true | false | 'too-big';

export class AdLayer {
  private readonly rt: Record<AdPlacement, Runtime> = { lower_third: newRuntime(), side_third: newRuntime(), full_screen: newRuntime(), l_shape: newRuntime() };
  private readonly slotList: AdSlot[] = AD_DRAW_ORDER.map((placement) => ({ placement, enabled: false, schedule: { mode: 'continuous' } as AdSchedule, manual: null as AdManual }));
  private readonly targets: Record<AdPlacement, number> = { lower_third: 0, side_third: 0, full_screen: 0, l_shape: 0 };
  private readonly freeSlot: AdSlot = { placement: 'lower_third', enabled: true, schedule: FREE_PLAN_AD_SCHEDULE, manual: null };
  private free: Runtime = newRuntime();
  private freeLoading = false;
  private freeRetryAt = 0;
  private freePlan = false;
  private shrinkOn = true;
  private readonly shrinkInput: Partial<Record<AdPlacement, AdShrinkInput>> = {};
  private clockStart = performance.now();
  private lastNow: number | null = null;
  /** Called when an ad's still/animated state changes, so the studio can refresh its cards. */
  onChange: (() => void) | null = null;

  info(p: AdPlacement): AdInfo {
    const r = this.rt[p];
    return { hasMedia: !!r.img, source: r.source, assetId: r.assetId, name: r.name, previewUrl: r.previewUrl, enabled: r.enabled, schedule: r.schedule, manual: r.manual, still: r.still, window: r.win, aspect: r.img && r.img.naturalHeight > 0 ? r.img.naturalWidth / r.img.naturalHeight : null };
  }

  /** The Free plan draws only StreamBird's own ad, so custom GIFs are not even decoded there. */
  setFreePlan(free: boolean): void {
    this.freePlan = free;
  }

  /** Restarts the schedule clock at 0 (called when the host goes live). */
  restartClock(now = performance.now()): void {
    this.clockStart = now;
  }

  elapsedSec(now: number): number {
    if (!this.freePlan && typeof window !== 'undefined' && typeof window.__SB_TEST_AD_ELAPSED__ === 'number' && Number.isFinite(window.__SB_TEST_AD_ELAPSED__)) {
      let armed = false;
      try {
        armed = localStorage.getItem(AD_TEST_ARM_KEY) === 'on';
      } catch {
        armed = false;
      }
      if (armed) return window.__SB_TEST_AD_ELAPSED__;
    }
    return (now - this.clockStart) / 1000;
  }

  setEnabled(p: AdPlacement, enabled: boolean): void {
    this.rt[p].enabled = enabled;
  }

  setSchedule(p: AdPlacement, schedule: AdSchedule): void {
    this.rt[p].schedule = schedule;
  }

  setManual(p: AdPlacement, manual: AdManual): void {
    this.rt[p].manual = manual;
  }

  /**
   * Loads a picture (PNG/JPG/WebP/GIF) into a placement. Resolves true when it is ready to draw, false when it
   * could not be opened or was superseded by a newer call, 'too-big' when a side is over `maxSide` (when given).
   * An animated GIF is decoded later, only when the ad is actually going to be drawn.
   */
  async setMedia(p: AdPlacement, blob: Blob, meta: { source: AdSource; assetId?: string | null; name: string }, maxSide?: number): Promise<SetMediaResult> {
    const r = this.rt[p];
    const token = ++r.token;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });
    if (token !== r.token || !loaded) {
      URL.revokeObjectURL(url);
      return false;
    }
    if (maxSide && (img.naturalWidth > maxSide || img.naturalHeight > maxSide)) {
      URL.revokeObjectURL(url);
      return 'too-big';
    }
    if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
    r.img = img;
    r.win = p === 'l_shape' ? windowOfImage(img) : null;
    r.blob = blob;
    r.anim = null;
    r.still = false;
    r.animStarted = false;
    r.previewUrl = url;
    r.source = meta.source;
    r.assetId = meta.assetId ?? null;
    r.name = meta.name;
    r.snap = true;
    r.keyW = -1; // force a fresh fit
    return true;
  }

  clearMedia(p: AdPlacement): void {
    const r = this.rt[p];
    r.token += 1;
    if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
    r.img = null;
    r.win = null;
    r.blob = null;
    r.anim = null;
    r.still = false;
    r.animStarted = false;
    r.previewUrl = null;
    r.source = null;
    r.assetId = null;
    r.name = null;
    r.alpha = 0;
    r.manual = null;
  }

  dispose(): void {
    for (const p of AD_DRAW_ORDER) this.clearMedia(p);
  }

  /** Decodes a GIF ad's frames, at most as big as the area it is drawn into. Called the first time the ad can be seen. */
  private startAnim(p: AdPlacement, r: Runtime, w: number, h: number): void {
    r.animStarted = true;
    const blob = r.blob;
    if (!blob || blob.type !== 'image/gif') return;
    const area = adRect(p, w, h, 0);
    const token = r.token;
    void decodeAnimatedImage(blob, Math.max(32, area.h), Math.max(32, area.w)).then((image) => {
      if (token !== r.token) return;
      if (image) r.anim = { image, startedAt: performance.now() };
      else r.still = true;
      this.onChange?.();
    });
  }

  private loadFreeAd(now: number): void {
    if (this.freeLoading || now < this.freeRetryAt) return;
    this.freeLoading = true;
    const img = new Image();
    img.onload = () => {
      this.free.img = img;
      this.free.snap = true;
    };
    img.onerror = () => {
      this.freeLoading = false; // try again a little later (a flaky network at the start must not remove the ad for the whole stream)
      this.freeRetryAt = performance.now() + FREE_AD_RETRY_MS;
    };
    img.src = FREE_AD_URL;
  }

  /** Recomputes where the picture is drawn when the canvas, ticker or picture size changed. */
  private fit(r: Runtime, p: AdPlacement, w: number, h: number, tickerBar: number): void {
    const img = r.img;
    if (!img) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (r.keyW !== w || r.keyH !== h || r.keyBar !== tickerBar || r.keyIw !== iw || r.keyIh !== ih) {
      r.rect = fitAd(p, iw, ih, adRect(p, w, h, tickerBar));
      r.winPx = r.win && r.rect.w > 0 ? windowOnCanvas(r.rect, r.win) : null;
      r.keyW = w;
      r.keyH = h;
      r.keyBar = tickerBar;
      r.keyIw = iw;
      r.keyIh = ih;
    }
  }

  private drawOne(ctx: CanvasRenderingContext2D, r: Runtime, now: number): void {
    const img = r.img;
    if (!img || r.alpha <= 0.002 || r.rect.w <= 0) return;
    ctx.globalAlpha = r.alpha;
    ctx.drawImage(r.anim ? r.anim.image.frameAt(now - r.anim.startedAt) : img, r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    ctx.globalAlpha = 1;
  }

  /**
   * Advances the ads one frame: schedule, fades and rectangles. Call it BEFORE drawing the scene (so `sceneRect`
   * is current), then `paint` after. `freePlan` = the plan carries the "Powered by StreamBird" mark: then only
   * StreamBird's own lower-third ad runs (15 s every 180 s) and the custom ones do not.
   */
  step(w: number, h: number, now: number, tickerBar: number, freePlan: boolean): void {
    const dt = this.lastNow === null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.freePlan = freePlan;
    const elapsed = this.elapsedSec(now);

    if (freePlan) {
      this.loadFreeAd(now);
      const f = this.free;
      const target = f.img ? adTargetAlpha(elapsed, this.freeSlot) : 0;
      f.alpha = f.snap ? target : stepAlpha(f.alpha, target, dt);
      f.snap = false;
      this.fit(f, 'lower_third', w, h, tickerBar);
      return;
    }

    let any = false;
    for (let i = 0; i < this.slotList.length; i++) {
      const slot = this.slotList[i];
      const r = this.rt[slot.placement];
      // The L-shaped frame always resizes the picture, so it cannot run while "Shrink picture while ads show" is off.
      slot.enabled = !!r.img && r.enabled && (slot.placement !== 'l_shape' || this.shrinkOn);
      slot.schedule = r.schedule;
      slot.manual = r.manual;
      if (slot.enabled || r.alpha > 0) any = true;
      if (slot.enabled && !r.animStarted && r.blob) this.startAnim(slot.placement, r, w, h);
    }
    if (!any) return;
    resolveAdAlphas(elapsed, this.slotList, this.targets);
    for (const p of AD_DRAW_ORDER) {
      const r = this.rt[p];
      r.alpha = r.snap ? this.targets[p] : stepAlpha(r.alpha, this.targets[p], dt);
      if (r.img) r.snap = false;
      this.fit(r, p, w, h, tickerBar);
    }
  }

  /**
   * Draws the L-shaped frame (as stepped) as the BASE layer, under the scene. Call it after the background and
   * wallpaper, before the scene. Does nothing when no frame with a window is showing.
   */
  paintBase(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.freePlan) return;
    const r = this.rt.l_shape;
    if (r.win) this.drawOne(ctx, r, now);
  }

  /** True while a frame with a window is visible: the scene is then drawn with its own background, inside the window. */
  frameActive(): boolean {
    if (this.freePlan) return false;
    const r = this.rt.l_shape;
    return !!r.img && !!r.win && r.alpha > 0.002;
  }

  /** Draws the ads (as stepped) over the finished picture. A frame with no window is drawn here, as a full-screen overlay. */
  paint(ctx: CanvasRenderingContext2D, now: number): void {
    if (this.freePlan) {
      this.drawOne(ctx, this.free, now);
      return;
    }
    for (const p of AD_DRAW_ORDER) {
      if (p === 'l_shape' && this.rt.l_shape.win) continue; // drawn by paintBase
      this.drawOne(ctx, this.rt[p], now);
    }
  }

  /** step + paint in one call. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, tickerBar: number, freePlan: boolean): void {
    this.step(w, h, now, tickerBar, freePlan);
    this.paint(ctx, now);
  }

  /** Whether the live picture shrinks to make room for ads (the "Shrink picture while ads show" switch). */
  setShrink(on: boolean): void {
    this.shrinkOn = on;
  }

  get shrink(): boolean {
    return this.shrinkOn;
  }

  /**
   * Where the scene is drawn right now (as of the last `step`), or null when it fills the canvas (switch off, no
   * shrinking ad visible). See the SHRINK RULE in ads.ts.
   */
  sceneRect(w: number, h: number): AdRect | null {
    if (!this.shrinkOn) return null;
    const input = this.shrinkInput;
    if (this.freePlan) {
      input.lower_third = { alpha: this.free.img ? this.free.alpha : 0, fitted: this.free.rect };
      input.side_third = { alpha: 0, fitted: null };
    } else {
      for (const p of SHRINKING) {
        const r = this.rt[p];
        input[p] = { alpha: r.img ? r.alpha : 0, fitted: r.rect };
      }
    }
    const frame = this.rt.l_shape;
    input.l_shape = { alpha: !this.freePlan && frame.img && frame.win ? frame.alpha : 0, fitted: frame.rect, window: frame.winPx };
    if (!((input.lower_third?.alpha ?? 0) > 0.002 || (input.side_third?.alpha ?? 0) > 0.002 || (input.l_shape.alpha > 0.002 && !!input.l_shape.window))) return null;
    return sceneRectFor(w, h, input);
  }
}
