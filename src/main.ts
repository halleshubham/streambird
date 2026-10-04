import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  // rawBody: Razorpay's webhook signature is an HMAC of the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
