import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { Role, User } from '@/modules/admin';
import { AuthModule } from '@/modules/auth';
import { Menu } from '@/modules/content';
import { CustomTool, Group, Hook, HookAuditLog } from '@/modules/hooks';
import {
  SystemConfig,
  SystemModule,
  TranslationDict,
  WebhookLog,
} from '@/modules/system';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * Route-level contract for the system endpoints: are they mounted where the
 * dashboard expects, do they deny by default, and does a bad body get rejected.
 *
 * Deliberately NOT a parity test. Every model is mocked, so nothing here says
 * the responses match the legacy backend — that is what
 * `z-test/golden/system.golden-spec.ts` does against a live legacy service.
 * This suite exists to catch the failures a golden run cannot attribute: a
 * route registered under the wrong path, or a missing auth guard.
 */
describe('System endpoints (e2e)', () => {
  let app: INestApplication;

  const mockModel = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    findByIdAndUpdate: jest.fn().mockReturnThis(),
    findByIdAndDelete: jest.fn().mockReturnThis(),
    findOneAndUpdate: jest.fn().mockReturnThis(),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnThis(),
    create: jest.fn().mockResolvedValue({ toObject: () => ({}) }),
    exec: jest.fn().mockResolvedValue([]),
    lean: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        RedisModule,
        RateLimitModule,
        AuthModule,
        SystemModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(getModelToken(SystemConfig.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(WebhookLog.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(TranslationDict.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Hook.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(CustomTool.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(User.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Role.name))
      .useValue(mockModel)
      // Pulled in transitively by AuthModule, not by the system endpoints.
      .overrideProvider(getModelToken(Group.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Menu.name))
      .useValue(mockModel)
      // [FIX-20260818-SECAUDIT] AuthModule/AdminModule now import AuditModule so a
      // sign-in and an account change are recorded, which drags this model in
      // transitively — same reason Group and Menu are listed above.
      .overrideProvider(getModelToken(HookAuditLog.name))
      .useValue(mockModel)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await bindTestServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  /**
   * The paths matter as much as the behaviour: several of these sit at the root
   * rather than under `/api`, and the dashboard has them compiled in. A 401
   * proves the route exists *and* denies by default — a 404 would mean it was
   * mounted somewhere else.
   */
  describe('Default deny — every route requires a token', () => {
    it.each([
      ['get', '/configs'],
      ['get', '/config/test-external-api'],
      ['get', '/config/a0d000000000000000000010'],
      ['put', '/config/a0d000000000000000000010'],
      ['delete', '/config/a0d000000000000000000010'],
      ['post', '/config'],
      ['post', '/config/test-custom'],
      ['get', '/webhook/logs'],
      ['post', '/webhook/logs'],
      ['get', '/webhook/logs/a0d000000000000000000010'],
      ['put', '/webhook/logs/a0d000000000000000000010'],
      ['delete', '/webhook/logs/a0d000000000000000000010'],
      ['get', '/stats'],
      ['get', '/model'],
      ['get', '/api/translation-dict/tools'],
      // The three read endpoints: `/rows` and `/usage` must be matched as
      // literal paths, not swallowed by a `:id` route, so a default-deny case
      // for each also pins the route ordering.
      ['get', '/api/translation-dict'],
      ['get', '/api/translation-dict/rows'],
      ['get', '/api/translation-dict/usage'],
      ['put', '/api/translation-dict'],
      ['delete', '/api/translation-dict/a0d000000000000000000010'],
    ])('rejects %s %s without a token (401)', async (method, path) => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const verb = method as 'get' | 'post' | 'put' | 'delete';
      const req = request(server)[verb](path);
      // Only attach a body to the verbs that carry one. Sending `{}` on a GET
      // adds a JSON content-type the route has no DTO for, and the validation
      // pipe answers 400 before the auth guard is ever reached — which would
      // assert nothing about the guard this case exists to test.
      const res = await (verb === 'get' || verb === 'delete'
        ? req
        : req.send({}));

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'missing authentication token' });
    });
  });

  /**
   * `/version` is the control case: it is the one route in this module that is
   * `@Public()`. If it ever started returning 401 the global guard would have
   * been applied too broadly, and the assertions above would still pass.
   */
  describe('Public route stays public', () => {
    it('serves GET /version without a token', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server).get('/version');

      expect(res.status).toBe(200);
      expect(Object.keys(res.body as object).sort()).toEqual([
        'commit',
        'datetime',
      ]);
    });
  });

  /**
   * Auth runs before validation, so an unauthenticated request cannot show that
   * the DTOs are wired up. These assert the 401 comes first, which is the
   * ordering the error envelope depends on.
   */
  describe('Auth is checked before body validation', () => {
    it('answers 401, not 400, for a malformed body with no token', async () => {
      const server = app.getHttpServer() as Parameters<typeof request>[0];
      const res = await request(server)
        .post('/config')
        .send({ definitely_not_a_field: true });

      expect(res.status).toBe(401);
    });
  });
});
