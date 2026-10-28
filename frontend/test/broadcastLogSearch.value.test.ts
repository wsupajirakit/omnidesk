/**
 * [FEAT-20260828-LOGSEARCH] ค้นประวัติการส่งด้วยชื่อ OA หรือ id ของงาน
 * ===========================================================================
 * เจ้าของ 28/08: *"เพิ่ม search ค้นหาด้วย hook name + job id ได้
 * (ต้องพิมพ์ 4 ตัวอักษรขึ้นไป)"*
 *
 * 🔴 การกรองเกิดที่ **เซิร์ฟเวอร์** — รายการนี้แบ่งหน้าที่ BE ⇒ กรองในเครื่องจะค้นเจอ
 *    แค่แถวของหน้าที่เปิดอยู่ · ไฟล์นี้จึงปักว่า "คำค้นเดินทางออกไปจริง" ที่ตัวส่งคำขอ
 *    ส่วนพฤติกรรมของตัวกรองเองปักไว้ฝั่ง BE (`webhook-log-search.spec.ts`)
 *
 * ⚠️ ไม่เรนเดอร์ทั้งหน้า `Broadcasts.tsx` โดยตั้งใจ — หน้านั้นดึงบริการหลายตัวและ
 *    ต้อง mock ยาวเหยียดเพื่อพิสูจน์เรื่องเดียว · ที่นี่ปักสัญญาที่แคบและตรงกว่า:
 *    (1) ตัวส่งคำขอใส่/ไม่ใส่ `search` ตามกฎ 4 ตัวอักษร
 *    (2) หน้าจอต่อสายครบ — ส่ง `search` เข้าไป และรีเซ็ตกลับหน้า 1
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const authFetch = vi.fn();
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: (...a: unknown[]) => authFetch(...a),
  handleApiResponse: () => Promise.resolve({ data: [], pagination: {} }),
}));

import { webhookLogService } from '../services/hook/webhookLogService';

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, status: 200 });
});

/** query string ของคำขอล่าสุด */
const lastQuery = () =>
  new URLSearchParams(String(authFetch.mock.calls.at(-1)?.[0]).split('?')[1] ?? '');

describe('[LOGSEARCH-FE] คำค้นเดินทางออกไปหาเซิร์ฟเวอร์', () => {
  it('⭐⭐ 🔴 ครบ 4 ตัว ⇒ ใส่ `search` ไปในคำขอ', async () => {
    await webhookLogService.getLogsWithFilters({ search: 'omnidesk' });
    expect(lastQuery().get('search')).toBe('omnidesk');
  });

  it('⭐⭐ 🔴 สั้นกว่า 4 ตัว ⇒ ไม่ใส่เลย ไม่ใช่ใส่คำสั้น ๆ ให้กวาดทั้งตาราง', async () => {
    for (const short of ['', 'n', 'ne', 'nex', '   ']) {
      await webhookLogService.getLogsWithFilters({ search: short });
      expect(lastQuery().has('search')).toBe(false);
    }
  });

  it('⭐ ตัดช่องว่างหัวท้ายก่อนนับความยาวและก่อนส่ง', async () => {
    await webhookLogService.getLogsWithFilters({ search: '  omnidesk  ' });
    expect(lastQuery().get('search')).toBe('omnidesk');
  });

  it('⭐ ไม่ส่งคำค้นมา ⇒ คำขอเหมือนเดิมทุกประการ', async () => {
    await webhookLogService.getLogsWithFilters({});
    expect(lastQuery().has('search')).toBe(false);
  });
});

describe('[LOGSEARCH-FE] หน้าจอต่อสายครบ', () => {
  const src = readFileSync(
    join(__dirname, '..', 'pages', 'messaging', 'Broadcasts.tsx'),
    'utf8',
  );

  it('⭐⭐ 🔴 ส่ง `search` เข้า service — ไม่ได้กรองในเครื่อง', () => {
    expect(src).toContain('search: logSearch || undefined');
    /* ถ้ามีคนเปลี่ยนไปกรอง array ในเครื่อง เคสนี้จะแดง ซึ่งถูกแล้ว:
       การกรองในเครื่องเห็นแค่แถวของหน้าที่เปิดอยู่ */
    expect(src).toContain('logSearch');
  });

  it('⭐⭐ 🔴 คำค้นเปลี่ยน ⇒ กลับหน้า 1', () => {
    /* ค้นตอนอยู่หน้า 5 แล้วไม่รีเซ็ต = เห็นหน้าว่าง ทั้งที่ผลอยู่หน้า 1 */
    /* ⚠️ ระบุ effect ให้ชัด — ตั้งแต่ 28/08 หน้านี้มี effect หน่วงคำค้น **สองตัว**
       (ตัวของประวัติ กับตัวของรายการแคมเปญ) · ค้นด้วย `window.setTimeout` เฉย ๆ
       จะไปเจอตัวไหนก่อนก็ได้ แล้วเทสจะแดงโดยที่โค้ดไม่ได้ผิด */
    const at = src.indexOf('setLogSearch(needle.length >= 4');
    expect(at).toBeGreaterThan(-1);
    const effect = src.slice(src.lastIndexOf('window.setTimeout', at), at + 400);
    expect(effect).toContain('setLogPage(1)');
  });

  it('⭐ `search` อยู่ใน dependency ของ fetchLogs — ไม่งั้นพิมพ์แล้วเงียบ', () => {
    expect(src).toContain('logStatus, dateRange, logSearch, t]');
  });
});
