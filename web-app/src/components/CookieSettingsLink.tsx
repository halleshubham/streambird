import { reopenConsent, useConsentBannerEnabled } from '../lib/consent';

/** Footer link (with its leading separator) that brings the cookie banner back; renders nothing unless the banner mode is on. */
export function CookieSettingsLink() {
  const enabled = useConsentBannerEnabled();
  if (!enabled) return null;
  return (
    <>
      {' · '}
      <button type="button" className="link-button link-button--inline" onClick={reopenConsent}>
        Cookie settings
      </button>
    </>
  );
}
