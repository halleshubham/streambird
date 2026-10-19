import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ImagePlus, Lock, Trash2, Upload } from 'lucide-react';
import * as assetsApi from '../api/assets';
import { listConnections } from '../api/connections';
import { ApiError } from '../api/client';
import { BirdLoader } from '../components/BirdLoader';
import { BirdBusy } from '../components/BirdBusy';
import { PlatformBadge } from '../components/PlatformBadge';
import type { AssetKind, AssetLibrary, BrandKit, BrandKitInput, LibraryAsset, LowerThirdStyleId, PlatformConnection } from '../types/api';

const MB = 1024 * 1024;
const KIND_LABEL: Record<AssetKind, string> = { logo: 'Logo', wallpaper: 'Wallpaper', background: 'Background picture', other: 'Other' };
const STYLE_LABEL: Record<LowerThirdStyleId, string> = { bar: 'Solid', accent: 'Accent', glass: 'Glass' };

const fmtMb = (bytes: number) => `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;

const EMPTY_KIT: BrandKitInput = { name: '', logoAssetId: null, logoPosition: 'left', logoSize: 90, wallpaperAssetId: null, wallpaperDim: 0, lowerThirdStyle: 'accent' };

/**
 * The account's brand library (files kept in Cloudflare R2) and brand kits (reusable looks). A brand is a
 * platform connection (a YouTube channel / Facebook Page); several can share one kit, and a kit can reuse the
 * same file as another. Paid plans only: Free keeps its logo and wallpaper in this browser.
 */
export function BrandPage() {
  const [lib, setLib] = useState<AssetLibrary | null>(null);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [l, conns] = await Promise.all([assetsApi.listAssets(), listConnections()]);
      setLib(l);
      setConnections(conns);
      setKits(l.quotaBytes > 0 ? await assetsApi.listBrandKits() : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load your brand library.');
    }
  }

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void reload();
  }, []);

  if (!lib) {
    return error ? <p className="error">{error}</p> : <BirdLoader loading compact label="Loading your brand library…" />;
  }

  if (!lib.enabled) {
    return (
      <div className="page brand-page">
        <h1>Brand</h1>
        <p className="notice">Brand storage is not enabled on this server yet.</p>
      </div>
    );
  }

  if (lib.quotaBytes <= 0) {
    return (
      <div className="page brand-page">
        <h1>Brand</h1>
        <p className="notice" data-testid="brand-free-notice">
          <Lock size={14} /> Saving your logo, wallpaper and brand kits in your account is on the paid plans. On the Free plan they stay saved in this
          browser, in the studio. <Link to="/billing">See plans</Link>
        </p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((lib.usedBytes / lib.quotaBytes) * 100));

  return (
    <div className="page brand-page">
      <h1>Brand</h1>
      <p>
        Keep your logos and wallpapers here once, then build <strong>brand kits</strong> from them. Give each YouTube channel or Facebook Page its own kit, or let
        several share one. A file can be used by more than one kit.
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      <section aria-labelledby="library-heading" className="panel brand-section">
        <h2 id="library-heading">Library</h2>
        <div className="brand-meter" role="img" aria-label={`${fmtMb(lib.usedBytes)} of ${fmtMb(lib.quotaBytes)} used`}>
          <div className="brand-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="field-hint" data-testid="brand-usage">{fmtMb(lib.usedBytes)} of {fmtMb(lib.quotaBytes)} used</p>
        <UploadForm onDone={reload} onError={setError} />
        {lib.items.length === 0 ? (
          <p className="empty-state">No files yet. Upload a logo or a wallpaper to start.</p>
        ) : (
          <ul className="brand-grid">
            {lib.items.map((a) => (
              <AssetCard key={a.id} asset={a} onChanged={reload} onError={setError} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="kits-heading" className="panel brand-section">
        <h2 id="kits-heading">Brand kits</h2>
        <p className="field-hint">The kit a channel or page uses is its look. A channel with no kit of its own uses the account default.</p>
        {kits.map((k) => (
          <KitEditor key={`${k.id}:${k.logoAssetId}:${k.wallpaperAssetId}:${k.connectionIds.join()}`} kit={k} assets={lib.items} connections={connections} onChanged={reload} onError={setError} />
        ))}
        <KitEditor key={`new-${kits.length}`} kit={null} assets={lib.items} connections={connections} onChanged={reload} onError={setError} />
      </section>
    </div>
  );
}

function UploadForm({ onDone, onError }: { onDone: () => Promise<void>; onError: (m: string | null) => void }) {
  const [kind, setKind] = useState<AssetKind>('logo');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    onError(null);
    try {
      await assetsApi.uploadAsset(file, kind, file.name.replace(/\.[^.]+$/, ''));
      if (fileRef.current) fileRef.current.value = '';
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="brand-upload" onSubmit={submit}>
      <label htmlFor="assetKind">Type</label>
      <select id="assetKind" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
        {(Object.keys(KIND_LABEL) as AssetKind[]).map((k) => (
          <option key={k} value={k}>{KIND_LABEL[k]}</option>
        ))}
      </select>
      <label htmlFor="assetFile">Image (PNG, JPG or WebP, up to 4 MB)</label>
      <input id="assetFile" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" required />
      <button type="submit" className="icon-btn" disabled={busy}>
        {busy ? <BirdBusy /> : <Upload size={16} />} Upload
      </button>
    </form>
  );
}

function AssetCard({ asset, onChanged, onError }: { asset: LibraryAsset; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [name, setName] = useState(asset.name);
  async function rename() {
    const next = name.trim();
    if (!next || next === asset.name) return setName(asset.name);
    try {
      await assetsApi.renameAsset(asset.id, next);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not rename the file.');
    }
  }
  async function remove() {
    if (!window.confirm(`Delete "${asset.name}"?`)) return;
    try {
      await assetsApi.deleteAsset(asset.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete the file.');
    }
  }
  return (
    <li className="brand-asset">
      <img src={assetsApi.assetFileUrl(asset.id)} alt={asset.name} loading="lazy" />
      <input aria-label={`Name of ${asset.name}`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onBlur={() => void rename()} />
      <span className="field-hint">
        {KIND_LABEL[asset.kind]} · {asset.width}×{asset.height} · {fmtMb(asset.sizeBytes)}
        {asset.usedBy.length > 0 && <> · used by {asset.usedBy.join(', ')}</>}
      </span>
      <button type="button" className="icon-btn icon-btn--small icon-btn--danger" aria-label={`Delete ${asset.name}`} onClick={() => void remove()}>
        <Trash2 size={14} />
      </button>
    </li>
  );
}

interface KitEditorProps {
  kit: BrandKit | null;
  assets: LibraryAsset[];
  connections: PlatformConnection[];
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}

/** One kit's form: also the "new kit" form when `kit` is null. */
function KitEditor({ kit, assets, connections, onChanged, onError }: KitEditorProps) {
  const [form, setForm] = useState<BrandKitInput>(kit ? { ...kit } : EMPTY_KIT);
  const [isDefault, setIsDefault] = useState(kit?.isDefault ?? false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(kit?.connectionIds ?? []));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BrandKitInput>(key: K, value: BrandKitInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const idPrefix = kit ? `kit-${kit.id}` : 'kit-new';

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const body: BrandKitInput = { ...form, name: form.name.trim() };
      const saved = kit
        ? await assetsApi.updateBrandKit(kit.id, { ...body, ...(isDefault && !kit.isDefault ? { isDefault: true } : {}) })
        : await assetsApi.createBrandKit({ ...body, ...(isDefault ? { isDefault: true } : {}) });
      const before = new Set(kit?.connectionIds ?? []);
      for (const id of chosen) if (!before.has(id)) await assetsApi.assignBrandKit(id, saved.id);
      for (const id of before) if (!chosen.has(id)) await assetsApi.assignBrandKit(id, null);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save the brand kit.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!kit || !window.confirm(`Delete the brand kit "${kit.name}"? Its channels go back to the account default.`)) return;
    try {
      await assetsApi.deleteBrandKit(kit.id);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete the brand kit.');
    }
  }

  const options = (kinds: AssetKind[]) => assets.filter((a) => kinds.includes(a.kind));
  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <form className="brand-kit" onSubmit={save} aria-label={kit ? `Brand kit ${kit.name}` : 'New brand kit'}>
      <h3>{kit ? kit.name : <><ImagePlus size={14} /> New brand kit</>}{kit?.isDefault && <span className="badge badge-accent"> Account default</span>}</h3>
      <label htmlFor={`${idPrefix}-name`}>Kit name</label>
      <input id={`${idPrefix}-name`} required maxLength={80} value={form.name} placeholder="e.g. Main channel" onChange={(e) => set('name', e.target.value)} />

      <label htmlFor={`${idPrefix}-logo`}>Logo</label>
      <select id={`${idPrefix}-logo`} value={form.logoAssetId ?? ''} onChange={(e) => set('logoAssetId', e.target.value || null)}>
        <option value="">None</option>
        {options(['logo', 'other']).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      <label id={`${idPrefix}-pos`}>Logo position</label>
      <div className="segmented" role="group" aria-labelledby={`${idPrefix}-pos`}>
        {(['left', 'right'] as const).map((p) => (
          <button key={p} type="button" className={form.logoPosition === p ? 'active' : ''} aria-pressed={form.logoPosition === p} onClick={() => set('logoPosition', p)}>
            {p === 'left' ? 'Top left' : 'Top right'}
          </button>
        ))}
      </div>

      <label htmlFor={`${idPrefix}-size`}>Logo size: {form.logoSize}px</label>
      <input id={`${idPrefix}-size`} type="range" min={16} max={600} value={form.logoSize} onChange={(e) => set('logoSize', parseInt(e.target.value, 10))} />

      <label htmlFor={`${idPrefix}-wall`}>Wallpaper</label>
      <select id={`${idPrefix}-wall`} value={form.wallpaperAssetId ?? ''} onChange={(e) => set('wallpaperAssetId', e.target.value || null)}>
        <option value="">None</option>
        {options(['wallpaper', 'background', 'other']).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>

      <label htmlFor={`${idPrefix}-dim`}>Darken wallpaper: {form.wallpaperDim}%</label>
      <input id={`${idPrefix}-dim`} type="range" min={0} max={80} value={form.wallpaperDim} onChange={(e) => set('wallpaperDim', parseInt(e.target.value, 10))} />

      <label htmlFor={`${idPrefix}-lt`}>Lower-third look</label>
      <select id={`${idPrefix}-lt`} value={form.lowerThirdStyle} onChange={(e) => set('lowerThirdStyle', e.target.value as LowerThirdStyleId)}>
        {(Object.keys(STYLE_LABEL) as LowerThirdStyleId[]).map((s) => <option key={s} value={s}>{STYLE_LABEL[s]}</option>)}
      </select>

      <fieldset className="brand-channels">
        <legend>Channels and pages using this kit</legend>
        {connections.length === 0 ? (
          <p className="field-hint">Connect a platform first (Connections).</p>
        ) : (
          connections.map((c) => (
            <label key={c.id} className="checkbox-row">
              <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} /> <PlatformBadge platform={c.platform} /> {c.label}
            </label>
          ))
        )}
      </fieldset>

      <label className="checkbox-row">
        <input type="checkbox" checked={isDefault} disabled={kit?.isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Use as the account default
      </label>

      <div className="studio-toolbar">
        <button type="submit" className="icon-btn" disabled={busy || !form.name.trim()}>
          {busy && <BirdBusy />} {kit ? 'Save kit' : 'Create kit'}
        </button>
        {kit && (
          <button type="button" className="icon-btn icon-btn--danger" onClick={() => void remove()}>
            <Trash2 size={14} /> Delete kit
          </button>
        )}
      </div>
    </form>
  );
}
