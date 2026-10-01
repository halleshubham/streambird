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
  };
  twitchClientId: string;
  twitchClientSecret: string;
  publicBaseUrl: string;
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
  },
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  cookieSecure: process.env.NODE_ENV === 'production',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'StreamBird <login@streambird.shackyapps.in>',
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
  },
});
