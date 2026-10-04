import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveStream } from './entities/live-stream.entity';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { StreamsService } from './streams.service';
import { AccountsService } from '../accounts/accounts.service';

const CHECK_INTERVAL_MS = 60_000;

/**
 * Ends a live stream that has run longer than its plan's max session length
 * (Plan.maxSessionHours; null = no cap). Polled once a minute -- the number of
 * concurrent live streams is small and a minute of slack on a multi-hour cap
 * is irrelevant. Ending goes through StreamsService.end() like any other end,
 * so platform broadcasts are closed and hours billed normally.
 */
@Injectable()
export class SessionLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionLimitService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(LiveStream) private readonly liveStreams: Repository<LiveStream>,
    private readonly streamsService: StreamsService,
    private readonly accountsService: AccountsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.enforce(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Public for tests. */
  async enforce(now: Date = new Date()): Promise<number> {
    let ended = 0;
    try {
      const live = await this.liveStreams.find({ where: { status: StreamStatus.LIVE } });
      const limitsByAccount = new Map<string, number | null>();
      for (const stream of live) {
        if (!stream.startedAt) continue;
        if (!limitsByAccount.has(stream.accountId)) {
          const limits = await this.accountsService.getLimits(stream.accountId);
          limitsByAccount.set(stream.accountId, limits.maxSessionHours);
        }
        const cap = limitsByAccount.get(stream.accountId);
        if (cap === null || cap === undefined) continue;
        const hours = (now.getTime() - stream.startedAt.getTime()) / 3_600_000;
        if (hours >= cap) {
          this.logger.log(`Ending stream ${stream.id}: ran ${hours.toFixed(2)}h, plan session cap is ${cap}h`);
          await this.streamsService.end(stream.id, stream.accountId);
          ended++;
        }
      }
    } catch (err) {
      this.logger.warn(`Session limit check failed: ${(err as Error).message}`);
    }
    return ended;
  }
}
