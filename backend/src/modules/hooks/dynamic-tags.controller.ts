/**
 * Dynamic tags REST surface.
 *
 * Source routing: legacy-api/src/routes/apiRoutes.js:478-492. All seven routes
 * are gated by `authorize("dynamic_tags.manage")`.
 *
 * ⚠️ Route ORDER. Nest matches top-down, like Express:
 *   - `sub-types` must precede `:id`, or a request for it binds `id =
 *     "sub-types"` and answers 400 "Invalid ID format".
 *   - `bulk-scope` is a POST and `:id` is only GET/PUT/DELETE, so today they
 *     cannot collide — it is still declared above them so that adding a
 *     `POST :id` later cannot silently shadow it.
 */

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
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  MongooseReadErrorInterceptor,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import {
  type BulkScopeBody,
  type DynamicTagBody,
  type DynamicTagListQuery,
  DynamicTagsService,
} from './dynamic-tags.service';
import { buildRequestMeta } from './hook-audit-log.service';

@ApiTags('dynamic-tags')
@Controller('api/dynamic-tags')
@RequirePermissions('dynamic_tags.manage')
export class DynamicTagsController {
  constructor(private readonly dynamicTags: DynamicTagsService) {}

  private meta(request: Request): ReturnType<typeof buildRequestMeta> {
    return buildRequestMeta(request.headers, request.ip);
  }

  /**
   * ⚠️ `hook_id` is the ONE scope filter legacy does not guard with
   * `isValidObjectId` — `group_id` and `scope_group_id` are checked
   * (dynamicTagController.js:76,84) but `hook_id` goes straight into the query
   * (dynamicTagController.js:64-72). A malformed value therefore reaches
   * Mongoose, which throws a `CastError` on `hook_ids`, and legacy's `catch`
   * answers 500 carrying that message verbatim (dynamicTagController.js:135-137).
   *
   * Without the interceptor the global filter turns it into 500
   * `{"error":"internal error"}` — right status, wrong body. Verified against
   * both running backends:
   *   GET /api/dynamic-tags?hook_id=notanid
   *   legacy 500 {"error":"Cast to ObjectId failed for value \"notanid\" …"}
   *
   * Adding an `isValidObjectId` guard here instead would be the tempting
   * "cleanup" and would be WRONG: it changes a 500 into a 200 for a request
   * legacy rejects, and this port's contract is to match legacy even where
   * legacy is ugly.
   */
  @Get()
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'List dynamic tags, filtered by scope and search' })
  async list(
    @Query() query: DynamicTagListQuery,
  ): Promise<Record<string, unknown>> {
    return this.dynamicTags.list(query);
  }

  /** ⚠️ Before `:id` — see the file header. */
  @Get('sub-types')
  @ApiOperation({ summary: 'Distinct sub_type values with counts' })
  async subTypes(): Promise<Record<string, unknown>> {
    return this.dynamicTags.subTypes();
  }

  @Post()
  @ApiOperation({ summary: 'Create a dynamic tag (name is auto-generated)' })
  async create(
    @Body() body: DynamicTagBody,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.dynamicTags.create(body, user, this.meta(request));
  }

  /** ⚠️ Declared above the `:id` routes — see the file header. */
  @Post('bulk-scope')
  // Legacy answers 200 via res.json() (dynamicTagController.js:645), not the 201
  // Nest gives every @Post. This is an in-place scope edit, not a creation.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace the group/OA scope of many tags at once' })
  async bulkScope(
    @Body() body: BulkScopeBody,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.dynamicTags.bulkScope(body, user, this.meta(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dynamic tag detail' })
  async findOne(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.dynamicTags.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a dynamic tag' })
  async update(
    @Param('id') id: string,
    @Body() body: DynamicTagBody,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.dynamicTags.update(id, body, user, this.meta(request));
  }

  /** Soft delete. 204 with an empty body, matching legacy. */
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a dynamic tag' })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    return this.dynamicTags.remove(id, user, this.meta(request));
  }
}
