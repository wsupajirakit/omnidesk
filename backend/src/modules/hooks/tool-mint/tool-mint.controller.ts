/**
 * [FEAT-20261016-TOOLMINT] The Custom Tools page's mint buttons.
 *   `GET  /api/custom-tool-mint`          → `{ success, data: { tool_mint } }` — the companies,
 *        whether each is ready, the env KEY NAMES missing, the skeleton. null on shop-api.
 *   `POST /api/custom-tool-mint/:company` → creates the company's tool (env complete only).
 * Same gate as every Custom Tools route: `custom_tools.manage`.
 * A path of its own (not under `/api/custom-tools`) so it can never be swallowed by that
 * controller's `:id` routes. revert: delete this folder + its two lines in `hooks.module.ts`.
 */
import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';
import type { ToolMintWire } from '@/modules/customer-provider';

import { buildRequestMeta } from '../hook-audit-log.service';
import { ToolMintService, type ToolMintResult } from './tool-mint.service';

@ApiTags('custom-tools')
@Controller('api/custom-tool-mint')
@RequirePermissions('custom_tools.manage')
export class ToolMintController {
  constructor(private readonly mintService: ToolMintService) {}

  @Get()
  @ApiOperation({
    summary: 'Which companies this site can mint a tool for (no credentials)',
  })
  catalog(): { success: true; data: { tool_mint: ToolMintWire | null } } {
    return { success: true, data: { tool_mint: this.mintService.catalog() } };
  }

  @Post(':company')
  @ApiOperation({ summary: "Mint the company's custom tool from server env" })
  async mint(
    @Param('company') company: string,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ success: true; data: ToolMintResult }> {
    const data = await this.mintService.mint(
      company,
      user,
      buildRequestMeta(request.headers, request.ip),
    );
    return { success: true, data };
  }
}
