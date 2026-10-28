/**
 * [TEST-20260819-HEALTHREADY] `/health/ready` — Mongo ล้ม = ถอนตัวออกจาก LB · Redis ล้ม = ยืนต่อ
 *
 * ## ทำไมต้องมี
 * `HealthService.check()` เป็นตัวตัดสินว่า instance นี้ยังรับ traffic ได้ไหม และมันถือกฎ
 * **ไม่สมมาตร** ที่ตั้งใจไว้ (health.service.ts:27-51):
 *   - Mongo down ⇒ โยน `ServiceUnavailableException` ⇒ 503 ⇒ platform ตัด traffic ทิ้ง
 *   - Redis down ⇒ **รายงานว่า down แต่ยังตอบ 200 `status: 'ok'`** เพราะ cache/rate-limit
 *     fail open อยู่แล้ว (redis.service.ts:19-23) ⇒ Redis สะดุดต้องไม่ลาก API ลงทั้งตัว
 *
 * ถ้าใครทำครึ่งหลังหายไป (เช่นเผลอโยนตอน Redis down ด้วย เพื่อ "ให้ probe เข้มขึ้น")
 * Redis กระตุกครั้งเดียว = ทุก instance ตอบ 503 พร้อมกัน = ล่มทั้งระบบ
 * และ **ไม่มีอะไรจับได้** — ดู BACKTEST
 *
 * ## BACKTEST (19/08) — ยืนยันว่าไม่ซ้ำของเดิม
 * `HealthService` / `HealthController` ไม่ถูกแตะใน lane `unit` และ `golden` เลย
 * ที่มีอยู่คือ:
 *   - `z-test/e2e/health.e2e-spec.ts` → "GET /health/ready reports dependency status"
 *     ยิงเฉพาะเคส mongo+redis **up** และอยู่ใน lane e2e ที่ห้ามรัน ⇒ กฎ down ไม่เคยถูกวิ่ง
 *   - `z-test/unit/proxy-gate.spec.ts` → '/health', '/health/ready' เป็นแค่ **แถวในตาราง path**
 *     ของ `isPublicPath` ไม่ได้เรียก service
 *   - `ServiceUnavailable` · `degraded` · `readyState` · `PONG` : grep ทั้ง `z-test/` = 0 hit
 *
 * ## ขอบเขต
 * test-only · สร้าง `HealthService` ตรง ๆ ด้วย fake สองตัว ⇒ ไม่มี I/O ไม่มี env ไม่มี DB
 * `health.service.ts` อยู่ **นอก** closure ของ webhook/ticket/payment/chat (คำนวณ 19/08)
 *
 * revert: delete this file. ไม่มีไฟล์ production ถูกแตะ
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { ConnectionStates, type Connection } from 'mongoose';

import type { RedisService } from '@/infra/redis/redis.service';
import { HealthService } from '@/modules/health/health.service';

/** Mongo ที่ตอบ ping ปกติ — สถานะ `connected` และ admin().ping() สำเร็จ */
const mongoUp = (): Connection =>
  ({
    readyState: Number(ConnectionStates.connected),
    db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) },
  }) as unknown as Connection;

/** Mongo ที่หลุด — `checkMongo` คืน down ตั้งแต่เช็ค readyState ยังไม่ทัน ping */
const mongoDown = (): Connection =>
  ({
    readyState: Number(ConnectionStates.disconnected),
  }) as unknown as Connection;

/** Redis ที่ล้ม — ping โยน error เหมือนตอน connect ไม่ติด */
const redisDown = (): RedisService =>
  ({
    getClient: () => ({
      ping: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    }),
  }) as unknown as RedisService;

describe('[HEALTHREADY] /health/ready — ความไม่สมมาตรของ dependency', () => {
  it('⭐ Redis ล้ม = ยัง ok (fail open) · Mongo ล้ม = 503', async () => {
    // Redis ล้มอย่างเดียว: ต้อง "ไม่โยน" และต้องยังบอกว่า ok
    const report = await new HealthService(mongoUp(), redisDown()).check();

    expect(report.status).toBe('ok');
    expect(report.dependencies.mongo.status).toBe('up');
    expect(report.dependencies.redis.status).toBe('down');
    // detail ต้องพารายละเอียดจริงมาด้วย ไม่ใช่ down เปล่า ๆ
    expect(report.dependencies.redis.detail).toContain('ECONNREFUSED');

    // อีกฝั่งของกฎ: Mongo ล้มต้องโยน เพื่อให้ platform ตัด traffic
    await expect(
      new HealthService(mongoDown(), redisDown()).check(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
