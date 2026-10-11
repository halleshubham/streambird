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

export type LayoutGroup = 'Classic' | 'Podcast' | 'Podcast + slides' | 'Anchor + slides' | 'Panel + slides' | 'Panel: 4 to 8' | 'Panel + slides: 4 to 8';

export interface LayoutDef {
  id: string;
  name: string;
  group: LayoutGroup;
  /** How many people tiles the layout has. Anyone beyond that stays in the audio mix but isn't drawn. */
  maxPeople: number;
  /**
   * Set on layouts designed for a range of people (4 to 8): their tiles are re-arranged for however many are
   * on stage right now (computeLayout's `count`), between 1 and maxPeople, so there are never empty holes.
   */
  minPeople?: number;
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

  // Designed for 4 to 8 people on stage (host + 3 to 7 guests). The arrangement adapts to who is there.
  { id: 'panel-gallery', name: 'Panel: gallery', group: 'Panel: 4 to 8', maxPeople: 8, minPeople: 4, hasSlide: false, description: 'Everyone in the same size, rows centred, sized to fill the frame. Adapts as people join or leave.' },
  { id: 'panel-featured', name: 'Panel: featured speaker', group: 'Panel: 4 to 8', maxPeople: 8, minPeople: 4, hasSlide: false, description: 'One large speaker (you, or whoever you pin) with everyone else beside them.' },
  { id: 'panel-stage', name: 'Panel: host on top, guests below', group: 'Panel: 4 to 8', maxPeople: 8, minPeople: 4, hasSlide: false, description: 'The host across the top, the guests in one or two rows beneath.' },

  { id: 'panel-slide-side', name: 'Panel + slides: slide left, guests right', group: 'Panel + slides: 4 to 8', maxPeople: 8, minPeople: 4, hasSlide: true, description: 'A large slide on the left, up to eight people in two columns on the right.' },
  { id: 'panel-slide-strip', name: 'Panel + slides: slide on top, guests below', group: 'Panel + slides: 4 to 8', maxPeople: 8, minPeople: 4, hasSlide: true, description: 'The slide across the top, up to eight people in one or two rows below.' },
  { id: 'panel-slide-centre', name: 'Panel + slides: slide in the middle', group: 'Panel + slides: 4 to 8', maxPeople: 8, minPeople: 4, hasSlide: true, description: 'The slide in the centre with the panel split into a column on each side.' },
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

/**
 * Where the slide area and the people tiles go for a layout on a w x h canvas. 'grid'/'spotlight' have no fixed
 * geometry. `count` is how many people are on stage: only the 4-to-8 panel layouts use it (they re-arrange for it,
 * 1 to 8, default 8); every other layout has a fixed number of tiles.
 */
export function computeLayout(id: LayoutId, w: number, h: number, count?: number): LayoutGeometry {
  const def = LAYOUT_BY_ID[id];
  if (def?.minPeople !== undefined) {
    const n = Math.max(1, Math.min(def.maxPeople, Math.round(count ?? def.maxPeople)));
    return h > w ? computePortraitPanel(id, w, h, n) : computeLandscapePanel(id, w, h, n);
  }
  if (h > w) return computePortraitLayout(id, w, h);
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
      // The inset sits one gutter inside the large tile's bottom-right corner.
      return { slide: null, people: [r(m, m, w - 2 * m, h - 2 * m), r(w - 2 * m - pw, h - 2 * m - ph, pw, ph)] };
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
      const slide = fit16x9(r(m, m, w - 2 * m, h - 2 * m));
      // Insets sit one gutter inside the slide's bottom-right corner, not the frame's.
      const right = slide.x + slide.w - m;
      const y = slide.y + slide.h - m - ph;
      return { slide, people: [r(right - 2 * pw - m, y, pw, ph), r(right - pw, y, pw, ph)] };
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
      const slide = fit16x9(r(m, m, w - 2 * m, h - 2 * m));
      return { slide, people: [r(slide.x + slide.w - m - pw, slide.y + slide.h - m - ph, pw, ph)] };
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


// ---- The 4-to-8 panel layouts --------------------------------------------

/** Splits n tiles into rows of at most `maxPerRow`, as evenly as possible, bigger rows first (7 in fours: 4+3). */
export function balancedRows(n: number, maxPerRow: number): number[] {
  const rows = Math.ceil(n / maxPerRow);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Tiles in rows of the given sizes inside a region: every tile the same size, each row centred, the whole block
 * centred. With a `ratio` (width / height) the tiles keep that shape and are as big as fit; without one they
 * fill their cells.
 */
function tileRows(region: Rect, counts: number[], gap: number, ratio: number | null): Rect[] {
  const cols = Math.max(...counts);
  const cellW = (region.w - (cols - 1) * gap) / cols;
  const cellH = (region.h - (counts.length - 1) * gap) / counts.length;
  const tw = ratio ? Math.min(cellW, cellH * ratio) : cellW;
  const th = ratio ? tw / ratio : cellH;
  const blockH = counts.length * th + (counts.length - 1) * gap;
  const y0 = region.y + (region.h - blockH) / 2;
  const out: Rect[] = [];
  counts.forEach((c, row) => {
    const rowW = c * tw + (c - 1) * gap;
    const x0 = region.x + (region.w - rowW) / 2;
    for (let i = 0; i < c; i++) out.push(r(x0 + i * (tw + gap), y0 + row * (th + gap), tw, th));
  });
  return out;
}

/** A column of `count` equal tiles filling the region's height. */
const column = (region: Rect, count: number, gap: number): Rect[] => (count === 0 ? [] : tileRows(region, Array(count).fill(1), gap, null));

function computeLandscapePanel(id: LayoutId, w: number, h: number, n: number): LayoutGeometry {
  const m = gutterFor(w, h);
  const inner = r(m, m, w - 2 * m, h - 2 * m);
  switch (id) {
    case 'panel-gallery': {
      // Pick the row count that gives the biggest 16:9 tiles for this frame shape.
      let best: Rect[] = [];
      let bestW = -1;
      for (let perRow = 1; perRow <= n; perRow++) {
        const tiles = tileRows(inner, balancedRows(n, perRow), m, 16 / 9);
        if (tiles[0].w > bestW + 0.5) {
          best = tiles;
          bestW = tiles[0].w;
        }
      }
      return { slide: null, people: best };
    }
    case 'panel-featured': {
      if (n === 1) return { slide: null, people: [inner] };
      const others = n - 1;
      const featW = (inner.w - m) * (others <= 3 ? 0.62 : 0.56);
      const rest = r(inner.x + featW + m, inner.y, inner.w - featW - m, inner.h);
      const cols = others <= 3 ? 1 : 2;
      return { slide: null, people: [r(inner.x, inner.y, featW, inner.h), ...tileRows(rest, balancedRows(others, cols), m, null)] };
    }
    case 'panel-stage': {
      if (n === 1) return { slide: null, people: [fit16x9(inner)] };
      const others = n - 1;
      const rows = balancedRows(others, others <= 4 ? 4 : 4);
      const hostH = (inner.h - m) * (rows.length === 1 ? 0.56 : 0.5);
      const host = fit16x9(r(inner.x, inner.y, inner.w, hostH));
      const below = r(inner.x, inner.y + hostH + m, inner.w, inner.h - hostH - m);
      return { slide: null, people: [r(host.x, inner.y + (hostH - host.h) / 2, host.w, host.h), ...tileRows(below, rows, m, 16 / 9)] };
    }
    case 'panel-slide-side': {
      const leftW = (inner.w - m) * 0.56;
      const slide = fit16x9(r(inner.x, inner.y, leftW, inner.h));
      const right = r(inner.x + leftW + m, inner.y, inner.w - leftW - m, inner.h);
      return { slide, people: tileRows(right, balancedRows(n, 2), m, null) };
    }
    case 'panel-slide-strip': {
      const topH = (inner.h - m) * (n <= 4 ? 0.58 : 0.5);
      const slide = fit16x9(r(inner.x, inner.y, inner.w, topH));
      const below = r(inner.x, inner.y + topH + m, inner.w, inner.h - topH - m);
      const counts = n <= 5 ? [n] : balancedRows(n, 4);
      return { slide: r(slide.x, inner.y + (topH - slide.h) / 2, slide.w, slide.h), people: tileRows(below, counts, m, 4 / 3) };
    }
    case 'panel-slide-centre': {
      const left = Math.ceil(n / 2);
      const slideW = (inner.w - 2 * m) * 0.5;
      const colW = (inner.w - 2 * m - slideW) / 2;
      const slide = fit16x9(r(inner.x + colW + m, inner.y, slideW, inner.h));
      return {
        slide,
        people: [...column(r(inner.x, inner.y, colW, inner.h), left, m), ...column(r(inner.x + colW + m + slideW + m, inner.y, colW, inner.h), n - left, m)],
      };
    }
    default:
      return { slide: null, people: [] };
  }
}

/** The 4-to-8 panels on a vertical (9:16) canvas: everything stacks. */
function computePortraitPanel(id: LayoutId, w: number, h: number, n: number): LayoutGeometry {
  const m = gutterFor(w, h);
  const inner = r(m, m, w - 2 * m, h - 2 * m);
  const twoCols = (region: Rect, count: number) => tileRows(region, balancedRows(count, 2), m, null);
  switch (id) {
    case 'panel-gallery':
      return { slide: null, people: tileRows(inner, balancedRows(n, n <= 1 ? 1 : 2), m, null) };
    case 'panel-featured': {
      if (n === 1) return { slide: null, people: [inner] };
      const featH = (inner.h - m) * 0.4;
      return { slide: null, people: [r(inner.x, inner.y, inner.w, featH), ...twoCols(r(inner.x, inner.y + featH + m, inner.w, inner.h - featH - m), n - 1)] };
    }
    case 'panel-stage': {
      if (n === 1) return { slide: null, people: [inner] };
      const host = band(w, m, m, (h - 3 * m) * 0.3);
      const below = r(inner.x, host.y + host.h + m, inner.w, h - m - (host.y + host.h + m));
      return { slide: null, people: [host, ...twoCols(below, n - 1)] };
    }
    case 'panel-slide-side': {
      const slide = band(w, m, m, (h - 3 * m) * 0.28);
      return { slide, people: twoCols(r(inner.x, slide.y + slide.h + m, inner.w, h - m - (slide.y + slide.h + m)), n) };
    }
    case 'panel-slide-strip': {
      // the slide at the bottom, the people above it
      const b = band(w, m, 0, (h - 3 * m) * 0.28);
      const slide = r(b.x, h - m - b.h, b.w, b.h);
      return { slide, people: twoCols(r(inner.x, inner.y, inner.w, h - 3 * m - b.h), n) };
    }
    case 'panel-slide-centre': {
      // some of the people above the slide, the rest below it
      const top = Math.ceil(n / 2);
      const bottom = n - top;
      const slideH = (h - 3 * m) * 0.26;
      const b = band(w, m, 0, slideH);
      const rowsTop = Math.ceil(top / 2);
      const rowsBottom = Math.ceil(bottom / 2);
      const regionH = h - 2 * m - 2 * m - b.h; // minus the two gaps around the slide
      const topH = bottom === 0 ? regionH : (regionH * rowsTop) / (rowsTop + rowsBottom);
      const topRegion = r(inner.x, inner.y, inner.w, topH);
      const slide = r(b.x, inner.y + topH + m, b.w, b.h);
      const bottomRegion = r(inner.x, slide.y + slide.h + m, inner.w, h - m - (slide.y + slide.h + m));
      return { slide, people: [...twoCols(topRegion, top), ...twoCols(bottomRegion, bottom)] };
    }
    default:
      return { slide: null, people: [] };
  }
}

/** A 16:9 band across the full width at the given y, no taller than maxH. */
function band(w: number, m: number, y: number, maxH: number): Rect {
  const width = Math.min(w - 2 * m, (maxH * 16) / 9);
  const height = (width * 9) / 16;
  return r(m + (w - 2 * m - width) / 2, y, width, height);
}

/**
 * The same layouts for a vertical (9:16) canvas. Tiles stack and the slide becomes a 16:9
 * band across the top (or bottom), because a side-by-side arrangement would leave
 * everything tiny in a narrow frame.
 */
function computePortraitLayout(id: LayoutId, w: number, h: number): LayoutGeometry {
  const m = gutterFor(w, h);
  const full = w - 2 * m;
  switch (id) {
    case 'podcast-split': {
      const th = (h - 3 * m) / 2;
      return { slide: null, people: [r(m, m, full, th), r(m, 2 * m + th, full, th)] };
    }
    case 'podcast-center': {
      const tw = w * 0.84;
      const th = (tw * 3) / 4;
      const gap = 2 * m;
      const y0 = (h - (2 * th + gap)) / 2;
      const x = (w - tw) / 2;
      return { slide: null, people: [r(x, y0, tw, th), r(x, y0 + th + gap, tw, th)] };
    }
    case 'podcast-pip': {
      const pw = w * 0.36;
      const ph = (pw * 4) / 3;
      return { slide: null, people: [r(m, m, full, h - 2 * m), r(w - 2 * m - pw, h - 2 * m - ph, pw, ph)] };
    }
    case 'pod-slide-left': {
      // slide on top, host above guest
      const slide = band(w, m, m, (h - 3 * m) * 0.32);
      const y0 = slide.y + slide.h + m;
      const th = (h - m - y0 - m) / 2;
      return { slide, people: [r(m, y0, full, th), r(m, y0 + th + m, full, th)] };
    }
    case 'pod-slide-top': {
      // slide on top, host and guest side by side
      const slide = band(w, m, m, (h - 3 * m) * 0.32);
      const y0 = slide.y + slide.h + m;
      const tw = (w - 3 * m) / 2;
      const th = Math.min(h - m - y0, (tw * 4) / 3);
      return { slide, people: [r(m, y0, tw, th), r(2 * m + tw, y0, tw, th)] };
    }
    case 'pod-slide-pip': {
      const pw = w * 0.36;
      const ph = (pw * 4) / 3;
      const y = h - 2 * m - ph;
      return { slide: r(m, m, full, h - 2 * m), people: [r(w - 2 * m - 2 * pw - m, y, pw, ph), r(w - 2 * m - pw, y, pw, ph)] };
    }
    case 'anchor-slide-right': {
      // anchor on top, slide below
      const b = band(w, m, 0, (h - 3 * m) * 0.4);
      const slide = r(b.x, h - m - b.h, b.w, b.h);
      return { slide, people: [r(m, m, full, h - 3 * m - b.h)] };
    }
    case 'anchor-slide-left': {
      // slide on top, anchor below
      const slide = band(w, m, m, (h - 3 * m) * 0.4);
      const y0 = slide.y + slide.h + m;
      return { slide, people: [r(m, y0, full, h - m - y0)] };
    }
    case 'anchor-pip': {
      const pw = w * 0.4;
      const ph = (pw * 4) / 3;
      return { slide: r(m, m, full, h - 2 * m), people: [r(w - 2 * m - pw, h - 2 * m - ph, pw, ph)] };
    }
    case 'panel-slide-left': {
      // slide on top, a 2x2 block below
      const slide = band(w, m, m, (h - 3 * m) * 0.32);
      const y0 = slide.y + slide.h + m;
      const tw = (w - 3 * m) / 2;
      const th = (h - m - y0 - m) / 2;
      return {
        slide,
        people: [r(m, y0, tw, th), r(2 * m + tw, y0, tw, th), r(m, y0 + th + m, tw, th), r(2 * m + tw, y0 + th + m, tw, th)],
      };
    }
    case 'panel-slide-top': {
      // slide on top, the host large, three guests in a row beneath
      const slide = band(w, m, m, (h - 3 * m) * 0.32);
      const y0 = slide.y + slide.h + m;
      const rem = h - m - y0;
      const hostH = rem * 0.55;
      const rowY = y0 + hostH + m;
      const tw = (w - 4 * m) / 3;
      return {
        slide,
        people: [r(m, y0, full, hostH), r(m, rowY, tw, h - m - rowY), r(2 * m + tw, rowY, tw, h - m - rowY), r(3 * m + 2 * tw, rowY, tw, h - m - rowY)],
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
  // The screen share goes last so a guest who joins after it started still gets a tile (and never the large one).
  const rest = [...entries.filter((e) => e.id !== HOST_ID && e.id !== SCREEN_SHARE_ID), ...entries.filter((e) => e.id === SCREEN_SHARE_ID)];
  const ordered = host ? [host, ...rest] : rest;
  if (layout === 'panel-featured' && ordered.length > 1) {
    // The featured speaker is whoever is pinned, else the host.
    const main = ordered.find((e) => e.id === pinnedId) ?? ordered[0];
    return [main, ...ordered.filter((e) => e !== main)];
  }
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

// ---- Orientation -----------------------------------------------------------

export type StreamOrientation = 'landscape' | 'portrait';

/** The canvas size for a quality (given in landscape terms) in the stream's orientation: portrait swaps width and height. */
export function canvasSizeFor(size: { width: number; height: number }, orientation: StreamOrientation | null | undefined): { width: number; height: number } {
  return orientation === 'portrait' ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/** '16:9', '9:16', or the raw ratio for anything else. */
export function aspectLabel(w: number, h: number): string {
  const a = w / h;
  if (Math.abs(a - 16 / 9) < 0.01) return '16:9';
  if (Math.abs(a - 9 / 16) < 0.01) return '9:16';
  return `${w}:${h}`;
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

// ---- Wallpaper -------------------------------------------------------------

export const WALLPAPER_RANGES = {
  /** Which part of the image stays when it has to be cropped: 0 = left/top edge, 50 = centre, 100 = right/bottom edge. */
  focus: { min: 0, max: 100, default: 50 },
  /** Darkening laid over the wallpaper so tiles and text stay readable (percent). */
  dim: { min: 0, max: 70, default: 0 },
} as const;

/** Wallpapers are stored no larger than this on the long side (the biggest canvas is 1920x1080). */
export const WALLPAPER_MAX_SIDE = 1920;

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The part of a src image that fills a dst canvas with "cover" scaling: the whole canvas is
 * covered and whatever overflows is cropped. focusX/focusY (0-100) choose which part stays.
 */
export function coverCrop(srcW: number, srcH: number, dstW: number, dstH: number, focusX = 50, focusY = 50): CropRect {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = Math.min(srcW, dstW / scale);
  const sh = Math.min(srcH, dstH / scale);
  const fx = Math.min(100, Math.max(0, focusX)) / 100;
  const fy = Math.min(100, Math.max(0, focusY)) / 100;
  return { sx: (srcW - sw) * fx, sy: (srcH - sh) * fy, sw, sh };
}

export interface WallpaperFit {
  /** Exactly the canvas size: nothing is scaled or cropped. */
  exact: boolean;
  /** Which edges are trimmed to fill the canvas. */
  crop: 'none' | 'sides' | 'top-bottom';
  /** Share of the image that stays visible (1 = all of it). */
  kept: number;
  /** The image is smaller than the canvas, so it is enlarged and may look soft. */
  upscaled: boolean;
  /** One plain sentence for the host. */
  message: string;
}

/** What will happen to an srcW x srcH image on a dstW x dstH canvas, in words the host can act on. */
export function describeWallpaperFit(srcW: number, srcH: number, dstW: number, dstH: number): WallpaperFit {
  const ideal = `${dstW}x${dstH}`;
  if (srcW === dstW && srcH === dstH) {
    return { exact: true, crop: 'none', kept: 1, upscaled: false, message: `Perfect fit: ${srcW}x${srcH}. Nothing is scaled or cropped.` };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  const upscaled = srcW < dstW || srcH < dstH;
  const soft = upscaled ? ` It is smaller than ${ideal}, so it is enlarged and may look soft.` : '';
  if (Math.abs(srcAspect - dstAspect) < 0.005) {
    return {
      exact: false,
      crop: 'none',
      kept: 1,
      upscaled,
      message: `Right shape (${aspectLabel(dstW, dstH)}) at ${srcW}x${srcH}; it is scaled to ${ideal}. Nothing is cropped.${soft}`,
    };
  }
  if (srcAspect > dstAspect) {
    const kept = dstAspect / srcAspect;
    return {
      exact: false,
      crop: 'sides',
      kept,
      upscaled,
      message: `${srcW}x${srcH} is wider than the frame, so the left and right are cropped (${Math.round(kept * 100)}% of the width stays). Use the position slider to choose what stays, or provide ${ideal}.${soft}`,
    };
  }
  const kept = srcAspect / dstAspect;
  return {
    exact: false,
    crop: 'top-bottom',
    kept,
    upscaled,
    message: `${srcW}x${srcH} is taller than the frame, so the top and bottom are cropped (${Math.round(kept * 100)}% of the height stays). Use the position slider to choose what stays, or provide ${ideal}.${soft}`,
  };
}
