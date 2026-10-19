import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BrandKit } from './entities/brand-kit.entity';
import { AssetsService } from './assets.service';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { AccountsService } from '../accounts/accounts.service';
import { CreateBrandKitDto, UpdateBrandKitDto } from './dto/brand-kit.dto';

export type BrandKitView = BrandKit & { connectionIds: string[] };

/**
 * Brand kits: reusable looks made of library assets. Assets belong to the account, so kits (and therefore
 * brands: a connection points at one kit) can share a file; a kit shared by several connections is one row.
 */
@Injectable()
export class BrandKitsService {
  constructor(
    @InjectRepository(BrandKit) private readonly kits: Repository<BrandKit>,
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
    return kits.map((k) => ({ ...k, connectionIds: conns.filter((c) => c.brandKitId === k.id).map((c) => c.id) }));
  }

  private async checkAssets(accountId: string, dto: { logoAssetId?: string | null; wallpaperAssetId?: string | null }): Promise<void> {
    const wanted = [dto.logoAssetId, dto.wallpaperAssetId].filter((v): v is string => !!v);
    const owned = await this.assets.ownedIds(accountId, wanted);
    if (wanted.some((id) => !owned.has(id))) throw new BadRequestException('One of the chosen files is not in your library.');
  }

  async create(accountId: string, dto: CreateBrandKitDto): Promise<BrandKitView> {
    await this.assertAllowed(accountId);
    await this.checkAssets(accountId, dto);
    const saved = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(BrandKit);
      const makeDefault = dto.isDefault === true || (await repo.count({ where: { accountId } })) === 0; // the first kit is the default
      if (makeDefault) await repo.update({ accountId, isDefault: true }, { isDefault: false });
      return repo.save(
        repo.create({
          accountId,
          name: dto.name.trim(),
          logoAssetId: dto.logoAssetId ?? null,
          logoPosition: dto.logoPosition ?? 'left',
          logoSize: dto.logoSize ?? 90,
          wallpaperAssetId: dto.wallpaperAssetId ?? null,
          wallpaperDim: dto.wallpaperDim ?? 0,
          lowerThirdStyle: dto.lowerThirdStyle ?? 'accent',
          isDefault: makeDefault,
        }),
      );
    });
    return { ...saved, connectionIds: [] };
  }

  private async findOwned(accountId: string, id: string): Promise<BrandKit> {
    const kit = await this.kits.findOne({ where: { id, accountId } });
    if (!kit) throw new NotFoundException('Brand kit not found.');
    return kit;
  }

  async update(accountId: string, id: string, dto: UpdateBrandKitDto): Promise<BrandKitView> {
    await this.assertAllowed(accountId);
    const kit = await this.findOwned(accountId, id);
    await this.checkAssets(accountId, dto);
    if (dto.name !== undefined) kit.name = dto.name.trim();
    if (dto.logoAssetId !== undefined) kit.logoAssetId = dto.logoAssetId;
    if (dto.logoPosition !== undefined) kit.logoPosition = dto.logoPosition;
    if (dto.logoSize !== undefined) kit.logoSize = dto.logoSize;
    if (dto.wallpaperAssetId !== undefined) kit.wallpaperAssetId = dto.wallpaperAssetId;
    if (dto.wallpaperDim !== undefined) kit.wallpaperDim = dto.wallpaperDim;
    if (dto.lowerThirdStyle !== undefined) kit.lowerThirdStyle = dto.lowerThirdStyle;
    const saved = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(BrandKit);
      if (dto.isDefault === true && !kit.isDefault) {
        await repo.update({ accountId, isDefault: true }, { isDefault: false });
        kit.isDefault = true;
      }
      // Turning the default off is done by making another kit the default, so an account never ends up with none by accident.
      return repo.save(kit);
    });
    const connectionIds = (await this.connections.find({ where: { accountId, brandKitId: id }, select: ['id'] })).map((c) => c.id);
    return { ...saved, connectionIds };
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
