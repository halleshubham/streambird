/**
 * Suggested picture sizes and limits for every brand-kit slot, in ONE place (pure data + two tiny helpers, no DOM).
 * The Brand page, the studio Ads tab and (later) the Android app show the same numbers.
 *
 * Derived from the real canvas geometry in ads.ts (`adRect`), with the canvas the stream really uses:
 *   landscape 16:9 -> 1920 x 1080,   portrait 9:16 -> 1080 x 1920
 *   lower_third  area = full width x round(H / 3)      -> landscape 1920 x 360 (16:3),  portrait 1080 x 640
 *   side_third   area = round(W / 3) x full height     -> landscape  640 x 1080 (a tall slice), portrait 360 x 1920
 *   full_screen  area = the whole frame
 * A suggested size is what we recommend you export; any size with the same shape works (pictures are scaled to fit,
 * never cropped, except wallpapers, which fill the frame and are cropped around the focus point).
 */

/** Same words as the stream's orientation (LiveStream.orientation) and the API (`portrait` = 9:16). */
export type BrandOrientation = 'landscape' | 'portrait';
export const BRAND_ORIENTATIONS: readonly BrandOrientation[] = ['landscape', 'portrait'];
export const BRAND_ORIENTATION_LABEL: Record<BrandOrientation, string> = { landscape: '16:9', portrait: '9:16' };

export type BrandSlot = 'logo' | 'wallpaper' | 'lower_third' | 'side_third' | 'full_screen';
export const BRAND_SLOTS: readonly BrandSlot[] = ['logo', 'wallpaper', 'lower_third', 'side_third', 'full_screen'];

/** The canvas the studio draws at its best quality (1080p), per orientation. */
export const CANVAS_SIZE: Record<BrandOrientation, { w: number; h: number }> = { landscape: { w: 1920, h: 1080 }, portrait: { w: 1080, h: 1920 } };

/** File limits the server enforces for every library file (src/assets/image.util.ts). */
export const BRAND_FILE_LIMITS = {
  maxBytes: 4 * 1024 * 1024,
  maxSide: 8192,
  /** GIF (animated) is accepted for logos and ads only. */
  gifSlots: ['logo', 'lower_third', 'side_third', 'full_screen'] as readonly BrandSlot[],
} as const;

/** A picture whose shape is off by more than this factor from the suggestion gets a (non-blocking) warning. */
export const ASPECT_TOLERANCE = 1.5;

export interface SlotSpec {
  /** Short name for the slot. */
  label: string;
  /** Recommended pixel size to export (width x height). */
  size: { w: number; h: number };
  /** Allowed shape range (width / height) before the "different shape" warning appears. */
  ratioMin: number;
  ratioMax: number;
  /** One-sentence advice shown next to the slot. */
  hint: string;
}

const around = (w: number, h: number) => ({ ratioMin: w / h / ASPECT_TOLERANCE, ratioMax: (w / h) * ASPECT_TOLERANCE });

const LOGO: SlotSpec = {
  label: 'Logo',
  size: { w: 512, h: 512 },
  ratioMin: 0.4,
  ratioMax: 5,
  hint: 'Square or wide PNG with a transparent background, about 512 x 512 (up to 1024 px).',
};

export const SLOT_SPECS: Record<BrandOrientation, Record<BrandSlot, SlotSpec>> = {
  landscape: {
    logo: LOGO,
    wallpaper: { label: 'Wallpaper', size: { w: 1920, h: 1080 }, ...around(1920, 1080), hint: '16:9, 1920 x 1080. It fills the frame behind everyone.' },
    lower_third: { label: 'Lower third', size: { w: 1280, h: 240 }, ...around(1280, 240), hint: 'Wide banner, about 16:3 (1280 x 240). It sits in the bottom third of the picture.' },
    side_third: { label: 'Left third', size: { w: 640, h: 1080 }, ...around(640, 1080), hint: 'Tall slice, 640 x 1080. It fills the left third, full height.' },
    full_screen: { label: 'Full screen', size: { w: 1920, h: 1080 }, ...around(1920, 1080), hint: '16:9, 1920 x 1080. It covers the whole picture while it shows.' },
  },
  portrait: {
    logo: LOGO,
    wallpaper: { label: 'Wallpaper', size: { w: 1080, h: 1920 }, ...around(1080, 1920), hint: '9:16, 1080 x 1920. It fills the frame behind everyone.' },
    lower_third: { label: 'Lower third', size: { w: 1080, h: 360 }, ...around(1080, 360), hint: 'Banner about 3:1 (1080 x 360, at most 1080 x 640). It sits at the bottom of the tall picture.' },
    side_third: { label: 'Left third', size: { w: 360, h: 1920 }, ...around(360, 1920), hint: 'Narrow tall strip, 360 x 1920. It fills the left third, full height.' },
    full_screen: { label: 'Full screen', size: { w: 1080, h: 1920 }, ...around(1080, 1920), hint: '9:16, 1080 x 1920. It covers the whole picture while it shows.' },
  },
};

/** "1280 x 240" */
export function sizeText(spec: SlotSpec): string {
  return `${spec.size.w} x ${spec.size.h}`;
}

/** True when a picture's shape is far from what the slot suggests (a warning, never an error). */
export function aspectMismatch(width: number, height: number, spec: SlotSpec): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const r = width / height;
  return r < spec.ratioMin || r > spec.ratioMax;
}

/** The helper line for a slot: shape advice plus the file limits. */
export function slotHelp(orientation: BrandOrientation, slot: BrandSlot): string {
  const spec = SLOT_SPECS[orientation][slot];
  const gif = BRAND_FILE_LIMITS.gifSlots.includes(slot) ? 'PNG, JPG, WebP or GIF' : 'PNG, JPG or WebP';
  return `${spec.hint} ${gif}, up to ${BRAND_FILE_LIMITS.maxBytes / 1024 / 1024} MB.`;
}
