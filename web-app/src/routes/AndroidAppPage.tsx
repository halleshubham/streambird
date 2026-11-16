import { Link } from 'react-router-dom';
import { AndroidDownload } from '../components/AndroidDownload';
import { BrandLink } from '../components/PublicLayout';
import { ANDROID_APK_MIN_ANDROID, ANDROID_PACKAGE, ANDROID_SIGNING_SHA256, PLAY_STORE_URL } from '../lib/appLinks';

const CONTACT_EMAIL = 'support@shackyapps.in';

/**
 * Public help page /android: how to install the StreamBird Android app from the direct APK while the Google Play
 * listing is not public. Source of the link and the fingerprint: lib/appLinks.ts. Remove or reword once Play is live.
 */
export function AndroidAppPage() {
  return (
    <div className="pub-page pub-legal-page">
      <header className="pub-header">
        <BrandLink />
        <Link to="/" className="pub-header-link">
          Back to home
        </Link>
      </header>
      <main className="pub-legal-main pub-legal-main--center">
        <article className="pub-legal-card legal-page-inner" id="android-app">
          <p className="pub-eyebrow">Android app</p>
          <h1>Install the StreamBird Android app (APK)</h1>
          <p>
            The StreamBird app streams your phone camera to YouTube, Facebook and Twitch, with your brand kits, on the account you already use. It needs Android{' '}
            {ANDROID_APK_MIN_ANDROID} or newer.
          </p>
          <p className="pub-android-cta">
            <AndroidDownload testId="apk-download" variant="primary" />
          </p>
          {PLAY_STORE_URL ? (
            <p>The app is also on Google Play. The direct APK below still works if you cannot use Play.</p>
          ) : (
            <p>
              <strong>This direct APK is a temporary way to install</strong> until the Google Play listing is live.
            </p>
          )}

          <h2 id="install">How to install</h2>
          <ol className="pub-android-steps">
            <li>
              <strong>Download.</strong> On your Android phone, tap <strong>Get the Android app</strong> above. Your browser may warn that this type of file can be
              harmful; choose <strong>Download anyway</strong> (the file is the app itself).
            </li>
            <li>
              <strong>Open it.</strong> Tap the finished download, or open <strong>streambird.apk</strong> from your Downloads folder in the Files app.
            </li>
            <li>
              <strong>Allow the install.</strong> If Android asks, turn on <strong>Install unknown apps</strong> for the app you opened the file from (your
              browser or the Files app), go back and tap <strong>Install</strong>.
            </li>
            <li>
              <strong>Play Protect.</strong> It may say <strong>unrecognised developer</strong>, because the app is not from Google Play yet. Choose{' '}
              <strong>More details</strong>, then <strong>Install anyway</strong>.
            </li>
            <li>
              <strong>Sign in.</strong> Open <strong>StreamBird</strong> and sign in with Google or your email, the same account you use on streambird.app.
            </li>
          </ol>

          <h2 id="updates">Updating the app</h2>
          <p>Download the newest APK from this page again and open it. It installs over the old version and keeps your sign-in and settings.</p>
          <h3>Moving to the Google Play version later</h3>
          <p>
            Google Play re-signs the app with its own key, so Play cannot update an app you installed from this APK. When the Play listing is live you may need
            to <strong>uninstall this version first</strong> and then install StreamBird from Google Play. Your account and streams are not affected, because
            they live on your StreamBird account, not on the phone.
          </p>

          <h2 id="verify">Check the file (optional)</h2>
          <p>
            The APK for package <code>{ANDROID_PACKAGE}</code> is signed with the StreamBird upload key. Its SHA-256 certificate fingerprint is:
          </p>
          <p>
            <code className="pub-android-fp" data-testid="apk-fingerprint">
              {ANDROID_SIGNING_SHA256.split(':').map((b, i) => (
                <span key={i}>
                  {i > 0 && ':'}
                  <wbr />
                  {b}
                </span>
              ))}
            </code>
          </p>
          <p>
            To compare it, run <code>apksigner verify --print-certs streambird.apk</code> (Android SDK build tools). Only install the file from the link on this
            page.
          </p>

          <h2 id="help">Help and privacy</h2>
          <p>
            Problem installing? Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. How we handle your data is in the{' '}
            <Link to="/privacy">Privacy Policy</Link>; you can delete your account from the app or on the <Link to="/delete-account">delete account page</Link>.
          </p>
          <p className="legal-back">
            <Link to="/">Back to home</Link>
          </p>
        </article>
      </main>
    </div>
  );
}
