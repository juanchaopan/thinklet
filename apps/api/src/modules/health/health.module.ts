import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infrastructure/database/database.module.js';
import { StorageModule } from '../../infrastructure/storage/storage.module.js';
import { HealthController } from './health.controller.js';
import { HealthRepository } from './health.repository.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [DatabaseModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthRepository, HealthService],
})
export class HealthModule {}
