import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { legacyHostRedirect } from './common/legacy-hosts';
import { join } from 'path';
import { seoMiddleware } from './seo/seo';

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
  // robots.txt, sitemap.xml, prerendered public pages, noindex on the app and real 404s for unknown pages (src/seo/seo.ts).
  app.use(seoMiddleware({ publicBaseUrl: config.get<string>('publicBaseUrl') ?? '', webRoot: join(__dirname, '..', 'dist-web') }));
  // '/health' is Coolify's configured health-check path and must not move.
  // '/' itself needs no exclude: it's served by ServeStaticModule's
  // dist-web/ middleware now, which sits outside Nest's controller
  // routing/prefix entirely (see app.module.ts).
  // '/stream/:slug' is the public permanent live link (LiveLinkController), also at the site root.
  app.setGlobalPrefix('api', { exclude: ['health', 'stream/:slug'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
