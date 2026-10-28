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

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { publicSchema, type PublicConfigEntry } from './config-store';
import { ListTargetsQueryDto } from './dto';
import {
  HandoffTargetService,
  type ListTargetsResult,
  type PublicTarget,
} from './handoff-target.service';
import { TargetErrorFilter } from './target-error.filter';

/**
 * Outbound handoff targets.
 *
 * Every route is gated by `handoff.manage`; OA scoping happens inside the
 * service. This controller answers the `{ error }` envelope — the chain
 * controller answers `{ message }`. That split is legacy behaviour and is
 * preserved per controller on purpose: the dashboard reads both keys, and
 * unifying them would change what it renders.
 */
@ApiTags('handoff')
@Controller('api/handoff')
@UseFilters(TargetErrorFilter)
@RequirePermissions('handoff.manage')
export class HandoffTargetController {
  constructor(private readonly targetService: HandoffTargetService) {}

  /**
   * The config registry the front end renders its form from.
   *
   * Declared before `/targets/:id` so `config-schema` is never captured as an
   * id — the same ordering constraint the legacy router carries a comment
   * about. Nest matches in declaration order, so this must stay above.
   *
   * No OA scoping: it is a schema, not data.
   */
  @Get('config-schema')
  @ApiOperation({ summary: 'Config registry for the target form' })
  getConfigSchema(): { data: PublicConfigEntry[] } {
    return { data: publicSchema() };
  }

  @Get('targets')
  @ApiOperation({ summary: 'List handoff targets' })
  async list(
    @Query() query: ListTargetsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListTargetsResult> {
    return await this.targetService.list(query, user);
  }

  @Get('targets/:id')
  @ApiOperation({ summary: 'Get one handoff target' })
  async getById(@Param('id') id: string): Promise<{ data: PublicTarget }> {
    return await this.targetService.getById(id);
  }

  /**
   * The body is taken raw, with no DTO class.
   *
   * The global ValidationPipe runs with `forbidNonWhitelisted`, so a DTO would
   * make an unknown key a 400 — where legacy accepts the request and lets
   * Mongoose's `strict: true` drop the key. Taking the raw object preserves
   * that. The checks legacy actually performs (key charset, `env_tag`, and the
   * config registry) run in the service before any database access.
   */
  @Post('targets')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a handoff target' })
  async create(
    @Body() body: Record<string, unknown>,
  ): Promise<{ data: PublicTarget }> {
    return await this.targetService.create(body ?? {});
  }

  @Put('targets/:id')
  @ApiOperation({ summary: 'Update a handoff target' })
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ data: PublicTarget }> {
    return await this.targetService.update(id, body ?? {});
  }

  @Delete('targets/:id')
  @ApiOperation({ summary: 'Soft-delete a handoff target' })
  async remove(@Param('id') id: string): Promise<{ data: unknown }> {
    return await this.targetService.remove(id);
  }
}
