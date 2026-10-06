import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/**
 * Self-hosted MediaMTX instance, used as the universal WHIP publish
 * front-door for the browser host studio.
 *
 * Why this exists: Cloudflare's WHIP ingest doesn't (as of this writing)
 * transcode into any other downstream format -- RTMP simulcast to Twitch/
 * YouTube and Cloudflare's own hosted player both stayed dark for a
 * WHIP-sourced live input, confirmed by Cloudflare support. RTMP ingest,
 * on the other hand, has always worked correctly. Mux has no WHIP ingest
 * at all. So instead of publishing WHIP directly to a RelayProvider, the
 * host's browser always publishes WHIP to this MediaMTX instance, which
 * forwards the same stream onward as RTMP -- directly to every ready
 * destination's own ingest (Twitch etc.), and additionally to a
 * RelayProvider's ingest if one is configured (see StreamsService.create(),
 * which checks RelayProvider.isConfigured()). A RelayProvider is therefore
 * no longer in the platform-delivery critical path at all; it's an optional
 * extra forward used only for its own features (hosted preview, recording).
 * If/when Cloudflare ships a WHIP ingest that itself transcodes correctly,
 * this whole MediaMTX hop can be dropped in favor of publishing WHIP
 * straight to it -- keep this service's boundary clean for that.
 *
 * The RTMP push itself goes through a `runOnReady` ffmpeg command, not
 * MediaMTX's own built-in `forward` field -- confirmed live (2026-09-30)
 * that `forward` gets an instant EOF from both Twitch and Cloudflare, TLS
 * and non-TLS alike, while a plain ffmpeg RTMP push from the same host with
 * the same key works perfectly. RTMP/FLV has no codec slot for Opus (only
 * Enhanced-RTMP-aware receivers accept it), and WHIP's audio is always
 * Opus, so every native `forward` attempt was rejected before a single
 * frame went out. ffmpeg pulls the path back over local RTSP and
 * transcodes audio only (video stays `-c:v copy`) to fix that, teeing to
 * every destination in one process. This needs the "-ffmpeg" image variant
 * (see docker-compose.yaml) -- the default image has neither a shell nor
 * ffmpeg, and `runOnReady` is just a shell command.
 *
 * Each LiveStream gets its own MediaMTX path (named after the stream's own
 * id), registered/removed at runtime via MediaMTX's Control API rather
 * than static config, since the RTMP forward destinations (each
 * destination's ingest URL + per-stream key) are only known once
 * StreamsService.create() has resolved them.
 */
@Injectable()
export class MediaMtxService {
  private readonly logger = new Logger(MediaMtxService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private get apiUrl(): string {
    return this.config.get<string>('mediamtx.apiUrl') ?? '';
  }

  private get authConfig() {
    return {
      auth: {
        username: this.config.get<string>('mediamtx.apiUser') ?? '',
        password: this.config.get<string>('mediamtx.apiPassword') ?? '',
      },
    };
  }

  /**
   * Wraps a value in single quotes for safe interpolation into the shell
   * command line MediaMTX runs for `runOnReady` -- every rtmpDest is
   * provider-returned data (a platform's ingest URL/key), not something we
   * fully control, so it crosses a real shell-injection boundary here.
   * Single-quoting neutralizes every shell metacharacter except a literal
   * single quote, which this escapes the standard POSIX way.
   */
  private shQuote(value: string): string {
    return `'${value.split("'").join(`'\\''`)}'`;
  }

  /**
   * Builds the `runOnReady` command that pulls this path back over its own
   * local RTSP server and tees an audio-transcoded (video copied) RTMP push
   * to every destination -- see the class doc for why this replaces
   * MediaMTX's native `forward`. Returns null if no destination has a
   * scheme we're willing to hand to a shell command at all.
   */
  buildRunOnReady(rtmpDests: string[]): string | null {
    const validDests = rtmpDests.filter((dest) => /^rtmps?:\/\//i.test(dest));
    if (validDests.length !== rtmpDests.length) {
      this.logger.warn(
        `Dropped ${rtmpDests.length - validDests.length} forward destination(s) with an unexpected URL scheme`,
      );
    }
    if (validDests.length === 0) return null;

    const teeTargets = validDests.map((dest) => `[f=flv]${dest}`).join('|');
    return [
      'ffmpeg -nostdin -loglevel warning',
      // This RTSP hop is loopback-only, but MediaMTX's RTSP server defaults
      // to UDP -- under real load (this ffmpeg process, the room-monitor
      // WebRTC connections, etc.) that loopback UDP started dropping
      // packets, confirmed live (2026-10-01) via repeated "RTP: missed N
      // packets", which cascaded into "non-existing PPS 0 referenced" and
      // non-monotonic DTS -- corrupt enough that Twitch's player couldn't
      // decode it. TCP retransmits; on loopback the overhead is negligible.
      '-rtsp_transport tcp',
      // Confirmed live (2026-10-01, revisited 2026-10-03): ffmpeg can fail
      // to find a usable keyframe and give up with "Could not find codec
      // parameters... unspecified size" -- not from arriving *late* (a
      // generous -analyzeduration/-probesize budget here didn't fix it),
      // but because an ordinary bit of internet packet loss on the WHIP
      // leg corrupted one of its RTP fragments ("invalid FU-A packet
      // (non-starting)" in MediaMTX's own logs) -- a keyframe is large
      // enough to need several RTP packets, so losing any single one of
      // them corrupts the whole keyframe, and no amount of waiting
      // recovers data that was never received intact. Confirmed live
      // (2026-10-03): each failed attempt was taking 60-90+ seconds of
      // dead air to every destination before runOnReadyRestart got a
      // chance to retry -- the generous 10M budget was making a bad
      // attempt die *slower*, not helping it succeed. goLive() forces a
      // fresh keyframe every 2s, so a short timeout here just means a bad
      // attempt fails fast and the next restart gets a fresh shot at an
      // intact one, instead of a single attempt burning a minute-plus on
      // a keyframe that was already lost.
      '-timeout 5000000',
      '-analyzeduration 3M -probesize 3M',
      '-i "rtsp://127.0.0.1:$RTSP_PORT/$MTX_PATH"',
      // The tee muxer needs explicit maps -- without them it fails with
      // "Output file does not contain any stream" as soon as there's more
      // than one tee branch, confirmed live (2026-09-30).
      '-map 0:v:0 -map 0:a:0',
      '-c:v copy -c:a aac -b:a 128k',
      `-f tee ${this.shQuote(teeTargets)}`,
    ].join(' ');
  }

  /** MediaMTX path name for a stream's "technical glitch" slate pusher -- see startSlate(). */
  static slatePathName(pathName: string): string {
    return `${pathName}-slate`;
  }

  /**
   * Builds the ffmpeg command for the "technical difficulties" slate: a
   * looped still image + silent audio, libx264/aac encoded and teed to the
   * same RTMP destinations the real forward uses, so every platform keeps
   * receiving data (and the broadcast stays up) while the host's publisher
   * is gone.
   *
   * Two modes by file type. The default is a pre-encoded 10s H.264 loop
   * (glitch-slate.mp4: 720p30, keyframe every 2s, a whole number of GOPs so
   * it loops cleanly) that is simply copied: ~3% of a core per slate, which
   * matters because a network blip drops many streams to the slate at once.
   * `-tag:v 7` is needed because the tee muxer, unlike a plain ffmpeg
   * output, doesn't remap MP4's 'avc1' tag for FLV. A still image (.png/
   * .jpg, e.g. an old GLITCH_SLATE_URL override) falls back to encoding it
   * with libx264, which measured ~45% of a core each.
   * The file is fetched over HTTP(S) from this app's own public URL
   * (see slateUrl) -- the MediaMTX container has no fonts for ffmpeg's
   * drawtext and no volume we control, but it can always reach the public
   * internet (it already pushes RTMPS out).
   */
  private buildSlateCommand(rtmpDests: string[], slateUrl: string, orientation: 'landscape' | 'portrait' = 'landscape'): string | null {
    const validDests = rtmpDests.filter((dest) => /^rtmps?:\/\//i.test(dest));
    if (validDests.length === 0 || !/^https?:\/\//i.test(slateUrl)) return null;

    const teeTargets = validDests.map((dest) => `[f=flv]${dest}`).join('|');
    const tee = `-f tee ${this.shQuote(teeTargets)}`;
    const silence = '-f lavfi -i anullsrc=r=48000:cl=stereo';
    const isStillImage = /\.(png|jpe?g)(\?|$)/i.test(slateUrl);

    // Still image: encode it (the original behaviour).
    const encodeStill = (url: string) =>
      [
        'exec ffmpeg -nostdin -loglevel warning',
        `-re -loop 1 -framerate 30 -i ${this.shQuote(url)}`,
        silence,
        '-map 0:v:0 -map 1:a:0',
        '-c:v libx264 -preset veryfast -tune stillimage -pix_fmt yuv420p -r 30 -g 60 -b:v 1500k -maxrate 1500k -bufsize 3000k',
        '-c:a aac -b:a 64k',
        tee,
      ].join(' ');
    if (isStillImage) return encodeStill(slateUrl);

    // Pre-encoded loop. ffmpeg can only `-stream_loop` a seekable input, and
    // this app is served through Cloudflare, which does not honour Range
    // requests for it -- so fetch the clip once into a local file (atomically
    // replaced, so a slate already looping from the old copy is unaffected)
    // and loop that. If the fetch or the local /tmp fails, fall back to
    // encoding the same-named .png so a slate always starts.
    // One cached copy per orientation: a landscape and a portrait stream can be on their slates at once.
    const suffix = orientation === 'portrait' ? '-portrait' : '';
    const local = `/tmp/glitch-slate${suffix}.mp4`;
    const part = `/tmp/.glitch-slate${suffix}.$$.mp4`;
    const fetchClip = `ffmpeg -nostdin -loglevel error -y -i ${this.shQuote(slateUrl)} -c copy -f mp4 ${part} && mv -f ${part} ${local}`;
    const loopClip = [
      'exec ffmpeg -nostdin -loglevel warning',
      `-re -stream_loop -1 -i ${local}`,
      silence,
      '-map 0:v:0 -map 1:a:0',
      '-c:v copy -tag:v 7',
      '-c:a aac -b:a 64k',
      tee,
    ].join(' ');
    const fallbackPng = slateUrl.replace(/\.[a-z0-9]+(\?|$)/i, '.png$1');
    return `if ${fetchClip}; then ${loopClip}; else ${encodeStill(fallbackPng)}; fi`;
  }

  /**
   * The slate must have the same shape as the stream: a 16:9 slate dropped into a vertical
   * stream (or the reverse) changes the video size mid-broadcast, which platforms handle badly.
   */
  private slateUrlFor(orientation: 'landscape' | 'portrait'): string {
    const portrait = orientation === 'portrait';
    const override = this.config.get<string>(portrait ? 'mediamtx.slatePortraitUrl' : 'mediamtx.slateUrl');
    if (override) return override;
    const base = (this.config.get<string>('publicBaseUrl') ?? '').replace(/\/$/, '');
    return `${base}/${portrait ? 'glitch-slate-portrait.mp4' : 'glitch-slate.mp4'}`;
  }

  /**
   * Starts pushing the "technical glitch" slate to every destination, via a
   * dedicated `<path>-slate` MediaMTX path whose `runOnInit` command runs
   * for as long as the path exists (deleting the path -- see stopSlate --
   * stops ffmpeg). Idempotent: an already-existing slate path is left
   * running. Returns whether a slate is now running; best-effort, never throws.
   */
  async startSlate(pathName: string, rtmpDests: string[], orientation: 'landscape' | 'portrait' = 'landscape'): Promise<boolean> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return false;

    const runOnInit = this.buildSlateCommand(rtmpDests, this.slateUrlFor(orientation), orientation);
    if (!runOnInit) return false;

    try {
      await firstValueFrom(
        this.http.post(
          `${apiUrl}/v3/config/paths/add/${MediaMtxService.slatePathName(pathName)}`,
          { runOnInit, runOnInitRestart: true },
          this.authConfig,
        ),
      );
      return true;
    } catch (err) {
      // MediaMTX answers 400 "path already exists" if a slate is already running.
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 400) return true;
      this.logger.warn(`Failed to start slate for '${pathName}': ${(err as Error).message}`);
      return false;
    }
  }

  /** Stops the slate pusher, if any. Best-effort: a missing path (404) is fine. */
  async stopSlate(pathName: string): Promise<void> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return;

    try {
      await firstValueFrom(
        this.http.delete(
          `${apiUrl}/v3/config/paths/delete/${MediaMtxService.slatePathName(pathName)}`,
          this.authConfig,
        ),
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status !== 404) {
        this.logger.warn(`Failed to stop slate for '${pathName}': ${(err as Error).message}`);
      }
    }
  }

  /**
   * Every currently-active MediaMTX path and whether it has a live source
   * (`ready`) -- a configured path with no publisher connected isn't in the
   * list at all. Returns null if MediaMTX is unreachable, so callers can
   * tell "nobody is publishing" apart from "couldn't ask" and avoid acting
   * on a monitoring blip.
   */
  async listPaths(): Promise<Map<string, boolean> | null> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return null;

    try {
      const res = await firstValueFrom(
        this.http.get<{ items?: Array<{ name: string; ready?: boolean }> }>(
          `${apiUrl}/v3/paths/list?itemsPerPage=1000`,
          this.authConfig,
        ),
      );
      return new Map((res.data?.items ?? []).map((item) => [item.name, item.ready === true]));
    } catch (err) {
      this.logger.warn(`Failed to list MediaMTX paths: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Registers a path that accepts a WHIP publisher and forwards it to every
   * URL in rtmpDests, and returns the public WHIP URL the host's browser
   * should publish to. Best-effort: returns null (never throws) if MediaMTX
   * isn't configured, unreachable, or given no usable destinations, so a
   * MediaMTX outage degrades to "no browser-studio publish available"
   * rather than failing stream creation outright -- OBS/RTMP-direct ingest
   * doesn't depend on this at all.
   */
  async registerForward(pathName: string, rtmpDests: string[]): Promise<string | null> {
    const apiUrl = this.apiUrl;
    const whipBaseUrl = this.config.get<string>('mediamtx.whipBaseUrl');
    if (!apiUrl || !whipBaseUrl || rtmpDests.length === 0) return null;

    const runOnReady = this.buildRunOnReady(rtmpDests);
    if (!runOnReady) return null;

    try {
      await firstValueFrom(
        this.http.post(
          `${apiUrl}/v3/config/paths/add/${pathName}`,
          { source: 'publisher', runOnReady, runOnReadyRestart: true },
          this.authConfig,
        ),
      );
      return `${whipBaseUrl.replace(/\/$/, '')}/${pathName}/whip`;
    } catch (err) {
      this.logger.warn(`Failed to register MediaMTX forward path '${pathName}': ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Replaces the forward destinations on an already-registered path -- e.g.
   * after retryDestination() mints a fresh ingest URL/key for one
   * destination. Callers must pass the complete desired list, not just the
   * one entry that changed. Best-effort, same as registerForward.
   */
  async updateForward(pathName: string, rtmpDests: string[]): Promise<void> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return;

    try {
      await firstValueFrom(
        this.http.patch(
          `${apiUrl}/v3/config/paths/patch/${pathName}`,
          { runOnReady: this.buildRunOnReady(rtmpDests) ?? '', runOnReadyRestart: true },
          this.authConfig,
        ),
      );
    } catch (err) {
      this.logger.warn(`Failed to update MediaMTX forward destinations for path '${pathName}': ${(err as Error).message}`);
    }
  }

  /** Best-effort: a stream ending shouldn't fail because cleanup couldn't reach MediaMTX. */
  async removeForward(pathName: string): Promise<void> {
    const apiUrl = this.apiUrl;
    if (!apiUrl) return;

    // A running glitch slate must never outlive the stream it belongs to.
    await this.stopSlate(pathName);

    try {
      await firstValueFrom(
        this.http.delete(`${apiUrl}/v3/config/paths/delete/${pathName}`, this.authConfig),
      );
    } catch (err) {
      this.logger.warn(`Failed to remove MediaMTX forward path '${pathName}': ${(err as Error).message}`);
    }
  }
}
