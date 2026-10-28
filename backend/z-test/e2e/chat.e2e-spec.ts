import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';

import { bindTestServer } from '../lib/bind-test-server';

describe('ChatModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await bindTestServer(app);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /api/chat requires authentication or returns response', async () => {
    const response = await request(app.getHttpServer()).get('/api/chat');
    expect([200, 401]).toContain(response.status);
  });

  it('GET /api/chat/contacts requires permission or returns response', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/chat/contacts',
    );
    expect([200, 401, 403]).toContain(response.status);
  });
});
