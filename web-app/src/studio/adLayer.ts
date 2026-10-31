// The advertisement layer of the broadcast canvas: holds the (up to three) ad pictures, decodes animated GIF ads
// once, and draws them every frame with the opacity the schedule asks for (see ads.ts for the exact rules).
// No React in here. The draw path allocates nothing per frame: pictures and GIF frames are cached, the slot
// objects are reused and rectangles are only recomputed when the canvas, ticker or picture size changes.

import {
  AD_DRAW_ORDER,
  FREE_PLAN_AD_SCHEDULE,
  adRect,
  adTargetAlpha,
  fitAd,
  resolveAdAlphas,
  stepAlpha,
  type AdManual,
  type AdPlacement,
  type AdRect,
  type AdSchedule,
  type AdSlot,
} from './ads';
import { decodeAnimatedImage, type AnimatedImage } from './animatedImage';

/** Tests set this to a number of seconds to pin the ad clock (otherwise it is the wall clock since go-live / page open). */
declare global {
  interface Window {
    __SB_TEST_AD_ELAPSED__?: number;
  }
}

export const FREE_AD_URL = '/streambird-ad-lower-third.png';
/** Where a custom ad's picture came from: the brand kit (library asset) or a file picked on this computer. */
export type AdSource = 'kit' | 'computer';

interface Runtime {
  img: HTMLImageElement | null;
  anim: { image: AnimatedImage; startedAt: number } | null;
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
  keyW: number;
  keyH: number;
  keyBar: number;
  keyIw: number;
  keyIh: number;
}

const newRuntime = (): Runtime => ({
  img: null,
  anim: null,
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
}

export class AdLayer {
  private readonly rt: Record<AdPlacement, Runtime> = { lower_third: newRuntime(), side_third: newRuntime(), full_screen: newRuntime() };
  private readonly slotList: AdSlot[] = AD_DRAW_ORDER.map((placement) => ({ placement, enabled: false, schedule: { mode: 'continuous' } as AdSchedule, manual: null as AdManual }));
  private readonly targets: Record<AdPlacement, number> = { lower_third: 0, side_third: 0, full_screen: 0 };
  private free: Runtime = newRuntime();
  private freeLoading = false;
  private clockStart = performance.now();
  private lastNow: number | null = null;

  info(p: AdPlacement): AdInfo {
    const r = this.rt[p];
    return { hasMedia: !!r.img, source: r.source, assetId: r.assetId, name: r.name, previewUrl: r.previewUrl, enabled: r.enabled, schedule: r.schedule, manual: r.manual };
  }

  /** Restarts the schedule clock at 0 (called when the host goes live). */
  restartClock(now = performance.now()): void {
    this.clockStart = now;
  }

  elapsedSec(now: number): number {
    const pinned = typeof window !== 'undefined' ? window.__SB_TEST_AD_ELAPSED__ : undefined;
    return typeof pinned === 'number' && Number.isFinite(pinned) ? pinned : (now - this.clockStart) / 1000;
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

  /** Loads a picture (PNG/JPG/WebP/GIF) into a placement. Resolves true when it is ready to draw; a newer call supersedes an older one. */
  async setMedia(p: AdPlacement, blob: Blob, meta: { source: AdSource; assetId?: string | null; name: string }, canvasHint: { w: number; h: number }): Promise<boolean> {
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
    if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
    r.img = img;
    r.anim = null;
    r.previewUrl = url;
    r.source = meta.source;
    r.assetId = meta.assetId ?? null;
    r.name = meta.name;
    r.snap = true;
    r.keyW = -1; // force a fresh fit
    if (blob.type === 'image/gif') {
      // Frames no bigger than the area they will be drawn into (the canvas is the upper bound for any placement).
      void decodeAnimatedImage(blob, Math.max(64, canvasHint.h), Math.max(64, canvasHint.w)).then((image) => {
        if (image && token === r.token) r.anim = { image, startedAt: performance.now() };
      });
    }
    return true;
  }

  clearMedia(p: AdPlacement): void {
    const r = this.rt[p];
    r.token += 1;
    if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
    r.img = null;
    r.anim = null;
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

  private loadFreeAd(): void {
    if (this.freeLoading) return;
    this.freeLoading = true;
    const img = new Image();
    img.onload = () => {
      this.free.img = img;
      this.free.snap = true;
    };
    img.src = FREE_AD_URL;
  }

  private drawOne(ctx: CanvasRenderingContext2D, r: Runtime, p: AdPlacement, w: number, h: number, tickerBar: number, now: number): void {
    const img = r.img;
    if (!img || r.alpha <= 0.002) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (r.keyW !== w || r.keyH !== h || r.keyBar !== tickerBar || r.keyIw !== iw || r.keyIh !== ih) {
      r.rect = fitAd(p, iw, ih, adRect(p, w, h, tickerBar));
      r.keyW = w;
      r.keyH = h;
      r.keyBar = tickerBar;
      r.keyIw = iw;
      r.keyIh = ih;
    }
    if (r.rect.w <= 0) return;
    ctx.globalAlpha = r.alpha;
    ctx.drawImage(r.anim ? r.anim.image.frameAt(now - r.anim.startedAt) : img, r.rect.x, r.rect.y, r.rect.w, r.rect.h);
    ctx.globalAlpha = 1;
  }

  /**
   * Draws the ads over the finished picture. `freePlan` = the plan carries the "Powered by StreamBird" mark: then
   * only StreamBird's own lower-third ad is drawn (15 s every 180 s) and the custom ones are not.
   */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, now: number, tickerBar: number, freePlan: boolean): void {
    const dt = this.lastNow === null ? 0 : Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const elapsed = this.elapsedSec(now);

    if (freePlan) {
      this.loadFreeAd();
      const f = this.free;
      const target = f.img ? adTargetAlpha(elapsed, { placement: 'lower_third', enabled: true, schedule: FREE_PLAN_AD_SCHEDULE, manual: null }) : 0;
      f.alpha = f.snap ? target : stepAlpha(f.alpha, target, dt);
      f.snap = false;
      this.drawOne(ctx, f, 'lower_third', w, h, tickerBar, now);
      return;
    }

    let any = false;
    for (let i = 0; i < this.slotList.length; i++) {
      const slot = this.slotList[i];
      const r = this.rt[slot.placement];
      slot.enabled = !!r.img && r.enabled;
      slot.schedule = r.schedule;
      slot.manual = r.manual;
      if (slot.enabled || r.alpha > 0) any = true;
    }
    if (!any) return;
    resolveAdAlphas(elapsed, this.slotList, this.targets);
    for (const p of AD_DRAW_ORDER) {
      const r = this.rt[p];
      r.alpha = r.snap ? this.targets[p] : stepAlpha(r.alpha, this.targets[p], dt);
      if (r.img) r.snap = false;
      this.drawOne(ctx, r, p, w, h, tickerBar, now);
    }
  }
}
