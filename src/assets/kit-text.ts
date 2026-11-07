import type { BrandKit } from './entities/brand-kit.entity';

/** What the text rule needs of a kit. */
export type KitTextSource = Pick<BrandKit, 'id' | 'name' | 'isDefault' | 'title' | 'description'>;

export interface KitTextPick {
  /** The default title / description to use (null: no kit supplies one). */
  title: string | null;
  description: string | null;
  /** The kit each came from, for "From brand kit X" (null when it came from nowhere). */
  titleKit: { id: string; name: string } | null;
  descriptionKit: { id: string; name: string } | null;
}

/**
 * The kit that answers for ONE destination, the same choice the thumbnail makes (BrandKitsService.thumbnailForConnection):
 * `override` first (a kit id; null = "no brand kit"), else the destination's own kit, else the account default kit.
 * An override that names a kit the account does not have gives none (it does not fall back to another kit).
 */
export function kitForDestination<K extends Pick<BrandKit, 'id' | 'isDefault'>>(
  kits: readonly K[],
  destinationKitId: string | null | undefined,
  override?: string | null,
): K | null {
  if (override === null) return null;
  if (override) return kits.find((k) => k.id === override) ?? null;
  return (destinationKitId ? kits.find((k) => k.id === destinationKitId) : undefined) ?? kits.find((k) => k.isDefault) ?? null;
}

const nonBlank = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

/**
 * The stream has ONE title and ONE description, so its defaults come from a single kit each: walk the destinations in
 * the order they were requested, resolve each one's kit (kitForDestination) and take the FIRST non-empty value. Title
 * and description are picked independently (the title may come from one kit and the description from another).
 * Blank values never count, and a kit without text does not stop the walk.
 */
export function pickKitText(
  kits: readonly KitTextSource[],
  destinationKitIds: ReadonlyArray<string | null | undefined>,
  override?: string | null,
): KitTextPick {
  const out: KitTextPick = { title: null, description: null, titleKit: null, descriptionKit: null };
  for (const kitId of destinationKitIds) {
    const kit = kitForDestination(kits, kitId, override);
    if (!kit) continue;
    const title = nonBlank(kit.title);
    const description = nonBlank(kit.description);
    if (out.title === null && title) {
      out.title = title;
      out.titleKit = { id: kit.id, name: kit.name };
    }
    if (out.description === null && description) {
      out.description = description;
      out.descriptionKit = { id: kit.id, name: kit.name };
    }
    if (out.title !== null && out.description !== null) break;
  }
  return out;
}
