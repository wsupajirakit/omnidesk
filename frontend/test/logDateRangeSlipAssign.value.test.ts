/* [FEAT-20260817-SLIPDATERANGE / ASSIGNDATERANGE] วันที่ range 3 วัน (default วันนี้)
 * ถึงหน้า slip-verify และ assign-history
 * ===========================================================================
 * เจ้าของสั่ง 17/08: "/slip-verify และ assign-history เพิ่ม filter วันที่ range ได้แค่
 * สามวัน (default วันนี้) เหมือน webhooklog" · field ของ slip = `transaction_date`
 * (วันที่โอนจริง) ตามที่เจ้าของเคาะ ไม่ใช่ created_at
 *
 * สองชั้นเหมือนเดิม:
 *  1) service — URL ที่ยิงออกไปต้องพา param ไปจริง และ **ต้องส่งเป็น YYYY-MM-DD ดิบ**
 *     (แปลงเป็น ISO เอง = เพี้ยน 7 ชม. ⇒ แถว 00:00–06:59 หายเงียบ)
 *  2) source — หน้าเพจใหญ่เกิน render ใน vitest จึงล็อกว่า mount ตัวควบคุมกลาง
 *     + default เป็น `defaultLogRange()` + reset หน้าเป็น 1 เมื่อช่วงเปลี่ยน
 *
 * ⚠️ เคส NO-OP สำคัญ: ไม่ส่งช่วง ⇒ URL ต้องไม่มี param เลย (client เก่ายังทำงานเดิม)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const calls: string[] = [];
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'https://api.test',
  authFetch: (url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () =>
        Promise.resolve({ success: true, data: [], meta: { total: 0 }, pagination: { total: 0 } }),
    } as unknown as Response);
  },
  handleApiResponse: (r: Response) => r.json(),
}));

import { slipVerificationService } from '../services/finance/slipVerificationService';
import { assignHistoryService } from '../services/chat/assignHistoryService';

const qs = (url: string) => new URL(url).searchParams;

beforeEach(() => {
  calls.length = 0;
});

describe('[SLIPDATERANGE] slip list ส่ง start_date/end_date เป็นวันแบบดิบ', () => {
  it('⭐ ส่งช่วง → URL มี start_date/end_date ตรงตามที่ให้ ไม่แปลงเป็น ISO', async () => {
    await slipVerificationService.listSlips({
      page: 1,
      limit: 10,
      start_date: '2026-08-17',
      end_date: '2026-08-17',
    });
    const p = qs(calls[0]!);
    expect(p.get('start_date')).toBe('2026-08-17');
    expect(p.get('end_date')).toBe('2026-08-17');
    // ห้ามมี T/Z โผล่มา — นั่นคืออาการของการแปลงเวลาเอง
    expect(calls[0]).not.toMatch(/start_date=\d{4}-\d{2}-\d{2}T/);
  });

  it('ไม่ส่งช่วง → ไม่มี param เลย (พฤติกรรมเดิมเป๊ะ)', async () => {
    await slipVerificationService.listSlips({ page: 1, limit: 10 });
    const p = qs(calls[0]!);
    expect(p.has('start_date')).toBe(false);
    expect(p.has('end_date')).toBe(false);
  });
});

describe('[ASSIGNDATERANGE] assign-history ส่ง from/to', () => {
  it('⭐ ส่งช่วง → URL มี from/to แบบวันดิบ', async () => {
    await assignHistoryService.getAssignHistories({
      page: 1,
      limit: 20,
      from: '2026-08-15',
      to: '2026-08-17',
    });
    const p = qs(calls[0]!);
    expect(p.get('from')).toBe('2026-08-15');
    expect(p.get('to')).toBe('2026-08-17');
  });

  it('ไม่ส่งช่วง → ไม่มี param (client เก่ายังยิงได้เหมือนเดิม)', async () => {
    await assignHistoryService.getAssignHistories({ page: 1, limit: 20 });
    const p = qs(calls[0]!);
    expect(p.has('from')).toBe(false);
    expect(p.has('to')).toBe(false);
  });
});

describe('[SLIPDATERANGE/ASSIGNDATERANGE] สองหน้านั้น mount ตัวควบคุมกลางจริง', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

  it.each([
    ['pages/content/SlipVerification.tsx', 'start_date: dateRange.from', 'setCurrentPage(1)'],
    ['pages/handoff/AssignHistory.tsx', 'from: dateRange.from', 'setPage(1)'],
  ])('%s: ใช้ LogDateRangeFilter + default วันนี้ + reset หน้า', (rel, sendsFrom, resetsPage) => {
    const code = read(rel);
    // ใช้ตัวกลาง ไม่ได้เขียน input วันที่ใหม่เอง
    expect(code).toMatch(/<LogDateRangeFilter/);
    expect(code).toMatch(/from '\.\.\/\.\.\/components\/common\/LogDateRangeFilter'/);
    // default = วันนี้ (มาจาก defaultLogRange ตัวเดียวกับหน้า log อื่น)
    expect(code).toMatch(/useState<LogDateRange>\(defaultLogRange\)|useState<LogDateRange>\(defaultLogRange\(\)\)/);
    // ส่งค่าไปกับ request จริง
    expect(code).toContain(sendsFrom);
    // เปลี่ยนช่วงแล้วต้องกลับหน้า 1 (ไม่งั้นค้างหน้าที่ไม่มีข้อมูล)
    const onChange = code.slice(code.indexOf('<LogDateRangeFilter'), code.indexOf('<LogDateRangeFilter') + 320);
    expect(onChange).toContain(resetsPage);
  });
});
