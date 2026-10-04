import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildFacebookDialogUrl } from './facebook-dialog';

export interface FacebookProfile {
  /** Absent when the Facebook account has no confirmed email, or the user declined the email permission. */
  email?: string;
  name?: string;
}

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

/**
 * "Continue with Facebook" login: the standard OAuth code flow against the
 * SAME Meta app used for connecting Facebook Pages (PlatformConnectionsController),
 * but asking only for `email,public_profile` -- both available without App
 * Review -- and a distinct redirect URI, which must be registered under
 * Facebook Login > Valid OAuth Redirect URIs on the Meta app.
 */
@Injectable()
export class FacebookLoginService {
  constructor(private readonly config: ConfigService) {}

  buildAuthUrl(state: string, redirectUri: string): string {
    return buildFacebookDialogUrl({
      clientId: this.config.get<string>('facebook.appId') ?? '',
      redirectUri,
      state,
      scope: 'email,public_profile',
      configId: this.config.get<string>('facebook.loginConfigId') || undefined,
    });
  }

  async exchangeCodeForProfile(code: string, redirectUri: string): Promise<FacebookProfile> {
    const tokenRes = await fetch(
      `${GRAPH_API_BASE}/oauth/access_token?${new URLSearchParams({
        client_id: this.config.get<string>('facebook.appId') ?? '',
        client_secret: this.config.get<string>('facebook.appSecret') ?? '',
        redirect_uri: redirectUri,
        code,
      }).toString()}`,
    );
    if (!tokenRes.ok) {
      throw new Error(`Facebook token exchange failed with status ${tokenRes.status}`);
    }
    const { access_token: accessToken } = (await tokenRes.json()) as { access_token: string };

    const profileRes = await fetch(
      `${GRAPH_API_BASE}/me?${new URLSearchParams({ fields: 'name,email', access_token: accessToken }).toString()}`,
    );
    if (!profileRes.ok) {
      throw new Error(`Facebook profile fetch failed with status ${profileRes.status}`);
    }
    const profile = (await profileRes.json()) as { email?: string; name?: string };
    return { email: profile.email, name: profile.name };
  }
}
