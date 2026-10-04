import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { legacyHostRedirect } from './common/legacy-hosts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  // After a domain move, send page visits on the old host to the new one (no-op unless LEGACY_HOSTS is set).
  const config = app.get(ConfigService);
  app.use(legacyHostRedirect(config.get<string[]>('legacyHosts') ?? [], config.get<string>('publicBaseUrl') ?? ''));
  // '/health' is Coolify's configured health-check path and must not move.
  // '/' itself needs no exclude: it's served by ServeStaticModule's
  // dist-web/ middleware now, which sits outside Nest's controller
  // routing/prefix entirely (see app.module.ts).
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
