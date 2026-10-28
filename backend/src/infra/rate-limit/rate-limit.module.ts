import { Global, Module } from '@nestjs/common';

import { RateLimitService } from './rate-limit.service';

/** Global — auth, webhooks and outbound API routes all throttle. */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class RateLimitModule {}
