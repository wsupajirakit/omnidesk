import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Error as MongooseError } from 'mongoose';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { CryptoModule } from '@/infra/crypto';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { AdminModule, Role, User } from '@/modules/admin';
import { Menu } from '@/modules/content';
import { Group, Hook, HookAuditLog } from '@/modules/hooks';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * `/api/users/:id` and `/api/roles/:id` — a malformed ObjectId must surface as
 * Mongoose's OWN CastError message, with the status legacy answers for that
 * specific handler.
 *
 * ── the behaviour being pinned ─────────────────────────────────────────────
 * Legacy leaves `req.params.id` completely UNGUARDED on all six of these
 * handlers, so a malformed id reaches Mongoose, `findOne` throws a CastError,
 * and each handler's own `catch` decides the status. Measured against the
 * running legacy backend (`GET /api/users/notanid` etc.):
 *
 *   GET    /api/users/:id  -> 500  userController.js:325
 *   PUT    /api/users/:id  -> 400  userController.js:637 (`error.statusCode || 400`;
 *                                  a bare CastError has no statusCode)
 *   DELETE /api/users/:id  -> 500  userController.js:874
 *   GET    /api/roles/:id  -> 500  roleController.js:65
 *   PUT    /api/roles/:id  -> 400  roleController.js:132
 *   DELETE /api/roles/:id  -> 500  roleController.js:150
 *
 * …each carrying, verbatim:
 *   Cast to ObjectId failed for value "notanid" (type string) at path "_id"
 *   for model "User"      (resp. "Role")
 *
 * Before the fix this service pre-validated the id with `Types.ObjectId.isValid`
 * and answered 404 {"error":"User not found"} on all six — a wrong status AND a
 * message that hides WHICH field was rejected.
 *
 * ── why the split matters ──────────────────────────────────────────────────
 * The two interceptors are not interchangeable. `MongooseReadErrorInterceptor`
 * keeps 500, `MongooseErrorInterceptor` maps to 400. Mounting either one on all
 * six routes would trade one divergence for another, so each assertion below
 * names the status legacy actually answers for that route.
 *
 * ⚠️ The obvious "cleanup" — restoring an `isValidObjectId` guard — would be
 * WRONG. It turns a request legacy rejects into a 404. Legacy is the spec here
 * even where it looks like a bug.
 */
describe('users/roles :id — Mongoose cast error (e2e)', () => {
  let app: INestApplication;

  /** Built the way Mongoose builds it when a query filter cannot be cast. */
  const castErrorFor = (model: string): MongooseError.CastError => {
    const err = new MongooseError.CastError('ObjectId', 'notanid', '_id');
    err.message = `Cast to ObjectId failed for value "notanid" (type string) at path "_id" for model "${model}"`;
    return err;
  };

  const userCastError = castErrorFor('User');
  const roleCastError = castErrorFor('Role');

  /**
   * Rejects like a real `findOne(...).populate(...).exec()` chain whose filter
   * cannot be cast. Each service builds a slightly different chain, so every
   * link has to be chainable and only `exec()` rejects.
   */
  const rejectingChain = (error: MongooseError.CastError) => {
    const chain: Record<string, unknown> = {
      populate: () => chain,
      lean: () => chain,
      exec: () => Promise.reject(error),
    };
    return chain;
  };

  const userModel = { findOne: () => rejectingChain(userCastError) };
  const roleModel = { findOne: () => rejectingChain(roleCastError) };

  /** Empty on purpose: a case that starts using one fails by name. */
  const unusedModel = {};

  const superUser = {
    user_id: 'a0d000000000000000000009',
    username: 'golden',
    role: { name: 'superadmin' },
    permissions: ['user.manage', 'role.manage'],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        RedisModule,
        RateLimitModule,
        CryptoModule,
        AdminModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue(userModel)
      .overrideProvider(getModelToken(Role.name))
      .useValue(roleModel)
      .overrideProvider(getModelToken(Menu.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(Group.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(Hook.name))
      .useValue(unusedModel)
      // [FIX-20260818-SECAUDIT] AuthModule/AdminModule now import AuditModule so a
      // sign-in and an account change are recorded, which drags this model in
      // transitively — same reason Group and Menu are listed above.
      .overrideProvider(getModelToken(HookAuditLog.name))
      .useValue(unusedModel)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    // Stand in for the global JwtAuthGuard, registered by AuthModule.
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

  /**
   * Each row is a route legacy answers with a CastError, and the status its own
   * catch produces. The status column is the whole point: it is what tells the
   * two interceptors apart.
   */
  const cases: Array<{
    method: 'get' | 'put' | 'delete';
    path: string;
    status: number;
    message: string;
    legacy: string;
  }> = [
    {
      method: 'get',
      path: '/api/users/notanid',
      status: 500,
      message: userCastError.message,
      legacy: 'userController.js:325',
    },
    {
      method: 'put',
      path: '/api/users/notanid',
      status: 400,
      message: userCastError.message,
      legacy: 'userController.js:637',
    },
    {
      method: 'delete',
      path: '/api/users/notanid',
      status: 500,
      message: userCastError.message,
      legacy: 'userController.js:874',
    },
    {
      method: 'get',
      path: '/api/roles/notanid',
      status: 500,
      message: roleCastError.message,
      legacy: 'roleController.js:65',
    },
    {
      method: 'put',
      path: '/api/roles/notanid',
      status: 400,
      message: roleCastError.message,
      legacy: 'roleController.js:132',
    },
    {
      method: 'delete',
      path: '/api/roles/notanid',
      status: 500,
      message: roleCastError.message,
      legacy: 'roleController.js:150',
    },
  ];

  it.each(cases)(
    "$method $path -> $status carrying Mongoose's message (legacy $legacy)",
    async ({ method, path, status, message }) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .send({})
        .expect(status);

      const body = res.body as { error?: string };
      expect(body.error).toBe(message);

      // The specific regressions this guards against:
      //  - a re-added isValidObjectId guard would make this "User not found"
      expect(body.error).not.toMatch(/not found/i);
      //  - the global filter's default would replace the message entirely
      expect(body.error).not.toBe('internal error');
    },
  );

  /**
   * The 400/500 split is the part most likely to be "tidied" into one
   * interceptor. Asserting the two groups disagree makes that collapse fail
   * here rather than in a cross-backend sweep weeks later.
   */
  it('answers 500 for reads/deletes and 400 for updates, not one status for all', () => {
    const statuses = new Set(cases.map((c) => c.status));
    expect([...statuses].sort()).toEqual([400, 500]);
  });
});
