import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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

/**
 * OAuth connect/callback routes for Facebook/LinkedIn are still deferred
 * (see the Build Order in the implementation plan) -- YouTube's below is
 * the first of these to land, now that the YouTube Data API is enabled
 * on the shared Google Cloud project (the same OAuth client "Sign in
 * with Google" already uses, see AuthController, just with the
 * additional `youtube` scope and its own registered redirect URI -- see
 * google.youtubeRedirectUri). Twitch still has no such flow here because
 * Twitch's own API doesn't expose a user's stream key programmatically —
 * POST :platform/twitch/manual (below) is the actual connection method
 * for Twitch, not a stand-in for a future OAuth route.
 */
@Controller('platform-connections')
@UseGuards(AccountGuard)
export class PlatformConnectionsController {
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
