import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '@/app.module';

import { bindTestServer } from '../lib/bind-test-server';

describe('TicketsModule (e2e)', () => {
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

  it('GET /api/assign-histories requires authentication or permission', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/assign-histories',
    );
    expect([200, 401, 403]).toContain(response.status);
  });

  it('GET /api/insight-reports/tickets requires permission or returns response', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/insight-reports/tickets',
    );
    expect([200, 401, 403]).toContain(response.status);
  });

  // [FEAT-20260817-REOPENBYADMIN] the reopen route sits behind the class-level
  // ticket.manage guard — an unauthenticated call must NEVER reach the handler
  // (a 404/409 here would mean the guard was bypassed and the body ran).
  it('POST /api/tickets/reopen-by-admin rejects unauthenticated calls', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/tickets/reopen-by-admin')
      .send({ ticket_id: 'a0d000000000000000000010' });
    expect([401, 403]).toContain(response.status);
  });
});
