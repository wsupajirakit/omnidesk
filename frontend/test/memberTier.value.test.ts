import { describe, it, expect } from 'vitest';
import { tierOfMember, tierBadgeText } from '../utils/memberTier';

/**
 * [FIX-20260810-TIERSOURCE] สัญญาของ "แหล่ง tier แหล่งเดียว"
 *
 * สิ่งที่ล็อกไว้ และเหตุผล:
 *   (A) อ่านจาก `raw_profile_data` ก่อน — เป็นค่าที่ webhook เขียนจากปลายทางจริง
 *       นับบน dev: มี 1 คนที่มีแค่ก้อนนี้ ไม่มี `members.tier` ⇒ อ่านผิดที่ = badge หาย
 *   (B) รองรับทั้ง `{data:{profile}}` และ `{profile}` — ปลายทางห่อไม่เหมือนกัน
 *   (C) `level: 0` (Normal) ต้องไม่หาย — เป็น falsy ถ้าใช้ `||` จะถูกกลืน
 *       เคสจริงที่เจอ: ลูกค้าทุกคนบน dev เป็น Normal level 0
 * เทสนี้ต้องพังถ้ามีคนเปลี่ยนลำดับแหล่ง หรือเผลอใช้ || กับ level.
 */

describe('tierOfMember — ลำดับแหล่งข้อมูล', () => {
  it('อ่านจาก raw_profile_data.data.profile ก่อน (รูปที่ webhook เขียนจริง)', () => {
    const m = {
      tier: { code: 'old', name: 'Old', level: 9 },
      raw_profile_data: {
        success: true,
        data: { profile: { tier: { code: 'normal', name: 'Normal', level: 0 } } },
      },
    };
    // raw ต้องชนะ — เป็นค่าที่ปลายทางส่งมาล่าสุด ไม่ใช่ค่าที่เราคัดลอกเก็บไว้
    expect(tierOfMember(m)?.code).toBe('normal');
  });

  it('รองรับรูปที่ไม่ห่อ data (ปลายทางบางเจ้าส่งแบบนี้)', () => {
    const m = { raw_profile_data: { profile: { tier: { name: 'Gold', level: 3 } } } };
    expect(tierOfMember(m)?.name).toBe('Gold');
  });

  it('ตกไป members.tier เมื่อ raw_profile_data ไม่มี tier', () => {
    const m = { tier: { code: 'silver', name: 'Silver', level: 2 }, raw_profile_data: { data: {} } };
    expect(tierOfMember(m)?.code).toBe('silver');
  });

  it('ไม่มีทั้งคู่ ⇒ null (ผู้เรียกจะไม่แสดงป้าย)', () => {
    expect(tierOfMember({})).toBeNull();
    expect(tierOfMember(null)).toBeNull();
    expect(tierOfMember(undefined)).toBeNull();
  });
});

describe('tierBadgeText — ข้อความบนป้าย', () => {
  it('ไม่กลืน level 0 — Normal ต้องขึ้นเลข 0', () => {
    // ⚠️ ถ้าเผลอใช้ `||` กับ level เลข 0 จะหาย แล้วป้ายจะเหลือแค่ "Normal"
    expect(tierBadgeText({ code: 'normal', name: 'Normal', level: 0 })).toBe('Normal 0');
  });

  it('ใช้ code เมื่อไม่มี name', () => {
    expect(tierBadgeText({ code: 'vip', name: '', level: 5 })).toBe('vip 5');
  });

  it('ไม่มี level ⇒ แสดงแค่ชื่อ', () => {
    expect(tierBadgeText({ name: 'Gold', level: null })).toBe('Gold');
  });

  it('null ⇒ ว่าง (ไม่ render ป้าย)', () => {
    expect(tierBadgeText(null)).toBe('');
  });
});

describe('panel กับ header ต้องได้ค่าเท่ากัน', () => {
  it('member ก้อนเดียวกัน ⇒ ป้ายเดียวกันทั้งสองจุด', () => {
    // นี่คือบั๊กที่แก้: panel ขึ้น "Normal 0" แต่ header ว่าง
    // ตอนนี้ทั้งสองเรียกฟังก์ชันเดียวกันบน object เดียวกัน ⇒ ต่างกันไม่ได้
    const member = {
      raw_profile_data: { data: { profile: { tier: { code: 'normal', name: 'Normal', level: 0 } } } },
    };
    const panel = tierBadgeText(tierOfMember(member));
    const header = tierBadgeText(tierOfMember(member));
    expect(panel).toBe(header);
    expect(panel).toBe('Normal 0');
  });
});
