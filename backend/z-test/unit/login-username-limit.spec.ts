import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { rateLimitConfig, realtimeConfig } from '@/config/app.config';
import { envSchema } from '@/config/env.schema';
import {
  LOGIN_USER_KEY_MAX_LEN,
  normalizeLoginUsername,
} from '@/infra/rate-limit/login-user-key';
import { RateLimitService } from '@/infra/rate-limit/rate-limit.service';
import { RedisService } from '@/infra/redis/redis.service';
import type { AuthService, WsTicketService } from '@/modules/auth';
/* controller ไม่ได้อยู่ใน barrel และไม่ควรอยู่ — ไม่มีใครนอกโมดูลควรนำเข้ามัน
   ยกเว้นเทสที่ต้องสร้าง instance เพื่อดูลำดับของสองชั้น. ผ่อนเฉพาะบรรทัดนี้
   ดีกว่าไปเปิดหน้าบ้านของโมดูลให้กว้างขึ้นเพราะเทสไฟล์เดียว. */
// eslint-disable-next-line no-restricted-imports
import { AuthController } from '@/modules/auth/auth.controller';

/**
 * [FEAT-20260823-LOGINUSER] ชั้นที่ 2 ของ login — นับต่อชื่อผู้ใช้
 * เจ้าของสั่ง 23/08/2026: *"เพิ่มชั้น username ด้วย ตัวเลขแยกอิสระตั้งได้
 * หรือ เลือกไม่ใช่ก็ได้ ทุกอย่างหยืดหยุ่น"*
 *
 * เทสนี้ตรึง 3 อย่าง:
 *   1. ปิดแล้วต้อง **ไม่แตะ Redis เลย** (พิสูจน์ว่า seamless จริง ไม่ใช่แค่บอก)
 *   2. นับเฉพาะ "รหัสผิด" — ล็อกอินถูก และ error อื่น ต้องไม่กินโควตา
 *   3. ตัวเลขอิสระจากชั้น IP และตั้งทับด้วย env ได้
 *
 * ⚠️ ขอบเขต: นี่คือเทสระดับ controller (สร้าง instance ตรง ๆ) ไม่ได้ยิง HTTP จริง
 *    ผ่าน ValidationPipe/guard. ส่วนที่พิสูจน์คือ "ลำดับและเงื่อนไขของสองชั้น"
 *    ไม่ใช่ "เส้นทาง HTTP ครบวง".
 */
describe('[FEAT-20260823-LOGINUSER] login — ชั้นที่ 2 นับต่อ username', () => {
  describe('normalizeLoginUsername — ต้องตรงกับ auth.service.ts:69', () => {
    it('trim + toLowerCase เหมือนตอนหา user จริง', () => {
      expect(normalizeLoginUsername('  Admin  ')).toBe('admin');
      expect(normalizeLoginUsername('ADMIN')).toBe(
        normalizeLoginUsername('admin'),
      );
    });

    it('ช่องว่างกลางชื่อกลายเป็น _ (คีย์ Redis ห้ามมีช่องว่าง)', () => {
      expect(normalizeLoginUsername('some user')).toBe('some_user');
      expect(normalizeLoginUsername('a\nb')).toBe('a_b');
    });

    it('ตัดความยาวที่ 64 กันคนยัดชื่อยาวถล่ม Redis', () => {
      expect(normalizeLoginUsername('x'.repeat(500))).toHaveLength(
        LOGIN_USER_KEY_MAX_LEN,
      );
    });

    it("ไม่มีชื่อ / ไม่ใช่ string → '' (ข้ามชั้นนี้)", () => {
      expect(normalizeLoginUsername('   ')).toBe('');
      expect(normalizeLoginUsername(undefined)).toBe('');
      expect(normalizeLoginUsername(123)).toBe('');
      expect(normalizeLoginUsername({ toString: () => 'x' })).toBe('');
    });
  });

  describe('ค่า default เมื่อไม่ตั้ง env', () => {
    it('เปิดอยู่', () => {
      expect(
        envSchema.shape.RATE_LIMIT_LOGIN_USER_ENABLED.parse(undefined),
      ).toBe(true);
    });

    it('5 ครั้ง / 300 วินาที — อิสระจากแกนดิบ (30 / 60)', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_USER_MAX.parse(undefined)).toBe(
        5,
      );
      expect(
        envSchema.shape.RATE_LIMIT_LOGIN_USER_WINDOW_SECONDS.parse(undefined),
      ).toBe(300);
      expect(envSchema.shape.RATE_LIMIT_LOGIN_MAX.parse(undefined)).toBe(30);
    });

    it('ปิดได้ด้วย env', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_USER_ENABLED.parse('false')).toBe(
        false,
      );
    });

    it('ตั้งตัวเลขเองได้ ไม่ต้องแก้โค้ด', () => {
      expect(envSchema.shape.RATE_LIMIT_LOGIN_USER_MAX.parse('9')).toBe(9);
    });
  });

  describe('RateLimitService — ดูกับนับแยกกัน', () => {
    const redisStub = {
      incrementWithTtl: jest.fn(),
      getCount: jest.fn(),
    };

    const build = async (enabled = true) => {
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
              loginFailEnabled: false,
              loginFailMax: 15,
              loginFailWindowSeconds: 300,
              keyMax: 3,
              keyWindowSeconds: 60,
              loginUserEnabled: enabled,
              loginUserMax: 5,
              loginUserWindowSeconds: 300,
            },
          },
          { provide: realtimeConfig.KEY, useValue: { wsEnv: 'test' } },
        ],
      }).compile();

      return moduleRef.get(RateLimitService);
    };

    beforeEach(() => {
      redisStub.incrementWithTtl.mockReset();
      redisStub.getCount.mockReset();
    });

    it('ยังไม่ถึงโควตา → ไม่บล็อก และ "ดู" ไม่ทำให้ตัวนับเพิ่ม', async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(4);

      await expect(service.isLoginUserBlocked('admin')).resolves.toBe(false);
      expect(redisStub.incrementWithTtl).not.toHaveBeenCalled();
    });

    it('ครบ 5 แล้ว → บล็อก', async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(5);

      await expect(service.isLoginUserBlocked('admin')).resolves.toBe(true);
    });

    it('Redis ล่ม → ไม่บล็อก (fail-open)', async () => {
      const service = await build();
      redisStub.getCount.mockResolvedValueOnce(null);

      await expect(service.isLoginUserBlocked('admin')).resolves.toBe(false);
    });

    it('ชื่อว่าง → ไม่ถาม Redis เลย', async () => {
      const service = await build();

      await expect(service.isLoginUserBlocked('')).resolves.toBe(false);
      expect(redisStub.getCount).not.toHaveBeenCalled();
    });

    it('นับด้วยคีย์และหน้าต่างของตัวเอง แยกจาก bucket login', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockResolvedValueOnce(1);

      await service.chargeLoginUserFailure('admin');

      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:login_user:admin',
        300,
      );
    });

    it('Redis โยน error ตอนนับ → กลืน ไม่ทำให้ login พัง', async () => {
      const service = await build();
      redisStub.incrementWithTtl.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.chargeLoginUserFailure('admin'),
      ).resolves.toBeUndefined();
    });

    it('ปิดชั้นนี้ → isLoginUserEnabled เป็น false', async () => {
      const service = await build(false);

      expect(service.isLoginUserEnabled()).toBe(false);
    });
  });

  describe('AuthController — สองชั้นทำงานตามลำดับ', () => {
    const redisStub = {
      incrementWithTtl: jest.fn(),
      getCount: jest.fn(),
    };

    const buildController = async (loginUserEnabled = true) => {
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
              loginFailEnabled: false,
              loginFailMax: 15,
              loginFailWindowSeconds: 300,
              keyMax: 3,
              keyWindowSeconds: 60,
              loginUserEnabled,
              loginUserMax: 5,
              loginUserWindowSeconds: 300,
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

      return { controller, authService, rateLimit };
    };

    const req = { headers: {}, ip: '203.0.113.4' } as unknown as Request;
    const res = { set: jest.fn(), cookie: jest.fn() } as unknown as Response;
    const dto = { username: 'Admin', password: 'wrong' };

    beforeEach(() => {
      redisStub.incrementWithTtl.mockReset();
      redisStub.getCount.mockReset();
      // ชั้น IP: ผ่านเสมอในเทสชุดนี้ เพื่อแยกดูเฉพาะชั้น username
      redisStub.incrementWithTtl.mockResolvedValue(1);
      redisStub.getCount.mockResolvedValue(0);
    });

    it('บัญชีเกินโควตา → 429 และ **ไม่เรียก authService เลย** (ไม่เสีย CPU กับ PBKDF2)', async () => {
      const { controller, authService } = await buildController();
      redisStub.getCount.mockResolvedValue(5);

      await expect(controller.login(dto, req, res)).rejects.toMatchObject({
        status: 429,
        response: 'rate limit exceeded',
      });
      expect(authService.login).not.toHaveBeenCalled();
    });

    it('รหัสผิด → นับ 1 ครั้งด้วยคีย์ที่ normalize แล้ว และโยน error เดิมออกไป', async () => {
      const { controller, authService } = await buildController();
      authService.login.mockRejectedValueOnce(
        new UnauthorizedException('invalid username or password'),
      );

      await expect(controller.login(dto, req, res)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:login_user:admin',
        300,
      );
    });

    it('ล็อกอินถูก → ไม่กินโควตาบัญชีเลย', async () => {
      const { controller, authService } = await buildController();
      authService.login.mockResolvedValueOnce({
        token: 't',
        expiresAt: null,
      });

      await controller.login(dto, req, res);

      expect(
        redisStub.incrementWithTtl.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('login_user'),
        ),
      ).toHaveLength(0);
    });

    it('error อื่น (เช่น Mongo ล่ม) → ไม่กินโควตา และโยนของเดิม', async () => {
      const { controller, authService } = await buildController();
      authService.login.mockRejectedValueOnce(new Error('mongo down'));

      await expect(controller.login(dto, req, res)).rejects.toThrow(
        'mongo down',
      );
      expect(
        redisStub.incrementWithTtl.mock.calls.filter((c: unknown[]) =>
          String(c[0]).includes('login_user'),
        ),
      ).toHaveLength(0);
    });

    it('⭐ ปิดชั้นนี้ → ไม่มีการแตะ Redis เพิ่มแม้แต่ครั้งเดียว (seamless)', async () => {
      const { controller, authService } = await buildController(false);
      authService.login.mockRejectedValueOnce(
        new UnauthorizedException('invalid username or password'),
      );

      await expect(controller.login(dto, req, res)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );

      expect(redisStub.getCount).not.toHaveBeenCalled();
      // เหลือแค่ครั้งเดียวของชั้น IP เดิม ไม่มีของชั้น username
      expect(redisStub.incrementWithTtl).toHaveBeenCalledTimes(1);
      expect(redisStub.incrementWithTtl).toHaveBeenCalledWith(
        'ratelimit:test:login:203.0.113.4',
        60,
      );
    });
  });
});
