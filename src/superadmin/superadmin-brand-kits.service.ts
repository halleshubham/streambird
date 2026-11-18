import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { Asset } from '../assets/entities/asset.entity';
import { BrandKit } from '../assets/entities/brand-kit.entity';
import { BrandKitAd } from '../assets/entities/brand-kit-ad.entity';
import { AssetsService } from '../assets/assets.service';
import { kitForDestination } from '../assets/kit-text';
import { checkFrameWindow } from '../assets/image-pixels';
import type { WindowCheck } from '../assets/image-pixels';
import { LiveStream } from '../streams/entities/live-stream.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { AuditLogService } from '../audit-log/audit-log.service';
import { User } from '../users/entities/user.entity';
import { buildKitDiagnostics, buildStreamDiagnostics } from './brand-kit-diagnostics';
import type { AdSummary, AssetSummary, Diagnostic, KitSet, SetName } from './brand-kit-diagnostics';

const TEXT_LIMIT = 200;
/** A request never decodes more pictures than this (each decode is CPU work on the single backend process). */
const MAX_WINDOW_CHECKS = 12;
const PLACEMENT_ORDER = ['lower_third', 'side_third', 'full_screen', 'l_shape'];
const ASSET_COLUMNS: Array<keyof Asset> = ['id', 'name', 'contentType', 'sizeBytes', 'width', 'height']; // never storageKey

export interface BrandKitAdminView {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  connectionIds: string[];
  connections: Array<{ id: string; platform: string; displayName: string }>;
  logoPosition: string;
  logoSize: number;
  adsShrinkPicture: boolean;
  wallpaperDim: number;
  lowerThirdStyle: string;
  clock: {
    clockEnabled: boolean;
    clockPosition: string;
    clockFormat: string;
    clockShowDate: boolean;
    clockShowSeconds: boolean;
    clockTimezone: string | null;
    clockSize: string;
    clockStyle: string;
    clockAlternate: boolean;
  };
  title: string | null;
  description: string | null;
  thumbnail: AssetSummary | null;
  landscape: KitSet;
  portrait: KitSet;
  diagnostics: Diagnostic[];
}

const trunc = (v: string | null) => (v === null ? null : v.length > TEXT_LIMIT ? `${v.slice(0, TEXT_LIMIT)}…` : v);

/** Read-only, cross-tenant look at an account's brand kits for support (superadmin only). Never selects credentials or storage keys. */
@Injectable()
export class SuperadminBrandKitsService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(BrandKit) private readonly kits: Repository<BrandKit>,
    @InjectRepository(BrandKitAd) private readonly kitAds: Repository<BrandKitAd>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(PlatformConnection) private readonly connections: Repository<PlatformConnection>,
    @InjectRepository(LiveStream) private readonly streams: Repository<LiveStream>,
    @InjectRepository(LiveStreamDestination) private readonly destinations: Repository<LiveStreamDestination>,
    private readonly assetFiles: AssetsService,
    private readonly accountsService: AccountsService,
    private readonly auditLog: AuditLogService,
  ) {}

  async forAccount(accountId: string, admin: User) {
    const account = await this.accounts.findOne({ where: { id: accountId }, select: ['id', 'name'] });
    if (!account) throw new NotFoundException('Account not found');
    const ctx = await this.loadContext(accountId);
    const views = await Promise.all(ctx.kits.map((k) => this.viewOf(k, ctx)));
    await this.auditLog.log(admin, 'view_brand_kits', 'account', accountId, { kits: views.length });
    return { account: { id: account.id, name: account.name }, plan: ctx.plan, kits: views };
  }

  async forStream(streamId: string, admin: User) {
    const stream = await this.streams.findOne({ where: { id: streamId } });
    if (!stream) throw new NotFoundException('Stream not found');
    const accountId = stream.accountId;
    const ctx = await this.loadContext(accountId);
    const dests = await this.destinations.find({ where: { liveStreamId: streamId }, order: { createdAt: 'ASC' } });
    const conns = dests.length > 0 ? await this.connections.find({ where: { id: In(dests.map((d) => d.platformConnectionId)), accountId }, select: this.connectionColumns }) : [];

    const orientation: SetName = stream.orientation === 'portrait' ? 'portrait' : 'landscape';
    const resolvedDestinations = dests.map((d) => {
      const conn = conns.find((c) => c.id === d.platformConnectionId);
      const own = conn?.brandKitId ? ctx.kits.find((k) => k.id === conn.brandKitId) : undefined;
      const kit = kitForDestination(ctx.kits, conn?.brandKitId ?? null);
      return {
        destinationId: d.id,
        status: d.status,
        platform: conn?.platform ?? null,
        displayName: conn?.label ?? null,
        connectionId: d.platformConnectionId,
        kitId: kit?.id ?? null,
        kitName: kit?.name ?? null,
        kitSource: kit ? (own ? ('channel' as const) : ('account_default' as const)) : null,
      };
    });
    const kitIds = [...new Set(resolvedDestinations.map((r) => r.kitId).filter((v): v is string => !!v))];
    const kitViews = await Promise.all(ctx.kits.filter((k) => kitIds.includes(k.id)).map((k) => this.viewOf(k, ctx, orientation)));
    const diagnostics: Diagnostic[] = resolvedDestinations.length === 0 ? [{ level: 'info', text: 'The stream has no destinations.' }] : [];
    for (const v of kitViews) {
      const src = resolvedDestinations.find((r) => r.kitId === v.id)?.kitSource ?? null;
      diagnostics.push(...buildStreamDiagnostics({ orientation, kit: v, kitSource: src, plan: ctx.plan }));
    }
    if (resolvedDestinations.length > 0 && kitViews.length === 0) {
      diagnostics.push(...buildStreamDiagnostics({ orientation, kit: null, kitSource: null, plan: ctx.plan }));
    }
    await this.auditLog.log(admin, 'view_brand_kits', 'stream', streamId, { accountId });
    return {
      stream: { id: stream.id, title: stream.title, status: stream.status, orientation: stream.orientation, accountId, createdAt: stream.createdAt },
      account: { id: accountId, name: ctx.accountName },
      plan: ctx.plan,
      destinations: resolvedDestinations,
      kits: kitViews,
      diagnostics,
    };
  }

  private readonly connectionColumns: Array<keyof PlatformConnection> = ['id', 'accountId', 'platform', 'label', 'brandKitId']; // never the credentials

  private async loadContext(accountId: string) {
    const [account, kits, conns, limits] = await Promise.all([
      this.accounts.findOne({ where: { id: accountId }, select: ['id', 'name'] }),
      this.kits.find({ where: { accountId }, order: { createdAt: 'ASC' } }),
      this.connections.find({ where: { accountId }, select: this.connectionColumns }),
      this.accountsService.getLimits(accountId),
    ]);
    const ads = kits.length > 0 ? await this.kitAds.find({ where: { brandKitId: In(kits.map((k) => k.id)) } }) : [];
    const assetIds = new Set<string>();
    for (const k of kits) for (const id of [k.logoAssetId, k.logoAssetIdPortrait, k.wallpaperAssetId, k.wallpaperAssetIdPortrait, k.thumbnailAssetId]) if (id) assetIds.add(id);
    for (const a of ads) assetIds.add(a.assetId);
    const rows = assetIds.size > 0 ? await this.assets.find({ where: { accountId, id: In([...assetIds]) }, select: ASSET_COLUMNS }) : [];
    return {
      accountName: account?.name ?? '',
      kits,
      conns,
      ads,
      assets: new Map(rows.map((r) => [r.id, r])),
      plan: { key: limits.planKey, name: limits.planName, watermark: limits.watermark, assetStorageMb: limits.assetStorageMb, poweredByMark: limits.watermark },
      accountId,
      checks: { used: 0, cache: new Map<string, WindowCheck>() },
    };
  }

  private summary(ctx: Awaited<ReturnType<SuperadminBrandKitsService['loadContext']>>, id: string): AssetSummary {
    const a = ctx.assets.get(id);
    if (!a) return { assetId: id, fileName: null, mime: null, sizeBytes: null, width: null, height: null, missing: true };
    return { assetId: id, fileName: a.name, mime: a.contentType, sizeBytes: a.sizeBytes, width: a.width, height: a.height };
  }

  private async frameCheck(ctx: Awaited<ReturnType<SuperadminBrandKitsService['loadContext']>>, assetId: string): Promise<WindowCheck> {
    const cached = ctx.checks.cache.get(assetId);
    if (cached) return cached;
    const a = ctx.assets.get(assetId);
    let result: WindowCheck;
    if (!a) result = { status: 'not_checked', reason: 'the file is missing from the library' };
    else if (ctx.checks.used >= MAX_WINDOW_CHECKS) result = { status: 'not_checked', reason: 'too many frames to check in one request' };
    else {
      ctx.checks.used += 1;
      try {
        const { data } = await this.assetFiles.read(ctx.accountId, assetId);
        result = checkFrameWindow(data, a.contentType, a);
      } catch {
        result = { status: 'not_checked', reason: 'the stored file could not be read' };
      }
    }
    ctx.checks.cache.set(assetId, result);
    return result;
  }

  private async setOf(ctx: Awaited<ReturnType<SuperadminBrandKitsService['loadContext']>>, k: BrandKit, o: SetName, withChecks: boolean): Promise<KitSet> {
    const logoId = o === 'portrait' ? k.logoAssetIdPortrait : k.logoAssetId;
    const wallId = o === 'portrait' ? k.wallpaperAssetIdPortrait : k.wallpaperAssetId;
    const rows = ctx.ads
      .filter((a) => a.brandKitId === k.id && (o === 'portrait' ? a.orientation === 'portrait' : a.orientation !== 'portrait'))
      .sort((a, b) => PLACEMENT_ORDER.indexOf(a.placement) - PLACEMENT_ORDER.indexOf(b.placement));
    const ads: AdSummary[] = [];
    for (const a of rows) {
      const ad: AdSummary = { placement: a.placement, ...this.summary(ctx, a.assetId), enabled: a.enabled, mode: a.mode, showSec: a.showSec, everySec: a.everySec };
      if (a.placement === 'l_shape' && withChecks) ad.windowCheck = await this.frameCheck(ctx, a.assetId);
      ads.push(ad);
    }
    return { logo: logoId ? this.summary(ctx, logoId) : null, wallpaper: wallId ? this.summary(ctx, wallId) : null, ads };
  }

  /** `only` = skip the window check of the other orientation's frame (a stream looks at one set). */
  private async viewOf(k: BrandKit, ctx: Awaited<ReturnType<SuperadminBrandKitsService['loadContext']>>, only?: SetName): Promise<BrandKitAdminView> {
    const [landscape, portrait] = await Promise.all([this.setOf(ctx, k, 'landscape', only !== 'portrait'), this.setOf(ctx, k, 'portrait', only !== 'landscape')]);
    const mine = ctx.conns.filter((c) => c.brandKitId === k.id);
    const thumbnail = k.thumbnailAssetId ? this.summary(ctx, k.thumbnailAssetId) : null;
    return {
      id: k.id,
      name: k.name,
      isDefault: k.isDefault,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
      connectionIds: mine.map((c) => c.id),
      connections: mine.map((c) => ({ id: c.id, platform: c.platform, displayName: c.label })),
      logoPosition: k.logoPosition,
      logoSize: k.logoSize,
      adsShrinkPicture: k.adsShrinkPicture,
      wallpaperDim: k.wallpaperDim,
      lowerThirdStyle: k.lowerThirdStyle,
      clock: {
        clockEnabled: k.clockEnabled,
        clockPosition: k.clockPosition,
        clockFormat: k.clockFormat,
        clockShowDate: k.clockShowDate,
        clockShowSeconds: k.clockShowSeconds,
        clockTimezone: k.clockTimezone,
        clockSize: k.clockSize,
        clockStyle: k.clockStyle,
        clockAlternate: k.clockAlternate,
      },
      title: trunc(k.title),
      description: trunc(k.description),
      thumbnail,
      landscape,
      portrait,
      diagnostics: buildKitDiagnostics({
        isDefault: k.isDefault,
        adsShrinkPicture: k.adsShrinkPicture,
        channels: mine.map((c) => `${c.platform}: ${c.label}`),
        landscape,
        portrait,
        thumbnail,
        plan: ctx.plan,
      }),
    };
  }
}
