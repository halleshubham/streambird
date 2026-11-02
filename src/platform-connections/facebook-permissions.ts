/** What `GET /me/permissions` returns: one row per permission the user was asked for. */
export interface FacebookPermissionsResponse {
  data?: Array<{ permission?: string; status?: string }>;
}

export interface FacebookPermissionSummary {
  granted: string[];
  declined: string[];
  /** Any other status (e.g. "expired"), as "name:status". */
  other: string[];
}

/** Splits Facebook's permission rows into granted / declined / other names. Never includes tokens (it only sees names). */
export function summarizeFacebookPermissions(body: unknown): FacebookPermissionSummary {
  const out: FacebookPermissionSummary = { granted: [], declined: [], other: [] };
  const rows = (body as FacebookPermissionsResponse | null | undefined)?.data;
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    if (!row || typeof row.permission !== 'string') continue;
    if (row.status === 'granted') out.granted.push(row.permission);
    else if (row.status === 'declined') out.declined.push(row.permission);
    else out.other.push(`${row.permission}:${String(row.status)}`);
  }
  return out;
}

/** One log line for "the account manages no Pages": which permissions were granted or declined. */
export function describeFacebookPermissions(summary: FacebookPermissionSummary): string {
  const list = (names: string[]) => (names.length > 0 ? names.join(', ') : 'none');
  const other = summary.other.length > 0 ? `; other: ${summary.other.join(', ')}` : '';
  return `granted: ${list(summary.granted)}; declined: ${list(summary.declined)}${other}`;
}
