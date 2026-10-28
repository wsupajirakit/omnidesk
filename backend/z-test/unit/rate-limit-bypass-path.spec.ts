/**
 * [FIX-20260818-BYPASSANCHOR] อะไรบ้างที่ "หลุด" การนับ rate limit
 *
 * ## ทำไมต้องมี
 * `isBypassPath` มีไว้ให้ LINE ยิง webhook ได้ไม่จำกัด — LINE เจอ 429 ไม่ได้เด็ดขาด
 * แต่ regex เดิม `/(^|\/)webhook(\/|$)/` ไม่ anchor ⇒ อะไรก็ตามที่มีคำว่า webhook
 * คั่นด้วย `/` ตรงไหนก็หลุดหมด รวมถึง API ของ dashboard เอง (`/webhook/logs`)
 * และ endpoint ที่ไม่ต้อง auth (`/api/telegram/webhook`)
 * เช่นเดียวกับ clause ที่สอง `startsWith('/api/handoff/callback')` ที่กินเลยไปถึง
 * กล่องขาเข้าของ dashboard (`/api/handoff/callbackS`) ไม่ใช่แค่ callback ของจริง
 *
 * ตัวที่เขียนถูกอยู่แล้วคือ `proxy-gate.middleware.ts` — งานนี้คือทำให้สองไฟล์นี้
 * "เห็นตรงกัน" ว่าเส้นไหนคือ webhook ของ LINE จริง ๆ
 *
 * ## ทำไมแก้ตอนนี้ปลอดภัยที่สุด
 * `buildGlobalRateLimitMiddleware` เช็ค `isGlobalEnabled()` **ก่อน** `isBypassPath()`
 * (middleware :55-62) และ flag ปิดอยู่ ⇒ วันนี้ `isBypassPath` ไม่เคยถูกเรียกที่
 * runtime เลย ⇒ การแก้ regex เป็น no-op สนิท และต้องทำ **ก่อน** เปิด limiter
 *
 * BEFORE (พฤติกรรมเดิมที่รั่ว) เคสในตาราง `LEAKY` เขียวบนโค้ดเดิม
 * AFTER  แถว LINE ยัง bypass เหมือนเดิม · แถวที่รั่วพลิกเป็นถูกนับ
 */
import {
  isBypassPath,
  buildGlobalRateLimitMiddleware,
} from '@/infra/rate-limit/global-rate-limit.middleware';
import { isPublicPath } from '@/infra/proxy-gate/proxy-gate.middleware';

/** เส้นของ LINE จริง — ห้ามถูกนับเด็ดขาด ไม่ว่าจะแก้อะไร */
const LINE_WEBHOOK = [
  '/webhook',
  '/webhook/',
  '/demo-oa-three/webhook',
  '/abc/webhook/',
];

/** เส้นที่เคยหลุดทั้งที่ไม่ใช่ของ LINE — ต้องถูกนับหลังแก้ */
const MUST_BE_COUNTED = [
  '/webhook/logs',
  '/api/telegram/webhook',
  '/api/webhook/anything',
  '/x/webhook/y',
  '/api/handoff/callbacks',
  '/api/handoff/callbacks/123/attach',
];

/** callback ขาเข้าจากปลายทางภายนอก — ยังต้อง bypass */
const REAL_CALLBACK = ['/api/handoff/callback/pay_topup'];

describe('[BYPASSANCHOR] isBypassPath ต้องตรงกับ proxy-gate', () => {
  it.each(LINE_WEBHOOK)('⭐ %s = เส้นของ LINE → ยัง bypass', (path) => {
    expect(isBypassPath(path)).toBe(true);
  });

  it.each(MUST_BE_COUNTED)('⭐ %s ไม่ใช่ของ LINE → ต้องถูกนับ', (path) => {
    expect(isBypassPath(path)).toBe(false);
  });

  it.each(REAL_CALLBACK)('%s = callback ขาเข้าจริง → bypass', (path) => {
    expect(isBypassPath(path)).toBe(true);
  });

  /**
   * ตัวตรึงที่สำคัญที่สุด: สองไฟล์นี้ต้องตอบเหมือนกันเรื่อง "อะไรคือ webhook ของ LINE"
   * ถ้าวันหน้าใครแก้ไฟล์เดียว เทสนี้จะจับได้ทันที
   */
  it('⭐ ตัดสินเรื่องเส้น webhook ตรงกับ proxy-gate ทุกเส้นในตาราง', () => {
    for (const path of [...LINE_WEBHOOK, ...MUST_BE_COUNTED]) {
      const isLineWebhook = /^\/(?:[^/]+\/)?webhook\/?$/.test(path);
      expect(isBypassPath(path)).toBe(
        isLineWebhook || path.startsWith('/api/handoff/callback/'),
      );
      if (isLineWebhook) expect(isPublicPath(path)).toBe(true);
    }
  });
});

describe('[BYPASSANCHOR] flag ปิดอยู่ ⇒ การแก้นี้เป็น no-op ที่ runtime', () => {
  it('ไม่เรียก isBypassPath เลยเมื่อ global limiter ปิด', () => {
    const calls: string[] = [];
    const fake = {
      isGlobalEnabled: () => false,
      resolveClientIp: () => {
        calls.push('resolveClientIp');
        return '1.2.3.4';
      },
    } as unknown as Parameters<typeof buildGlobalRateLimitMiddleware>[0];

    const mw = buildGlobalRateLimitMiddleware(fake);
    let nexted = 0;
    mw(
      { path: '/webhook/logs' } as never,
      { status: () => ({ json: () => undefined }) } as never,
      (() => {
        nexted += 1;
      }) as never,
    );
    // ผ่านไปเฉย ๆ โดยไม่แตะ ip resolver ⇒ พิสูจน์ว่าเส้นทางลัดออกก่อนถึง bypass check
    expect(nexted).toBe(1);
    expect(calls).toEqual([]);
  });
});
