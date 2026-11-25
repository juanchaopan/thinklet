import { Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

/**
 * Redis, for data that should vanish once its time is up (decision 0039).
 * Every module that imports it shares the one connection of RedisService.
 */
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
