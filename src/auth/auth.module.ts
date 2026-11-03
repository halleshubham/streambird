import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginCode } from './entities/login-code.entity';
import { UserSession } from './entities/user-session.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleIdTokenService } from './google-id-token.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { FacebookLoginService } from './facebook-login.service';
import { SessionGuard } from '../common/guards/session.guard';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LoginCode, UserSession]),
    UsersModule,
    EmailModule,
    // AuthModule cannot import CommonModule (it imports us); its own limiter for the public mobile sign-in.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, GoogleOAuthService, GoogleIdTokenService, FacebookLoginService],
  exports: [AuthService, SessionGuard, GoogleOAuthService],
})
export class AuthModule {}
