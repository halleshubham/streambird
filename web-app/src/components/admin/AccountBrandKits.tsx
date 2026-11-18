import { useState } from 'react';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { BirdLoader } from '../BirdLoader';
import { Badge, Empty, Notice, Section } from './adminKit';
import { Button } from '../ui';
import { BrandKitCard } from './BrandKitCards';
import type { AdminAccountBrandKits } from '../../types/adminBrandKits';

/** "Brand kits" section of the admin account page: loaded only when opened (each open is audited on the server), read-only. */
export function AccountBrandKits({ accountId }: { accountId: string }) {
  const [data, setData] = useState<AdminAccountBrandKits | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setError(null);
    try {
      setData(await superadminApi.getAccountBrandKits(accountId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load brand kits.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-testid="admin-brand-kits">
      <Section title="Brand kits" hint="Read-only view for support: which kit a channel uses, its ads and what looks wrong. Opening it is recorded in the audit log.">
        {data === null && !loading && (
          <Button variant="secondary" onClick={() => void open()}>
            Show brand kits
          </Button>
        )}
        {loading && <BirdLoader loading compact label="Loading brand kits…" />}
        {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
        {error && data === null && !loading && (
          <Button variant="secondary" size="sm" onClick={() => void open()}>
            Try again
          </Button>
        )}
        {data && (
          <>
            <p className="admin-hint" data-testid="brand-plan">
              Plan {data.plan.name}: {data.plan.poweredByMark ? <Badge tone="warning">Carries the Powered-by mark (no kits or own ads)</Badge> : <Badge tone="success">No Powered-by mark</Badge>}
            </p>
            {data.kits.length === 0 ? <Empty>This account has no brand kits.</Empty> : data.kits.map((k) => <BrandKitCard key={k.id} kit={k} />)}
          </>
        )}
      </Section>
    </div>
  );
}
