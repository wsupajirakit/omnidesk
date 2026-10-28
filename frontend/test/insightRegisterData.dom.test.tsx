/* [FEAT-20260820-REGINSIGHT] Insight report — "Register data" card
 * ===========================================================================
 * Owner, 20/08: "ภาพสองให้เปลี่ยน AI Category Breakdown → Register data แปลไทยด้วย
 * ข้อมูลการสมัครสมาชิก · มีแท่งสองอัน แท่งกราฟแนวนอน · อันแรก = สมัครโดย member
 * อันสอง = สมัครโดย admin · มี filter date range ไม่ล็อควัน · filter oa ตามแท็บ
 * ที่เลือก · นับแค่จำนวน".
 *
 * What must never silently break, pinned here:
 *  ⭐ bar ORDER — member first, admin second, exactly as the owner listed them;
 *  ⭐ the OA scope rides the request — the card queries the SELECTED tab's hook,
 *    not the whole system (a dropped param shows global numbers under an OA tab
 *    and lies to a scoped operator);
 *  ⭐ no_oa_access (data: null) renders the no-data state, not a crash on
 *    `data.admin`.
 *
 * ⚠️ recharts renders inside a ResponsiveContainer, and jsdom gives it 0×0 —
 *    the SVG bars are NOT asserted here. The numbers are asserted through the
 *    card's textual legend rows, which exist precisely so this card stays
 *    testable (and readable) without real layout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import { I18nProvider } from '../i18n';

/* apiClient throws at import time without VITE_API_BASE_URL, and I18nProvider
 * drags it in via services/admin — same reason logDateRangeSlipAssign mocks it
 * outright. Must come before anything that touches the services tree. */
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'http://test.local',
  authFetch: vi.fn(),
  handleApiResponse: vi.fn(),
}));

/* Full-module mock so the card's data calls are ours to script. */
vi.mock('../services/insight', () => ({
  insightReportService: {
    getRegistrationInsights: vi.fn(),
  },
}));

import { insightReportService } from '../services/insight';
import { RegisterDataCard } from '../pages/insight/RegisterDataCard';

const mockedFetch = vi.mocked(insightReportService.getRegistrationInsights);

/* jsdom has no ResizeObserver — recharts' container observes for resizes. */
beforeAll(() => {
  if (!(globalThis as any).ResizeObserver) {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue({
    success: true,
    data: { admin: 2, member: 3, admin_bot_assisted: 0, total: 5 },
  });
});

const renderCard = (hookId: string | null = 'hook-1') =>
  render(
    <I18nProvider>
      <RegisterDataCard hookId={hookId} />
    </I18nProvider>,
  );

describe('[FEAT-20260820-REGINSIGHT] RegisterDataCard', () => {
  it('⭐ shows the Thai title and lists MEMBER before ADMIN — the order the owner dictated', async () => {
    renderCard();
    expect(screen.getByText(/ข้อมูลการสมัครสมาชิก/)).toBeTruthy();
    await waitFor(() => {
      const memberRow = screen.getByTestId('reg-row-member');
      const adminRow = screen.getByTestId('reg-row-admin');
      // DOM order: member row must precede admin row
      expect(
        memberRow.compareDocumentPosition(adminRow) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it('renders the counts and the total from the service answer', async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('reg-row-member').textContent).toContain('3');
      expect(screen.getByTestId('reg-row-admin').textContent).toContain('2');
      expect(screen.getByTestId('reg-total').textContent).toContain('5');
    });
  });

  it('⭐ queries the SELECTED OA tab and refetches when the tab changes', async () => {
    const { rerender } = renderCard('hook-1');
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(mockedFetch.mock.calls[0]?.[0]).toMatchObject({
      line_oa_hook_id: 'hook-1',
    });

    rerender(
      <I18nProvider>
        <RegisterDataCard hookId="hook-2" />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(
        mockedFetch.mock.calls.some(
          (c) => c[0]?.line_oa_hook_id === 'hook-2',
        ),
      ).toBe(true),
    );
  });

  it('sends the picked date range and refetches on change — no day cap anywhere', async () => {
    renderCard();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    const first = mockedFetch.mock.calls[0]?.[0];
    expect(first?.from).toBeTruthy();
    expect(first?.to).toBeTruthy();

    // a 60-day window must go through untouched (owner: "ไม่ล็อควัน")
    const fromInput = screen.getByTestId('reg-from');
    const toInput = screen.getByTestId('reg-to');
    fireEvent.change(fromInput, { target: { value: '2026-06-01' } });
    fireEvent.change(toInput, { target: { value: '2026-07-31' } });
    await waitFor(() =>
      expect(
        mockedFetch.mock.calls.some(
          (c) => c[0]?.from === '2026-06-01' && c[0]?.to === '2026-07-31',
        ),
      ).toBe(true),
    );
  });

  it('⭐ no_oa_access (data null) renders the empty state instead of crashing', async () => {
    mockedFetch.mockResolvedValue({
      success: true,
      data: null,
      scope: 'no_oa_access',
    });
    renderCard();
    await waitFor(() => {
      expect(screen.queryByTestId('reg-row-member')).toBeNull();
    });
  });

  it('zeros still render two rows — an empty period is data, not an error', async () => {
    mockedFetch.mockResolvedValue({
      success: true,
      data: { admin: 0, member: 0, admin_bot_assisted: 0, total: 0 },
    });
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('reg-row-member').textContent).toContain('0');
      expect(screen.getByTestId('reg-row-admin').textContent).toContain('0');
    });
  });
});

/* ==== [FEAT-20260821-REGBOTASSIST] แท่งที่สาม: บอทช่วยแอดมิน ====================
 * เจ้าของสั่ง 21/08: แท่ง `admin` เดิมถูก **ผ่าครึ่ง** ตามว่าบอทเคยไล่ตามคนนี้ไหม
 *   สมัครโดย Admin           = 'admin' และ request_reg_at **ไม่มีค่า**
 *   สมัครโดย Bot ช่วย Admin  = 'admin' และ request_reg_at **มีค่า**
 * *"ไม่รวมแท่ง มันจะเป็นสามแท่งตอนจบ"* ⇒ สามแถวแยกกัน · `รวมทั้งหมด` = ทั้งสาม
 *
 * ⚠️ ลำดับที่เจ้าของสั่งไว้เดิม (member ก่อน admin) **ห้ามสลับ** — แท่งใหม่ต่อท้าย
 */
describe('⭐ [FEAT-20260821-REGBOTASSIST] แท่งที่สาม', () => {
  it('⭐⭐ มีสามแถว และลำดับคือ member → admin → bot ช่วย admin', async () => {
    mockedFetch.mockResolvedValue({
      success: true,
      data: { admin: 2, member: 3, admin_bot_assisted: 4, total: 9 },
    } as never);
    renderCard();
    await waitFor(() => {
      const member = screen.getByTestId('reg-row-member');
      const admin = screen.getByTestId('reg-row-admin');
      const bot = screen.getByTestId('reg-row-admin_bot_assisted');
      expect(
        member.compareDocumentPosition(admin) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        admin.compareDocumentPosition(bot) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it('⭐⭐ ตัวเลขทั้งสามแถวและยอดรวมตรงกับที่ BE ส่งมา', async () => {
    mockedFetch.mockResolvedValue({
      success: true,
      data: { admin: 2, member: 3, admin_bot_assisted: 4, total: 9 },
    } as never);
    renderCard();
    await waitFor(() => {
      expect(screen.getByTestId('reg-row-member').textContent).toContain('3');
      expect(screen.getByTestId('reg-row-admin').textContent).toContain('2');
      expect(
        screen.getByTestId('reg-row-admin_bot_assisted').textContent,
      ).toContain('4');
      /* 3+2+4 = 9 — ถ้ายอดรวมไม่รวมแท่งใหม่ แอดมินจะเห็นตัวเลขที่บวกไม่ลง */
      expect(screen.getByTestId('reg-total').textContent).toContain('9');
    });
  });

  it('⭐ แท่งใหม่มี label ครบทั้งสองภาษา — ไม่โชว์คีย์ดิบ', () => {
    const th = JSON.parse(
      readFileSync(join(process.cwd(), 'i18n/translations/th.json'), 'utf8'),
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(join(process.cwd(), 'i18n/translations/en.json'), 'utf8'),
    ) as Record<string, string>;
    expect((th['insight.reg_by_admin_bot'] ?? '').length).toBeGreaterThan(0);
    expect((en['insight.reg_by_admin_bot'] ?? '').length).toBeGreaterThan(0);
  });

  it('⭐ สีของแท่งใหม่ต้องไม่ซ้ำกับสองแท่งเดิม', () => {
    /* สามแท่งสีเดียวกันสองอันอ่านไม่ออกว่าอันไหนเป็นอันไหน */
    const src = readFileSync(
      join(process.cwd(), 'pages/insight/RegisterDataCard.tsx'),
      'utf8',
    );
    const colors = [...src.matchAll(/_COLOR = '(#[0-9a-f]{6})'/gi)].map(
      (m) => m[1],
    );
    expect(colors.length).toBe(3);
    expect(new Set(colors).size).toBe(3);
  });
});

/* ==== [FIX-20260821-REGAXISWIDTH] ป้ายแกน Y ต้องไม่ตกบรรทัด ======================
 * เจ้าของแจ้งพร้อมภาพ 21/08: *"label ตกบรรทัดไม่สวย"*
 * `สมัครโดย Bot ช่วย Admin` ยาวกว่ากรอบ `YAxis width={140}` ⇒ recharts ตัดขึ้นบรรทัดใหม่
 * แล้วป้ายไปชนตัวเลข อ่านแล้วเหมือนสองแท่งซ้อนกัน
 *
 * ⚠️ ไม่ปักเลข px ดิบ — เทสคำนวณจาก **ป้ายที่ยาวที่สุดของทั้งสองภาษา** เอง
 * เพิ่มป้ายยาวขึ้นวันหน้า เทสจะแดงเองโดยไม่ต้องมีใครจำว่าต้องมาแก้เลขตรงนี้
 * ปักเลขดิบ = วันหน้าเพิ่มป้ายยาวแล้วเงียบ.
 */
describe('⭐ [FIX-20260821-REGAXISWIDTH] กรอบแกน Y กว้างพอสำหรับป้ายที่ยาวที่สุด', () => {
  it('⭐⭐ แกนใช้ป้ายสั้น ส่วนรายการข้างล่างใช้คำเต็ม — คนละคีย์', () => {
    /* ⚠️ dive แล้วพบว่ารายการข้างล่าง **ไม่ใช่ของซ้ำ** — หัวไฟล์เขียนว่ามันมีไว้เพราะ
       "jsdom gives recharts a 0×0 container, so SVG bars are untestable there —
       and it doubles as the accessible fallback" ⇒ ป้ายบนแกนคือตัวแสดงผลหลักจริง ๆ
       และการ์ดแท่งนอนตัวพี่ (`InsightReport.tsx:1430`) ก็ใช้แกนถือชื่อที่ width=100
       โดยไม่มีรายการข้างล่างเลย
       ⇒ คำตอบไม่ใช่ "ตัดป้ายแกนทิ้ง" และไม่ใช่ "ขยายกรอบไล่ตามป้าย"
          แต่คือ **ให้แกนใช้คำสั้น** ตามที่มันมีที่ */
    const src = readFileSync(
      join(process.cwd(), 'pages/insight/RegisterDataCard.tsx'),
      'utf8',
    );
    // แกนต้องอ้างคีย์ชุด axis
    expect(src).toMatch(/dataKey="axisLabel"/);
    expect(src).toContain("t('insight.reg_axis_member')");
    // รายการข้างล่างยังใช้คำเต็มเหมือนเดิม
    expect(src).toContain("t('insight.reg_by_member')");
  });

  /** ประมาณความกว้างที่ fontSize 11 — ไทยตัวกว้างกว่าอังกฤษ */
  const widthOf = (s: string): number => {
    const thai = (s.match(/[฀-๿]/g) ?? []).length;
    return Math.ceil(thai * 6.6 + (s.length - thai) * 5.6);
  };

  /**
   * เผื่อขอบ 15% — **จำเป็น ไม่ใช่ความระแวง**
   *
   * `widthOf` เป็นการ **ประมาณ** ไม่ใช่การวัดจริง (jsdom ไม่มี layout engine
   * ⇒ วัดข้อความจริงไม่ได้) ฟอนต์จริงบนเครื่องผู้ใช้กว้างกว่าหรือแคบกว่าได้
   * ⚠️ เจอจาก mutation: ย่อกรอบเหลือ 160px แล้วเทสยังเขียว เพราะค่าประมาณของ
   * ป้ายที่ยาวที่สุดคือ 141px ⇒ "พอดีเป๊ะบนกระดาษ" แต่เหลือขอบจริงแค่ 19px
   * ซึ่งน้อยกว่าความคลาดเคลื่อนของตัวประมาณเอง
   * ⇒ ต้องเหลือขอบ ไม่ใช่แค่ "ไม่ล้น" · พอดีเป๊ะบนตัวประมาณ = ล้นจริงได้
   */
  const SAFETY = 1.15;

  it('⭐⭐ ป้ายทุกอันในทั้งสองภาษาใส่กรอบได้โดยไม่ต้องตัดบรรทัด', () => {
    const src = readFileSync(
      join(process.cwd(), 'pages/insight/RegisterDataCard.tsx'),
      'utf8',
    );
    const m = src.match(/<YAxis[\s\S]*?width=\{(\d+)\}/);
    expect(m).not.toBeNull();
    const boxWidth = Number(m![1]);

    /* ⚠️ ป้าย **บนแกน** เป็นคีย์คนละชุดกับป้ายในรายการข้างล่าง — ตั้งใจ
       แกนมีที่จำกัด (~100px ตาม `InsightReport.tsx:1430` ซึ่งเป็นกราฟแท่งนอน
       ตัวพี่ในหน้าเดียวกัน) · รายการข้างล่างมีที่เหลือเฟือ
       ใช้คำเดียวกันสองที่ = บังคับให้ที่แคบรับภาระของที่กว้าง แล้วก็ตกบรรทัด */
    const keys = [
      'insight.reg_axis_member',
      'insight.reg_axis_admin',
      'insight.reg_axis_admin_bot',
    ];
    const th = JSON.parse(
      readFileSync(join(process.cwd(), 'i18n/translations/th.json'), 'utf8'),
    ) as Record<string, string>;
    const en = JSON.parse(
      readFileSync(join(process.cwd(), 'i18n/translations/en.json'), 'utf8'),
    ) as Record<string, string>;

    for (const k of keys) {
      for (const [lang, dict] of [
        ['th', th],
        ['en', en],
      ] as const) {
        const label = dict[k] ?? '';
        expect(label.length, `${lang} ขาด ${k}`).toBeGreaterThan(0);
        const need = Math.ceil(widthOf(label) * SAFETY);
        expect(
          need,
          `${lang} "${label}" ต้องการ ~${need}px (ประมาณ ${widthOf(label)}px + เผื่อขอบ) แต่กรอบ ${boxWidth}px`,
        ).toBeLessThanOrEqual(boxWidth);
      }
    }
  });
});
