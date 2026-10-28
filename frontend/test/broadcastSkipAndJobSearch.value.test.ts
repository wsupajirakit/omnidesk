/**
 * [FIX-20260828-SKIPSTATUS] + [FEAT-20260828-JOBSEARCH]
 * ===========================================================================
 * เจ้าของ 28/08:
 *   · *"skip ไม่ควร error ควร status = skip และบอกหน้า datatable ให้อ่าน skip
 *      ด้วยว่าไม่ใช่ error (badge สีส้ม)"*
 *   · *"หน้าหลักด้วย search job ด้วย id ได้"* · *"หน้า broadcast search 4 ตัวขึ้นไป"*
 *
 * ⚠️ อ่าน source text ไม่ใช่ render ทั้งหน้า — `Broadcasts.tsx` ดึงบริการหลายตัว
 *    และต้อง mock ยาวเหยียดเพื่อพิสูจน์เรื่องที่เป็นการต่อสายล้วน ๆ
 *    ส่วนพฤติกรรมจริงของตัวกรองปักไว้ฝั่ง BE ซึ่งเป็นที่ที่มันตัดสิน
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const authFetch = vi.fn();
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: (...a: unknown[]) => authFetch(...a),
  handleApiResponse: () => Promise.resolve({ data: [], meta: {} }),
}));

import { broadcastService } from '../services/messaging/broadcastService';

const PAGE = readFileSync(
  join(__dirname, '..', 'pages', 'messaging', 'Broadcasts.tsx'),
  'utf8',
);

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockResolvedValue({ ok: true, status: 200 });
});

const lastQuery = () =>
  new URLSearchParams(String(authFetch.mock.calls.at(-1)?.[0]).split('?')[1] ?? '');

describe('[JOBSEARCH] คำค้นเดินทางไปถึงเซิร์ฟเวอร์', () => {
  it('⭐⭐ 🔴 ครบ 4 ตัว ⇒ ใส่ `search` ไปในคำขอ', async () => {
    await broadcastService.listBroadcasts({ search: 'promo' });
    expect(lastQuery().get('search')).toBe('promo');
  });

  it('⭐⭐ 🔴 สั้นกว่า 4 ตัว ⇒ ไม่ใส่เลย — กติกาเดียวกับหน้าประวัติ', async () => {
    for (const short of ['', 'p', 'pr', 'pro', '   ']) {
      await broadcastService.listBroadcasts({ search: short });
      expect(lastQuery().has('search')).toBe(false);
    }
  });

  it('⭐ ตัดช่องว่างหัวท้ายก่อนวัดความยาวและก่อนส่ง', async () => {
    await broadcastService.listBroadcasts({ search: '  promo  ' });
    expect(lastQuery().get('search')).toBe('promo');
  });

  it('⭐ ไม่ส่งคำค้น ⇒ คำขอเหมือนเดิมทุกประการ', async () => {
    await broadcastService.listBroadcasts({});
    expect(lastQuery().has('search')).toBe(false);
  });
});

describe('[JOBSEARCH] หน้าจอต่อสายครบ', () => {
  it('⭐⭐ 🔴 ส่ง `search` เข้า service — ไม่ได้กรองในเครื่องอย่างเดียวแล้ว', () => {
    expect(PAGE).toContain('search: jobSearch || undefined');
  });

  it('⭐⭐ 🔴 คำค้นเปลี่ยน ⇒ กลับหน้า 1', () => {
    /* ค้นตอนอยู่หน้า 5 แล้วไม่รีเซ็ต = เห็นหน้าว่างทั้งที่ผลอยู่หน้า 1 */
    const effect = PAGE.slice(PAGE.indexOf('const needle = search.trim();'));
    expect(effect.slice(0, effect.indexOf('}, 400)'))).toContain('setCurrentPage(1)');
  });

  it('⭐⭐ 🔴 `jobSearch` อยู่ใน dependency ของ fetchItems — ไม่งั้นพิมพ์แล้วเงียบ', () => {
    expect(PAGE).toContain('statusFilter, jobSearch, t]');
  });

  it('⭐ คำยาวพอ ⇒ ไม่กรองซ้ำในเครื่อง (เซิร์ฟเวอร์กรองให้แล้ว)', () => {
    /* กรองซ้ำสองชั้นด้วยกติกาคนละแบบ = ผลลัพธ์ที่อธิบายไม่ได้ */
    const fn = PAGE.slice(PAGE.indexOf('const filteredItems = useMemo'));
    expect(fn.slice(0, fn.indexOf('}, [items, search])'))).toContain(
      'q.length >= 4',
    );
  });
});

describe('[SKIPSTATUS] ตารางประวัติอ่าน skip ออกว่าไม่ใช่ error', () => {
  const badge = PAGE.slice(
    PAGE.indexOf('const statusBadge ='),
    PAGE.indexOf('const openLogDetail'),
  );

  it('⭐⭐ 🔴 `skipped` มีสีของตัวเอง และเป็นส้ม ไม่ใช่แดง', () => {
    expect(badge).toContain("normalized === 'skipped'");
    const line =
      badge.split('\n').find((l) => l.includes("normalized === 'skipped'")) ?? '';
    expect(line).toContain('amber');
    expect(line).not.toContain('red-');
    expect(line).not.toContain('emerald');
  });

  it('⭐⭐ 🔴 `error` ไม่ตกลง fallback สีเทาอีกแล้ว', () => {
    /* เทากับ "ค่าที่ไม่รู้จัก" ใช้สีเดียวกัน ⇒ ความล้มเหลวจริงอ่านไม่ออก */
    expect(badge).toContain("normalized === 'error'");
    const line =
      badge.split('\n').find((l) => l.includes("normalized === 'error'")) ?? '';
    expect(line).toContain('red-');
  });

  it('⭐⭐ 🔴 ตัวกรองสถานะมี `skipped` ให้เลือก', () => {
    /* ขาดไป = แถวที่ถูกข้ามหายจากทุกตัวกรองยกเว้น "ทุกสถานะ"
       ซึ่งอ่านได้ว่า "ไม่มีแถวแบบนั้น" ทั้งที่มันมีอยู่ */
    expect(PAGE).toContain("{ value: 'skipped', label: t('status.skipped') }");
  });

  it('⭐ type ของ state รองรับ `skipped` — ไม่งั้นตัวเลือกถูก cast ทิ้ง', () => {
    expect(PAGE).toContain("'all' | 'success' | 'error' | 'skipped'");
  });
});
