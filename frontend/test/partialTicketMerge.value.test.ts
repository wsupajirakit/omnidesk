/* [PERF-20260822-TKTIDSFETCH] การรวมแถวที่ดึงมาบางส่วน — กฎที่ผิดแล้ว badge เพี้ยนเงียบ
 *
 * เทสชุดนี้มีเพราะ badge บนหน้า ticket **นับจากจำนวนแถวใน array**
 * (`TicketChat.tsx:1966` → `filterByActiveFilters(activeTickets).filter(...).length`)
 * แถวซ้ำ 1 แถว = badge เกิน 1 โดยไม่มี error ที่ไหน และ DOM test จับไม่ได้ง่าย ๆ
 */
import { describe, it, expect } from 'vitest';

import {
  mergePartialTickets,
  isTicketVisible,
} from '../services/chat/partialTicketMerge';

const tk = (id: string, hook?: string | null, extra: Record<string, unknown> = {}) =>
  ({ _id: id, line_oa_hook_id: hook ?? null, ...extra }) as never;

describe('⭐ ห้ามซ้ำ — แถวซ้ำ 1 แถวคือ badge เกิน 1', () => {
  it('id ที่มีอยู่แล้ว ถูกแทนที่ ไม่ใช่เพิ่มเข้าไปอีกใบ', () => {
    const prev = [tk('a', 'h1', { job_status: 0 }), tk('b', 'h1')];
    const out = mergePartialTickets(prev, [tk('a', 'h1', { job_status: 1 })]);
    expect(out).toHaveLength(2);
    expect(out.filter((t: never) => (t as { _id: string })._id === 'a')).toHaveLength(1);
    expect((out[0] as { job_status: number }).job_status).toBe(1);
  });

  it('event เดิมมาซ้ำสองรอบ จำนวนแถวไม่ขยับ', () => {
    const prev = [tk('a', 'h1')];
    const once = mergePartialTickets(prev, [tk('a', 'h1')]);
    const twice = mergePartialTickets(once, [tk('a', 'h1')]);
    expect(twice).toHaveLength(1);
  });

  it('incoming ที่ซ้ำกันเอง ยุบเหลือใบเดียว (เอาใบหลังสุด)', () => {
    const out = mergePartialTickets([], [
      tk('a', 'h1', { v: 1 }),
      tk('a', 'h1', { v: 2 }),
    ]);
    expect(out).toHaveLength(1);
    expect((out[0] as { v: number }).v).toBe(2);
  });
});

describe('⭐ กรองสิทธิ์ — ทางลัดนี้ต้องไม่เป็นช่องให้แถวที่ไม่มีสิทธิ์เข้ามา', () => {
  const allowed = new Set(['h1']);

  it('แถวของ OA ที่ไม่มีสิทธิ์ ถูกทิ้ง', () => {
    const out = mergePartialTickets([], [tk('a', 'h9')], { allowedHooks: allowed });
    expect(out).toEqual([]);
  });

  it('แถวที่ไม่มี hook_id เลย ผ่านได้ — กติกาเดียวกับ fetchActive', () => {
    const out = mergePartialTickets([], [tk('a', null)], { allowedHooks: allowed });
    expect(out).toHaveLength(1);
  });

  it('ไม่ระบุ allowedHooks = ไม่จำกัด (เหมือน fetchActive ตอน userAllowedHooksSet เป็น null)', () => {
    expect(mergePartialTickets([], [tk('a', 'h9')])).toHaveLength(1);
  });

  it('isTicketVisible ตรงกับสูตรของ fetchActive ทุกกรณี', () => {
    expect(isTicketVisible(tk('a', 'h1'), allowed)).toBe(true);
    expect(isTicketVisible(tk('a', 'h9'), allowed)).toBe(false);
    expect(isTicketVisible(tk('a', null), allowed)).toBe(true);
    expect(isTicketVisible(tk('a', 'h9'), null)).toBe(true);
  });
});

describe('⭐ ไม่มีอะไรเปลี่ยน = คืน array เดิม (กัน re-render เปล่า)', () => {
  it('incoming ว่าง → อ้างอิงเดิม', () => {
    const prev = [tk('a', 'h1')];
    expect(mergePartialTickets(prev, [])).toBe(prev);
  });

  it('incoming ถูกกรองสิทธิ์ออกหมด → อ้างอิงเดิม', () => {
    const prev = [tk('a', 'h1')];
    expect(
      mergePartialTickets(prev, [tk('z', 'h9')], { allowedHooks: new Set(['h1']) }),
    ).toBe(prev);
  });

  it('แถวเดิมวัตถุเดียวกันเป๊ะ → อ้างอิงเดิม', () => {
    const same = tk('a', 'h1');
    const prev = [same];
    expect(mergePartialTickets(prev, [same])).toBe(prev);
  });

  it('มีแถวใหม่ → array ใหม่ (ต้อง re-render)', () => {
    const prev = [tk('a', 'h1')];
    expect(mergePartialTickets(prev, [tk('b', 'h1')])).not.toBe(prev);
  });
});

describe('⭐ ไม่ลบแถวที่ BE ไม่ส่งกลับมา', () => {
  it('ขอ 2 ใบ ได้กลับ 1 ใบ → อีกใบยังอยู่ในลิสต์', () => {
    // "ไม่ส่งกลับ" = ไม่เข้าเงื่อนไข search/within_days ไม่ใช่ "ถูกลบ"
    // การลบเป็นหน้าที่ของ ticket:updated กับ full refetch เท่านั้น
    const prev = [tk('a', 'h1'), tk('b', 'h1')];
    const out = mergePartialTickets(prev, [tk('a', 'h1', { job_status: 1 })]);
    expect(out.map((t: never) => (t as { _id: string })._id)).toEqual(['a', 'b']);
  });
});

describe('⭐ ทนของเสีย — ข้อมูลพังต้องไม่ทำให้ลิสต์พัง', () => {
  it('รายการที่เป็น null / ไม่มี _id ถูกข้าม', () => {
    const prev = [tk('a', 'h1')];
    const out = mergePartialTickets(prev, [
      null as never,
      { line_oa_hook_id: 'h1' } as never,
      tk('b', 'h1'),
    ]);
    expect(out.map((t: never) => (t as { _id: string })._id)).toEqual(['a', 'b']);
  });

  it('ลิสต์เดิมว่าง + incoming ว่าง → ว่าง ไม่พัง', () => {
    expect(mergePartialTickets([], [])).toEqual([]);
  });
});
