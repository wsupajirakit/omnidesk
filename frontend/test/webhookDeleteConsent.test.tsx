import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConfirmConsentCheck } from '../components/modals/ConfirmConsentCheck';
import { ConfirmModal } from '../components/modals/ConfirmModal';

/**
 * [UI-20260826-DELCONSENT] ช่องติ๊กกันลบ webhook พลาด — เทสที่ feature นี้ไม่เคยมี
 * ============================================================================
 * ของถูกสร้างเมื่อ 26/08 (commit 81a7c4c) แต่**ไม่มีเทสสักเคส** — กติกาที่กันคน
 * ลบพลาดทั้ง OA จึงถอดออกได้เงียบ ๆ โดยไม่มีอะไรแดง เทสชุดนี้ปักกติกา 3 ข้อ:
 *   1. ปุ่มยืนยันกดไม่ได้จนกว่าจะติ๊ก (ปุ่มจริง ไม่ใช่แค่ prop)
 *   2. แถบทั้งแถบกดได้ ไม่ใช่แค่กล่องเล็ก ("ใหญ่ ๆ กดง่าย" ที่เจ้าของสั่ง)
 *   3. เปิดใหม่ทุกครั้งต้องเริ่มไม่ติ๊ก (ทั้งลบเดี่ยวและลบหลายตัว)
 */

describe('ConfirmConsentCheck — แถบติ๊กใหญ่', () => {
  it('⭐ กดที่ข้อความ (ไม่ใช่กล่อง) ก็ติ๊กได้ — คือ "ใหญ่ ๆ กดง่าย"', () => {
    const onChange = vi.fn();
    render(
      <ConfirmConsentCheck checked={false} onChange={onChange} label="เข้าใจแล้วว่ากำลังลบ" />,
    );
    fireEvent.click(screen.getByText('เข้าใจแล้วว่ากำลังลบ'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ติ๊กแล้วกดซ้ำ = เอาออก', () => {
    const onChange = vi.fn();
    render(
      <ConfirmConsentCheck checked onChange={onChange} label="x" />,
    );
    fireEvent.click(screen.getByTestId('confirm-consent'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('ConfirmModal + consent — ปุ่มยืนยันถูกล็อกจริง', () => {
  /** จำลอง wiring เดียวกับ WebhookList เป๊ะ: state อยู่ข้างนอก ปุ่มอ่านค่าเดียวกัน */
  const Harness: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
    const [consent, setConsent] = useState(false);
    return (
      <ConfirmModal
        isOpen
        onClose={() => {}}
        onConfirm={onConfirm}
        confirmDisabled={!consent}
        title="ลบ webhook"
        message="msg"
        type="danger"
      >
        <ConfirmConsentCheck checked={consent} onChange={setConsent} label="เข้าใจแล้ว" />
      </ConfirmModal>
    );
  };

  it('🔴 ยังไม่ติ๊ก ⇒ กดยืนยันแล้วต้องไม่เกิดอะไรเลย', () => {
    /* mutation ที่เคสนี้ฆ่า: ถอด `disabled={confirmDisabled}` ออกจากปุ่มใน
       ConfirmModal — ทุกอย่างยังหน้าตาเหมือนเดิม แต่กติกากันพลาดหายทั้งชั้น */
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const btn = screen.getByRole('button', { name: /ยืนยัน|confirm/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ติ๊กแล้ว ⇒ ปุ่มเปิด กดแล้ว onConfirm ทำงาน', () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('เข้าใจแล้ว'));
    const btn = screen.getByRole('button', { name: /ยืนยัน|confirm/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('WebhookList wiring — เปิดใหม่ต้องเริ่มไม่ติ๊กเสมอ', () => {
  /* ระดับซอร์สแบบเดียวกับ dropUp/avatarOverlay call-site tests — สิ่งที่พังได้
     คือ "จุดเรียกลืมล้าง state" ซึ่ง mount ทั้งหน้าเพื่อพิสูจน์ไม่คุ้ม */
  const SRC = readFileSync(
    join(process.cwd(), 'pages/hook/WebhookList.tsx'),
    'utf8',
  );

  it('⭐ ทั้งลบเดี่ยวและลบหลายตัว ล้างติ๊กก่อนเปิด modal', () => {
    /* 🔴 mutation: ลบ setDeleteConsent(false) ออกจาก handler ใดตัวหนึ่ง —
       รอบสองจะเปิดมาแบบ "ติ๊กค้าง" ซึ่งอันตรายกว่าไม่มี checkbox เสียอีก */
    const singles = SRC.match(/setDeleteConsent\(false\);\s*\n\s*setIsDeleteOpen\(true\)/g) ?? [];
    expect(singles.length).toBe(2);
  });

  it('ปุ่มยืนยันของ modal ลบ ผูกกับ consent จริง', () => {
    expect(SRC).toMatch(/confirmDisabled=\{!deleteConsent\}/);
  });

  it('ปิด modal ก็ล้างติ๊กด้วย', () => {
    expect(SRC).toMatch(/setIsDeleteOpen\(false\); setDeleteConsent\(false\)/);
  });
});
