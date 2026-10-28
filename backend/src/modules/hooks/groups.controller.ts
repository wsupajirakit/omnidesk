/**
 * Groups CRUD — ported from legacy-api/src/controllers/hook/groupController.js.
 *
 * Permissions mirror the legacy `authorize(...)` on each route exactly:
 * the list route accepts either `group.manage` OR `flex.manage` (the flex card
 * editor needs the group dropdown), every other route requires `group.manage`.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
// [FEAT-20260817-GROUPBULKSTATUS] body of the bulk status route below
import { BulkGroupStatusDto } from './dto/bulk-group-status.dto';
import { GroupsService, type GroupListQuery } from './groups.service';
// [FEAT-20260808-AUDITSITE] request_meta builder (legacy buildRequestMeta,
// groupController.js:15-21).
import { buildRequestMeta } from './hook-audit-log.service';

@ApiTags('groups')
@Controller('api/groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  @RequirePermissions('group.manage', 'flex.manage')
  @ApiOperation({ summary: 'List groups visible to the caller' })
  async listGroups(
    @Query() query: GroupListQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.groupsService.listGroups(query, user);
  }

  @Get(':id')
  @RequirePermissions('group.manage')
  @ApiOperation({ summary: 'Get one group' })
  async getGroupById(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.groupsService.getGroupById(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('group.manage')
  @ApiOperation({ summary: 'Create a group' })
  async createGroup(
    @Body() dto: CreateGroupDto,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.groupsService.createGroup(
      dto,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  /**
   * [FEAT-20260817-GROUPBULKSTATUS] Turn many groups on or off in one request.
   *
   * ⚠️ ROUTE ORDER: this sits ABOVE `@Put(':id')` and uses PATCH, so `status/bulk`
   * can never be read as an `:id`. Nest matches in declaration order, and the
   * hooks module hit exactly this trap (`hooks.controller.ts:248` sits above its
   * own `:id` routes for the same reason).
   * ต้องอยู่เหนือ ':id' ไม่งั้น 'status/bulk' จะกลายเป็น id.
   */
  @Patch('status/bulk')
  @RequirePermissions('group.manage')
  @ApiOperation({ summary: 'Turn many groups on or off (all-or-nothing)' })
  async bulkUpdateGroupStatus(
    @Body() dto: BulkGroupStatusDto,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.groupsService.bulkUpdateGroupStatus(
      dto.ids,
      dto.status,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Put(':id')
  @RequirePermissions('group.manage')
  @ApiOperation({ summary: 'Update a group' })
  async updateGroup(
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.groupsService.updateGroup(
      id,
      dto,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('group.manage')
  @ApiOperation({ summary: 'Soft-delete a group' })
  async deleteGroup(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.groupsService.deleteGroup(id, user);
  }
}
