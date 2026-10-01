import type { CSSProperties } from 'react';
import type { Platform } from '../types/api';
import { PlatformLogo } from './PlatformLogo';

const LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  twitch: 'Twitch',
  linkedin: 'LinkedIn',
};

const COLORS: Record<Platform, string> = {
  youtube: '#ff0000',
  facebook: '#1877f2',
  twitch: '#9146ff',
  linkedin: '#0a66c2',
};

export function PlatformBadge({ platform }: { platform: Platform }) {
  return (
    <span
      className="platform-badge"
      style={{ '--badge-color': COLORS[platform] } as CSSProperties}
    >
      <PlatformLogo platform={platform} />
      {LABELS[platform]}
    </span>
  );
}
