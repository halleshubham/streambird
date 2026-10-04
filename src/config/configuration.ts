import { parseLegacyHosts } from '../common/legacy-hosts';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  encryptionKeyBase64: string;
  /** Which RelayProvider implementation RelayModule wires up -- see relay-provider.interface.ts. */
  relayProviderName: 'cloudflare' | 'mux';
  cloudflare: {
    accountId: string;
    apiToken: string;
    /** The "customer-<code>.cloudflarestream.com" subdomain code for this account's Stream delivery -- fixed per account, not per stream. */
    customerCode: string;
  };
  mux: {
    tokenId: string;
    tokenSecret: string;
  };
  mediamtx: {
    /**
     * Public Control API base URL, on its own domain pointed at MediaMTX's
     * API port -- container-to-container Docker networking between
     * separate Coolify apps didn't work out in practice, so this is
     * exposed publicly and locked down with apiUser/apiPassword (MediaMTX's
     * own Basic Auth, scoped to the "api" permission only) instead.
     */
    apiUrl: string;
    apiUser: string;
    apiPassword: string;
    /** Public base URL the host's browser publishes WHIP to -- MediaMTX's WebRTC/HTTP port, its own domain. */
    whipBaseUrl: string;
    /** Override for the "technical glitch" slate image URL; defaults to `${publicBaseUrl}/glitch-slate.png`. */
    slateUrl: string;
  };
  twitchClientId: string;
  twitchClientSecret: string;
  publicBaseUrl: string;
  /** Old hostnames that still reach the app after a domain move (LEGACY_HOSTS) -- see common/legacy-hosts.ts. */
  legacyHosts: string[];
  nodeEnv: string;
  cookieSecure: boolean;
  resendApiKey: string;
  emailFrom: string;
  /** Seeded/reconciled on every boot -- see SuperadminSeedService. Both
   * must be set for a Superadmin identity to exist at all; if either is
   * missing, seeding is skipped (app still boots, just with no Superadmin
   * login available yet). */
  superadminEmail: string;
  superadminPassword: string;
  google: {
    clientId: string;
    clientSecret: string;
    /** Must exactly match a redirect URI registered on the Google OAuth
     * client, e.g. `${publicBaseUrl}/api/auth/google/callback`. */
    redirectUri: string;
    /** A SEPARATE registered redirect URI for the YouTube platform-connect
     * flow (see YouTubeProvider / PlatformConnectionsController) -- a
     * distinct path from the login flow's redirectUri above, since this
     * one requests the sensitive `youtube.force-ssl` scope and Google
     * treats each registered redirect URI as its own OAuth flow. e.g.
     * `${publicBaseUrl}/api/platform-connections/youtube/callback`. */
    youtubeRedirectUri: string;
  };
  facebook: {
    appId: string;
    appSecret: string;
    /** Must exactly match a redirect URI registered on the Meta App's
     * Facebook Login product, e.g.
     * `${publicBaseUrl}/api/platform-connections/facebook/callback`. */
    redirectUri: string;
    /** Redirect URI for "Continue with Facebook" sign-in -- distinct from the
     * Page-connect one above, and also must be registered on the Meta app.
     * Defaults to `${publicBaseUrl}/api/auth/facebook/callback`. */
    loginRedirectUri: string;
    /** Facebook Login for Business only: Configuration IDs from the Meta app
     * dashboard. When set, they replace the inline `scope` (see
     * buildFacebookDialogUrl). Leave blank for classic Facebook Login. */
    loginConfigId: string;
    connectConfigId: string;
  };
  cloudflareTurn: {
    /** Both empty = no TURN configured, StudioSignalingGateway's clients
     * fall back to STUN-only (see TurnCredentialsService). */
    tokenId: string;
    /** NEVER sent to any client -- used server-side only, to mint
     * short-lived per-session credentials (see TurnCredentialsService).
     * This raw token can mint arbitrary TURN credentials against the
     * Cloudflare account if it ever leaks. */
    apiToken: string;
  };
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  encryptionKeyBase64: process.env.ENCRYPTION_KEY_BASE64 ?? '',
  relayProviderName: process.env.RELAY_PROVIDER === 'mux' ? 'mux' : 'cloudflare',
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
    customerCode: process.env.CLOUDFLARE_CUSTOMER_CODE ?? '',
  },
  mux: {
    tokenId: process.env.MUX_TOKEN_ID ?? '',
    tokenSecret: process.env.MUX_TOKEN_SECRET ?? '',
  },
  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL ?? '',
    apiUser: process.env.MEDIAMTX_API_USER ?? '',
    apiPassword: process.env.MEDIAMTX_API_PASSWORD ?? '',
    whipBaseUrl: process.env.MEDIAMTX_WHIP_BASE_URL ?? '',
    slateUrl: process.env.GLITCH_SLATE_URL ?? '',
  },
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  legacyHosts: parseLegacyHosts(process.env.LEGACY_HOSTS),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  cookieSecure: process.env.NODE_ENV === 'production',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'StreamBird <login@streambird.app>',
  superadminEmail: process.env.SUPERADMIN_EMAIL ?? '',
  superadminPassword: process.env.SUPERADMIN_PASSWORD ?? '',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? '',
    youtubeRedirectUri: process.env.GOOGLE_YOUTUBE_REDIRECT_URI ?? '',
  },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID ?? '',
    appSecret: process.env.FACEBOOK_APP_SECRET ?? '',
    redirectUri: process.env.FACEBOOK_REDIRECT_URI ?? '',
    loginRedirectUri:
      process.env.FACEBOOK_LOGIN_REDIRECT_URI ??
      `${process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`}/api/auth/facebook/callback`,
    loginConfigId: process.env.FACEBOOK_LOGIN_CONFIG_ID ?? '',
    connectConfigId: process.env.FACEBOOK_CONNECT_CONFIG_ID ?? '',
  },
  cloudflareTurn: {
    tokenId: process.env.CLOUDFLARE_TURN_TOKEN_ID ?? '',
    apiToken: process.env.CLOUDFLARE_TURN_API_TOKEN ?? '',
  },
});
