import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  CloseCaseFollowUpChoice,
  closeCaseNeedsFollowUpChoice,
} from '../components/member/follow-up/CloseCaseFollowUpChoice';
import type { ChatRoom } from '../services/chat/chatService';

/**
 * [FEAT-20260826-CLOSECLEARFU] ปิดเคสแล้วเลือกว่าจะตามการสมัครต่อไหม
 * ===========================================================================
 * เจ้าของสั่ง 26/08: ตอนกดปิดเคส ถ้า member มี **ครบทั้งสอง** stamp ให้ขึ้นสองช่อง
 * ให้เลือก · ติ๊กได้อันเดียว · ไม่ติ๊กเลยต้องกดยืนยันไม่ได้ · **ถ้าไม่มีครบสองค่า
 * ต้องไม่มีช่องอะไรโผล่เลย และปิดเคสต้องทำงานเหมือนเดิมทุกประการ**
 *
 * ข้อสุดท้ายคือข้อที่เทสชุดนี้มีไว้เพื่อพิสูจน์ — ของใหม่ที่ทำให้ของเดิมพัง
 * ไม่ใช่ของใหม่ที่ใช้ได้
 */

const room = (line: Record<string, unknown> | null): ChatRoom =>
  ({
    _id: 'r1',
    user_data: line === null ? {} : { config: { follow_up: { line } } },
  }) as unknown as ChatRoom;

const BOTH = {
  abandon_trigger_at: '2026-08-20T03:00:00.000Z',
  request_reg_at: '2026-08-19T03:00:00.000Z',
};

describe('closeCaseNeedsFollowUpChoice — เมื่อไหร่ถึงจะขึ้นช่องให้เลือก', () => {
  it('ขึ้น เมื่อกำลังปิดเคส และมีครบทั้งสองค่า', () => {
    expect(closeCaseNeedsFollowUpChoice(room(BOTH), 2)).toBe(true);
  });

  it('🔴 ไม่ขึ้น เมื่อเป็นการ "รับเคส" ไม่ใช่ปิดเคส', () => {
    /* กล่องยืนยันใบนี้ใช้ร่วมกันระหว่างรับเคส (targetStatus 1) กับปิดเคส (2) —
       ดู title ที่ TicketChat สลับตาม targetStatus · ถ้าเช็คแต่ "มีสองค่าไหม"
       ช่องจะไปโผล่ตอนกดรับเคสด้วย ซึ่งผิดสนิท */
    expect(closeCaseNeedsFollowUpChoice(room(BOTH), 1)).toBe(false);
  });

  it.each([
    ['มีแต่ abandon', { abandon_trigger_at: BOTH.abandon_trigger_at }],
    ['มีแต่ request_reg', { request_reg_at: BOTH.request_reg_at }],
    ['ไม่มีสักค่า', {}],
  ])('ไม่ขึ้น เมื่อ %s', (_l, line) => {
    expect(closeCaseNeedsFollowUpChoice(room(line), 2)).toBe(false);
  });

  it('ไม่ขึ้น เมื่อไม่มี room เลย', () => {
    expect(closeCaseNeedsFollowUpChoice(null, 2)).toBe(false);
  });

  it('ค่า null นับว่าไม่มี ไม่ใช่มี', () => {
    // BE เคลียร์ด้วย $unset แต่แถวเก่าอาจถือ null ไว้ — อ่าน null ว่า "มีค่า"
    // จะทำให้คนที่เคยถูกเคลียร์ไปแล้วโดนถามซ้ำ
    expect(
      closeCaseNeedsFollowUpChoice(
        room({ ...BOTH, abandon_trigger_at: null }),
        2,
      ),
    ).toBe(false);
  });
});

describe('CloseCaseFollowUpChoice — ตัวเลือกสองช่อง', () => {
  it('แสดงสองตัวเลือก และเริ่มต้นยังไม่เลือกอะไร', () => {
    render(<CloseCaseFollowUpChoice value={null} onChange={vi.fn()} />);

    expect(screen.getByTestId('close-case-stop-follow')).toBeTruthy();
    expect(screen.getByTestId('close-case-keep-follow')).toBeTruthy();
    expect(
      screen.getByTestId('close-case-stop-follow').getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByTestId('close-case-keep-follow').getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('เลือกได้ทีละอัน — เลือกอันที่สองแล้วอันแรกต้องหลุด', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <CloseCaseFollowUpChoice value="stop" onChange={onChange} />,
    );
    expect(
      screen.getByTestId('close-case-stop-follow').getAttribute('aria-checked'),
    ).toBe('true');

    rerender(<CloseCaseFollowUpChoice value="keep" onChange={onChange} />);
    // สองอันนี้เป็นทางเลือกที่แยกกันขาด ไม่ใช่ consent สองใบที่ติ๊กพร้อมกันได้
    expect(
      screen.getByTestId('close-case-stop-follow').getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByTestId('close-case-keep-follow').getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('กดแล้วรายงานค่าที่เลือกขึ้นไปให้ผู้เรียก', () => {
    const onChange = vi.fn();
    render(<CloseCaseFollowUpChoice value={null} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('close-case-stop-follow'));
    expect(onChange).toHaveBeenCalledWith('stop');

    fireEvent.click(screen.getByTestId('close-case-keep-follow'));
    expect(onChange).toHaveBeenCalledWith('keep');
  });

  it('เตือนให้เลือก เมื่อผู้เรียกบอกว่าพยายามกดยืนยันแล้วแต่ยังไม่ได้เลือก', () => {
    const { container } = render(
      <CloseCaseFollowUpChoice value={null} onChange={vi.fn()} showMissing />,
    );
    // สีแดงมาทีหลัง ไม่ใช่ตั้งแต่เปิดกล่อง — กล่องที่แดงตั้งแต่แรกอ่านเหมือนมีอะไรพัง
    expect(container.querySelectorAll('.border-red-500').length).toBeGreaterThan(
      0,
    );
  });
});
