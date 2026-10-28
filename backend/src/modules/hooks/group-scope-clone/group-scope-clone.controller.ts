/**
 * [FEAT-20260816-GROUPSCOPECLONE] Two routes, one operation.
 *
 * ⚠️ ROUTE ORDER. Both are POST under `api/groups`, where GroupsController
 * already owns `POST api/groups` (create). They cannot collide — `scope-clone`
 * adds a path segment — and neither shadows the `:id` routes there, which are
 * GET/PUT/DELETE only. Nest matches per method, so registration order between
 * the two controllers does not matter here.
 *
 * `preview` is a POST despite reading nothing: it takes the same body as the
 * write, and a GET carrying a target-list would have to encode it in the query
 * string, where it would end up in access logs and browser history.
 *
 * The declared permission is `group.manage` — the guard treats a list as OR, so
 * the per-collection rights (`dynamic_tags.manage`, `flex.manage`) are enforced
 * inside the service instead, where they can be checked against what the
 * request actually asked to copy.
 */
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { buildRequestMeta } from '../hook-audit-log.service';

import {
  GroupScopeCloneService,
  type ScopeCloneBody,
  type ScopeCloneResult,
} from './group-scope-clone.service';

@ApiTags('groups')
@Controller('api/groups')
export class GroupScopeCloneController {
  constructor(private readonly scopeClone: GroupScopeCloneService) {}

  @Post('scope-clone/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('group.manage')
  @ApiOperation({
    summary: 'Count what copying a group scope would change — writes nothing',
  })
  async preview(
    @Body() body: ScopeCloneBody,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ScopeCloneResult> {
    return this.scopeClone.preview(body, user);
  }

  @Post('scope-clone')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('group.manage')
  @ApiOperation({
    summary:
      "Copy a group's dynamic tags and flex cards onto other groups (mode=remove undoes it)",
  })
  async apply(
    @Body() body: ScopeCloneBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<ScopeCloneResult> {
    return this.scopeClone.apply(
      body,
      user,
      buildRequestMeta(req.headers, req.ip),
    );
  }
}
