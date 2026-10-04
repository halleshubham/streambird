export interface FacebookDialogOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Classic Facebook Login: permissions requested inline. */
  scope: string;
  /**
   * Facebook Login for Business: the ID of a Configuration saved in the Meta
   * app dashboard (it carries the permissions). When set it replaces `scope`;
   * Login-for-Business apps reject a plain `scope` request with "This app
   * needs at least one supported permission".
   */
  configId?: string;
}

/** Builds the Meta OAuth dialog URL for either classic Facebook Login or Facebook Login for Business. */
export function buildFacebookDialogUrl(opts: FacebookDialogOptions): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    response_type: 'code',
  });
  if (opts.configId) {
    params.set('config_id', opts.configId);
    // Required so a user-access-token configuration returns an
    // authorization code (exchanged server-side) instead of a token.
    params.set('override_default_response_type', 'true');
  } else {
    params.set('scope', opts.scope);
  }
  return `https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`;
}
