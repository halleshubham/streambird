import { Download, Smartphone } from 'lucide-react';
import { androidInstall, androidLinkAttrs, type AndroidInstall } from '../lib/appLinks';
import { buttonClass } from './ui';

/**
 * The "get the Android app" link: the direct APK while Google Play is not live, the Play listing afterwards
 * (see lib/appLinks.ts). A plain link, no tracking.
 */
export function AndroidDownload({
  testId,
  variant = 'secondary',
  size = 'lg',
  install = androidInstall(),
  showNote = true,
}: {
  testId: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  install?: AndroidInstall;
  showNote?: boolean;
}) {
  const Icon = install.kind === 'apk' ? Download : Smartphone;
  return (
    <a className={`${buttonClass(variant, size)} pub-android-btn`} data-testid={testId} data-kind={install.kind} {...androidLinkAttrs(install)}>
      <Icon size={18} aria-hidden="true" />
      <span className="pub-android-btn-text">
        {install.label}
        {showNote && <small>{install.note}</small>}
      </span>
    </a>
  );
}
