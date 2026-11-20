import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './infrastructure/config/environment.js';
import { LoggingModule } from './infrastructure/logging/logging.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    // Only process.env is read: Task loads the local .env file in development,
    // and the platform provides the variables everywhere else.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: environmentSchema,
    }),
    LoggingModule,
    HealthModule,
  ],
})
export class AppModule {}
