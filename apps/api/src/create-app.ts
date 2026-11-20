import { NotFoundException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { securityHeaders } from './infrastructure/security-headers/security-headers.middleware.js';

/** The prefix every route lives under. */
const GLOBAL_PREFIX = 'api';

/**
 * Turns a request outside the global prefix into a 404 for Nest's exception
 * handler, which Nest mounts at the root as well. Nest's own not-found
 * handler covers only the prefix, so without this such a request reaches
 * Express's final handler, which answers with an HTML page and replaces the
 * Content-Security-Policy set by the security headers middleware. The prefix
 * is matched without regard to case, as the Express router matches routes,
 * so every path the router would hand to a controller passes.
 */
function rejectOutsidePrefix(request: Request, _response: Response, next: NextFunction): void {
  const prefix = `/${GLOBAL_PREFIX}`;
  const path = request.path.toLowerCase();
  if (path === prefix || path.startsWith(`${prefix}/`)) {
    next();
    return;
  }
  next(new NotFoundException(`Cannot ${request.method} ${request.originalUrl}`));
}

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
  app.use(rejectOutsidePrefix);
  app.setGlobalPrefix(GLOBAL_PREFIX);
  return app;
}
