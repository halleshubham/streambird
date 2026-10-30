import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { Repository } from 'typeorm';
import { PlatformConnection } from './entities/platform-connection.entity';
import { LiveStreamDestination } from '../streams/entities/live-stream-destination.entity';
import { channelUrlFor, isPlausibleLiveSlug, LiveLinkCandidate, pickLiveWatchUrl, platformHasLiveLink } from './live-link';

/**
 * The permanent live link: GET /stream/:slug at the site root (not under /api; see app.setup.ts and the exclude
 * list in app.module.ts so the SPA fallback never swallows it). Public and unauthenticated by design: the slug
 * is the capability, and the response is only ever a 302 to a URL the server builds (a stored watch URL or the
 * public channel/page URL), never account data. Unknown slugs go to the site home.
 */
@Controller()
export class LiveLinkController {
  constructor(
    @InjectRepository(PlatformConnection) private readonly connections: Repository<PlatformConnection>,
    @InjectRepository(LiveStreamDestination) private readonly destinations: Repository<LiveStreamDestination>,
  ) {}

  @Get('stream/:slug')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async open(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const target = await this.resolve(slug);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target ?? '/');
  }

  /** Where the slug points right now, or null when it is unknown / the connection was removed. */
  async resolve(slug: string): Promise<string | null> {
    if (!isPlausibleLiveSlug(slug)) return null;
    const connection = await this.connections.findOne({ where: { liveSlug: slug, isActive: true } });
    if (!connection || !platformHasLiveLink(connection.platform)) return null;

    const rows = await this.destinations
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.liveStream', 's')
      .where('d.platform_connection_id = :id', { id: connection.id })
      .andWhere("s.status = 'live'")
      .andWhere("d.status = 'live'")
      .andWhere('d.watch_url IS NOT NULL')
      .orderBy('d.created_at', 'DESC')
      .limit(5)
      .getMany();
    const candidates: LiveLinkCandidate[] = rows.map((d) => ({
      watchUrl: d.watchUrl,
      destinationStatus: d.status,
      streamStatus: d.liveStream.status,
      createdAt: d.createdAt,
    }));
    return pickLiveWatchUrl(candidates) ?? channelUrlFor(connection.platform, connection.externalAccountId);
  }
}
