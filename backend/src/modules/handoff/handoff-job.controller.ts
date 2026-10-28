import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { ListJobsQueryDto } from './dto';
import { HandoffJobService, type ListJobsResult } from './handoff-job.service';
import { TargetErrorFilter } from './target-error.filter';

/**
 * Read-only job views. `{ error }` envelope, like the target controller.
 */
@ApiTags('handoff')
@Controller('api/handoff')
@UseFilters(TargetErrorFilter)
export class HandoffJobController {
  constructor(private readonly jobService: HandoffJobService) {}

  @Get('jobs')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'List handoff jobs' })
  async list(
    @Query() query: ListJobsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListJobsResult> {
    return await this.jobService.list(query, user);
  }

  @Get('jobs/:id')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Get one handoff job' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.jobService.getById(id, user);
  }

  /**
   * The raw request/response for one job.
   *
   * `handoff.view_raw`, NOT `handoff.manage` — the only route in the module
   * with its own permission, because it is the only one that returns the
   * unredacted exchange. Widening this to `handoff.manage` would hand every
   * handoff operator the raw payloads, so the narrower name is load-bearing
   * (apiRoutes.js:534).
   */
  @Get('jobs/:id/result')
  @RequirePermissions('handoff.view_raw')
  @ApiOperation({ summary: 'Get the raw result for one job' })
  async getResult(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.jobService.getResult(id, user);
  }
}
