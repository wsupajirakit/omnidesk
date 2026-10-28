import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

/**
 * Global because rate limiting, caching and realtime publishing all need the
 * same connection — one socket per process, not one per consuming module.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
