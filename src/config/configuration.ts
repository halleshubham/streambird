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
    /** Internal Control API base URL (container-to-container, not public) -- e.g. http://streambird-mediamtx:9997 */
    apiUrl: string;
    apiUser: string;
    apiPassword: string;
    /** Public base URL the host's browser publishes WHIP to -- e.g. https://<mediamtx-domain> (port 8889). */
    whipBaseUrl: string;
  };
  twitchClientId: string;
  twitchClientSecret: string;
  publicBaseUrl: string;
  nodeEnv: string;
  cookieSecure: boolean;
  resendApiKey: string;
  emailFrom: string;
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
});
