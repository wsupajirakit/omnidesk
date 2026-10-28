import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model } from 'mongoose';

import { CurrentUser, isSuperUser, type AuthenticatedUser } from '@/common';
// [FEAT-20260808-QCACHE]
import { ScopedQueryCacheService } from '@/infra/query-cache';
/* [FEAT-20260808-AUDITSITE · FIX-20260818-GROUPFIELD] Both of these are leaf-file
   imports rather than the hooks barrel, for the same reason: HooksModule imports
   AuditModule, so the barrel would close the cycle (see audit-log.service.ts).
   The rule is suppressed once for the pair rather than per line — the repo does
   the same at hooks.module.ts:23 and hooks.service.ts:85 for identical reasons.
   eslint-disable-next-line is not enough here because it covers one line only. */
/* eslint-disable no-restricted-imports */
import { Hook, type HookDocument } from '@/modules/hooks/schemas/hook.schema';
import { assertHookInScope } from '@/modules/hooks/oa-access/allowed-hook-ids';
/* eslint-enable no-restricted-imports */

import {
  AuditLogService,
  type CreateAuditLogInput,
  type ListAuditLogsResult,
} from './audit-log.service';
// [FIX-20260819-AUDITRESERVED] the parent the security trail writes under — the
// one value this route must not accept. Imported, never re-spelled: if the
// helper renames it, the refusal follows automatically.
import { SECURITY_AUDIT_PARENT } from './security-events';

/**
 * Audit log endpoints.
 *
 * Mounted at the ROOT, not under `/api` — `/audit/logs`, exactly where legacy
 * puts them (apiRoutes.js:205-207) and where the dashboard has them compiled in.
 * Moving them under `/api` for tidiness would be a silent break.
 *
 * None of the three carries an `authorize(...)` in the legacy router: they sit
 * behind `router.use(requireApiAuth)` and the scoping happens inside the
 * service, keyed off the caller's role and groups. That is why there is no
 * `@RequirePermissions` here — adding one would reject callers legacy admits.
 */
@Controller('audit')
export class AuditLogController {
  constructor(
    private readonly auditLogService: AuditLogService,
    @InjectModel(Hook.name)
    private readonly hookModel: Model<HookDocument>,
    // [FEAT-20260808-QCACHE] shared scope-keyed read cache for the audit LIST.
    // DB-EFFECT: no Mongo write/schema change; Redis read cache only.
    private readonly queryCache: ScopedQueryCacheService,
  ) {}

  /**
   * Legacy passes `req.body` to the service untouched, so validation is the
   * service's job and unknown fields are simply ignored by the schema.
   *
   * There is deliberately no DTO with `forbidNonWhitelisted` here: the global
   * pipe would answer 400 for a field legacy accepts and drops, which is the
   * exact divergence already recorded for `POST /webhook/logs`. The audit
   * payload is written by many callers and is the wrong place to tighten.
   *
   * ==== [FIX-20260818-AUDITACTOR] the one field the body does NOT get to set
   * plan §2.2b M21 · audit_18_aug M21
   *
   * `actor` used to come from the body along with everything else, so any
   * authenticated caller could write a row blaming a colleague. A forged trail
   * is worse than no trail — an empty log is known to be empty, a forged one is
   * read as evidence — so the caller's token now decides, and whatever the body
   * claims is dropped.
   *
   * Only THIS route changes. `createAuditLog` has ~30 internal callers that pass
   * `buildActor(user)`, already derived from `@CurrentUser()`; they are trusted
   * and untouched. This is the only caller reachable from outside.
   *
   * Not `buildActor()` itself: it lives in the hooks module, HooksModule imports
   * AuditModule, and importing it here would close that cycle (same reason the
   * Hook schema above is a leaf import). The three fields are mapped straight
   * from the token instead, and the service still applies its own
   * `username || user_id` fallback, so the stored shape is unchanged.
   *
   * No authenticated caller ⇒ no actor, NOT a 'system' placeholder: the service's
   * existing `actor.user_id is required` then answers 400. Fail closed.
   *
   * revert: pass `body ?? {}` again and delete the `@CurrentUser()` parameter.
   *
   * ==== [FIX-20260819-AUDITRESERVED] the one CATEGORY the body does not get
   *
   * Same shape of defect as the actor above, one field over. This route carries
   * no `@RequirePermissions` on purpose (see the class header), so any
   * authenticated operator can write a row. Since [FIX-20260818-SECAUDIT] the
   * sign-in / account / role / password trail is written under
   * `SECURITY_AUDIT_PARENT`, and the list endpoint filters on exactly that value
   * — so a hand-written POST could plant a sign-in that never happened, and it
   * would be read as evidence.
   *
   * The refusal belongs HERE and not in the service: `recordUserSecurityEvent`
   * calls `createAuditLog` directly with that same parent and is the legitimate
   * writer of those rows. A service-level rule would silence the real trail.
   *
   * Exact-value comparison, not a normalised one: the constant IS the value the
   * security rows carry and the value the list filters on, and Mongo matches it
   * case-sensitively, so a variant spelling reaches neither.
   *
   * Nothing legitimate is refused — every dashboard caller
   * (`services/admin/auditService.ts::createHookAuditLog`, six sites) sends
   * `parent: 'hook'` or `'line_user'`. BE ships alone; no FE change is needed.
   *
   * revert: delete the guard below and its import.
   */
  @Post('logs')
  @HttpCode(201)
  public async createLog(
    @Body() body: CreateAuditLogInput,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<{ data: { _id: unknown; created_at: unknown } }> {
    if (body?.parent === SECURITY_AUDIT_PARENT) {
      throw new ForbiddenException(
        `parent "${SECURITY_AUDIT_PARENT}" is reserved for the security trail and cannot be written through this endpoint`,
      );
    }

    const log = await this.auditLogService.createAuditLog({
      ...(body ?? {}),
      actor: user
        ? {
            user_id: user.userId,
            username: user.username,
            display_name: user.displayName,
          }
        : undefined,
    });
    // `created_at` is applied by the timestamps option, so it is not a declared
    // class property — read it off the plain object rather than the class type.
    const raw = log.toObject() as unknown as Record<string, unknown>;
    return { data: { _id: log._id, created_at: raw['created_at'] } };
  }

  @Get('logs')
  public async listLogs(
    @Query() query: Record<string, string | undefined>,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<ListAuditLogsResult> {
    // Checked before the query runs: a caller who cannot see the hook must not
    // learn its history exists.
    if (query['hook_id']) {
      await this.ensureHookAccess(user, query['hook_id']);
    }

    // [FEAT-20260808-QCACHE] The OA gate above runs LIVE every request and is
    // never cached. The paged list IS cached, keyed by (all query params + this
    // caller's group scope: super → shared ALL bucket, else the sorted group
    // ids). Same scope + same params → shared entry; different scopes never read
    // each other's entry (no cross-tenant leak). TTL=0 ⇒ live query, identical to
    // today. DB-EFFECT: fewer Mongo reads, no Mongo write; ephemeral Redis keys.
    const scope = isSuperUser(user) ? null : (user?.groups ?? []);
    return this.queryCache.wrap(
      {
        endpoint: 'audit',
        scope,
        params: {
          ref_id: query['ref_id'],
          hook_id: query['hook_id'],
          parent: query['parent'],
          page: query['page'],
          limit: query['limit'],
          action: query['action'],
          actor_user_id: query['actor_user_id'],
          from: query['from'],
          to: query['to'],
          sort: query['sort'],
        },
      },
      () =>
        this.auditLogService.listAuditLogs({
          refId: query['ref_id'],
          hookId: query['hook_id'],
          groupIds: Array.isArray(user?.groups) ? user.groups : [],
          // `roleName` is nullable on the token; the service compares it to a
          // literal, so null and undefined behave identically (not super).
          roleName: user?.roleName ?? undefined,
          parent: query['parent'],
          page: query['page'],
          limit: query['limit'],
          action: query['action'],
          actor_user_id: query['actor_user_id'],
          from: query['from'],
          to: query['to'],
          sort: query['sort'],
        }),
    );
  }

  /**
   * ==== [FIX-20260818-GROUPFIELD] OA access check for `?hook_id=`, now shared.
   *
   * This was six hand-written lines with TWO defects, and only one of them was
   * visible. It filtered hooks by `group_id`, a field the Hook schema does not
   * declare (`hook.schema.ts:371` says `group`), so the lookup matched nothing
   * and every non-super caller got 403 on `?hook_id=` — measured live: `admin`
   * and `ticket` both refused, `su` allowed.
   *
   * The second defect is why this is a delegation and not a one-word rename:
   * these lines went straight from `isSuperUser` to the group query, with NO
   * `allowed_hooks` tier. Renaming the field alone would have turned that 403
   * into an OVER-BROAD 200 — an operator provisioned for one OA would have
   * reached every OA in their group, which is exactly the leak
   * `[FIX-20260808-ACLWHITELIST]` was written to close. A visible bug hiding a
   * silent one; fixing only what you can see would have shipped the leak.
   *
   * Now it asks the same three-tier question as every other consumer.
   *
   * ⚠️ LEAF IMPORT, deliberately. `hooks.module.ts` imports AuditModule, so
   * reaching this through the hooks barrel closes the cycle — the same reason
   * the Hook schema above is imported leaf-wise, with the same note.
   *
   * revert: restore the inline `findOne` from git history; the 403 returns with it.
   */
  private async ensureHookAccess(
    user: AuthenticatedUser | undefined,
    hookId: string,
  ): Promise<void> {
    await assertHookInScope(user, this.hookModel, hookId);
  }

  /**
   * ==== [FIX-20260819-AUDITREADSCOPE] the by-id read now carries the caller
   *
   * This handler took `@Param` and nothing else, so the only gate on it was the global
   * JwtAuthGuard: any authenticated operator with a 24-hex ObjectId read any tenant's audit
   * row. The scoping lives in the service, exactly as it does for `listLogs` above and as
   * the controller header describes for this whole file, so all this adds is the identity
   * the service needs — the same two fields the list already forwards.
   *
   * No `@RequirePermissions` here, for the reason in the controller header: legacy admits
   * these callers and adding one would reject them. This narrows WHICH ROWS a caller sees,
   * not WHO may call.
   *
   * `ensureHookAccess` is NOT called here. The list only reaches for it when the caller
   * names a `hook_id`, and an audit row is scoped by `group_id`, not by OA — asking the OA
   * question of a row that may carry no hook at all would be a different, stricter model
   * than the list's, which is not what was approved.
   *
   * revert: delete the `@CurrentUser()` parameter and pass `auditLogId` alone.
   */
  @Get('logs/:auditLogId')
  public async getLog(
    @Param('auditLogId') auditLogId: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<{ data: unknown }> {
    return {
      data: await this.auditLogService.getAuditLogById(auditLogId, {
        groupIds: Array.isArray(user?.groups) ? user.groups : [],
        // Nullable on the token; the service compares it to a literal, so null and
        // undefined behave identically (not super) — same note as `listLogs`.
        roleName: user?.roleName ?? undefined,
      }),
    };
  }
}
