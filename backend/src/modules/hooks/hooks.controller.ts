/**
 * LIFTED — pending rewrite.
 *
 * Source: legacy-api/src/controllers/hook/hookController.js, routed in
 * legacy-api/src/routes/apiRoutes.js.
 *
 * Thin routing layer over HooksService; it is listed as lifted alongside that
 * service because the two are ported and split as one unit. See the header of
 * hooks.service.ts for why the split is deferred and what unblocks it.
 *
 * ⚠️ THE PATHS ARE AT THE ROOT, NOT UNDER /api. That is not an oversight — the
 * dashboard has `/hook` compiled in. Tidying it to `/api/hook` breaks every
 * screen that lists or opens an OA.
 *
 * ⚠️ NO @RequirePermissions ON ANY ROUTE HERE, deliberately. The legacy routes
 * carry no `authorize(...)` either: the accounts in real use (su · admin · dev)
 * do not hold `hook.manage` in their own `permissions` claim — only their role
 * does — and the permission check reads the claim. Adding the decorator 403s
 * exactly the people who use these screens today. Access is enforced per hook
 * inside the service instead, via group scoping (and, for the detail endpoint,
 * an explicit hook.manage check that legacy performs in the handler body).
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
  UseFilters,
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

import { BlockedHooksFilter } from './blocked-hooks.exception';
import { HookNotFoundFilter } from './hook-not-found.exception';
// [FEAT-20260817-HOOKLABELS] slim OA-label list, its own service
import { HookLabelsService } from './hook-labels/hook-labels.service';
import { HookCloneService } from './hook-clone/hook-clone.service';
import {
  HooksService,
  type HookListQuery,
  type RequestContext,
} from './hooks.service';

/** A write body that carries arbitrary hook fields. */
type HookBody = Record<string, unknown>;

/**
 * Collects what the audit log needs from the request.
 *
 * ⚠️ `@Body()` is typed as a plain object on every write route, NOT as a DTO.
 * That is required, not lazy: the global ValidationPipe runs with
 * `forbidNonWhitelisted: true`, so a DTO would reject or strip the free-form
 * hook fields legacy accepts, and its rejection envelope differs from the
 * in-handler `{ error: "<legacy string>" }` the dashboard parses. Validation
 * happens in the service, where legacy does it. Same reasoning as
 * dto/create-group.dto.ts, one step further.
 */
function contextFrom(req: Request, user?: AuthenticatedUser): RequestContext {
  const header = (name: string): string | undefined => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    user,
    actorUserId: header('x-actor-user-id'),
    actorUsername: header('x-actor-username'),
    actorDisplayName: header('x-actor-display-name'),
    requestId: header('x-request-id'),
    ip: header('x-forwarded-for') ?? req.ip,
    userAgent: header('user-agent'),
  };
}

@ApiTags('hooks')
@Controller('hook')
/**
 * Scoped to this controller only: legacy answers `{ message }` rather than the
 * service-wide `{ error }` envelope when a hook id resolves to nothing, and the
 * bulk endpoints answer a 403 with a second `blocked` key. See
 * hook-not-found.exception.ts and blocked-hooks.exception.ts for why both
 * differences are preserved rather than normalised.
 */
@UseFilters(HookNotFoundFilter, BlockedHooksFilter)
export class HooksController {
  constructor(
    private readonly hooksService: HooksService,
    // [FEAT-20260817-HOOKLABELS] the slim list lives in its own service so the
    // 2,000-line HooksService does not grow another method.
    private readonly hookLabelsService: HookLabelsService,
    // [FEAT-20260818-CLONEFULL] เส้น Copy Item อยู่ใน service ของตัวเอง ไม่ปนกับ
    // HooksService ที่ยาว 2,000+ บรรทัด และลบทิ้งได้เป็นก้อน
    private readonly hookClone: HookCloneService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List hooks (OAs) visible to the caller' })
  async getAllHooks(
    @Query() query: HookListQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.getAllHooks(query, user);
  }

  /**
   * [FEAT-20260817-HOOKLABELS] The OA labels only — ~1 KB where `GET /hook` sends
   * 377 KB for the same six rows (one hook document is 105.7 KB, 89 KB of it AI
   * prompt text). Every page that just needs an OA name in a dropdown should ask
   * for this instead. See `hook-labels/hook-labels.service.ts` for the numbers and
   * the rule about not growing the projection.
   *
   * ⚠️ Also declared before `:id`, same reason as /hook/tags below.
   */
  @Get('labels')
  @ApiOperation({
    summary: 'OA labels only (slim list for dropdowns and hovers)',
  })
  async getHookLabels(
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return { data: await this.hookLabelsService.listLabels(user) };
  }

  /**
   * ⚠️ Must be declared before `:id`. Express matched top-down and so does
   * Nest: with `:id` first, a request for `/hook/tags` binds `id = "tags"` and
   * falls through to the detail handler, which answers 400 invalid hook id.
   */
  @Get('tags')
  @ApiOperation({ summary: 'Distinct hook tags, for the list page dropdown' })
  async getHookTags(
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: string[] }> {
    return this.hooksService.getHookTags(user);
  }

  /** ⚠️ Also before `:id`, for the same reason as /hook/tags above. */
  @Get('field-tabs')
  @ApiOperation({ summary: 'Cloneable tabs and their fields, for the modal' })
  getHookFieldTabs(): Record<string, unknown> {
    return this.hooksService.getHookFieldTabs();
  }

  /**
   * ⚠️ Before `:id` as well: `/hook/group/<id>` would otherwise never be
   * reached, because `:id` matches the single segment "group" first.
   */
  @Get('group/:groupId')
  @ApiOperation({ summary: 'List hooks belonging to one group' })
  async getHooksByGroup(
    @Param('groupId') groupId: string,
    @Query() query: HookListQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.getHooksByGroup(groupId, query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Hook detail; secrets returned masked' })
  async getHookById(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.getHookById(id, user);
  }

  /**
   * ⚠️ THE ONE ROUTE IN THIS CONTROLLER THAT CARRIES @RequirePermissions.
   *
   * The file header explains why every other route here deliberately has none:
   * the legacy routes carry no `authorize(...)`, so adding one 403s the very
   * accounts that use those screens. This route is the exception because legacy
   * DOES gate it — `apiRoutes.js:200` reads
   *   router.get("/hook/:id/tag-endpoints", authorize("dynamic_tags.manage"), ...)
   * — so omitting the decorator would be the divergence, not adding it.
   *
   * `dynamic_tags.manage` and not `custom_tools.manage`: the permission belongs
   * to the screen that calls this (the Dynamic Tag form), not to the collection
   * it happens to read. See the service method for why that is safe.
   */
  @Get(':id/tag-endpoints')
  @RequirePermissions('dynamic_tags.manage')
  @ApiOperation({
    summary: 'Selectable endpoint paths for the Dynamic Tag form',
  })
  async getTagEndpoints(
    @Param('id') id: string,
  ): Promise<Record<string, unknown>> {
    // No `user` argument: legacy performs no group scoping on this route, so
    // any caller holding the permission may read any hook's endpoint names.
    return this.hooksService.getTagEndpoints(id);
  }

  @Get(':id/quota')
  @ApiOperation({ summary: 'LINE message quota and consumption (proxied)' })
  async getHookQuota(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.getHookQuota(id, user);
  }

  @Get(':id/insight/followers')
  @ApiOperation({ summary: 'LINE followers insight (proxied)' })
  async getHookFollowers(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.getHookFollowers(id, user);
  }

  @Get(':id/bot-info')
  @ApiOperation({ summary: 'LINE bot picture URL (proxied, token stays here)' })
  async getHookBotInfo(
    @Param('id') id: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ pictureUrl: string | null }> {
    return this.hooksService.getHookBotInfo(id, user);
  }

  // ── write paths ─────────────────────────────────────────────────────────
  // Route ordering is not a concern here the way it is for the GETs above:
  // Nest matches per HTTP method, and none of these share a shape with another
  // route of the same method.

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a hook (OA)' })
  async createHook(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.createHook(body, contextFrom(req, user));
  }

  /**
   * The OA edit screen's Save button. `:id` is the only PUT in this controller,
   * so no static-route ordering question arises for this method.
   *
   * ⚠️ The READ interceptor (500 + Mongoose's own text), not the 400 one used
   * by the content controllers. Legacy's catch here is
   * `res.status(error.statusCode || 500).json({ error: error.message })`, and a
   * schema violation carries no `statusCode` — so a bad enum answers 500 with
   * ``Validation failed: callback_action: `weird` is not a valid enum value…``,
   * verbatim. Without this the global filter rewrites it to "internal error"
   * and the operator loses the only text that says which field is wrong.
   */
  @Put(':id')
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'Update a hook (OA), field-whitelisted' })
  async updateHook(
    @Param('id') id: string,
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.updateHook(id, body, contextFrom(req, user));
  }

  @Patch('status')
  @ApiOperation({ summary: 'Turn one hook on or off' })
  async updateHookStatus(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.updateHookStatus(body, contextFrom(req, user));
  }

  @Patch('status/bulk')
  @ApiOperation({ summary: 'Turn many hooks on or off (all-or-nothing)' })
  async bulkUpdateHookStatus(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookStatus(body, contextFrom(req, user));
  }

  @Patch('settings/bulk')
  @ApiOperation({ summary: 'Bulk-toggle one whitelisted boolean setting' })
  async bulkUpdateHookSetting(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookSetting(
      body,
      contextFrom(req, user),
    );
  }

  /**
   * The per-OA handoff kill switch.
   *
   * `value:false` stops handoff dispatch for every named OA across ALL targets
   * it is bound to; `value:true` restores it. Bindings are flagged, never
   * removed, so the OA's config survives a round trip.
   *
   * NEW — legacy has no counterpart. It is placed next to `settings/bulk`
   * because it deliberately mirrors that contract (all-or-nothing, per-hook
   * group access, audit rows).
   *
   * ⚠️ Writes the flag the runtime gate reads; the gate is not ported yet, so
   * this does not stop dispatch today. See the service method.
   */
  @Patch('handoff/bulk')
  @ApiOperation({ summary: 'Bulk enable/disable handoff dispatch for OAs' })
  async bulkUpdateHookHandoff(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookHandoff(
      body,
      contextFrom(req, user),
    );
  }

  /**
   * [FEAT-20260821-IGNOREABANDON] The per-OA "leave them alone" switch, in bulk.
   *
   * `value:true` stops every named OA from chasing customers who write in
   * without registering; `value:false` restores it. The per-customer column of
   * the same name is separate and is not touched here.
   *
   * NEW — legacy has no counterpart. Placed next to `settings/bulk` because it
   * deliberately mirrors that contract (all-or-nothing, per-hook group access,
   * audit rows) without joining its whitelist — the service header explains
   * why joining it would break golden parity permanently.
   */
  /**
   * [FEAT-20260828-BULKAI] Bulk-set the AI vendor and/or the model.
   *
   * ⚠️ ITS OWN ROUTE, deliberately — `settings/bulk` accepts a boolean value
   *    only, and every method behind it is an on/off flag. Widening that guard
   *    to carry a string would loosen validation for all six existing methods
   *    at once. See the service method for the full reasoning.
   * ⚠️ The two fields are independent: send one, the other, or both. Absent
   *    means "leave it alone"; a body with neither is a 400, not a silent no-op.
   */
  @Patch('ai/bulk')
  @ApiOperation({ summary: 'Bulk-set the AI vendor and/or model for OAs' })
  async bulkUpdateHookAi(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookAi(body, contextFrom(req, user));
  }

  @Patch('abandon/bulk')
  @ApiOperation({ summary: 'Bulk enable/disable the abandon chase for OAs' })
  async bulkUpdateHookAbandon(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookAbandon(
      body,
      contextFrom(req, user),
    );
  }

  /**
   * [FEAT-20260822-NOTICEMODE] The notice settings mode — per-OA write.
   *
   * PUT /hook/notice/:id — three path segments, so it can never be swallowed
   * by `PUT /hook/:id` above (two segments; Express matches per segment
   * count). NEW — legacy has no counterpart. A dedicated route instead of
   * seven `ALLOWED_UPDATES` entries: that list's rejection text is
   * golden-pinned, and the owner's rule for this mode is "แยก path ใหม่
   * ห้ามกระทบของเดิม" (22/08/2026).
   *
   * Body is the raw bag on purpose — the global pipe's implicit conversion
   * would turn the string "false" into `true` BEFORE any DTO validator ran;
   * `notice-settings/notice-settings.fields.ts` does the real `typeof` guard.
   *
   * The same READ interceptor as `PUT :id`: a schema enum violation must
   * answer with Mongoose's own text naming the field, not a generic 500.
   * revert: delete this route and `updateHookNotice`.
   */
  @Put('notice/:id')
  @UseInterceptors(MongooseReadErrorInterceptor)
  @ApiOperation({ summary: 'Update the notice settings of one hook (OA)' })
  async updateHookNotice(
    @Param('id') id: string,
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.updateHookNotice(id, body, contextFrom(req, user));
  }

  /**
   * [FEAT-20260822-NOTICEMODE] The notice settings mode — bulk write.
   *
   * PATCH /hook/notice/bulk — placed beside `abandon/bulk`, whose contract it
   * copies (all-or-nothing, per-hook group access, audit rows) and whose
   * header explains why these switches get dedicated routes. Accepts every
   * notice field, cards included — cards are global documents, and the bulk
   * gate is the same one the per-hook route runs (owner: one rule, no debt).
   * revert: delete this route and `bulkUpdateHookNotice`.
   */
  @Patch('notice/bulk')
  @ApiOperation({ summary: 'Bulk-update notice settings for OAs' })
  async bulkUpdateHookNotice(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookNotice(body, contextFrom(req, user));
  }

  /**
   * [FEAT-20260808-PAYTOOL-P4] The per-OA payment kill switch.
   *
   * `value:false` turns payment off for every named OA; `value:true` turns it
   * on — but ONLY after every target is proven ready (bound to a live tool of
   * category `payment`). A batch with one unready OA is refused whole, via the
   * existing `blocked` 403 contract. The asymmetry is deliberate: see
   * `assertPaymentTargetsReady` in the service for what it prevents.
   *
   * NEW — legacy has no counterpart. Placed next to `handoff/bulk` because it
   * mirrors that contract (all-or-nothing, per-hook group access, audit rows)
   * rather than the field-generic `settings/bulk`, which has nowhere to put the
   * readiness check.
   *
   * Carries no `@RequirePermissions`, matching every other route on this
   * controller: hook access is enforced per hook inside the service by group
   * scoping (`loadBulkTargets`), not at the route.
   * revert: delete this route and the service method it calls.
   */
  @Patch('payment/bulk')
  @ApiOperation({ summary: 'Bulk enable/disable the payment tool for OAs' })
  async bulkUpdateHookPayment(
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.bulkUpdateHookPayment(
      body,
      contextFrom(req, user),
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a hook and evict its cache entry' })
  async deleteHook(
    @Param('id') id: string,
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.deleteHook(id, body ?? {}, contextFrom(req, user));
  }

  /**
   * [FEAT-20260818-CLONEFULL] ปุ่ม Copy Item — สร้าง OA ใหม่จากต้นทาง
   *
   * แยกจาก `POST :id/clone` ด้านล่างคนละเรื่องกัน: อันนั้น "คัดลอกแท็บไปทับ OA ที่มีอยู่"
   * (จึงกัน `channel_secret`/`access_token`/`status` ไว้ใน `NEVER_CLONE` เพราะทับของจริง
   * แล้วปลายทางหยุดรับข้อความ) · อันนี้ "สร้างรายการใหม่" ปลายทางยังไม่มีตัวตนของตัวเอง
   * จึงต้องได้ค่าที่ฟอร์มคัดลอกไม่ได้มาเป็นจุดเริ่ม — ดูเหตุผลเต็มใน hook-clone/clone-merge.ts
   *
   * 201 เท่ากับ `POST /hook` เพราะผลลัพธ์คือรายการใหม่เหมือนกัน (FE ใช้ path เดียวกันต่อ)
   */
  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new hook from an existing one (Copy Item)',
  })
  async duplicateHook(
    @Param('id') id: string,
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hookClone.createFromSource(
      id,
      body ?? {},
      contextFrom(req, user),
    );
  }

  @Post(':id/clone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Copy selected setting tabs onto other hooks' })
  async cloneHookSettings(
    @Param('id') id: string,
    @Body() body: HookBody,
    @Req() req: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.hooksService.cloneHookSettings(
      id,
      body,
      contextFrom(req, user),
    );
  }
}
