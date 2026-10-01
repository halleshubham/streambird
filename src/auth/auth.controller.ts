import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { SignupCompanyDto } from './dto/signup-company.dto';
import { SuperadminLoginDto } from './dto/superadmin-login.dto';
import { SessionGuard, SessionRequest } from '../common/guards/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

const SESSION_COOKIE_NAME = 'sb_session';
const OAUTH_STATE_COOKIE_NAME = 'sb_oauth_state';
const GOOGLE_OAUTH_BASE_PATH = '/api/auth/google';

interface AuthResponse {
  user: { id: string; email: string; role: string; approvedAt: Date | null };
  accountId: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly config: ConfigService,
  ) {}

  private cookieOptions(expiresAt?: Date) {
    return {
      httpOnly: true,
      secure: this.config.get<boolean>('cookieSecure'),
      sameSite: 'lax' as const,
      path: '/',
      expires: expiresAt,
    };
  }

  private setSessionCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions(expiresAt));
  }

  private toAuthResponse(user: User, accountId: string): AuthResponse {
    return {
      user: { id: user.id, email: user.email, role: user.role, approvedAt: user.approvedAt },
      accountId,
    };
  }

  @Post('request-code')
  @HttpCode(202)
  async requestCode(@Body() dto: RequestCodeDto): Promise<{ message: string }> {
    // Always the same response whether or not this email has an account yet
    // -- request-code must never leak which emails are registered. The
    // same endpoint is reused for both magic-code login AND the first
    // step of Company Admin sign-up (see POST /auth/signup-company).
    await this.authService.requestCode(dto.email);
    return { message: 'If that email is valid, a login code has been sent.' };
  }

  @Post('verify-code')
  @HttpCode(200)
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, account, token, expiresAt } = await this.authService.verifyCode(
      dto.email,
      dto.code,
      {},
    );

    this.setSessionCookie(res, token, expiresAt);
    return this.toAuthResponse(user, account.id);
  }

  /**
   * Company Admin sign-up: distinct from verify-code above. Send the code
   * first via the SAME POST /auth/request-code endpoint, then call this
   * with the companyName to actually create the Company + Account +
   * unapproved company_admin User. The resulting session is real (the new
   * admin is logged in immediately), but every AccountGuard-protected
   * route will reject them with 403 until a Superadmin approves them --
   * see AccountGuard's approval gate. GET /auth/me (below) keeps working
   * so the frontend can show a "pending approval" screen.
   */
  @Post('signup-company')
  @HttpCode(200)
  async signupCompany(
    @Body() dto: SignupCompanyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, account, token, expiresAt } = await this.authService.verifyCompanySignup(
      dto.companyName,
      dto.email,
      dto.code,
      {},
    );

    this.setSessionCookie(res, token, expiresAt);
    return this.toAuthResponse(user, account.id);
  }

  /**
   * Real password login for the fixed Superadmin identity/identities
   * seeded from SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD (see
   * SuperadminSeedService) -- the only role that ever authenticates with
   * a password instead of magic-code/Google. Issues the same session
   * cookie as every other login path.
   */
  @Post('superadmin-login')
  @HttpCode(200)
  async superadminLogin(
    @Body() dto: SuperadminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, account, token, expiresAt } = await this.authService.superadminLogin(
      dto.email,
      dto.password,
      {},
    );

    this.setSessionCookie(res, token, expiresAt);
    return this.toAuthResponse(user, account.id);
  }

  /**
   * Step 1 of "Sign in with Google": redirects to Google's consent
   * screen. `state` is a random, single-use CSRF token stashed in a
   * short-lived httpOnly cookie and checked again in the callback below.
   */
  @Get('google')
  googleRedirect(@Res() res: Response): void {
    const state = crypto.randomBytes(24).toString('base64url');
    res.cookie(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: this.config.get<boolean>('cookieSecure'),
      sameSite: 'lax',
      path: GOOGLE_OAUTH_BASE_PATH,
      maxAge: 10 * 60_000,
    });
    res.redirect(
      this.googleOAuth.buildAuthUrl(state, {
        redirectUri: this.config.get<string>('google.redirectUri') ?? '',
        scope: 'openid email profile',
        accessType: 'online',
        prompt: 'select_account',
      }),
    );
  }

  /**
   * Step 2: Google redirects the browser back here with `code`/`state`.
   * Exchanges the code for tokens, fetches the profile, and logs the user
   * in via AuthService.loginWithGoogleProfile -- the SAME company/role-
   * aware identity resolution every other login path uses (see that
   * method's docstring for the "brand-new email" decision). On any
   * failure this redirects back to the SPA's login page with an error
   * flag rather than throwing a bare API error, since this whole flow is
   * a full-page browser redirect, not a fetch() call the frontend can
   * catch.
   */
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: SessionRequest,
    @Res() res: Response,
  ): Promise<void> {
    const cookieState = req.cookies?.[OAUTH_STATE_COOKIE_NAME];
    res.clearCookie(OAUTH_STATE_COOKIE_NAME, { path: GOOGLE_OAUTH_BASE_PATH });

    if (!code || !state || !cookieState || state !== cookieState) {
      res.redirect('/login?error=google_oauth_failed');
      return;
    }

    try {
      const profile = await this.googleOAuth.exchangeCodeForProfile(
        code,
        this.config.get<string>('google.redirectUri') ?? '',
      );
      if (!profile.emailVerified) {
        res.redirect('/login?error=google_email_unverified');
        return;
      }

      const { token, expiresAt } = await this.authService.loginWithGoogleProfile(
        profile.email,
        {},
      );
      this.setSessionCookie(res, token, expiresAt);
      res.redirect('/');
    } catch {
      res.redirect('/login?error=google_oauth_failed');
    }
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @Req() req: SessionRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  }

  /**
   * Deliberately behind SessionGuard, NOT AccountGuard -- this is exactly
   * the "check my own pending-approval status" route the approval gate's
   * exception is for (see AccountGuard). An unapproved Company Admin can
   * always call this to see role/approvedAt and render a "pending" screen,
   * even though every AccountGuard-protected route rejects them.
   */
  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentUser() user: User, @Req() req: SessionRequest): Promise<AuthResponse> {
    return this.toAuthResponse(user, req.account!.id);
  }
}
