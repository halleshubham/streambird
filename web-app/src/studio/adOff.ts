// Pure helpers for "this ad is switched off" warnings (studio Ads tab, studio status, brand kit editor).
// A configured ad whose "On" checkbox is unticked draws nothing, which hosts used to miss. No React, no DOM.
import { AD_PLACEMENTS, AD_PLACEMENT_LABEL, type AdPlacement } from './ads';

/** How many ad names the status line lists before it says "and N more". */
export const MAX_NAMED_OFF_ADS = 3;

/** The inline warning on one ad card / kit slot: "L-shaped frame is switched off: tick On to use it". */
export function adOffWarning(placement: AdPlacement): string {
  return `${AD_PLACEMENT_LABEL[placement]} is switched off: tick On to use it`;
}

/** Placements that have a picture but are switched off, in the fixed placement order. */
export function offAdPlacements(ads: Partial<Record<AdPlacement, { hasMedia: boolean; enabled: boolean } | null | undefined>>): AdPlacement[] {
  return AD_PLACEMENTS.filter((p) => {
    const a = ads[p];
    return !!a && a.hasMedia && !a.enabled;
  });
}

/** Studio status line for the ads that are switched off (null when none). Lists at most three names. */
export function adsOffStatus(off: readonly AdPlacement[]): string | null {
  if (off.length === 0) return null;
  const shown = off.slice(0, MAX_NAMED_OFF_ADS).map((p) => AD_PLACEMENT_LABEL[p]);
  const more = off.length - shown.length;
  if (off.length === 1) return `The ${shown[0]} ad is switched off: open Ads and tick On to use it.`;
  const list = `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return `The ${list} ads${more > 0 ? ` (and ${more} more)` : ''} are switched off: open Ads and tick On to use them.`;
}

export interface AdOverrideDiff {
  placement: AdPlacement;
  /** What this stream remembers. */
  remembered: boolean;
  /** What the kit says now. */
  kit: boolean;
}

/** Kit-sourced ads where the stream's remembered On/Off differs from the applied kit's current value. */
export function adOverrideDiffs(
  remembered: Partial<Record<AdPlacement, { enabled?: boolean; source?: string } | null | undefined>>,
  kitAds: readonly { placement: string; enabled: boolean }[],
): AdOverrideDiff[] {
  const out: AdOverrideDiff[] = [];
  for (const p of AD_PLACEMENTS) {
    const r = remembered[p];
    const k = kitAds.find((a) => a.placement === p);
    if (!r || r.source !== 'kit' || !k) continue;
    const rem = r.enabled !== false;
    if (rem !== k.enabled) out.push({ placement: p, remembered: rem, kit: k.enabled });
  }
  return out;
}

/** "This stream remembers L-shaped frame as Off; the kit has it On. Tick On or press From brand kit." (null when nothing differs). */
export function adOverrideNote(diffs: readonly AdOverrideDiff[]): string | null {
  if (diffs.length === 0) return null;
  const d = diffs[0];
  const onOff = (v: boolean) => (v ? 'On' : 'Off');
  const first = `This stream remembers ${AD_PLACEMENT_LABEL[d.placement]} as ${onOff(d.remembered)}; the kit has it ${onOff(d.kit)}.`;
  const more = diffs.length > 1 ? ` ${diffs.length - 1} more ${diffs.length > 2 ? 'ads differ' : 'ad differs'} too.` : '';
  return `${first}${more} ${d.remembered ? 'Untick On' : 'Tick On'} or press From brand kit.`;
}

/** Brand kit card chip: "1 ad switched off" / "2 ads switched off" (null when none). */
export function kitOffChip(count: number): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? 'ad' : 'ads'} switched off`;
}
