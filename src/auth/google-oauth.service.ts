import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GoogleProfile {
  email: string;
  emailVerified: boolean;
  name?: string;
}

export interface GoogleTokens {
  accessToken: string;
  /** Only present when the auth request used access_type=offline + prompt=consent (see YouTubeProvider's connect flow). Absent for the plain login flow, which only ever needs a short-lived access token. */
  refreshToken?: string;
  expiresInSeconds: number;
}

export interface GoogleAuthUrlOptions {
  redirectUri: string;
  scope: string;
  /** 'offline' is required to receive a refresh_token at all -- see https://developers.google.com/identity/protocols/oauth2/web-server#offline. Defaults to 'online' (the login flow's need: no refresh_token, just this one sign-in). */
  accessType?: 'online' | 'offline';
  /** 'consent' forces Google to re-show the consent screen and re-issue a refresh_token even on a repeat connection -- needed for the YouTube connect flow (see PlatformConnectionsController), where a reconnect must always come back with a fresh refresh_token. */
  prompt?: 'select_account' | 'consent';
}

/**
 * Direct fetch-based implementation of the standard Google OAuth 2.0
 * authorization-code flow -- no `passport`/`passport-google-oauth20`
 * dependency (not already present in package.json, and the protocol
 * itself is just two HTTP calls; adding a heavy auth framework for that
 * isn't proportionate here). Node 22's global `fetch` is used directly,
 * same as this codebase's other outbound HTTP call via axios/HttpService
 * elsewhere, just without needing HttpModule for two one-off calls.
 *
 * Shared by two distinct flows against the SAME Google OAuth client: the
 * "Sign in with Google" login (openid email profile, access_type=online --
 * see AuthController) and the YouTube platform-connect flow
 * (youtube.force-ssl, access_type=offline -- see
 * PlatformConnectionsController / YouTubeProvider). Both need their own
 * registered redirect URI in Google Cloud Console, which is why every
 * method here takes redirectUri explicitly rather than reading it from
 * config itself.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService) {}

  buildAuthUrl(state: string, opts: GoogleAuthUrlOptions): string {
    const params = new URLSearchParams({
      client_id: this.config.get<string>('google.clientId') ?? '',
      redirect_uri: opts.redirectUri,
      response_type: 'code',
      scope: opts.scope,
      access_type: opts.accessType ?? 'online',
      prompt: opts.prompt ?? 'select_account',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokens> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.get<string>('google.clientId') ?? '',
        client_secret: this.config.get<string>('google.clientSecret') ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token exchange failed with status ${tokenRes.status}`);
    }
    const tokenBody = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: tokenBody.access_token,
      refreshToken: tokenBody.refresh_token,
      expiresInSeconds: tokenBody.expires_in,
    };
  }

  /**
   * Revokes a token (a refresh token also invalidates its access tokens) so
   * StreamBird's access to the user's Google account really ends -- used
   * when a YouTube connection is removed. Returns true when Google no longer
   * honors the token: a 200, or a 400 invalid_token (already revoked, or
   * revoked by the user in their Google account). Anything else throws.
   */
  async revokeToken(token: string): Promise<boolean> {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (res.ok) return true;
    if (res.status === 400) return true; // invalid_token: already gone
    throw new Error(`Google token revocation failed with status ${res.status}`);
  }

  async refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.get<string>('google.clientId') ?? '',
        client_secret: this.config.get<string>('google.clientSecret') ?? '',
        grant_type: 'refresh_token',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token refresh failed with status ${tokenRes.status}`);
    }
    const tokenBody = (await tokenRes.json()) as { access_token: string; expires_in: number };

    // Google does not re-issue a refresh_token on a refresh_token grant --
    // the original one keeps working until the user revokes access.
    return { accessToken: tokenBody.access_token, expiresInSeconds: tokenBody.expires_in };
  }

  async exchangeCodeForProfile(code: string, redirectUri: string): Promise<GoogleProfile> {
    const tokens = await this.exchangeCodeForTokens(code, redirectUri);

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
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
