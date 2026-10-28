/**
 * Customer-Link HTTP layer — mounted at `/customer-link`, matching
 * `src/index.js:123` in the legacy backend (`app.use("/customer-link", ...)`).
 *
 * ── WHICH ROUTES ARE PUBLIC, AND WHY ──────────────────────────────────────
 * Four of the seven are PUBLIC on purpose. The caller is an end customer inside
 * the messaging app's in-app browser, on a different domain, with no dashboard
 * credential — putting the JWT guard on them would stop every customer linking
 * an account. What stands in for auth on each:
 *
 *   GET  /health              public   — config shape only, no secret, no call
 *   GET  /profile             public   — proof is the encrypted `t` token
 *   POST /match               public   — proof is the encrypted `link_token`
 *   POST /admin/edit          public   — proof is the token AND its `mode`
 *   POST /admin/token         JWT + ticket.manage
 *   POST /admin/unlink        JWT + ticket.manage
 *   GET  /admin/capabilities  JWT + ticket.manage
 *
 * `/admin/edit` is the subtle one: it is an admin action submitted from the
 * landing page, which holds no dashboard JWT. Its entire authorisation is the
 * token — unforgeable (AES-256-GCM with the service key), short-lived (15 min),
 * and carrying a `mode` claim. A customer's own token has no `mode` and is
 * rejected 403. It is rate-limited like `/match` because it is equally a public
 * write. Removing any part of that check removes the whole boundary.
 *
 * ── WHY `@Res()` ON EVERY HANDLER ─────────────────────────────────────────
 * These endpoints do NOT use this service's `{ error }` envelope. Legacy
 * answers `{ success, data }` / `{ success, error: { code, message } }` with a
 * per-case status, and the landing page branches on `error.code`. Writing the
 * response directly is what keeps AllExceptionsFilter from reshaping it.
 *
 * ── WHY THE DTOs ARE LOOSE ────────────────────────────────────────────────
 * Legacy validates inside each handler and answers with its own coded envelope.
 * A class-validator DTO would answer first, with a different one. Bodies are
 * therefore taken as plain objects and validated in the service, exactly as
 * `src/modules/hooks/dto/create-group.dto.ts` documents.
 */
import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { isValidObjectId } from 'mongoose';

import {
  CurrentUser,
  Public,
  RequirePermissions,
  type AuthenticatedUser,
} from '@/common';

import {
  ADMIN_TOKEN_TTL_MS,
  NOT_ADMIN_TOKEN,
  type LinkResult,
} from './customer-link.constants';
import {
  CustomerLinkRateLimit,
  CustomerLinkRateLimitGuard,
} from './customer-link-rate-limit.guard';
import { CustomerLinkService } from './customer-link.service';

@ApiTags('customer-link')
@Controller('customer-link')
@UseGuards(CustomerLinkRateLimitGuard)
export class CustomerLinkController {
  constructor(private readonly service: CustomerLinkService) {}

  /**
   * Serialises a handler result exactly as legacy's `send()` does: 200 with
   * `{success:true,data}`, otherwise the carried status (anything below 400
   * becomes 502) with `{success:false,error}`.
   */
  private send(res: Response, result: LinkResult): void {
    if (result.ok) {
      res.status(200).json({ success: true, data: result.data });
      return;
    }
    const status = result.status && result.status >= 400 ? result.status : 502;
    res.status(status).json({ success: false, error: result.error });
  }

  // ── GET /customer-link/health ────────────────────────────────────────────
  /**
   * Liveness plus which target is configured. No rate limit in legacy.
   *
   * [FIX-20260818-ALIASORACLE] audit_18_aug H6 — `?alias=` is gone. It resolved
   * an OA BY NAME for an unauthenticated caller, and this is the one route in
   * the file without `@CustomerLinkRateLimit`, on a prefix the proxy gate
   * exempts, so the customer list could be enumerated with a shell loop. With no
   * token the answer is now liveness only; the configured target still comes
   * back for anyone holding a minted `?t=`.
   */
  @Public()
  @Get('health')
  public async health(
    @Res() res: Response,
    @Query('t') t?: string,
  ): Promise<void> {
    const resolved = await this.service.resolveHook({ linkToken: t });
    const rejected = this.service.tokenRejection(resolved);
    if (rejected) return this.send(res, rejected);
    res.status(200).json({
      success: true,
      data: await this.service.describe(resolved.hook ?? null),
    });
  }

  // ── GET /customer-link/profile ───────────────────────────────────────────
  /**
   * The channel id comes from the token when one is present; the query
   * parameter is only a dev/testing fallback.
   */
  @Public()
  @CustomerLinkRateLimit({ windowMs: 60_000, max: 30, label: 'profile' })
  @Get('profile')
  public async profile(
    @Res() res: Response,
    @Query() query: Record<string, string | undefined>,
  ): Promise<void> {
    // [FIX-20260818-ALIASORACLE] see `health` — the alias fallback is removed
    // from every public route, not only the one the audit named.
    const resolved = await this.service.resolveHook({
      linkToken: query['t'],
    });
    const rejected = this.service.tokenRejection(resolved);
    if (rejected) return this.send(res, rejected);

    const notReady = this.service.notReadyRejection(resolved.hook ?? null);
    if (notReady) return this.send(res, notReady);

    const channelUserId =
      resolved.channelUserId ||
      query['channel_user_id'] ||
      query['line_user_id'];

    this.send(
      res,
      await this.service.lookup(
        { channel_user_id: channelUserId, web_code: query['web_code'] },
        { hook: resolved.hook ?? null, channelType: resolved.channelType },
      ),
    );
  }

  // ── POST /customer-link/match ────────────────────────────────────────────
  /**
   * The landing form carries `link_token` through from the `?t=` it was opened
   * with. Any `channel_user_id`/`line_user_id` in the body is ignored whenever
   * the token supplied one — same rule as `web_code`, where the hook wins.
   */
  @Public()
  @CustomerLinkRateLimit({ windowMs: 60_000, max: 10, label: 'match' })
  @Post('match')
  public async match(
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const b = body || {};
    // [FIX-20260818-ALIASORACLE] see `health`.
    const resolved = await this.service.resolveHook({
      linkToken: b['link_token'],
    });
    const rejected = this.service.tokenRejection(resolved);
    if (rejected) return this.send(res, rejected);

    const notReady = this.service.notReadyRejection(resolved.hook ?? null);
    if (notReady) return this.send(res, notReady);

    const channelUserId =
      resolved.channelUserId ||
      (b['channel_user_id'] as string) ||
      (b['line_user_id'] as string);

    // Already-linked guard: saves a round trip on every repeated tap, gives the
    // customer a sentence written for humans, and stops a re-submit with someone
    // else's details from overwriting an existing link (some vendors answer 200
    // and silently overwrite, which is worse than an error).
    if (channelUserId && (await this.service.alreadyLinked(channelUserId))) {
      return this.send(res, {
        ok: false,
        status: 409,
        error: {
          code: 'CUSTOMER_LINK_ALREADY_LINKED',
          message:
            'ผู้ใช้งานได้ยืนยันตัวตนแล้ว หากต้องการแก้ไขข้อมูลกรุณาติดต่อ admin',
        },
      });
    }

    this.send(
      res,
      await this.service.match(
        {
          channel_user_id: channelUserId,
          web_code: b['web_code'],
          phone_number: b['phone_number'],
          first_name: b['first_name'],
          account_number: b['account_number'],
        },
        { hook: resolved.hook ?? null, channelType: resolved.channelType },
      ),
    );
  }

  // ── POST /customer-link/admin/token ──────────────────────────────────────
  /**
   * Returns the landing URL carrying a token that names the mode and the admin
   * who pressed the button. No landing URL configured → say where to set it,
   * rather than failing silently.
   */
  @RequirePermissions('ticket.manage')
  @Post('admin/token')
  public async adminToken(
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<void> {
    const b = body || {};
    const hookId = b['hook_id'];
    /* cast ตรงจุดประกาศแบบเดียวกับ handler อื่นในไฟล์นี้ (`:169`) แทนที่จะ
       String(...) ตอนใช้ — eslint no-base-to-string จับ `unknown` ที่จุดใช้ */
    const channelUserId = (b['channel_user_id'] as string) || '';
    const wanted = b['mode'] === 'register' ? 'register' : 'edit';

    if (!isValidObjectId(hookId) || !channelUserId) {
      return this.send(res, {
        ok: false,
        status: 400,
        error: {
          code: 'CUSTOMER_LINK_INVALID_QUERY',
          message: 'ต้องระบุ hook_id และ channel_user_id',
        },
      });
    }

    const hook = await this.service.findHookById(hookId);
    if (!hook) {
      return this.send(res, {
        ok: false,
        status: 404,
        error: {
          code: 'CUSTOMER_LINK_HOOK_NOT_FOUND',
          message: 'ไม่พบ OA นี้',
        },
      });
    }

    /**
     * [FIX-20260818-LINKSCOPE · plan §8 = T3-3, closes audit C2.3] `hook_id` came
     * from the request BODY, and the token minted below lets its holder register
     * or edit that customer's identity with the OA's upstream. Naming another
     * OA's hook was therefore a way to take over its customers' profiles.
     *
     * Placed after the hook exists (so a bad id still reports 404, unchanged) and
     * BEFORE anything is minted or sent.
     */
    if (!(await this.service.adminMayUseHook(auth, hookId))) {
      return this.send(res, {
        ok: false,
        status: 403,
        error: {
          code: 'CUSTOMER_LINK_FORBIDDEN_HOOK',
          message: 'ไม่มีสิทธิ์ใช้ OA นี้',
        },
      });
    }

    // Same gate the customer meets — an unfinished OA cannot be worked around
    // by going through the landing page either.
    const notReady = this.service.notReadyRejection(hook);
    if (notReady) return this.send(res, notReady);

    /* [FEAT-20260814-MINTBLOCKLINKED] Owner order 2026-08-14: pressing
       "ลงทะเบียนให้ลูกค้า" for a member who already has a linked profile must not
       mint a token. Refuse here and tell the customer over LINE instead of
       sending them through a form the upstream would reject at the end.

       ⚠️ REGISTER ONLY. `mode: 'edit'` is the path FOR linked members — gating it
          here would break the edit button for every customer with an account.
          That is why this sits behind `wanted === 'register'` and nothing else.
       ⚠️ Placed AFTER `notReadyRejection` so an unconfigured OA still reports its
          own problem first, and BEFORE the landing-url check because the answer
          does not depend on that URL — a linked customer gets the same reply
          whether or not the OA finished its setup.

       The notice is best-effort and cannot fail this response; the admin sees the
       409 either way. revert: delete this block + the two service methods. */
    if (wanted === 'register') {
      const { linked } = await this.service.findLinkedMember(channelUserId);
      if (linked) {
        void this.service.notifyAlreadyRegistered(hook, channelUserId);
        return this.send(res, {
          ok: false,
          status: 409,
          error: {
            code: 'CUSTOMER_LINK_ALREADY_REGISTERED',
            message: 'ลูกค้าได้ทำการลงทะเบียนไว้ในระบบเรียบร้อยแล้วนะคะ :)',
          },
        });
      }
    }

    const landing = String(
      (hook['customer_link_landing_url'] as string) || '',
    ).trim();
    if (!landing) {
      return this.send(res, {
        ok: false,
        status: 409,
        error: {
          code: 'CUSTOMER_LINK_NO_LANDING_URL',
          message:
            'OA นี้ยังไม่ได้ตั้งค่า URL หน้าลงทะเบียน — ตั้งได้ที่หน้าจัดการ OA',
        },
      });
    }

    const token = this.service.mintLinkToken({
      hookId: hook['_id'],
      channelUserId,
      channelType: hook['channel_type'] as string,
      mode: wanted,
      adminUserId: auth?.userId || null,
    });

    this.send(res, {
      ok: true,
      data: {
        url: `${landing.replace(/\/+$/, '')}/?t=${encodeURIComponent(token)}&mode=${wanted}`,
        mode: wanted,
        expires_in_ms: ADMIN_TOKEN_TTL_MS,
      },
    });
  }

  // ── POST /customer-link/admin/edit ───────────────────────────────────────
  /**
   * PUBLIC — see the file header. The token is the entire proof of authority:
   * unforgeable, 15-minute lifetime, and carrying a `mode`. A customer's token
   * has no `mode` and is refused 403 before anything else happens.
   */
  @Public()
  @CustomerLinkRateLimit({ windowMs: 60_000, max: 10, label: 'admin/edit' })
  @Post('admin/edit')
  public async adminEdit(
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
  ): Promise<void> {
    const b = body || {};
    const resolved = await this.service.resolveHook({
      linkToken: b['link_token'],
    });
    const rejected = this.service.tokenRejection(resolved);
    if (rejected) return this.send(res, rejected);
    if (!resolved.mode) return this.send(res, NOT_ADMIN_TOKEN);

    const notReady = this.service.notReadyRejection(resolved.hook ?? null);
    if (notReady) return this.send(res, notReady);

    const channelUserId = resolved.channelUserId;
    if (!channelUserId) {
      return this.send(res, {
        ok: false,
        status: 400,
        error: {
          code: 'CUSTOMER_LINK_INVALID_LINK_TOKEN',
          message: 'ลิงก์ไม่ระบุผู้ใช้ปลายทาง',
        },
      });
    }

    const payload = {
      channel_user_id: channelUserId,
      phone_number: b['phone_number'],
      first_name: b['first_name'],
      account_number: b['account_number'],
    };
    const ctx = {
      hook: resolved.hook ?? null,
      channelType: resolved.channelType,
      adminUserId: resolved.adminUserId,
    };

    // register = link as if the customer had done it (same op as /match);
    // edit = move the link to whoever just verified.
    const result =
      resolved.mode === 'register'
        ? await this.service.match(payload, ctx)
        : await this.service.edit(payload, ctx);

    if (result?.ok) {
      await this.service.refreshStoredProfile(
        channelUserId,
        resolved.hook ?? null,
      );
      // register goes through match(), which already emits action=linked —
      // emitting again here would double the event for no benefit.
      if (resolved.mode !== 'register') {
        void this.service.publishProfileEvent(
          (resolved.hook as Record<string, unknown> | null)?.['_id'],
          channelUserId,
          'updated',
          false,
        );
      }
    }

    this.send(res, result);
  }

  // ── POST /customer-link/admin/unlink ─────────────────────────────────────
  /**
   * Unlink upstream, then clear the stored profile — clearing even when the
   * upstream says NOT_LINKED, because the goal is that our side ends clean.
   */
  @RequirePermissions('ticket.manage')
  @Post('admin/unlink')
  public async adminUnlink(
    @Res() res: Response,
    @Body() body: Record<string, unknown>,
    @CurrentUser() auth?: AuthenticatedUser,
  ): Promise<void> {
    const b = body || {};
    const hookId = b['hook_id'];
    const channelUserId = b['channel_user_id'] as string;
    const phoneNumber = b['phone_number'];

    if (!isValidObjectId(hookId) || !channelUserId || !phoneNumber) {
      return this.send(res, {
        ok: false,
        status: 400,
        error: {
          code: 'CUSTOMER_LINK_INVALID_QUERY',
          message: 'ต้องระบุ hook_id, channel_user_id และ phone_number',
        },
      });
    }

    const hook = await this.service.findHookById(hookId);
    if (!hook) {
      return this.send(res, {
        ok: false,
        status: 404,
        error: {
          code: 'CUSTOMER_LINK_HOOK_NOT_FOUND',
          message: 'ไม่พบ OA นี้',
        },
      });
    }

    const result = await this.service.adminUnlinkUpstream(
      { channel_user_id: channelUserId, phone_number: phoneNumber },
      {
        hook,
        channelType: hook['channel_type'] as string,
        adminUserId: auth?.userId || null,
      },
    );

    // NOT_LINKED upstream = only our side is stale; still clear it.
    const upstreamSaysNotLinked = result?.error?.code === 'NOT_LINKED';
    if (result?.ok || upstreamSaysNotLinked) {
      await this.service.clearStoredProfile(channelUserId);
      // cleared:true tells the FE to drop the card rather than re-fetch a value
      // already known to be empty. Fired after the clear, to avoid the race.
      void this.service.publishProfileEvent(
        hook['_id'],
        channelUserId,
        'cleared',
        true,
      );

      return this.send(res, {
        ok: true,
        data: {
          unlinked: true,
          upstream_ok: !!result?.ok,
          cleared_local: true,
          note: upstreamSaysNotLinked
            ? 'ปลายทางแจ้งว่าไม่ได้ผูกอยู่แล้ว — ล้างข้อมูลฝั่งเราเรียบร้อย'
            : undefined,
        },
      });
    }
    this.send(res, result);
  }

  // ── GET /customer-link/admin/capabilities ────────────────────────────────
  /**
   * Read-only: which of profile/link/edit/unlink this OA's tool actually has,
   * so the Ticket page can hide buttons that would 404 at the vendor. Returns
   * booleans only — no url, no path, no secret.
   */
  @RequirePermissions('ticket.manage')
  @Get('admin/capabilities')
  public async adminCapabilities(
    @Res() res: Response,
    @Query('hook_id') hookId?: string,
  ): Promise<void> {
    if (!isValidObjectId(hookId)) {
      return this.send(res, {
        ok: false,
        status: 400,
        error: {
          code: 'CUSTOMER_LINK_INVALID_QUERY',
          message: 'ต้องระบุ hook_id',
        },
      });
    }

    const hook = await this.service.findHookById(hookId);
    if (!hook) {
      return this.send(res, {
        ok: false,
        status: 404,
        error: {
          code: 'CUSTOMER_LINK_HOOK_NOT_FOUND',
          message: 'ไม่พบ OA นี้',
        },
      });
    }

    this.send(res, {
      ok: true,
      status: 200,
      data: await this.service.capabilities(hook),
    });
  }
}
