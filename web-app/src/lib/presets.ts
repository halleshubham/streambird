import type { BrandKit, PlatformConnection, PresetConfig, Resolution, StreamVisibility } from '../types/api';
import { PLATFORM_LABELS } from '../components/PlatformBadge';

/** Short quality names for summaries ("720p"); the long ones live in the studio's quality menu. */
export const QUALITY_SHORT: Record<Resolution, string> = { sd: '360p', hd: '720p', fhd: '1080p', qhd: '1440p' };
export const QUALITY_ORDER: Resolution[] = ['sd', 'hd', 'fhd', 'qhd'];
export const DEFAULT_QUALITY: Resolution = 'hd';

export const MAX_PRESET_NAME = 80;

/** What a preset (or the default card) without a saved choice does on YouTube: the server creates the broadcast unlisted. */
export const DEFAULT_PRESET_VISIBILITY: StreamVisibility = 'unlisted';
export const VISIBILITY_LABEL: Record<StreamVisibility, string> = { public: 'Public', unlisted: 'Unlisted', private: 'Private' };
/** Same wording as the New stream form's Visibility field. */
export const VISIBILITY_HINT = 'Only platforms that support visibility (e.g. YouTube) use this -- others ignore it.';

/** The brand part of a summary: the chosen kit's name, "No brand kit", or the account's default kit (else "Default look"). */
export function lookLabel(brandKitId: string | null | undefined, kits: BrandKit[]): string {
  if (brandKitId === null) return 'No brand kit';
  const kit = brandKitId ? kits.find((k) => k.id === brandKitId) : kits.find((k) => k.isDefault);
  return kit ? `${kit.name} brand` : 'Default look';
}

/**
 * "Acme brand · 720p · ticker off" -- the one-line summary of the look and quality choices, used by the setup form's
 * "More options" and (with the destinations in front) by the preset cards.
 */
export function optionsSummary(opts: { look: string; quality: Resolution; tickerOn: boolean; portrait?: boolean; visibility?: StreamVisibility }): string {
  return [opts.look, ...(opts.visibility ? [VISIBILITY_LABEL[opts.visibility]] : []), QUALITY_SHORT[opts.quality], opts.tickerOn ? 'ticker on' : 'ticker off', ...(opts.portrait ? ['vertical'] : [])].join(' · ');
}

/** Names the destinations the way the cards show them: platform names, de-duplicated ("YouTube, Twitch"). */
export function destinationNames(ids: string[] | undefined, connections: PlatformConnection[]): string {
  const chosen = ids && ids.length > 0 ? connections.filter((c) => ids.includes(c.id)) : connections;
  if (chosen.length === 0) return 'No destinations';
  const names = [...new Set(chosen.map((c) => PLATFORM_LABELS[c.platform] ?? c.platform))];
  return names.join(', ');
}

/** The platform names behind `destinationNames`, as a list (for chips). */
export function destinationList(ids: string[] | undefined, connections: PlatformConnection[]): string[] {
  const chosen = ids && ids.length > 0 ? connections.filter((c) => ids.includes(c.id)) : connections;
  return [...new Set(chosen.map((c) => PLATFORM_LABELS[c.platform] ?? c.platform))];
}

/** The look/quality/ticker line of a preset card, without the destinations ("Acme brand · 720p · ticker off"). */
export function presetOptionsLine(config: PresetConfig, kits: BrandKit[]): string {
  return optionsSummary({
    look: lookLabel(config.brandKitId, kits),
    visibility: config.visibility ?? DEFAULT_PRESET_VISIBILITY,
    quality: config.quality ?? DEFAULT_QUALITY,
    tickerOn: !!config.tickerEnabled && !!config.tickerText?.trim(),
    portrait: config.orientation === 'portrait',
  });
}

export function presetSummary(config: PresetConfig, connections: PlatformConnection[], kits: BrandKit[]): string {
  return [
    destinationNames(config.destinationIds, connections),
    optionsSummary({
      look: lookLabel(config.brandKitId, kits),
      visibility: config.visibility ?? DEFAULT_PRESET_VISIBILITY,
      quality: config.quality ?? DEFAULT_QUALITY,
      tickerOn: !!config.tickerEnabled && !!config.tickerText?.trim(),
      portrait: config.orientation === 'portrait',
    }),
  ].join(' · ');
}
