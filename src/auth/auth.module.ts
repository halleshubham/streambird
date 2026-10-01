import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginCode } from './entities/login-code.entity';
import { UserSession } from './entities/user-session.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleOAuthService } from './google-oauth.service';
import { SessionGuard } from '../common/guards/session.guard';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LoginCode, UserSession]),
    UsersModule,
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, GoogleOAuthService],
  exports: [AuthService, SessionGuard, GoogleOAuthService],
})
export class AuthModule {}
