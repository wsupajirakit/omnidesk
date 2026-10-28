/* [FIX-20260817-GROUPPAGER] เลขหน้า + per page · [FEAT-20260817-GROUPBULKSTATUS] แถบงานหมู่
 * ===========================================================================
 * อาการที่รายงานในหน้า group: ไม่มีเลขหน้าแสดง — ของเดิมมีแค่ลูกศร ◀ ▶
 * ไม่มีเลขหน้า ไม่มีตัวเลือกจำนวนต่อหน้า และ "แสดง x-y จาก z" นับจากแถวบนหน้าจอ
 * (client-filter) ขณะที่ total มาจาก server ⇒ ตัวเลขไม่ตรงกัน
 *
 * เทสนี้ render component จริง เพราะของที่ต้องพิสูจน์คือ **เลขไปโผล่บน DOM** และปุ่ม
 * ถูก disable ที่ขอบจริง — เทสตรรกะประกอบ string จะผ่านแม้ไม่มีอะไรขึ้นจอ
 * (หน้า Groups.tsx เอง render ใน vitest ไม่ได้: fetch ตอน mount + poll 20 วิ
 *  จึงล็อกส่วนที่เหลือด้วย source-assert ท้ายไฟล์)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { GroupTablePager } from '../components/admin/groups/GroupTablePager';
import { GroupBulkStatusBar } from '../components/admin/groups/GroupBulkStatusBar';

const LABELS = {
  selected: 'เลือกแล้ว',
  active: 'ใช้งาน',
  inactive: 'ปิด',
  // [FIX-20260817-BULKCANCEL] ปุ่มออกจากการเลือก = "ยกเลิก" (common.cancel) ไม่ใช่ "ล้างค่า"
  cancel: 'ยกเลิก',
};

describe('[GROUPPAGER] เลขหน้าต้องขึ้น', () => {
  it('⭐ แสดง "หน้าปัจจุบัน / ทั้งหมด" ไม่ใช่มีแต่ลูกศร', () => {
    render(
      <GroupTablePager
        page={2}
        totalPages={5}
        perPage={25}
        onPageChange={vi.fn()}
        onPerPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('/')).toBeTruthy();
  });

  it('⭐ มีตัวเลือกจำนวนต่อหน้า 25/50/100 และเรียก callback เป็นตัวเลข', () => {
    const onPerPageChange = vi.fn();
    render(
      <GroupTablePager
        page={1}
        totalPages={1}
        perPage={25}
        onPageChange={vi.fn()}
        onPerPageChange={onPerPageChange}
      />,
    );
    const select = screen.getByLabelText('rows per page') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['25', '50', '100']);
    fireEvent.change(select, { target: { value: '100' } });
    expect(onPerPageChange).toHaveBeenCalledWith(100);
  });

  it('ปุ่มถูก disable ที่ขอบ และไม่กระโดดเกินช่วง', () => {
    const onPageChange = vi.fn();
    const { unmount } = render(
      <GroupTablePager
        page={1}
        totalPages={3}
        perPage={25}
        onPageChange={onPageChange}
        onPerPageChange={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('previous page') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('next page'));
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    unmount();

    render(
      <GroupTablePager
        page={3}
        totalPages={3}
        perPage={25}
        onPageChange={onPageChange}
        onPerPageChange={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('next page') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('[GROUPBULKSTATUS] แถบงานหมู่', () => {
  it('⭐ ไม่ได้ติ๊กอะไร = ไม่ render อะไรเลย (หน้าเหมือนเดิมก่อนมีฟีเจอร์)', () => {
    const { container } = render(
      <GroupBulkStatusBar count={0} onChoose={vi.fn()} onClear={vi.fn()} labels={LABELS} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('⭐ ติ๊กแล้วโชว์จำนวน และปุ่มส่งค่า true/false ให้ถูกตัว', () => {
    const onChoose = vi.fn();
    render(
      <GroupBulkStatusBar count={3} onChoose={onChoose} onClear={vi.fn()} labels={LABELS} />,
    );
    expect(screen.getByText(/เลือกแล้ว/).textContent).toContain('3');

    fireEvent.click(screen.getByText('ใช้งาน'));
    expect(onChoose).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText('ปิด'));
    expect(onChoose).toHaveBeenLastCalledWith(false);
  });

  it('⭐ ปุ่มยกเลิกอยู่ซ้ายสุดของแถบ และเรียก onClear ไม่ใช่ onChoose', () => {
    const onChoose = vi.fn();
    const onClear = vi.fn();
    render(
      <GroupBulkStatusBar count={2} onChoose={onChoose} onClear={onClear} labels={LABELS} />,
    );
    const cancel = screen.getByText('ยกเลิก');
    fireEvent.click(cancel);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
    // ตำแหน่ง: ต้องเป็น element แรกในแถบ (ข้อกำหนด: อยู่ซ้าย) และไม่มี ml-auto ดันไปขวา
    const bar = cancel.parentElement!;
    expect(bar.firstElementChild).toBe(cancel);
    expect(cancel.className).not.toContain('ml-auto');
    /* [UI-20260817-BULKCANCELORANGE] "ส้มชัดและใหญ่" — ล็อกไว้เพราะถ้ามีใครเปลี่ยน
       กลับเป็นลิงก์ตัวอักษรเล็กสีเทา จะไม่มีอะไรฟ้อง (มันคือแค่ CSS class) */
    expect(cancel.className).toContain('bg-orange-500');
    expect(cancel.className).toContain('py-2');
    expect(cancel.className).not.toContain('text-xs');
    expect(cancel.className).not.toContain('underline');
  });
});

/**
 * ส่วนที่ต้องล็อกในหน้าเพจเอง — render ไม่ได้ จึง assert ที่ source
 * (แพตเทิร์นเดียวกับ searchableSelectRows.dom.test.tsx / ticketTagFilterOptions)
 */
describe('[GROUPPAGER/GROUPSEARCH] หน้า Groups ต่อสายไว้จริง', () => {
  const code = readFileSync(resolve(__dirname, '../pages/admin/Groups.tsx'), 'utf8');

  it('⭐ ค้นหาไปที่ server (group_name) ไม่ใช่กรองแถวบนหน้า', () => {
    expect(code).toContain('group_name: searchQuery.trim() || undefined');
    // ตัวกรอง client-side ตัวเก่าต้องหายไปแล้ว ไม่งั้นเลขหน้ากับผลลัพธ์ไม่ตรงกันอีก
    expect(code).not.toContain('filteredGroups');
  });

  it('⭐ "แสดง x-y จาก z" นับจาก totalItems ของ server', () => {
    expect(code).toContain('total: totalItems');
    expect(code).toMatch(/from: totalItems > 0 \? \(currentPage - 1\) \* perPage \+ 1 : 0/);
  });

  it('per page เป็น state ไม่ใช่ค่าคงที่ 25 อีก', () => {
    expect(code).toContain('const [perPage, setPerPage] = useState(25)');
    expect(code).not.toContain('const itemsPerPage = 25');
  });

  it('เปลี่ยนหน้า/ตัวกรอง แล้วล้างการเลือก (กัน bulk โดนแถวที่มองไม่เห็น)', () => {
    expect(code).toMatch(/setSelectedIds\(new Set\(\)\);[\s\S]{0,120}\[currentPage, perPage, searchQuery, statusFilter\]/);
  });

  it('ค้นหามี debounce ไม่ยิงทุกตัวอักษร', () => {
    expect(code).toMatch(/setTimeout\(\(\) => setSearchQuery\(search\), 350\)/);
  });
});
