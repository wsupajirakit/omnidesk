/**
 * [FIX-20260828-FORCEGRANTLABEL] ป้าย force grant ต้องพูดความจริง
 * ===========================================================================
 * เจ้าของ 28/08: *"ติ๊กแล้วได้จริงไหม"*
 *
 * 🔴 ป้ายเดิมเขียนว่า "user **ทุกคน** ในกลุ่มทันที" · วัดจริงบนฐานพัฒนาแล้วแตะ
 *    **3 จาก 7** — คนที่ไม่มีรายการจำกัด OA ถูกข้ามโดยตั้งใจ เพราะเขาเห็น OA
 *    ทุกตัวในกลุ่มอยู่แล้ว · ถ้าไปเพิ่มให้เขาจะกลายเป็นการ **ตัดสิทธิ์**
 *    ⇒ ฟีเจอร์ไม่ได้พัง แต่ป้ายทำให้คนอ่านสรุปว่าพัง
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FORM = readFileSync(
  join(ROOT, 'components', 'hook', 'HookFormModal.tsx'),
  'utf8',
);
const TH = JSON.parse(
  readFileSync(join(ROOT, 'i18n', 'translations', 'th.json'), 'utf8'),
) as Record<string, string>;

const LOCALES = ['th', 'en', 'it', 'zh'] as const;

describe('[FORCEGRANTLABEL] ป้ายบอกสิ่งที่เกิดจริง', () => {
  it('⭐⭐ 🔴 ไม่มีคำว่า "ทุกคน" อีกแล้ว', () => {
    /* คำนี้คือต้นเหตุที่ทำให้อ่านแล้วสรุปว่าฟีเจอร์พัง */
    expect(TH['hook_form.force_grant_label']).toBeDefined();
    expect(TH['hook_form.force_grant_label']).not.toContain('ทุกคน');
  });

  it('⭐⭐ 🔴 มีคำอธิบายว่าใครถูกข้ามและเพราะอะไร', () => {
    const hint = TH['hook_form.force_grant_hint'] ?? '';
    expect(hint).toContain('จำกัด');
    expect(hint.length).toBeGreaterThan(30);
  });

  it('⭐⭐ 🔴 ข้อความไม่ฮาร์ดโค้ดในคอมโพเนนต์อีกแล้ว', () => {
    /* ป้ายตัวพี่น้องใน `HookCloneModal` ใช้ i18n อยู่แล้ว — ที่นี่เคยเป็นไทยดิบ
       ⇒ ภาษาอื่นไม่เคยเห็นข้อความนี้เลย */
    expect(FORM).not.toContain('ให้สิทธิ์ OA นี้กับ user ทุกคนในกลุ่มทันที');
    expect(FORM).toContain("t('hook_form.force_grant_label')");
    expect(FORM).toContain("t('hook_form.force_grant_hint')");
  });

  it('⭐⭐ คำแปลครบทุกภาษา ไม่มีภาษาไหนตกหล่น', () => {
    for (const loc of LOCALES) {
      const d = JSON.parse(
        readFileSync(join(ROOT, 'i18n', 'translations', `${loc}.json`), 'utf8'),
      ) as Record<string, string>;
      expect(d['hook_form.force_grant_label']).toBeTruthy();
      expect(d['hook_form.force_grant_hint']).toBeTruthy();
    }
  });

  it('⭐ สีอ่านออกในธีมสว่าง — ไม่ใช่ชุดสีของพื้นมืด', () => {
    /* `text-slate-300` + `hover:text-white` บนพื้นสว่าง = จืดจนเกือบมองไม่เห็น
       ปัญหาเดียวกับที่แก้ไปแล้วในโมดัลผู้ใช้เมื่อ 28/08 */
    const line =
      FORM.split('\n').find((l) => l.includes("t('hook_form.force_grant_label')")) ??
      '';
    const label =
      FORM.split('\n').find(
        (l) => l.includes('<label') && l.includes('force_grant') === false && l.includes('cursor-pointer') && l.includes('text-slate'),
      ) ?? '';
    expect(line).not.toBe('');
    expect(label).toContain('text-slate-700');
    expect(label).toContain('dark:text-slate-300');
  });
});
