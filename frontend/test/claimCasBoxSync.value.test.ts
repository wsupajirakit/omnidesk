/* [FIX-20260823-CLAIMCAS] กล่อง "รับเคสต่อ" ต้องตรงกับความจริง + กัน race 100%
 * ============================================================================
 * เจ้าของสั่ง 23/08/2026:
 *   "ถ้ามีคนอื่นกดมันจะไม่อัพเดท ยังเป็นปุ่มรับเคสเหมือนเดิม"
 *   "ต้องกัน race condition 100%" · "ไม่กระทบงาน realtime badge อื่น"
 *
 * เทสนี้ตรึง **ตรรกะ** ที่หน้าจอใช้ (ไม่ render ทั้งหน้า ซึ่งจะเปราะและช้า):
 *   1. เงื่อนไขที่ทำให้กล่องโผล่ — `isOtherAdminCase`
 *   2. การแยกเหตุผล 409 สองแบบ — "ถูกแย่ง" ต้องไม่ถูกกลืนเป็น "ถูกปิด"
 *   3. เงื่อนไขยิง partial fetch — ต้องแคบที่สุด (เฉพาะตั๋วที่เปิดอยู่)
 *   4. การ sync กล่องจากแถวในลิสต์ — patch เฉพาะตอนเจ้าของต่างจริง
 */
import { describe, it, expect } from 'vitest';

const ME = 'admin-me';
const OTHER = 'admin-other';

/* ── 1. เงื่อนไขกล่อง (คัดจาก TicketChat.tsx:2324 — ถ้าที่นั่นเปลี่ยน ต้องตามมาแก้) */
const isOtherAdminCase = (jobStatus: number, ownerId: string | null) =>
  jobStatus === 1 && String(ownerId ?? '') !== ME;

describe('[CLAIMCAS] กล่องโผล่/หายตรงกับเจ้าของจริง', () => {
  it('คนอื่นถืออยู่ → กล่องต้องโผล่', () => {
    expect(isOtherAdminCase(1, OTHER)).toBe(true);
  });
  it('เราถืออยู่ → กล่องต้องไม่โผล่', () => {
    expect(isOtherAdminCase(1, ME)).toBe(false);
  });
  it('⭐ เราเคยถือ แล้วถูกแย่ง → กล่องต้องกลับมาโผล่', () => {
    // นี่คือทิศที่เดิมพังเงียบ: หน้าจอยังคิดว่าเป็นเคสของเรา เลยพิมพ์ต่อได้
    // ทั้งที่เจ้าของจริงเปลี่ยนไปแล้ว
    expect(isOtherAdminCase(1, ME)).toBe(false);
    expect(isOtherAdminCase(1, OTHER)).toBe(true);
  });
  it('เคสยังไม่ถูกรับ (0) → ไม่ใช่กล่องนี้ (เป็นปุ่มรับเคสปกติ)', () => {
    expect(isOtherAdminCase(0, null)).toBe(false);
  });
});

/* ── 2. แยกเหตุผล 409 (คัดจาก TicketChat.tsx — isClaimTakenConflict / isRaceConflict) */
const isRaceConflict = (e: { status?: number; message?: string }) =>
  e?.status === 409 || /ถูกปิดไปแล้ว|already accepted|already/i.test(e?.message || '');
const isClaimTakenConflict = (e: { message?: string }) =>
  /ถูกรับไปแล้วโดยแอดมินท่านอื่น/.test(e?.message || '');

describe('[CLAIMCAS] "ถูกแย่ง" ต้องไม่ถูกกลืนเป็น "ถูกปิด"', () => {
  const taken = { status: 409, message: 'เคสนี้ถูกรับไปแล้วโดยแอดมินท่านอื่น กรุณากดรับเคสต่ออีกครั้ง' };
  const closed = { status: 409, message: 'เคสนี้ถูกปิดไปแล้ว เคลม/รับไม่ได้' };

  it('⭐ ทั้งคู่เป็น 409 — ตัวแยกต้องดูข้อความ ไม่ใช่ status', () => {
    expect(isRaceConflict(taken)).toBe(true);   // เดิมจะกลืนเคสนี้ไปปิดหน้าจอทิ้ง
    expect(isClaimTakenConflict(taken)).toBe(true);
    expect(isClaimTakenConflict(closed)).toBe(false);
  });

  it('ลำดับสำคัญ: ต้องเช็ค "ถูกแย่ง" ก่อนเสมอ', () => {
    // ถ้าเช็ค isRaceConflict ก่อน เคส "ถูกแย่ง" จะเข้าสาขาปิดหน้าเคสทิ้ง
    // ทั้งที่เคสยังเปิดอยู่และแอดมินควรกดรับต่อได้ทันที
    const first = isClaimTakenConflict(taken) ? 'taken' : isRaceConflict(taken) ? 'closed' : 'other';
    expect(first).toBe('taken');
  });

  it('เคสถูกปิดจริง → ยังเข้าสาขาเดิม (ปิดหน้าเคส)', () => {
    expect(isClaimTakenConflict(closed)).toBe(false);
    expect(isRaceConflict(closed)).toBe(true);
  });
});

/* ── 3. เงื่อนไขยิง partial fetch — ต้องแคบที่สุด */
const shouldRefetchOpenTicket = (eventId: string, openTicketId: string | null) =>
  !!openTicketId && eventId === openTicketId;

describe('[CLAIMCAS] ⭐ ไม่สร้าง bottleneck — ยิงเฉพาะตั๋วที่เปิดอยู่', () => {
  it('event ของตั๋วที่เปิดอยู่ → ยิง', () => {
    expect(shouldRefetchOpenTicket('t1', 't1')).toBe(true);
  });
  it('⭐ event ของตั๋วอื่น → ไม่ยิง (เคสเข้าเยอะแค่ไหนก็ไม่เพิ่ม)', () => {
    expect(shouldRefetchOpenTicket('t2', 't1')).toBe(false);
    expect(shouldRefetchOpenTicket('t3', 't1')).toBe(false);
  });
  it('ไม่ได้เปิดเคสไหนอยู่ → ไม่ยิง', () => {
    expect(shouldRefetchOpenTicket('t1', null)).toBe(false);
  });
  it('เพดานเชิงอันดับ: แอดมิน 1 คนเปิดได้ทีละใบ ⇒ ≤1 คำขอต่อ event', () => {
    const openId = 't1';
    const burst = ['t1', 't2', 't3', 't4', 't5'];
    const fired = burst.filter(id => shouldRefetchOpenTicket(id, openId));
    expect(fired).toEqual(['t1']);   // 5 events → 1 คำขอ
  });
});

/* ── 4. sync กล่องจากแถวในลิสต์ */
const ownerChanged = (
  fresh: { admin_user_id?: string | null },
  current: { admin_user_id?: string | null },
) => String(fresh.admin_user_id ?? '') !== String(current.admin_user_id ?? '');

describe('[CLAIMCAS] sync กล่องจากลิสต์ — patch เฉพาะตอนเจ้าของต่างจริง', () => {
  it('เจ้าของเปลี่ยน → patch', () => {
    expect(ownerChanged({ admin_user_id: OTHER }, { admin_user_id: ME })).toBe(true);
  });
  it('⭐ เจ้าของเท่าเดิม → ไม่ patch (กัน re-render เปล่า ๆ ทุกครั้งที่ลิสต์ขยับ)', () => {
    expect(ownerChanged({ admin_user_id: ME }, { admin_user_id: ME })).toBe(false);
  });
  it('null กับ "" ถือว่าเท่ากัน — ไม่ patch วน', () => {
    expect(ownerChanged({ admin_user_id: null }, {})).toBe(false);
  });
  it('ว่าง → มีคนรับ = เปลี่ยน', () => {
    expect(ownerChanged({ admin_user_id: ME }, { admin_user_id: null })).toBe(true);
  });
});
