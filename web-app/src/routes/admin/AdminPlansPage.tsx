import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { BirdBusy } from '../../components/BirdBusy';
import { BirdLoader } from '../../components/BirdLoader';
import type { AdminPlan, PlanPayload, Resolution } from '../../types/api';

/** Form state: strings so inputs stay editable; converted by toPayload(). Blank = unlimited / none where allowed. */
interface PlanForm {
  key: string;
  name: string;
  kind: 'monthly' | 'day_pass';
  includedHours: string;
  unlimitedHours: boolean;
  graceMultiplier: string;
  maxDestinations: string;
  maxGuests: string;
  maxResolution: Resolution;
  maxSessionHours: string;
  validityHours: string;
  priceInr: string;
  priceUsd: string;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: string;
}

const EMPTY: PlanForm = {
  key: '', name: '', kind: 'monthly', includedHours: '10', unlimitedHours: false, graceMultiplier: '1',
  maxDestinations: '2', maxGuests: '4', maxResolution: 'hd', maxSessionHours: '', validityHours: '',
  priceInr: '', priceUsd: '', isPublic: true, isActive: true, sortOrder: '100',
};

function toForm(p: AdminPlan): PlanForm {
  return {
    key: p.key, name: p.name, kind: p.kind,
    includedHours: p.includedHoursPerMonth ?? '', unlimitedHours: p.includedHoursPerMonth === null,
    graceMultiplier: p.graceMultiplier, maxDestinations: String(p.maxDestinations), maxGuests: String(p.maxGuests),
    maxResolution: p.maxResolution, maxSessionHours: p.maxSessionHours ?? '',
    validityHours: p.validityHours === null ? '' : String(p.validityHours),
    priceInr: p.priceInr === null ? '' : String(p.priceInr), priceUsd: p.priceUsd ?? '',
    isPublic: p.isPublic, isActive: p.isActive, sortOrder: String(p.sortOrder),
  };
}

const numOrNull = (v: string): number | null => (v.trim() === '' ? null : Number(v));

function toPayload(f: PlanForm, creating: boolean): PlanPayload {
  const payload: PlanPayload = {
    name: f.name.trim(),
    kind: f.kind,
    includedHoursPerMonth: f.unlimitedHours ? null : numOrNull(f.includedHours) ?? 0,
    graceMultiplier: Number(f.graceMultiplier) || 1,
    maxDestinations: Number(f.maxDestinations),
    maxGuests: Number(f.maxGuests),
    maxResolution: f.maxResolution,
    maxSessionHours: numOrNull(f.maxSessionHours),
    validityHours: f.kind === 'day_pass' ? numOrNull(f.validityHours) : null,
    priceInr: numOrNull(f.priceInr),
    priceUsd: numOrNull(f.priceUsd),
    isPublic: f.isPublic,
    isActive: f.isActive,
    sortOrder: Number(f.sortOrder) || 0,
  };
  if (creating) payload.key = f.key.trim();
  return payload;
}

const hoursLabel = (p: AdminPlan) => (p.includedHoursPerMonth === null ? 'Unlimited' : `${Number(p.includedHoursPerMonth)} h`);

/** Every limit the app enforces lives in a plan row edited here; accounts are moved between plans (or given exceptions) on their own page. */
export function AdminPlansPage() {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    try {
      setPlans(await superadminApi.listPlans());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load plans.');
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function edit(p: AdminPlan) {
    setCreating(false);
    setSaved(null);
    setError(null);
    setForm(toForm(p));
  }

  function startCreate() {
    setCreating(true);
    setSaved(null);
    setError(null);
    setForm({ ...EMPTY });
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const payload = toPayload(form, creating);
      if (creating) await superadminApi.createPlan(payload);
      else await superadminApi.updatePlan(form.key, payload);
      setSaved(creating ? `Created ${form.name}.` : `Saved ${form.name}.`);
      setForm(null);
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save plan.');
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (!plans) return error ? <p className="error">{error}</p> : <BirdLoader loading compact />;

  return (
    <>
      <h1>Plans</h1>
      <p className="docs-hint">
        These limits are enforced everywhere: hours when a stream starts, destinations when it is created or scheduled, guests when
        they join the studio, and the session length while live. Editing a plan applies to every account on it immediately.
        Per-account exceptions are set on the company page.
      </p>
      {saved && <p className="status">{saved}</p>}
      {error && <p className="error">{error}</p>}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Plan</th><th>Type</th><th>Hours</th><th>Destinations</th><th>Guests</th><th>Quality</th><th>Session cap</th><th>₹ / $</th><th>Shown</th><th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.key} className={p.isActive ? undefined : 'row-muted'}>
                <td><strong>{p.name}</strong> <code>{p.key}</code></td>
                <td>{p.kind === 'day_pass' ? `Day pass (${p.validityHours ?? '?'} h)` : 'Monthly'}</td>
                <td>{hoursLabel(p)}</td>
                <td>{p.maxDestinations}</td>
                <td>{p.maxGuests}</td>
                <td>{p.maxResolution.toUpperCase()}</td>
                <td>{p.maxSessionHours === null ? '—' : `${Number(p.maxSessionHours)} h`}</td>
                <td>{p.priceInr ?? '—'} / {p.priceUsd ?? '—'}</td>
                <td>{p.isActive ? (p.isPublic ? 'Public' : 'Hidden') : 'Inactive'}</td>
                <td><button type="button" className="link-button" onClick={() => edit(p)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!form && (
        <p>
          <button type="button" onClick={startCreate}>New plan</button>
        </p>
      )}

      {form && (
        <form className="panel plan-form" onSubmit={(e) => void handleSave(e)}>
          <h2>{creating ? 'New plan' : `Edit ${form.name}`}</h2>
          <div className="plan-form-grid">
            <label>Key {creating ? '' : '(fixed)'}
              <input value={form.key} disabled={!creating} onChange={(e) => set('key', e.target.value)} placeholder="creator" required />
            </label>
            <label>Name
              <input value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </label>
            <label>Type
              <select value={form.kind} onChange={(e) => set('kind', e.target.value as 'monthly' | 'day_pass')}>
                <option value="monthly">Monthly plan</option>
                <option value="day_pass">Day pass (time-boxed)</option>
              </select>
            </label>
            <label>Included hours / month
              <input type="number" min="0" step="0.5" value={form.includedHours} disabled={form.unlimitedHours} onChange={(e) => set('includedHours', e.target.value)} />
              <span className="checkbox-row">
                <input type="checkbox" checked={form.unlimitedHours} onChange={(e) => set('unlimitedHours', e.target.checked)} /> Unlimited
              </span>
            </label>
            <label>Grace multiplier
              <input type="number" min="1" max="5" step="0.05" value={form.graceMultiplier} onChange={(e) => set('graceMultiplier', e.target.value)} />
            </label>
            <label>Max destinations
              <input type="number" min="1" max="50" value={form.maxDestinations} onChange={(e) => set('maxDestinations', e.target.value)} required />
            </label>
            <label>Max guests (at once)
              <input type="number" min="0" max="50" value={form.maxGuests} onChange={(e) => set('maxGuests', e.target.value)} required />
            </label>
            <label>Max quality
              <select value={form.maxResolution} onChange={(e) => set('maxResolution', e.target.value as Resolution)}>
                <option value="sd">SD (360p)</option>
                <option value="hd">HD (720p)</option>
                <option value="fhd">Full HD (1080p)</option>
              </select>
            </label>
            <label>Max session hours (blank = no cap)
              <input type="number" min="0.25" step="0.25" value={form.maxSessionHours} onChange={(e) => set('maxSessionHours', e.target.value)} />
            </label>
            {form.kind === 'day_pass' && (
              <label>Pass valid for (hours)
                <input type="number" min="1" value={form.validityHours} onChange={(e) => set('validityHours', e.target.value)} required />
              </label>
            )}
            <label>Price (₹)
              <input type="number" min="0" value={form.priceInr} onChange={(e) => set('priceInr', e.target.value)} />
            </label>
            <label>Price ($)
              <input type="number" min="0" step="0.01" value={form.priceUsd} onChange={(e) => set('priceUsd', e.target.value)} />
            </label>
            <label>Sort order
              <input type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </label>
          </div>
          <p>
            <label className="checkbox-row"><input type="checkbox" checked={form.isPublic} onChange={(e) => set('isPublic', e.target.checked)} /> Show on the public pricing page</label>
            <label className="checkbox-row"><input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active</label>
          </p>
          <button type="submit" disabled={saving}>{saving && <BirdBusy />} Save plan</button>{' '}
          <button type="button" className="link-button" onClick={() => { setForm(null); setCreating(false); }}>Cancel</button>
        </form>
      )}
    </>
  );
}
