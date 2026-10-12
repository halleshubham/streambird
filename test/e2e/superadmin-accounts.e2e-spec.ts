import { describeE2E, bootApp, Client, Harness, ids } from './harness';

describeE2E('superadmin: companies directory search and paging', () => {
  let h: Harness;
  let admin: Client;
  const tag = ids('dir')('x');

  beforeAll(async () => {
    h = await bootApp();
    admin = (await h.signIn({ superadmin: true })).client;
  });
  afterAll(async () => {
    await h.close();
  });

  it('finds companies by (part of) the name, case-insensitively, with a matching total; wildcards are literal', async () => {
    const a = await h.signIn({ email: `${tag}_alpha@e2e.test` });
    await h.signIn({ email: `${tag}_beta@e2e.test` });

    const hit = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(tag.toUpperCase())}_ALPHA`);
    expect(hit.status).toBe(200);
    expect(hit.body.total).toBe(1);
    expect(hit.body.items.map((i: any) => i.id)).toEqual([a.accountId]);

    const both = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(tag)}`);
    expect(both.body.total).toBe(2);

    const none = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(`${tag}%`)}`);
    expect(none.body.total).toBe(0); // "%" is not a wildcard
    expect((await admin.get('/superadmin/accounts?q=zzz-no-such-company')).body.items).toEqual([]);
  });

  it('pages with limit and offset, and reports the same total on every page', async () => {
    const p1 = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(tag)}&limit=1&offset=0`);
    const p2 = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(tag)}&limit=1&offset=1`);
    expect(p1.body.items).toHaveLength(1);
    expect(p2.body.items).toHaveLength(1);
    expect(p1.body.total).toBe(2);
    expect(p2.body.total).toBe(2);
    expect(p1.body.items[0].id).not.toBe(p2.body.items[0].id);
  });

  it('also finds a company by the email of one of its users, and says which user matched', async () => {
    const { email, accountId } = await h.signIn({ email: `${tag}_member@e2e.test` });
    // The company is called something else entirely; only the user's email matches.
    await h.db.query(`UPDATE accounts SET name = $1 WHERE id = $2`, [`Acme ${tag}`, accountId]);

    const res = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(`${tag}_MEMBER@`)}`);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: accountId, name: `Acme ${tag}`, matchedUserEmail: email });

    // Matching the company's own name does not claim a user matched.
    const byName = await admin.get(`/superadmin/accounts?q=${encodeURIComponent(`Acme ${tag}`)}`);
    expect(byName.body.items[0].id).toBe(accountId);
    expect(byName.body.items[0].matchedUserEmail).toBeUndefined();
    // Without a search the field is never present.
    expect((await admin.get('/superadmin/accounts?limit=1')).body.items[0].matchedUserEmail).toBeUndefined();
  });

  it('without a search it lists everyone, as before', async () => {
    const all = await admin.get('/superadmin/accounts');
    expect(all.body.total).toBeGreaterThanOrEqual(3);
  });
});
