import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MediaMtxService } from '../relay/mediamtx.service';
import { StreamsService } from './streams.service';
import { LiveStream } from './entities/live-stream.entity';
import { StreamStatus } from '../common/enums/stream-status.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';

/** How long a dropped host has to come back before the stream is really ended. */
export const GLITCH_WINDOW_MS = 5 * 60_000;
/**
 * How long the publisher must be missing before the slate kicks in -- long
 * enough that a WHIP renegotiation or a very brief network blip never
 * flashes the slate at viewers.
 */
export const GLITCH_DEBOUNCE_MS = 10_000;
/** Polled fast on purpose: the slate must stop within ~2s of the host coming back, or its RTMP connection collides with the resumed real forward's. */
const POLL_INTERVAL_MS = 2_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WatchedStream {
  /** Last time MediaMTX reported this stream's publisher path as ready. */
  lastReadyAt: number;
  /** Set while the slate is being pushed in place of the missing host. */
  glitchStartedAt?: number;
}

/**
 * "Technical difficulties" recovery for a host who vanishes without using
 * End stream (closed tab, crash, lost connection).
 *
 * Without this, the host's WHIP publish dropping meant every destination
 * went dark and the stream was ended 60s later. Now, once a stream that has
 * been publishing loses its publisher for GLITCH_DEBOUNCE_MS, a slate
 * (looped image + silence) is pushed to the same RTMP destinations --
 * keeping the platform broadcasts alive -- for up to GLITCH_WINDOW_MS. If
 * the host re-publishes with the same link in that window the slate stops
 * and the show resumes; otherwise the stream is ended exactly as before.
 *
 * Only streams whose publisher has been observed ready at least once are
 * watched: a stream that was created but never published to (host hasn't
 * pressed Go live yet) isn't a glitch. State is in memory; on a backend
 * restart, reconcile() rebuilds it from MediaMTX's own paths. An explicit
 * End stream needs no special handling here -- it removes the MediaMTX
 * paths (slate included) and marks the stream ENDED before this ever
 * decides to act.
 */
@Injectable()
export class GlitchRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlitchRecoveryService.name);
  private readonly watched = new Map<string, WatchedStream>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconciled = false;
  private ticking = false;

  constructor(
    private readonly mediaMtx: MediaMtxService,
    private readonly streamsService: StreamsService,
    @InjectRepository(LiveStream)
    private readonly liveStreams: Repository<LiveStream>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    // Never keep the process alive just for this poller (e.g. jest, shutdown).
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** True while this stream's publisher is being watched -- the host-disconnect auto-end defers to us for these. */
  isWatching(liveStreamId: string): boolean {
    return this.watched.has(liveStreamId);
  }

  async tick(now: number = Date.now()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const paths = await this.mediaMtx.listPaths();
      if (!paths) return; // can't see MediaMTX -- never act on a monitoring blip

      if (!this.reconciled) {
        await this.reconcile(paths, now);
        this.reconciled = true;
      }

      for (const [name, ready] of paths) {
        if (!ready || !UUID_RE.test(name)) continue;
        const entry = this.watched.get(name);
        if (!entry) {
          this.watched.set(name, { lastReadyAt: now });
          continue;
        }
        entry.lastReadyAt = now;
        if (entry.glitchStartedAt !== undefined) {
          // Host is back: stop the slate right away so its RTMP connection
          // doesn't collide with the resumed real forward's.
          await this.mediaMtx.stopSlate(name);
          delete entry.glitchStartedAt;
          this.logger.log(`Stream ${name} recovered -- publisher is back, slate stopped`);
        }
      }

      for (const [streamId, entry] of [...this.watched]) {
        if (paths.get(streamId) === true) continue;

        if (entry.glitchStartedAt !== undefined) {
          if (now - entry.glitchStartedAt >= GLITCH_WINDOW_MS) await this.giveUp(streamId);
        } else if (now - entry.lastReadyAt >= GLITCH_DEBOUNCE_MS) {
          await this.beginGlitch(streamId, entry, now);
        }
      }
    } catch (err) {
      this.logger.warn(`Glitch monitor tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Rebuilds in-memory state after a backend restart from what MediaMTX itself still has. */
  private async reconcile(paths: Map<string, boolean>, now: number) {
    for (const [name, ready] of paths) {
      if (name.endsWith('-slate')) {
        const streamId = name.slice(0, -'-slate'.length);
        const stream = UUID_RE.test(streamId) ? await this.liveStreams.findOne({ where: { id: streamId } }) : null;
        if (stream?.status === StreamStatus.LIVE) {
          // Fresh window -- the original start time was lost with the restart.
          this.watched.set(streamId, { lastReadyAt: now, glitchStartedAt: now });
        } else {
          await this.mediaMtx.stopSlate(streamId);
        }
      } else if (ready && UUID_RE.test(name) && !this.watched.has(name)) {
        this.watched.set(name, { lastReadyAt: now });
      }
    }
  }

  private async beginGlitch(streamId: string, entry: WatchedStream, now: number) {
    const stream = await this.liveStreams.findOne({ where: { id: streamId }, relations: ['destinations'] });
    if (!stream || stream.status !== StreamStatus.LIVE) {
      this.watched.delete(streamId); // ended normally (End stream) -- nothing to rescue
      return;
    }

    const dests = (stream.destinations ?? [])
      .filter((d) => d.ingestUrl && d.streamKey && (d.status === DestinationStatus.LIVE || d.status === DestinationStatus.READY))
      .map((d) => `${d.ingestUrl!.replace(/\/$/, '')}/${d.streamKey}`);
    if (stream.relayLiveInputId && stream.ingestUrl && stream.streamKey) {
      dests.push(`${stream.ingestUrl.replace(/\/$/, '')}/${stream.streamKey}`);
    }

    if (await this.mediaMtx.startSlate(streamId, dests, stream.orientation ?? 'landscape')) {
      entry.glitchStartedAt = now;
      this.logger.warn(`Stream ${streamId} lost its publisher -- showing slate for up to ${GLITCH_WINDOW_MS / 1000}s`);
    } else {
      this.logger.warn(`Stream ${streamId} lost its publisher but the slate could not be started`);
      this.watched.delete(streamId); // fall back to the host-disconnect auto-end
    }
  }

  private async giveUp(streamId: string) {
    this.watched.delete(streamId);
    try {
      const stream = await this.liveStreams.findOne({ where: { id: streamId } });
      if (stream?.status === StreamStatus.LIVE) {
        await this.streamsService.end(stream.id, stream.accountId); // also removes the slate path
        this.logger.log(`Auto-ended stream ${streamId} -- host never returned within ${GLITCH_WINDOW_MS / 1000}s`);
      } else {
        await this.mediaMtx.stopSlate(streamId);
      }
    } catch (err) {
      this.logger.warn(`Failed to auto-end stream ${streamId}: ${(err as Error).message}`);
    }
  }
}
