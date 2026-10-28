/**
 * [FEAT-2708-HEADERROW] ปุ่มค้นหา/ปิดเคส ย้ายลงมาแถวเดียวกับเกจโควตา
 * ===========================================================================
 * เจ้าของ 27/08 พร้อมภาพ: "ย้ายปุ่ม แว่นขยาย กับ ปิดเคส ลงมาแถวเดียวกับเกจ"
 * — หัวห้องเดิมเป็นสองคอลัมน์ (ชื่อซ้าย / ปุ่มขวา) ทำให้ปุ่มลอยอยู่แถวบนคนละ
 * ระดับกับเกจ · ตอนนี้ปุ่มอยู่ใน "แถวสอง" เดียวกับ OA + ⓘ + เกจ
 *
 * mount ของจริงด้วย props ชุดเดียวกับที่ Contact ใช้ (harness เดียวกับ
 * contactChatTab.dom.test.tsx) — ตรวจจาก DOM ไม่ใช่การอ่านซอร์ส
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  /* jsdom ไม่มี scrollIntoView — ChatRoomView เรียกตอน mount */
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  Element.prototype.scrollIntoView = vi.fn();
});

const mountHeader = async () => {
  vi.doMock('../services/chat', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        getMessages: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      useTicketWS: () => undefined,
    };
  });
  const { render } = await import('@testing-library/react');
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: { _id: 'm1', display_name: 'judy' },
  } as never;
  return render(
    <ChatRoomView room={room} hookId="hook1" oaName="omnidesk-dev-oa-three" showDetailBox={false} memberId="m1" memberData={{ _id: 'm1' }} />,
  );
};

describe('[HEADERROW] ปุ่มควบคุมอยู่แถวเดียวกับเกจ', () => {
  it('⭐⭐ ปุ่มค้นหาอยู่ในแถวเดียวกับที่เกจ/ⓘ อยู่ — ไม่ใช่คนละแถว', async () => {
    const { container } = await mountHeader();
    /* ปุ่ม ⓘ โควตาเป็นหมุดของ "แถวสอง" (มันอยู่ข้างเกจเสมอ) */
    const info = container.querySelector('button[title="โควตาข้อความของ LINE OA นี้"]');
    const search = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('title') || '').includes('ค้นหาข้อความในห้องนี้'),
    );
    expect(info, 'ปุ่ม ⓘ ต้องมี').not.toBeNull();
    expect(search, 'ปุ่มค้นหาต้องมี').toBeTruthy();
    expect(
      info!.parentElement,
      'ปุ่มค้นหาต้องอยู่ใน element เดียวกับปุ่ม ⓘ (แถวสอง)',
    ).toBe(search!.closest('div')?.parentElement ?? search!.parentElement);
  });
});
