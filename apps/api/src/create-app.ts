import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { securityHeaders } from './infrastructure/security-headers/security-headers.middleware.js';

/**
 * Builds the Nest application shared by every entry point: the long-running
 * process (main.ts), the Vercel function (server.ts) and the tests.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // Registered before the body parser and the routes, which Nest adds on
  // init, so 404s, parse errors and thrown exceptions carry the headers too.
  app.use(securityHeaders);
  app.setGlobalPrefix('api');
  return app;
}
