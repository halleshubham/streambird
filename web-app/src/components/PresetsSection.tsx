import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Plus, Radio, Save, Trash2 } from 'lucide-react';
import { createPreset, deletePreset, listPresets, startPreset, updatePreset } from '../api/presets';
import { createStream } from '../api/streams';
import { ApiError } from '../api/client';
import { PresetForm } from './PresetForm';
import { destinationList, presetOptionsLine } from '../lib/presets';
import { kitDefaultText } from '../lib/kitText';
import { seedStudioFromPreset } from '../studio/useHostStudio';
import type { BrandKit, EffectiveLimits, PlatformConnection, PresetConfig, StreamPreset } from '../types/api';
import { Badge, Button, confirm, toast } from './ui';

/** Same ceiling as the server (src/presets: MAX_PRESETS_PER_ACCOUNT). */
export const MAX_PRESETS = 20;

type Editing = { kind: 'new'; config?: PresetConfig } | { kind: 'edit'; id: string } | null;

/**
 * "Ready when you are": one card per saved preset with a big "Go live now", plus a card to make a new one. An account
 * without presets gets a single "Go live" card built from sensible defaults. "Go live now" creates the stream and opens
 * the studio with the camera on; the host still presses Go live in the studio to publish (same as the setup form).
 */
export function PresetsSection({
  connections,
  kits,
  limits,
  presets,
  onChange,
}: {
  connections: PlatformConnection[];
  kits: BrandKit[];
  limits: EffectiveLimits | null;
  presets: StreamPreset[];
  onChange: (next: StreamPreset[]) => void;
}) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maxResolution = limits?.maxResolution ?? 'hd';
  const fail = (e: unknown, fallback: string) => setError(e instanceof ApiError ? e.message : fallback);

  async function goLive(preset: StreamPreset) {
    setStarting(preset.id);
    setError(null);
    try {
      const started = await startPreset(preset.id);
      seedStudioFromPreset(started.id, started.preset.effectiveConfig);
      navigate(`/streams/${started.id}/studio`, { state: { autoCamera: true } });
    } catch (e) {
      fail(e, 'Could not start this stream.');
      setStarting(null);
    }
  }

  // No presets yet: a stream built from the defaults (every connected destination up to the plan's limit, default look, landscape).
  const defaultConfig: PresetConfig = {
    orientation: 'landscape',
    destinationIds: connections.slice(0, Math.max(1, limits?.maxDestinations ?? connections.length)).map((c) => c.id),
    quality: 'hd',
    tickerEnabled: false,
  };

  async function goLiveWithDefaults() {
    setStarting('default');
    setError(null);
    try {
      // The brand kit's default title is the server's to apply (a blank title takes it); 'Untitled stream' only when no kit has one.
      const hasKitTitle = !!kitDefaultText(defaultConfig.destinationIds ?? [], kits).title;
      const stream = await createStream({ ...(hasKitTitle ? {} : { title: 'Untitled stream' }), orientation: 'landscape', destinationConnectionIds: defaultConfig.destinationIds ?? [] });
      navigate(`/streams/${stream.id}/studio`, { state: { autoCamera: true, offerPreset: defaultConfig } });
    } catch (e) {
      fail(e, 'Could not start this stream.');
      setStarting(null);
    }
  }

  async function save(name: string, config: PresetConfig) {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.kind === 'new') {
        await createPreset(name, config);
      } else {
        await updatePreset(editing.id, { name, config });
      }
      onChange(await listPresets()); // the server's order (last used first) is the one to show
      setEditing(null);
      toast.success(`Preset "${name}" saved`);
    } catch (e) {
      fail(e, 'Could not save the preset.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(preset: StreamPreset) {
    const ok = await confirm({
      title: `Delete the preset "${preset.name}"?`,
      body: 'Its card disappears from your dashboard. Streams you already made from it are not affected.',
      confirmLabel: 'Delete preset',
      cancelLabel: 'Keep preset',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    try {
      await deletePreset(preset.id);
      onChange(presets.filter((p) => p.id !== preset.id));
      toast.success(`Preset "${preset.name}" deleted`);
    } catch (e) {
      fail(e, 'Could not delete the preset.');
    }
  }

  const form = (initialName: string | undefined, initial: PresetConfig | undefined, label: string) => (
    <div className="preset-card preset-card--form">
      <PresetForm
        connections={connections}
        kits={kits}
        maxResolution={maxResolution}
        initialName={initialName}
        initial={initial}
        busy={saving}
        error={error}
        submitLabel={label}
        onSubmit={(n, c) => void save(n, c)}
        onCancel={() => {
          setEditing(null);
          setError(null);
        }}
      />
    </div>
  );

  const busyAny = starting !== null;

  const chips = (config: PresetConfig) => (
    <div className="ha-chip-row">
      {destinationList(config.destinationIds, connections).map((n) => (
        <Badge key={n}>{n}</Badge>
      ))}
      {config.orientation === 'portrait' && <Badge>9:16</Badge>}
    </div>
  );

  return (
    <section className="presets ha-presets" aria-labelledby="presets-title">
      <div className="ha-section-head">
        <h2 id="presets-title">Ready when you are</h2>
      </div>
      <div className="preset-grid">
        {presets.length === 0 && editing?.kind !== 'new' && (
          <article className="preset-card preset-card--default preset-card--hero" aria-label="Go live">
            <h3 className="preset-name">Go live</h3>
            {chips(defaultConfig)}
            <p className="preset-summary">{presetOptionsLine(defaultConfig, kits)}</p>
            <Button className="preset-golive" size="lg" busy={starting === 'default'} disabled={busyAny} icon={<Radio size={18} aria-hidden="true" />} onClick={() => void goLiveWithDefaults()}>
              Go live now
            </Button>
            <div className="ha-preset-tools">
              <button type="button" className="ha-quiet" onClick={() => setEditing({ kind: 'new', config: defaultConfig })}>
                <Save size={14} aria-hidden="true" /> Save as preset
              </button>
            </div>
          </article>
        )}

        {presets.map((p, i) =>
          editing?.kind === 'edit' && editing.id === p.id ? (
            <div key={p.id} className="preset-card--wide">
              {form(p.name, p.config, 'Save changes')}
            </div>
          ) : (
            <article key={p.id} className={`preset-card${i === 0 ? ' preset-card--hero' : ''}`} aria-label={p.name}>
              <h3 className="preset-name">{p.name}</h3>
              {chips(p.config)}
              <p className="preset-summary">{presetOptionsLine(p.config, kits)}</p>
              <Button
                className="preset-golive"
                size="lg"
                aria-label={`Go live now with ${p.name}`}
                busy={starting === p.id}
                disabled={busyAny}
                icon={<Radio size={18} aria-hidden="true" />}
                onClick={() => void goLive(p)}
              >
                Go live now
              </Button>
              <div className="ha-preset-tools">
                <button type="button" className="ha-quiet" aria-label={`Edit preset ${p.name}`} onClick={() => setEditing({ kind: 'edit', id: p.id })}>
                  <Pencil size={14} aria-hidden="true" /> Edit
                </button>
                <button type="button" className="ha-quiet ha-quiet--danger" aria-label={`Delete preset ${p.name}`} onClick={() => void remove(p)}>
                  <Trash2 size={14} aria-hidden="true" /> Delete
                </button>
              </div>
            </article>
          ),
        )}

        {editing?.kind === 'new' ? (
          <div className="preset-card--wide">{form(undefined, editing.config, 'Save preset')}</div>
        ) : (
          presets.length < MAX_PRESETS && (
            <button type="button" className="preset-card preset-card--new" onClick={() => setEditing({ kind: 'new' })}>
              <Plus size={28} aria-hidden="true" />
              <span>New preset</span>
              <small>Save title, destinations and look</small>
            </button>
          )
        )}
      </div>
      {error && editing === null && (
        <p className="ha-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}
    </section>
  );
}
