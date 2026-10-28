/**
 * [FEAT-20260830-TRAYFULL] โหมดการแสดงแผงเครื่องมือ (อิโมจิ · ตอบด่วน · สติกเกอร์)
 *
 * เจ้าของสั่ง 30/08/2026: เลือกได้สองแบบ — ค่าเริ่มต้น / เปิดเต็มจอ ·
 * **ทุกคนได้ค่าเริ่มต้นจนกว่าจะตั้งเอง fallback ห้ามพัง**
 *
 * ── ทำไมเคสพวกนี้คุ้มค่า ────────────────────────────────────────────────────
 * · `usePreference` ไม่ validate ค่าที่เก็บไว้เลย ⇒ ค่าเพี้ยนไหลเข้า UI ได้ตรง ๆ
 *   ถ้าไม่กรอง แผงจะเปิดผิดโหมดโดยไม่มีใครรู้ว่าทำไม
 * · โหมดเต็มจอต้อง **ลบ `max-h-*` เดิมทิ้ง** ไม่ใช่เพิ่มทับ — ถ้าเหลือสองค่า
 *   ผลลัพธ์ขึ้นกับลำดับที่ Tailwind สร้างไฟล์ ซึ่งเดาไม่ได้และจะพังแบบสุ่ม
 */
import { describe, it, expect } from 'vitest';
import {
  CHAT_TRAY_MODE_PATH,
  CHAT_TRAY_MODES,
  CHAT_TRAY_MODE_DEFAULT,
  normalizeChatTrayMode,
  isChatTrayFull,
  chatTrayPanelClass,
} from '../hooks/chatTrayMode';

describe('[TRAYFULL] ⭐⭐⭐ fallback — ไม่เคยตั้งต้องได้ค่าเริ่มต้น', () => {
  it('ค่าเริ่มต้นคือ default ตามที่เจ้าของสั่ง', () => {
    expect(CHAT_TRAY_MODE_DEFAULT).toBe('default');
  });

  it.each([
    ['ไม่เคยตั้ง (undefined)', undefined],
    ['null', null],
    ['สตริงว่าง', ''],
    ['ตัวเลข', 1],
    ['boolean', true],
    ['object', {}],
    ['array', []],
    ['สตริงที่ไม่รู้จัก', 'fullscreen'],
    ['พิมพ์ผิด', 'defualt'],
  ])('%s ⇒ default', (_label, input) => {
    expect(normalizeChatTrayMode(input)).toBe('default');
    expect(isChatTrayFull(input)).toBe(false);
  });

  it('⭐ ค่าที่มีช่องว่าง/ตัวพิมพ์ใหญ่ ยังอ่านออก (ค่าที่คนกรอกมือใน DB)', () => {
    expect(normalizeChatTrayMode(' full ')).toBe('full');
    expect(normalizeChatTrayMode('FULL')).toBe('full');
    expect(normalizeChatTrayMode('Default')).toBe('default');
  });

  it('ค่าที่ถูกต้องคืนตัวเดิม', () => {
    for (const m of CHAT_TRAY_MODES) {
      expect(normalizeChatTrayMode(m)).toBe(m);
    }
  });

  it('isChatTrayFull ตอบ true เฉพาะโหมดเต็มจอ', () => {
    expect(isChatTrayFull('full')).toBe(true);
    expect(isChatTrayFull('default')).toBe(false);
  });
});

describe('[TRAYFULL] path ไม่ชนกับค่าอื่น', () => {
  it('ไม่ชนกับ ui.chatMessageScale / ui.fontScale / ui.chatFont', () => {
    expect(CHAT_TRAY_MODE_PATH).toBe('ui.chatTrayMode');
    for (const other of ['ui.chatMessageScale', 'ui.fontScale', 'ui.chatFont']) {
      expect(CHAT_TRAY_MODE_PATH).not.toBe(other);
    }
  });
});

describe('[TRAYFULL] ⭐⭐ class ของแผง — โหมดปกติต้องไม่เปลี่ยนอะไรเลย', () => {
  const base = 'border-b border-gray-100 bg-white p-2 max-h-40 overflow-y-auto custom-scrollbar';

  /* [FIX-20260830-TRAYCAPSCALE] CONTRACT CHANGED, deliberately.
     This used to require the default mode to return the base string BYTE FOR
     BYTE, expressing the owner's "ถ้าปกติ ทำงานเหมือนเดิม". That rule turned out
     to be what kept a real default-mode bug alive: the scale-tracking caps
     (`.max-h-40` / `.max-h-48` in index.css) are multiplied by
     `--tc-chat-scale`, and the sticker tray re-declares that variable on ITSELF
     at the top step — so its own ceiling grew with the content it was meant to
     bound, and the tray took ~50 of the composer's 55vh. The owner reported
     exactly that on 30/08 (*"บัค (โหมดไม่เต็มจอ)"*): stream gone, textarea
     clipped to a sliver.
     The default mode therefore now gains ONE class, `tc-tray-cap`, whose ceiling
     is written in units no tray override can multiply. Every original class is
     still present and unmodified — the intent of the old rule (nobody who never
     opted in loses anything) is preserved as "nothing is removed or rewritten",
     which is what is asserted below. */
  it('⭐⭐⭐ ทุกโหมดเป็น filler เดียวกัน: ตัด max-h ทิ้ง เติม flex-1 min-h-0', () => {
    /* [FIX-20260830-HALFTRAY] supersedes "default keeps every class": the ROOT
       now decides the composer's share of the screen (half in default, all in
       full) and the tray simply fills its box — per-mode caps (and tc-tray-cap
       with them) are gone, because every cap either got inflated by the
       fixed-scale sticker tray or starved the send row. */
    for (const mode of ['default', undefined, 'ค่าเพี้ยน']) {
      const cls = chatTrayPanelClass(mode, base);
      expect(cls).toContain('flex-1');
      expect(cls).toContain('min-h-0');
      expect(cls).not.toMatch(/max-h-/);
      expect(cls).not.toContain('tc-tray-cap');
      expect(cls).toContain('overflow-y-auto');
    }
  });

  it('⭐⭐ โหมดเต็มจอลบ max-h เดิมทิ้ง ไม่ใช่เพิ่มทับ', () => {
    /* เหลือ max-height สองค่าในคลาสเดียวกัน = ผลลัพธ์ขึ้นกับลำดับใน CSS
       ที่ Tailwind สร้าง ⇒ พังแบบสุ่มและหาสาเหตุยากมาก */
    const full = chatTrayPanelClass('full', base);
    expect(full).not.toMatch(/max-h-/);
  });

  it('โหมดเต็มจอเติม flex-1 และ min-h-0', () => {
    /* min-h-0 คือตัวที่ทำให้ overflow ทำงานจริงใน flex column
       ขาดไปแล้วเนื้อหาจะดันกล่องจนล้นแทนที่จะเลื่อน */
    const full = chatTrayPanelClass('full', base);
    expect(full).toContain('flex-1');
    expect(full).toContain('min-h-0');
  });

  it('เก็บ class อื่นไว้ครบ ไม่ทิ้งพื้นหลัง/เส้นขอบ/scrollbar', () => {
    const full = chatTrayPanelClass('full', base);
    for (const keep of ['border-b', 'bg-white', 'p-2', 'overflow-y-auto', 'custom-scrollbar']) {
      expect(full).toContain(keep);
    }
  });

  it('รองรับ max-h แบบค่าอิสระด้วย (max-h-[46vh])', () => {
    const withVh = 'p-3 max-h-[46vh] overflow-y-auto';
    const full = chatTrayPanelClass('full', withVh);
    expect(full).not.toContain('max-h-[46vh]');
    expect(full).toContain('p-3');
  });

  it('แผงที่ไม่มี max-h อยู่แล้วก็ยังทำงานถูก', () => {
    const noCap = 'border-b border-gray-100 bg-white p-3';
    /* [FIX-20260830-TRAYCAPSCALE] a panel with no cap of its own now gets the
       unscalable ceiling too — that is the point: the ceiling must not depend on
       the panel having remembered to declare a `max-h-*`. */
    /* [FIX-20260830-HALFTRAY] unified: no cap to add or strip — both modes just
       make the panel the filler of its box. */
    expect(chatTrayPanelClass('default', noCap)).toContain(noCap);
    expect(chatTrayPanelClass('default', noCap)).toContain('flex-1');
    expect(chatTrayPanelClass('full', noCap)).toContain('flex-1');
  });

  it('ไม่มีช่องว่างซ้อนกันจนกลายเป็น class ว่าง', () => {
    const full = chatTrayPanelClass('full', base);
    expect(full).not.toMatch(/\s{2,}/);
    expect(full.split(' ').filter((c) => c === '')).toEqual([]);
  });
});
