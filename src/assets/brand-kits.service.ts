import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BrandKit } from './entities/brand-kit.entity';
import { BrandKitAd } from './entities/brand-kit-ad.entity';
import type { AdMode, AdPlacement, BrandOrientation } from './entities/brand-kit-ad.entity';
import { AssetsService } from './assets.service';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { AccountsService } from '../accounts/accounts.service';
import { MAX_THUMBNAIL_BYTES, MIN_THUMBNAIL_WIDTH, ThumbnailImage, parseThumbnail } from '../streams/thumbnail.util';
import { KitTextPick, pickKitText } from './kit-text';
import { BrandKitAdDto, CreateBrandKitDto, UpdateBrandKitDto } from './dto/brand-kit.dto';

/** One ad as the API returns it. Continuous ads carry null schedule numbers. */
export interface BrandKitAdView {
  placement: AdPlacement;
  assetId: string;
  enabled: boolean;
  mode: AdMode;
  showSec: number | null;
  everySec: number | null;
}

/**
 * `ads` is the LANDSCAPE (16:9) set and `adsPortrait` the portrait (9:16) set. logoAssetId / wallpaperAssetId are the
 * landscape files, logoAssetIdPortrait / wallpaperAssetIdPortrait the portrait ones. Older clients only know the
 * landscape fields (rows from before migration 0028 are all landscape), so they keep working unchanged.
 */
export type BrandKitView = BrandKit & { connectionIds: string[]; ads: BrandKitAdView[]; adsPortrait: BrandKitAdView[] };

const PLACEMENT_ORDER: AdPlacement[] = ['lower_third', 'side_third', 'full_screen', 'l_shape'];
const toAdView = (a: BrandKitAd): BrandKitAdView => ({ placement: a.placement, assetId: a.assetId, enabled: a.enabled, mode: a.mode, showSec: a.showSec, everySec: a.everySec });

/**
 * Brand kits: reusable looks made of library assets. Assets belong to the account, so kits (and therefore
 * brands: a connection points at one kit) can share a file; a kit shared by several connections is one row.
 */
@Injectable()
export class BrandKitsService {
  private readonly logger = new Logger(BrandKitsService.name);

  constructor(
    @InjectRepository(BrandKit) private readonly kits: Repository<BrandKit>,
    @InjectRepository(BrandKitAd) private readonly kitAds: Repository<BrandKitAd>,
    @InjectRepository(PlatformConnection) private readonly connections: Repository<PlatformConnection>,
    private readonly assets: AssetsService,
    private readonly accounts: AccountsService,
    private readonly dataSource: DataSource,
  ) {}

  /** Kits come with brand storage, so they follow the same plan gate. */
  private async assertAllowed(accountId: string): Promise<void> {
    const limits = await this.accounts.getLimits(accountId);
    if (limits.assetStorageMb <= 0) {
      throw new ForbiddenException('Brand kits are on the paid plans. Your logo and wallpaper stay saved in this browser on the Free plan.');
    }
  }

  async list(accountId: string): Promise<BrandKitView[]> {
    const [kits, conns] = await Promise.all([
      this.kits.find({ where: { accountId }, order: { createdAt: 'ASC' } }),
      this.connections.find({ where: { accountId }, select: ['id', 'brandKitId'] }),
    ]);
    const ads = kits.length > 0 ? await this.kitAds.find({ where: { brandKitId: In(kits.map((k) => k.id)) } }) : [];
    return kits.map((k) => ({
      ...k,
      connectionIds: conns.filter((c) => c.brandKitId === k.id).map((c) => c.id),
      ...this.adSets(ads.filter((a) => a.brandKitId === k.id)),
    }));
  }

  private adSets(rows: BrandKitAd[]): { ads: BrandKitAdView[]; adsPortrait: BrandKitAdView[] } {
    return {
      ads: this.sortedAds(rows.filter((a) => a.orientation !== 'portrait')),
      adsPortrait: this.sortedAds(rows.filter((a) => a.orientation === 'portrait')),
    };
  }

  private sortedAds(rows: BrandKitAd[]): BrandKitAdView[] {
    return [...rows].sort((a, b) => PLACEMENT_ORDER.indexOf(a.placement) - PLACEMENT_ORDER.indexOf(b.placement)).map(toAdView);
  }

  /**
   * Custom ads need a plan without the "Powered by StreamBird" mark (any paid plan, or a day pass): the Free plan
   * shows a StreamBird ad of its own instead. Clearing ads is always allowed. Returns the cleaned list to store.
   */
  private async checkAds(accountId: string, ads: BrandKitAdDto[]): Promise<BrandKitAdView[]> {
    if (ads.length === 0) return [];
    const limits = await this.accounts.getLimits(accountId);
    if (limits.watermark) {
      throw new ForbiddenException('Your own ads are on the paid plans. Free streams carry a StreamBird ad instead -- upgrade to run yours.');
    }
    if (new Set(ads.map((a) => a.placement)).size !== ads.length) {
      throw new BadRequestException('Each kit can have one ad per place (lower third, left third, full screen, L-shaped frame).');
    }
    const out: BrandKitAdView[] = [];
    for (const ad of ads) {
      const mode = ad.mode ?? 'continuous';
      if (mode === 'interval' && (ad.showSec === undefined || ad.everySec === undefined)) {
        throw new BadRequestException('A timed ad needs both how long it is shown and how long it stays hidden between showings.');
      }
      out.push({
        placement: ad.placement,
        assetId: ad.assetId,
        enabled: ad.enabled ?? true,
        mode,
        showSec: mode === 'interval' ? ad.showSec! : null,
        everySec: mode === 'interval' ? ad.everySec! : null,
      });
    }
    const owned = await this.assets.findOwnedOfKind(accountId, out.map((a) => a.assetId), 'ad');
    if (out.some((a) => !owned.has(a.assetId))) {
      throw new BadRequestException('Each ad must be a file of type "Ad" from your library.');
    }
    return out;
  }

  /** Logo and wallpaper must be the right kind of file (an ad file is not a logo), so "GIF only for logo/ad" stays strict. */
  private async checkAssets(
    accountId: string,
    dto: { logoAssetId?: string | null; wallpaperAssetId?: string | null; logoAssetIdPortrait?: string | null; wallpaperAssetIdPortrait?: string | null },
  ): Promise<void> {
    const logoIds = [dto.logoAssetId, dto.logoAssetIdPortrait].filter((v): v is string => !!v);
    const wallIds = [dto.wallpaperAssetId, dto.wallpaperAssetIdPortrait].filter((v): v is string => !!v);
    const logos = await this.assets.findOwnedOfKind(accountId, logoIds, ['logo', 'other']);
    const walls = await this.assets.findOwnedOfKind(accountId, wallIds, ['wallpaper', 'background', 'other']);
    if (logoIds.some((id) => !logos.has(id)) || wallIds.some((id) => !walls.has(id))) {
      throw new BadRequestException('One of the chosen files is not in your library, or is the wrong type for a logo or wallpaper.');
    }
  }

  /**
   * The kit's stream thumbnail must be a file of the account that the platforms accept: JPG or PNG (no GIF/WebP), at most
   * 2 MB, at least 640 px wide (the same limits as a thumbnail uploaded for one stream). Checked from the stored metadata.
   */
  private async checkThumbnail(accountId: string, assetId: string | null | undefined): Promise<void> {
    if (!assetId) return;
    const asset = await this.assets.findOwned(accountId, assetId).catch(() => null);
    if (!asset) throw new BadRequestException('The thumbnail must be a file from your library.');
    if (asset.contentType !== 'image/jpeg' && asset.contentType !== 'image/png') throw new BadRequestException('The thumbnail must be a JPG or PNG image.');
    if (asset.sizeBytes > MAX_THUMBNAIL_BYTES) throw new BadRequestException(`The thumbnail is too large -- the limit is ${MAX_THUMBNAIL_BYTES / 1024 / 1024} MB.`);
    if (asset.width < MIN_THUMBNAIL_WIDTH) throw new BadRequestException(`The thumbnail is too small -- it must be at least ${MIN_THUMBNAIL_WIDTH}px wide (1280x720 is recommended).`);
  }

  /**
   * The brand-kit thumbnail a stream destination gets when the stream has no thumbnail of its own.
   * Kit = `override` when given (null = "no kit": nothing), else the connection's kit, else the account default kit
   * (the same choice the studio makes for the look). A kit without a thumbnail gives none: it does not fall through to
   * another kit. Never throws: an unreadable file is logged and treated as "none" (going live must not wait on it).
   */
  async thumbnailForConnection(
    accountId: string,
    connectionBrandKitId: string | null,
    override?: string | null,
  ): Promise<{ image: ThumbnailImage; kitId: string; kitName: string } | null> {
    if (override === null) return null;
    try {
      const kitId = override ?? connectionBrandKitId;
      let resolved = kitId ? await this.kits.findOne({ where: { id: kitId, accountId } }) : null;
      if (!resolved && !override) resolved = await this.kits.findOne({ where: { accountId, isDefault: true } });
      if (!resolved?.thumbnailAssetId) return null;
      const { data } = await this.assets.read(accountId, resolved.thumbnailAssetId);
      return { image: parseThumbnail(data), kitId: resolved.id, kitName: resolved.name };
    } catch (err) {
      this.logger.warn(`Could not read the brand kit thumbnail for account ${accountId}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * The default title/description a new stream takes from its kit when the request leaves them blank. `destinations` are the
   * stream's destinations IN REQUEST ORDER; see pickKitText for the rule. `override` is the stream's kit choice
   * (thumbnailBrandKitId: omitted = automatic, null = no kit, id = that kit). Never throws: going live must not wait on it.
   */
  async defaultTextFor(accountId: string, destinations: ReadonlyArray<Pick<PlatformConnection, 'brandKitId'>>, override?: string | null): Promise<KitTextPick> {
    const none: KitTextPick = { title: null, description: null, titleKit: null, descriptionKit: null };
    if (override === null) return none;
    try {
      const kits = await this.kits.find({ where: { accountId }, select: ['id', 'name', 'isDefault', 'title', 'description'] });
      return pickKitText(kits, destinations.map((d) => d.brandKitId ?? null), override);
    } catch (err) {
      this.logger.warn(`Could not read the brand kit text for account ${accountId}: ${(err as Error).message}`);
      return none;
    }
  }

  /** A foreign-key or unique violation from a race (file deleted, two saves at once) is the caller's conflict, not a server error. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      const code = (err as { code?: string }).code ?? (err as { driverError?: { code?: string } }).driverError?.code;
      if (code === '23503') throw new BadRequestException('One of the chosen files was just deleted from your library. Pick it again.');
      if (code === '23505') throw new ConflictException('This kit was changed at the same moment. Reload and try again.');
      throw err;
    }
  }

  async create(accountId: string, dto: CreateBrandKitDto): Promise<BrandKitView> {
    await this.assertAllowed(accountId);
    await this.checkAssets(accountId, dto);
    await this.checkThumbnail(accountId, dto.thumbnailAssetId);
    const ads = await this.checkAds(accountId, dto.ads ?? []); // null/omitted = no ads
    const adsPortrait = await this.checkAds(accountId, dto.adsPortrait ?? []);
    const saved = await this.guard(() => this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(BrandKit);
      const makeDefault = dto.isDefault === true || (await repo.count({ where: { accountId } })) === 0; // the first kit is the default
      if (makeDefault) await repo.update({ accountId, isDefault: true }, { isDefault: false });
      const kit = await repo.save(
        repo.create({
          accountId,
          name: dto.name.trim(),
          title: dto.title ?? null,
          description: dto.description ?? null,
          logoAssetId: dto.logoAssetId ?? null,
          logoAssetIdPortrait: dto.logoAssetIdPortrait ?? null,
          logoPosition: dto.logoPosition ?? 'left',
          logoSize: dto.logoSize ?? 90,
          wallpaperAssetId: dto.wallpaperAssetId ?? null,
          wallpaperAssetIdPortrait: dto.wallpaperAssetIdPortrait ?? null,
          thumbnailAssetId: dto.thumbnailAssetId ?? null,
          adsShrinkPicture: dto.adsShrinkPicture ?? true,
          wallpaperDim: dto.wallpaperDim ?? 0,
          lowerThirdStyle: dto.lowerThirdStyle ?? 'accent',
          isDefault: makeDefault,
        }),
      );
      await this.replaceAds(m, kit.id, 'landscape', ads);
      await this.replaceAds(m, kit.id, 'portrait', adsPortrait);
      return kit;
    }));
    return { ...saved, connectionIds: [], ...(await this.adsOf(saved.id)) };
  }

  private async replaceAds(m: EntityManager, kitId: string, orientation: BrandOrientation, ads: BrandKitAdView[]): Promise<void> {
    const repo = m.getRepository(BrandKitAd);
    await repo.delete({ brandKitId: kitId, orientation });
    if (ads.length > 0) await repo.insert(ads.map((a) => ({ brandKitId: kitId, orientation, ...a })));
  }

  private async adsOf(kitId: string): Promise<{ ads: BrandKitAdView[]; adsPortrait: BrandKitAdView[] }> {
    return this.adSets(await this.kitAds.find({ where: { brandKitId: kitId } }));
  }

  private async findOwned(accountId: string, id: string): Promise<BrandKit> {
    const kit = await this.kits.findOne({ where: { id, accountId } });
    if (!kit) throw new NotFoundException('Brand kit not found.');
    return kit;
  }

  async update(accountId: string, id: string, dto: UpdateBrandKitDto): Promise<BrandKitView> {
    await this.assertAllowed(accountId);
    await this.findOwned(accountId, id); // 404 for another account's kit before anything else
    // `ads: null` is treated like an omitted `ads`: unchanged.
    const saved = await this.guard(() => this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(BrandKit);
      // Lock the kit row so two saves of the same kit (or its ads) run one after the other.
      const kit = await repo.createQueryBuilder('k').setLock('pessimistic_write').where({ id, accountId }).getOne();
      if (!kit) throw new NotFoundException('Brand kit not found.');
      await this.checkAssets(accountId, dto);
      await this.checkThumbnail(accountId, dto.thumbnailAssetId);
      const ads = dto.ads == null ? undefined : await this.checkAds(accountId, dto.ads);
      const adsPortrait = dto.adsPortrait == null ? undefined : await this.checkAds(accountId, dto.adsPortrait);
      if (dto.name !== undefined) kit.name = dto.name.trim();
      if (dto.title !== undefined) kit.title = dto.title;
      if (dto.description !== undefined) kit.description = dto.description;
      if (dto.logoAssetId !== undefined) kit.logoAssetId = dto.logoAssetId;
      if (dto.logoAssetIdPortrait !== undefined) kit.logoAssetIdPortrait = dto.logoAssetIdPortrait;
      if (dto.wallpaperAssetIdPortrait !== undefined) kit.wallpaperAssetIdPortrait = dto.wallpaperAssetIdPortrait;
      if (dto.thumbnailAssetId !== undefined) kit.thumbnailAssetId = dto.thumbnailAssetId;
      if (dto.adsShrinkPicture !== undefined) kit.adsShrinkPicture = dto.adsShrinkPicture;
      if (dto.logoPosition !== undefined) kit.logoPosition = dto.logoPosition;
      if (dto.logoSize !== undefined) kit.logoSize = dto.logoSize;
      if (dto.wallpaperAssetId !== undefined) kit.wallpaperAssetId = dto.wallpaperAssetId;
      if (dto.wallpaperDim !== undefined) kit.wallpaperDim = dto.wallpaperDim;
      if (dto.lowerThirdStyle !== undefined) kit.lowerThirdStyle = dto.lowerThirdStyle;
      if (dto.isDefault === true && !kit.isDefault) {
        await repo.update({ accountId, isDefault: true }, { isDefault: false });
        kit.isDefault = true;
      }
      // Turning the default off is done by making another kit the default, so an account never ends up with none by accident.
      const out = await repo.save(kit);
      if (ads !== undefined) await this.replaceAds(m, id, 'landscape', ads);
      if (adsPortrait !== undefined) await this.replaceAds(m, id, 'portrait', adsPortrait);
      return out;
    }));
    const connectionIds = (await this.connections.find({ where: { accountId, brandKitId: id }, select: ['id'] })).map((c) => c.id);
    return { ...saved, connectionIds, ...(await this.adsOf(id)) };
  }

  /** Deleting a kit frees its files for deletion and sends its connections back to the account default. */
  async remove(accountId: string, id: string): Promise<void> {
    const kit = await this.findOwned(accountId, id);
    await this.kits.delete({ id, accountId }); // platform_connections.brand_kit_id is ON DELETE SET NULL
    if (kit.isDefault) {
      const next = await this.kits.findOne({ where: { accountId }, order: { createdAt: 'ASC' } });
      if (next) await this.kits.update({ id: next.id }, { isDefault: true });
    }
  }

  /** Points one connection (a YouTube channel / Facebook Page) at a kit, or back at the account default with null. */
  async assign(accountId: string, connectionId: string, brandKitId: string | null): Promise<{ connectionId: string; brandKitId: string | null }> {
    const conn = await this.connections.findOne({ where: { id: connectionId, accountId } });
    if (!conn) throw new NotFoundException('Connection not found.');
    if (brandKitId) await this.findOwned(accountId, brandKitId);
    conn.brandKitId = brandKitId;
    await this.connections.save(conn);
    return { connectionId, brandKitId };
  }
}
