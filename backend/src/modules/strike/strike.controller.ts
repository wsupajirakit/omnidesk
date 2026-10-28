import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

// [FEAT-20260827-ADMINBLOCK] cross-module import through the barrel, as the
// layering rule requires. No cycle: audit imports nothing from strike.
import { AuditLogService } from '@/modules/audit';

import {
  PatchStrikeSessionDto,
  StrikeRollupQueryDto,
  SuspendStrikeSessionDto,
} from './dto';
import { StrikeAdminService } from './strike-admin.service';
import {
  auditStrikeClear,
  auditStrikeSuspend,
} from './strike-block-audit.helper';
import {
  STRIKE_GATE,
  type StrikeGate,
  type SuspendedSession,
} from './strike-gate.port';

/** What the header tray reads. Named rather than inline so the shape is one thing. */
export interface SuspendedTrayResponse {
  suspended: SuspendedSession[];
  policy: { suspend_at: number; window_hours: number };
}
import {
  StrikeService,
  type StrikeRollupView,
  type StrikeSessionView,
} from './strike.service';

/**
 * [FEAT-20260824-STRIKESESSION] The module's own routes.
 * ===========================================================================
 * 📖 HANDOVER DOC: `docs/strike-session.md` — read that first; it is the operating
 *    manual (what it is, the API, permissions, how to switch it on and off).
 *    Design + measurements: `docs/strike-count-design.md`.
 *
 * NOTHING ELSE IS TOUCHED TO EXPOSE THIS. No member, room or ticket payload
 * grows a strike field — that would put the cost on every read of those
 * documents, which is the mistake `chat/schemas/member.schema.ts:252-256`
 * already records. A screen that wants both makes two calls.
 *
 * PERMISSIONS — READING AND CLEARING ARE NOT THE SAME PRIVILEGE (owner, 24/08).
 *
 *   read  (`GET`)   → `ticket.manage`, the class-level guard below.
 *   clear (`PATCH`) → `strike.manage`, declared on that handler alone.
 *
 * The split is the point: seeing that a customer has been blocked seven times is
 * information anyone working a case needs, while wiping the count is a decision
 * that should belong to fewer people. Keeping the read on `ticket.manage` also
 * means assist_admin and operator do not lose anything they can do today.
 *
 * ⚠️ A HANDLER-LEVEL `@RequirePermissions` REPLACES THE CLASS-LEVEL ONE, it does
 * not add to it — `PermissionsGuard` reads them with `getAllAndOverride([handler,
 * class])` (`common/guards/permissions.guard.ts:31-34`), and the handler wins.
 * So PATCH requires `strike.manage` and NOT `ticket.manage`. That is intended;
 * `tickets/translate/translate.controller.ts:61` uses the same shape.
 * เมธอดทับคลาส ไม่ได้บวกกัน — PATCH ต้องการ strike.manage อย่างเดียว
 *
 * ⚠️ WHO CAN ACTUALLY CALL PATCH ON DAY ONE — read this before assuming.
 *
 * `PermissionsGuard.OVERRIDE_PERMISSIONS = ['system.manage', '*']`
 * (`common/guards/permissions.guard.ts:26`) is a master key: holding
 * `system.manage` satisfies EVERY `@RequirePermissions`, not just its own. So the
 * question is only ever "does this caller's TOKEN contain `system.manage`".
 *
 * And a token does NOT carry the role's permissions.
 * `AuthService.resolvePermissions` (`modules/auth/auth.service.ts:223-232`):
 *
 *     if (role.name is 'superadmin' | 'superuser') return role.permissions;
 *     return user.permissions;      // <- everybody else: the account's OWN list
 *
 * ⇒ only an account on the **superadmin / superuser role** can clear a session on
 *   day one. A user sitting on the `admin` role CANNOT, even though that role
 *   lists `system.manage`, because their token carries their own permissions and
 *   that string is not in it. Checked against the live database, not assumed:
 *   role `admin` has `system.manage`, user `admin` does not.
 *   (`system.manage` is also inside `UNEDITABLE_PERMISSIONS` in the dashboard's
 *   user form, so it cannot be handed out through the UI either.)
 *
 *   บทบาทถือสิทธิ์ ไม่ได้แปลว่าคนในบทบาทนั้นถือด้วย — token เอาสิทธิ์ส่วนตัวไปเท่านั้น
 *   ⇒ ทางปฏิบัติ: superadmin คือคนที่เปิดทางให้คนอื่น
 *
 * ⚠️ FOR ANY OTHER ROLE THE STRING MUST BE GRANTED, AND THE SEEDER WILL NOT DO IT.
 * `AclSeederService.seedRoles` is create-only — `if (existing) continue;`
 * (`admin/acl-seed/acl-seeder.service.ts:176-179`) — so adding `strike.manage` to
 * `DEFAULT_ROLES` reaches a FRESH database only. On a database that already has
 * its roles, someone ticks it in the dashboard's user/role form, and that form
 * reads a HAND-MAINTAINED list in `omnidesk-console`. See the cross-repo note.
 * เพิ่มที่ seed อย่างเดียวไม่พอ ฐานที่มี role อยู่แล้วต้องติ๊กให้เอง
 *
 * ⚠️ NO PER-OA FILTERING ON THESE ROUTES, and it is stated rather than hidden.
 * A strike session is per customer, not per OA (see the session schema), so
 * there is no hook id to check `allowed_hooks` against. Per-OA visibility, if a
 * screen ever needs it, comes from the events — each carries `hook_id`. Anyone
 * adding an OA-scoped listing must add that filter at that moment.
 *
 * revert: delete this file with the module.
 */
@ApiTags('strikes')
@Controller('api/strikes')
// Reading a customer's strike record is part of working their case.
@RequirePermissions('ticket.manage')
export class StrikeController {
  constructor(
    private readonly strike: StrikeService,
    /* [FEAT-20260826-STRIKESUSPEND] the read side of the suspend feature. A
       second service rather than more methods on the first — see
       `strike-gate.service.ts` for why, and delete both together.
       ⚠️ INJECTED BY TOKEN, NOT BY CLASS. Importing the concrete service here
          pulls it through this module's barrel and back into the controller —
          a cycle Nest reports as "the dependency at index [1] appears to be
          undefined at runtime", which reads like a missing provider and is not.
          The port is also the honest dependency: this controller needs the
          question answered, not that particular answerer.
          ผูกด้วย token ไม่ใช่คลาส — วนกลับแล้วพังแบบที่อ่านไม่ออกว่าเพราะอะไร
       📖 PLAN: `todo/task/26082026/todo10_26082026_strike-suspend.md` */
    @Inject(STRIKE_GATE)
    private readonly gate: StrikeGate,
    /* [FEAT-20260827-ADMINBLOCK] the central trail both admin actions write to.
       LAST parameter on purpose — nothing that constructs this class by hand
       exists (checked: specs read metadata only), but tail-position is the
       cheapest place for the next dependency too. */
    private readonly audit: AuditLogService,
    // [FEAT-20260827-ADMINBLOCK] the block writer — its file header says why
    // it is a separate service (ratchet + its own lifetime).
    private readonly admin: StrikeAdminService,
  ) {}

  private readonly logger = new Logger(StrikeController.name);

  /**
   * The session that is counting right now: how many strikes, at which levels,
   * and when the first and last one landed.
   *
   * `null` is a valid answer and means "this customer has never been blocked" —
   * not an error, and deliberately not a 404, so a panel can render a clean
   * "no strikes" state from one call.
   */
  /**
   * [FEAT-20260826-STRIKESUSPEND] Everyone the bot is currently ignoring.
   *
   * 🔴 DECLARED BEFORE `:lineUserId` AND IT MUST STAY THERE. `suspended` is a
   * single segment, so the param route below would match it first and answer
   * "the open session of the customer whose LINE id is the word suspended" — a
   * 200 full of nulls rather than an error, which is the hardest kind of wrong to
   * notice. Nest matches in declaration order; the e2e pins this.
   * เส้นคำเฉพาะต้องอยู่เหนือเส้น param เสมอ
   *
   * `policy` rides along deliberately: the screen needs the threshold to say
   * "two more and the bot stops", and a dashboard holding its own copy of that
   * number would start lying the moment the env changed, with nothing failing.
   *
   * Reading only — `ticket.manage` from the class guard.
   *
   * revert: delete this handler with the gate service.
   */
  @Get('suspended')
  public async suspended(
    @Query('limit') limit?: string,
  ): Promise<SuspendedTrayResponse> {
    return {
      suspended: await this.gate.listSuspended(Number(limit)),
      policy: this.gate.suspendPolicy(),
    };
  }

  @Get(':lineUserId')
  public async current(
    @Param('lineUserId') lineUserId: string,
  ): Promise<{ current: StrikeSessionView | null }> {
    return { current: await this.strike.currentFor(lineUserId) };
  }

  /** Every session this customer has had, newest first. Closed ones keep their totals. */
  @Get(':lineUserId/sessions')
  public async sessions(
    @Param('lineUserId') lineUserId: string,
    @Query('limit') limit?: string,
  ): Promise<{ sessions: StrikeSessionView[] }> {
    return {
      sessions: await this.strike.sessionsFor(lineUserId, Number(limit)),
    };
  }

  /**
   * [FEAT-20260826-STRIKEROLLUP] The customer's whole record in one call.
   *
   * WHY IT IS NOT CALLED `/total`. `scripts/route-coverage.mjs` decides whether a
   * route is tested by taking the LAST CONCRETE SEGMENT of its path and asking
   * whether that word appears anywhere in the text of `z-test/`
   * (`isCovered`, `testCorpus.includes(seg)`). The word "total" is in 30 test
   * files already, so a route ending in `total` is reported COVERED the moment it
   * is declared — with no test behind it. That is the exact false pass this
   * module's e2e header was written about. "rollup" appears in none, so the gate
   * keeps working. ชื่อเส้นเลือกให้ตัวตรวจทำงานได้ ไม่ได้เลือกให้สวย
   *
   * Reading only — no handler-level `@RequirePermissions`, so the class-level
   * `ticket.manage` applies. Seeing how often a customer has been blocked is part
   * of working their case; clearing it is the privileged half and stays on PATCH.
   *
   * ROUTE ORDER: this sits under `:lineUserId/...` and is safe from being
   * swallowed by `@Get(':lineUserId')` above, which matches one segment only.
   * What WOULD swallow it is a future `@Get(':lineUserId/:something')` declared
   * before this line — pinned by a live HTTP case in the e2e, not by this comment.
   *
   * revert: delete this handler and `dto/strike-rollup-query.dto.ts`.
   */
  @Get(':lineUserId/rollup')
  public async rollup(
    @Param('lineUserId') lineUserId: string,
    @Query() query: StrikeRollupQueryDto,
  ): Promise<StrikeRollupView> {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    // An inverted range is refused rather than answered. Mongo would happily
    // return zero rows for it, and `total: 0` is indistinguishable from "this
    // customer has never been blocked" — a wrong answer with no error attached.
    if (from && to && from > to) {
      throw new BadRequestException('from must not be later than to');
    }

    // The status filter reads `sessions.status`; the ranged path reads events,
    // which carry no status at all. Refusing the pair is the honest answer —
    // accepting it would silently ignore the filter and return a number for a
    // question the caller did not ask. ห้ามรับแล้วเงียบ ๆ ไม่กรอง
    if ((from || to) && query.session_status) {
      throw new BadRequestException(
        'session_status cannot be combined with from/to — that range counts events, which carry no session status',
      );
    }

    return this.strike.rollupFor(lineUserId, {
      from,
      to,
      sessionStatus: query.session_status,
    });
  }

  /** One session's strikes: level and datetime, one row per strike. */
  @Get('sessions/:sessionId/events')
  public async events(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ): Promise<{ events: Record<string, unknown>[] }> {
    return { events: await this.strike.eventsFor(sessionId, Number(limit)) };
  }

  /**
   * Close a session — "เคลียร์ session". Counting restarts at zero on a new
   * session with the next `seq`; the closed one and all of its strikes stay.
   *
   * 409, not 404, when the session exists but is already closed: the request was
   * understood and refused, and telling the two apart is what stops an admin
   * pressing again because they think the id was wrong.
   */
  // Clearing is the privileged half — its own permission, NOT ticket.manage.
  // See the class header for why the handler decorator replaces the class one.
  @RequirePermissions('strike.manage')
  @Patch('sessions/:sessionId')
  public async patch(
    @Param('sessionId') sessionId: string,
    @Body() body: PatchStrikeSessionDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<{ closed: StrikeSessionView }> {
    const closed = await this.strike.closeSession(
      sessionId,
      auth?.userId ?? null,
      body.reason ?? null,
    );

    if (closed) {
      /* [FEAT-20260827-ADMINBLOCK] the release half of the owner's audit ask
         ("ใครกด block ให้ใคร" — and who undid it). Fire-and-forget AFTER the
         close succeeded; a failed row must not un-clear the session. The row
         itself: `strike-block-audit.helper.ts`. */
      auditStrikeClear(
        { session: closed, auth },
        { audit: this.audit, warn: (m) => this.logger.warn(m) },
      );
      return { closed };
    }

    // Distinguish "no such session" from "already closed" with one extra read,
    // on an admin action that happens rarely. Worth it: the two need different
    // reactions from whoever pressed the button.
    const exists = await this.strike.sessionsExists(sessionId);
    if (!exists) throw new NotFoundException('strike session not found');
    throw new ConflictException('strike session is already closed');
  }

  /**
   * [FEAT-20260827-ADMINBLOCK] Block — "Block จำกัดการคุย".
   * 📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`
   *
   * Puts the customer in the SAME state as reaching the strike ceiling: the
   * open session (created here if they never had one) gets `suspended_at`, and
   * from the next event the webhook stays silent for them. Marked as an admin
   * decision by `suspended_by` / `suspended_reason`, which the gate never
   * writes. Released by the existing PATCH above — there is deliberately no
   * separate unblock route (ปลดด้วยเคลียร์เดิม — ประตูเดียว ไม่มีทางลืมปลดครึ่งเดียว).
   *
   * 409 when the latch is already armed — by the gate or by another admin —
   * mirroring the PATCH's "already closed" answer: understood and refused,
   * never silently repeated. A keyed-by-lineUserId POST cannot 404: a customer
   * with no session is exactly who the create-then-stamp path is for.
   *
   * Same privilege as clearing, on the handler alone (the decorator REPLACES
   * the class-level read permission — see the class header).
   *
   * revert: delete this handler, its DTO, `suspendSession`, and the helper.
   */
  @RequirePermissions('strike.manage')
  // 200, not Nest's POST default 201: nothing was "created" from the caller's
  // point of view — a state changed, exactly like the PATCH above answers 200.
  @HttpCode(200)
  @Post(':lineUserId/suspend')
  public async suspend(
    @Param('lineUserId') lineUserId: string,
    @Body() body: SuspendStrikeSessionDto,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<{ suspended: StrikeSessionView }> {
    if (!auth?.userId) {
      // Unreachable behind the auth guard; refusing beats minting a block
      // that no audit row could ever attribute. ห้ามมี block ที่ไม่รู้ว่าใครสั่ง
      throw new BadRequestException('blocking requires an authenticated admin');
    }

    const suspended = await this.admin.suspendSession(
      lineUserId,
      auth.userId,
      body.reason ?? null,
    );

    if (!suspended) {
      throw new ConflictException('customer is already suspended');
    }

    // AFTER the stamp succeeded — see the helper's fire-and-forget note.
    auditStrikeSuspend(
      { session: suspended, auth },
      { audit: this.audit, warn: (m) => this.logger.warn(m) },
    );

    return { suspended };
  }
}
