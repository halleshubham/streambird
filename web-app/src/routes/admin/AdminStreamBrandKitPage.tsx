import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { BirdLoader } from '../../components/BirdLoader';
import { Badge, DataTable, Empty, Notice, PageHeader, Section, humanize, statusTone } from '../../components/admin/adminKit';
import { BrandKitCard } from '../../components/admin/BrandKitCards';
import { StreamLookup } from '../../components/admin/StreamLookup';
import type { AdminStreamBrandKit } from '../../types/adminBrandKits';

/** Which brand kit(s) a stream's destinations resolve to (channel kit, else the account default), read-only, for support. */
export function AdminStreamBrandKitPage() {
  const { streamId } = useParams<{ streamId: string }>();
  const [data, setData] = useState<AdminStreamBrandKit | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!streamId) return;
    let live = true;
    // Fetching on mount/param change -- an async network call.
    // oxlint-disable-next-line react/set-state-in-effect
    setData(null);
    setError(null);
    superadminApi
      .getStreamBrandKit(streamId)
      .then((d) => live && setData(d))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Failed to load the stream.'));
    return () => {
      live = false;
    };
  }, [streamId]);

  return (
    <>
      <PageHeader back={{ to: '/admin', label: 'Admin' }} title="Stream brand kit" subtitle="What look this stream gets: each destination's kit, else the account default kit." />
      <Section>
        <StreamLookup />
      </Section>
      {error && <Notice tone="error">{error}</Notice>}
      {!error && data === null && <BirdLoader loading compact label="Loading stream…" />}
      {data && (
        <div data-testid="stream-brand-kit">
          <Section title={data.stream.title}>
            <p className="admin-hint">
              <Badge tone={data.stream.status === 'live' ? 'danger' : statusTone(data.stream.status)}>{data.stream.status}</Badge>{' '}
              <Badge tone="info">{data.stream.orientation === 'portrait' ? 'Vertical 9:16' : 'Landscape 16:9'}</Badge> · Account{' '}
              <Link to={`/admin/accounts/${data.account.id}`} className="admin-link">{data.account.name}</Link> · Plan {data.plan.name}
              {data.plan.poweredByMark && <> <Badge tone="warning">Powered-by mark</Badge></>}
            </p>
            <ul className="admin-diag" data-testid="stream-diagnostics" aria-label="Diagnostics">
              {data.diagnostics.map((d, i) => (
                <li key={i} className={d.level === 'warning' ? 'is-warning' : undefined} data-level={d.level}>{d.text}</li>
              ))}
            </ul>
          </Section>
          <Section title="Destinations">
            {data.destinations.length === 0 ? (
              <Empty>This stream has no destinations.</Empty>
            ) : (
              <DataTable caption="Destinations and the kit each resolves to">
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col">Status</th>
                    <th scope="col">Kit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.destinations.map((d) => (
                    <tr key={d.destinationId}>
                      <td>{d.platform ? humanize(d.platform) : '—'}: {d.displayName ?? '—'}</td>
                      <td><Badge tone={statusTone(d.status)}>{d.status}</Badge></td>
                      <td>{d.kitName ? `${d.kitName} (${d.kitSource === 'channel' ? 'channel kit' : 'account default'})` : 'No kit'}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </Section>
          {data.kits.map((k) => (
            <BrandKitCard key={k.id} kit={k} />
          ))}
        </div>
      )}
    </>
  );
}
