import {
  RL_COUNT_CEILING,
  RL_WINDOW_CEILING,
  envSchema,
} from '@/config/env.schema';

/**
 * [FEAT-20260823-ENVCEIL] เพดานบนของค่า rate limit
 *
 * เจ้าของสั่ง 23/08/2026 หลังพบว่าค่าพวกนี้ "พังเงียบ" ได้ — ตั้ง 0 แอปไม่บูต
 * (ฟ้องทันที) แต่ตั้ง 30000 แอปเปิดปกติทั้งที่ตัวจำกัดตายสนิท
 *
 * เทสนี้ตรึง 3 อย่าง:
 *   1. **ค่าที่ใช้จริงทุกวันนี้ยังผ่านหมด** — เพดานต้องไม่กระทบใครเลย (seamless)
 *   2. เกินเพดาน = โยน ⇒ แอปไม่บูต แทนที่จะขึ้นมาแบบไม่มีการป้องกัน
 *   3. เพดานอยู่ที่ค่าคงที่ตัวเดียว แก้ทีเดียวมีผลทุกตัวแปร
 */
describe('[FEAT-20260823-ENVCEIL] เพดานบนของค่า rate limit', () => {
  /** ทุกตัวที่นับ "จำนวนครั้ง" */
  const COUNT_KEYS = [
    'RATE_LIMIT_GLOBAL_MAX',
    'RATE_LIMIT_MAX',
    'RATE_LIMIT_LOGIN_MAX',
    'RATE_LIMIT_LOGIN_FAIL_MAX',
    'RATE_LIMIT_LOGIN_USER_MAX',
    'RATE_LIMIT_KEY_MAX',
  ] as const;

  /** ทุกตัวที่เป็น "เวลา" */
  const WINDOW_KEYS = [
    'RATE_LIMIT_GLOBAL_WINDOW_SECONDS',
    'RATE_LIMIT_WINDOW_SECONDS',
    'RATE_LIMIT_LOGIN_WINDOW_SECONDS',
    'RATE_LIMIT_LOGIN_FAIL_WINDOW_SECONDS',
    'RATE_LIMIT_LOGIN_USER_WINDOW_SECONDS',
  ] as const;

  const shapeMap = envSchema.shape as unknown as Record<
    string,
    { parse: (v: unknown) => unknown } | undefined
  >;
  /** ดึง schema ของคีย์ — โยนทันทีถ้าคีย์หาย เพื่อไม่ให้เทสผ่านแบบเงียบ ๆ */
  const shape = (k: string): { parse: (v: unknown) => unknown } => {
    const z = shapeMap[k];
    if (!z) throw new Error(`env key not found in schema: ${k}`);
    return z;
  };

  describe('⭐ seamless — ค่าที่ใช้จริงต้องไม่กระทบเลย', () => {
    it('ทุกตัวยัง parse ค่า default ของตัวเองได้ (ไม่ตั้ง env)', () => {
      for (const k of [...COUNT_KEYS, ...WINDOW_KEYS]) {
        expect(() => shape(k).parse(undefined)).not.toThrow();
      }
    });

    it('ค่าใช้จริงสูงสุดวันนี้ (MAX=30 · WINDOW=300) ยังห่างเพดานมาก', () => {
      expect(RL_COUNT_CEILING).toBeGreaterThanOrEqual(30 * 10);
      expect(RL_WINDOW_CEILING).toBeGreaterThanOrEqual(300 * 10);
    });

    it('ค่าที่คนน่าจะปรับจูนจริง (1-100 ครั้ง · 1-600 วิ) ผ่านหมด', () => {
      for (const k of COUNT_KEYS)
        for (const v of ['1', '3', '15', '30', '100'])
          expect(() => shape(k).parse(v)).not.toThrow();

      for (const k of WINDOW_KEYS)
        for (const v of ['1', '30', '60', '300', '600'])
          expect(() => shape(k).parse(v)).not.toThrow();
    });
  });

  describe('เพดานทำงานจริง — พังดัง ไม่พังเงียบ', () => {
    it('ตั้งพอดีเพดาน → ผ่าน', () => {
      for (const k of COUNT_KEYS)
        expect(shape(k).parse(String(RL_COUNT_CEILING))).toBe(RL_COUNT_CEILING);

      for (const k of WINDOW_KEYS)
        expect(shape(k).parse(String(RL_WINDOW_CEILING))).toBe(
          RL_WINDOW_CEILING,
        );
    });

    it('เกินเพดาน 1 → โยน (แอปไม่บูต)', () => {
      for (const k of COUNT_KEYS)
        expect(() => shape(k).parse(String(RL_COUNT_CEILING + 1))).toThrow();

      for (const k of WINDOW_KEYS)
        expect(() => shape(k).parse(String(RL_WINDOW_CEILING + 1))).toThrow();
    });

    it('⭐ เคสจริงที่กลัว — พิมพ์เกินหลักเป็น 30000 → โยน', () => {
      expect(() => shape('RATE_LIMIT_MAX').parse('30000')).toThrow();
      expect(() => shape('RATE_LIMIT_LOGIN_MAX').parse('30000')).toThrow();
    });

    it('⭐ เคสจริงที่กลัว — ตั้งเวลาเป็นทั้งวัน (86400) → โยน', () => {
      expect(() => shape('RATE_LIMIT_WINDOW_SECONDS').parse('86400')).toThrow();
    });
  });

  describe('ค่าต่ำสุดยังทำงานเหมือนเดิม (ไม่ได้ไปแตะ)', () => {
    it('0 และติดลบ ยังโยนเหมือนเดิม', () => {
      for (const k of [...COUNT_KEYS, ...WINDOW_KEYS]) {
        expect(() => shape(k).parse('0')).toThrow();
        expect(() => shape(k).parse('-1')).toThrow();
      }
    });
  });

  describe('แก้ในอนาคตง่าย — เพดานอยู่ที่เดียว', () => {
    it('ทุกตัวที่นับจำนวนใช้เพดานตัวเดียวกัน', () => {
      for (const k of COUNT_KEYS) {
        expect(shape(k).parse(String(RL_COUNT_CEILING))).toBe(RL_COUNT_CEILING);
        expect(() => shape(k).parse(String(RL_COUNT_CEILING + 1))).toThrow();
      }
    });

    it('ทุกตัวที่เป็นเวลาใช้เพดานตัวเดียวกัน', () => {
      for (const k of WINDOW_KEYS) {
        expect(shape(k).parse(String(RL_WINDOW_CEILING))).toBe(
          RL_WINDOW_CEILING,
        );
        expect(() => shape(k).parse(String(RL_WINDOW_CEILING + 1))).toThrow();
      }
    });
  });
});
