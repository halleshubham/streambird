import type { BrandKit, PlatformConnection, PresetConfig, Resolution } from '../types/api';
import { PLATFORM_LABELS } from '../components/PlatformBadge';

/** Short quality names for summaries ("720p"); the long ones live in the studio's quality menu. */
export const QUALITY_SHORT: Record<Resolution, string> = { sd: '360p', hd: '720p', fhd: '1080p', qhd: '1440p' };
export const QUALITY_ORDER: Resolution[] = ['sd', 'hd', 'fhd', 'qhd'];
export const DEFAULT_QUALITY: Resolution = 'hd';

export const MAX_PRESET_NAME = 80;

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
export function optionsSummary(opts: { look: string; quality: Resolution; tickerOn: boolean; portrait?: boolean }): string {
  return [opts.look, QUALITY_SHORT[opts.quality], opts.tickerOn ? 'ticker on' : 'ticker off', ...(opts.portrait ? ['vertical'] : [])].join(' · ');
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
      quality: config.quality ?? DEFAULT_QUALITY,
      tickerOn: !!config.tickerEnabled && !!config.tickerText?.trim(),
      portrait: config.orientation === 'portrait',
    }),
  ].join(' · ');
}
