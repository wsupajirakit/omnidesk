/**
 * [FEAT-20260830-HIDEDESC] ช่อง "คำอธิบาย" ถูกซ่อน — เติมวันที่ให้แทน
 *
 * เจ้าของสั่ง 30/08/2026: ซ่อนทั้ง label และ textarea ของ `description`
 * (ทั้งตอนสร้างและตอนแก้ไข) แต่ฟอร์มยังส่งค่าเหมือนเดิม โดยใส่วันที่ `ddmmyy` ค.ศ.
 *
 * ── ทำไมเคสพวกนี้ถึงคุ้มค่าที่จะเทส ────────────────────────────────────────
 * · **validation ไม่แยกโหมด** — `HookFormModal.tsx` ตรวจ
 *   `!formData.description || !formData.description.trim()` กับทุกโหมด
 *   ⇒ ถ้าค่าว่างหลุดไปได้แม้เคสเดียว ฟอร์มจะ **กดบันทึกไม่ได้ถาวร** และ error
 *   ชี้ไปยังช่องที่มองไม่เห็นแล้ว
 * · **clone เปิดด้วย `mode:'create'` แต่มี `initialData`** ⇒ ถ้าเติมทับโดยไม่ดู
 *   ว่ามีค่าอยู่ไหม คำอธิบายของ hook ต้นทางจะหายไปเงียบ ๆ
 * · **ปี ค.ศ. ไม่ใช่ พ.ศ.** — `toLocaleDateString('th-TH')` คืน 69 (พ.ศ. 2569)
 *   ซึ่งไม่ใช่สิ่งที่สั่ง เคสนี้กันไม่ให้ใครเผลอเปลี่ยนไปใช้ตัวนั้น
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  todayDdMmYy,
  resolveHookDescription,
} from '../components/hook/form/hookDescriptionDate';

describe('[HIDEDESC] todayDdMmYy — ddmmyy ปี ค.ศ.', () => {
  it('⭐ ประกอบเป็น ddmmyy ครบ 6 หลัก', () => {
    expect(todayDdMmYy(new Date(2026, 7, 29))).toBe('290826');
  });

  it('เติม 0 ข้างหน้าให้วันและเดือนที่เป็นเลขหลักเดียว', () => {
    expect(todayDdMmYy(new Date(2026, 0, 1))).toBe('010126');
    expect(todayDdMmYy(new Date(2026, 8, 9))).toBe('090926');
  });

  it('⭐⭐ ปีเป็น ค.ศ. สองหลัก ไม่ใช่ พ.ศ.', () => {
    /* 2026 ⇒ "26". ถ้าใครเปลี่ยนไปใช้ toLocaleDateString('th-TH') จะได้ "69" */
    expect(todayDdMmYy(new Date(2026, 7, 29))).toMatch(/26$/);
    expect(todayDdMmYy(new Date(2026, 7, 29))).not.toMatch(/69$/);
  });

  it('ข้ามปีแล้วยังถูก', () => {
    expect(todayDdMmYy(new Date(2027, 11, 31))).toBe('311227');
    expect(todayDdMmYy(new Date(2030, 4, 5))).toBe('050530');
  });

  it('ได้ 6 หลักเสมอ ไม่ว่าวันไหน', () => {
    for (let m = 0; m < 12; m++) {
      for (const d of [1, 9, 10, 28]) {
        expect(todayDdMmYy(new Date(2026, m, d))).toMatch(/^\d{6}$/);
      }
    }
  });
});

describe('[HIDEDESC] resolveHookDescription — เติมเฉพาะตอนว่าง', () => {
  const now = new Date(2026, 7, 29); // -> 290826

  it('⭐⭐⭐ ค่าที่มีอยู่แล้ว ห้ามแตะ (กัน clone เสียข้อมูล)', () => {
    /* clone เปิดด้วย mode:'create' แต่ส่ง initialData มาด้วย — ถ้าเติมทับ
       คำอธิบายของ hook ต้นทางจะหายไปโดยไม่มีใครรู้ */
    expect(resolveHookDescription('คำอธิบายเดิมของแอดมิน', now)).toBe(
      'คำอธิบายเดิมของแอดมิน',
    );
  });

  it('คืนค่าเดิมทุกตัวอักษร ไม่ trim ไม่แต่ง', () => {
    expect(resolveHookDescription('  มีช่องว่างหน้าหลัง  ', now)).toBe(
      '  มีช่องว่างหน้าหลัง  ',
    );
  });

  it.each([
    ['undefined (ไม่มี key)', undefined],
    ['null (API ส่ง null มาจริง)', null],
    ['สตริงว่าง', ''],
    ['ช่องว่างล้วน', '   '],
    ['ขึ้นบรรทัดใหม่ล้วน', '\n\n'],
    ['tab ล้วน', '\t'],
  ])('⭐ เติมวันที่เมื่อค่าเป็น %s', (_label, input) => {
    expect(resolveHookDescription(input, now)).toBe('290826');
  });

  it.each([
    ['ตัวเลข', 123],
    ['object', {}],
    ['array', []],
    ['boolean', true],
  ])('เติมวันที่เมื่อค่าเป็นชนิดที่ไม่ใช่สตริง (%s)', (_label, input) => {
    /* validation อ่าน .trim() ⇒ ค่าที่ไม่ใช่สตริงจะระเบิดหรือถูกตีตก
       ต้องกลายเป็นสตริงที่ใช้ได้เสมอ */
    expect(resolveHookDescription(input, now)).toBe('290826');
  });

  it('⭐⭐ ผลลัพธ์ผ่าน validation ของฟอร์มเสมอ', () => {
    /* validation จริงคือ `!v || !v.trim()` — จำลองตรงนี้เพื่อพิสูจน์ว่า
       ไม่มีอินพุตแบบไหนที่ทำให้ฟอร์มตันได้ */
    const passesFormValidation = (v: string) => Boolean(v && v.trim());
    for (const input of [undefined, null, '', '   ', '\n', 0, {}, 'ของเดิม']) {
      expect(passesFormValidation(resolveHookDescription(input, now))).toBe(true);
    }
  });
});

describe('[HIDEDESC] ฟอร์มจริงใช้กฎนี้จริง (source census)', () => {
  const form = () =>
    readFileSync(
      join(__dirname, '..', 'components/hook/HookFormModal.tsx'),
      'utf8',
    );

  it('⭐⭐⭐ ช่องคำอธิบายถูกซ่อน', () => {
    expect(form()).toContain('<div className="md:col-span-2 hidden">');
  });

  it('⭐⭐ ตอน edit/clone ใช้ resolveHookDescription ไม่ใช่ค่าดิบ', () => {
    /* ถ้ากลับไปเป็น `description: initialData.description,` เฉย ๆ hook เก่าที่
       ค่าว่างจะแก้ไขไม่ได้เลย เพราะช่องถูกซ่อนไปแล้ว */
    const s = form();
    expect(s).toContain('resolveHookDescription(initialData.description)');
    expect(s).not.toMatch(/description: initialData\.description,/);
  });

  it('⭐ ตอนเปิดฟอร์มใหม่คำนวณวันที่สด ไม่ใช้ค่าที่ค้างใน DEFAULT_FORM', () => {
    /* DEFAULT_FORM ถูกประเมินครั้งเดียวตอนโมดูลโหลด ⇒ แท็บที่เปิดค้างข้าม
       เที่ยงคืนจะได้วันของเมื่อวานถ้าพึ่งค่านั้นอย่างเดียว */
    const s = form();
    const reset = s.slice(s.indexOf('...DEFAULT_FORM,'));
    expect(reset.slice(0, 600)).toContain('description: todayDdMmYy(),');
  });

  it('validation เดิมยังอยู่ครบ — ไม่ได้ปิดตาตัวตรวจ', () => {
    /* ทางแก้คือเติมค่าที่ต้นทาง ไม่ใช่ลบ/ผ่อน validation.
       ถ้าใครลบบรรทัดนี้ทิ้ง เท่ากับเปิดทางให้ค่าว่างหลุดไป API */
    expect(form()).toContain(
      '!formData.description || !formData.description.trim()',
    );
  });
});
