/**
 * The five POST routes that fire outbound on behalf of an OA.
 *
 * Routing source: legacy-api/src/routes/apiRoutes.js:191, 201-203 and 507.
 * Handler source and the reasoning behind every status code and message live in
 * hook-outbound.service.ts — read that header first.
 *
 * ⚠️ ROUTE ORDER. Nest matches top-down like Express, and `compare-external-api`
 * is a single segment under `/hook`, exactly the shape `:id` would bind. There
 * is no `POST /hook/:id` today, so nothing shadows it — but it is declared
 * first anyway so a later `POST /hook/:id` cannot silently swallow it.
 *
 * ⚠️ These controllers deliberately live in the external module rather than
 * beside HooksController. See the service header: the alternative closes a
 * module cycle this repo has already been bitten by.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import {
  HookOutboundService,
  type OutboundBody,
} from './hook-outbound.service';

@ApiTags('hooks')
@Controller('hook')
/**
 * Bound for `POST /hook/:id/push` alone: legacy answers `{ message }` rather
 * than the service-wide `{ error }` envelope when that route's hook id resolves
 * to nothing, while the two external-api routes on the same controller answer
 * `{ error: 'Hook not found' }`. The filter keys off the exception class, so
 * the two shapes coexist — see hook-not-found.exception.ts.
 */
export class HookOutboundController {
  constructor(private readonly outbound: HookOutboundService) {}

  /** ⚠️ Declared before the `:id/...` routes — see the file header. */
  @Post('compare-external-api')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Compare two external API payload structures' })
  async compareExternalApi(
    @Body() body: OutboundBody,
  ): Promise<Record<string, unknown>> {
    return this.outbound.compareExternalApi(body ?? {});
  }

  /* [FIX-20260820-KILLDEADPUSH] `POST /hook/:id/push` was REMOVED here.
     It read its token from `hook.line_key`, which no hook carries — 0 of 10 on
     live data — so every request that got past the guards ended at
     `400 Line access token is required`. It had no caller either: the dashboard
     never referenced it, nothing in this backend called it, and the legacy
     system it was lifted from had no caller and no frontend of its own. Its own
     audit rows prove it: of 129 `push_message` log rows, 129 were written by the
     chat console and the admin-image path — not one by this route, because it
     could never reach the send.
     ประตูที่ยิงไม่ออกและไม่มีใครเรียก · ลบทิ้งคือลดหนี้ ไม่ใช่ลดฟีเจอร์.

     Last savepoint that still contains it: tag `savepoint-20082026-2200`
     (BE 5e0bb4e). To bring it back: `git show savepoint-20082026-2200 --
     src/modules/external/hook-outbound.{controller,service}.ts` — and fix the
     token rule to `access_token ?? line_key` first, or it returns dead. */

  @Post(':id/test-external-api')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probe the external API login this OA is wired to' })
  async testExternalApi(
    @Param('id') id: string,
    @Body() body: OutboundBody,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.outbound.testExternalApi(id, body ?? {}, user);
  }

  @Post(':id/execute-external-endpoint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run one external endpoint and return its payload' })
  async executeExternalEndpoint(
    @Param('id') id: string,
    @Body() body: OutboundBody,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    return this.outbound.executeExternalEndpoint(id, body ?? {}, user);
  }
}

/**
 * `POST /api/custom-tools/:id/test`.
 *
 * Separate from CustomToolsController (hooks module) only because the work is
 * done by CustomToolService, which lives here. The permission is the same one
 * legacy applies to every route in that group (apiRoutes.js:507), spelled out
 * again because a class-level decorator on the other controller does not reach
 * this one.
 *
 * ⚠️ No collision with CustomToolsController: `test-draft` is one segment and
 * this is two, and neither shares a method+shape with a route declared there.
 */
@ApiTags('custom-tools')
@Controller('api/custom-tools')
@RequirePermissions('custom_tools.manage')
export class CustomToolTestController {
  constructor(private readonly outbound: HookOutboundService) {}

  /**
   * ⚠️ DECLARED BEFORE `:id/test`, and that order is load-bearing.
   *
   * Nest matches top-down like Express. `test-draft` is one segment and
   * `:id/test` is two, so they cannot collide on shape — but declaring literal
   * segments ahead of parameterised ones is the rule that keeps this file safe
   * as routes are added, and the class comment above already states it.
   */
  @Post('test-draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test an unsaved custom tool draft' })
  async testDraftCustomTool(
    @Body() body: OutboundBody,
  ): Promise<Record<string, unknown>> {
    return this.outbound.testDraftCustomTool(body ?? {});
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run a saved custom tool against its destination' })
  async testCustomTool(
    @Param('id') id: string,
    @Body() body: OutboundBody,
  ): Promise<Record<string, unknown>> {
    return this.outbound.testCustomTool(id, body ?? {});
  }
}
