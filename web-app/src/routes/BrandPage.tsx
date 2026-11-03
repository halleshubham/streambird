import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ImagePlus, Lock, Pencil, Plus, Replace, Trash2, UploadCloud, X } from 'lucide-react';
import * as assetsApi from '../api/assets';
import { listConnections } from '../api/connections';
import { ApiError } from '../api/client';
import { BirdLoader } from '../components/BirdLoader';
import { BirdBusy } from '../components/BirdBusy';
import { PlatformBadge } from '../components/PlatformBadge';
import { AdIntervalFields, ShrinkSwitch } from '../components/AdsPanel';
import { getMyLimits } from '../api/plans';
import { AD_PLACEMENTS, AD_PLACEMENT_LABEL, describeSchedule, type AdPlacement } from '../studio/ads';
import {
  BRAND_FILE_LIMITS,
  BRAND_ORIENTATIONS,
  BRAND_ORIENTATION_LABEL,
  SLOT_SPECS,
  aspectMismatch,
  sizeText,
  slotHelp,
  type BrandOrientation,
  type BrandSlot,
} from '../studio/brandSizes';
import { kitSetFor } from '../studio/brandKitSet';
import type { AssetKind, AssetLibrary, BrandKit, BrandKitAd, BrandKitInput, LibraryAsset, LowerThirdStyleId, PlatformConnection } from '../types/api';
import { Button, Card, EmptyState, Input, Modal, SelectField, buttonClass, confirm, toast } from '../components/ui';
import { Notice, PageHeader } from '../components/host/HostKit';

const MB = 1024 * 1024;
const KIND_LABEL: Record<AssetKind, string> = { logo: 'Logo', wallpaper: 'Wallpaper', background: 'Background picture', ad: 'Ad', other: 'Other' };
const STYLE_LABEL: Record<LowerThirdStyleId, string> = { bar: 'Solid', accent: 'Accent', glass: 'Glass' };

/** A single file's size: KB under 1 MB so a small logo does not read "0.0 MB". */
const fmtSize = (bytes: number) => (bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : fmtMb(bytes));

const fmtMb = (bytes: number) => `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;

const EMPTY_KIT: BrandKitInput = {
  name: '',
  logoAssetId: null,
  logoAssetIdPortrait: null,
  logoPosition: 'left',
  logoSize: 90,
  wallpaperAssetId: null,
  wallpaperAssetIdPortrait: null,
  wallpaperDim: 0,
  lowerThirdStyle: 'accent',
  adsShrinkPicture: true,
  ads: [],
  adsPortrait: [],
};

/** Which form field holds each material of each orientation (landscape = the fields older clients know). */
const FIELDS: Record<BrandOrientation, { logo: 'logoAssetId' | 'logoAssetIdPortrait'; wallpaper: 'wallpaperAssetId' | 'wallpaperAssetIdPortrait'; ads: 'ads' | 'adsPortrait' }> = {
  landscape: { logo: 'logoAssetId', wallpaper: 'wallpaperAssetId', ads: 'ads' },
  portrait: { logo: 'logoAssetIdPortrait', wallpaper: 'wallpaperAssetIdPortrait', ads: 'adsPortrait' },
};

/**
 * Brand kits: one editor per kit where each graphic (logo, wallpaper, the three ads) is uploaded, previewed,
 * replaced or removed in place, separately for 16:9 and 9:16 streams. The files live in the account's library
 * (Cloudflare R2) as an internal detail: a slot can also pick a file that is already uploaded. A brand is a
 * platform connection (a YouTube channel / Facebook Page); several can share one kit. Paid plans only: Free
 * keeps its logo and wallpaper in this browser.
 */
export function BrandPage() {
  const [lib, setLib] = useState<AssetLibrary | null>(null);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Which kit form is open: a kit id, 'new', or none. One at a time keeps the page short. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Custom ads need a plan without the "Powered by StreamBird" mark; the server enforces it too. */
  const [adsAllowed, setAdsAllowed] = useState<boolean | null>(null);

  /** A short confirmation after an action (saved, uploaded...), so the person is never left wondering. */
  function say(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((n) => (n === message ? null : n)), 4000);
  }

  async function reload() {
    try {
      const [l, conns] = await Promise.all([assetsApi.listAssets(), listConnections()]);
      setLib(l);
      setConnections(conns);
      setKits(l.quotaBytes > 0 ? await assetsApi.listBrandKits() : []);
      getMyLimits().then((lim) => setAdsAllowed(!lim.watermark)).catch(() => setAdsAllowed(true)); // unknown: let the server decide
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load your brand library.');
    }
  }

  /** Only the file list (after an upload inside a kit slot): the open editors keep what they are doing. */
  async function reloadLibrary() {
    try {
      setLib(await assetsApi.listAssets());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load your brand library.');
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void reload();
  }, []);

  if (!lib) {
    return error ? (
      <div className="ha-page">
        <EmptyState tone="error" title="We couldn't load your brand library">
          {error}
        </EmptyState>
      </div>
    ) : (
      <BirdLoader loading compact label="Loading your brand library…" />
    );
  }

  if (!lib.enabled) {
    return (
      <div className="ha-page page brand-page">
        <PageHeader title="Brand" subtitle="Logo, wallpaper and ads that appear on your stream." />
        <Notice tone="info">Brand storage is not enabled on this server yet.</Notice>
      </div>
    );
  }

  if (lib.quotaBytes <= 0) {
    return (
      <div className="ha-page page brand-page">
        <PageHeader title="Brand" subtitle="Logo, wallpaper and ads that appear on your stream." />
        <section className="ha-lock" aria-labelledby="lock-title" data-testid="brand-free-notice">
          <div className="ha-lock-main">
            <p className="ha-eyebrow">
              <Lock size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> On the paid plans
            </p>
            <h2 id="lock-title">Make every stream look like yours</h2>
            <p style={{ marginTop: 8, maxWidth: 480 }}>
              Saving your logo, wallpaper and brand kits in your account is on the paid plans. On the Free plan they stay saved in this browser, in the studio.
            </p>
            <div className="ha-row ha-row--wrap" style={{ marginTop: 24 }}>
              <Link to="/billing" className={buttonClass('primary', 'lg')}>
                See plans
              </Link>
            </div>
          </div>
          <div className="ha-lock-art" role="img" aria-label="Preview of a branded stream with logo and lower third">
            <i style={{ left: 14, top: 14, width: 44, height: 44, borderRadius: 10 }} />
            <i style={{ left: 14, right: 14, bottom: 14, height: 36, borderRadius: 8 }} />
          </div>
        </section>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((lib.usedBytes / lib.quotaBytes) * 100));
  const nearlyFull = pct >= 80;
  const connectionName = (id: string) => connections.find((c) => c.id === id)?.label ?? 'A channel';
  const editorProps = {
    assets: lib.items,
    connections,
    adsAllowed,
    onClose: () => setEditing(null),
    onChanged: reload,
    onLibraryChanged: reloadLibrary,
    onError: setError,
    onSaid: (m: string) => {
      say(m);
      setEditing(null);
    },
  };

  return (
    <div className="ha-page page brand-page">
      <PageHeader
        title="Brand"
        subtitle={
          <>
            A <strong>brand kit</strong> is your look: logo, wallpaper and ads, with one set for 16:9 streams and one for 9:16 (vertical) streams. Give each YouTube channel or Facebook Page its own
            kit, or let several share one.
          </>
        }
        actions={
          editing !== 'new' ? (
            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing('new')}>
              New brand kit
            </Button>
          ) : undefined
        }
      />

      <div className="brand-feedback ha-stack" style={{ gap: 12 }} aria-live="polite">
        {notice && (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        )}
        {error && (
          <Notice tone="error" onDismiss={() => setError(null)}>
            {error}
          </Notice>
        )}
      </div>

      <section aria-labelledby="kits-heading" className="ha-brand-section">
        <h2 id="kits-heading">Brand kits</h2>
        <p className="ha-hint" style={{ marginBottom: 16 }}>
          The kit a channel or page uses is its look. A channel with no kit of its own uses the account default.
        </p>

        {kits.length === 0 && editing !== 'new' && (
          <EmptyState
            icon={<ImagePlus size={28} />}
            title="No brand kits yet"
            action={
              <Button onClick={() => setEditing('new')} icon={<Plus size={16} aria-hidden="true" />}>
                Create a kit
              </Button>
            }
          >
            Create a kit, then add your logo and wallpaper right in it.
          </EmptyState>
        )}

        <ul className="ha-kits">
          {kits.map((k) => (
            <li key={k.id} className={editing === k.id ? "ha-kit-editing" : undefined}>
              {editing === k.id ? (
                <KitEditor key={k.id} kit={k} {...editorProps} />
              ) : (
                <KitSummary kit={k} assets={lib.items} channelNames={k.connectionIds.map(connectionName)} onEdit={() => setEditing(k.id)} />
              )}
            </li>
          ))}
          {editing === 'new' && (
            <li className="ha-kit-editing">
              <KitEditor kit={null} {...editorProps} />
            </li>
          )}
          {kits.length > 0 && editing !== 'new' && (
            <li>
              <button type="button" className="ha-kit-new" onClick={() => setEditing('new')}>
                <span style={{ fontSize: 28, lineHeight: 1 }} aria-hidden="true">
                  +
                </span>
                New kit
              </button>
            </li>
          )}
        </ul>
      </section>

      <Card as="section" aria-labelledby="storage-heading" className="ha-brand-section">
        <h2 id="storage-heading">Storage</h2>
        <div
          className={`ha-meter${nearlyFull ? ' ha-meter--warn' : ''}`}
          style={{ marginTop: 12 }}
          role="img"
          aria-label={`${fmtMb(lib.usedBytes)} of ${fmtMb(lib.quotaBytes)} used`}
        >
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="ha-hint" data-testid="brand-usage">
          {fmtMb(lib.usedBytes)} of {fmtMb(lib.quotaBytes)} used{nearlyFull ? ' -- nearly full. Delete a file or upgrade your plan for more room.' : ''}
        </p>
        <details className="ha-files" data-testid="brand-files">
          <summary>Uploaded files ({lib.items.length})</summary>
          <p className="ha-hint">
            Every picture you add in a kit is kept here, so another slot or kit can reuse it. Delete a file you no longer need to free space (a file a kit uses must be removed from the kit first).
          </p>
          {lib.items.length === 0 ? (
            <p className="ha-hint">No files yet.</p>
          ) : (
            <ul className="ha-asset-grid">
              {lib.items.map((a) => (
                <AssetCard key={a.id} asset={a} onChanged={reload} onError={setError} />
              ))}
            </ul>
          )}
        </details>
      </Card>
    </div>
  );
}

/** A mini picture of what a kit looks like for one orientation: wallpaper, logo corner and size, ads, lower-third style. */
function KitPreview({ kit, assets, orientation }: { kit: BrandKitInput; assets: LibraryAsset[]; orientation: BrandOrientation }) {
  const f = FIELDS[orientation];
  // A 9:16 preview shows the logo the vertical stream really uses: its own, else the 16:9 one.
  const logoId = kit[f.logo] ?? (orientation === 'portrait' ? kit.logoAssetId : null);
  const logo = assets.find((a) => a.id === logoId);
  const wall = assets.find((a) => a.id === kit[f.wallpaper]);
  const ads = kit[f.ads] ?? [];
  const canvasH = orientation === 'portrait' ? 1920 : 720;
  return (
    <div className={`kit-preview${orientation === 'portrait' ? ' kit-preview--portrait' : ''}`} aria-hidden="true" data-testid="kit-preview" data-orientation={orientation}>
      {wall && <img className="kit-preview-wall" src={assetsApi.assetFileUrl(wall.id)} alt="" />}
      {wall && <div className="kit-preview-dim" style={{ opacity: kit.wallpaperDim / 100 }} />}
      {logo && (
        <img
          className={`kit-preview-logo kit-preview-logo--${kit.logoPosition}`}
          src={assetsApi.assetFileUrl(logo.id)}
          alt=""
          style={{ height: `${Math.max(6, (kit.logoSize / canvasH) * 100)}%` }}
        />
      )}
      {AD_PLACEMENTS.map((p) => {
        const ad = ads.find((a) => a.placement === p);
        return ad ? (
          <div key={p} className={`kit-preview-ad kit-preview-ad--${p}`} style={p === 'full_screen' ? { opacity: 0.75 } : undefined} data-testid={`kit-preview-ad-${p}`}>
            <img src={assetsApi.assetFileUrl(ad.assetId)} alt="" />
          </div>
        ) : null;
      })}
      <div className={`kit-preview-lt kit-preview-lt--${kit.lowerThirdStyle}`}>
        <b>Your name</b>
        <span>Title or topic</span>
      </div>
    </div>
  );
}

function KitSummary({ kit, assets, channelNames, onEdit }: { kit: BrandKit; assets: LibraryAsset[]; channelNames: string[]; onEdit: () => void }) {
  const hasPortrait = !!(kit.logoAssetIdPortrait || kit.wallpaperAssetIdPortrait || (kit.adsPortrait ?? []).length > 0);
  return (
    <Card as="div" className="ha-kit-card">
      <div className="ha-kit-previews">
        <KitPreview kit={kit} assets={assets} orientation="landscape" />
        {hasPortrait && <KitPreview kit={kit} assets={assets} orientation="portrait" />}
      </div>
      <div className="ha-row ha-row--wrap" style={{ gap: 8 }}>
        <h3>{kit.name}</h3>
        {kit.isDefault && <span className="ha-tag ha-tag--ok">Account default</span>}
      </div>
      <p className="ha-sm ha-muted">
        {channelNames.length > 0 ? `Used by ${channelNames.join(', ')}` : kit.isDefault ? 'Used by every channel without a kit of its own' : 'Not used by any channel yet'}
      </p>
      <p className="ha-sm ha-muted">{hasPortrait ? 'Has a 16:9 and a 9:16 set' : 'Has a 16:9 set (no 9:16 set yet)'}</p>
      <div className="ha-row">
        <Button variant="secondary" aria-label={`Edit ${kit.name}`} icon={<Pencil size={14} aria-hidden="true" />} onClick={onEdit}>
          Edit
        </Button>
      </div>
    </Card>
  );
}

function AssetCard({ asset, onChanged, onError }: { asset: LibraryAsset; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(asset.name);
  const [saving, setSaving] = useState(false);
  async function rename() {
    const next = name.trim();
    if (!next || next === asset.name) {
      setName(asset.name);
      setRenaming(false);
      return;
    }
    setSaving(true);
    try {
      await assetsApi.renameAsset(asset.id, next);
      await onChanged();
      setRenaming(false);
      toast.success('File renamed');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not rename the file.');
      setRenaming(false);
    } finally {
      setSaving(false);
    }
  }
  async function remove() {
    const ok = await confirm({
      title: `Delete "${asset.name}"?`,
      body: 'Brand kits that use this file will lose it. This cannot be undone.',
      confirmLabel: 'Delete file',
      destructive: true,
    });
    if (!ok) return;
    try {
      await assetsApi.deleteAsset(asset.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete the file.');
    }
  }
  return (
    <li className="ha-asset">
      <img src={assetsApi.assetFileUrl(asset.id)} alt={asset.name} loading="lazy" />
      <span className="ha-asset-name">{asset.name}</span>
      <span className="ha-sm ha-muted">
        {KIND_LABEL[asset.kind]} · {asset.width}×{asset.height} · {fmtSize(asset.sizeBytes)}
        {asset.usedBy.length > 0 && <> · used by {asset.usedBy.join(', ')}</>}
      </span>
      <div className="ha-asset-actions">
        <button
          type="button"
          className="ha-quiet"
          aria-label={`Rename ${asset.name}`}
          onClick={() => {
            setName(asset.name);
            setRenaming(true);
          }}
        >
          <Pencil size={14} aria-hidden="true" /> Rename
        </button>
        <button type="button" className="ha-quiet ha-quiet--danger" aria-label={`Delete ${asset.name}`} onClick={() => void remove()}>
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename file"
        description="Only you see this name. Kits keep using the same picture."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)} disabled={saving}>
              Cancel
            </Button>
            <Button busy={saving} disabled={!name.trim()} onClick={() => void rename()}>
              Save name
            </Button>
          </>
        }
      >
        <Input
          label="File name"
          value={name}
          maxLength={120}
          data-autofocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void rename();
            }
          }}
        />
      </Modal>
    </li>
  );
}

/** The kind a picture uploaded into a slot is stored as, and the kinds the "choose from uploaded" list offers. */
const SLOT_KIND: Record<BrandSlot, { upload: AssetKind; choose: AssetKind[] }> = {
  logo: { upload: 'logo', choose: ['logo', 'other'] },
  wallpaper: { upload: 'wallpaper', choose: ['wallpaper', 'background', 'other'] },
  lower_third: { upload: 'ad', choose: ['ad'] },
  side_third: { upload: 'ad', choose: ['ad'] },
  full_screen: { upload: 'ad', choose: ['ad'] },
};

interface SlotPickerProps {
  slot: BrandSlot;
  orientation: BrandOrientation;
  /** Name used in labels, e.g. "Logo" or "Lower third ad". */
  label: string;
  assetId: string | null;
  assets: LibraryAsset[];
  onChange: (assetId: string | null) => void;
  onLibraryChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onSaid: (m: string) => void;
}

/**
 * One graphic of a kit: drop a file on it or click to choose one (it is uploaded right away), see it, replace or
 * remove it, or pick a file that is already uploaded. Shows the suggested size and warns (never blocks) when the
 * picture's shape is far from the suggestion.
 */
function SlotPicker({ slot, orientation, label, assetId, assets, onChange, onLibraryChanged, onError, onSaid }: SlotPickerProps) {
  const spec = SLOT_SPECS[orientation][slot];
  const kinds = SLOT_KIND[slot];
  const asset = assets.find((a) => a.id === assetId) ?? null;
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const allowGif = BRAND_FILE_LIMITS.gifSlots.includes(slot);
  const accept = allowGif ? 'image/png,image/jpeg,image/webp,image/gif' : 'image/png,image/jpeg,image/webp';

  async function take(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    onError(null);
    if (file.size > BRAND_FILE_LIMITS.maxBytes) {
      onError(`"${file.name}" is ${fmtSize(file.size)}; the limit is ${BRAND_FILE_LIMITS.maxBytes / MB} MB. Export a smaller picture and try again.`);
      return;
    }
    setBusy(true);
    try {
      const name = file.name.replace(/\.[^.]+$/, '');
      const created = await assetsApi.uploadAsset(file, kinds.upload, name);
      await onLibraryChanged(); // the new file is in the list (with its size) before the slot shows it
      onChange(created.id);
      onSaid(`Uploaded "${name}". Save the kit to keep it.`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files?.[0]);
  }

  const options = assets.filter((a) => kinds.choose.includes(a.kind));
  const mismatch = asset ? aspectMismatch(asset.width, asset.height, spec) : false;

  return (
    <div className="ha-slot" data-testid={`kit-slot-${slot}`} data-has-file={asset ? 'true' : 'false'}>
      <label
        className={`ha-slot-thumb${over ? ' is-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {busy ? <BirdBusy /> : asset ? <img src={assetsApi.assetFileUrl(asset.id)} alt="" className="brand-drop-preview" /> : <span>No image</span>}
        <input ref={fileRef} type="file" accept={accept} aria-label={`${label} file`} disabled={busy} onChange={(e) => void take(e.target.files?.[0])} />
      </label>
      <div className="ha-slot-body">
        <div className="ha-slot-head">
          <strong>{label}</strong>
          <span className="ha-slot-sug" data-testid={`slot-size-${slot}`}>Suggested {sizeText(spec)}</span>
        </div>
        {asset && (
          <p className="ha-sm">
            <strong className="kit-slot-name">{asset.name}</strong>{' '}
            <span className="ha-muted">
              {asset.width} x {asset.height} · {fmtSize(asset.sizeBytes)}
            </span>
          </p>
        )}
        <p className="ha-hint" style={{ marginTop: 0 }} data-testid={`slot-help-${slot}`}>
          {slotHelp(orientation, slot)}
        </p>
        {mismatch && asset && (
          <p className="ha-slot-warn kit-slot-warning" role="status" data-testid={`slot-warning-${slot}`}>
            <AlertTriangle size={14} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} /> This picture is {asset.width} x {asset.height}, a different shape from the suggested {sizeText(spec)}.
            It still works, but it may look small or cropped.
          </p>
        )}
        <div className="ha-slot-actions">
          {asset ? (
            <Button variant="secondary" size="sm" aria-label={`Replace ${label}`} disabled={busy} icon={<Replace size={14} aria-hidden="true" />} onClick={() => fileRef.current?.click()}>
              Replace
            </Button>
          ) : (
            <Button variant="secondary" size="sm" disabled={busy} icon={<UploadCloud size={14} aria-hidden="true" />} onClick={() => fileRef.current?.click()}>
              Upload image
            </Button>
          )}
          {options.length > 0 && (
            <select
              className="ui-input ui-select"
              aria-label={`${label}: choose from uploaded`}
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value) onChange(e.target.value);
              }}
            >
              <option value="">Choose from uploaded…</option>
              {options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.width}x{a.height})
                </option>
              ))}
            </select>
          )}
          {asset && (
            <button type="button" className="ha-quiet ha-quiet--danger" aria-label={`Remove ${label}`} disabled={busy} onClick={() => onChange(null)}>
              <X size={14} aria-hidden="true" /> Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface KitEditorProps {
  kit: BrandKit | null;
  assets: LibraryAsset[];
  connections: PlatformConnection[];
  /** null while the plan is still loading; false = the plan has the Powered-by mark (kit ads can be seen and removed, not added). */
  adsAllowed: boolean | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onLibraryChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onSaid: (m: string) => void;
}

const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));
const sameAds = (a: BrandKitAd[], b: BrandKitAd[]) => JSON.stringify([...a].sort(byPlacement)) === JSON.stringify([...b].sort(byPlacement));
const byPlacement = (x: BrandKitAd, y: BrandKitAd) => x.placement.localeCompare(y.placement);
const PLAIN_KEYS = ['name', 'logoAssetId', 'logoAssetIdPortrait', 'logoPosition', 'logoSize', 'wallpaperAssetId', 'wallpaperAssetIdPortrait', 'wallpaperDim', 'lowerThirdStyle', 'adsShrinkPicture'] as const;

/** One kit's editor (also the "new kit" form when `kit` is null): every graphic in place, per orientation, with a live preview. */
function KitEditor({ kit, assets, connections, adsAllowed, onClose, onChanged, onLibraryChanged, onError, onSaid }: KitEditorProps) {
  const initial: BrandKitInput = kit ? { ...EMPTY_KIT, ...kit, ads: kit.ads ?? [], adsPortrait: kit.adsPortrait ?? [] } : EMPTY_KIT;
  const [form, setForm] = useState<BrandKitInput>(initial);
  const [orientation, setOrientation] = useState<BrandOrientation>('landscape');
  const [isDefault, setIsDefault] = useState(kit?.isDefault ?? false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(kit?.connectionIds ?? []));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BrandKitInput>(key: K, value: BrandKitInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const idPrefix = kit ? `kit-${kit.id}` : 'kit-new';
  const f = FIELDS[orientation];
  const spec = SLOT_SPECS[orientation];
  const ads = form[f.ads] ?? [];

  const dirty =
    !kit ||
    PLAIN_KEYS.some((k) => form[k] !== initial[k]) ||
    !sameAds(form.ads ?? [], initial.ads ?? []) ||
    !sameAds(form.adsPortrait ?? [], initial.adsPortrait ?? []) ||
    isDefault !== kit.isDefault ||
    !sameSet(chosen, kit.connectionIds);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      // Only send ads when the plan allows them, or to clear them (always allowed): ads saved on a plan that is now Free stay until removed.
      const sendAds = (list: BrandKitAd[]) => adsAllowed === true || list.length === 0;
      const body: BrandKitInput = {
        name: form.name.trim(),
        logoAssetId: form.logoAssetId,
        logoAssetIdPortrait: form.logoAssetIdPortrait ?? null,
        logoPosition: form.logoPosition,
        logoSize: form.logoSize,
        wallpaperAssetId: form.wallpaperAssetId,
        wallpaperAssetIdPortrait: form.wallpaperAssetIdPortrait ?? null,
        wallpaperDim: form.wallpaperDim,
        lowerThirdStyle: form.lowerThirdStyle,
        adsShrinkPicture: form.adsShrinkPicture !== false,
        ...(sendAds(form.ads ?? []) ? { ads: form.ads ?? [] } : {}),
        ...(sendAds(form.adsPortrait ?? []) ? { adsPortrait: form.adsPortrait ?? [] } : {}),
      };
      const saved = kit
        ? await assetsApi.updateBrandKit(kit.id, { ...body, ...(isDefault && !kit.isDefault ? { isDefault: true } : {}) })
        : await assetsApi.createBrandKit({ ...body, ...(isDefault ? { isDefault: true } : {}) });
      const before = new Set(kit?.connectionIds ?? []);
      for (const id of chosen) if (!before.has(id)) await assetsApi.assignBrandKit(id, saved.id);
      for (const id of before) if (!chosen.has(id)) await assetsApi.assignBrandKit(id, null);
      await onChanged();
      onSaid(kit ? `Saved "${body.name}".` : `Created "${body.name}".`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the brand kit.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!kit) return;
    const ok = await confirm({
      title: `Delete "${kit.name}"?`,
      body: 'Channels that use this kit go back to the account default. Your uploaded files stay in storage.',
      confirmLabel: 'Delete kit',
      destructive: true,
    });
    if (!ok) return;
    try {
      await assetsApi.deleteBrandKit(kit.id);
      await onChanged();
      onSaid(`Deleted "${kit.name}".`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete the brand kit.');
    }
  }

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const slotCommon = { orientation, assets, onLibraryChanged, onError, onSaid: () => undefined };
  // The set a vertical stream really gets: its own wallpaper/ads, the 16:9 logo only when it has no 9:16 one.
  const effective = kitSetFor(
    { logoAssetId: form.logoAssetId, logoAssetIdPortrait: form.logoAssetIdPortrait ?? null, wallpaperAssetId: form.wallpaperAssetId, wallpaperAssetIdPortrait: form.wallpaperAssetIdPortrait ?? null, ads: form.ads ?? [], adsPortrait: form.adsPortrait ?? [] },
    orientation,
  );

  return (
    <form className="ha-kit-editor" onSubmit={save} aria-label={kit ? `Brand kit ${kit.name}` : 'New brand kit'}>
      <div className="ha-kit-bar">
        <button type="button" className="ha-quiet" aria-label="Close without saving" onClick={onClose}>
          &larr; Brand kits
        </button>
        <span className="ha-sp" />
        {kit && (
          <button type="button" className="ha-quiet ha-quiet--danger" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={14} aria-hidden="true" /> Delete kit
          </button>
        )}
        <Button type="submit" busy={busy} disabled={!form.name.trim() || !dirty}>
          {kit ? 'Save kit' : 'Create kit'}
        </Button>
      </div>

      <div className="ha-row ha-row--wrap" style={{ alignItems: 'flex-end', gap: 24 }}>
        <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Input id={`${idPrefix}-name`} label="Kit name" required maxLength={80} value={form.name} placeholder="e.g. Main channel" onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <span className="ui-field-label" style={{ display: 'block', marginBottom: 6 }}>
            Shape
          </span>
          <div className="ha-seg" role="tablist" aria-label="Kit orientation">
            {BRAND_ORIENTATIONS.map((o) => (
              <button
                key={o}
                type="button"
                role="tab"
                id={`${idPrefix}-tab-${o}`}
                aria-selected={orientation === o}
                aria-controls={`${idPrefix}-panel`}
                onClick={() => setOrientation(o)}
              >
                {BRAND_ORIENTATION_LABEL[o]}
                <span className="ui-sr-only"> {o === 'landscape' ? 'landscape' : 'vertical'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="ha-kit-cols">
        <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${orientation}`} className="ha-slots" data-orientation={orientation}>
          <p className="ha-hint" style={{ marginTop: 0 }} data-testid="kit-orientation-note">
            {orientation === 'landscape'
              ? 'Used by 16:9 (landscape) streams.'
              : 'Used by 9:16 (vertical) streams. A vertical stream uses only this set; if it has no logo here the 16:9 logo is used. Wallpaper and ads are not borrowed from the 16:9 set.'}
          </p>

          <SlotPicker {...slotCommon} slot="logo" label="Logo" assetId={form[f.logo] ?? null} onChange={(id) => set(f.logo, id)} />
          {orientation === 'portrait' && !form.logoAssetIdPortrait && effective.logoAssetId && <p className="ha-hint">No 9:16 logo: vertical streams use the 16:9 logo.</p>}
          <SlotPicker {...slotCommon} slot="wallpaper" label="Wallpaper" assetId={form[f.wallpaper] ?? null} onChange={(id) => set(f.wallpaper, id)} />
          <p className="ha-hint" style={{ marginTop: 0 }}>
            Size: {sizeText(spec.wallpaper)} for {BRAND_ORIENTATION_LABEL[orientation]}.
          </p>

          <fieldset className="ha-fieldset ha-slots" data-testid="kit-ads">
            <legend>Ads</legend>
            <p className="ha-hint" style={{ marginTop: 0 }}>
              Up to three ads on the broadcast picture, one in each place. Studio hosts can still switch them off or replace them per stream.
            </p>
            {adsAllowed === null ? (
              <p className="ha-hint">Checking your plan…</p>
            ) : adsAllowed === false ? (
              <>
                <Notice tone="info" testId="kit-ads-free-notice">
                  <Lock size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Your own ads are on the plans without the “Powered by StreamBird” mark. Free streams carry a StreamBird ad instead.{' '}
                  <Link to="/billing" className="chip-link chip-link--sm">
                    See plans
                  </Link>
                </Notice>
                {(form.ads ?? []).length + (form.adsPortrait ?? []).length > 0 && (
                  <div data-testid="kit-ads-readonly">
                    <p className="ha-hint">This kit still has ads from when your plan allowed them. They are not used on this plan. You can remove them (this also frees their files for deletion).</p>
                    <ul style={{ listStyle: 'disc', paddingLeft: 20, margin: '8px 0' }}>
                      {[...(form.ads ?? []).map((ad) => ({ ad, o: 'landscape' as const })), ...(form.adsPortrait ?? []).map((ad) => ({ ad, o: 'portrait' as const }))].map(({ ad, o }) => (
                        <li key={`${o}-${ad.placement}`}>
                          {AD_PLACEMENT_LABEL[ad.placement]}{o === 'portrait' ? ' (9:16)' : ''}: {assets.find((a) => a.id === ad.assetId)?.name ?? 'a file'} ({describeSchedule(ad.mode === 'interval' && ad.showSec && ad.everySec ? { mode: 'interval', showSec: ad.showSec, everySec: ad.everySec } : { mode: 'continuous' })})
                        </li>
                      ))}
                    </ul>
                    <Button variant="secondary" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setForm((v) => ({ ...v, ads: [], adsPortrait: [] }))}>
                      Remove ads
                    </Button>
                  </div>
                )}
              </>
            ) : (
              AD_PLACEMENTS.map((p) => (
                <AdSlotEditor
                  key={p}
                  placement={p}
                  ad={ads.find((a) => a.placement === p) ?? null}
                  picker={slotCommon}
                  onChange={(ad) => set(f.ads, [...ads.filter((a) => a.placement !== p), ...(ad ? [ad] : [])])}
                />
              ))
            )}
          </fieldset>
        </div>

        <aside className="ha-kit-aside" aria-label="Preview and look">
          <Card as="div">
            <h3 style={{ fontSize: 17 }}>Preview</h3>
            <div style={{ marginTop: 12 }}>
              <KitPreview kit={form} assets={assets} orientation={orientation} />
            </div>
            <p className="ha-hint">A preview of the look. The studio draws it at full size.</p>
          </Card>

          <Card as="fieldset" className="ha-fieldset ha-stack" data-testid="kit-shared" style={{ gap: 20 }}>
            <legend className="ha-legend">Look (both shapes)</legend>
            <div>
              <span className="ui-field-label" id={`${idPrefix}-pos`} style={{ display: 'block', marginBottom: 6 }}>
                Logo position
              </span>
              <div className="ha-seg" role="group" aria-labelledby={`${idPrefix}-pos`}>
                {(['left', 'right'] as const).map((p) => (
                  <button key={p} type="button" aria-pressed={form.logoPosition === p} onClick={() => set('logoPosition', p)}>
                    {p === 'left' ? 'Top left' : 'Top right'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="ui-field-label" htmlFor={`${idPrefix}-size`}>
                Logo size: {form.logoSize}px
              </label>
              <input id={`${idPrefix}-size`} type="range" min={16} max={600} value={form.logoSize} onChange={(e) => set('logoSize', parseInt(e.target.value, 10))} />
            </div>
            <div>
              <label className="ui-field-label" htmlFor={`${idPrefix}-dim`}>
                Darken wallpaper: {form.wallpaperDim}%
              </label>
              <input id={`${idPrefix}-dim`} type="range" min={0} max={80} value={form.wallpaperDim} onChange={(e) => set('wallpaperDim', parseInt(e.target.value, 10))} />
            </div>
            <SelectField id={`${idPrefix}-lt`} label="Lower-third look" value={form.lowerThirdStyle} onChange={(e) => set('lowerThirdStyle', e.target.value as LowerThirdStyleId)}>
              {(Object.keys(STYLE_LABEL) as LowerThirdStyleId[]).map((st) => (
                <option key={st} value={st}>
                  {STYLE_LABEL[st]}
                </option>
              ))}
            </SelectField>
            <ShrinkSwitch shrink={form.adsShrinkPicture !== false} onChange={(on) => set('adsShrinkPicture', on)} />
          </Card>

          <Card as="fieldset" className="ha-fieldset ha-stack" style={{ gap: 4 }}>
            <legend className="ha-legend">Channels and pages using this kit</legend>
            {connections.length === 0 ? (
              <p className="ha-hint">Connect a platform first (Connections).</p>
            ) : (
              connections.map((c) => (
                <label key={c.id} className="ha-check">
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} /> <PlatformBadge platform={c.platform} /> {c.label}
                </label>
              ))
            )}
            <label className="ha-check" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={isDefault} disabled={kit?.isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Use as the account default
            </label>
            {kit?.isDefault && <p className="ha-hint">To change the default, open the kit you want and tick this box there.</p>}
          </Card>
        </aside>
      </div>
    </form>
  );
}

/** One of a kit's three ad slots: the picture (uploaded in place), on/off and the schedule (stored in seconds). */
function AdSlotEditor({
  placement,
  ad,
  picker,
  onChange,
}: {
  placement: AdPlacement;
  ad: BrandKitAd | null;
  picker: Omit<SlotPickerProps, 'slot' | 'label' | 'assetId' | 'onChange'>;
  onChange: (ad: BrandKitAd | null) => void;
}) {
  const label = AD_PLACEMENT_LABEL[placement];
  const timed = ad?.mode === 'interval';
  const patch = (next: Partial<BrandKitAd>) => ad && onChange({ ...ad, ...next });
  return (
    <div className="kit-ad-slot ha-ad-slot" role="group" aria-label={`${label} ad`} data-testid={`kit-ad-${placement}`}>
      <SlotPicker
        {...picker}
        slot={placement}
        label={`${label} ad`}
        assetId={ad?.assetId ?? null}
        onChange={(assetId) =>
          onChange(assetId ? { placement, assetId, enabled: ad?.enabled ?? true, mode: ad?.mode ?? 'continuous', showSec: ad?.showSec ?? null, everySec: ad?.everySec ?? null } : null)
        }
      />
      {ad && (
        <div className="ha-ad-controls">
          <label className="ha-check">
            <input type="checkbox" checked={ad.enabled} aria-label={`${label} ad on`} onChange={(e) => patch({ enabled: e.target.checked })} /> On
          </label>
          <div className="ha-seg" role="group" aria-label={`${label} ad: when`}>
            <button type="button" aria-pressed={!timed} onClick={() => patch({ mode: 'continuous', showSec: null, everySec: null })}>
              Always on
            </button>
            <button type="button" aria-pressed={timed} onClick={() => patch({ mode: 'interval', showSec: ad.showSec ?? 15, everySec: ad.everySec ?? 180 })}>
              Now and then
            </button>
          </div>
          {ad.mode === 'interval' && ad.showSec && ad.everySec && (
            <AdIntervalFields label={label} schedule={{ mode: 'interval', showSec: ad.showSec, everySec: ad.everySec }} onChange={(sch) => sch.mode === 'interval' && patch({ showSec: sch.showSec, everySec: sch.everySec })} />
          )}
        </div>
      )}
    </div>
  );
}
