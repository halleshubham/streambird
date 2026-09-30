import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Direct fetch-based implementation of the standard Google OAuth 2.0
 * authorization-code flow -- no `passport`/`passport-google-oauth20`
 * dependency (not already present in package.json, and the protocol
 * itself is just two HTTP calls; adding a heavy auth framework for that
 * isn't proportionate here). Node 22's global `fetch` is used directly,
 * same as this codebase's other outbound HTTP call via axios/HttpService
 * elsewhere, just without needing HttpModule for two one-off calls.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService) {}

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get<string>('google.clientId') ?? '',
      redirect_uri: this.config.get<string>('google.redirectUri') ?? '',
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get<string>('google.clientId') ?? '',
        client_secret: this.config.get<string>('google.clientSecret') ?? '',
        redirect_uri: this.config.get<string>('google.redirectUri') ?? '',
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token exchange failed with status ${tokenRes.status}`);
    }
    const tokenBody = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (!profileRes.ok) {
      throw new Error(`Google profile fetch failed with status ${profileRes.status}`);
    }
    const profile = (await profileRes.json()) as {
      email: string;
      email_verified?: boolean;
      name?: string;
    };

    return {
      email: profile.email,
      // Google's own verification that the account holder actually
      // controls this email address -- an unverified email must never be
      // trusted as a login identity (this codebase's whole identity model
      // is "email is the account", same as magic-code login).
      emailVerified: profile.email_verified ?? false,
      name: profile.name,
    };
  }
}
