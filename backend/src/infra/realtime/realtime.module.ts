import { Global, Module } from '@nestjs/common';

import { RealtimePublisherService } from './realtime-publisher.service';

/** Realtime fan-out. Global — chat, tickets and contacts all publish events. */
@Global()
@Module({
  providers: [RealtimePublisherService],
  exports: [RealtimePublisherService],
})
export class RealtimeModule {}
