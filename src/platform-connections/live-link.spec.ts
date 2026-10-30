import { Platform } from '../common/enums/platform.enum';
import { DestinationStatus } from '../common/enums/destination-status.enum';
import { StreamStatus } from '../common/enums/stream-status.enum';
import {
  buildLiveLinkUrl,
  channelUrlFor,
  generateLiveSlug,
  isPlausibleLiveSlug,
  LIVE_SLUG_LENGTH,
  LiveLinkCandidate,
  pickLiveWatchUrl,
  platformHasLiveLink,
} from './live-link';

const cand = (o: Partial<LiveLinkCandidate>): LiveLinkCandidate => ({
  watchUrl: 'https://www.youtube.com/watch?v=a',
  destinationStatus: DestinationStatus.LIVE,
  streamStatus: StreamStatus.LIVE,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  ...o,
});

describe('live link slugs', () => {
  it('generates 10 lowercase base32 characters, all different draws', () => {
    const slugs = new Set(Array.from({ length: 500 }, () => generateLiveSlug()));
    expect(slugs.size).toBe(500);
    for (const s of slugs) {
      expect(s).toHaveLength(LIVE_SLUG_LENGTH);
      expect(s).toMatch(/^[a-z2-7]{10}$/);
      expect(isPlausibleLiveSlug(s)).toBe(true);
    }
  });

  it('rejects junk shapes and accepts backfilled hex slugs', () => {
    expect(isPlausibleLiveSlug('0123456789')).toBe(true);
    expect(isPlausibleLiveSlug('')).toBe(false);
    expect(isPlausibleLiveSlug('ABCDEFGHIJ')).toBe(false);
    expect(isPlausibleLiveSlug('../../etc')).toBe(false);
    expect(isPlausibleLiveSlug('a'.repeat(100))).toBe(false);
  });

  it('only YouTube and Facebook get a link', () => {
    expect(platformHasLiveLink(Platform.YOUTUBE)).toBe(true);
    expect(platformHasLiveLink(Platform.FACEBOOK)).toBe(true);
    expect(platformHasLiveLink(Platform.TWITCH)).toBe(false);
    expect(platformHasLiveLink(Platform.LINKEDIN)).toBe(false);
  });

  it('builds the URL from the public base without a double slash', () => {
    expect(buildLiveLinkUrl('https://streambird.app/', 'abc234defg')).toBe('https://streambird.app/stream/abc234defg');
    expect(buildLiveLinkUrl('http://localhost:3000', 'abc234defg')).toBe('http://localhost:3000/stream/abc234defg');
  });
});

describe('live link target selection', () => {
  it('is null when nothing is live', () => {
    expect(pickLiveWatchUrl([])).toBeNull();
  });

  it('ignores ended streams, non-live destinations and missing watch URLs', () => {
    expect(
      pickLiveWatchUrl([
        cand({ streamStatus: StreamStatus.ENDED }),
        cand({ streamStatus: StreamStatus.SCHEDULED }),
        cand({ destinationStatus: DestinationStatus.READY }),
        cand({ destinationStatus: DestinationStatus.FAILED }),
        cand({ watchUrl: null }),
      ]),
    ).toBeNull();
  });

  it('takes the most recent live destination', () => {
    expect(
      pickLiveWatchUrl([
        cand({ watchUrl: 'https://www.youtube.com/watch?v=old', createdAt: new Date('2026-01-01') }),
        cand({ watchUrl: 'https://www.youtube.com/watch?v=new', createdAt: new Date('2026-02-01') }),
      ]),
    ).toBe('https://www.youtube.com/watch?v=new');
  });

  it('never returns a non-http(s) target', () => {
    expect(pickLiveWatchUrl([cand({ watchUrl: 'javascript:alert(1)' }), cand({ watchUrl: '//evil.example' })])).toBeNull();
    expect(pickLiveWatchUrl([cand({ watchUrl: 'javascript:alert(1)', createdAt: new Date('2027-01-01') }), cand({})])).toBe(
      'https://www.youtube.com/watch?v=a',
    );
  });

  it('builds channel and page URLs from the stored id, encoded', () => {
    expect(channelUrlFor(Platform.YOUTUBE, 'UC123')).toBe('https://www.youtube.com/channel/UC123');
    expect(channelUrlFor(Platform.FACEBOOK, '10987')).toBe('https://www.facebook.com/10987');
    expect(channelUrlFor(Platform.YOUTUBE, 'a/b?c')).toBe('https://www.youtube.com/channel/a%2Fb%3Fc');
    expect(channelUrlFor(Platform.TWITCH, 'x')).toBeNull();
  });
});
