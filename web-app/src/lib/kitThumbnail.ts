import type { BrandKit } from '../types/api';

/**
 * Which brand kit's thumbnail a stream destination gets when the stream has no thumbnail of its own. The same rule the
 * server applies (src/assets/brand-kits.service.ts `thumbnailForConnection`) and the Android app repeats:
 *   an explicit choice (a kit, or "none") first; else the kit the channel/Page is assigned to; else the account default
 *   kit. A kit without a thumbnail gives none: it does not fall through to another kit.
 * `choice`: undefined = automatic, null = no kit, a kit id = that kit.
 */
export function kitFor(connectionId: string, kits: readonly BrandKit[], choice?: string | null): BrandKit | null {
  if (choice === null) return null;
  if (choice) return kits.find((k) => k.id === choice) ?? null;
  return kits.find((k) => k.connectionIds.includes(connectionId)) ?? kits.find((k) => k.isDefault) ?? null;
}

export interface KitThumbnailSource {
  connectionId: string;
  kit: BrandKit;
}

/** The destinations that will get a kit thumbnail, with the kit each takes it from. Destinations with none are left out. */
export function kitThumbnailSources(connectionIds: readonly string[], kits: readonly BrandKit[], choice?: string | null): KitThumbnailSource[] {
  const out: KitThumbnailSource[] = [];
  for (const connectionId of connectionIds) {
    const kit = kitFor(connectionId, kits, choice);
    if (kit?.thumbnailAssetId) out.push({ connectionId, kit });
  }
  return out;
}

/** The distinct kits behind a list of sources, in first-seen order. */
export function distinctKits(sources: readonly KitThumbnailSource[]): BrandKit[] {
  const seen = new Set<string>();
  const kits: BrandKit[] = [];
  for (const s of sources) {
    if (!seen.has(s.kit.id)) {
      seen.add(s.kit.id);
      kits.push(s.kit);
    }
  }
  return kits;
}

/** "From brand kit Acme" / "From brand kits Acme and Hindi (each destination uses its own)". */
export function describeKitThumbnail(sources: readonly KitThumbnailSource[]): string | null {
  const kits = distinctKits(sources);
  if (kits.length === 0) return null;
  if (kits.length === 1) return `From brand kit ${kits[0].name}`;
  const names = kits.map((k) => k.name);
  return `From brand kits ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} (each destination uses its own)`;
}
