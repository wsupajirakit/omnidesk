import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { rateLimitConfig, realtimeConfig } from '@/config/app.config';
import { envSchema } from '@/config/env.schema';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { RedisService } from '@/infra/redis/redis.service';
import type { AuthService, WsTicketService } from '@/modules/auth';
/* controller ไม่ได้อยู่ใน barrel และไม่ควรอยู่ — ผ่อนเฉพาะบรรทัดนี้เพื่อเทส */
// eslint-disable-next-line no-restricted-imports
import { AuthController } from '@/modules/auth/auth.controller';

/**
 * [FEAT-20260823-LOGINFAIL] แกนที่ 2 ของ login — "รหัสผิด" ต่อ IP
 *
 * เจ้าของ 23/08: *"ป้องกันพวก flood ip เดิม + สุ่ม user ได้ไหม"* และ
 * *"Ip office ไม่ชน / admin หลายคนคละ user = ใช้จริงมีโอกาสผิดได้ 1-2 ครั้ง
 * ต่อการ login ไม่กระทบ admin คนอื่น"*
 *
 * สองประโยคนี้ขัดกันถ้าอยู่บนแกนเดียว เทสนี้จึงตรึง "ทางออก" ไว้:
 *   · ล็อกอิน **ถูก** ไม่กินโควตาแกนนี้เลย  → ออฟฟิศไม่ชนกันเอง
 *   · ล็อกอิน **ผิด** กินทุกครั้งไม่ว่าใช้ชื่ออะไร → flood สุ่ม user โดนจับ
 */
describe('[FEAT-20260823-LOGINFAIL] login — แกนที่ 2 นับรหัสผิดต่อ IP', () => {
  describe('ค่า default', () => {
    it('เปิดอยู่ · 15 ครั้ง / 300 วินาที', () => {
      expect(
        envSchema.shape.RATE_LIMIT_LOGIN_FAIL_ENABLED.parse(undefined),
      ).toBe(true);
      expect(envSchema.shape.RATE_LIMIT_LOGIN_FAIL_MAX.parse(undefined)).toBe(
        15,
      );
      expect(
        envSchema.shape.RATE_LIMIT_LOGIN_FAIL_WINDOW_SECONDS.parse(undefined),
      ).toBe(300);
    });

    it('อิสระจากอีก 2 แกน — แกนดิบ 30/60 · แกนบัญชี 5/300', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_MAX.parse(undefined)).toBe(30);
      expect(envSchema.shape.RATE_LIMIT_LOGIN_USER_MAX.parse(undefined)).toBe(
        5,
      );
    });

    it('ปิดได้ / ตั้งเลขเองได้', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_FAIL_ENABLED.parse('false')).toBe(
        false,
      );
      expect(envSchema.shape.RATE_LIMIT_LOGIN_FAIL_MAX.parse('40')).toBe(40);
    });
  });

  describe('พฤติกรรมผ่าน AuthController', () => {
    const redisStub = { incrementWithTtl: jest.fn(), getCount: jest.fn() };

    const build = async (over: Record<string, unknown> = {}) => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          RateLimitService,
          { provide: RedisService, useValue: redisStub },
          {
            provide: rateLimitConfig.KEY,
            useValue: {
              globalEnabled: false,
              globalMax: 300,
              globalWindowSeconds: 300,
              defaultMax: 2,
              defaultWindowSeconds: 30,
              loginMax: 30,
              loginWindowSeconds: 60,
              keyMax: 3,
              keyWindowSeconds: 60,
              loginFailEnabled: true,
              loginFailMax: 15,
              loginFailWindowSeconds: 300,
              // แกนบัญชีปิดไว้ เพื่อดูแกนนี้ล้วน ๆ
              loginUserEnabled: false,
              loginUserMax: 5,
              loginUserWindowSeconds: 300,
              ...over,
            },
          },
          { provide: realtimeConfig.KEY, useValue: { wsEnv: 'test' } },
        ],
      }).compile();

      const rateLimit = moduleRef.get(RateLimitService);
      const authService = { login: jest.fn() };
      const controller = new AuthController(
        authService as unknown as AuthService,
        rateLimit,
        {} as WsTicketService,
        { domain: undefined, secure: false, sameSite: 'lax' as const },
      );
      return { controller, authService };
    };

    const req = { headers: {}, ip: '203.0.113.7' } as unknown as Request;
    const res = { set: jest.fn(), cookie: jest.fn() } as unknown as Response;
    const failKey = 'ratelimit:test:login_fail:203.0.113.7';

    beforeEach(() => {
      redisStub.incrementWithTtl.mockReset();
      redisStub.getCount.mockReset();
      redisStub.incrementWithTtl.mockResolvedValue(1);
      redisStub.getCount.mockResolvedValue(0);
    });

    it('⭐ ออฟฟิศ: ล็อกอิน **ถูก** ไม่กินโควตาแกนนี้เลย', async () => {
      const { controller, authService } = await build();
      authService.login.mockResolvedValue({ token: 't', expiresAt: null });

      // สี่คนในออฟฟิศเดียวกัน ล็อกอินถูกทุกคน
      for (const u of ['somchai', 'somying', 'anan', 'nid']) {
        await controller.login({ username: u, password: 'ok' }, req, res);
      }

      expect(
        redisStub.incrementWithTtl.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('login_fail'),
        ),
      ).toHaveLength(0);
    });

    it('รหัสผิด → นับด้วยคีย์ของ IP และหน้าต่าง 300 วิ', async () => {
      const { controller, authService } = await build();
      authService.login.mockRejectedValueOnce(new UnauthorizedException('x'));

      await expect(
        controller.login({ username: 'somchai', password: 'no' }, req, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(failKey, 300);
    });

    it('⭐ flood สุ่ม user: ชื่อคนละชื่อทุกครั้ง ก็ยังนับถังเดียวกัน', async () => {
      const { controller, authService } = await build();
      authService.login.mockRejectedValue(new UnauthorizedException('x'));

      for (const u of ['aaa', 'bbb', 'ccc']) {
        await controller
          .login({ username: u, password: 'no' }, req, res)
          .catch(() => undefined);
      }

      const failCalls = redisStub.incrementWithTtl.mock.calls.filter(
        (c: unknown[]) => String(c[0]) === failKey,
      );
      expect(failCalls).toHaveLength(3);
    });

    it('ครบ 15 แล้ว → 429 และไม่เรียก authService (ไม่เสีย PBKDF2)', async () => {
      const { controller, authService } = await build();
      redisStub.getCount.mockResolvedValue(15);

      await expect(
        controller.login({ username: 'somchai', password: 'x' }, req, res),
      ).rejects.toMatchObject({
        status: 429,
        response: 'rate limit exceeded',
      });
      expect(authService.login).not.toHaveBeenCalled();
    });

    it('ยังไม่ถึง 15 → ผ่าน', async () => {
      const { controller, authService } = await build();
      redisStub.getCount.mockResolvedValue(14);
      authService.login.mockResolvedValue({ token: 't', expiresAt: null });

      await controller.login({ username: 'somchai', password: 'ok' }, req, res);

      expect(authService.login).toHaveBeenCalled();
    });

    it('Redis ล่ม → ไม่บล็อก (fail-open)', async () => {
      const { controller, authService } = await build();
      redisStub.getCount.mockResolvedValue(null);
      authService.login.mockResolvedValue({ token: 't', expiresAt: null });

      await controller.login({ username: 'somchai', password: 'ok' }, req, res);

      expect(authService.login).toHaveBeenCalled();
    });

    it('error อื่น (Mongo ล่ม) → ไม่กินโควตา', async () => {
      const { controller, authService } = await build();
      authService.login.mockRejectedValueOnce(new Error('mongo down'));

      await expect(
        controller.login({ username: 'somchai', password: 'x' }, req, res),
      ).rejects.toThrow('mongo down');

      expect(
        redisStub.incrementWithTtl.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('login_fail'),
        ),
      ).toHaveLength(0);
    });

    it('⭐ ปิดแกนนี้ → ไม่แตะ Redis เพิ่มเลย (seamless)', async () => {
      const { controller, authService } = await build({
        loginFailEnabled: false,
      });
      authService.login.mockRejectedValueOnce(new UnauthorizedException('x'));

      await expect(
        controller.login({ username: 'somchai', password: 'x' }, req, res),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(redisStub.getCount).not.toHaveBeenCalled();
      expect(redisStub.incrementWithTtl).toHaveBeenCalledTimes(1);
      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:login:203.0.113.7',
        60,
      );
    });
  });
});
