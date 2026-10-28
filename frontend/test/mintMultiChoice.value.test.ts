/**
 * [FIX-20260825-MINTMULTI] mint เลือกฝาก+ถอนพร้อมกันได้ และเวลาเป็น "ตอนนี้"
 *
 * เจ้าของ 25/08: *"ปุ่ม mint ปรับ ให้เลือกฝากและถอนพร้อมกันได้เลย = fix เวลาปัจจุบัน
 * ให้เลย ฝาก ถอน (ใช้เงื่อนไขข้อใดข้อหนึ่งถ้าเลือกทั้งสอง) ส่วนเวลา ก่อนหรือเท่ากับ
 * = fix ปัจจุบันเลย (ถ้าอยากเปลี่ยนคลิกเอง)"*
 *
 * เปลี่ยน 3 อย่าง:
 *  1. รับได้หลายตัวเลือก ไม่ใช่ตัวเดียว
 *  2. เลือก 2 ตัว ⇒ `match: 'or'` (ข้อใดข้อหนึ่ง) · ตัวเดียว ⇒ `'and'` เหมือนเดิม
 *  3. เวลาเป็น **ตอนนี้** ไม่ใช่ 7 วันก่อน (เจ้าของเปลี่ยนใจจาก 24/08)
 */
import { describe, it, expect } from 'vitest';
import { applyMint, rulesForChoices } from '../components/campaign/mint/mintRules';
import { mintById } from '../components/campaign/mint/mint.registry';

const mint = mintById('follow_up_notice')!;
const dep = mint.choices.find(c => c.id === 'deposit')!;
const wit = mint.choices.find(c => c.id === 'withdraw')!;
const NOW = new Date('2026-08-25T03:00:00.000Z');

describe('[MINTMULTI] เลือกได้หลายตัว', () => {
  it('⭐⭐ เลือกทั้งฝากและถอน = ได้ 2 เงื่อนไข และ match = or', () => {
    const r = applyMint([dep, wit], NOW);
    expect(r.rules).toHaveLength(2);
    expect(r.match).toBe('or');
    expect(r.rules.map(x => x.key)).toEqual([dep.rule_key, wit.rule_key]);
  });

  it('⭐ เลือกตัวเดียว = 1 เงื่อนไข และ match = and เหมือนเดิม', () => {
    const r = applyMint([dep], NOW);
    expect(r.rules).toHaveLength(1);
    expect(r.match).toBe('and');
  });

  it('⭐ ไม่เลือกอะไรเลย = ไม่มีเงื่อนไข', () => {
    expect(applyMint([], NOW).rules).toEqual([]);
  });
});

describe('[MINTMULTI] mint ไม่มีเวลาแล้ว — ประวัติของข้อนี้ยาว อ่านก่อนแก้', () => {
  /* **พลิกค่า ไม่ลบเคส** ตามกติกา · ประวัติของสองเคสนี้:
       24/08  ตกลงว่า mint ถอยหลัง 7 วัน  → เคสตรึง `2026-08-18`
       25/08  เจ้าของเปลี่ยนเป็น "ตอนนี้"  → เคสตรึง `2026-08-25` + `op: 'lte'`
       26/08  BE ล็อกคีย์กลุ่มนี้ที่ `ops: ['has_value']` (`[UI-20260825-LOCKHASVALUE]`)
              เพราะ stamp เป็น **rolling** ถูกทับทุกครั้งที่ส่งซ้ำ ⇒ เงื่อนไขอิงเวลา
              เปลี่ยนความหมายไปเอง · เกิดจริง 25/08: `lte 16:07` แต่ถูกประทับ 16:26
              ⇒ ผู้รับ 0 คน (`refused-plan: empty`)
     ⇒ ตอนนี้ mint ไม่กรอกเวลาเลย · เคสจึงเฝ้าสิ่งตรงข้าม: **ห้ามมีเวลากลับมา**
     ⚠️ ถ้าวันหลังมี mint ตัวใหม่ที่ใช้เวลาจริง ให้เพิ่มเคสใหม่ อย่าผ่อนเคสนี้ */
  it('⭐⭐ ค่าที่ mint ให้ ต้องไม่มีเวลาติดมาเลย', () => {
    const [rule] = rulesForChoices([dep], NOW);
    expect(rule.value).toBe('');
  });

  it('⭐ ตัวดำเนินการเป็น "มีค่า" (has_value) ตามที่ BE ล็อกไว้', () => {
    expect(rulesForChoices([dep, wit], NOW).every(r => r.op === 'has_value')).toBe(true);
  });
});
