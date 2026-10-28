/**
 * [FEAT-20260830-CHATFONT] ขนาดตัวอักษรของช่องแชทกลาง — 6 ขั้น
 *
 * เจ้าของสั่ง 30/08/2026: 6 ขั้น (1.0–2.0) · ขั้นแรกเท่าขนาดปัจจุบัน ·
 * **ไม่มีค่า = ได้ขนาดปกติอัตโนมัติทุกกรณี ไม่ต้องคลิกอะไรก่อน** ·
 * เป็นค่าใหม่ **ห้ามปนกับ `ui.fontScale` ของฟันเฟือง**
 *
 * ── ทำไมเคสพวกนี้คุ้มค่า ────────────────────────────────────────────────────
 * · `usePreference` **ไม่ตรวจและไม่ clamp ค่าที่เก็บไว้เลย** — เก็บอะไรไว้ก็คืน
 *   มาตรง ๆ ⇒ ถ้าไม่กรองเอง ค่าเพี้ยนจะทำให้หน้าแชทพังโดยไม่มีใครรู้สาเหตุ
 * · ค่านี้กลายเป็นตัวคูณใน CSS ⇒ ค่าที่ไม่ใช่ตัวเลข (NaN/สตริง) จะทำให้
 *   `calc()` พังทั้งบล็อก ตัวอักษรหายทั้งหน้า
 * · path ที่ชนกับ `ui.fontScale` จะทำให้ฟันเฟืองเพี้ยนไปด้วย ซึ่งเจ้าของห้ามชัด
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHAT_FONT_SCALE_PATH,
  CHAT_FONT_SCALE_STEPS,
  CHAT_FONT_SCALE_DEFAULT,
  CHAT_FONT_SCALE_VAR,
  normalizeChatFontScale,
  chatFontScaleIndex,
  chatFontScaleAt,
  chatFontScaleLabelKey,
} from '../hooks/chatFontScale';

describe('[CHATFONT] ขั้นทั้ง 6 ตรงตามที่สั่ง', () => {
  it('⭐ มี 6 ขั้น 1.0 ถึง 2.0', () => {
    expect([...CHAT_FONT_SCALE_STEPS]).toEqual([1.0, 1.2, 1.4, 1.6, 1.8, 2.0]);
  });

  it('⭐⭐ ขั้นแรกคือ 1 — ขนาดปัจจุบันเป๊ะ ไม่เปลี่ยนอะไร', () => {
    /* เจ้าของย้ำว่า "ตัวกลางต้องเท่าขนาดปัจจุบันเสมอ" ⇒ คูณ 1 = หน้าตาเดิม */
    expect(CHAT_FONT_SCALE_STEPS[0]).toBe(1);
    expect(CHAT_FONT_SCALE_DEFAULT).toBe(1);
  });

  it('เรียงจากน้อยไปมาก และไม่มีค่าซ้ำ', () => {
    const arr = [...CHAT_FONT_SCALE_STEPS];
    expect(arr).toEqual([...arr].sort((a, b) => a - b));
    expect(new Set(arr).size).toBe(arr.length);
  });

  it('ค่าเริ่มต้นต้องเป็นสมาชิกของขั้น ไม่ใช่ค่าลอย ๆ', () => {
    expect(CHAT_FONT_SCALE_STEPS).toContain(CHAT_FONT_SCALE_DEFAULT);
  });
});

describe('[CHATFONT] ⭐⭐⭐ fallback — ไม่มีค่าต้องได้ค่าเริ่มต้นทุกกรณี', () => {
  it.each([
    ['ไม่เคยตั้ง (undefined)', undefined],
    ['null', null],
    ['สตริง', '1.4'],
    ['สตริงว่าง', ''],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['object', {}],
    ['array', []],
    ['boolean', true],
  ])('%s ⇒ ค่าเริ่มต้น', (_label, input) => {
    /* ค่าที่ไม่ใช่ตัวเลขจะทำให้ calc() พังทั้งบล็อก ⇒ ตัวอักษรหายทั้งหน้าแชท */
    expect(normalizeChatFontScale(input)).toBe(CHAT_FONT_SCALE_DEFAULT);
  });

  it('เล็กกว่าขั้นต่ำสุด ⇒ ดึงกลับมาที่ขั้นต่ำสุด', () => {
    expect(normalizeChatFontScale(0)).toBe(1.0);
    expect(normalizeChatFontScale(-5)).toBe(1.0);
    expect(normalizeChatFontScale(0.5)).toBe(1.0);
  });

  it('⭐ ใหญ่เกินขั้นสูงสุด ⇒ ดึงกลับมาที่ขั้นสูงสุด ไม่ปล่อยผ่าน', () => {
    /* usePreference ไม่ clamp ⇒ ค่า 999 ที่ค้างใน DB จะทำให้ตัวอักษรใหญ่จนจอแตก */
    expect(normalizeChatFontScale(999)).toBe(2.0);
    expect(normalizeChatFontScale(2.5)).toBe(2.0);
  });

  it('ค่าที่ตรงขั้นอยู่แล้ว คืนตัวเดิม', () => {
    for (const s of CHAT_FONT_SCALE_STEPS) {
      expect(normalizeChatFontScale(s)).toBe(s);
    }
  });

  it('ค่าที่เพี้ยนเพราะ float ยังจับขั้นถูก', () => {
    /* 1.4000000000000001 เกิดได้จริงจากการคำนวณ — ไม่ควรถูกโยนทิ้ง */
    expect(normalizeChatFontScale(1.4000000000000001)).toBe(1.4);
    expect(normalizeChatFontScale(1.5999999999)).toBe(1.6);
  });

  it('ค่ากลางระหว่างขั้น จับขั้นที่ใกล้ที่สุด', () => {
    expect(normalizeChatFontScale(1.31)).toBe(1.4);
    expect(normalizeChatFontScale(1.29)).toBe(1.2);
  });
});

describe('[CHATFONT] seekbar ผูกกับลำดับขั้น', () => {
  it('index ตรงกับตำแหน่งในลิสต์', () => {
    CHAT_FONT_SCALE_STEPS.forEach((s, i) => {
      expect(chatFontScaleIndex(s)).toBe(i);
    });
  });

  it('ค่าพังคืน index 0 (ขั้นแรก) ไม่ใช่ -1', () => {
    /* -1 จะทำให้ seekbar เด้งไปตำแหน่งที่ไม่มีอยู่จริง */
    for (const bad of [undefined, null, 'x', NaN, 999]) {
      expect(chatFontScaleIndex(bad)).toBeGreaterThanOrEqual(0);
    }
    expect(chatFontScaleIndex(undefined)).toBe(0);
  });

  it('index → ค่า และกลับมา index เดิม (round trip)', () => {
    for (let i = 0; i < CHAT_FONT_SCALE_STEPS.length; i++) {
      expect(chatFontScaleIndex(chatFontScaleAt(i))).toBe(i);
    }
  });

  it('index นอกช่วงคืนค่าเริ่มต้น ไม่ throw', () => {
    for (const bad of [-1, 6, 99, 1.5, NaN]) {
      expect(() => chatFontScaleAt(bad)).not.toThrow();
      expect(chatFontScaleAt(bad)).toBe(CHAT_FONT_SCALE_DEFAULT);
    }
  });
});

describe('[CHATFONT] ⭐⭐⭐ ห้ามปนกับค่าฟันเฟืองเดิม', () => {
  it('path ไม่ชนกับ ui.fontScale / ui.chatFont', () => {
    /* `ui.fontScale` (0.9–1.2 ทั้งแอป) และ `ui.chatFont` (โหมดฟอนต์) มีอยู่แล้ว
       เจ้าของสั่งว่า "ค่าเดิมฟันเฟืองไม่ยุ่ง" */
    expect(CHAT_FONT_SCALE_PATH).not.toBe('ui.fontScale');
    expect(CHAT_FONT_SCALE_PATH).not.toBe('ui.chatFont');
    expect(CHAT_FONT_SCALE_PATH.startsWith('ui.')).toBe(true);
  });

  it('⭐ ช่วงค่าไม่ทับกับของฟันเฟือง (0.9–1.2)', () => {
    /* ถ้าช่วงเท่ากันจะแยกไม่ออกว่าค่าที่เห็นมาจากตัวไหน */
    expect(CHAT_FONT_SCALE_STEPS[CHAT_FONT_SCALE_STEPS.length - 1]).toBeGreaterThan(1.2);
  });

  it('ชื่อ CSS variable เป็นของตัวเอง ไม่ชนใคร', () => {
    expect(CHAT_FONT_SCALE_VAR).toBe('--tc-chat-scale');
    expect(CHAT_FONT_SCALE_VAR).not.toBe('--app-header-h');
  });
});

describe('[CHATFONT] ป้ายบอกขนาดเป็นคีย์ i18n', () => {
  it('คืนคีย์ ไม่ใช่ข้อความไทย — ผู้เรียกแปลเอง', () => {
    expect(chatFontScaleLabelKey(1.0)).toBe('ticket.chat_font_step_1');
    expect(chatFontScaleLabelKey(2.0)).toBe('ticket.chat_font_step_6');
  });

  it('ค่าพังยังได้คีย์ที่ใช้ได้', () => {
    expect(chatFontScaleLabelKey(undefined)).toBe('ticket.chat_font_step_1');
  });
});

describe('[CHATFONT] CSS มีกฎครบตามที่ helper สัญญาไว้', () => {
  const css = () => readFileSync(join(__dirname, '..', 'index.css'), 'utf8');

  /**
   * เฉพาะ "โค้ด" ของบล็อกนี้ — ตัดคอมเมนต์ออกทั้งหมด
   *
   * ⚠️ ต้องเริ่มจาก `/*` ที่เปิดบล็อก ไม่ใช่จากตำแหน่งของ marker
   * เพราะ marker อยู่ *กลาง* คอมเมนต์ ⇒ slice จากตรงนั้นจะไม่มี `/*` ให้จับคู่
   * แล้ว regex ตัดคอมเมนต์จะไม่ทำงาน (เจอจริงตอนเขียนเทสนี้)
   */
  /**
   * [FIX-20260909-LOADINGLOOK] 🔴 บล็อกนี้ **จบตรงที่บล็อกถัดไปเริ่ม** ไม่ใช่ท้ายไฟล์
   *
   * ของเดิม `slice(open)` = "ตั้งแต่ CHATFONT ไปจนสุดไฟล์" ซึ่งถูกอยู่ตราบใดที่
   * CHATFONT เป็นบล็อกสุดท้าย — พอมีใครต่อท้าย `index.css` (รอบนี้คือ keyframe
   * ของลูกกลม loading) เคส "ทุก selector ต้องขึ้นต้นด้วย `.tc-col-center`"
   * ก็แดงทันที ทั้งที่บล็อก CHATFONT ไม่ได้ถูกแตะเลยสักตัวอักษร
   *
   * ⇒ ตัดที่ marker ตัวถัดไปที่อยู่ต้นบรรทัด (`/* [`) · ถ้าไม่มี = ยังเป็นบล็อก
   *   สุดท้ายจริง ก็อ่านถึงท้ายไฟล์เหมือนเดิม ⇒ พฤติกรรมเดิมทุกประการวันนี้
   *   แต่การเขียน CSS ใหม่ต่อท้ายไฟล์เลิกทำให้เคสนี้แดงโดยไม่มีเหตุผล
   */
  const blockCode = (): string => {
    const src = css();
    const marker = src.indexOf('[FEAT-20260830-CHATFONT]');
    const open = src.lastIndexOf('/*', marker);
    const next = src.indexOf('\n/* [', marker);
    return src
      .slice(open, next === -1 ? undefined : next)
      .replace(/\/\*[\s\S]*?\*\//g, '');
  };

  it('⭐⭐ ตัวแปรมีค่าตั้งต้น = 1 ⇒ ยังไม่ทา JS ก็หน้าตาเดิม', () => {
    expect(css()).toMatch(/\.tc-col-center\s*\{[^}]*--tc-chat-scale:\s*1;/);
  });

  it('⭐⭐⭐ คูณสติกเกอร์และไอคอนด้วย ไม่ใช่แค่ตัวอักษร', () => {
    /* เจ้าของสั่ง "ตามด้วย" — ถ้าโตแค่ตัวหนังสือจะได้ป้ายใหญ่คู่รูปจิ๋ว */
    const s = css();
    expect(s).toContain('.tc-col-center svg {');
    expect(s).toContain('.tc-col-center .w-12');
  });

  it('⭐ ไม่ใช้ !important (ตามแบบอย่าง .bcast-form-lg)', () => {
    /* ⚠️ ต้องตัดคอมเมนต์ทิ้งก่อน — คอมเมนต์ของบล็อกนี้ *พูดถึง* คำว่า
       !important เพื่ออธิบายว่าทำไมถึงไม่ใช้ ถ้าไม่ตัดจะจับตัวเองแล้วแดง
       ทั้งที่โค้ดถูก (เจอจริงตอนเขียนเทสนี้) */
    const block = blockCode();
    expect(block).not.toContain('!important');
  });

  it('⭐⭐ ไม่ตั้ง color — dark mode คุมสีอยู่ ถ้าใส่จะตีกัน', () => {
    /* [FIX-20260909-LOADINGLOOK] ใช้ `blockCode()` ตัวเดียวกับเคสอื่น — ของเดิม
       slice ถึงท้ายไฟล์เอง จึงจะไปอ่าน `color:` ของบล็อกที่ต่อท้ายมาทีหลัง */
    const rules = blockCode()
      .split('\n')
      .filter((l) => /^\s*color\s*:/.test(l));
    expect(rules).toEqual([]);
  });

  it('⭐⭐⭐ ทุกกฎ scope ใต้ .tc-col-center — ไม่รั่วไปซ้าย/ขวา/header/menu', () => {
    /* นี่คือเคสที่ปกป้องคำสั่งหลักของเจ้าของ: "เฉพาะช่องกลาง ห้ามยุ่งที่อื่น".
       ⚠️ กฎส่วนใหญ่เขียนบรรทัดเดียวจบ (`.x { ... }`) ไม่ได้ลงท้ายด้วย `{`
       จึงต้องดึง selector จากทุกบล็อกจริง ไม่ใช่ดูแค่บรรทัดที่ลงท้าย `{` */
    const block = blockCode();
    const selectors = [...block.matchAll(/(^|\})\s*([^{}]+?)\s*\{/g)]
      .map((m) => m[2]!.trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    for (const sel of selectors) {
      for (const one of sel.split(',')) {
        expect(one.trim().startsWith('.tc-col-center')).toBe(true);
      }
    }
  });
});
