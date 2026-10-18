import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// GET / used to return a JSON status blurb here -- the React SPA (served
// by ServeStaticModule from dist-web/, see app.module.ts) is a strictly
// better use of that path now that it exists, so this controller only
// owns the health check and the few public, non-secret settings the SPA
// needs at start-up.
@Controller()
export class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Public, unauthenticated, non-secret: only settings the browser must know before anyone signs in. */
  @Get('config/public')
  publicConfig() {
    return { cookieConsentBanner: !!this.config.get<boolean>('cookieConsentBanner') };
  }
}
