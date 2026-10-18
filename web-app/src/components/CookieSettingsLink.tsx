import { reopenConsent } from '../lib/consent';

/** Footer link that brings the cookie banner back so the choice can be changed. */
export function CookieSettingsLink() {
  return (
    <button type="button" className="link-button link-button--inline" onClick={reopenConsent}>
      Cookie settings
    </button>
  );
}
