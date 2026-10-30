// What the host is actually SENDING to the platforms. The server only copies
// the video (-c:v copy), so whatever the browser's WebRTC encoder produces is
// what YouTube/Facebook/Twitch get -- and Chrome silently scales the picture
// down when bandwidth or CPU is short. This file reads that out of
// RTCRtpSender.getStats() and classifies it. Pure and defensive: it never throws.

export type PicturePriority = 'balanced' | 'maintain-resolution';

export interface SendSample {
  width: number;
  height: number;
  fps: number;
  /** null until two samples exist to take a delta from. */
  bitrateBps: number | null;
  limitationReason: string | null;
}

export interface SendQuality {
  state: 'ok' | 'limited';
  /** "Sending 1280x720 - 30 fps - 3.1 Mbps" */
  summary: string;
  /** Plain-language advice, only when limited. */
  message: string | null;
}

/** A sent picture shorter than this share of the chosen size counts as scaled down. */
export const SCALED_DOWN_RATIO = 0.75;

export function formatBitrate(bps: number | null): string {
  if (bps === null || !Number.isFinite(bps) || bps < 0) return '-- Mbps';
  return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

export function classifySendQuality(
  sample: SendSample,
  expected: { width: number; height: number },
  opts: { warmingUp?: boolean } = {},
): SendQuality {
  const summary = `Sending ${sample.width}x${sample.height} - ${Math.round(sample.fps)} fps - ${formatBitrate(sample.bitrateBps)}`;
  if (sample.limitationReason === 'bandwidth') {
    return { state: 'limited', summary, message: 'Your connection is limiting quality. Try 720p or a wired network.' };
  }
  if (sample.limitationReason === 'cpu') {
    return { state: 'limited', summary, message: 'Your computer is struggling. Try a lower quality or close other tabs.' };
  }
  // Compare the short side so a vertical (9:16) stream is judged the same way as a landscape one.
  const sentShort = Math.min(sample.width, sample.height);
  const wantShort = Math.min(expected.width, expected.height);
  if (!opts.warmingUp && sentShort > 0 && wantShort > 0 && sentShort < wantShort * SCALED_DOWN_RATIO) {
    return { state: 'limited', summary, message: `The picture is being sent smaller than the ${wantShort}p you chose. Try a lower quality or a wired network.` };
  }
  return { state: 'ok', summary, message: null };
}

type StatsLike = { forEach: (cb: (r: Record<string, unknown>) => void) => void };

/** Pulls the video outbound-rtp entry out of a getStats() report; null when there is none yet. */
export function readOutboundVideo(report: unknown): { sample: Omit<SendSample, 'bitrateBps'>; bytesSent: number; timestamp: number } | null {
  try {
    let found: Record<string, unknown> | null = null;
    (report as StatsLike).forEach((r) => {
      const kind = (r.kind ?? r.mediaType) as string | undefined;
      if (!found && r.type === 'outbound-rtp' && kind === 'video') found = r;
    });
    if (!found) return null;
    const r = found as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const width = num(r.frameWidth);
    const height = num(r.frameHeight);
    if (!width || !height) return null;
    const reason = typeof r.qualityLimitationReason === 'string' && r.qualityLimitationReason !== 'none' ? r.qualityLimitationReason : null;
    return {
      sample: { width, height, fps: num(r.framesPerSecond), limitationReason: reason },
      bytesSent: num(r.bytesSent),
      timestamp: num(r.timestamp),
    };
  } catch {
    return null;
  }
}

/** bits/s between two readings; null when it cannot be worked out. */
export function bitrateBetween(prev: { bytesSent: number; timestamp: number } | null, cur: { bytesSent: number; timestamp: number }): number | null {
  if (!prev || cur.timestamp <= prev.timestamp || cur.bytesSent < prev.bytesSent) return null;
  return ((cur.bytesSent - prev.bytesSent) * 8 * 1000) / (cur.timestamp - prev.timestamp);
}
