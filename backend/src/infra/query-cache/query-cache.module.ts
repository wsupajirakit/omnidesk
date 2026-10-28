// [FEAT-20260808-QCACHE]
import { Global, Module } from '@nestjs/common';

import { ScopedQueryCacheService } from './scoped-query-cache.service';

/**
 * Global — like RedisModule — so any read-heavy feature module (tickets/insight,
 * system/webhook-log, audit) injects ScopedQueryCacheService without importing
 * this module and without cycle risk. One instance per process (the in-process
 * single-flight Map must be shared across all callers on that instance).
 *
 * DB-EFFECT: this module adds NO schema and NO Mongo write. It provides a
 * Redis-backed read cache only.
 */
@Global()
@Module({
  providers: [ScopedQueryCacheService],
  exports: [ScopedQueryCacheService],
})
export class QueryCacheModule {}
