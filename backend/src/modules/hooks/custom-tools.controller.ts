/**
 * Custom tools REST surface.
 *
 * Source routing: legacy-api/src/routes/apiRoutes.js:498-511. Every route is
 * gated by `authorize("custom_tools.manage")` there, so every handler here
 * carries `@RequirePermissions('custom_tools.manage')` — unlike the `/hook`
 * routes, which deliberately carry none (see hooks.controller.ts).
 *
 * ⚠️ Route ORDER matters. `test-draft` must be declared before `:id/test`, and
 * both before the bare `:id` routes: Nest matches top-down like Express, so a
 * literal segment declared after a parameter route is never reached — the
 * request binds `id = "test-draft"` and 404s or 500s on a cast instead.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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

import { buildRequestMeta } from './hook-audit-log.service';
import {
  type AssignCustomToolBody,
  type CustomToolBody,
  type CustomToolListQuery,
  CustomToolsService,
} from './custom-tools.service';

@ApiTags('custom-tools')
@Controller('api/custom-tools')
@RequirePermissions('custom_tools.manage')
export class CustomToolsController {
  constructor(private readonly customTools: CustomToolsService) {}

  /** Request headers legacy records on every audit entry. */
  private meta(request: Request): ReturnType<typeof buildRequestMeta> {
    return buildRequestMeta(request.headers, request.ip);
  }

  @Get()
  @ApiOperation({ summary: 'List custom tools; secrets never returned' })
  async list(
    @Query() query: CustomToolListQuery,
  ): Promise<Record<string, unknown>> {
    return this.customTools.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom tool' })
  async create(
    @Body() body: CustomToolBody,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.customTools.create(body, user, this.meta(request));
  }

  /**
   * ⚠️ Declared before `:id/usage` and `:id` — see the file header.
   * `:id/usage` is a two-segment route so it cannot collide with `:id`, but the
   * ordering is kept explicit so a later edit does not reintroduce the trap.
   */
  @Get(':id/usage')
  @ApiOperation({ summary: 'Which OAs reference this tool' })
  async usage(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.customTools.usage(id);
  }

  @Put(':id/assign')
  @ApiOperation({ summary: 'Link/unlink many OAs to this tool (replace)' })
  async assign(
    @Param('id') id: string,
    @Body() body: AssignCustomToolBody,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.customTools.assign(id, body, user, this.meta(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Custom tool detail; secrets never returned' })
  async findOne(@Param('id') id: string): Promise<Record<string, unknown>> {
    return this.customTools.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a custom tool' })
  async update(
    @Param('id') id: string,
    @Body() body: CustomToolBody,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.customTools.update(id, body, user, this.meta(request));
  }

  /** Soft delete. 204 with an empty body, matching legacy's `res.status(204)`. */
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a custom tool' })
  async remove(
    @Param('id') id: string,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<void> {
    return this.customTools.remove(id, user, this.meta(request));
  }
}
