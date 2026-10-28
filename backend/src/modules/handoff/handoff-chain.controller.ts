import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '@/common';

import { CurrentUser, type AuthenticatedUser } from '@/common';
import { ChainErrorFilter } from './chain-error.filter';
import { ListOverridesQueryDto, ListRunsQueryDto } from './dto';
import { HandoffChainService } from './handoff-chain.service';

/**
 * Chains, per-hook overrides and run history.
 *
 * ── Error envelope ───────────────────────────────────────────────────────
 * This controller answers `{ message }`. The target, job and callback
 * controllers answer `{ error }`. Both are legacy behaviour, both are read by
 * the dashboard, and `diffContractValues` compares both keys — so the split is
 * preserved per controller and must NOT be unified. Changing either one is a
 * breaking API change, not a cleanup.
 *
 * `ChainErrorFilter` is what actually produces that envelope: the global
 * exception filter rewrites every body to `{ error }`, so throwing the right
 * shape from a handler is not sufficient. See the filter for the full note.
 */
@ApiTags('handoff')
@Controller('api/handoff')
@UseFilters(ChainErrorFilter)
export class HandoffChainController {
  constructor(private readonly chainService: HandoffChainService) {}

  /* ── chains ─────────────────────────────────────────────────────────── */

  @Get('chains')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'List chains' })
  async listChains(): Promise<{ data: Array<Record<string, unknown>> }> {
    return await this.chainService.listChains();
  }

  @Get('chains/:id')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Get one chain' })
  async getChain(
    @Param('id') id: string,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.chainService.getChain(id);
  }

  /** Raw body — see the note on the target controller's create. */
  @Post('chains')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Create a chain' })
  async createChain(
    @Body() body: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.chainService.createChain(body ?? {});
  }

  @Put('chains/:id')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Update a chain' })
  async updateChain(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.chainService.updateChain(id, body ?? {});
  }

  @Delete('chains/:id')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Soft-delete a chain' })
  async deleteChain(@Param('id') id: string): Promise<{ data: unknown }> {
    return await this.chainService.deleteChain(id);
  }

  /* ── overrides ──────────────────────────────────────────────────────── */

  @Get('overrides')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'List per-hook overrides' })
  async listOverrides(
    @Query() query: ListOverridesQueryDto,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    return await this.chainService.listOverrides(query);
  }

  /**
   * Upsert, so this answers 200 rather than 201 — legacy uses `res.json`, and
   * the route is a POST that may update an existing row.
   */
  @Post('overrides')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Upsert a per-hook override' })
  async upsertOverride(
    @Body() body: Record<string, unknown>,
    // [FIX-20260818-HANDOFFSCOPE · plan §8] this row decides where an OA's
    // outbound handoff traffic goes — the caller must own that OA.
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.chainService.upsertOverride(body ?? {}, auth);
  }

  @Delete('overrides/:id')
  @RequirePermissions('handoff.manage')
  @ApiOperation({ summary: 'Soft-delete a per-hook override' })
  async deleteOverride(@Param('id') id: string): Promise<{ data: unknown }> {
    return await this.chainService.deleteOverride(id);
  }

  /* ── run history ────────────────────────────────────────────────────── */

  /**
   * Run history carries its own permission alongside the module's:
   * `["handoff.manage", "handoff.history"]` (apiRoutes.js:552-553). Holding
   * EITHER is enough — that is what `@RequirePermissions` means, and it matches
   * the legacy `authorize([...])` array form. An auditor can be given
   * `handoff.history` alone and see the history without any ability to manage
   * targets.
   */
  @Get('chain-runs')
  @RequirePermissions('handoff.manage', 'handoff.history')
  @ApiOperation({ summary: 'List chain runs' })
  async listRuns(@Query() query: ListRunsQueryDto): Promise<unknown> {
    return await this.chainService.listRuns(query);
  }

  @Get('chain-runs/:id')
  @RequirePermissions('handoff.manage', 'handoff.history')
  @ApiOperation({ summary: 'Get one chain run with its steps' })
  async getRun(
    @Param('id') id: string,
  ): Promise<{ data: Record<string, unknown> }> {
    return await this.chainService.getRun(id);
  }
}
