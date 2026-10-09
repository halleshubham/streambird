import type { CSSProperties } from 'react';
import { PlatformLogo } from './PlatformLogo';
import type { Platform } from '../types/api';

const DESTINATIONS: { platform: Platform; label: string; color: string }[] = [
  { platform: 'youtube', label: 'YouTube', color: '#ff0033' },
  { platform: 'facebook', label: 'Facebook', color: '#1877f2' },
  { platform: 'twitch', label: 'Twitch', color: '#9146ff' },
];

/**
 * A CSS-only miniature of the host studio for the home page hero: a slide with two people tiles, a
 * scrolling ticker, a pulsing LIVE badge and the three destinations going live. Purely decorative
 * (aria-hidden); every animation is a CSS keyframe and is switched off for prefers-reduced-motion.
 */
export function HeroShowcase() {
  return (
    <div className="hero-studio" aria-hidden="true">
      <div className="hs-bar">
        <span className="hs-live">
          <i /> LIVE
        </span>
        <span className="hs-meta">HD · 3 destinations · 2 guests</span>
      </div>

      <div className="hs-canvas">
        <div className="hs-slide">
          <span className="hs-slide-title">Q3 launch</span>
          <span className="hs-slide-line hs-slide-line--1" />
          <span className="hs-slide-line hs-slide-line--2" />
          <span className="hs-slide-line hs-slide-line--3" />
        </div>
        <div className="hs-people">
          <div className="hs-tile hs-tile--a">
            <span className="hs-avatar">Y</span>
            <span className="hs-name">You</span>
            <span className="hs-wave">
              <i /> <i /> <i /> <i /> <i />
            </span>
          </div>
          <div className="hs-tile hs-tile--b">
            <span className="hs-avatar hs-avatar--b">G</span>
            <span className="hs-name">Guest</span>
            <span className="hs-wave hs-wave--b">
              <i /> <i /> <i /> <i /> <i />
            </span>
          </div>
        </div>
        <div className="hs-ticker">
          <span>Live now: Q3 launch Q&amp;A &nbsp;•&nbsp; Ask your question in the chat &nbsp;•&nbsp; Live now: Q3 launch Q&amp;A &nbsp;•&nbsp; Ask your question in the chat</span>
        </div>
      </div>

      <div className="hs-dests">
        {DESTINATIONS.map((d, i) => (
          <span key={d.platform} className="hs-dest" style={{ '--c': d.color, '--i': i } as CSSProperties}>
            <PlatformLogo platform={d.platform} size={14} />
            {d.label}
            <b>
              <i /> live
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}
