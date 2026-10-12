import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as superadminApi from '../../api/superadmin';
import { ApiError } from '../../api/client';
import { UsageBar } from '../../components/UsageMeter';
import { BirdLoader } from '../../components/BirdLoader';
import { BirdBusy } from '../../components/BirdBusy';
import { Badge, DataTable, Empty, PageHeader, ShowMore, fmtDate, planLabel } from '../../components/admin/adminKit';
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
      <PageHeader title="Companies" subtitle="Every account on StreamBird. Open one to change its plan, grant a day pass, or suspend it." />
      <div className="admin-toolbar">
        <input
          type="search"
          aria-label="Search companies"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {items && <span className="admin-toolbar-count">{total} {total === 1 ? 'account' : 'accounts'}</span>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {items === null ? (
        <BirdLoader loading compact label="Loading companies…" />
      ) : items.length === 0 ? (
        <Empty>{query ? `No companies match "${query}".` : 'No accounts yet.'}</Empty>
      ) : (
        <>
          <DataTable caption="Companies">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Plan</th>
                <th scope="col">Usage this period</th>
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
                  </td>
                  <td>{planLabel(a.planKey, plans)}</td>
                  <td>
                    <UsageBar compact used={Number(a.streamHourUsageCurrentPeriod)} included={Number(a.includedHoursPerMonth)} />
                  </td>
                  <td className="num hide-sm">{a.userCount}</td>
                  <td className="nowrap hide-sm">{fmtDate(a.createdAt)}</td>
                  <td>{a.suspendedAt ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {loadingMore ? <BirdBusy /> : <ShowMore shown={items.length} total={total} step={PAGE} onMore={() => void showMore()} />}
        </>
      )}
    </>
  );
}
