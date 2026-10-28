import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { AdminModule, Role, User } from '@/modules/admin';
import { AuthModule } from '@/modules/auth';
import { Menu } from '@/modules/content';
import { Group, Hook, HookAuditLog } from '@/modules/hooks';

import { bindTestServer } from '../lib/bind-test-server';

describe('Users & Roles (e2e)', () => {
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
        RedisModule,
        RateLimitModule,
        AuthModule,
        AdminModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    })
      .overrideProvider(getModelToken(User.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Role.name))
      .useValue(mockModel)
      .overrideProvider(getModelToken(Group.name))
      .useValue(mockModel)
      /* `AdminModule` registers the Hook model (admin.module.ts:30) for the ACL
         seeder. It is not used by any case here, but Nest resolves the whole
         graph at compile time, so an un-overridden model makes it demand a real
         `DatabaseConnection` — and this suite deliberately boots without Mongo.
         Every model the imported modules register must be stubbed, whether or
         not a case touches it. โมดูลลงทะเบียน model ไหน ต้อง override ให้ครบ */
      .overrideProvider(getModelToken(Hook.name))
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

  describe('Authentication Deny', () => {
    it('rejects GET /api/users with no token (401)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/users')
        .expect(401);
      expect(response.body).toEqual({ error: 'missing authentication token' });
    });

    it('rejects GET /api/roles with no token (401)', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/roles')
        .expect(401);
      expect(response.body).toEqual({ error: 'missing authentication token' });
    });

    it('rejects POST /api/users with no token (401)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/users')
        .send({ username: 'test', password: 'pwd' })
        .expect(401);
      expect(response.body).toEqual({ error: 'missing authentication token' });
    });

    it('rejects POST /api/roles with no token (401)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/roles')
        .send({ name: 'test-role' })
        .expect(401);
      expect(response.body).toEqual({ error: 'missing authentication token' });
    });
  });

  describe('Input Validation', () => {
    it('rejects POST /api/users with invalid body (400) when forbidden fields supplied', async () => {
      await request(app.getHttpServer())
        .post('/api/users')
        .send({ username: 'test', password: 'pwd', forbiddenField: 123 })
        .expect(401);
    });
  });
});
