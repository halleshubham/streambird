/**
 * Animated lower-third banner: a title (a name or headline) and an optional second line (role, topic, any
 * text) that slides in over the bottom-left of the picture, holds, and slides out. Drawn on the studio canvas
 * like the logo and ticker, so every destination and the recording get it, with nothing on the server.
 * A Pro/Business feature (plan flag `canLowerThird`), gated in the studio.
 */
export type LowerThirdStyle = 'bar' | 'accent' | 'glass';

export const LOWER_THIRD_STYLES: Array<{ id: LowerThirdStyle; label: string }> = [
  { id: 'bar', label: 'Solid' },
  { id: 'accent', label: 'Accent' },
  { id: 'glass', label: 'Glass' },
];

export interface LowerThirdSettings {
  title: string;
  subtitle: string;
  style: LowerThirdStyle;
  /** Seconds on screen before it slides out by itself; 0 = stays until hidden. */
  autoHideSec: number;
}

export interface LowerThirdPreset {
  title: string;
  subtitle: string;
}

export const LOWER_THIRD_LIMITS = { title: 80, subtitle: 120, presets: 12, autoHideChoices: [0, 5, 8, 12] as const };

export const DEFAULT_LOWER_THIRD: LowerThirdSettings = { title: '', subtitle: '', style: 'accent', autoHideSec: 0 };

/** Slide in/out duration. */
export const LOWER_THIRD_MS = 600;

export function normalizeLowerThird(raw: Partial<LowerThirdSettings> | null | undefined): LowerThirdSettings {
  const r = raw ?? {};
  return {
    title: String(r.title ?? '').slice(0, LOWER_THIRD_LIMITS.title),
    subtitle: String(r.subtitle ?? '').slice(0, LOWER_THIRD_LIMITS.subtitle),
    style: LOWER_THIRD_STYLES.some((s) => s.id === r.style) ? (r.style as LowerThirdStyle) : DEFAULT_LOWER_THIRD.style,
    autoHideSec: (LOWER_THIRD_LIMITS.autoHideChoices as readonly number[]).includes(Number(r.autoHideSec)) ? Number(r.autoHideSec) : 0,
  };
}

export function normalizePresets(raw: unknown): LowerThirdPreset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p.title === 'string' && p.title.trim())
    .slice(0, LOWER_THIRD_LIMITS.presets)
    .map((p) => ({ title: p.title.slice(0, LOWER_THIRD_LIMITS.title), subtitle: String(p.subtitle ?? '').slice(0, LOWER_THIRD_LIMITS.subtitle) }));
}

/** Moves the 0..1 visibility progress toward its target by `dtMs`, at the slide speed. */
export function stepLowerThirdProgress(progress: number, visible: boolean, dtMs: number): number {
  const step = Math.max(0, dtMs) / LOWER_THIRD_MS;
  return visible ? Math.min(1, progress + step) : Math.max(0, progress - step);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

/**
 * Draws the banner at `progress` (0 = off-screen, 1 = resting). `reserveBottom` is the height of anything that
 * already lives along the bottom edge (the news ticker) so the banner sits above it.
 */
export function drawLowerThird(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: LowerThirdSettings,
  progress: number,
  reserveBottom: number,
): void {
  const title = s.title.trim();
  if (!title || progress <= 0) return;
  const subtitle = s.subtitle.trim();
  const portrait = h > w;
  const unit = (portrait ? w : h) / 720; // sizes below are for a 720-high (landscape) or 720-wide (vertical) frame
  const margin = Math.round(28 * unit);
  const titlePx = Math.round(30 * unit);
  const subPx = Math.round(20 * unit);
  const padX = Math.round(22 * unit);
  const padY = Math.round(14 * unit);
  const gap = Math.round(4 * unit);
  const stripe = s.style === 'accent' ? Math.round(8 * unit) : 0;
  const maxTextW = Math.min(w - margin * 2 - padX * 2 - stripe, w * (portrait ? 0.9 : 0.62));

  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${titlePx}px ${FONT}`;
  const shownTitle = fitText(ctx, title, maxTextW);
  const titleW = ctx.measureText(shownTitle).width;
  let subW = 0;
  let shownSub = '';
  if (subtitle) {
    ctx.font = `400 ${subPx}px ${FONT}`;
    shownSub = fitText(ctx, subtitle, maxTextW);
    subW = ctx.measureText(shownSub).width;
  }
  const boxW = Math.round(Math.max(titleW, subW) + padX * 2 + stripe);
  const boxH = Math.round(padY * 2 + titlePx + (subtitle ? gap + subPx : 0));
  // Vertical (9:16) keeps clear of the platforms' bottom UI; landscape sits just above the ticker.
  const bottomGap = portrait ? Math.round(h * 0.12) : margin;
  const restY = h - reserveBottom - bottomGap - boxH;
  const eased = easeOutCubic(Math.min(1, Math.max(0, progress)));
  const x = Math.round(margin - (1 - eased) * (boxW + margin));
  const y = restY;

  ctx.globalAlpha = Math.min(1, eased * 1.4);
  if (s.style === 'glass') {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 18 * unit;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
  } else {
    ctx.fillStyle = 'rgba(17,14,34,0.92)';
  }
  ctx.fillRect(x, y, boxW, boxH);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
  if (s.style === 'glass') {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1, 1.5 * unit);
    ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);
  }
  if (stripe) {
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(x, y, stripe, boxH);
  }

  const tx = x + stripe + padX;
  if (s.style === 'glass') {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 4 * unit;
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${titlePx}px ${FONT}`;
  ctx.fillText(shownTitle, tx, y + padY + titlePx * 0.82);
  if (subtitle) {
    ctx.fillStyle = s.style === 'glass' ? '#ffffff' : '#d9ccff';
    ctx.font = `400 ${subPx}px ${FONT}`;
    ctx.fillText(shownSub, tx, y + padY + titlePx + gap + subPx * 0.82);
  }
  ctx.restore();
}
