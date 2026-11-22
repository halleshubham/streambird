import type { WindowCheck } from '../assets/image-pixels';

export type AdPlacementKey = 'lower_third' | 'side_third' | 'full_screen' | 'l_shape';
export type SetName = 'landscape' | 'portrait';

export interface AssetSummary {
  assetId: string;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  /** True when the library row is gone (should not happen: the kit points at it). */
  missing?: true;
}

export interface AdSummary extends AssetSummary {
  placement: AdPlacementKey;
  /** Place in the placement's sequence, 0 = first (several ads of one placement play in turn). */
  position?: number;
  enabled: boolean;
  mode: 'continuous' | 'interval';
  showSec: number | null;
  everySec: number | null;
  /** l_shape only: the studio's window detection run on the stored file. */
  windowCheck?: WindowCheck;
}

export interface KitSet {
  logo: AssetSummary | null;
  wallpaper: AssetSummary | null;
  ads: AdSummary[];
}

export interface Diagnostic {
  /** warning = probably the cause of a "my ad does not show" report; info = context. */
  level: 'warning' | 'info';
  text: string;
}

export interface DiagnosticsInput {
  isDefault: boolean;
  adsShrinkPicture: boolean;
  /** Channels that point at this kit, e.g. "youtube: My channel". */
  channels: string[];
  landscape: KitSet;
  portrait: KitSet;
  thumbnail: AssetSummary | null;
  plan: { name: string; watermark: boolean };
}

export const PLACEMENT_LABEL: Record<AdPlacementKey, string> = {
  lower_third: 'Lower third',
  side_third: 'Left third',
  full_screen: 'Full screen',
  l_shape: 'L-shaped frame',
};

const SET_LABEL: Record<SetName, string> = { landscape: 'landscape (16:9)', portrait: 'portrait (9:16)' };
const pct = (n: number) => `${Math.round(n * 100)}%`;
const typeName = (mime: string | null) => (mime ? mime.replace('image/', '').toUpperCase() : 'unknown type');

export function describeWindowCheck(c: WindowCheck | undefined): string {
  if (!c) return 'not checked';
  if (c.status === 'found') return `found ${pct(c.w)} x ${pct(c.h)}`;
  if (c.status === 'none') return 'NO CLEAR WINDOW FOUND';
  return `not checked (${c.reason})`;
}

/** Plain-language findings for one kit. Pure: the caller supplies the facts (including the window check results). */
export function buildKitDiagnostics(k: DiagnosticsInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const add = (level: Diagnostic['level'], text: string) => out.push({ level, text });

  if (k.plan.watermark) {
    add(
      'warning',
      `Plan ${k.plan.name} carries the Powered-by StreamBird mark: brand kits and the account's own ads are not available. Streams show a StreamBird ad instead of the ads below.`,
    );
  }

  if (k.channels.length > 0) add('info', `Kit applies to channels: ${k.channels.join(', ')}.`);
  if (k.isDefault) add('info', 'Account default kit: used by streams whose channels have no kit of their own.');
  if (k.channels.length === 0 && !k.isDefault) add('info', 'Not the default kit and no channel uses it: no stream picks it up automatically.');

  const sets: SetName[] = ['landscape', 'portrait'];
  const anyAd = sets.some((s) => k[s].ads.length > 0);
  if (!anyAd) add('info', 'No ads in either set.');

  // The shrink switch only governs the lower and left thirds; the L-shaped frame always fits the picture in its window.
  if (!k.adsShrinkPicture && anyAd) {
    add('info', 'Shrink picture while ads show is OFF: this only affects Lower third and Left third ads; the L-shaped frame always fits the picture in its window.');
  }

  for (const s of sets) {
    const set = k[s];
    for (const ad of set.ads) {
      const total = set.ads.filter((x) => x.placement === ad.placement).length;
      const label = total > 1 ? `${PLACEMENT_LABEL[ad.placement]} ad ${(ad.position ?? 0) + 1} of ${total}` : PLACEMENT_LABEL[ad.placement];
      if (total > 1 && (ad.position ?? 0) === 0) {
        add(
          'info',
          `${PLACEMENT_LABEL[ad.placement]} (${SET_LABEL[s]}) plays ${total} ads in turn (${ad.mode === 'interval' ? `each time it comes round the next one shows; the pause between showings is ${ad.everySec} s` : 'always on: each ad is shown for its own time, then the next'}).`,
        );
      }
      if (ad.placement === 'l_shape') {
        const size = ad.missing ? 'file missing' : `file ${ad.width}x${ad.height} ${typeName(ad.mime)}`;
        const bad = ad.windowCheck?.status === 'none';
        add(bad ? 'warning' : 'info', `${label} (${SET_LABEL[s]}): ${size}; window check: ${describeWindowCheck(ad.windowCheck)}${bad ? ' (the frame is drawn as a plain overlay and the picture is not shrunk)' : ''}.`);
      }
      if (!ad.enabled) add('warning', `${label} (${SET_LABEL[s]}) is switched off: tick On to use it.`);
      if (ad.mode === 'interval' && ad.showSec !== null && ad.everySec !== null) {
        add(
          'info',
          `${label} (${SET_LABEL[s]}) is set to Now and then: hidden for the first ${ad.everySec} s of each cycle, then shown for ${ad.showSec} s (cycle ${ad.everySec + ad.showSec} s).`,
        );
      }
    }
  }

  // The other set: a placement used in one set but missing in the other means that orientation shows nothing there.
  for (const s of sets) {
    const other: SetName = s === 'landscape' ? 'portrait' : 'landscape';
    for (const ad of k[s].ads) {
      if (!k[other].ads.some((a) => a.placement === ad.placement)) {
        const who = other === 'portrait' ? 'a vertical stream' : 'a landscape stream';
        add(ad.placement === 'l_shape' ? 'warning' : 'info', `${capitalize(SET_LABEL[other])} set has no ${PLACEMENT_LABEL[ad.placement]} (${who} will not show one).`);
      }
    }
    if (k[s].logo && !k[other].logo) add('info', `${capitalize(SET_LABEL[other])} set has no logo.`);
    if (k[s].wallpaper && !k[other].wallpaper) add('info', `${capitalize(SET_LABEL[other])} set has no wallpaper.`);
  }
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Extra findings when the question is about one stream: only the set of the stream's orientation applies. */
export function buildStreamDiagnostics(opts: {
  orientation: SetName;
  kit: { name: string; adsShrinkPicture: boolean; landscape: KitSet; portrait: KitSet } | null;
  kitSource: 'channel' | 'account_default' | null;
  plan: { name: string; watermark: boolean };
}): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!opts.kit) {
    out.push({ level: 'warning', text: 'No brand kit applies: no destination has a kit and the account has no default kit.' });
    return out;
  }
  const set = opts.kit[opts.orientation];
  out.push({
    level: 'info',
    text: `Kit "${opts.kit.name}" (${opts.kitSource === 'channel' ? 'chosen by a destination channel' : 'account default'}); this is a ${opts.orientation === 'portrait' ? 'vertical (9:16)' : 'landscape (16:9)'} stream, so the ${opts.orientation} set applies.`,
  });
  if (opts.plan.watermark) out.push({ level: 'warning', text: `Plan ${opts.plan.name} carries the Powered-by StreamBird mark: custom ads do not run.` });
  const frame = set.ads.find((a) => a.placement === 'l_shape');
  if (!frame) out.push({ level: 'info', text: `The ${opts.orientation} set has no L-shaped frame, so this stream shows none.` });
  else if (frame.windowCheck?.status === 'none') out.push({ level: 'warning', text: 'The L-shaped frame has no clear window, so it cannot shrink the picture on this stream.' });
  return out;
}
