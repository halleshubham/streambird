import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Asset, AssetKind } from './entities/asset.entity';
import { BrandKit } from './entities/brand-kit.entity';
import { OBJECT_STORAGE, ObjectStorage } from './object-storage';
import { parseImage } from './image.util';
import { AccountsService } from '../accounts/accounts.service';

const MB = 1024 * 1024;

export interface AssetLibrary {
  /** Storage is configured on this server. */
  enabled: boolean;
  /** The plan's allowance in bytes; 0 = this plan keeps assets in the browser only. */
  quotaBytes: number;
  usedBytes: number;
  items: Array<Pick<Asset, 'id' | 'kind' | 'name' | 'contentType' | 'sizeBytes' | 'width' | 'height' | 'createdAt'> & { usedBy: string[] }>;
}

@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(BrandKit) private readonly kits: Repository<BrandKit>,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly accounts: AccountsService,
  ) {}

  /** Bytes the plan allows; refuses with an upgrade hint when the plan keeps assets in the browser only. */
  async quotaBytesFor(accountId: string): Promise<number> {
    const limits = await this.accounts.getLimits(accountId);
    return limits.assetStorageMb * MB;
  }

  async usedBytes(accountId: string): Promise<number> {
    const row = await this.assets.createQueryBuilder('a').select('COALESCE(SUM(a.size_bytes), 0)', 'sum').where('a.account_id = :accountId', { accountId }).getRawOne();
    return Number(row?.sum ?? 0);
  }

  /** Throws unless this account may store brand files at all (plan allowance > 0 and storage configured). */
  async assertCanStore(accountId: string): Promise<number> {
    if (!this.storage.enabled) throw new ServiceUnavailableException('Brand storage is not enabled on this server yet.');
    const quota = await this.quotaBytesFor(accountId);
    if (quota <= 0) {
      throw new ForbiddenException('Brand storage is on the paid plans. Your logo and wallpaper stay saved in this browser on the Free plan.');
    }
    return quota;
  }

  async list(accountId: string): Promise<AssetLibrary> {
    const [rows, quotaBytes, usedBytes, kits] = await Promise.all([
      this.assets.find({ where: { accountId }, order: { createdAt: 'DESC' } }),
      this.quotaBytesFor(accountId),
      this.usedBytes(accountId),
      this.kits.find({ where: { accountId } }),
    ]);
    return {
      enabled: this.storage.enabled,
      quotaBytes,
      usedBytes,
      items: rows.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        width: a.width,
        height: a.height,
        createdAt: a.createdAt,
        usedBy: kits.filter((k) => k.logoAssetId === a.id || k.wallpaperAssetId === a.id).map((k) => k.name),
      })),
    };
  }

  async upload(accountId: string, file: Buffer | undefined, kind: AssetKind, name: string | undefined, originalName?: string): Promise<Asset> {
    const quota = await this.assertCanStore(accountId);
    const image = parseImage(file);
    const used = await this.usedBytes(accountId);
    if (used + file!.length > quota) {
      throw new ForbiddenException(
        `Not enough brand storage: ${(used / MB).toFixed(1)} MB of ${(quota / MB).toFixed(0)} MB used. Delete a file or upgrade your plan.`,
      );
    }
    const id = randomUUID();
    const storageKey = `acct/${accountId}/assets/${id}`;
    await this.storage.put(storageKey, file!, image.contentType);
    try {
      const display = (name ?? originalName ?? 'Untitled').trim().slice(0, 120) || 'Untitled';
      return await this.assets.save(
        this.assets.create({ id, accountId, kind, name: display, contentType: image.contentType, sizeBytes: file!.length, width: image.width, height: image.height, storageKey }),
      );
    } catch (err) {
      await this.storage.delete(storageKey).catch(() => undefined); // never leave an orphan in the bucket
      throw err;
    }
  }

  async findOwned(accountId: string, id: string): Promise<Asset> {
    const asset = await this.assets.findOne({ where: { id, accountId } });
    if (!asset) throw new NotFoundException('File not found.');
    return asset;
  }

  async read(accountId: string, id: string): Promise<{ data: Buffer; contentType: string; updatedAt: Date }> {
    const asset = await this.findOwned(accountId, id);
    const data = await this.storage.get(asset.storageKey);
    if (!data) throw new NotFoundException('File not found.');
    return { data, contentType: asset.contentType, updatedAt: asset.updatedAt };
  }

  async rename(accountId: string, id: string, name: string): Promise<Asset> {
    const asset = await this.findOwned(accountId, id);
    asset.name = name.trim();
    return this.assets.save(asset);
  }

  async remove(accountId: string, id: string): Promise<void> {
    const asset = await this.findOwned(accountId, id);
    const using = await this.kits.find({ where: [{ accountId, logoAssetId: id }, { accountId, wallpaperAssetId: id }] });
    if (using.length > 0) {
      throw new ConflictException(`This file is used by the brand kit${using.length > 1 ? 's' : ''} ${using.map((k) => `"${k.name}"`).join(', ')}. Change or delete ${using.length > 1 ? 'them' : 'it'} first.`);
    }
    await this.assets.delete({ id, accountId });
    await this.storage.delete(asset.storageKey).catch(() => undefined); // the row is gone; a stray object is harmless
  }

  async ownedIds(accountId: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.assets.find({ where: { accountId, id: In(ids) }, select: ['id'] });
    return new Set(rows.map((r) => r.id));
  }
}
