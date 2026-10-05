/**
 * Pure (DOM-free) description of the studio canvas: which layouts exist, where each
 * tile goes for a given canvas size, and the canvas styles ("themes"). The draw loop in
 * useHostStudio only consumes this, which keeps the geometry unit-testable.
 *
 * 'grid' and 'spotlight' are the original layouts and, with the 'vanilla' style, render
 * exactly what the studio always drew. Everything else is additive.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type LayoutGroup = 'Classic' | 'Podcast' | 'Podcast + slides' | 'Anchor + slides' | 'Panel + slides';

export interface LayoutDef {
  id: string;
  name: string;
  group: LayoutGroup;
  /** How many people tiles the layout has. Anyone beyond that stays in the audio mix but isn't drawn. */
  maxPeople: number;
  /** Whether the layout has a slide area (slideshow images, or the screen share when one is active). */
  hasSlide: boolean;
  description: string;
}

export const LAYOUTS = [
  { id: 'grid', name: 'Grid (classic)', group: 'Classic', maxPeople: 99, hasSlide: false, description: 'Everyone in an even grid, edge to edge.' },
  { id: 'spotlight', name: 'Spotlight (classic)', group: 'Classic', maxPeople: 99, hasSlide: false, description: 'One large, the rest as thumbnails.' },

  { id: 'podcast-split', name: 'Podcast: side by side', group: 'Podcast', maxPeople: 2, hasSlide: false, description: 'Host and guest in two equal tiles.' },
  { id: 'podcast-center', name: 'Podcast: centred duo', group: 'Podcast', maxPeople: 2, hasSlide: false, description: 'Two smaller tiles with room around them for the canvas style.' },
  { id: 'podcast-pip', name: 'Podcast: guest large, host inset', group: 'Podcast', maxPeople: 2, hasSlide: false, description: 'The guest (or pinned person) fills the frame, the host sits in a corner.' },

  { id: 'pod-slide-left', name: 'Podcast + slides: slide left', group: 'Podcast + slides', maxPeople: 2, hasSlide: true, description: 'Large slide on the left, host above guest on the right.' },
  { id: 'pod-slide-top', name: 'Podcast + slides: slide on top', group: 'Podcast + slides', maxPeople: 2, hasSlide: true, description: 'Slide across the top, host and guest below.' },
  { id: 'pod-slide-pip', name: 'Podcast + slides: slide with insets', group: 'Podcast + slides', maxPeople: 2, hasSlide: true, description: 'Slide fills the frame, host and guest in small corner tiles.' },

  { id: 'anchor-slide-right', name: 'Anchor + slides: anchor left', group: 'Anchor + slides', maxPeople: 1, hasSlide: true, description: 'Anchor on the left, slide on the right.' },
  { id: 'anchor-slide-left', name: 'Anchor + slides: anchor right', group: 'Anchor + slides', maxPeople: 1, hasSlide: true, description: 'Slide on the left, anchor on the right.' },
  { id: 'anchor-pip', name: 'Anchor + slides: slide with inset', group: 'Anchor + slides', maxPeople: 1, hasSlide: true, description: 'Slide fills the frame, the anchor sits in a corner.' },

  { id: 'panel-slide-left', name: 'Host + 3 guests + slides: slide left', group: 'Panel + slides', maxPeople: 4, hasSlide: true, description: 'Slide on the left, four people in a 2x2 block on the right.' },
  { id: 'panel-slide-top', name: 'Host + 3 guests + slides: slide on top', group: 'Panel + slides', maxPeople: 4, hasSlide: true, description: 'Slide across the top, four people in a row below.' },
] as const satisfies readonly LayoutDef[];

export type LayoutId = (typeof LAYOUTS)[number]['id'];

export const LAYOUT_BY_ID: Record<LayoutId, LayoutDef> = Object.fromEntries(LAYOUTS.map((l) => [l.id, l])) as Record<LayoutId, LayoutDef>;

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && value in LAYOUT_BY_ID;
}

/** 'grid' and 'spotlight' keep the original edge-to-edge drawing; everything else is a framed layout. */
export function isFramedLayout(id: LayoutId): boolean {
  return id !== 'grid' && id !== 'spotlight';
}

export interface LayoutGeometry {
  slide: Rect | null;
  people: Rect[];
}

const r = (x: number, y: number, w: number, h: number): Rect => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

/** The largest 16:9 rectangle that fits in the region, centred in it. */
function fit16x9(region: Rect): Rect {
  const w = Math.min(region.w, (region.h * 16) / 9);
  const h = (w * 9) / 16;
  return r(region.x + (region.w - w) / 2, region.y + (region.h - h) / 2, w, h);
}

/** Outer margin and gutter for a canvas size. */
export function gutterFor(w: number, h: number): number {
  return Math.round(Math.min(w, h) * 0.035);
}

/** Where the slide area and the people tiles go for a layout on a w x h canvas. 'grid'/'spotlight' have no fixed geometry. */
export function computeLayout(id: LayoutId, w: number, h: number): LayoutGeometry {
  const m = gutterFor(w, h);
  switch (id) {
    case 'podcast-split': {
      const tw = (w - 3 * m) / 2;
      const th = Math.min(h - 2 * m, (tw * 3) / 4);
      const y = (h - th) / 2;
      return { slide: null, people: [r(m, y, tw, th), r(2 * m + tw, y, tw, th)] };
    }
    case 'podcast-center': {
      const tw = w * 0.4;
      const th = Math.min(h - 2 * m, (tw * 3) / 4);
      const gap = 2 * m;
      const x0 = (w - 2 * tw - gap) / 2;
      const y = (h - th) / 2;
      return { slide: null, people: [r(x0, y, tw, th), r(x0 + tw + gap, y, tw, th)] };
    }
    case 'podcast-pip': {
      const pw = w * 0.24;
      const ph = (pw * 3) / 4;
      return { slide: null, people: [r(m, m, w - 2 * m, h - 2 * m), r(w - 2 * m - pw, h - 2 * m - ph - h * 0.05, pw, ph)] };
    }
    case 'pod-slide-left': {
      const leftW = (w - 3 * m) * 0.66;
      const rightW = w - 3 * m - leftW;
      const th = (h - 3 * m) / 2;
      return {
        slide: fit16x9(r(m, m, leftW, h - 2 * m)),
        people: [r(2 * m + leftW, m, rightW, th), r(2 * m + leftW, 2 * m + th, rightW, th)],
      };
    }
    case 'pod-slide-top': {
      const topH = (h - 3 * m) * 0.68;
      const th = h - 3 * m - topH;
      const tw = Math.min((w - 3 * m) / 2, (th * 16) / 9);
      const x0 = (w - 2 * tw - m) / 2;
      return {
        slide: fit16x9(r(m, m, w - 2 * m, topH)),
        people: [r(x0, 2 * m + topH, tw, th), r(x0 + tw + m, 2 * m + topH, tw, th)],
      };
    }
    case 'pod-slide-pip': {
      const pw = w * 0.17;
      const ph = (pw * 3) / 4;
      const y = h - m - ph - h * 0.05;
      return {
        slide: fit16x9(r(m, m, w - 2 * m, h - 2 * m)),
        people: [r(w - 2 * m - 2 * pw - m, y, pw, ph), r(w - 2 * m - pw, y, pw, ph)],
      };
    }
    case 'anchor-slide-right': {
      const aw = (w - 3 * m) * 0.3;
      return {
        slide: fit16x9(r(2 * m + aw, m, w - 3 * m - aw, h - 2 * m)),
        people: [r(m, m, aw, h - 2 * m)],
      };
    }
    case 'anchor-slide-left': {
      const aw = (w - 3 * m) * 0.3;
      return {
        slide: fit16x9(r(m, m, w - 3 * m - aw, h - 2 * m)),
        people: [r(w - m - aw, m, aw, h - 2 * m)],
      };
    }
    case 'anchor-pip': {
      const pw = w * 0.22;
      const ph = (pw * 3) / 4;
      return {
        slide: fit16x9(r(m, m, w - 2 * m, h - 2 * m)),
        people: [r(w - 2 * m - pw, h - m - ph - h * 0.05, pw, ph)],
      };
    }
    case 'panel-slide-left': {
      const leftW = (w - 3 * m) * 0.58;
      const rightW = w - 3 * m - leftW;
      const tw = (rightW - m) / 2;
      const th = (h - 3 * m) / 2;
      const x0 = 2 * m + leftW;
      return {
        slide: fit16x9(r(m, m, leftW, h - 2 * m)),
        people: [r(x0, m, tw, th), r(x0 + tw + m, m, tw, th), r(x0, 2 * m + th, tw, th), r(x0 + tw + m, 2 * m + th, tw, th)],
      };
    }
    case 'panel-slide-top': {
      const topH = (h - 3 * m) * 0.66;
      const th = h - 3 * m - topH;
      const tw = (w - 5 * m) / 4;
      return {
        slide: fit16x9(r(m, m, w - 2 * m, topH)),
        people: [0, 1, 2, 3].map((i) => r(m + i * (tw + m), 2 * m + topH, tw, th)),
      };
    }
    default:
      return { slide: null, people: [] };
  }
}

export const HOST_ID = 'local';
export const SCREEN_SHARE_ID = 'screen-share';

/**
 * People in tile order: the host first, then guests as they joined. 'podcast-pip' puts the
 * pinned person (else the guest) in the large tile and the host in the inset.
 */
export function orderPeople<T extends { id: string }>(layout: LayoutId, entries: T[], pinnedId: string | null): T[] {
  const host = entries.find((e) => e.id === HOST_ID);
  const rest = entries.filter((e) => e.id !== HOST_ID);
  const ordered = host ? [host, ...rest] : rest;
  if (layout !== 'podcast-pip' || ordered.length < 2) return ordered;
  const main = ordered.find((e) => e.id === pinnedId) ?? ordered[1];
  return [main, ...ordered.filter((e) => e !== main)];
}

// ---- Canvas styles ---------------------------------------------------------

export type PatternKind = 'none' | 'lines-h' | 'lines-v' | 'grid' | 'dots' | 'diagonal' | 'ruled' | 'pinstripe';
export type ThemeGroup = 'Classic' | 'News' | 'Healthcare' | 'Technology' | 'Education' | 'Legal';

export interface CanvasTheme {
  id: string;
  name: string;
  group: ThemeGroup;
  /** Background gradient, top-left to bottom-right. */
  bg: [string, string];
  pattern: PatternKind;
  /** Pattern colour; kept very low alpha so it stays subtle. */
  patternColor: string;
  accent: string;
  accent2: string;
  /** Text on the canvas background (slide placeholder, etc.). */
  fg: string;
  /** Border drawn round tiles and the slide. */
  border: string;
  /** Rounded-corner scale for framed tiles (1 = default). */
  radius: number;
  tickerBg: string;
  tickerFg: string;
  /** Behind a slide image / an empty tile. */
  cardBg: string;
}

export const THEMES: CanvasTheme[] = [
  {
    id: 'vanilla',
    name: 'Vanilla (current look)',
    group: 'Classic',
    bg: ['#000000', '#000000'],
    pattern: 'none',
    patternColor: 'rgba(255,255,255,0)',
    accent: '#7c3aed',
    accent2: '#ec4899',
    fg: '#ffffff',
    border: 'rgba(255,255,255,0.14)',
    radius: 1,
    tickerBg: 'rgba(0,0,0,0.65)',
    tickerFg: '#ffffff',
    cardBg: '#0b0b10',
  },
  {
    id: 'newsroom',
    name: 'Newsroom',
    group: 'News',
    bg: ['#0b1f3a', '#12335c'],
    pattern: 'lines-h',
    patternColor: 'rgba(255,255,255,0.045)',
    accent: '#d7263d',
    accent2: '#f4a261',
    fg: '#f4f7fb',
    border: 'rgba(255,255,255,0.18)',
    radius: 0.5,
    tickerBg: 'rgba(179,27,48,0.92)',
    tickerFg: '#ffffff',
    cardBg: '#08162b',
  },
  {
    id: 'broadsheet',
    name: 'Broadsheet',
    group: 'News',
    bg: ['#1c1c1e', '#2b2b2e'],
    pattern: 'lines-v',
    patternColor: 'rgba(232,223,200,0.06)',
    accent: '#e8dfc8',
    accent2: '#b8a98a',
    fg: '#f1ead7',
    border: 'rgba(232,223,200,0.28)',
    radius: 0.2,
    tickerBg: 'rgba(232,223,200,0.94)',
    tickerFg: '#1c1c1e',
    cardBg: '#141416',
  },
  {
    id: 'clinic',
    name: 'Clinic',
    group: 'Healthcare',
    bg: ['#eaf6f6', '#d3ecec'],
    pattern: 'dots',
    patternColor: 'rgba(15,157,154,0.10)',
    accent: '#0f9d9a',
    accent2: '#36c5c1',
    fg: '#0d3b3a',
    border: 'rgba(15,157,154,0.35)',
    radius: 1.4,
    tickerBg: 'rgba(15,157,154,0.95)',
    tickerFg: '#ffffff',
    cardBg: '#ffffff',
  },
  {
    id: 'wellness',
    name: 'Wellness',
    group: 'Healthcare',
    bg: ['#e8f5ee', '#dbeef7'],
    pattern: 'diagonal',
    patternColor: 'rgba(46,159,107,0.07)',
    accent: '#2e9f6b',
    accent2: '#4aa3d8',
    fg: '#17402d',
    border: 'rgba(46,159,107,0.35)',
    radius: 1.6,
    tickerBg: 'rgba(46,159,107,0.95)',
    tickerFg: '#ffffff',
    cardBg: '#ffffff',
  },
  {
    id: 'midnight-grid',
    name: 'Midnight Grid',
    group: 'Technology',
    bg: ['#0a0f1e', '#111a33'],
    pattern: 'grid',
    patternColor: 'rgba(34,211,238,0.07)',
    accent: '#22d3ee',
    accent2: '#6366f1',
    fg: '#e6f6fb',
    border: 'rgba(34,211,238,0.35)',
    radius: 0.7,
    tickerBg: 'rgba(10,15,30,0.9)',
    tickerFg: '#67e8f9',
    cardBg: '#070b16',
  },
  {
    id: 'circuit',
    name: 'Circuit',
    group: 'Technology',
    bg: ['#0d1117', '#161b22'],
    pattern: 'dots',
    patternColor: 'rgba(63,185,80,0.12)',
    accent: '#3fb950',
    accent2: '#58a6ff',
    fg: '#e6edf3',
    border: 'rgba(63,185,80,0.35)',
    radius: 0.6,
    tickerBg: 'rgba(13,17,23,0.92)',
    tickerFg: '#7ee787',
    cardBg: '#090c10',
  },
  {
    id: 'chalkboard',
    name: 'Chalkboard',
    group: 'Education',
    bg: ['#1f3d2f', '#2a4d3c'],
    pattern: 'ruled',
    patternColor: 'rgba(241,234,215,0.07)',
    accent: '#f4c95d',
    accent2: '#f1ead7',
    fg: '#f1ead7',
    border: 'rgba(241,234,215,0.32)',
    radius: 1.1,
    tickerBg: 'rgba(31,61,47,0.92)',
    tickerFg: '#f4e9c1',
    cardBg: '#17302a',
  },
  {
    id: 'campus',
    name: 'Campus',
    group: 'Education',
    bg: ['#fbf7ee', '#f1e9d8'],
    pattern: 'ruled',
    patternColor: 'rgba(59,76,202,0.09)',
    accent: '#3b4cca',
    accent2: '#e0a526',
    fg: '#1f2a68',
    border: 'rgba(59,76,202,0.3)',
    radius: 1.2,
    tickerBg: 'rgba(59,76,202,0.95)',
    tickerFg: '#ffffff',
    cardBg: '#ffffff',
  },
  {
    id: 'chambers',
    name: 'Chambers',
    group: 'Legal',
    bg: ['#2a1215', '#3b1c20'],
    pattern: 'diagonal',
    patternColor: 'rgba(201,162,75,0.06)',
    accent: '#c9a24b',
    accent2: '#e7cf8e',
    fg: '#f3e7c8',
    border: 'rgba(201,162,75,0.45)',
    radius: 0.3,
    tickerBg: 'rgba(42,18,21,0.94)',
    tickerFg: '#e7cf8e',
    cardBg: '#1d0c0f',
  },
  {
    id: 'counsel',
    name: 'Counsel',
    group: 'Legal',
    bg: ['#1b2430', '#2b3644'],
    pattern: 'pinstripe',
    patternColor: 'rgba(176,141,87,0.09)',
    accent: '#b08d57',
    accent2: '#d9c196',
    fg: '#eef1f5',
    border: 'rgba(176,141,87,0.42)',
    radius: 0.3,
    tickerBg: 'rgba(27,36,48,0.94)',
    tickerFg: '#d9c196',
    cardBg: '#131a23',
  },
];

export const DEFAULT_THEME_ID = 'vanilla';
export const THEME_BY_ID: Record<string, CanvasTheme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

export function getTheme(id: string | null | undefined): CanvasTheme {
  return (id && THEME_BY_ID[id]) || THEME_BY_ID[DEFAULT_THEME_ID];
}

// ---- Branding ranges -------------------------------------------------------

/** Slider ranges, in canvas pixels. The defaults are the studio's original values. */
export const BRANDING_RANGES = {
  logoSize: { min: 16, max: 600, default: 90 },
  nameFontSize: { min: 8, max: 120, default: 14 },
  newsFontSize: { min: 12, max: 120, default: 18 },
} as const;

/** Height of the news ticker bar for a font size: unchanged (36px) at the original 18px. */
export function newsBarHeight(fontSize: number): number {
  return Math.max(36, Math.round(fontSize * 1.9));
}
