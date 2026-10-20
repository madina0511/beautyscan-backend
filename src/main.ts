import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // TODO(PRODUCTION):
  // Review the 'trust proxy' configuration before deployment.
  // Current 'loopback' setting trusts only local proxies.
  // If using Nginx, Docker, or a load balancer:
  // 1. Identify the trusted proxy IP addresses/subnets.
  // 2. Configure trust proxy for those proxies only.
  // 3. Verify the real client IP is detected correctly.
  // 4. Test GraphQL rate limiting behind the proxy.
  // SECURITY: Do not use 'trust proxy: true' without validation.
  app.set('trust proxy', 'loopback');

  app.set('trust proxy', 'loopback');

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
