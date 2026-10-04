import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { legacyHostRedirect } from './common/legacy-hosts';

/**
 * Everything main.ts layers onto the Nest app besides creating it. Shared so
 * the end-to-end tests exercise exactly the production pipeline (cookies,
 * the /api prefix, validation, error shape) instead of a lookalike.
 * Create the app with `{ rawBody: true }`: Razorpay's webhook signature is an
 * HMAC of the exact bytes received.
 */
export function configureApp(app: INestApplication): void {
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
}
