import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter } from '@/common';
import { ConfigModule } from '@/config/config.module';
import { MongoModule } from '@/infra/mongo/mongo.module';
import { RedisModule } from '@/infra/redis/redis.module';
import { HealthModule } from '@/modules/health';

import { bindTestServer } from '../lib/bind-test-server';

/**
 * Boots a real Nest application (Mongo + Redis must be running locally) and
 * asserts the HTTP surface, including the error envelope the dashboard parses.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, MongoModule, RedisModule, HealthModule],
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

  it('GET /health reports liveness without touching dependencies', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok', service: 'omnidesk-api' });
  });

  it('GET /health/ready reports dependency status', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      dependencies: { mongo: { status: 'up' } },
    });
  });

  it('returns the legacy { error } envelope for unknown routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/definitely-not-a-route')
      .expect(404);

    // The dashboard reads `error` directly — the key name is part of the contract.
    expect(Object.keys(response.body as object)).toEqual(['error']);
    expect(typeof (response.body as { error: unknown }).error).toBe('string');
  });

  it('never leaks a stack trace to the client', async () => {
    const response = await request(app.getHttpServer())
      .get('/definitely-not-a-route')
      .expect(404);
    expect(JSON.stringify(response.body)).not.toMatch(/at .*\.ts:\d+/);
  });
});
