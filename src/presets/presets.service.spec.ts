import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PresetsService, MAX_PRESETS_PER_ACCOUNT, cleanConfig, clampQuality } from './presets.service';
import { StreamPreset } from './entities/stream-preset.entity';

const A = 'acct-a';
const B = 'acct-b';
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const KIT = '33333333-3333-4333-8333-333333333333';

function build(opts: { limits?: Partial<{ maxResolution: string; assetStorageMb: number }>; conns?: Record<string, string[]>; kits?: Record<string, string[]> } = {}) {
  const rows: StreamPreset[] = [];
  let n = 0;
  const presets = {
    count: jest.fn(async ({ where }: any) => rows.filter((r) => r.accountId === where.accountId).length),
    create: (x: Partial<StreamPreset>) => ({ lastUsedAt: null, config: {}, ...x }) as StreamPreset,
    save: jest.fn(async (x: StreamPreset) => {
      if (!x.id) {
        x.id = `p${++n}`;
        rows.push(x);
      }
      return x;
    }),
    findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id && r.accountId === where.accountId) ?? null),
    delete: jest.fn(async ({ id, accountId }: any) => {
      const i = rows.findIndex((r) => r.id === id && r.accountId === accountId);
      if (i >= 0) rows.splice(i, 1);
    }),
  };
  const conns = opts.conns ?? { [A]: [C1, C2], [B]: [] };
  const connections = {
    // In() is a FindOperator: read its value.
    count: jest.fn(async ({ where }: any) => (where.id.value as string[]).filter((id) => (conns[where.accountId] ?? []).includes(id)).length),
    find: jest.fn(async ({ where }: any) => (conns[where.accountId] ?? []).map((id) => ({ id }))),
  };
  const kitMap = opts.kits ?? { [A]: [KIT] };
  const kits = { count: jest.fn(async ({ where }: any) => ((kitMap[where.accountId] ?? []).includes(where.id) ? 1 : 0)) };
  const accounts = { getLimits: jest.fn(async () => ({ maxResolution: 'hd', assetStorageMb: 100, ...opts.limits })) };
  const streams = { create: jest.fn(async (_acct: string, dto: any) => ({ id: 's1', ...dto })) };
  const svc = new PresetsService(presets as any, connections as any, kits as any, accounts as any, streams as any);
  return { svc, rows, streams, accounts };
}

describe('cleanConfig', () => {
  it('keeps only the chosen keys and removes duplicate destinations', () => {
    expect(cleanConfig({ orientation: 'portrait', destinationIds: [C1, C1], brandKitId: null, tickerEnabled: false } as any)).toEqual({
      orientation: 'portrait',
      destinationIds: [C1],
      brandKitId: null,
      tickerEnabled: false,
    });
    expect(cleanConfig({} as any)).toEqual({});
  });
});

describe('clampQuality', () => {
  it('lowers a quality above the plan and leaves others alone', () => {
    expect(clampQuality('qhd', 'hd')).toEqual({ quality: 'hd', lowered: true });
    expect(clampQuality('sd', 'hd')).toEqual({ quality: 'sd', lowered: false });
    expect(clampQuality('fhd', 'fhd')).toEqual({ quality: 'fhd', lowered: false });
  });
});

describe('PresetsService', () => {
  it('stores a preset and trims the name', async () => {
    const { svc } = build();
    const p = await svc.create(A, { name: '  Friday show ', config: { destinationIds: [C1], brandKitId: KIT } as any });
    expect(p).toMatchObject({ name: 'Friday show', lastUsedAt: null, config: { destinationIds: [C1], brandKitId: KIT } });
  });

  it('refuses destinations or a kit of another account', async () => {
    const { svc } = build();
    await expect(svc.create(B, { name: 'x', config: { destinationIds: [C1] } as any })).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(svc.create(B, { name: 'x', config: { brandKitId: KIT } as any })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('caps presets per account but not across accounts', async () => {
    const { svc } = build();
    for (let i = 0; i < MAX_PRESETS_PER_ACCOUNT; i++) await svc.create(A, { name: `p${i}`, config: {} as any });
    await expect(svc.create(A, { name: 'one more', config: {} as any })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.create(B, { name: 'mine', config: {} as any })).resolves.toBeDefined();
  });

  it('another account gets 404 on update, delete, use and start', async () => {
    const { svc } = build();
    const p = await svc.create(A, { name: 'x', config: {} as any });
    await expect(svc.update(B, p.id, { name: 'y' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove(B, p.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.use(B, p.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.start(B, p.id, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update replaces the whole config and re-checks ownership', async () => {
    const { svc } = build();
    const p = await svc.create(A, { name: 'x', config: { quality: 'hd', tickerEnabled: true } as any });
    const u = await svc.update(A, p.id, { config: { orientation: 'portrait' } as any });
    expect(u.config).toEqual({ orientation: 'portrait' });
    await expect(svc.update(A, p.id, { config: { destinationIds: [KIT] } as any })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('use stamps lastUsedAt and re-checks quality against the plan at use time', async () => {
    const { svc, accounts } = build({ limits: { maxResolution: 'qhd' } });
    const p = await svc.create(A, { name: 'x', config: { quality: 'qhd' } as any });
    expect((await svc.use(A, p.id)).effectiveConfig.quality).toBe('qhd');
    accounts.getLimits.mockResolvedValue({ maxResolution: 'sd', assetStorageMb: 100 } as any);
    const used = await svc.use(A, p.id);
    expect(used.lastUsedAt).toBeInstanceOf(Date);
    expect(used.config.quality).toBe('qhd'); // stored value untouched
    expect(used.effectiveConfig.quality).toBe('sd');
    expect(used.warnings.join(' ')).toMatch(/lowered/);
  });

  it('drops the kit at use time on a plan without brand storage or after the kit is gone', async () => {
    const { svc, accounts } = build();
    const p = await svc.create(A, { name: 'x', config: { brandKitId: KIT } as any });
    accounts.getLimits.mockResolvedValue({ maxResolution: 'hd', assetStorageMb: 0 } as any);
    const used = await svc.use(A, p.id);
    expect(used.effectiveConfig.brandKitId).toBeNull();
    expect(used.warnings.join(' ')).toMatch(/paid plans/);
  });

  it('start uses the saved destinations and orientation, defaults the title to the name, and reports skipped destinations', async () => {
    const { svc, streams, rows } = build({ conns: { [A]: [C1] } });
    // A destination saved earlier that has since been disconnected is skipped, not fatal.
    rows.push({ id: 'old', accountId: A, name: 'Old', config: { destinationIds: [C1, C2], orientation: 'portrait' }, lastUsedAt: null } as StreamPreset);
    const r = await svc.start(A, 'old', {});
    // No title typed and none stored: the kit default (if any) is resolved by the stream, the preset name is the last fallback.
    expect(streams.create).toHaveBeenCalledWith(A, { title: undefined, orientation: 'portrait', destinationConnectionIds: [C1] }, { fallbackTitle: 'Old' });
    expect(r.preset.warnings.join(' ')).toMatch(/no longer connected/);
    expect(rows[0].lastUsedAt).toBeInstanceOf(Date);
  });

  it("start hands the preset's brand kit choice to the stream (kit id, or null for no kit); automatic when the preset has none", async () => {
    const { svc, streams } = build();
    const withKit = await svc.create(A, { name: 'Kit', config: { brandKitId: KIT } as any });
    await svc.start(A, withKit.id, {});
    expect(streams.create).toHaveBeenLastCalledWith(A, expect.objectContaining({ thumbnailBrandKitId: KIT }), { fallbackTitle: 'Kit' });
    const noKit = await svc.create(A, { name: 'Bare', config: { brandKitId: null } as any });
    await svc.start(A, noKit.id, {});
    expect(streams.create).toHaveBeenLastCalledWith(A, expect.objectContaining({ thumbnailBrandKitId: null }), { fallbackTitle: 'Bare' });
    const auto = await svc.create(A, { name: 'Auto', config: {} as any });
    await svc.start(A, auto.id, {});
    expect(streams.create.mock.calls[streams.create.mock.calls.length - 1][1]).not.toHaveProperty('thumbnailBrandKitId');
  });

  it('start with no saved destinations uses every connected one; with none connected it is refused', async () => {
    const { svc, streams } = build();
    const p = await svc.create(A, { name: 'All', config: {} as any });
    await svc.start(A, p.id, { title: 'Custom' });
    expect(streams.create).toHaveBeenCalledWith(A, { title: 'Custom', orientation: 'landscape', destinationConnectionIds: [C1, C2] }, { fallbackTitle: 'All' });
    const empty = build({ conns: { [A]: [] } });
    const q = await empty.svc.create(A, { name: 'None', config: {} as any });
    await expect(empty.svc.start(A, q.id, {})).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('a refused start does not stamp lastUsedAt', async () => {
    const { svc, streams, rows } = build();
    const p = await svc.create(A, { name: 'x', config: {} as any });
    streams.create.mockRejectedValueOnce(new Error('hours used up'));
    await expect(svc.start(A, p.id, {})).rejects.toThrow('hours used up');
    expect(rows[0].lastUsedAt).toBeNull();
  });
});
