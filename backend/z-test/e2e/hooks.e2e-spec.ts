import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { CryptoModule } from '@/infra/crypto';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { User } from '@/modules/admin';
import {
  CustomTool,
  DynamicTag,
  FlexMessage,
  Group,
  Hook,
  HookAuditLog,
  HooksModule,
} from '@/modules/hooks';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * HTTP-surface tests for the hooks module, with the database mocked.
 *
 * These deliberately cover what the golden suite CANNOT, rather than repeating
 * it. Golden proves the two backends answer alike against one shared database;
 * it cannot prove behaviour for data that database does not happen to contain.
 * The cases below pin two such things:
 *
 *   1. Route precedence — `/hook/tags` and `/hook/field-tabs` must not be
 *      captured by `/hook/:id`. Both databases currently return the same thing
 *      either way, so golden would stay green if the order regressed.
 *   2. Secret withholding on a row that actually HAS secrets set, which is the
 *      case that matters for R4 and is not guaranteed to exist in the clone.
 */
describe('Hooks (e2e)', () => {
  let app: INestApplication;

  /** One hook row with every sensitive field populated, as stored: `enc:` for
   * the encrypted ones, plus a plaintext legacy value. */
  const hookWithSecrets = {
    _id: 'a0d00000000000000000000b',
    alias: 'demo',
    line_oa_name: 'Demo OA',
    group: null,
    status: 1,
    created_at: new Date('2026-01-02T03:04:05.000Z'),
    updated_at: new Date('2026-01-02T03:04:05.000Z'),
    line_key: 'enc:aaa.bbb.ccc',
    line_secret: 'enc:ddd.eee.fff',
    custom_ai_key: 'enc:ggg.hhh.iii',
    telegram_key: 'plaintext-telegram-key',
    slip_verify_key: 'enc:jjj.kkk.lll',
    external_password: 'plaintext-external-password',
  };

  const buildQuery = (result: unknown): Record<string, jest.Mock> => {
    const query: Record<string, jest.Mock> = {};
    for (const method of ['sort', 'skip', 'limit', 'populate', 'lean']) {
      query[method] = jest.fn(() => query);
    }
    query['exec'] = jest.fn().mockResolvedValue(result);
    return query;
  };

  const hookModel = {
    find: jest.fn(() => buildQuery([hookWithSecrets])),
    findById: jest.fn(() => buildQuery(hookWithSecrets)),
    countDocuments: jest.fn(() => buildQuery(1)),
    distinct: jest.fn(() => buildQuery(['beta', 'alpha', '', 'alpha'])),
  };

  const groupModel = {
    find: jest.fn(() => buildQuery([])),
    findOne: jest.fn(() => buildQuery(null)),
    countDocuments: jest.fn(() => buildQuery(0)),
  };

  /**
   * Authentication is stubbed out: these cases are about routing and response
   * shaping, and the guards have their own coverage. A superuser is injected so
   * group scoping does not short-circuit the handler before it maps a row.
   */
  const superUser = {
    userId: 'a0d00000000000000000000c',
    roleId: null,
    roleName: 'superadmin',
    permissions: ['hook.manage'],
    username: 'e2e',
    displayName: 'e2e',
    tokenVersion: 0,
    groups: [],
    allowedHooks: null,
  };

  /**
   * Stand-in for a model this suite never calls.
   *
   * Deliberately empty rather than a stub with methods: any case that starts
   * using one of these models fails with a TypeError naming the method, instead
   * of quietly reading `undefined` and passing for the wrong reason.
   */
  const unusedModel = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        RedisModule,
        RateLimitModule,
        CryptoModule,
        HooksModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(getModelToken(Hook.name))
      .useValue(hookModel)
      .overrideProvider(getModelToken(Group.name))
      .useValue(groupModel)
      .overrideProvider(getModelToken(CustomTool.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(DynamicTag.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken('TagCounter'))
      .useValue(unusedModel)
      /**
       * The write endpoints pulled three more models into HooksModule
       * (audit log, flex cards, users for `force_grant`). This suite mocks the
       * database rather than connecting to one, so each has to be stubbed or
       * Nest tries to build a real model and fails on a missing
       * DatabaseConnection. None of the read cases below touches them.
       */
      .overrideProvider(getModelToken(HookAuditLog.name))
      .useValue(unusedModel)
      // Pulled in by the handoff kill switch: HooksModule now registers
      // HandoffTarget so `PATCH /hook/handoff/bulk` can flip a binding.
      // Unstubbed, the injector reaches for a real DatabaseConnection and
      // every case here fails on setup instead of on its own assertion.
      .overrideProvider(getModelToken('HandoffTarget'))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(FlexMessage.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(User.name))
      .useValue(unusedModel)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    // Stand in for the global JwtAuthGuard, which is registered by AuthModule.
    app.use(
      (
        req: { user?: unknown },
        _res: unknown,
        next: (err?: unknown) => void,
      ) => {
        req.user = superUser;
        next();
      },
    );
    await bindTestServer(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('route precedence', () => {
    it('serves /hook/tags rather than treating "tags" as an id', async () => {
      const res = await request(app.getHttpServer())
        .get('/hook/tags')
        .expect(200);

      // Sorted, de-blanked — and NOT the 400 "invalid hook id" that the detail
      // handler would answer if `:id` had matched first.
      expect(res.body).toEqual({ data: ['alpha', 'alpha', 'beta'] });
    });

    it('serves /hook/field-tabs rather than treating it as an id', async () => {
      const res = await request(app.getHttpServer())
        .get('/hook/field-tabs')
        .expect(200);

      const tabs = (res.body as { tabs?: { key: string }[] }).tabs;
      expect(tabs?.map((t) => t.key)).toEqual([
        'ai',
        'slip',
        'notifications',
        'external_api',
        // [FEAT-20260822-NOTICEMODE] owner-ordered 5th tab (22/08: clone the
        // notice mode — "ทำได้แต่ต้องห้ามพังของเดิม"). Appended LAST so the four
        // legacy positions above stay frozen.
        'notice',
      ]);
    });

    it('still rejects a genuinely malformed id on /hook/:id', async () => {
      const res = await request(app.getHttpServer())
        .get('/hook/not-an-object-id')
        .expect(400);

      expect(res.body).toEqual({ error: 'invalid hook id' });
    });
  });

  describe('secrets never leave the service (R4)', () => {
    const secretValues = [
      'enc:',
      'plaintext-telegram-key',
      'plaintext-external-password',
    ];

    it('strips every sensitive field from the list', async () => {
      const res = await request(app.getHttpServer())
        .get('/hook?limit=10')
        .expect(200);

      const row = (res.body as { data: Record<string, unknown>[] }).data[0];
      // Guards against a vacuous pass if the fixture stopped being returned.
      expect(row).toBeDefined();
      expect(row?.['alias']).toBe('demo');

      for (const field of [
        'line_key',
        'line_secret',
        'custom_ai_key',
        'telegram_key',
        'slip_verify_key',
        'external_password',
        'channel_secret',
        'access_token',
      ]) {
        expect(row).not.toHaveProperty(field);
      }
      for (const needle of secretValues) {
        expect(JSON.stringify(res.body)).not.toContain(needle);
      }
    });

    it('returns only a sentinel for each secret on the detail route', async () => {
      const res = await request(app.getHttpServer())
        .get(`/hook/${hookWithSecrets._id}`)
        .expect(200);

      const body = res.body as Record<string, unknown>;
      expect(body['alias']).toBe('demo');

      // Present, so the form can show "configured" — but never the real value.
      expect(body['telegram_key']).toBe('__SECRET_KEPT__');
      expect(body['external_password']).toBe('__SECRET_KEPT__');

      for (const needle of secretValues) {
        expect(JSON.stringify(res.body)).not.toContain(needle);
      }
    });

    it('renders timestamps as Bangkok wall-clock, not UTC', async () => {
      const res = await request(app.getHttpServer())
        .get(`/hook/${hookWithSecrets._id}`)
        .expect(200);

      // 03:04:05Z + 07:00 = 10:04:05 the same day.
      expect((res.body as Record<string, unknown>)['created_at']).toBe(
        '2026-01-02 10:04:05',
      );
    });
  });
});
