/** Superadmin read-only brand kit view -- see SuperadminBrandKitsService on the server. */
export interface AdminAssetSummary {
  assetId: string;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  missing?: true;
}
export type AdminWindowCheck =
  | { status: 'found'; x: number; y: number; w: number; h: number }
  | { status: 'none' }
  | { status: 'not_checked'; reason: string };
export interface AdminAdSummary extends AdminAssetSummary {
  placement: 'lower_third' | 'side_third' | 'full_screen' | 'l_shape';
  /** Place in the placement's sequence (0 = first); optional for older servers. */
  position?: number;
  enabled: boolean;
  mode: 'continuous' | 'interval';
  showSec: number | null;
  everySec: number | null;
  windowCheck?: AdminWindowCheck;
}
export interface AdminKitSet {
  logo: AdminAssetSummary | null;
  wallpaper: AdminAssetSummary | null;
  ads: AdminAdSummary[];
}
export interface AdminDiagnostic {
  level: 'warning' | 'info';
  text: string;
}
export interface AdminBrandKit {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  connectionIds: string[];
  connections: Array<{ id: string; platform: string; displayName: string }>;
  logoPosition: string;
  logoSize: number;
  adsShrinkPicture: boolean;
  wallpaperDim: number;
  lowerThirdStyle: string;
  clock: {
    clockEnabled: boolean;
    clockPosition: string;
    clockFormat: string;
    clockShowDate: boolean;
    clockShowSeconds: boolean;
    clockTimezone: string | null;
    clockSize: string;
    clockStyle: string;
    clockAlternate: boolean;
  };
  title: string | null;
  description: string | null;
  thumbnail: AdminAssetSummary | null;
  landscape: AdminKitSet;
  portrait: AdminKitSet;
  diagnostics: AdminDiagnostic[];
}
export interface AdminBrandPlan {
  key: string;
  name: string;
  watermark: boolean;
  poweredByMark: boolean;
  assetStorageMb: number;
}
export interface AdminAccountBrandKits {
  account: { id: string; name: string };
  plan: AdminBrandPlan;
  kits: AdminBrandKit[];
}
export interface AdminStreamBrandKit {
  stream: { id: string; title: string; status: string; orientation: 'landscape' | 'portrait'; accountId: string; createdAt: string };
  account: { id: string; name: string };
  plan: AdminBrandPlan;
  destinations: Array<{
    destinationId: string;
    status: string;
    platform: string | null;
    displayName: string | null;
    connectionId: string;
    kitId: string | null;
    kitName: string | null;
    kitSource: 'channel' | 'account_default' | null;
  }>;
  kits: AdminBrandKit[];
  diagnostics: AdminDiagnostic[];
}
