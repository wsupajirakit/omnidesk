/**
 * [FEAT-20260825-ATTIME] "ทำซ้ำ ตอนกี่โมง" — เลือกเวลาในวัน พอถึงเวลานั้นก็ยิง
 * ===========================================================================
 * เจ้าของ 25/08: *"ส่งซ้ำทุก ๆ ให้แก้เป็น ทำซ้ำ ตอนกี่โมง (เมื่อถึงเวลานี้) ให้ทำ"* ·
 * *"เริ่มเวลา กับถึงเวลาไม่ต้องมี"* · *"หยุดซ้ำหลังวันที่ ไม่ต้องมีตัดทิ้ง"* ·
 * *"หยุดหลังครบกี่รอบ > คงไว้ แต่ถ้าไม่ใส่ = ทำไปเรื่อย ๆ"*
 *
 * 🔴 ทุกเคสรันซ้ำใต้ `TZ` หลายค่า — `at_time_min` เป็น "นาทีในวัน" ที่ต้องแปลเป็น
 *    instant ด้วย `tz_offset_min` เท่านั้น ถ้าโค้ดเผลอไปพึ่ง TZ ของ process
 *    เมื่อไหร่ เทสจะจับได้ทันที (เทสที่รันแต่บนเครื่องคนเขียนจะเขียวทั้งที่ผิด)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { computeNextRun } from '@/modules/content';

const REPEAT = { mode: 'repeat', enabled: true, tz_offset_min: 420 } as const;
const at = (iso: string) => new Date(iso);
const ZONES = ['Asia/Bangkok', 'UTC', 'America/New_York'];

const withTz = <T>(tz: string, fn: () => T): T => {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = before;
  }
};

describe('at_time_min — ยิงวันละครั้ง ตรงเวลาที่เลือก', () => {
  it('15:00 ไทย ⇒ เก็บ next_run_at เป็น 08:00Z', () => {
    const next = computeNextRun(
      { ...REPEAT, at_time_min: 900 },
      at('2026-08-25T00:00:00.000Z'),
      0,
    );
    expect(next?.toISOString()).toBe('2026-08-25T08:00:00.000Z');
  });

  it('🔴 คำตอบไม่ขึ้นกับ TZ ของ process', () => {
    const got = ZONES.map((tz) =>
      withTz(tz, () =>
        computeNextRun(
          { ...REPEAT, at_time_min: 900 },
          at('2026-08-25T00:00:00.000Z'),
          0,
        )?.toISOString(),
      ),
    );
    expect(new Set(got).size).toBe(1);
    expect(got[0]).toBe('2026-08-25T08:00:00.000Z');
  });

  it('เลยเวลาของวันนี้แล้ว ⇒ ไปวันพรุ่งนี้เวลาเดิม ไม่ใช่ยิงทันที', () => {
    /* 09:00Z = 16:00 ไทย ซึ่งเลย 15:00 ไปแล้ว */
    const next = computeNextRun(
      { ...REPEAT, at_time_min: 900 },
      at('2026-08-25T09:00:00.000Z'),
      0,
    );
    expect(next?.toISOString()).toBe('2026-08-26T08:00:00.000Z');
  });

  it('🔴 ยิงวันละครั้งเท่านั้น — รอบถัดไปห่างกัน 24 ชม. เป๊ะ', () => {
    /* กันการกลับไปเป็นกติกา "ทุก ๆ n นาที" โดยไม่ตั้งใจ */
    const first = computeNextRun(
      { ...REPEAT, at_time_min: 900 },
      at('2026-08-25T00:00:00.000Z'),
      0,
    )!;
    const second = computeNextRun({ ...REPEAT, at_time_min: 900 }, first, 1)!;
    expect(second.getTime() - first.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('เที่ยงคืน (0) ใช้ได้ และไม่ถูกอ่านเป็น "ไม่ได้ตั้ง"', () => {
    /* absent ≠ 0 — 0 คือเวลาจริง */
    const next = computeNextRun(
      { ...REPEAT, at_time_min: 0 },
      at('2026-08-25T00:00:00.000Z'),
      0,
    );
    expect(next?.toISOString()).toBe('2026-08-25T17:00:00.000Z');
  });

  it('23:59 (1439) ใช้ได้ — ขอบบนสุดของวัน', () => {
    const next = computeNextRun(
      { ...REPEAT, at_time_min: 1439 },
      at('2026-08-25T00:00:00.000Z'),
      0,
    );
    expect(next).not.toBeNull();
  });

  it('ค่านอกช่วง ⇒ ปฏิเสธ ไม่ใช่ปัดเข้าช่วง', () => {
    for (const bad of [-1, 1440, 99999, 'x', 1.5]) {
      expect(
        computeNextRun(
          { ...REPEAT, at_time_min: bad },
          at('2026-08-25T00:00:00.000Z'),
          0,
        ),
      ).toBeNull();
    }
  });

  /**
   * 🔴 เคสนี้เพิ่มเพราะ mutation M4 **รอด** ในรอบแรก
   *
   * เทสข้างบนส่ง `at_time_min` พังมาเฉย ๆ โดยไม่มีกติกาเก่าอยู่ในกฎ ⇒ ถอด
   * บรรทัดปฏิเสธออกก็ยังได้ `null` อยู่ดี (เพราะ `every_minutes` ก็ไม่มี)
   * ⇒ วัดอะไรไม่ได้เลย
   *
   * ของจริงที่อันตรายคือ **มีทั้งค่าพังและกติกาเก่า**: ถ้าไม่ปฏิเสธ มันจะเงียบ ๆ
   * ไปใช้ `every_minutes + window` แทน ⇒ แอดมินตั้ง "บ่ายสาม" แต่ระบบยิงทุกชั่วโมง
   * โดยไม่มี error สักตัว อ่านไม่ออก = ปฏิเสธ ห้ามตกไปใช้กติกาอื่นแทน.
   */
  it('🔴 ค่าพัง + มีกติกาเก่าอยู่ด้วย ⇒ ต้องปฏิเสธ ห้ามตกไปใช้กติกาเก่า', () => {
    const trap = {
      ...REPEAT,
      at_time_min: 'บ่ายสาม',
      every_minutes: 60,
      window_start_min: 540,
      window_end_min: 1080,
    } as never;
    expect(computeNextRun(trap, at('2026-08-25T00:00:00.000Z'), 0)).toBeNull();
  });

  it('เลือกวันในสัปดาห์ได้ — วันที่ไม่ได้เลือกต้องข้าม', () => {
    /* 2026-08-25 คืออังคาร (dow 2) · เลือกเฉพาะพฤหัส (4) */
    const next = computeNextRun(
      { ...REPEAT, at_time_min: 900, days_of_week: [4] },
      at('2026-08-25T00:00:00.000Z'),
      0,
    );
    expect(next?.toISOString()).toBe('2026-08-27T08:00:00.000Z');
  });

  it('max_runs ครบแล้วหยุด · ไม่ใส่ = ไปเรื่อย ๆ', () => {
    const rule = { ...REPEAT, at_time_min: 900, max_runs: 3 } as never;
    expect(
      computeNextRun(rule, at('2026-08-25T00:00:00.000Z'), 2),
    ).not.toBeNull();
    expect(computeNextRun(rule, at('2026-08-25T00:00:00.000Z'), 3)).toBeNull();
    /* ไม่ใส่ max_runs = ไม่มีเพดาน */
    expect(
      computeNextRun(
        { ...REPEAT, at_time_min: 900 },
        at('2026-08-25T00:00:00.000Z'),
        9999,
      ),
    ).not.toBeNull();
  });

  it('ไม่ต้องมี window / ends_at อีกต่อไป — ไม่ใส่ก็ทำงาน', () => {
    const next = computeNextRun(
      { ...REPEAT, at_time_min: 900 },
      at('2026-08-25T00:00:00.000Z'),
      0,
    );
    expect(next).not.toBeNull();
  });
});

describe('แถวเก่ายังต้องทำงาน — ห้าม migrate', () => {
  it('🔴 กติกาเดิม (every_minutes + window) ยังคำนวณได้เหมือนเดิม', () => {
    /* ถ้าลบตัวอ่านเก่าออก แถวที่เขียนก่อน 25/08 จะหยุดเงียบ ๆ */
    const legacy = {
      ...REPEAT,
      every_minutes: 60,
      window_start_min: 540,
      window_end_min: 1080,
    } as never;
    const next = computeNextRun(legacy, at('2026-08-25T00:00:00.000Z'), 0);
    /* 09:00 ไทย = 02:00Z */
    expect(next?.toISOString()).toBe('2026-08-25T02:00:00.000Z');
  });

  it('🔴 at_time_min ชนะกติกาเดิมเมื่อมีทั้งคู่ — ไม่ใช่ผสมกัน', () => {
    const both = {
      ...REPEAT,
      at_time_min: 900,
      every_minutes: 60,
      window_start_min: 540,
      window_end_min: 1080,
    } as never;
    expect(
      computeNextRun(both, at('2026-08-25T00:00:00.000Z'), 0)?.toISOString(),
    ).toBe('2026-08-25T08:00:00.000Z');
  });
});

/**
 * [FIX-20260825-MAXRUNSOFFBY1] max_runs ต้องหยุดจริง ไม่ใช่เกินไปหนึ่งรอบ
 * ===========================================================================
 * 🔴 บั๊กที่เจอตอน **ยิงจริง** ไม่ใช่จากเทส: `scheduler.driver.ts` อ่าน `run_count`
 *    จาก document ที่โหลดมา **ก่อน** `$inc` ⇒ ส่งเลขน้อยกว่าความจริง 1
 *    ⇒ `max_runs: 1` ยิงเสร็จแล้วยังติดอาวุธรอบที่ 2 และ **ยิงจริง** เพราะไม่มี
 *    gate กัน max_runs ก่อนส่ง
 *
 * ⚠️ เทสชุดเดิม 103 เคสเขียวหมดทั้งที่บั๊กอยู่ — เพราะทุกเคสเรียก `computeNextRun`
 *    ตรง ๆ ด้วยเลขที่ถูกอยู่แล้ว ไม่มีใครถามว่า "คนเรียกส่งเลขอะไรมา"
 *    เทสที่ไม่ได้เดินเส้นทางจริง จะไม่เห็นบั๊กของเส้นทางจริง.
 */
describe('max_runs — นับรอบที่เพิ่งยิงด้วย', () => {
  const rule = {
    mode: 'repeat',
    enabled: true,
    at_time_min: 900,
    tz_offset_min: 420,
    max_runs: 1,
  } as never;

  it('🔴 ยิงไปแล้ว 1 รอบ (max_runs=1) ⇒ ต้องไม่มีรอบถัดไป', () => {
    /* นี่คือเลขที่ driver ต้องส่ง: run_count(0) + รอบที่เพิ่งจบ(1) = 1 */
    expect(
      computeNextRun(rule, new Date('2026-08-25T08:00:00.000Z'), 1),
    ).toBeNull();
  });

  it('ถ้าส่งเลขก่อน $inc (0) จะยังได้รอบถัดไป — นี่คือรูปร่างของบั๊ก', () => {
    /* เก็บไว้เป็นหลักฐานว่าทำไม +1 ถึงจำเป็น ไม่ใช่การตกแต่ง */
    expect(
      computeNextRun(rule, new Date('2026-08-25T08:00:00.000Z'), 0),
    ).not.toBeNull();
  });

  it('driver ส่ง run_count + 1 ไม่ใช่ run_count ดิบ', () => {
    /* source-guard: ถ้ามีคนถอด `+ 1` ออก เทสนี้แดงทันที */
    const body = readFileSync(
      resolve(
        process.cwd(),
        'src/modules/content/broadcast-run/scheduler.driver.ts',
      ),
      'utf8',
    );
    expect(body).toMatch(/run_count'\]\)\s*\+\s*1/);
  });
});
