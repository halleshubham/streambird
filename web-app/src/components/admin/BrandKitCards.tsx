import { Badge, DataTable, Empty, fmtDate, humanize } from './adminKit';
import { Card } from '../ui';
import type { AdminAdSummary, AdminAssetSummary, AdminBrandKit, AdminKitSet, AdminWindowCheck } from '../../types/adminBrandKits';

const PLACEMENT: Record<AdminAdSummary['placement'], string> = {
  lower_third: 'Lower third',
  side_third: 'Left third',
  full_screen: 'Full screen',
  l_shape: 'L-shaped frame',
};

const kb = (n: number | null) => (n === null ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const dims = (a: AdminAssetSummary) => (a.width && a.height ? `${a.width}×${a.height}` : '—');
const mime = (a: AdminAssetSummary) => (a.mime ? a.mime.replace('image/', '').toUpperCase() : '—');
const pct = (n: number) => `${Math.round(n * 100)}%`;

function windowText(c: AdminWindowCheck | undefined): string {
  if (!c) return '';
  if (c.status === 'found') return `Window ${pct(c.w)} × ${pct(c.h)}`;
  if (c.status === 'none') return 'NO CLEAR WINDOW FOUND';
  return `Window not checked (${c.reason})`;
}

function schedule(a: AdminAdSummary): string {
  if (a.mode === 'continuous') return 'Always';
  return `Hidden first ${a.everySec ?? '?'} s, then shown ${a.showSec ?? '?'} s`;
}

function SetTable({ name, set, testId }: { name: string; set: AdminKitSet; testId: string }) {
  const rows: Array<{ key: string; label: string; asset: AdminAssetSummary; extra?: AdminAdSummary }> = [];
  if (set.logo) rows.push({ key: 'logo', label: 'Logo', asset: set.logo });
  if (set.wallpaper) rows.push({ key: 'wallpaper', label: 'Wallpaper', asset: set.wallpaper });
  for (const ad of set.ads) rows.push({ key: ad.placement, label: `Ad: ${PLACEMENT[ad.placement]}`, asset: ad, extra: ad });
  return (
    <div className="admin-kit-set" data-testid={testId}>
      <h4>{name}</h4>
      {rows.length === 0 ? (
        <Empty>Nothing in this set.</Empty>
      ) : (
        <DataTable caption={`${name} files`}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">File</th>
              <th scope="col" className="hide-sm">Type</th>
              <th scope="col" className="hide-sm">Size</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-row={r.key}>
                <td className="nowrap">{r.label}</td>
                <td>
                  <span className="admin-cell-main">{r.asset.missing ? '(file missing)' : r.asset.fileName}</span>
                </td>
                <td className="hide-sm">{mime(r.asset)}</td>
                <td className="nowrap hide-sm">{dims(r.asset)} · {kb(r.asset.sizeBytes)}</td>
                <td>
                  {r.extra ? (
                    <>
                      {!r.extra.enabled && <Badge tone="warning">Off</Badge>} {schedule(r.extra)}
                      {r.extra.placement === 'l_shape' && <span className="admin-cell-sub">{windowText(r.extra.windowCheck)}</span>}
                      <span className="admin-cell-sub show-sm">{dims(r.asset)} · {mime(r.asset)} · {kb(r.asset.sizeBytes)}</span>
                    </>
                  ) : (
                    <span className="admin-cell-sub show-sm">{dims(r.asset)} · {mime(r.asset)} · {kb(r.asset.sizeBytes)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}

/** One card per brand kit: where it applies, the diagnostics, text/clock settings and the landscape + portrait sets. Read-only. */
export function BrandKitCard({ kit }: { kit: AdminBrandKit }) {
  const clock = kit.clock;
  return (
    <Card className="admin-kit" aria-label={`Brand kit ${kit.name}`} data-testid="admin-kit-card">
      <div className="admin-card-head">
        <h3>
          {kit.name} {kit.isDefault && <Badge tone="info">Account default</Badge>}
        </h3>
        <span className="admin-hint">Updated {fmtDate(kit.updatedAt)}</span>
      </div>
      <ul className="admin-diag" data-testid="kit-diagnostics" aria-label="Diagnostics">
        {kit.diagnostics.map((d, i) => (
          <li key={i} className={d.level === 'warning' ? 'is-warning' : undefined} data-level={d.level}>
            {d.text}
          </li>
        ))}
      </ul>
      <dl className="admin-kit-facts">
        <div><dt>Channels</dt><dd>{kit.connections.length === 0 ? 'None' : kit.connections.map((c) => `${humanize(c.platform)}: ${c.displayName}`).join(', ')}</dd></div>
        <div><dt>Logo</dt><dd>{kit.logoPosition}, size {kit.logoSize}</dd></div>
        <div><dt>Shrink picture for ads</dt><dd>{kit.adsShrinkPicture ? 'On' : 'Off'}</dd></div>
        <div>
          <dt>Clock</dt>
          <dd>
            {clock.clockEnabled
              ? `${clock.clockPosition.replace('_', ' ')}, ${clock.clockFormat}, ${clock.clockSize}, ${clock.clockStyle}${clock.clockShowDate ? ', date' : ''}${clock.clockShowSeconds ? ', seconds' : ''}${clock.clockAlternate ? ', alternating' : ''}, ${clock.clockTimezone ?? 'viewer timezone'}`
              : 'Off'}
          </dd>
        </div>
        <div><dt>Default title</dt><dd>{kit.title ?? '—'}</dd></div>
        <div><dt>Default description</dt><dd>{kit.description ?? '—'}</dd></div>
        <div><dt>Thumbnail</dt><dd>{kit.thumbnail ? `${kit.thumbnail.fileName ?? '(missing)'} (${dims(kit.thumbnail)}, ${mime(kit.thumbnail)})` : '—'}</dd></div>
      </dl>
      <div className="admin-kit-sets">
        <SetTable name="Landscape set (16:9)" set={kit.landscape} testId="kit-set-landscape" />
        <SetTable name="Portrait set (9:16)" set={kit.portrait} testId="kit-set-portrait" />
      </div>
    </Card>
  );
}
