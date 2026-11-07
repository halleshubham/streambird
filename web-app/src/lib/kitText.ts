import type { BrandKit } from '../types/api';
import { kitFor } from './kitThumbnail';

export interface KitText {
  title: string | null;
  description: string | null;
  titleKit: BrandKit | null;
  descriptionKit: BrandKit | null;
}

const nonBlank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/**
 * The default title / description a new stream would take from its brand kit. The same rule the server applies when the
 * request leaves them blank (src/assets/kit-text.ts `pickKitText`): walk the destinations in the order they were picked,
 * resolve each one's kit like the thumbnail does (`choice`: undefined = automatic, null = no kit, a kit id; else the
 * channel's kit, else the account default) and take the FIRST non-empty value, title and description independently.
 */
export function kitDefaultText(connectionIds: readonly string[], kits: readonly BrandKit[], choice?: string | null): KitText {
  const out: KitText = { title: null, description: null, titleKit: null, descriptionKit: null };
  for (const id of connectionIds) {
    const kit = kitFor(id, kits, choice);
    if (!kit) continue;
    const title = nonBlank(kit.title);
    const description = nonBlank(kit.description);
    if (out.title === null && title) Object.assign(out, { title, titleKit: kit });
    if (out.description === null && description) Object.assign(out, { description, descriptionKit: kit });
    if (out.title !== null && out.description !== null) break;
  }
  return out;
}
