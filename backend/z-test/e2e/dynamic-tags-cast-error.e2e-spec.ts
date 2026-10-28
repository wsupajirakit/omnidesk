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
 * `GET /api/dynamic-tags` — a Mongoose CastError must leave as 500 CARRYING
 * MONGOOSE'S MESSAGE, which is what the legacy backend answers.
 *
 * ── why this exists as an in-process test ──────────────────────────────────
 * The golden suite drives BOTH backends over HTTP and is the primary proof, but
 * it can only see what the running :3100 process happens to have loaded. This
 * case pins the rule against the SOURCE, so a future edit to the controller or
 * to `AllExceptionsFilter` fails here immediately rather than at whichever point
 * someone next restarts a server.
 *
 * ── the behaviour being pinned ─────────────────────────────────────────────
 * Legacy does NOT validate `hook_id` on the list route (unlike `group_id` and
 * `scope_group_id`, which are `isValidObjectId`-guarded) —
 * legacy-api/src/controllers/hook/dynamicTagController.js:64-72. A malformed
 * value therefore reaches Mongoose, which throws a CastError on `hook_ids`, and
 * the handler's own catch answers 500 with that message verbatim
 * (dynamicTagController.js:135-137). Measured against the running legacy
 * backend:
 *
 *   GET /api/dynamic-tags?hook_id=notanid&limit=2
 *   500 {"error":"Cast to ObjectId failed for value \"notanid\" (type string)
 *        at path \"hook_ids\" for model \"DynamicTag\""}
 *
 * Before the fix this service answered 500 {"error":"internal error"}: the
 * status matched, so a status-only assertion would have passed, but the message
 * the dashboard displays was gone. `MongooseReadErrorInterceptor` on the list
 * handler is what preserves it.
 *
 * ⚠️ The obvious "cleanup" — adding an `isValidObjectId` guard for `hook_id` —
 * would be WRONG. It turns a request legacy rejects with 500 into a 200.
 */
describe('GET /api/dynamic-tags — Mongoose cast error (e2e)', () => {
  let app: INestApplication;

  /** The exact error Mongoose raises for this query, built by Mongoose itself. */
  const castError = new MongooseError.CastError(
    'ObjectId',
    'notanid',
    'hook_ids',
  );
  // Mongoose appends the model name when the error is thrown from a query, and
  // the legacy message contains it. Set the same way Mongoose does internally.
  castError.message =
    'Cast to ObjectId failed for value "notanid" (type string) at path "hook_ids" for model "DynamicTag"';

  /**
   * Rejects exactly like a real query whose filter cannot be cast.
   *
   * `countDocuments` and `find` are both awaited (via `Promise.all`) by the
   * service, so both have to reject — otherwise the unhandled one leaks.
   */
  const tagModel = {
    countDocuments: () => ({ exec: () => Promise.reject(castError) }),
    find: () => ({
      sort: () => ({
        skip: () => ({
          limit: () => ({
            lean: () => ({ exec: () => Promise.reject(castError) }),
          }),
        }),
      }),
    }),
  };

  /** Empty on purpose: a case that starts using one fails by name. */
  const unusedModel = {};

  const superUser = {
    user_id: 'a0d000000000000000000009',
    username: 'golden',
    role: { name: 'superadmin' },
    permissions: ['dynamic_tags.manage'],
  };

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
      .overrideProvider(getModelToken(DynamicTag.name))
      .useValue(tagModel)
      .overrideProvider(getModelToken(Hook.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(Group.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken(CustomTool.name))
      .useValue(unusedModel)
      .overrideProvider(getModelToken('TagCounter'))
      .useValue(unusedModel)
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

  it('answers 500 carrying Mongoose\'s message, not "internal error"', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dynamic-tags?hook_id=notanid&limit=2')
      .expect(500);

    const body = res.body as { error?: string };
    expect(body.error).toBe(castError.message);
    // The specific regression: the global filter's default must not have
    // replaced the message.
    expect(body.error).not.toBe('internal error');
  });
});
