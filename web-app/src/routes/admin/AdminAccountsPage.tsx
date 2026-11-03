import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import { Badge, DataTable, Empty, Notice, PageHeader, ShowMore, fmtDate, planLabel } from '../../components/admin/adminKit';
import { Button, Card, Spinner } from '../../components/ui';
import type { AccountSummary, AdminPlan } from '../../types/api';

const PAGE = 50;
const SEARCH_DEBOUNCE_MS = 300;

/** Directory of every account (company or solo user): search, plan, usage and status at a glance; a row opens the company page. */
export function AdminAccountsPage() {
  const [items, setItems] = useState<AccountSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    superadminApi.listPlans().then(setPlans).catch(() => {});
  }, []);

  // Search on the server (the list is paged), debounced; the newest request wins.
  useEffect(() => {
    const ticket = ++latest.current;
    const handle = setTimeout(
      () => {
        superadminApi
          .listAccounts(PAGE, 0, query.trim())
          .then((res) => {
            if (ticket !== latest.current) return;
            setItems(res.items);
            setTotal(res.total);
            setError(null);
          })
          .catch((err) => {
            if (ticket === latest.current) setError(err instanceof ApiError ? err.message : 'Failed to load companies.');
          });
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(handle);
  }, [query]);

  async function showMore() {
    if (!items) return;
    setLoadingMore(true);
    try {
      const res = await superadminApi.listAccounts(PAGE, items.length, query.trim());
      setItems((cur) => [...(cur ?? []), ...res.items]);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load more.');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <PageHeader title="Companies" subtitle="Every account on StreamBird. Search by company, name or any user's email; open one to change its plan, grant a day pass or suspend it." />
      <div className="admin-toolbar">
        <input
          type="search"
          className="ui-input"
          aria-label="Search companies"
          placeholder="Search by company or user email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
            Clear
          </Button>
        )}
        {items && <span className="admin-toolbar-count">{total} {total === 1 ? 'account' : 'accounts'}</span>}
      </div>
      {error && <Notice tone="error" onDismiss={() => setError(null)}>{error}</Notice>}
      {items === null ? (
        <BirdLoader loading compact label="Loading companies…" />
      ) : items.length === 0 ? (
        <Empty>{query ? `No companies match "${query}".` : 'No accounts yet.'}</Empty>
      ) : (
        <Card className="admin-section">
          <DataTable caption="Companies" cards>
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col" className="hide-sm">Plan</th>
                <th scope="col" className="admin-card-grow">Usage this period</th>
                <th scope="col" className="num hide-sm">Users</th>
                <th scope="col" className="hide-sm">Joined</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/admin/accounts/${a.id}`} className="admin-link">{a.companyName ?? a.name}</Link>
                    {a.companyName && a.companyName !== a.name && <span className="admin-cell-sub">{a.name}</span>}
                    {a.matchedUserEmail && <span className="admin-cell-sub">User: {a.matchedUserEmail}</span>}
                    <span className="admin-cell-sub show-sm">{planLabel(a.planKey, plans)} · {a.userCount} {a.userCount === 1 ? 'user' : 'users'} · Joined {fmtDate(a.createdAt)}</span>
                  </td>
                  <td className="hide-sm">{planLabel(a.planKey, plans)}</td>
                  <td className="admin-card-grow">
                    <UsageBar compact used={Number(a.streamHourUsageCurrentPeriod)} included={Number(a.includedHoursPerMonth)} />
                  </td>
                  <td className="num hide-sm">{a.userCount}</td>
                  <td className="nowrap hide-sm">{fmtDate(a.createdAt)}</td>
                  <td>{a.suspendedAt ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {loadingMore ? <p className="admin-showmore"><Spinner size="sm" /></p> : <ShowMore shown={items.length} total={total} step={PAGE} onMore={() => void showMore()} />}
        </Card>
      )}
    </>
  );
}
