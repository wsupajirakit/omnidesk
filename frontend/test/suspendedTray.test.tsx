import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SuspendedTray } from '../components/common/suspended/SuspendedTray';
import type { SuspendedEntry } from '../services/strike/strikeService';

/**
 * [FEAT-20260826-STRIKESUSPEND] The header tray — who is the bot ignoring.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * Owner, 26/08, with a screenshot: an icon between the gear and the avatar that
 * glows red while anyone is locked out; clicking it drops a scrollable list of
 * those customers with their name, display name, phone and OA — each copyable —
 * and the tray closes ONLY by its X, never by clicking away.
 */
const rows: SuspendedEntry[] = [
  {
    _id: 's1',
    line_user_id: 'U1',
    seq: 1,
    strike_total: 5,
    suspended_at: '2026-08-26T10:00:00.000Z',
    opened_at: '2026-08-26T08:00:00.000Z',
    full_name: 'สมชาย ใจดี',
    display_name: 'somchai',
    phone_number: '0812345678',
    hook_alias: 'omnideskdevoathree',
  } as SuspendedEntry,
  {
    _id: 's2',
    line_user_id: 'U2',
    seq: 3,
    strike_total: 9,
    suspended_at: '2026-08-26T09:00:00.000Z',
    opened_at: '2026-08-26T07:00:00.000Z',
  } as SuspendedEntry,
];

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('SuspendedTray', () => {
  it('lists everyone it was given', () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    expect(screen.getAllByTestId('suspended-row')).toHaveLength(2);
  });

  it('🔴 shows n/a for every field the customer does not have', () => {
    /* Owner: "ถ้าไม่มี fallback n/a". A blank cell reads as a rendering bug and
       sends an admin looking for a problem that is not there; "n/a" says the
       system looked and there was nothing. */
    render(<SuspendedTray rows={[rows[1]!]} onClose={vi.fn()} />);
    const row = screen.getByTestId('suspended-row');
    // three unknown fields on that row: name, display name, phone, plus the OA
    expect(row.textContent?.match(/n\/a/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('shows the values it does have', () => {
    render(<SuspendedTray rows={[rows[0]!]} onClose={vi.fn()} />);
    const row = screen.getByTestId('suspended-row');
    expect(row.textContent).toContain('สมชาย ใจดี');
    expect(row.textContent).toContain('0812345678');
    expect(row.textContent).toContain('omnideskdevoathree');
  });

  it('copies one field at a time, not the whole row', () => {
    render(<SuspendedTray rows={[rows[0]!]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('copy-phone_number'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0812345678');
  });

  it('🔴 never offers to copy a value that is not there', () => {
    // copying the literal string "n/a" into a search box is worse than no button
    render(<SuspendedTray rows={[rows[1]!]} onClose={vi.fn()} />);
    expect(screen.queryByTestId('copy-phone_number')).toBeNull();
  });

  it('🔴 does NOT close when the backdrop is clicked', () => {
    /* Owner: "ไม่ให้ allow click outside". The tray is a working surface — an
       admin copying a phone number out of it must not lose it by clicking the
       page behind. Same rule the settings dropdown already follows. */
    const onClose = vi.fn();
    render(<SuspendedTray rows={rows} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('suspended-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes by its X', () => {
    const onClose = vi.fn();
    render(<SuspendedTray rows={rows} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('suspended-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('🔴 hides the clear button from anyone without strike.manage', () => {
    /* The permission is not granted retroactively, so most accounts cannot clear.
       Offering the button anyway turns a missing privilege into a 403 popup. */
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    expect(screen.queryByTestId('suspended-clear')).toBeNull();
  });

  /* [FEAT-2708-TRAYNOCLEAR] เคสเดิม "offers the clear button" ถูกกลับด้าน
     ตามคำสั่ง 27/08 — พฤติกรรมใหม่ปักอยู่ใน describe ท้ายไฟล์ */

  it('says so plainly when nobody is locked out', () => {
    render(<SuspendedTray rows={[]} onClose={vi.fn()} />);
    expect(screen.queryByTestId('suspended-row')).toBeNull();
    expect(screen.getByTestId('suspended-empty')).toBeTruthy();
  });
});


describe('[FEAT-2708-TRAYNOCLEAR] เคลียร์ได้จาก modal avatar เท่านั้น', () => {
  /* เจ้าของ 27/08 พร้อมภาพ: "ห้ามมีปุ่มเคลียร์ตรงนี้ ให้ไปกดเอายกเลิกข้างใน
     modal avatar" + ข้อความบรรยายใต้หัว "เอาออกและไม่ต้องบอกข้อความ" */
  it('⭐⭐ ไม่มีปุ่มเคลียร์ในถาดเลย แม้แถวจะมีและสิทธิ์จะถึง', () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    expect(screen.queryAllByTestId('suspended-clear')).toHaveLength(0);
  });

  it('⭐ ข้อความบรรยายใต้หัวถูกเอาออก — เหลือหัวเรื่องอย่างเดียว', () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    /* mock t คืน "คีย์" — จับที่คีย์จึงกันได้จริง (จับข้อความไทยจะผ่านตลอด) */
    expect(document.body.textContent).not.toContain('suspended.subtitle');
  });
});


describe('[FEAT-2708-TRAYPOLISH] n/a มีคำอธิบาย · copy อยู่หน้า value · list สูงสุด ~2 การ์ด', () => {
  it('⭐ ค่า n/a ต่อท้ายด้วยคีย์ (ยังไม่ลงทะเบียน) — ค่าจริงไม่ต่อ', () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    /* rows[0] มี display_name จริง — บรรทัดนั้นห้ามมีคำอธิบาย · ช่องที่ n/a ต้องมี */
    const body = document.body.textContent || '';
    expect(body).toContain('suspended.na_unregistered');
  });

  it('⭐ ปุ่ม copy อยู่ "หน้า" value ใน DOM (เจ้าของสั่งย้ายจากท้ายมาหน้า)', () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    const btn = screen.getAllByTestId(/^copy-/)[0]!;
    const fieldRow = btn.parentElement!;
    const valueSpan = fieldRow.querySelector('[data-testid^="value-"]');
    expect(valueSpan).not.toBeNull();
    expect(
      btn.compareDocumentPosition(valueSpan!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('⭐ กรอบ scroll สูงเท่ากับ ~2 การ์ด (ไม่ใช่ 60vh เดิม)', () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    const scroller = document.querySelector('[class*="overflow-y-auto"][class*="max-h-"]') as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(scroller.className).toContain('max-h-[17rem]');
    expect(scroller.className).not.toContain('60vh');
  });
});


describe('[FEAT-2708-COPYTOAST] กด copy แล้วต้องมี toast บอก', () => {
  it('⭐⭐ คลิก copy → toast โผล่พร้อมคีย์ "คัดลอกแล้ว" · ก่อนคลิกต้องไม่มี', async () => {
    render(<SuspendedTray rows={rows} onClose={vi.fn()} />);
    expect(screen.queryByTestId('suspended-copy-toast')).toBeNull();
    fireEvent.click(screen.getAllByTestId(/^copy-/)[0]!);
    await waitFor(() =>
      expect(screen.queryByTestId('suspended-copy-toast')).not.toBeNull(),
    );
    expect(
      screen.getByTestId('suspended-copy-toast').textContent,
    ).toContain('suspended.copied');
  });
});
