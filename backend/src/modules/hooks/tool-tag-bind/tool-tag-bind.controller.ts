/**
 * [FEAT-20261016-TAGBIND] `POST /api/custom-tool-tag-bind/:toolId` — the Custom Tools page's
 * "ผูก tag" button. Binds the provider template's tags to every OA using that tool and
 * answers what it did (inserted · bound · already · skipped with the reason).
 *
 * Same gate as every Custom Tools route: `custom_tools.manage`. shop-api (no template) ⇒ 404.
 * Rules: `tag-bind-plan.ts`. revert: delete this folder + its two lines in `hooks.module.ts`.
 */
import { Controller, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { buildRequestMeta } from '../hook-audit-log.service';
import {
  ToolTagBindService,
  type TagBindReport,
} from './tool-tag-bind.service';

@ApiTags('custom-tools')
@Controller('api/custom-tool-tag-bind')
@RequirePermissions('custom_tools.manage')
export class ToolTagBindController {
  constructor(private readonly tagBind: ToolTagBindService) {}

  @Post(':toolId')
  @ApiOperation({
    summary: 'Bind the template dynamic tags to every OA using this tool',
  })
  async bind(
    @Param('toolId') toolId: string,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ success: true; data: TagBindReport }> {
    const data = await this.tagBind.bindToolTags(
      toolId,
      user,
      buildRequestMeta(request.headers, request.ip),
    );
    return { success: true, data };
  }
}
