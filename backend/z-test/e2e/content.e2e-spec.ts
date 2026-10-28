import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { Role, User } from '@/modules/admin';
import { AuthModule } from '@/modules/auth';
import {
  AutoReply,
  Broadcast,
  ContentModule,
  ImageStorage,
  Menu,
  ObjectCategory,
  ObjectImage,
  QuickReply,
  QuickReplyCategory,
} from '@/modules/content';
import {
  CustomTool,
  DynamicTag,
  FlexMessage,
  Group,
  Hook,
  HookAuditLog,
  HooksModule,
} from '@/modules/hooks';
import { Counter } from '@/modules/system';

import { bindTestServer } from '../lib/bind-test-server';

describe('ContentModule (e2e)', () => {
  let app: INestApplication;

  const mockModel = {
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findById: jest.fn().mockReturnThis(),
    countDocuments: jest.fn().mockResolvedValue(0),
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
        /* [FIX-20260824-BCASTHISTMODEL] the lane's BroadcastsReadService takes
           the RAW connection and asks for models at use time (runbook §12 —
           User is deliberately not registered in content.module). That token
           exists only when MongooseModule.forRoot ran, so this harness now
           imports the real MongoModule like every other e2e here; the model
           overrides below still win, and these nine cases stop at the guard
           before any query could run. */
        MongoModule,
        RedisModule,
        RateLimitModule,
        AuthModule,
        HooksModule,
        ContentModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Role.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Hook.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Group.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(CustomTool.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(DynamicTag.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken('TagCounter'))
      .useValue(mockModel)
      // Pulled into HooksModule by the hook write endpoints; this suite mocks
      // the database, so every model it imports has to be stubbed.
      .overrideProvider(getModelToken(HookAuditLog.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(FlexMessage.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Menu.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Broadcast.name))
      .useValue(mockModel)
      /* [FIX-20260824-BCASTHISTMODEL] the lane registered BroadcastHistory in
         ContentModule (:93) and this harness — which mocks every model instead
         of importing Mongo — never learned it. All nine 401 cases then died at
         DI ("can't resolve BroadcastHistoryModel") before a request was made,
         on the LANE itself too, identically. Same mock; the string token, because the barrel does not export the class — the same form the Member/ChatRoom overrides below already use.
         model ใหม่ใน module = ต้อง override เพิ่มที่นี่เสมอ */
      .overrideProvider(getModelToken('BroadcastHistory'))
      .useValue(mockModel)
      .overrideProvider(getModelToken(AutoReply.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(QuickReply.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(QuickReplyCategory.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(ObjectCategory.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(ObjectImage.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(ImageStorage.name))
      .useValue(mockModel)
      // Flex messages joined this module; without these three the injector
      // reaches for a real DatabaseConnection that this partial module never
      // imports, and every case in the file fails on setup rather than on its
      // own assertion.
      .overrideProvider(getModelToken('SystemConfig'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('WebhookLog'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('TranslationDict'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('CustomCurl'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('Member'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('ChatRoom'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('ChatMessage'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('Ticket'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('SlipVerification'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('Tag'))
      .useValue(mockModel)
      .overrideProvider(getModelToken('CustomerTag'))
      .useValue(mockModel)
      // Pulled in by the handoff kill switch: HooksModule now registers
      // HandoffTarget so `PATCH /hook/handoff/bulk` can flip a binding. This
      // suite mocks the database, so every model the module graph touches has
      // to be stubbed or the injector reaches for a real DatabaseConnection and
      // EVERY case in the file fails on setup rather than on its own assertion.
      .overrideProvider(getModelToken('HandoffTarget'))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Counter.name))
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

  it('rejects GET /api/menus without token with 401', async () => {
    await request(app.getHttpServer()).get('/api/menus').expect(401);
  });

  it('rejects GET /api/broadcasts without token with 401', async () => {
    await request(app.getHttpServer()).get('/api/broadcasts').expect(401);
  });

  it('rejects GET /api/auto-replies without token with 401', async () => {
    await request(app.getHttpServer()).get('/api/auto-replies').expect(401);
  });

  it('rejects GET /api/quick-replies without token with 401', async () => {
    await request(app.getHttpServer()).get('/api/quick-replies').expect(401);
  });

  it('rejects GET /api/object-categories without token with 401', async () => {
    await request(app.getHttpServer())
      .get('/api/object-categories')
      .expect(401);
  });

  it('rejects GET /api/object-images without token with 401', async () => {
    await request(app.getHttpServer()).get('/api/object-images').expect(401);
  });

  it('rejects GET /api/image-storage without token with 401', async () => {
    await request(app.getHttpServer()).get('/api/image-storage').expect(401);
  });

  /**
   * There is no authenticated case in this file, and that is deliberate.
   *
   * Every model here is `mockModel`, whose `findOne` resolves to nothing. So
   * `/api/auth/login` cannot match a user and answers 401 by construction —
   * `authToken` is always undefined, and any case that sent one would be
   * asserting against a token the app itself refused to issue.
   *
   * Seven such cases used to live here. They never ran: without
   * `GOLDEN_USERNAME`/`GOLDEN_PASSWORD` set, `itWithCredentials` made them
   * `it.skip` and the file reported green. The first run that supplied real
   * credentials turned all seven red at `expect(authToken).toBeTruthy()`, which
   * is what a test that cannot pass looks like when it finally executes. The
   * credentials were never the problem — a mocked User collection has no user
   * to log in as, at any password.
   *
   * The authenticated behaviour of these routes IS covered, in
   * `z-test/golden/content.golden-spec.ts`, against both running backends with
   * a real login and a real database. That is the only place it can be tested
   * honestly. What this file covers is what an in-process app can prove:
   * the routes are mapped, and the guard rejects.
   */
  it('rejects a well-formed but unverifiable bearer token with 401', async () => {
    // Proves the guard verifies the token rather than merely checking that an
    // Authorization header exists — the `without token` cases above cannot
    // distinguish those two, since both fail at the same place.
    const forged = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiJ4In0',
      'not-a-signature',
    ].join('.');
    await request(app.getHttpServer())
      .get('/api/menus')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('rejects a malformed Authorization header with 401', async () => {
    await request(app.getHttpServer())
      .get('/api/menus')
      .set('Authorization', 'Bearer')
      .expect(401);
  });
});
