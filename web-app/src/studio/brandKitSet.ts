import type { BrandKit, BrandKitAd } from '../types/api';
import type { BrandOrientation } from './brandSizes';

/**
 * Which materials of a brand kit a stream uses, by the stream's orientation (the rule the Android app repeats):
 *   landscape stream -> the landscape set: logoAssetId, wallpaperAssetId, ads.
 *   portrait stream  -> the portrait set: logoAssetIdPortrait, wallpaperAssetIdPortrait, adsPortrait.
 *     - logo: if the portrait set has none, the LANDSCAPE logo is used (a logo works on any canvas).
 *     - wallpaper and ads: NO fallback. A kit without a 9:16 wallpaper/ad gives a vertical stream no wallpaper/ad
 *       (a 16:9 picture would be cropped or letterboxed badly). The studio's own colour / theme shows instead.
 * Logo position, logo size, wallpaper dim, lower-third style and the "shrink picture" switch are shared by both sets.
 */
export interface KitSet {
  logoAssetId: string | null;
  wallpaperAssetId: string | null;
  ads: BrandKitAd[];
}

export function kitSetFor(kit: Pick<BrandKit, 'logoAssetId' | 'logoAssetIdPortrait' | 'wallpaperAssetId' | 'wallpaperAssetIdPortrait' | 'ads' | 'adsPortrait'>, orientation: BrandOrientation): KitSet {
  if (orientation === 'portrait') {
    return {
      logoAssetId: kit.logoAssetIdPortrait ?? kit.logoAssetId ?? null,
      wallpaperAssetId: kit.wallpaperAssetIdPortrait ?? null,
      ads: kit.adsPortrait ?? [],
    };
  }
  return { logoAssetId: kit.logoAssetId ?? null, wallpaperAssetId: kit.wallpaperAssetId ?? null, ads: kit.ads ?? [] };
}
