import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as crypto from 'crypto';
import { plainToInstance } from 'class-transformer';
import { PlatformConnectionsService } from './platform-connections.service';
import { PlatformConnectionResponseDto } from './dto/platform-connection-response.dto';
import { CreateManualTwitchConnectionDto } from './dto/create-manual-twitch-connection.dto';
import { AccountGuard, AccountRequest } from '../common/guards/account.guard';
import { CurrentAccount } from '../common/decorators/current-account.decorator';
import { Account } from '../accounts/entities/account.entity';
import { GoogleOAuthService } from '../auth/google-oauth.service';

const YOUTUBE_OAUTH_STATE_COOKIE_NAME = 'sb_yt_oauth_state';
const YOUTUBE_OAUTH_BASE_PATH = '/api/platform-connections/youtube';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

const FACEBOOK_API_BASE = 'https://graph.facebook.com/v23.0';
const FACEBOOK_OAUTH_STATE_COOKIE_NAME = 'sb_fb_oauth_state';
// Holds only a small opaque selection id -- see pendingFacebookPageSelections
// below for why the actual Page list/tokens never go in a cookie.
const FACEBOOK_PENDING_PAGES_COOKIE_NAME = 'sb_fb_pending_pages';
const FACEBOOK_OAUTH_BASE_PATH = '/api/platform-connections/facebook';
const FACEBOOK_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,publish_video';
const FACEBOOK_PENDING_SELECTION_TTL_MS = 10 * 60_000;

interface FacebookPendingPage {
  id: string;
  name: string;
  access_token: string;
}

/**
 * OAuth connect/callback routes for LinkedIn are still deferred -- YouTube
 * and Facebook below are both now live, against two unrelated OAuth
 * providers/clients (Google vs Meta) with genuinely different shapes: see
 * FacebookProvider's own doc comment for how Facebook's token lifecycle,
 * page-selection step, and stream-URL shape all differ from YouTube's.
 * Twitch still has no OAuth flow here because Twitch's own API doesn't
 * expose a user's stream key programmatically — POST :platform/twitch/manual
 * (below) is the actual connection method for Twitch, not a stand-in for a
 * future OAuth route.
 */
@Controller('platform-connections')
@UseGuards(AccountGuard)
export class PlatformConnectionsController {
  private readonly logger = new Logger(PlatformConnectionsController.name);

  /**
   * An account managing many Facebook Pages (confirmed live: one real
   * account has 25) produces a Page-list-plus-access-tokens payload well
   * past the ~4KB per-cookie limit browsers enforce -- the original design
   * stashed that whole list, encrypted, directly in a cookie, which the
   * browser silently refused to store for any sizeable Page count,
   * surfacing as "sign-in expired" immediately after a successful OAuth
   * round. Held here in memory instead, keyed by a small opaque id that's
   * all the cookie actually carries; single-process-safe, same trust model
   * as this controller's existing short-lived OAuth state cookies -- a
   * guessed/stolen id is useless without also riding the account's own
   * session cookie (checked against accountId below).
   */
  private readonly pendingFacebookPageSelections = new Map<
    string,
    { accountId: string; pages: FacebookPendingPage[]; expiresAt: number }
  >();

  constructor(
    private readonly platformConnectionsService: PlatformConnectionsService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async findAll(@CurrentAccount() account: Account) {
    const connections = await this.platformConnectionsService.findAllForAccount(account.id);
    return connections.map((c) =>
      plainToInstance(PlatformConnectionResponseDto, c, { excludeExtraneousValues: true }),
    );
  }

  /**
   * Step 1 of connecting a YouTube destination: redirects to Google's
   * consent screen asking for the `youtube` scope specifically (distinct
   * from, and in addition to, whatever scope a "Sign in with Google"
   * login already granted -- this is a separate grant against the same
   * OAuth client). `state` follows the exact same short-lived-httpOnly-
   * cookie CSRF pattern as AuthController's login flow. access_type=
   * offline + prompt=consent together guarantee Google returns a
   * refresh_token, including on a reconnect -- without `prompt=consent`,
   * a user who'd already granted this scope once could come back through
   * this flow and get no refresh_token at all on the second grant.
   */
  @Get('youtube/connect')
  connectYouTube(@Res() res: Response): void {
    const state = crypto.randomBytes(24).toString('base64url');
    res.cookie(YOUTUBE_OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: this.config.get<boolean>('cookieSecure'),
      sameSite: 'lax',
      path: YOUTUBE_OAUTH_BASE_PATH,
      maxAge: 10 * 60_000,
    });
    res.redirect(
      this.googleOAuth.buildAuthUrl(state, {
        redirectUri: this.config.get<string>('google.youtubeRedirectUri') ?? '',
        scope: YOUTUBE_SCOPE,
        accessType: 'offline',
        prompt: 'consent',
      }),
    );
  }

  /**
   * Step 2: Google redirects the browser back here. Account identity
   * comes from AccountGuard exactly as on every other route in this
   * controller -- the sb_session cookie rides along on this redirect
   * (SameSite=Lax permits cookies on a top-level GET navigation, which is
   * exactly what a browser-followed 302 redirect is), so there's no need
   * to smuggle the account id through `state` itself, unlike a scheme
   * with no existing session to lean on. A full-page browser redirect,
   * not a fetch() the frontend can catch, so every failure path redirects
   * back to the connections page with an error flag instead of throwing.
   */
  @Get('youtube/callback')
  async youtubeCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @CurrentAccount() account: Account,
    @Req() req: AccountRequest,
    @Res() res: Response,
  ): Promise<void> {
    const cookieState = req.cookies?.[YOUTUBE_OAUTH_STATE_COOKIE_NAME];
    res.clearCookie(YOUTUBE_OAUTH_STATE_COOKIE_NAME, { path: YOUTUBE_OAUTH_BASE_PATH });

    if (!code || !state || !cookieState || state !== cookieState) {
      res.redirect('/connections?error=youtube_oauth_failed');
      return;
    }

    try {
      const redirectUri = this.config.get<string>('google.youtubeRedirectUri') ?? '';
      const tokens = await this.googleOAuth.exchangeCodeForTokens(code, redirectUri);
      if (!tokens.refreshToken) {
        // Shouldn't happen given access_type=offline + prompt=consent above,
        // but without one we can't maintain this connection past the
        // access token's ~1hr lifetime -- fail clearly rather than silently
        // storing a connection that will stop working within the hour.
        res.redirect('/connections?error=youtube_oauth_failed');
        return;
      }

      const channelRes = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } },
      );
      if (!channelRes.ok) {
        res.redirect('/connections?error=youtube_oauth_failed');
        return;
      }
      const channelBody = (await channelRes.json()) as {
        items?: Array<{ id: string; snippet?: { title?: string } }>;
      };
      const channel = channelBody.items?.[0];
      if (!channel) {
        // Authenticated fine, but the Google account has no YouTube
        // channel at all -- nothing to connect.
        res.redirect('/connections?error=youtube_no_channel');
        return;
      }

      await this.platformConnectionsService.upsertYouTubeConnection(
        account.id,
        { channelId: channel.id, channelTitle: channel.snippet?.title ?? 'YouTube' },
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
        },
      );
      res.redirect('/connections?connected=youtube');
    } catch {
      res.redirect('/connections?error=youtube_oauth_failed');
    }
  }

  /**
   * Step 1 of connecting a Facebook Page: redirects to Meta's own OAuth
   * dialog. Same CSRF short-lived-httpOnly-cookie state pattern as
   * connectYouTube above, against an entirely separate OAuth
   * client/provider (Meta, not Google).
   */
  @Get('facebook/connect')
  connectFacebook(@Res() res: Response): void {
    const state = crypto.randomBytes(24).toString('base64url');
    res.cookie(FACEBOOK_OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: this.config.get<boolean>('cookieSecure'),
      sameSite: 'lax',
      path: FACEBOOK_OAUTH_BASE_PATH,
      maxAge: 10 * 60_000,
    });
    const params = new URLSearchParams({
      client_id: this.config.get<string>('facebook.appId') ?? '',
      redirect_uri: this.config.get<string>('facebook.redirectUri') ?? '',
      state,
      scope: FACEBOOK_SCOPES,
    });
    res.redirect(`https://www.facebook.com/v23.0/dialog/oauth?${params.toString()}`);
  }

  /**
   * Step 2: unlike Google, a short-lived user token here isn't directly
   * usable -- it must be exchanged for a long-lived one, then exchanged
   * AGAIN for the Page-scoped access token(s) FacebookProvider actually
   * needs (see its own doc comment on why there's no refresh flow after
   * this point). A user can manage more than one Page, which YouTube's
   * single-channel flow has no equivalent of: 0 pages is an error, exactly
   * 1 auto-connects, 2+ needs the host to pick one via the pending-pages
   * cookie + /facebook/select below.
   */
  @Get('facebook/callback')
  async facebookCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @CurrentAccount() account: Account,
    @Req() req: AccountRequest,
    @Res() res: Response,
  ): Promise<void> {
    const cookieState = req.cookies?.[FACEBOOK_OAUTH_STATE_COOKIE_NAME];
    res.clearCookie(FACEBOOK_OAUTH_STATE_COOKIE_NAME, { path: FACEBOOK_OAUTH_BASE_PATH });

    if (!code || !state || !cookieState || state !== cookieState) {
      this.logger.warn(
        `Facebook OAuth callback: CSRF state mismatch (code present: ${!!code}, state present: ${!!state}, cookie present: ${!!cookieState})`,
      );
      res.redirect('/connections?error=facebook_oauth_failed');
      return;
    }

    try {
      const appId = this.config.get<string>('facebook.appId') ?? '';
      const appSecret = this.config.get<string>('facebook.appSecret') ?? '';
      const redirectUri = this.config.get<string>('facebook.redirectUri') ?? '';

      const shortLivedRes = await fetch(
        `${FACEBOOK_API_BASE}/oauth/access_token?${new URLSearchParams({
          client_id: appId,
          redirect_uri: redirectUri,
          client_secret: appSecret,
          code,
        }).toString()}`,
      );
      if (!shortLivedRes.ok) {
        this.logger.error(
          `Facebook short-lived token exchange failed (${shortLivedRes.status}): ${await shortLivedRes.text()}`,
        );
        res.redirect('/connections?error=facebook_oauth_failed');
        return;
      }
      const { access_token: shortLivedToken } = (await shortLivedRes.json()) as { access_token: string };

      const longLivedRes = await fetch(
        `${FACEBOOK_API_BASE}/oauth/access_token?${new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortLivedToken,
        }).toString()}`,
      );
      if (!longLivedRes.ok) {
        this.logger.error(
          `Facebook long-lived token exchange failed (${longLivedRes.status}): ${await longLivedRes.text()}`,
        );
        res.redirect('/connections?error=facebook_oauth_failed');
        return;
      }
      const { access_token: longLivedToken } = (await longLivedRes.json()) as { access_token: string };

      const pagesRes = await fetch(
        `${FACEBOOK_API_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(longLivedToken)}`,
      );
      if (!pagesRes.ok) {
        this.logger.error(`Facebook /me/accounts lookup failed (${pagesRes.status}): ${await pagesRes.text()}`);
        res.redirect('/connections?error=facebook_oauth_failed');
        return;
      }
      const { data: pages } = (await pagesRes.json()) as { data: FacebookPendingPage[] };

      if (!pages || pages.length === 0) {
        this.logger.warn(`Facebook account for account.id=${account.id} manages no Pages -- nothing to connect.`);
        res.redirect('/connections?error=facebook_no_pages');
        return;
      }

      this.logger.log(
        `Facebook OAuth callback for account.id=${account.id}: found ${pages.length} Page(s) (${pages
          .map((p) => p.name)
          .join(', ')})`,
      );

      if (pages.length === 1) {
        await this.platformConnectionsService.upsertFacebookConnection(
          account.id,
          { pageId: pages[0].id, pageName: pages[0].name },
          pages[0].access_token,
        );
        res.redirect('/connections?connected=facebook');
        return;
      }

      // More than one Page -- hold the list server-side (see
      // pendingFacebookPageSelections' doc comment for why: it can be too
      // large for a cookie) and let the host pick via GET/POST
      // facebook/pages|select below, which only ever need this small id.
      const selectionId = crypto.randomBytes(24).toString('base64url');
      this.pendingFacebookPageSelections.set(selectionId, {
        accountId: account.id,
        pages,
        expiresAt: Date.now() + FACEBOOK_PENDING_SELECTION_TTL_MS,
      });
      res.cookie(FACEBOOK_PENDING_PAGES_COOKIE_NAME, selectionId, {
        httpOnly: true,
        secure: this.config.get<boolean>('cookieSecure'),
        sameSite: 'lax',
        path: FACEBOOK_OAUTH_BASE_PATH,
        maxAge: FACEBOOK_PENDING_SELECTION_TTL_MS,
      });
      res.redirect('/connections?facebookPagesPending=1');
    } catch (err) {
      this.logger.error('Facebook OAuth callback threw unexpectedly', err instanceof Error ? err.stack : err);
      res.redirect('/connections?error=facebook_oauth_failed');
    }
  }

  /** Looks up a pending Page-selection by the small id the cookie actually
   * carries, scoped to the requesting account -- never trusts the id alone,
   * since it's only ever meant to be used alongside that account's own
   * session cookie. Lazily evicts an expired entry rather than requiring a
   * sweep timer, proportionate to how rarely this path is hit at all. */
  private getPendingFacebookPages(selectionId: string | undefined, accountId: string): FacebookPendingPage[] | null {
    if (!selectionId) return null;
    const entry = this.pendingFacebookPageSelections.get(selectionId);
    if (!entry || entry.accountId !== accountId) return null;
    if (Date.now() > entry.expiresAt) {
      this.pendingFacebookPageSelections.delete(selectionId);
      return null;
    }
    return entry.pages;
  }

  /** Lists the pending Pages from a just-completed Facebook OAuth round
   * that had more than one Page to choose from -- names/ids only, the
   * per-Page access tokens never leave the server (see
   * pendingFacebookPageSelections). */
  @Get('facebook/pages')
  listFacebookPendingPages(
    @CurrentAccount() account: Account,
    @Req() req: AccountRequest,
  ): { id: string; name: string }[] {
    const pages = this.getPendingFacebookPages(req.cookies?.[FACEBOOK_PENDING_PAGES_COOKIE_NAME], account.id);
    return (pages ?? []).map((p) => ({ id: p.id, name: p.name }));
  }

  @Post('facebook/select')
  async selectFacebookPage(
    @CurrentAccount() account: Account,
    @Req() req: AccountRequest,
    @Res() res: Response,
    @Body('pageId') pageId: string,
  ) {
    const selectionId = req.cookies?.[FACEBOOK_PENDING_PAGES_COOKIE_NAME];
    const pages = this.getPendingFacebookPages(selectionId, account.id);
    if (!pages) {
      res.status(HttpStatus.BAD_REQUEST).json({ message: 'No pending Facebook pages to select from.' });
      return;
    }
    const chosen = pages.find((p) => p.id === pageId);
    if (!chosen) {
      res.status(HttpStatus.BAD_REQUEST).json({ message: 'That Page was not in the pending list.' });
      return;
    }

    const connection = await this.platformConnectionsService.upsertFacebookConnection(
      account.id,
      { pageId: chosen.id, pageName: chosen.name },
      chosen.access_token,
    );
    this.pendingFacebookPageSelections.delete(selectionId!);
    res.clearCookie(FACEBOOK_PENDING_PAGES_COOKIE_NAME, { path: FACEBOOK_OAUTH_BASE_PATH });
    res.json(plainToInstance(PlatformConnectionResponseDto, connection, { excludeExtraneousValues: true }));
  }

  @Post('twitch/manual')
  async createManualTwitchConnection(
    @CurrentAccount() account: Account,
    @Body() dto: CreateManualTwitchConnectionDto,
  ) {
    const connection = await this.platformConnectionsService.createManualTwitchConnection(
      account.id,
      dto,
    );
    return plainToInstance(PlatformConnectionResponseDto, connection, {
      excludeExtraneousValues: true,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.platformConnectionsService.remove(id, account.id);
  }
}
