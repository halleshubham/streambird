import type { CSSProperties, ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { Platform } from '../../types/api';
import { PlatformLogo } from '../PlatformLogo';
import { cx } from '../ui';
import '../../styles/host-app.css';

/** Page title block of the host app: h1, one muted line, actions on the right (they wrap under on phones). */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="ha-head">
      {back && <div className="ha-back">{back}</div>}
      <div className="ha-head-row">
        <div className="ha-head-text">
          <h1>{title}</h1>
          {subtitle && <p className="ha-sub">{subtitle}</p>}
        </div>
        {actions && <div className="ha-head-actions">{actions}</div>}
      </div>
    </div>
  );
}

export type NoticeTone = 'success' | 'error' | 'info' | 'warning';

/** An in-page message: success / error / info. Errors are announced as alerts, the rest as status. */
export function Notice({
  tone = 'info',
  title,
  children,
  onDismiss,
  actions,
  className,
  testId,
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={cx('ha-notice', `ha-notice--${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId}>
      <span className="ha-notice-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="ha-notice-body">
        {title && <h3>{title}</h3>}
        {children && <div className="ha-notice-text">{children}</div>}
        {actions && <div className="ha-notice-actions">{actions}</div>}
      </div>
      {onDismiss && (
        <button type="button" className="ha-notice-x" aria-label="Dismiss" onClick={onDismiss}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const PLATFORM_TILE: Record<Platform, { color: string; label: string }> = {
  youtube: { color: '#b4262b', label: 'YouTube' },
  facebook: { color: '#1d4ed8', label: 'Facebook' },
  twitch: { color: '#6d28d9', label: 'Twitch' },
  linkedin: { color: '#0a66c2', label: 'LinkedIn' },
};

/** Coloured square with the platform mark (or "RT" for a custom RTMP address). */
export function PlatformTile({ platform, size = 44 }: { platform: Platform | 'rtmp'; size?: number }) {
  const color = platform === 'rtmp' ? '#5b21b6' : PLATFORM_TILE[platform].color;
  const style = { width: size, height: size, background: color } as CSSProperties;
  return (
    <span className="ha-tile" style={style} aria-hidden="true">
      {platform === 'rtmp' ? <span className="ha-tile-text">RT</span> : <PlatformLogo platform={platform} size={Math.round(size * 0.5)} />}
    </span>
  );
}

export function platformName(p: Platform): string {
  return PLATFORM_TILE[p].label;
}
