/* [UI-20260814-FILTERMENUFONT] ขนาดฟอนต์ในเมนู SearchableSelect
 * ===========================================================================
 * เจ้าของสั่ง 14/08: "สาม filter นี้ หน้า ticket เวลาเปิด dropdown (font ข้างในใหญ่ขึ้น +20%)"
 *
 * ⚠️ เคสที่สำคัญที่สุดคือเคส NO-OP — component ตัวนี้ถูกใช้ 11 จุด (TicketChat 8 ·
 *    Contact 3) ถ้าเผลอไปแก้ค่า default แทนที่จะทำเป็น prop opt-in ทุกดรอปดาวน์
 *    ในระบบจะเปลี่ยนขนาดตามโดยที่เจ้าของสั่งมาแค่ 3 ตัว และจะไม่มีอะไรฟ้อง
 *    เพราะมันคือ "แค่ CSS class" ที่ compile ผ่านเสมอ
 *
 * ⚠️ ทำไมต้อง render จริงไม่ใช่เทสตรรกะ: ของที่ต้องพิสูจน์คือคลาสไปโผล่ที่ DOM
 *    ของเมนูจริง ๆ (ช่องค้นหา + ตัวเลือก) การเทสฟังก์ชันประกอบ string จะผ่าน
 *    แม้ prop ไม่ได้ถูกส่งต่อไปถึง element
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchableSelect } from '../components/member/SearchableSelect';

const OPTS = [
  { value: '', label: 'OA ทั้งหมด' },
  { value: 'h1', label: 'omnidesk-dev-oa' },
];

/** เปิดดรอปดาวน์แล้วคืน element ของช่องค้นหา + ปุ่มตัวเลือก */
function openMenu(searchPlaceholder = 'ค้นหา OA...') {
  fireEvent.click(screen.getAllByRole('button')[0]!);
  const input = screen.getByPlaceholderText(searchPlaceholder);
  const opt = screen.getByText('omnidesk-dev-oa');
  return { input, opt };
}

describe('[FILTER MENU FONT] ส่ง menuTextClass = ฟอนต์ในเมนูใหญ่ขึ้น', () => {
  it('⭐ ส่ง text-[14.4px] → ช่องค้นหาและตัวเลือกใช้คลาสนั้น ไม่ใช่ text-xs', () => {
    render(
      <SearchableSelect
        value=""
        options={OPTS}
        onChange={vi.fn()}
        placeholder="OA ทั้งหมด"
        searchPlaceholder="ค้นหา OA..."
        menuTextClass="text-[14.4px]"
      />,
    );
    const { input, opt } = openMenu();

    expect(input.className).toContain('text-[14.4px]');
    expect(input.className).not.toContain('text-xs');

    // ตัวเลือกคือ <span> ข้างใน <button> — คลาสอยู่ที่ปุ่ม
    const optBtn = opt.closest('button')!;
    expect(optBtn.className).toContain('text-[14.4px]');
    expect(optBtn.className).not.toContain('text-xs');
  });

  it('⭐⭐ ไม่ส่ง prop → ได้ text-xs เหมือนเดิมเป๊ะ (no-op กับอีก 8 จุดที่ไม่ได้สั่ง)', () => {
    /* เคสนี้คือด่านกันของจริง: ถ้าใครไปแก้ default ในไฟล์ component
       (แทนที่จะปล่อยให้เป็น opt-in) เทสนี้จะแดงทันที */
    render(
      <SearchableSelect
        value=""
        options={OPTS}
        onChange={vi.fn()}
        placeholder="OA ทั้งหมด"
        searchPlaceholder="ค้นหา OA..."
      />,
    );
    const { input, opt } = openMenu();

    expect(input.className).toContain('text-xs');
    expect(input.className).not.toContain('14.4px');
    expect(opt.closest('button')!.className).toContain('text-xs');
  });

  it('ปุ่ม trigger ที่ปิดอยู่ยังเป็น text-xs เสมอ (ความสูงแถวตัวกรองห้ามขยับ)', () => {
    /* ถ้าขนาดปุ่มโตตาม grid 3 คอลัมน์ของแถวตัวกรองจะเบียด — เจ้าของสั่งแค่
       "เวลาเปิด dropdown" เท่านั้น */
    render(
      <SearchableSelect
        value=""
        options={OPTS}
        onChange={vi.fn()}
        placeholder="OA ทั้งหมด"
        menuTextClass="text-[14.4px]"
      />,
    );
    const trigger = screen.getAllByRole('button')[0]!;
    expect(trigger.className).toContain('text-xs');
    expect(trigger.className).not.toContain('14.4px');
  });

  it('พฤติกรรมเลือกค่ายังทำงานเหมือนเดิม (prop นี้ไม่แตะ logic)', () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        value=""
        options={OPTS}
        onChange={onChange}
        placeholder="OA ทั้งหมด"
        searchPlaceholder="ค้นหา OA..."
        menuTextClass="text-[14.4px]"
      />,
    );
    const { opt } = openMenu();
    fireEvent.click(opt);
    expect(onChange).toHaveBeenCalledWith('h1');
  });

  it('ข้อความ "ไม่พบรายการ" ใช้ขนาดเดียวกับเมนู', () => {
    render(
      <SearchableSelect
        value=""
        options={OPTS}
        onChange={vi.fn()}
        placeholder="OA ทั้งหมด"
        searchPlaceholder="ค้นหา OA..."
        menuTextClass="text-[14.4px]"
      />,
    );
    const { input } = openMenu();
    fireEvent.change(input, { target: { value: 'ไม่มีทางเจอ' } });
    const empty = screen.getByText('ไม่พบรายการ');
    expect(empty.className).toContain('text-[14.4px]');
  });
});
