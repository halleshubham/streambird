export interface AppConfig {
  port: number;
  databaseUrl: string;
  encryptionKeyBase64: string;
  cloudflare: {
    accountId: string;
    apiToken: string;
    /** The "customer-<code>.cloudflarestream.com" subdomain code for this account's Stream delivery -- fixed per account, not per stream. */
    customerCode: string;
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
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
    customerCode: process.env.CLOUDFLARE_CUSTOMER_CODE ?? '',
  },
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  cookieSecure: process.env.NODE_ENV === 'production',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFrom: process.env.EMAIL_FROM ?? 'StreamBird <login@streambird.shackyapps.in>',
});
