import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { RateLimitModule } from '@/infra/rate-limit/rate-limit.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { AuthModule } from '@/modules/auth';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * Authentication over real HTTP, against the local database.
 *
 * Boots only the modules auth needs rather than the whole application, so this
 * suite stays runnable while other modules are still being ported.
 *
 * Credentials come from the environment. Without them the login-success cases
 * skip, and the failure paths — which need no account — still run.
 */
const username = process.env['GOLDEN_USERNAME'];
const password = process.env['GOLDEN_PASSWORD'];
const hasCredentials = Boolean(username && password);

/**
 * Login is rate limited per client IP, and every case here logs in as the same
 * account — run back to back they exhaust one window and the later ones get 429.
 *
 * Each case therefore presents its own address. `cf-connecting-ip` is what the
 * limiter reads first (see RateLimitService), so setting it isolates the
 * buckets. This keeps the limiter switched on during the tests rather than
 * disabling the very protection the suite is meant to exercise.
 */
let ipCounter = 0;
const uniqueIp = (): string => `203.0.113.${++ipCounter}`;

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const itWithCredentials = hasCredentials ? it : it.skip;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        MongoModule,
        RedisModule,
        RateLimitModule,
        AuthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    }).compile();

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

  describe('default deny', () => {
    it('rejects a protected route with no token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .expect(401);
      expect(response.body).toEqual({ error: 'missing authentication token' });
    });

    it('rejects a malformed token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Authorization', 'Bearer not-a-token')
        .expect(401);
      expect(response.body).toEqual({ error: 'invalid or expired token' });
    });
  });

  describe('input validation', () => {
    it('rejects a body with no credentials', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('cf-connecting-ip', uniqueIp())
        .send({})
        .expect(400);
    });

    it('strips unknown properties instead of passing them through', async () => {
      // forbidNonWhitelisted turns an unexpected field into a 400. That is what
      // stops a `$`-prefixed operator in the body from reaching a Mongo query.
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('cf-connecting-ip', uniqueIp())
        .send({ username: 'x', password: 'y', role: 'admin' })
        .expect(400);
    });

    it('rejects a mongo operator smuggled in as a value', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('cf-connecting-ip', uniqueIp())
        .send({ username: { $ne: null }, password: { $ne: null } });

      // Either rejected as the wrong type (400) or treated as a failed login
      // (401) — never a successful authentication.
      expect([400, 401]).toContain(response.status);
      expect(response.body).not.toHaveProperty('token');
    });
  });

  describe('credentials', () => {
    it('rejects an unknown account without revealing that it is unknown', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('cf-connecting-ip', uniqueIp())
        .send({
          username: 'definitely-not-a-real-account',
          password: 'whatever',
        })
        .expect(401);

      expect(response.body).toEqual({ error: 'invalid username or password' });
    });

    itWithCredentials('authenticates a real account', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('cf-connecting-ip', uniqueIp())
        .send({ username, password })
        .expect(200);

      const body = response.body as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual([
        'permissions',
        'role',
        'token',
        'user',
      ]);
      expect(typeof body['token']).toBe('string');

      // Legacy clients also read the token from this header.
      expect(response.headers['x-auth-key']).toBe(body['token']);
    });

    itWithCredentials('never returns the password hash', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('cf-connecting-ip', uniqueIp())
        .send({ username, password })
        .expect(200);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toMatch(/password_hash/);
      expect(serialised).not.toMatch(/"salt"/);
    });

    itWithCredentials(
      'accepts its own token on a protected route',
      async () => {
        /**
         * The login and the refresh must be adjacent: every login revokes the
         * previous token for this account, so any login in between — including
         * one from another test case — invalidates the token under test.
         */
        const login = await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('cf-connecting-ip', uniqueIp())
          .send({ username, password })
          .expect(200);

        const token = (login.body as { token: string }).token;

        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      },
    );

    itWithCredentials(
      'invalidates an older token after a new login',
      async () => {
        // Each login bumps token_version, so the previous session ends. This is
        // what makes "log out everywhere" immediate rather than waiting for expiry.
        const first = await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('cf-connecting-ip', uniqueIp())
          .send({ username, password })
          .expect(200);
        const firstToken = (first.body as { token: string }).token;

        await request(app.getHttpServer())
          .post('/api/auth/login')
          .set('cf-connecting-ip', uniqueIp())
          .send({ username, password })
          .expect(200);

        await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .set('Authorization', `Bearer ${firstToken}`)
          .expect(401);
      },
    );
  });
});
