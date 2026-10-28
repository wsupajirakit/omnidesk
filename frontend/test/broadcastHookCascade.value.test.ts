/**
 * [FIX-20260824-HOOKCASCADE] เอากลุ่มออก ⇒ OA ของกลุ่มนั้นต้องออกตาม
 * ===========================================================================
 * เจ้าของ 24/08: *"ถ้าติ๊ก group แม่ออก hook ลูกต้องออกตาม"*.
 *
 * 🔴 นี่ไม่ใช่เรื่องความเรียบร้อยของ state — เป็นบั๊ก **ส่งเกิน**: รายชื่อ OA บนจอ
 *    ถูกสร้างใหม่จากกลุ่มที่ติ๊กอยู่ ⇒ ติ๊กกลุ่มออกแล้ว OA ของมันหายจากจอ แต่ id
 *    ยังอยู่ใน `hook_ids` และยังขึ้น payload ⇒ ยิงจาก OA ที่แอดมินคิดว่าเอาออกไปแล้ว
 *    ⚠️ ข้อความที่ส่งออกไปแล้วเรียกคืนไม่ได้ นี่คือความผิดพลาดฝั่งที่แก้ไม่ได้
 *
 * เทสระดับค่า (ไม่แตะ DOM) เพราะกฎการตัดคือหัวใจ ส่วนการวาดเป็นแค่ทางผ่าน —
 * `broadcastPickers.dom.test.tsx` เป็นตัวยืนยันว่าหน้าจอเรียกกฎนี้จริง
 */
import { describe, it, expect } from 'vitest';
import { pruneHookIds, hookGroupOf } from '../components/campaign/pickers/pruneHookIds';

const H = (id: string, group: string | null) => ({ _id: id, group });

describe('[FIX-20260824-HOOKCASCADE] pruneHookIds', () => {
  it('⭐ OA ของกลุ่มที่เลิกติ๊กแล้ว ต้องหลุดออกจากรายการ', () => {
    const hooks = [H('h1', 'g1'), H('h2', 'g2')];
    expect(pruneHookIds(['h1', 'h2'], hooks, ['g1'])).toEqual(['h1']);
  });

  it('⭐ OA ของกลุ่มที่ยังติ๊กอยู่ ห้ามหลุด', () => {
    const hooks = [H('h1', 'g1'), H('h2', 'g2')];
    expect(pruneHookIds(['h1', 'h2'], hooks, ['g1', 'g2'])).toEqual(['h1', 'h2']);
  });

  it('⭐ กลุ่มเจ้าของงาน (assign_group) ก็นับเป็นกลุ่มที่ติ๊กอยู่', () => {
    /* `assign_group` ป้อนรายชื่อ OA เหมือนกัน (ดู groupPickKey) — ถ้าไม่นับ
       OA ของกลุ่มเจ้าของงานจะโดนล้างทุกครั้งที่แตะกลุ่มเป้าหมาย */
    const hooks = [H('h1', 'gOwner')];
    expect(pruneHookIds(['h1'], hooks, ['gOwner'])).toEqual(['h1']);
    expect(pruneHookIds(['h1'], hooks, [null])).toEqual([]);
  });

  it('🔴 id ที่ยังไม่รู้จัก (รายชื่อยังโหลดไม่เสร็จ) ต้อง "เก็บไว้" ไม่ใช่ตัดทิ้ง', () => {
    /* เปิดใบเก่ามาแก้: hook_ids มาจาก initialData ตั้งแต่วินาทีแรก แต่ `hooks`
       ยังว่างอยู่ ⇒ ถ้าตัดสิ่งที่พิสูจน์ไม่ได้ ทุกแคมเปญจะถูกล้าง OA ทิ้งทันที
       ที่เปิดดู แล้วเซฟทับกลับไป */
    expect(pruneHookIds(['h1', 'h2'], [], ['g1'])).toEqual(['h1', 'h2']);
  });

  it('🔴 hook ที่ไม่บอกกลุ่มมาเลย ก็ถือว่าพิสูจน์ไม่ได้ ⇒ เก็บไว้', () => {
    expect(pruneHookIds(['h1'], [H('h1', null)], ['g1'])).toEqual(['h1']);
  });

  it('⭐ อ่าน `group` ก่อน `group_id` — `group` คือฟิลด์ที่ API ตอบกลับมาจริง', () => {
    /* `types/hook.ts:5` เขียนไว้ตรง ๆ ว่า `group_id` ถูกตั้งโดย payload ขาไป
       เท่านั้น ไม่เคยมาจาก response ⇒ ใช้เป็นตัวสำรอง ห้ามใช้เป็นตัวหลัก */
    expect(hookGroupOf({ _id: 'h1', group: 'gA', group_id: 'gB' })).toBe('gA');
    expect(hookGroupOf({ _id: 'h1', group_id: 'gB' })).toBe('gB');
    expect(hookGroupOf({ _id: 'h1' })).toBe('');
  });

  it('ไม่กลายพันธุ์ input — ฟอร์มอ่าน state เดิมซ้ำได้', () => {
    const ids = ['h1', 'h2'];
    pruneHookIds(ids, [H('h1', 'g1'), H('h2', 'g2')], ['g1']);
    expect(ids).toEqual(['h1', 'h2']);
  });
});
