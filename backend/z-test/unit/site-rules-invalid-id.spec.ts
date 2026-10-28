import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { ChatRoom, Member, MembersService } from '@/modules/chat';
import { AuditLogService } from '@/modules/audit';
import { CustomerProviderService } from '@/modules/customer-provider';
import { CustomToolService } from '@/modules/external';
import { Hook } from '@/modules/hooks';

/**
 * `hooks/:hookId/site-rules` — a malformed `hookId` is **200 with a soft
 * failure envelope** on GET, but **400** on the refresh POST. Same input, same
 * resolver, two different contracts, and both are legacy's.
 *
 * ── the behaviour being pinned ─────────────────────────────────────────────
 * Legacy's `resolveSiteRulesTarget`
 * (legacy-api/src/controllers/chat/memberController.js:309-323) returns
 * `{ error: "Invalid hook_id", status: 400 }`. What the two callers do with
 * that `status` is where they part ways:
 *
 *   GET  memberController.js:373-379 — IGNORES the status and answers
 *        `res.json({ success: true, data: null, reason })`, i.e. 200. The
 *        comment there explains it: the site-rules card is optional UI and the
 *        panel decides whether to draw it by checking `data === null`, so a
 *        4xx would raise an error banner for a card that is merely absent.
 *
 *   POST memberController.js:419-422 — HONOURS it:
 *        `res.status(t.status || 400).json({ success: false, error })`.
 *        Refresh is an explicit operator action on a button, so a bad id is a
 *        real failure worth surfacing.
 *
 * Measured against the running legacy backend:
 *
 *   GET  /api/hooks/notanid/site-rules
 *   200 {"success":true,"data":null,"reason":"Invalid hook_id","domain_name":null}
 *   POST /api/hooks/notanid/site-rules/refresh
 *   400 {"success":false,"error":"Invalid hook_id"}
 *
 * Before the fix the GET threw `BadRequestException` and answered 400 — the
 * only route in this sweep where our service was STRICTER than legacy rather
 * than looser.
 *
 * ⚠️ Do not "simplify" by making refresh delegate its guard to the getter (it
 * used to, which is how the GET's 400 leaked in) or by giving both the same
 * envelope. Each assertion below fails on exactly that mistake.
 */
describe('MembersService — site-rules invalid hook id', () => {
  let service: MembersService;

  /** Never reached: every case below is rejected before any query runs. */
  const unusedModel = {
    findById: () => {
      throw new Error('must not query for a malformed hook id');
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: getModelToken(Member.name), useValue: {} },
        { provide: getModelToken(Hook.name), useValue: unusedModel },
        { provide: CustomToolService, useValue: {} },
        /* [FIX-20260818-MEMBERSCOPE · plan §8 = T3-3] The service now resolves
           "may this caller touch this member" through the rooms that join them,
           so it takes the ChatRoom model. These cases never reach a member — they
           all reject a malformed hook id first — so the stub is never queried. */
        { provide: getModelToken(ChatRoom.name), useValue: unusedModel },
        /* [FEAT-20260821-ABANDONSHIELD] The service now writes one audit row when
           the abandon shield is flipped, so it takes AuditLogService. These cases
           never reach that path — they reject a malformed hook id first — so the
           stub throwing is the assertion: if a site-rules call ever starts writing
           an audit row, this suite says so instead of doing it silently. */
        {
          provide: AuditLogService,
          useValue: {
            createAuditLog: () => {
              throw new Error('site-rules must not write an audit row');
            },
          },
        },
        /* [FEAT-20260905-CUSTPROV] The service stamps `customer_provider` onto
           every site-rules answer, INCLUDING the two soft-failure branches these
           cases exercise — so the resolver has to exist even here. The stub
           returns the default name; which provider answered is asserted in
           `customer-provider-stamp.spec.ts`, not in this suite, whose subject is
           the STATUS and the ENVELOPE of a malformed id. */
        {
          provide: CustomerProviderService,
          useValue: {
            /* [FEAT-20260907-PROVCONDS] stampedProfile now resolves the entry for its
         optional condition stamps; a bare entry (declares none) stamps nothing,
         so every assertion below is unchanged by construction. */
            resolve: () => ({ name: 'stub' }),
            activeName: () => 'shopapi_v1',
          },
        },
        /* [FIX-20260905-GLOBALNS] `CustomToolService` / `ExternalApiService` now
           derive a per-environment Redis namespace at construction, so the two
           config slices they read have to exist in the testing module too. */
        {
          provide: realtimeConfig.KEY,
          useValue: { wsEnv: 'dev' },
        },
        {
          provide: mongoConfig.KEY,
          useValue: { uri: 'mongodb://127.0.0.1:27017/testdb' },
        },
      ],
    }).compile();

    service = moduleRef.get(MembersService);
  });

  it('GET resolves 200-shaped soft failure, and does NOT throw', async () => {
    await expect(service.getHookSiteRules('notanid')).resolves.toEqual({
      success: true,
      data: null,
      reason: 'Invalid hook_id',
      domain_name: null,
      /* [FEAT-20260905-CUSTPROV] Added when every profile / site-rules answer
         began naming the provider that produced it. This suite caught the new
         key on its first run BECAUSE it asserts the exact envelope with
         `toEqual` rather than a subset — which is the assertion doing its job,
         not a nuisance. Keep it exact: a `toMatchObject` here would let the next
         key in silently, and the card's refresh button branches on this shape.
         เทสเข้มจับได้ตั้งแต่รอบแรก อย่าผ่อนเป็น subset */
      customer_provider: 'shopapi_v1',
    });
  });

  it("POST refresh throws 400 with legacy's {success:false} envelope", async () => {
    await expect(
      service.refreshHookSiteRules('notanid'),
    ).rejects.toBeInstanceOf(BadRequestException);

    // The body shape matters: the card's refresh button branches on `success`,
    // so the bare `{ error }` the global filter defaults to would drop a key
    // the frontend reads.
    await service.refreshHookSiteRules('notanid').catch((e: unknown) => {
      expect((e as BadRequestException).getStatus()).toBe(400);
      expect((e as BadRequestException).getResponse()).toEqual({
        success: false,
        error: 'Invalid hook_id',
      });
    });
  });
});
