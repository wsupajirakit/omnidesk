import { Test } from '@nestjs/testing';

import { rateLimitConfig, realtimeConfig } from '@/config/app.config';
import { envSchema } from '@/config/env.schema';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { RedisService } from '@/infra/redis/redis.service';

/**
 * [FEAT-20260823-LOGINRL] เจ้าของสั่ง 23/08/2026: "login limit default 3 ถ้าไม่ตั้ง env"
 *
 * เทสนี้ตรึงตัวเลขนโยบาย ไม่ใช่ตรึงกลไก (กลไกอยู่ที่ `rate-limit.spec.ts`).
 * ใครเปลี่ยน 3 กลับเป็น 6/10 โดยไม่ได้ตัดสินใจใหม่ ต้องเห็นเทสนี้แดงก่อน.
 *
 * ครอบ 2 ชั้น:
 *   1) ค่า DEFAULT ตอนไม่ตั้ง env เลย  → 3 ครั้ง / 60 วินาที
 *   2) พฤติกรรมจริง                    → ครั้งที่ 3 ผ่าน · ครั้งที่ 4 โดน 429
 *
 * ⚠️ ไม่ได้พิสูจน์ว่า prod ใช้ 3 — env ของ prod ที่ตั้งไว้เองชนะ default เสมอ.
 *    ดูหมายเหตุที่ `env.schema.ts` (บล็อก rate limiting).
 */
describe('[FEAT-20260823-LOGINRL] login rate limit — แกนดิบ default 30 / 60s', () => {
  describe('ค่า default เมื่อไม่ได้ตั้ง env', () => {
    /* 23/08 รอบสอง: เลขนี้ย้ายแกนแล้ว. เดิม 3 = "เดารหัสได้ 3 ครั้ง" ซึ่งผิดแกน
       เพราะมันนับ **ทุก** request ⇒ ออฟฟิศ IP เดียวชนกันเอง. ตอนนี้แกนนี้เหลือ
       หน้าที่เดียวคือ "เพดานดิบ" จึงเป็น 30 และงานกันเดารหัสย้ายไปสองแกนที่นับ
       เฉพาะรหัสผิด (LOGIN_FAIL ต่อ IP · LOGIN_USER ต่อบัญชี). */
    it('RATE_LIMIT_LOGIN_MAX = 30 (เพดานดิบ ไม่ใช่แกนกันเดารหัส)', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_MAX.parse(undefined)).toBe(30);
    });

    it('RATE_LIMIT_LOGIN_WINDOW_SECONDS = 60', () => {
      expect(
        envSchema.shape.RATE_LIMIT_LOGIN_WINDOW_SECONDS.parse(undefined),
      ).toBe(60);
    });

    it('env ที่ตั้งไว้เองยังชนะ default (ปรับที่แผงดีพลอยได้โดยไม่ต้องแก้โค้ด)', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_MAX.parse('7')).toBe(7);
    });
  });

  describe('พฤติกรรมที่ตัวเลขนี้ให้ผล', () => {
    const redisStub = { incrementWithTtl: jest.fn() };

    const build = async () => {
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
              // ค่าจาก env.schema.ts จริง ไม่ใช่เลขสมมติ
              loginMax: envSchema.shape.RATE_LIMIT_LOGIN_MAX.parse(undefined),
              loginWindowSeconds:
                envSchema.shape.RATE_LIMIT_LOGIN_WINDOW_SECONDS.parse(
                  undefined,
                ),
              keyMax: 3,
              keyWindowSeconds: 60,
            },
          },
          { provide: realtimeConfig.KEY, useValue: { wsEnv: 'test' } },
        ],
      }).compile();

      return moduleRef.get(RateLimitService);
    };

    beforeEach(() => redisStub.incrementWithTtl.mockReset());

    it('ครั้งที่ 30 ยังผ่าน', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(30);

      await expect(
        service.consume('login', '203.0.113.9'),
      ).resolves.toMatchObject({
        limited: false,
        current: 30,
        limit: 30,
        windowSeconds: 60,
      });
    });

    it('ครั้งที่ 31 โดนบล็อก', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(31);

      await expect(
        service.consume('login', '203.0.113.9'),
      ).resolves.toMatchObject({ limited: true, current: 31, limit: 30 });
    });

    it('นาฬิกาที่ส่งให้ Redis คือ 60 วินาที (หน้าต่างเดียว ไม่ต่ออายุ)', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(1);

      await service.consume('login', '203.0.113.9');

      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:login:203.0.113.9',
        60,
      );
    });

    it('Redis ล่ม = ปล่อยผ่าน ไม่ล็อกคนออกจากระบบ', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(null);

      await expect(
        service.consume('login', '203.0.113.9'),
      ).resolves.toMatchObject({ limited: false, current: null });
    });
  });
});
