import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { ClientIpHeader } from './client-ip.js';
import { RateLimiter } from './rate-limiter.js';

/**
 * Limits on the failures of a request's source: the controllers read the
 * source with ClientIpHeader, and the services count with RateLimiter.
 */
@Module({
  imports: [RedisModule],
  providers: [ClientIpHeader, RateLimiter],
  exports: [ClientIpHeader, RateLimiter],
})
export class RateLimitModule {}
