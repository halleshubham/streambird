import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root() {
    return {
      name: 'streambird',
      status: 'ok',
      docs: 'https://github.com/halleshubham/streambird',
    };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
