/* [FEAT-20260817-SELECTROWS] เมนู 15 แถวแล้วค่อย scroll + label ยาวให้ wrap
 * ===========================================================================
 * เจ้าของสั่ง 17/08: "Select option หน้า webhook log + audit log + slip ต้องเป็น select
 * แบบมี search + wrap ความยาว 15 แถว wrap scroll".
 *
 * ⚠️ เคสสำคัญที่สุดคือ NO-OP — `components/common/SearchableSelect` ถูกใช้หลายหน้า
 *    (webhook logs · handoff history · assign history · group picker · insight tabs)
 *    ถ้าเผลอแก้ค่า default แทนที่จะทำ prop opt-in ทุกดรอปดาวน์จะสูงขึ้น/ตัดคำเปลี่ยน
 *    ตามหมด โดยไม่มีอะไรฟ้อง เพราะมันคือ "แค่ CSS class" ที่ compile ผ่านเสมอ
 *    (บทเรียนเดียวกับ searchableSelectMenuFont.dom.test.tsx)
 *
 * ⚠️ ต้อง render จริง: ของที่พิสูจน์คือคลาส/สไตล์ไปโผล่บน element ของเมนูจริง —
 *    เทสตรรกะประกอบ string จะผ่านแม้ prop ไม่ถูกส่งต่อไปถึง DOM
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SearchableSelect } from '../components/common/SearchableSelect';

const LONG = 'ตัวเลือกที่ชื่อยาวมากจนต้องตัดหรือขึ้นบรรทัดใหม่ ถ้าไม่ wrap จะอ่านไม่ครบ';
const OPTS = [
  { value: '', label: 'ทั้งหมด' },
  { value: 'a', label: LONG },
];

/** เปิดเมนูแล้วคืน container ของลิสต์ (div ที่ scroll) + span ของ label ตัวยาว */
function openMenu() {
  fireEvent.click(screen.getAllByRole('button')[0]!);
  const label = screen.getByText(LONG);
  // ลิสต์คือ parent ของปุ่มตัวเลือก (label → button → list)
  const list = label.closest('button')!.parentElement as HTMLElement;
  return { label, list };
}

describe('[SELECTROWS] default = พฤติกรรมเดิมเป๊ะ (NO-OP)', () => {
  it('⭐ ไม่ส่ง prop → ลิสต์ยังเป็น max-h-60 และไม่มี inline maxHeight', () => {
    render(<SearchableSelect value="" options={OPTS} onChange={vi.fn()} />);
    const { list } = openMenu();
    expect(list.className).toContain('max-h-60');
    expect(list.style.maxHeight).toBe('');
  });

  it('⭐ ไม่ส่ง prop → label ยังเป็น truncate ไม่ใช่ wrap', () => {
    render(<SearchableSelect value="" options={OPTS} onChange={vi.fn()} />);
    const { label } = openMenu();
    expect(label.className).toContain('truncate');
    expect(label.className).not.toContain('break-words');
  });
});

describe('[SELECTROWS] maxRows / wrapLabel = opt-in', () => {
  it('maxRows={15} → สูง 15 แถว (540px) และทิ้ง max-h-60 ไป', () => {
    render(<SearchableSelect value="" options={OPTS} onChange={vi.fn()} maxRows={15} />);
    const { list } = openMenu();
    // 15 แถว × 36px (px-3 py-2 text-sm) — ถ้าเลขนี้เปลี่ยน แถวจะไม่ตรงกับที่สั่ง
    expect(list.style.maxHeight).toBe('540px');
    expect(list.className).not.toContain('max-h-60');
    expect(list.className).toContain('overflow-y-auto');
  });

  it('maxRows อื่น ๆ คิดตามจำนวนแถวจริง ไม่ใช่ค่าคงที่ตัวเดียว', () => {
    render(<SearchableSelect value="" options={OPTS} onChange={vi.fn()} maxRows={5} />);
    const { list } = openMenu();
    expect(list.style.maxHeight).toBe('180px');
  });

  it('wrapLabel → label ขึ้นบรรทัดใหม่ได้ ไม่ถูกตัดด้วย …', () => {
    render(<SearchableSelect value="" options={OPTS} onChange={vi.fn()} wrapLabel />);
    const { label } = openMenu();
    expect(label.className).toContain('break-words');
    expect(label.className).toContain('whitespace-normal');
    expect(label.className).not.toContain('truncate');
  });

  it('ของเดิมยังทำงาน: ค้นหาแล้วเลือกได้ตามปกติ', () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect value="" options={OPTS} onChange={onChange} maxRows={15} wrapLabel />,
    );
    openMenu();
    fireEvent.change(screen.getByPlaceholderText('ค้นหา…'), { target: { value: 'ยาวมาก' } });
    fireEvent.click(screen.getByText(LONG));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

/**
 * หน้าที่เจ้าของสั่งต้องใช้ตัวนี้จริง — สามหน้านั้นใหญ่เกินกว่าจะ render ใน vitest
 * (2 หน้าเป็น log page ที่มี timer + service) จึงล็อกที่ source ว่าไม่มี native
 * <select> ของ filter เหลืออยู่ และส่ง prop ครบ
 */
describe('[SELECTROWS] สามหน้านั้นใช้ตัวนี้จริง', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

  it('slip / audit เปลี่ยนจาก native <select> เป็น SearchableSelect + maxRows', () => {
    for (const rel of ['pages/content/SlipVerification.tsx', 'pages/admin/AuditLogs.tsx']) {
      const code = read(rel);
      expect(code).toMatch(/<SearchableSelect[\s\S]{0,400}maxRows=\{15\}[\s\S]{0,80}wrapLabel/);
      // ตัว filter เดิมต้องไม่เหลือเป็น <select> อีก (หน้าอื่นในไฟล์อาจมี input อื่นได้)
      expect(code).not.toMatch(/<select[\s\S]{0,200}(apiStatus|actionFilter)/);
    }
  });

  it('webhook logs: ทั้งสาม filter ได้ prop ครบ', () => {
    const code = read('pages/hook/WebhookLogs.tsx');
    const optedIn = code.match(/<SearchableSelect[^/]*maxRows=\{15\} wrapLabel \/>/g) ?? [];
    expect(optedIn.length).toBe(3);
  });
});
