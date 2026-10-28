import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
// [FEAT-20260827-ADMINBLOCK] StrikeModule now imports AuditModule, which drags
// two more model tokens (Hook, HookAuditLog) and the Redis-backed query cache
// into the graph. Same override recipe as `users.e2e-spec.ts:44-67`: every
// model an imported module registers must be stubbed, used or not.
import { RedisModule } from '@/infra/redis/redis.module';
import { AuditLogService } from '@/modules/audit';
import { Hook, HookAuditLog } from '@/modules/hooks';
import { StrikeModule, StrikeService } from '@/modules/strike';

import { bindTestServer } from '../lib/bind-test-server';
import { fakeModel, type FakeModel } from '../lib/strike-fakes';

/**
 * [FEAT-20260824-STRIKESESSION] The HTTP surface, with the database mocked.
 *
 * WHY THIS SUITE EXISTS AT ALL — `scripts/route-coverage.mjs` reported these four
 * routes as COVERED before it was written, and that was a FALSE PASS. That script
 * matches a route's literal path segments against the raw text of anything under
 * `z-test/`, and the word "strikes" already appeared in
 * `user-rate-ladder.service.spec.ts` (a local variable) and in
 * `strike-service.spec.ts`. Its own header warns that a false "covered" is not
 * acceptable; this is one, and the honest fix is a real test rather than trusting
 * the report. เครื่องมือบอกว่าผ่าน ทั้งที่ยังไม่มีเทส — ต้องเขียนจริง ไม่ใช่เชื่อรายงาน
 *
 * WHAT ONLY AN HTTP TEST CAN CATCH, and why each case is here:
 *   1. ROUTE PRECEDENCE. `GET /api/strikes/:lineUserId` is declared before
 *      `GET /api/strikes/sessions/:sessionId/events`. Reorder them, or add a
 *      one-segment `sessions` route later, and `:lineUserId` swallows it. The
 *      unit specs call the service directly and would stay green through that.
 *   2. THE VALIDATION PIPE. `status: 'open'` must be refused by the DTO, not by
 *      the service. Calling the service directly skips the pipe entirely — the
 *      exact gap dev-local §5 documents.
 *   3. THE STATUS CODES an operator's screen reacts to: 409 for an already
 *      closed session versus 404 for one that never existed.
 *
 * The auth guard is global in AppModule and therefore absent here, like every
 * other module-scoped e2e in this folder. That it is applied was verified
 * separately against the running server (401 on all routes without a token,
 * 200 with one) — see `todo/be_todo58_24082026_strike.md`.
 */
describe('Strikes (e2e)', () => {
  let app: INestApplication;
  let sessions: FakeModel;
  let events: FakeModel;
  let service: StrikeService;
  // [FEAT-20260827-ADMINBLOCK] what the audit stub captured, oldest first
  const auditRows: Record<string, unknown>[] = [];

  const USER = 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
  const HOOK = 'a0d00000000000000000000d';

  beforeAll(async () => {
    sessions = fakeModel('seq', 'line_user_id');
    events = fakeModel('occurred_at');

    const mockModel = { find: () => ({ exec: () => Promise.resolve([]) }) };
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, RedisModule, StrikeModule],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(getModelToken('MemberStrikeSession'))
      .useValue(sessions)
      .overrideProvider(getModelToken('MemberStrikeEvent'))
      .useValue(events)
      // [FEAT-20260827-ADMINBLOCK] transitively registered by AuditModule
      .overrideProvider(getModelToken(Hook.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(HookAuditLog.name))
      .useValue(mockModel)
      /* the RECORDING stub — what lets this suite assert that block and clear
         each leave a row, without a database. The real service is exercised by
         `strike-block-audit.spec.ts` (payload shape) and by the live proof. */
      .overrideProvider(AuditLogService)
      .useValue({
        createAuditLog: (payload: Record<string, unknown>) => {
          auditRows.push(payload);
          return Promise.resolve(payload);
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    /* No auth guard in a module-scoped e2e — so `@CurrentUser()` would be
       undefined and the audit path (which refuses actorless rows on purpose)
       could never be exercised. This middleware stands in for the guard the
       way the real one does it: by putting the verified user on `req.user`
       (`current-user.decorator.ts:16`). */
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = {
        userId: 'a0d00000000000000000000e',
        username: 'admin',
        displayName: 'Administrator',
      };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    service = app.get(StrikeService);
    await bindTestServer(app);

    // One real strike, through the same entry point the webhook uses.
    await service.record({
      hookId: HOOK,
      lineUserId: USER,
      level: 2,
      limit: 2,
      windowSeconds: 60,
      messageType: 'sticker',
      occurredAt: new Date('2026-08-24T10:00:00Z'),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/strikes/:lineUserId returns the open session with its per-level tally', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/strikes/${USER}`)
      .expect(200);

    expect(res.body.current).toMatchObject({
      line_user_id: USER,
      seq: 1,
      status: 'open',
      strike_total: 1,
      by_level: { '2': 1 },
    });
  });

  it('answers 200 with null — not 404 — for a customer who was never blocked', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/strikes/Unobody00000000000000000000000000')
      .expect(200);

    expect(res.body).toEqual({ current: null });
  });

  /** Case 1 in the header: `sessions/...` must not be eaten by `:lineUserId`. */
  it('routes sessions/:id/events to the events handler, not to :lineUserId', async () => {
    const id = String(sessions.rows[0]?.['_id']);

    const res = await request(app.getHttpServer())
      .get(`/api/strikes/sessions/${id}/events`)
      .expect(200);

    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      level: 2,
      limit: 2,
      window_seconds: 60,
      message_type: 'sticker',
    });
  });

  /* ── [FEAT-20260826-STRIKEROLLUP] the rollup route over real HTTP ──────────
     ⚠️ `scripts/route-coverage.mjs` CANNOT guard this route the way it guards
     the others: it anchors on the last concrete path segment, and would have
     reported a `/total` route as covered by 30 unrelated files. The segment was
     named `rollup` so the gate stays honest — but these cases, not the gate,
     are what actually proves the route works.

     ⚠️ The pipe built in beforeAll is WEAKER than production's
     (`src/main.ts` adds `forbidNonWhitelisted` and `enableImplicitConversion`).
     Do not "align" it here — that would flip the 400/200 outcome of the cases
     already in this file. These assertions only claim what THIS pipe proves. */

  it('routes :lineUserId/rollup to the rollup handler, not to :lineUserId', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/rollup`)
      .expect(200);

    // `:lineUserId` would have answered `{current: …}`; the rollup shape is flat
    expect(res.body).toMatchObject({
      line_user_id: USER,
      scope: 'lifetime',
      session_status: 'all',
      total: 1,
      by_level: { '2': 1 },
      sessions_counted: 1,
      truncated: false,
      range: null,
    });
  });

  it('switches scope to range when a bound is supplied', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/rollup`)
      .query({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T00:00:00.000Z',
      })
      .expect(200);

    expect(res.body.scope).toBe('range');
    expect(res.body.total).toBe(1);
    // the ranged path counted events, so it did not count sessions
    expect(res.body.sessions_counted).toBeNull();
  });

  it('rejects a malformed instant instead of reading it as a date', async () => {
    await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/rollup`)
      .query({ from: 'garbage' })
      .expect(400);
  });

  it('rejects an inverted range rather than answering it with zero', async () => {
    // total:0 for from>to is indistinguishable from "never blocked"
    await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/rollup`)
      .query({
        from: '2026-08-31T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      })
      .expect(400);
  });

  it('refuses session_status together with a range instead of ignoring it', async () => {
    // events carry no session status; accepting the pair would silently drop it
    await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/rollup`)
      .query({ from: '2026-08-01T00:00:00.000Z', session_status: 'closed' })
      .expect(400);
  });

  it('filters the fold by session status', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/rollup`)
      .query({ session_status: 'closed' })
      .expect(200);

    // the only session in this suite is open, so "cleared" folds nothing
    expect(res.body).toMatchObject({
      scope: 'lifetime',
      session_status: 'closed',
      total: 0,
      by_level: {},
      sessions_counted: 0,
      truncated: false,
    });
  });

  /* ── [FEAT-20260826-STRIKESUSPEND] the tray's route ────────────────────────
     ⚠️ DECLARED ABOVE `:lineUserId`, and that ordering is the test. `suspended`
     is a single segment, so `@Get(':lineUserId')` would swallow it and answer
     with "the open session of a customer whose LINE id is the word suspended" —
     a 200 full of nulls, which is the worst kind of wrong. */

  it('GET /api/strikes/suspended is not swallowed by :lineUserId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/strikes/suspended')
      .expect(200);

    // the tray shape, not the single-session shape
    expect(res.body).toHaveProperty('suspended');
    expect(res.body).toHaveProperty('policy');
    expect(res.body).not.toHaveProperty('current');
  });

  it('reports the policy so the screen never hardcodes the threshold', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/strikes/suspended')
      .expect(200);

    expect(res.body.policy).toEqual({ suspend_at: 5, window_hours: 24 });
  });

  it('GET /:lineUserId/sessions lists the history newest first', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/strikes/${USER}/sessions`)
      .expect(200);

    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0]).toMatchObject({ seq: 1, status: 'open' });
  });

  /** Case 2: the pipe, not the service, is what refuses this. */
  it('refuses status:"open" at the DTO with 400', async () => {
    const id = String(sessions.rows[0]?.['_id']);

    await request(app.getHttpServer())
      .patch(`/api/strikes/sessions/${id}`)
      .send({ status: 'open' })
      .expect(400);
  });

  it('404s a session id that never existed', async () => {
    await request(app.getHttpServer())
      .patch('/api/strikes/sessions/a0d00000000000000000000f')
      .send({ status: 'closed' })
      .expect(404);
  });

  /** Case 3, and the whole point of the feature: clear, then history survives. */
  it('closes a session, opens the next one, and keeps every strike', async () => {
    const id = String(sessions.rows[0]?.['_id']);

    const closed = await request(app.getHttpServer())
      .patch(`/api/strikes/sessions/${id}`)
      .send({ status: 'closed', reason: 'e2e' })
      .expect(200);

    expect(closed.body.closed).toMatchObject({
      seq: 1,
      status: 'closed',
      strike_total: 1,
      closed_reason: 'e2e',
    });

    // a second press must be refused, not silently repeated
    await request(app.getHttpServer())
      .patch(`/api/strikes/sessions/${id}`)
      .send({ status: 'closed' })
      .expect(409);

    // counting restarted, and the closed session still holds its strike
    const after = await request(app.getHttpServer())
      .get(`/api/strikes/${USER}`)
      .expect(200);
    expect(after.body.current).toMatchObject({ seq: 2, strike_total: 0 });

    const stillThere = await request(app.getHttpServer())
      .get(`/api/strikes/sessions/${id}/events`)
      .expect(200);
    expect(stillThere.body.events).toHaveLength(1);
  });

  /* ── [FEAT-20260827-ADMINBLOCK] POST :lineUserId/suspend — "Block จำกัดการคุย" ─
   📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`

   A separate customer id per case: this suite shares one fake collection, and
   the block cases must not disturb the counting fixtures above. */

  describe('admin block over HTTP', () => {
    const FRESH = 'Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';

    it('blocks a customer who has NO session yet — creates it, stamps it, audits it', async () => {
      const auditBefore = auditRows.length;

      const res = await request(app.getHttpServer())
        .post(`/api/strikes/${FRESH}/suspend`)
        .send({ reason: 'Block จำกัดการคุย — e2e' })
        .expect(200);

      expect(res.body.suspended).toMatchObject({
        line_user_id: FRESH,
        seq: 1,
        status: 'open',
        strike_total: 0,
        suspended_by: 'a0d00000000000000000000e',
        suspended_reason: 'Block จำกัดการคุย — e2e',
      });
      expect(res.body.suspended.suspended_at).toBeDefined();

      /* NOT asserted here: the tray listing them. Its pipeline carries two
       `$lookup`s, which `strike-fakes.ts` refuses BY DESIGN (see its header) —
       the tray's shape is pinned in `strike-suspend-decision.spec.ts` (the
       `$match {suspended_at: {$exists}}` that makes an admin row indistinguishable
       from a gate row), and its execution belongs to the live proof against a
       real mongod. Here the same collection read proves the stamp landed: */
      const cur = await request(app.getHttpServer())
        .get(`/api/strikes/${FRESH}`)
        .expect(200);
      expect(cur.body.current.suspended_at).toBeDefined();
      expect(cur.body.current.suspended_by).toBe('a0d00000000000000000000e');

      // and the block left an audit row naming actor and member
      const row = auditRows[auditRows.length - 1] as Record<string, unknown>;
      expect(auditRows.length).toBe(auditBefore + 1);
      expect(row).toMatchObject({ parent: 'strike_session', action: 'update' });
      expect(String(row['note'])).toContain(FRESH);
      expect(row['actor']).toMatchObject({
        user_id: 'a0d00000000000000000000e',
      });
    });

    it('a second block answers 409 — the latch is already armed', async () => {
      await request(app.getHttpServer())
        .post(`/api/strikes/${FRESH}/suspend`)
        .send({})
        .expect(409);
    });

    it('refuses a reason over 200 chars at the DTO, before the service runs', async () => {
      await request(app.getHttpServer())
        .post(`/api/strikes/Uccccccccccccccccccccccccccccccc3/suspend`)
        .send({ reason: 'x'.repeat(201) })
        .expect(400);
    });

    it('เคลียร์ session เดิมปลด block ที่แอดมิน mint — และ audit ฝั่งยกเลิกก็ลง', async () => {
      const current = await request(app.getHttpServer())
        .get(`/api/strikes/${FRESH}`)
        .expect(200);
      const id = current.body.current._id as string;
      const auditBefore = auditRows.length;

      await request(app.getHttpServer())
        .patch(`/api/strikes/sessions/${id}`)
        .send({ status: 'closed', reason: 'unblock — e2e' })
        .expect(200);

      // released: fresh session, no suspended_* at all
      const after = await request(app.getHttpServer())
        .get(`/api/strikes/${FRESH}`)
        .expect(200);
      expect(after.body.current).toMatchObject({ seq: 2, strike_total: 0 });
      expect(after.body.current.suspended_at).toBeUndefined();
      expect(after.body.current.suspended_by).toBeUndefined();

      // the clear wrote its own audit row — symmetry is the owner's ask
      expect(auditRows.length).toBe(auditBefore + 1);
      const row = auditRows[auditRows.length - 1] as Record<string, unknown>;
      expect(row).toMatchObject({ parent: 'strike_session', action: 'update' });
      expect(String(row['note'])).toContain(FRESH);
      const fields = (
        row['changed_fields'] as {
          field: string;
          from?: unknown;
          to?: unknown;
        }[]
      ).map((c) => c.field);
      expect(fields).toContain('status');
    });
  });
});
