import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PresetConfig, PresetQuality, StreamPreset } from './entities/stream-preset.entity';
import { CreatePresetDto, PresetConfigDto, StartPresetDto, UpdatePresetDto } from './dto/preset.dto';
import { PlatformConnection } from '../platform-connections/entities/platform-connection.entity';
import { BrandKit } from '../assets/entities/brand-kit.entity';
import { AccountsService } from '../accounts/accounts.service';
import { StreamsService } from '../streams/streams.service';
import { LiveStream } from '../streams/entities/live-stream.entity';

/** Presets an account can keep. */
export const MAX_PRESETS_PER_ACCOUNT = 20;

const QUALITY_ORDER: PresetQuality[] = ['sd', 'hd', 'fhd', 'qhd'];

export interface PresetView {
  id: string;
  name: string;
  config: PresetConfig;
  lastUsedAt: Date | null;
}

/** What /use and /start add: the config as it applies today (plan limits, deleted destinations/kits) and why it differs. */
export interface PresetUseView extends PresetView {
  effectiveConfig: PresetConfig;
  warnings: string[];
}

const toView = (p: StreamPreset): PresetView => ({ id: p.id, name: p.name, config: p.config ?? {}, lastUsedAt: p.lastUsedAt });

/** Drops undefined/null noise so the stored document only has what the host chose. Unknown keys never get here (the DTO rejects them). */
export function cleanConfig(dto: PresetConfigDto): PresetConfig {
  const out: PresetConfig = {};
  if (dto.orientation) out.orientation = dto.orientation;
  if (dto.destinationIds) out.destinationIds = [...new Set(dto.destinationIds)];
  if (dto.brandKitId !== undefined) out.brandKitId = dto.brandKitId;
  if (dto.quality) out.quality = dto.quality;
  if (typeof dto.tickerEnabled === 'boolean') out.tickerEnabled = dto.tickerEnabled;
  if (typeof dto.tickerText === 'string') out.tickerText = dto.tickerText;
  return out;
}

/** Lowers a quality to the plan's best one. Returns the quality to use and whether it was lowered. */
export function clampQuality(wanted: PresetQuality, max: PresetQuality): { quality: PresetQuality; lowered: boolean } {
  return QUALITY_ORDER.indexOf(wanted) > QUALITY_ORDER.indexOf(max) ? { quality: max, lowered: true } : { quality: wanted, lowered: false };
}

@Injectable()
export class PresetsService {
  constructor(
    @InjectRepository(StreamPreset) private readonly presets: Repository<StreamPreset>,
    @InjectRepository(PlatformConnection) private readonly connections: Repository<PlatformConnection>,
    @InjectRepository(BrandKit) private readonly kits: Repository<BrandKit>,
    private readonly accounts: AccountsService,
    private readonly streams: StreamsService,
  ) {}

  /** Last used first, never-used after (newest first among those). */
  async list(accountId: string): Promise<PresetView[]> {
    const rows = await this.presets
      .createQueryBuilder('p')
      .where('p.account_id = :accountId', { accountId })
      .orderBy('p.last_used_at', 'DESC', 'NULLS LAST')
      .addOrderBy('p.created_at', 'ASC')
      .getMany();
    return rows.map(toView);
  }

  async create(accountId: string, dto: CreatePresetDto): Promise<PresetView> {
    const count = await this.presets.count({ where: { accountId } });
    if (count >= MAX_PRESETS_PER_ACCOUNT) {
      throw new ConflictException(`You can keep up to ${MAX_PRESETS_PER_ACCOUNT} presets. Delete one to save another.`);
    }
    const config = cleanConfig(dto.config);
    await this.assertOwned(accountId, config);
    const saved = await this.presets.save(this.presets.create({ accountId, name: dto.name.trim(), config }));
    return toView(saved);
  }

  async update(accountId: string, id: string, dto: UpdatePresetDto): Promise<PresetView> {
    const preset = await this.findOrThrow(accountId, id);
    if (dto.name !== undefined) preset.name = dto.name.trim();
    if (dto.config !== undefined) {
      const config = cleanConfig(dto.config);
      await this.assertOwned(accountId, config);
      preset.config = config;
    }
    return toView(await this.presets.save(preset));
  }

  async remove(accountId: string, id: string): Promise<void> {
    const preset = await this.findOrThrow(accountId, id);
    await this.presets.delete({ id: preset.id, accountId });
  }

  /** Marks the preset as just used and says what it means for this account today. */
  async use(accountId: string, id: string): Promise<PresetUseView> {
    const preset = await this.findOrThrow(accountId, id);
    const resolved = await this.resolve(accountId, preset);
    preset.lastUsedAt = new Date();
    await this.presets.save(preset);
    return { ...toView(preset), ...resolved };
  }

  /**
   * Creates the stream exactly like POST /streams (plan limits, hours, destination count, one set of platform
   * broadcasts) with the preset's destinations and orientation. Quality, ticker and brand kit are studio settings, not
   * stream fields: they are returned (already checked against the plan) for the client to apply in its studio.
   */
  async start(accountId: string, id: string, dto: StartPresetDto): Promise<{ stream: LiveStream; preset: PresetUseView }> {
    const preset = await this.findOrThrow(accountId, id);
    const resolved = await this.resolve(accountId, preset);
    const destinationIds = resolved.effectiveConfig.destinationIds ?? [];
    if (destinationIds.length === 0) {
      throw new UnprocessableEntityException('Connect a YouTube, Facebook or Twitch destination before you go live.');
    }
    // Title: the one typed for this start, else the default title of the preset's brand kit (or of the destinations' kits when
    // the preset has none chosen), else the preset's name. A preset stores no title of its own. The kit choice also picks the
    // default description and the kit thumbnail: brandKitId omitted = automatic, null = "no kit", an id = that kit.
    const kitChoice = resolved.effectiveConfig.brandKitId;
    const stream = await this.streams.create(
      accountId,
      {
        title: dto.title?.trim() || undefined,
        orientation: resolved.effectiveConfig.orientation ?? 'landscape',
        destinationConnectionIds: destinationIds,
        ...(kitChoice !== undefined ? { thumbnailBrandKitId: kitChoice } : {}),
      },
      { fallbackTitle: preset.name },
    );
    // Stamp the use only once the stream exists, so a refused start (hours, destinations) does not reorder the list.
    preset.lastUsedAt = new Date();
    await this.presets.save(preset);
    return { stream, preset: { ...toView(preset), ...resolved } };
  }

  // ---- internals ----------------------------------------------------------------

  private async findOrThrow(accountId: string, id: string): Promise<StreamPreset> {
    const preset = await this.presets.findOne({ where: { id, accountId } });
    if (!preset) throw new NotFoundException('Preset not found');
    return preset;
  }

  /** Store-time checks: the destinations and the kit must be this account's (never another tenant's). */
  private async assertOwned(accountId: string, config: PresetConfig): Promise<void> {
    if (config.destinationIds && config.destinationIds.length > 0) {
      const found = await this.connections.count({ where: { id: In(config.destinationIds), accountId, isActive: true } });
      if (found !== config.destinationIds.length) {
        throw new UnprocessableEntityException('One or more destinationIds do not belong to this account');
      }
    }
    if (config.brandKitId) {
      const kit = await this.kits.count({ where: { id: config.brandKitId, accountId } });
      if (kit === 0) throw new UnprocessableEntityException('brandKitId does not belong to this account');
    }
  }

  /**
   * Use-time checks. Things change after a preset is saved (a channel disconnected, a kit deleted, a plan
   * downgraded), so the stored config is re-checked against today's account every time it is used.
   */
  private async resolve(accountId: string, preset: StreamPreset): Promise<{ effectiveConfig: PresetConfig; warnings: string[] }> {
    const config = preset.config ?? {};
    const warnings: string[] = [];
    const effective: PresetConfig = { ...config };

    // Destinations: the saved ones that still exist; none saved = every connected destination.
    const active = await this.connections.find({ where: { accountId, isActive: true }, select: ['id'] });
    const activeIds = new Set(active.map((c) => c.id));
    if (config.destinationIds && config.destinationIds.length > 0) {
      const still = config.destinationIds.filter((d) => activeIds.has(d));
      if (still.length < config.destinationIds.length) {
        warnings.push('Some destinations in this preset are no longer connected and were skipped.');
      }
      effective.destinationIds = still;
    } else {
      effective.destinationIds = active.map((c) => c.id);
    }

    const limits = await this.accounts.getLimits(accountId);

    if (config.quality) {
      const { quality, lowered } = clampQuality(config.quality, limits.maxResolution);
      effective.quality = quality;
      if (lowered) warnings.push(`Your plan allows up to ${limits.maxResolution.toUpperCase()}; quality was lowered from ${config.quality.toUpperCase()}.`);
    }

    if (config.brandKitId) {
      const kit = limits.assetStorageMb > 0 ? await this.kits.count({ where: { id: config.brandKitId, accountId } }) : 0;
      if (kit === 0) {
        effective.brandKitId = null;
        warnings.push(
          limits.assetStorageMb > 0
            ? 'The brand kit of this preset no longer exists, so none was applied.'
            : 'Brand kits are on the paid plans, so the preset\'s kit was not applied.',
        );
      }
    }

    return { effectiveConfig: effective, warnings };
  }
}
