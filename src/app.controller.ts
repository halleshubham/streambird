import { Controller, Get } from '@nestjs/common';

// GET / used to return a JSON status blurb here -- the React SPA (served
// by ServeStaticModule from dist-web/, see app.module.ts) is a strictly
// better use of that path now that it exists, so this controller only
// owns the health check.
@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
