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
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import { BANK_DIRECTORY, type BankInfo } from './bank-directory';
/**
 * VALUE import, deliberately not `import type`.
 *
 * A type-only import is erased at runtime, so `design:paramtypes` records
 * `Function` instead of the DTO class and the global ValidationPipe has no
 * metatype to validate against — it then treats every property as unknown and
 * answers "property content_json should not exist" before the handler runs.
 * The golden diff caught exactly that, against legacy's "name and content_json
 * are required".
 */
import {
  BulkFlexGroupsDto,
  CreateFlexMessageDto,
  UpdateFlexMessageDto,
} from './dto';
import {
  FlexMessagesService,
  isFlexFieldError,
  type AuditRequestMetaLike,
  type BulkFlexGroupsResult,
  type FlexMessageListItem,
} from './flex-messages.service';

/**
 * Flex card templates and the bank registry.
 *
 * ⚠️ ROUTE ORDER IS LOAD-BEARING. `variables` and `banks` must be declared
 * BEFORE `:id`, or Express matches the parameterised route first and answers
 * `400 Invalid identifier` for both. Legacy carries the same warning at
 * apiRoutes.js:468. Nest matches in declaration order too, so the ordering here
 * is a behaviour guarantee, not a style choice.
 */

/** Request-scoped metadata recorded on every audit entry. */
const buildRequestMeta = (req: Request): AuditRequestMetaLike => ({
  request_id: firstHeader(req.headers['x-request-id']),
  ip: firstHeader(req.headers['x-forwarded-for']) ?? req.ip,
  user_agent: firstHeader(req.headers['user-agent']),
});

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

@Controller('api')
export class FlexMessagesController {
  constructor(private readonly flexService: FlexMessagesService) {}

  /**
   * Central bank registry, served so the frontend does not keep its own copy.
   *
   * `authenticate` only in legacy — no `authorize(...)`, so any logged-in
   * caller may read it (apiRoutes.js:472). It is public reference data: codes,
   * display names, colours and logo paths, no customer data and no secret.
   * The comment above that route ("ทุกเส้นต้องมี authorize — บทเรียนจาก
   * /api/banks") records that this endpoint was once fully public; requiring a
   * token is the fix that was already applied, and it is preserved here.
   */
  @Get('banks')
  public getBankDirectory(): {
    data: Record<string, Record<string, BankInfo>>;
  } {
    return { data: BANK_DIRECTORY };
  }

  @Get('flex-messages')
  @RequirePermissions('flex.manage')
  public async listFlexMessages(
    @Query() query: Record<string, string | undefined>,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<{
    data: FlexMessageListItem[];
    meta: { total: number; page: number; limit: number };
  }> {
    return this.flexService.listFlexMessages(query, user);
  }

  /**
   * ⚠️ DECLARED BEFORE `flex-messages/:id`, AND THAT IS THE WHOLE BUG.
   *
   * The header of this file already warned that `variables` must precede `:id`
   * — but the route it was warning about had never actually been added, so
   * `/api/flex-messages/variables` fell through to the detail handler, which
   * parsed "variables" as an id and answered `400 Invalid identifier`. The
   * dashboard calls this on every card modal open, so every create and edit
   * silently lost its variable guidelines. Moving a route below this one
   * reintroduces exactly that.
   */
  @Get('flex-messages/variables')
  @RequirePermissions('flex.manage')
  public getFlexVariableGuidelines(
    @Query() query: { flex_type?: string; source?: string },
  ): { data: Record<string, unknown> } {
    return this.flexService.getFlexVariableGuidelines(query);
  }

  @Get('flex-messages/:id')
  @RequirePermissions('flex.manage')
  public async getFlexMessageById(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<FlexMessageListItem> {
    return this.flexService.getFlexMessageById(id, user);
  }

  /**
   * `@Res({ passthrough: false })` is used on the three writing routes purely
   * so a `{ error, field }` rejection keeps both keys — see `FlexFieldError`.
   * The success path is an ordinary JSON write with the same status legacy uses.
   */
  @Post('flex-messages')
  @RequirePermissions('flex.manage')
  @HttpCode(201)
  public async createFlexMessage(
    @Body() dto: CreateFlexMessageDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.flexService.createFlexMessage(
      dto,
      user,
      buildRequestMeta(req),
    );
    if (isFlexFieldError(result)) {
      const { status, ...body } = result;
      res.status(status).json(body);
      return;
    }
    res.status(201).json(result);
  }

  /**
   * [FEAT-20260830-FLEXBULKGROUPS] change the group scope of many cards at once.
   *
   * ROUTE ORDER: this is a POST on `flex-messages/bulk-groups` and the only
   * other POST here is `flex-messages`, so nothing can shadow it — the `:id`
   * warning in the file header applies to GET/PUT/DELETE. It is still declared
   * next to its sibling POST rather than after `:id`, so the ordering stays
   * obvious to the next reader.
   *
   * 200, not the 201 Nest gives every @Post: this edits cards that already
   * exist, the same call `DynamicTagsService.bulkScope` makes for its endpoint.
   */
  @Post('flex-messages/bulk-groups')
  @RequirePermissions('flex.manage')
  @HttpCode(200)
  public async bulkUpdateFlexGroups(
    @Body() dto: BulkFlexGroupsDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ): Promise<BulkFlexGroupsResult> {
    return this.flexService.bulkUpdateGroups(dto, user, buildRequestMeta(req));
  }

  @Put('flex-messages/:id')
  @RequirePermissions('flex.manage')
  public async updateFlexMessage(
    @Param('id') id: string,
    @Body() dto: UpdateFlexMessageDto,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.flexService.updateFlexMessage(
      id,
      dto,
      user,
      buildRequestMeta(req),
    );
    if (isFlexFieldError(result)) {
      const { status, ...body } = result;
      res.status(status).json(body);
      return;
    }
    res.status(200).json(result);
  }

  @Delete('flex-messages/:id')
  @RequirePermissions('flex.manage')
  public async deleteFlexMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Req() req: Request,
  ): Promise<{ message: string; id: unknown }> {
    return this.flexService.deleteFlexMessage(id, user, buildRequestMeta(req));
  }
}
