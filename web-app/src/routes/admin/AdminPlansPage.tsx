import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { BirdLoader } from '../../components/BirdLoader';
import { Badge, DataTable, Notice, PageHeader, RESOLUTION_LABEL } from '../../components/admin/adminKit';
import { Button, Card, Drawer, Input, SelectField, confirm, toast } from '../../components/ui';
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
  canRecord: boolean;
  canChromaKey: boolean;
  canLowerThird: boolean;
  assetStorageMb: string;
  watermark: boolean;
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
  maxDestinations: '2', maxGuests: '4', maxResolution: 'hd', canRecord: false, canChromaKey: false, canLowerThird: false, assetStorageMb: '0', watermark: false, maxSessionHours: '', validityHours: '',
  priceInr: '', priceUsd: '', isPublic: true, isActive: true, sortOrder: '100',
};

function toForm(p: AdminPlan): PlanForm {
  return {
    key: p.key, name: p.name, kind: p.kind,
    includedHours: p.includedHoursPerMonth ?? '', unlimitedHours: p.includedHoursPerMonth === null,
    graceMultiplier: p.graceMultiplier, maxDestinations: String(p.maxDestinations), maxGuests: String(p.maxGuests),
    maxResolution: p.maxResolution, canRecord: p.canRecord, canChromaKey: p.canChromaKey, canLowerThird: p.canLowerThird, assetStorageMb: String(p.assetStorageMb), watermark: p.watermark, maxSessionHours: p.maxSessionHours ?? '',
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
    canRecord: f.canRecord,
    canChromaKey: f.canChromaKey,
    canLowerThird: f.canLowerThird,
    assetStorageMb: Math.max(0, Math.floor(Number(f.assetStorageMb) || 0)),
    watermark: f.watermark,
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
const yesNo = (v: boolean) => (v ? <span className="admin-yes">Yes</span> : <span className="admin-no">No</span>);
const money = (inr: number | string | null, usd: number | string | null) => `${inr === null ? '—' : `₹${Number(inr).toLocaleString('en-IN')}`} / ${usd === null ? '—' : `$${Number(usd)}`}`;

/** Every limit the app enforces lives in a plan row edited here; accounts are moved between plans (or given exceptions) on their own page. */
export function AdminPlansPage() {
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [creating, setCreating] = useState(false);
  const [wasActive, setWasActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
    setWasActive(p.isActive);
    setFormError(null);
    setForm(toForm(p));
  }

  function startCreate() {
    setCreating(true);
    setWasActive(false);
    setFormError(null);
    setForm({ ...EMPTY });
  }

  function close() {
    setForm(null);
    setCreating(false);
    setFormError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    // Switching a live plan to inactive takes it off the pricing page and out of the account plan list: say so first.
    if (!creating && wasActive && !form.isActive) {
      const ok = await confirm({
        title: `Disable ${form.name}?`,
        body: 'It is hidden from the pricing page and can no longer be chosen for an account. Accounts that are already on it keep it, and you can switch it back on at any time.',
        confirmLabel: 'Disable plan',
        cancelLabel: 'Keep active',
      });
      if (!ok) return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = toPayload(form, creating);
      if (creating) await superadminApi.createPlan(payload);
      else await superadminApi.updatePlan(form.key, payload);
      toast.success(creating ? `Created ${form.name}.` : `Saved ${form.name}.`);
      close();
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save plan.');
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  if (!plans) return error ? <Notice tone="error">{error}</Notice> : <BirdLoader loading compact />;

  const publicCount = plans.filter((p) => p.isActive && p.isPublic).length;

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle={`${plans.length} plans, ${publicCount} on the pricing page. These limits are enforced everywhere: hours when a stream starts, destinations when it is created or scheduled, guests when they join, and the session length while live. Editing a plan applies to every account on it immediately; per-account exceptions are set on the company page.`}
        actions={<Button onClick={startCreate}>New plan</Button>}
      />
      {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}

      <Card className="admin-section">
        <DataTable caption="Plans">
          <thead>
            <tr>
              <th scope="col">Plan</th>
              <th scope="col">Type</th>
              <th scope="col">Hours</th>
              <th scope="col" className="num">Destinations</th>
              <th scope="col" className="num">Guests</th>
              <th scope="col">Quality</th>
              <th scope="col">Recording</th>
              <th scope="col">Background removal</th>
              <th scope="col">Lower thirds</th>
              <th scope="col" className="num">Brand storage</th>
              <th scope="col">Watermark</th>
              <th scope="col">Session cap</th>
              <th scope="col">₹ / $</th>
              <th scope="col">Visibility</th>
              <th scope="col"><span className="ui-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.key} className={p.isActive ? undefined : 'row-muted'}>
                <td><span className="admin-cell-main">{p.name}</span><span className="admin-cell-sub"><code>{p.key}</code></span></td>
                <td>{p.kind === 'day_pass' ? <Badge tone="info">{`Day pass (${p.validityHours ?? '?'} h)`}</Badge> : 'Monthly'}</td>
                <td>{hoursLabel(p)}</td>
                <td className="num">{p.maxDestinations}</td>
                <td className="num">{p.maxGuests}</td>
                <td className="nowrap">{RESOLUTION_LABEL[p.maxResolution]}</td>
                <td>{yesNo(p.canRecord)}</td>
                <td>{yesNo(p.canChromaKey)}</td>
                <td>{yesNo(p.canLowerThird)}</td>
                <td className="num">{p.assetStorageMb > 0 ? `${p.assetStorageMb} MB` : '—'}</td>
                <td>{p.watermark ? <Badge tone="warning">Shown</Badge> : <span className="admin-no">No</span>}</td>
                <td>{p.maxSessionHours === null ? '—' : `${Number(p.maxSessionHours)} h`}</td>
                <td className="nowrap">{money(p.priceInr, p.priceUsd)}</td>
                <td>{!p.isActive ? <Badge>Inactive</Badge> : p.isPublic ? <Badge tone="success">Public</Badge> : <Badge tone="warning">Hidden</Badge>}</td>
                <td className="actions">
                  <Button variant="secondary" size="sm" aria-label={`Edit ${p.name}`} onClick={() => edit(p)}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>

      <Drawer
        open={form !== null}
        onClose={close}
        title={creating ? 'New plan' : `Edit plan: ${form?.name ?? ''}`}
        className="admin-plan-drawer"
        testId="plan-drawer"
      >
        {form && (
          <form className="admin-drawer-form" onSubmit={(e) => void handleSave(e)} id="plan-form">
            {formError && <Notice tone="error">{formError}</Notice>}
            <div className="admin-drawer-grid">
              <Input label={creating ? 'Key' : 'Key (fixed)'} hint={creating ? 'Lowercase letters, cannot change later' : undefined} value={form.key} disabled={!creating} onChange={(e) => set('key', e.target.value)} placeholder="creator" required />
              <Input label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <SelectField label="Type" value={form.kind} onChange={(e) => set('kind', e.target.value as 'monthly' | 'day_pass')}>
              <option value="monthly">Monthly plan</option>
              <option value="day_pass">Day pass (time-boxed)</option>
            </SelectField>

            <div className="admin-drawer-section">LIMITS</div>
            <div className="admin-drawer-grid">
              <div>
                <Input label="Included hours / month" type="number" min="0" step="0.5" value={form.includedHours} disabled={form.unlimitedHours} onChange={(e) => set('includedHours', e.target.value)} fieldClassName="admin-field-tight" />
                <label className="admin-check">
                  <input type="checkbox" checked={form.unlimitedHours} onChange={(e) => set('unlimitedHours', e.target.checked)} /> Unlimited
                </label>
              </div>
              <Input label="Grace multiplier" hint="Soft cap before blocking" type="number" min="1" max="5" step="0.05" value={form.graceMultiplier} onChange={(e) => set('graceMultiplier', e.target.value)} />
              <Input label="Max destinations" type="number" min="1" max="50" value={form.maxDestinations} onChange={(e) => set('maxDestinations', e.target.value)} required />
              <Input label="Max guests (at once)" type="number" min="0" max="50" value={form.maxGuests} onChange={(e) => set('maxGuests', e.target.value)} required />
              <SelectField label="Max quality" value={form.maxResolution} onChange={(e) => set('maxResolution', e.target.value as Resolution)}>
                <option value="sd">SD (360p)</option>
                <option value="hd">HD (720p)</option>
                <option value="fhd">Full HD (1080p)</option>
                <option value="qhd">2K (1440p)</option>
              </SelectField>
              <Input label="Max session hours (blank = no cap)" type="number" min="0.25" step="0.25" value={form.maxSessionHours} onChange={(e) => set('maxSessionHours', e.target.value)} />
              {form.kind === 'day_pass' && (
                <Input label="Pass valid for (hours)" type="number" min="1" value={form.validityHours} onChange={(e) => set('validityHours', e.target.value)} required />
              )}
              <Input label="Brand storage (MB, 0 = browser-only)" type="number" min="0" step="1" value={form.assetStorageMb} onChange={(e) => set('assetStorageMb', e.target.value)} />
            </div>

            <div className="admin-drawer-section">PRICE</div>
            <div className="admin-drawer-grid">
              <Input label="Price (₹)" type="number" min="0" value={form.priceInr} onChange={(e) => set('priceInr', e.target.value)} />
              <Input label="Price ($)" type="number" min="0" step="0.01" value={form.priceUsd} onChange={(e) => set('priceUsd', e.target.value)} />
              <Input label="Sort order" type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </div>

            <div className="admin-drawer-section">FEATURES</div>
            <div className="admin-drawer-checks">
              <label className="admin-check"><input type="checkbox" checked={form.isPublic} onChange={(e) => set('isPublic', e.target.checked)} /> Show on the public pricing page</label>
              <label className="admin-check"><input type="checkbox" checked={form.canRecord} onChange={(e) => set('canRecord', e.target.checked)} /> Can record the stream to their own computer</label>
              <label className="admin-check"><input type="checkbox" checked={form.canChromaKey} onChange={(e) => set('canChromaKey', e.target.checked)} /> Can remove the background behind people (green screen or any-background cut-out)</label>
              <label className="admin-check"><input type="checkbox" checked={form.canLowerThird} onChange={(e) => set('canLowerThird', e.target.checked)} /> Can show animated lower-third banners (title, name or text over the picture)</label>
              <label className="admin-check"><input type="checkbox" checked={form.watermark} onChange={(e) => set('watermark', e.target.checked)} /> Show the "Powered by StreamBird" mark on streams (a day pass removes it)</label>
              <label className="admin-check"><input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Active</label>
            </div>
            <div className="admin-drawer-foot">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button type="submit" busy={saving}>Save plan</Button>
            </div>
          </form>
        )}
      </Drawer>
    </>
  );
}
