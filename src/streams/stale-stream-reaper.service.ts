import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MediaMtxService } from '../relay/mediamtx.service';
import { StreamsService } from './streams.service';
import { GlitchRecoveryService } from './glitch-recovery.service';
import { LiveStream } from './entities/live-stream.entity';
import { StreamStatus } from '../common/enums/stream-status.enum';

/** What the reaper remembers per live stream (in memory; rebuilt after a restart). */
interface Seen {
  /** When the reaper first looked at this stream (to tell "never published" from "unknown history after a restart"). */
  firstSeenAt: number;
  /** A publisher has been ready for this stream at some point while we were watching. */
  everReady: boolean;
  /** Last inbound byte counter and when it last advanced (frozen-publisher detection). */
  lastBytes: number | null;
  lastAdvanceAt: number;
}

/**
 * Ends streams that are marked LIVE but have no picture, so they stop showing as live (and stop confusing the
 * host's dashboard and the Android app's "still live" card).
 *
 *  1. NEVER PUBLISHED: no publisher was ever ready for the stream within STALE_STREAM_NO_PUBLISHER_MINUTES of
 *     going live (the app crashed or the host walked away). Billed no hours when we watched it from the start.
 *  2. FROZEN: a publisher is connected but its inbound byte counter has not moved for STALE_STREAM_FROZEN_MINUTES
 *     (the encoder stalled; viewers see nothing). Billed up to the last time data moved.
 *
 * A publisher that was seen and then vanished is NOT handled here: GlitchRecoveryService shows the slate and ends
 * the stream after its own window. Streams without a MediaMTX path (OBS to a relay) and a MediaMTX that cannot be
 * reached are never touched. State is in memory (single backend process, see CLAUDE.md rule 9).
 */
@Injectable()
export class StaleStreamReaperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleStreamReaperService.name);
  private readonly seen = new Map<string, Seen>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private warnedNoCounter = false;

  constructor(
    private readonly config: ConfigService,
    private readonly mediaMtx: MediaMtxService,
    private readonly streamsService: StreamsService,
    private readonly glitchRecovery: GlitchRecoveryService,
    @InjectRepository(LiveStream)
    private readonly liveStreams: Repository<LiveStream>,
  ) {}

  private get settings() {
    return {
      enabled: this.config.get<boolean>('staleStreams.enabled') ?? true,
      noPublisherMs: (this.config.get<number>('staleStreams.noPublisherMinutes') ?? 30) * 60_000,
      frozenMs: (this.config.get<number>('staleStreams.frozenMinutes') ?? 5) * 60_000,
      checkMs: (this.config.get<number>('staleStreams.checkSeconds') ?? 30) * 1000,
    };
  }

  onModuleInit() {
    const { enabled, checkMs } = this.settings;
    if (!enabled) return;
    this.timer = setInterval(() => void this.tick(), checkMs);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: number = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { noPublisherMs, frozenMs } = this.settings;
      const stats = await this.mediaMtx.listPathStats();
      if (!stats) return; // can't see MediaMTX: never act on a monitoring blip

      const live = await this.liveStreams.find({ where: { status: StreamStatus.LIVE } });
      const liveIds = new Set(live.map((s) => s.id));
      for (const id of [...this.seen.keys()]) if (!liveIds.has(id)) this.seen.delete(id);

      for (const stream of live) {
        if (!stream.whipUrl) continue; // no MediaMTX path (e.g. a relay ingest): nothing to measure
        const st = stats.get(stream.id);
        let entry = this.seen.get(stream.id);
        if (!entry) {
          entry = { firstSeenAt: now, everReady: false, lastBytes: null, lastAdvanceAt: now };
          this.seen.set(stream.id, entry);
        }

        if (st?.ready) {
          entry.everReady = true;
          if (st.inboundBytes === null) {
            if (!this.warnedNoCounter && frozenMs > 0) {
              this.warnedNoCounter = true;
              this.logger.warn('MediaMTX path stats carry no byte counter (inboundBytes/bytesReceived): frozen-publisher detection is off');
            }
            continue;
          }
          if (entry.lastBytes === null || st.inboundBytes > entry.lastBytes) {
            entry.lastBytes = st.inboundBytes;
            entry.lastAdvanceAt = now;
          } else if (frozenMs > 0 && now - entry.lastAdvanceAt >= frozenMs) {
            await this.endStream(stream, `Ended automatically: no video data arrived for ${Math.round(frozenMs / 60_000)} minutes.`, new Date(entry.lastAdvanceAt));
          }
          continue;
        }

        // Not publishing right now. A stream that WAS publishing belongs to the glitch recovery (slate, then its own end).
        if (entry.everReady || this.glitchRecovery.isWatching(stream.id)) continue;
        const wentLiveAt = (stream.startedAt ?? stream.createdAt)?.getTime?.() ?? entry.firstSeenAt;
        if (noPublisherMs > 0 && now - wentLiveAt >= noPublisherMs) {
          // Bill nothing when we have watched it from (almost) the start and never saw a picture; with no history
          // (backend restarted since) bill normally rather than guess.
          const watchedFromStart = entry.firstSeenAt - wentLiveAt <= 2 * this.settings.checkMs;
          await this.endStream(
            stream,
            `Ended automatically: no video arrived within ${Math.round(noPublisherMs / 60_000)} minutes of going live.`,
            watchedFromStart ? new Date(wentLiveAt) : undefined,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Stale-stream check failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async endStream(stream: LiveStream, reason: string, usageUntil?: Date) {
    this.seen.delete(stream.id);
    try {
      await this.streamsService.end(stream.id, stream.accountId, { reason, usageUntil });
      this.logger.log(`Auto-ended stream ${stream.id}: ${reason}`);
    } catch (err) {
      this.logger.warn(`Could not auto-end stream ${stream.id}: ${(err as Error).message}`);
    }
  }
}
