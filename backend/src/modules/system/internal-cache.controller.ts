import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common';

import {
  InternalCacheService,
  type InternalCacheResponse,
} from './internal-cache.service';

/** `1` and `true` count as true, matching legacy's `toBoolean`. */
const isTruthyFlag = (value?: string): boolean =>
  value === '1' || value === 'true';

/**
 * `GET /api/internal/cache` — browses the on-disk `internal/` directory.
 *
 * Legacy: apiRoutes.js:585, guarded by `authorize("system.manage")`. That guard
 * is the security boundary, not a formality: the directory holds hook
 * credential caches, and this endpoint was public until [SEC-C1 2026-08-02].
 */
@ApiTags('system')
@Controller()
export class InternalCacheController {
  constructor(private readonly internalCache: InternalCacheService) {}

  @Get('api/internal/cache')
  @RequirePermissions('system.manage')
  @ApiOperation({ summary: 'Read the internal cache directory' })
  async getInternalCache(
    @Query('path') path?: string,
    @Query('all') all?: string,
  ): Promise<InternalCacheResponse> {
    return isTruthyFlag(all)
      ? this.internalCache.readAll(path)
      : this.internalCache.read(path);
  }
}
