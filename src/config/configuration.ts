export interface AppConfig {
  port: number;
  databaseUrl: string;
  encryptionKeyBase64: string;
  cloudflare: {
    accountId: string;
    apiToken: string;
  };
  twitchClientId: string;
  twitchClientSecret: string;
}

export default (): AppConfig => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  encryptionKeyBase64: process.env.ENCRYPTION_KEY_BASE64 ?? '',
  cloudflare: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? '',
  },
  twitchClientId: process.env.TWITCH_CLIENT_ID ?? '',
  twitchClientSecret: process.env.TWITCH_CLIENT_SECRET ?? '',
});
