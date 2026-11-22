import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Environment } from '../config/environment.js';
import { httpLoggerOptions, secretValues } from './logger-options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        pinoHttp: httpLoggerOptions(
          secretValues({
            DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
            S3_ACCESS_KEY_ID: config.get('S3_ACCESS_KEY_ID', { infer: true }),
            S3_SECRET_ACCESS_KEY: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
            OIDC_CLIENT_SECRET: config.get('OIDC_CLIENT_SECRET', { infer: true }),
            JWT_SIGNING_KEY: config.get('JWT_SIGNING_KEY', { infer: true }),
          }),
        ),
      }),
    }),
  ],
})
export class LoggingModule {}
