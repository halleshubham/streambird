/**
 * Where visitors get the StreamBird Android app. Single source of truth for the home page (hero + "Android app"
 * section), the /android help page and the footer.
 *
 * TEMPORARY direct APK: until the Google Play listing is public, the signed APK is a GitHub release asset in the public
 * repo halleshubham/streambird-android. The `releases/latest/download/streambird.apk` URL always serves the asset named exactly
 * `streambird.apk` of the newest release marked Latest (publishing steps in .claude/docs/operations.md "Android app download").
 *
 * ONE-LINE SWITCH TO GOOGLE PLAY: when the Play listing is live, set PLAY_STORE_URL below to the listing URL. The home
 * page then shows "Get it on Google Play" instead of the APK button (`androidInstall()` decides), and /android says so.
 * Delete the /android route and the `LandingPage` "Android app" section later if you no longer want the APK path.
 */
export const ANDROID_APK_URL = 'https://github.com/halleshubham/streambird-android/releases/latest/download/streambird.apk';
/** The app's minSdk is 26 (app/build.gradle.kts in streambird-android) = Android 8.0. */
export const ANDROID_APK_MIN_ANDROID = '8.0';
/** SHA-256 of the upload key the APK is signed with. Public information; shown so power users can verify the file. */
export const ANDROID_SIGNING_SHA256 = 'E2:81:9E:04:6D:3C:47:EA:61:FE:CB:92:51:EA:6B:8E:A1:AF:04:87:F8:15:5C:F8:B5:EC:85:79:77:11:12:AF';
export const ANDROID_PACKAGE = 'com.shackyapps.streambird';
/** Set to the Google Play listing URL once it is public (null = not yet). */
export const PLAY_STORE_URL: string | null = null;

export type AndroidInstall = { kind: 'play' | 'apk'; href: string; label: string; note: string };

/** What the "get the app" buttons should offer: the Play listing when it exists, otherwise the direct APK. */
export function androidInstall(playUrl: string | null = PLAY_STORE_URL, apkUrl: string = ANDROID_APK_URL): AndroidInstall {
  if (playUrl) return { kind: 'play', href: playUrl, label: 'Get it on Google Play', note: 'Android app' };
  return { kind: 'apk', href: apkUrl, label: 'Get the Android app', note: 'APK, direct download' };
}

/** Anchor attributes for an install link: the APK is a plain `download` link; Play opens in a new tab. */
export function androidLinkAttrs(install: AndroidInstall): { href: string; download?: true; target?: '_blank'; rel: 'noopener' } {
  return install.kind === 'apk' ? { href: install.href, download: true, rel: 'noopener' } : { href: install.href, target: '_blank', rel: 'noopener' };
}
