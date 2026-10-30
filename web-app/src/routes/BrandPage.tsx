import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ImagePlus, Lock, Pencil, Plus, Trash2, UploadCloud, X } from 'lucide-react';
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

/** A single file's size: KB under 1 MB so a small logo does not read "0.0 MB". */
const fmtSize = (bytes: number) => (bytes < MB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : fmtMb(bytes));

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
  /** Which kit form is open: a kit id, 'new', or none. One at a time keeps the page short. */
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
          browser, in the studio. <Link to="/billing" className="chip-link chip-link--sm">See plans</Link>
        </p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((lib.usedBytes / lib.quotaBytes) * 100));
  const nearlyFull = pct >= 80;
  const connectionName = (id: string) => connections.find((c) => c.id === id)?.label ?? 'A channel';

  return (
    <div className="page brand-page">
      <h1>Brand</h1>
      <p>
        Keep your logos and wallpapers here once, then build <strong>brand kits</strong> from them. Give each YouTube channel or Facebook Page its own kit, or let
        several share one. A file can be used by more than one kit.
      </p>
      <div className="brand-feedback" aria-live="polite">
        {notice && (
          <p className="brand-notice" role="status">
            <CheckCircle2 size={16} /> {notice}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <section aria-labelledby="library-heading" className="panel brand-section">
        <h2 id="library-heading">Library</h2>
        <div className={`brand-meter${nearlyFull ? ' brand-meter--warn' : ''}`} role="img" aria-label={`${fmtMb(lib.usedBytes)} of ${fmtMb(lib.quotaBytes)} used`}>
          <div className="brand-meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="field-hint" data-testid="brand-usage">
          {fmtMb(lib.usedBytes)} of {fmtMb(lib.quotaBytes)} used{nearlyFull ? ' -- nearly full. Delete a file or upgrade your plan for more room.' : ''}
        </p>
        <UploadForm onDone={reload} onError={setError} onSaid={say} />
        {lib.items.length === 0 ? (
          <div className="brand-empty">
            <ImagePlus size={28} aria-hidden="true" />
            <p>
              <strong>No files yet.</strong> Start with your logo, then add a wallpaper if you use one. They are kept for every device you sign in on.
            </p>
          </div>
        ) : (
          <ul className="brand-grid">
            {lib.items.map((a) => (
              <AssetCard key={a.id} asset={a} onChanged={reload} onError={setError} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="kits-heading" className="panel brand-section">
        <div className="brand-section-head">
          <h2 id="kits-heading">Brand kits</h2>
          {editing !== 'new' && (
            <button type="button" className="icon-btn icon-btn--small" onClick={() => setEditing('new')}>
              <Plus size={14} /> New brand kit
            </button>
          )}
        </div>
        <p className="field-hint">The kit a channel or page uses is its look. A channel with no kit of its own uses the account default.</p>

        {kits.length === 0 && editing !== 'new' && (
          <div className="brand-empty">
            <ImagePlus size={28} aria-hidden="true" />
            <p>
              <strong>No brand kits yet.</strong> {lib.items.length === 0 ? 'Upload a logo first, then ' : ''}create a kit to give a channel its own look.
            </p>
          </div>
        )}

        <ul className="brand-kit-list">
          {kits.map((k) => (
            <li key={k.id} className="brand-kit-card">
              {editing === k.id ? (
                <KitEditor
                  kit={k}
                  assets={lib.items}
                  connections={connections}
                  onClose={() => setEditing(null)}
                  onChanged={reload}
                  onError={setError}
                  onSaid={(m) => {
                    say(m);
                    setEditing(null);
                  }}
                />
              ) : (
                <KitSummary kit={k} assets={lib.items} channelNames={k.connectionIds.map(connectionName)} onEdit={() => setEditing(k.id)} />
              )}
            </li>
          ))}
          {editing === 'new' && (
            <li className="brand-kit-card">
              <KitEditor
                kit={null}
                assets={lib.items}
                connections={connections}
                onClose={() => setEditing(null)}
                onChanged={reload}
                onError={setError}
                onSaid={(m) => {
                  say(m);
                  setEditing(null);
                }}
              />
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

/** A mini 16:9 picture of what a kit looks like: wallpaper, logo corner and size, and the lower-third style. */
function KitPreview({ kit, assets }: { kit: BrandKitInput; assets: LibraryAsset[] }) {
  const logo = assets.find((a) => a.id === kit.logoAssetId);
  const wall = assets.find((a) => a.id === kit.wallpaperAssetId);
  return (
    <div className="kit-preview" aria-hidden="true">
      {wall && <img className="kit-preview-wall" src={assetsApi.assetFileUrl(wall.id)} alt="" />}
      {wall && <div className="kit-preview-dim" style={{ opacity: kit.wallpaperDim / 100 }} />}
      {logo && (
        <img
          className={`kit-preview-logo kit-preview-logo--${kit.logoPosition}`}
          src={assetsApi.assetFileUrl(logo.id)}
          alt=""
          style={{ height: `${Math.max(6, (kit.logoSize / 720) * 100)}%` }}
        />
      )}
      <div className={`kit-preview-lt kit-preview-lt--${kit.lowerThirdStyle}`}>
        <b>Your name</b>
        <span>Title or topic</span>
      </div>
    </div>
  );
}

function KitSummary({ kit, assets, channelNames, onEdit }: { kit: BrandKit; assets: LibraryAsset[]; channelNames: string[]; onEdit: () => void }) {
  return (
    <div className="brand-kit-summary">
      <KitPreview kit={kit} assets={assets} />
      <div className="brand-kit-info">
        <h3>
          {kit.name}
          {kit.isDefault && <span className="badge badge-accent">Account default</span>}
        </h3>
        <p className="field-hint">
          {channelNames.length > 0 ? `Used by ${channelNames.join(', ')}` : kit.isDefault ? 'Used by every channel without a kit of its own' : 'Not used by any channel yet'}
        </p>
        <button type="button" className="icon-btn icon-btn--small" aria-label={`Edit ${kit.name}`} onClick={onEdit}>
          <Pencil size={14} /> Edit
        </button>
      </div>
    </div>
  );
}

function UploadForm({ onDone, onError, onSaid }: { onDone: () => Promise<void>; onError: (m: string | null) => void; onSaid: (m: string) => void }) {
  const [kind, setKind] = useState<AssetKind>('logo');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      // oxlint-disable-next-line react/set-state-in-effect
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(f: File | undefined) {
    onError(null);
    setFile(f ?? null);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && fileRef.current) {
      // Keep the real input in step, so the form and the browser's own file handling agree.
      const dt = new DataTransfer();
      dt.items.add(dropped);
      fileRef.current.files = dt.files;
      pick(dropped);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    onError(null);
    try {
      const name = file.name.replace(/\.[^.]+$/, '');
      await assetsApi.uploadAsset(file, kind, name);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onSaid(`Uploaded "${name}".`);
      await onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="brand-upload" onSubmit={submit}>
      <div className="brand-upload-row">
        <label htmlFor="assetKind">Type</label>
        <select id="assetKind" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
          {(Object.keys(KIND_LABEL) as AssetKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
      </div>
      <label
        className={`brand-drop${over ? ' brand-drop--over' : ''}${file ? ' brand-drop--has-file' : ''}`}
        htmlFor="assetFile"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {previewUrl ? <img src={previewUrl} alt="" className="brand-drop-preview" /> : <UploadCloud size={28} aria-hidden="true" />}
        <span className="brand-drop-text">
          {file ? (
            <>
              <strong>{file.name}</strong> <span className="field-hint">{fmtSize(file.size)}</span>
            </>
          ) : (
            <>
              <strong>Drop an image here</strong> or click to choose one
              <span className="field-hint"> (PNG, JPG, WebP or GIF (logos only), up to 4 MB)</span>
            </>
          )}
        </span>
        <input id="assetFile" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" required aria-label="Image (PNG, JPG, WebP or GIF (logos only), up to 4 MB)" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <div className="studio-toolbar">
        <button type="submit" className="icon-btn" disabled={busy || !file}>
          {busy ? <BirdBusy /> : <UploadCloud size={16} />} Upload
        </button>
        {file && !busy && (
          <button type="button" className="icon-btn icon-btn--small" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>
            <X size={14} /> Clear
          </button>
        )}
      </div>
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
        {KIND_LABEL[asset.kind]} · {asset.width}×{asset.height} · {fmtSize(asset.sizeBytes)}
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
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onSaid: (m: string) => void;
}

const sameSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));

/** One kit's form (also the "new kit" form when `kit` is null), with a live preview of the look being built. */
function KitEditor({ kit, assets, connections, onClose, onChanged, onError, onSaid }: KitEditorProps) {
  const initial: BrandKitInput = kit ? { ...kit } : EMPTY_KIT;
  const [form, setForm] = useState<BrandKitInput>(initial);
  const [isDefault, setIsDefault] = useState(kit?.isDefault ?? false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(kit?.connectionIds ?? []));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BrandKitInput>(key: K, value: BrandKitInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const idPrefix = kit ? `kit-${kit.id}` : 'kit-new';

  const dirty =
    !kit ||
    (Object.keys(EMPTY_KIT) as Array<keyof BrandKitInput>).some((k) => form[k] !== initial[k]) ||
    isDefault !== kit.isDefault ||
    !sameSet(chosen, kit.connectionIds);

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
      onSaid(kit ? `Saved "${body.name}".` : `Created "${body.name}".`);
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
      onSaid(`Deleted "${kit.name}".`);
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
    <form className="brand-kit brand-kit--editing" onSubmit={save} aria-label={kit ? `Brand kit ${kit.name}` : 'New brand kit'}>
      <div className="brand-section-head">
        <h3>{kit ? `Edit ${kit.name}` : 'New brand kit'}</h3>
        <button type="button" className="icon-btn icon-btn--small" aria-label="Close without saving" onClick={onClose}>
          <X size={14} /> Close
        </button>
      </div>

      <KitPreview kit={form} assets={assets} />
      <p className="field-hint">A preview of the look. The studio draws it at full size.</p>

      <label htmlFor={`${idPrefix}-name`}>Kit name</label>
      <input id={`${idPrefix}-name`} required maxLength={80} value={form.name} placeholder="e.g. Main channel" onChange={(e) => set('name', e.target.value)} />

      <label htmlFor={`${idPrefix}-logo`}>Logo</label>
      <select id={`${idPrefix}-logo`} value={form.logoAssetId ?? ''} onChange={(e) => set('logoAssetId', e.target.value || null)}>
        <option value="">None</option>
        {options(['logo', 'other']).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {options(['logo', 'other']).length === 0 && <p className="field-hint">Upload a logo in the library above to pick it here.</p>}

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
        {(Object.keys(STYLE_LABEL) as LowerThirdStyleId[]).map((st) => <option key={st} value={st}>{STYLE_LABEL[st]}</option>)}
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
      {kit?.isDefault && <p className="field-hint">To change the default, open the kit you want and tick this box there.</p>}

      <div className="studio-toolbar">
        <button type="submit" className="icon-btn" disabled={busy || !form.name.trim() || !dirty}>
          {busy && <BirdBusy />} {kit ? 'Save kit' : 'Create kit'}
        </button>
        {kit && (
          <button type="button" className="icon-btn icon-btn--danger" disabled={busy} onClick={() => void remove()}>
            <Trash2 size={14} /> Delete kit
          </button>
        )}
      </div>
    </form>
  );
}
