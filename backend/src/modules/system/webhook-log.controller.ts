import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  MongooseErrorInterceptor,
  isSuperUser,
  type AuthenticatedUser,
} from '@/common';
// [FEAT-20260808-QCACHE]
import { ScopedQueryCacheService } from '@/infra/query-cache';

import { WebhookLogPayloadDto } from './dto';
import { OaAccessService } from './oa-access.service';
import { WebhookLogService } from './webhook-log.service';
import { WebhookStatsService } from './webhook-stats.service';

/**
 * Root-mounted (`/webhook/logs`, `/stats`), matching the legacy paths the
 * dashboard has compiled in.
 *
 * As with the config routes, legacy attached no `authorize(...)` here: the
 * permission check for the list endpoint lives in the handler and depends on
 * the *query* (`broadcast.manage` for broadcast logs, `webhook_log.manage`
 * otherwise), which a route decorator cannot express. Authentication itself is
 * still required, via the global guard.
 */
@ApiTags('system')
@Controller()
export class WebhookLogController {
  constructor(
    private readonly logService: WebhookLogService,
    private readonly statsService: WebhookStatsService,
    private readonly oaAccess: OaAccessService,
    // [FEAT-20260808-QCACHE] shared scope-keyed read cache for the log LIST only.
    // DB-EFFECT: no Mongo write/schema change; Redis read cache only.
    private readonly queryCache: ScopedQueryCacheService,
  ) {}

  /** Same override rules as the legacy helper: `system.manage` and `*` win. */
  private hasPermission(
    user: AuthenticatedUser | undefined,
    permission: string,
  ): boolean {
    const perms = user?.permissions ?? [];
    return (
      perms.includes(permission) ||
      perms.includes('system.manage') ||
      perms.includes('*')
    );
  }

  /**
   * [FIX-20260808-WLOGIDOR] H-S5 — the by-id get/update/delete handlers loaded a
   * log by `_id` alone, with NO tenant scope and NO permission check (unlike the
   * list path), so any authenticated user could read/tamper/delete another
   * tenant's webhook log (whose payload/response summaries carry customer data).
   * This applies the SAME two gates the list uses: the log must belong to a hook
   * the caller can access, and the caller must hold the matching permission
   * (broadcast send-logs → broadcast.manage, everything else → webhook_log.manage).
   */
  private async ensureLogAccess(
    user: AuthenticatedUser | undefined,
    log: Record<string, unknown> | null | undefined,
  ): Promise<void> {
    const hookId = log?.['hook_id'];
    if (hookId) {
      await this.oaAccess.ensureHookAccess(user, String(hookId));
    }
    const isBroadcastLog =
      log?.['channel'] === 'line_api' &&
      log?.['action_type'] === 'send_broadcast';
    const required = isBroadcastLog ? 'broadcast.manage' : 'webhook_log.manage';
    if (!this.hasPermission(user, required)) {
      throw new ForbiddenException('insufficient permissions');
    }
  }

  // `action_type` is required by the schema and nowhere else, so an empty body
  // is rejected by `save()`. Legacy's `respondError` answers `err.status || 400`
  // with the raw message; without this the same error would be a 500.
  @Post('webhook/logs')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(MongooseErrorInterceptor)
  @ApiOperation({ summary: 'Record a webhook log entry' })
  async createLog(
    @Body() dto: WebhookLogPayloadDto,
  ): Promise<{ data: { _id: unknown; created_at: unknown } }> {
    const log = await this.logService.createLog(dto);
    // Only these two fields come back — the stored document can be large.
    return { data: { _id: log['_id'], created_at: log['created_at'] } };
  }

  @Get('webhook/logs')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List webhook logs' })
  async listLogs(
    @Query('hook_id') hookId?: string,
    @Query('hook_alias') hookAlias?: string,
    @Query('channel') channel?: string,
    @Query('action_type') actionType?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
    @Query('meta_key') metaKey?: string,
    @Query('meta_value') metaValue?: string,
    /* [FEAT-20260828-LOGSEARCH] ค้นชื่อ OA หรือ id ของ job — กติกาและขั้นต่ำ
       4 ตัวอักษรอยู่ใน `webhook-log.service.ts` ที่เดียว ตรงนี้แค่ส่งต่อ */
    @Query('search') search?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (hookId) {
      await this.oaAccess.ensureHookAccess(user, hookId);
    }

    // Broadcast send-logs are shown on the broadcast screen, whose operators
    // hold `broadcast.manage` rather than `webhook_log.manage`.
    const isBroadcastLog =
      channel === 'line_api' && actionType === 'send_broadcast';
    const required = isBroadcastLog ? 'broadcast.manage' : 'webhook_log.manage';
    if (!this.hasPermission(user, required)) {
      throw new ForbiddenException('insufficient permissions');
    }

    // [FEAT-20260808-QCACHE] The OA/permission gates above run LIVE every request
    // and are never cached. The paged list result IS cached, keyed by (all query
    // params + this caller's group scope): super → shared ALL bucket, otherwise
    // the sorted group ids. Two admins with the same scope + same filters share
    // one entry; different scopes get different entries (no cross-tenant leak).
    // TTL=0 ⇒ live query, identical to today. DB-EFFECT: fewer Mongo reads, no
    // Mongo write; ephemeral Redis keys only.
    const scope = isSuperUser(user) ? null : (user?.groups ?? []);
    return this.queryCache.wrap(
      {
        endpoint: 'webhooklog',
        scope,
        params: {
          hook_id: hookId,
          hook_alias: hookAlias,
          channel,
          action_type: actionType,
          status,
          from,
          to,
          page,
          limit,
          sort,
          meta_key: metaKey,
          meta_value: metaValue,
          /* ⚠️ ต้องอยู่ในคีย์ของแคชด้วย ไม่งั้นผลของคำค้นหนึ่งจะถูกเสิร์ฟให้อีกคำค้น */
          search,
        },
      },
      () =>
        this.logService.listLogs({
          hook_id: hookId,
          hook_alias: hookAlias,
          groupIds: user?.groups ?? [],
          roleName: user?.roleName,
          channel,
          action_type: actionType,
          status,
          from,
          to,
          page,
          limit,
          sort,
          meta_key: metaKey,
          meta_value: metaValue,
          search,
        }),
    );
  }

  /**
   * Dashboard chart data. Legacy checks OA access but — unlike the list above —
   * no permission at all beyond being authenticated; the group scoping inside
   * the service is what limits what a caller sees.
   */
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Per-day success/failure counts' })
  async getStats(
    @Query('hook_id') hookId?: string,
    @Query('hook_alias') hookAlias?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    if (hookId) {
      await this.oaAccess.ensureHookAccess(user, hookId);
    }
    return this.statsService.getStatusCountsByType({
      hook_id: hookId,
      hook_alias: hookAlias,
      groupIds: user?.groups ?? [],
      roleName: user?.roleName,
      from,
      to,
    });
  }

  @Get('webhook/logs/:logId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get one webhook log' })
  async getLog(
    @Param('logId') logId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    const log = await this.logService.getLogById(logId);
    await this.ensureLogAccess(user, log);
    return { data: log };
  }

  @Put('webhook/logs/:logId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update a webhook log' })
  async updateLog(
    @Param('logId') logId: string,
    @Body() dto: WebhookLogPayloadDto,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    // Scope on the EXISTING row before mutating it (H-S5).
    const existing = await this.logService.getLogById(logId);
    await this.ensureLogAccess(user, existing);
    return { data: await this.logService.updateLog(logId, dto) };
  }

  @Delete('webhook/logs/:logId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a webhook log' })
  async deleteLog(
    @Param('logId') logId: string,
    @CurrentUser() user?: AuthenticatedUser,
  ): Promise<{ data: Record<string, unknown> }> {
    const existing = await this.logService.getLogById(logId);
    await this.ensureLogAccess(user, existing);
    return { data: await this.logService.deleteLog(logId) };
  }
}
