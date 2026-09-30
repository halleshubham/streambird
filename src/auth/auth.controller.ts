import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { SessionGuard, SessionRequest } from '../common/guards/session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

const SESSION_COOKIE_NAME = 'sb_session';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
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

  @Post('request-code')
  @HttpCode(202)
  async requestCode(@Body() dto: RequestCodeDto): Promise<{ message: string }> {
    // Always the same response whether or not this email has an account yet
    // -- request-code must never leak which emails are registered.
    await this.authService.requestCode(dto.email);
    return { message: 'If that email is valid, a login code has been sent.' };
  }

  @Post('verify-code')
  @HttpCode(200)
  async verifyCode(
    @Body() dto: VerifyCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: { id: string; email: string }; accountId: string }> {
    const { user, account, token, expiresAt } = await this.authService.verifyCode(
      dto.email,
      dto.code,
      {},
    );

    res.cookie(SESSION_COOKIE_NAME, token, this.cookieOptions(expiresAt));

    return { user: { id: user.id, email: user.email }, accountId: account.id };
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

  @Get('me')
  @UseGuards(SessionGuard)
  async me(
    @CurrentUser() user: User,
    @Req() req: SessionRequest,
  ): Promise<{ user: { id: string; email: string; createdAt: Date }; accountId: string }> {
    return {
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
      accountId: req.account!.id,
    };
  }
}
