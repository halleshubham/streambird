import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Save } from 'lucide-react';
import { PlatformBadge } from './PlatformBadge';
import { BirdBusy } from './BirdBusy';
import { MAX_PRESET_NAME, QUALITY_ORDER, QUALITY_SHORT } from '../lib/presets';
import type { BrandKit, PlatformConnection, PresetConfig, Resolution } from '../types/api';

export interface PresetFormProps {
  connections: PlatformConnection[];
  kits: BrandKit[];
  /** Best quality the plan allows; higher ones are not offered. */
  maxResolution: Resolution;
  initialName?: string;
  initial?: PresetConfig;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  onSubmit: (name: string, config: PresetConfig) => void;
  onCancel: () => void;
}

/** The small inline form to make or edit a preset: name, destinations, brand kit, shape, quality, ticker. */
export function PresetForm({ connections, kits, maxResolution, initialName = '', initial, busy, error, submitLabel, onSubmit, onCancel }: PresetFormProps) {
  const uid = useId();
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial?.destinationIds?.length ? initial.destinationIds : connections.map((c) => c.id)));
  // '' = the usual look (the destination's or the account default kit), 'none' = no kit, otherwise a kit id.
  const [kit, setKit] = useState<string>(initial?.brandKitId === null ? 'none' : (initial?.brandKitId ?? ''));
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(initial?.orientation ?? 'landscape');
  const [quality, setQuality] = useState<Resolution>(initial?.quality && QUALITY_ORDER.indexOf(initial.quality) <= QUALITY_ORDER.indexOf(maxResolution) ? initial.quality : 'hd');
  const [tickerOn, setTickerOn] = useState(!!initial?.tickerEnabled);
  const [tickerText, setTickerText] = useState(initial?.tickerText ?? '');
  const [localError, setLocalError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setLocalError('Give the preset a name.');
    if (selected.size === 0) return setLocalError('Pick at least one destination.');
    setLocalError(null);
    const config: PresetConfig = {
      orientation,
      destinationIds: connections.filter((c) => selected.has(c.id)).map((c) => c.id),
      quality,
      tickerEnabled: tickerOn,
      ...(tickerOn && tickerText.trim() ? { tickerText: tickerText.trim() } : {}),
    };
    if (kit === 'none') config.brandKitId = null;
    else if (kit) config.brandKitId = kit;
    onSubmit(trimmed, config);
  }

  return (
    <form className="preset-form" onSubmit={submit} aria-label={initialName ? `Edit preset ${initialName}` : 'New preset'}>
      <label htmlFor={`${uid}-name`}>Preset name</label>
      <input id={`${uid}-name`} type="text" value={name} maxLength={MAX_PRESET_NAME} placeholder="Friday show" onChange={(e) => setName(e.target.value)} />

      <fieldset className="preset-fieldset">
        <legend>Destinations</legend>
        <div className="destination-checkboxes">
          {connections.map((c) => (
            <label key={c.id} className="destination-checkbox">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
              <PlatformBadge platform={c.platform} />
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="preset-form-grid">
        {kits.length > 0 && (
          <div>
            <label htmlFor={`${uid}-kit`}>Brand kit</label>
            <select id={`${uid}-kit`} value={kit} onChange={(e) => setKit(e.target.value)}>
              <option value="">Default look</option>
              <option value="none">No brand kit</option>
              {kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={`${uid}-shape`}>Shape</label>
          <select id={`${uid}-shape`} value={orientation} onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}>
            <option value="landscape">Landscape (16:9)</option>
            <option value="portrait">Vertical (9:16)</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-quality`}>Quality</label>
          <select id={`${uid}-quality`} value={quality} onChange={(e) => setQuality(e.target.value as Resolution)}>
            {QUALITY_ORDER.filter((q) => QUALITY_ORDER.indexOf(q) <= QUALITY_ORDER.indexOf(maxResolution)).map((q) => (
              <option key={q} value={q}>
                {QUALITY_SHORT[q]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="checkbox-row">
        <input type="checkbox" checked={tickerOn} onChange={(e) => setTickerOn(e.target.checked)} /> Show a news ticker
      </label>
      {tickerOn && (
        <input type="text" aria-label="Ticker text" value={tickerText} maxLength={200} placeholder="Text shown along the bottom" onChange={(e) => setTickerText(e.target.value)} />
      )}

      {(localError || error) && <p className="error">{localError ?? error}</p>}
      <div className="preset-form-actions">
        <button type="submit" className="icon-btn" disabled={busy}>
          {busy ? <BirdBusy /> : <Save size={16} />} {submitLabel}
        </button>
        <button type="button" className="link-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
