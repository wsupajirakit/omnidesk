/**
 * [FIX-20260903-REOPENATSTEP1] + [FIX-20260903-STEPRAILALWAYS] + [FIX-20260903-CLOSEONSENT]
 * ===========================================================================
 * Three things the owner reported on 03/09, in one file because all three are
 * about the SAME modal's lifecycle rather than about broadcast business rules:
 *
 *  1. reopening the modal must land on step 1 every time
 *  2. the step wizard must stay visible in the header at all times
 *  3. a successful "send now" must close the form instead of hanging on the
 *     confirm dialog
 *
 * 🔴 WHY (1) IS A REAL BUG AND NOT A GUESS: `BroadcastFormModal` puts
 *    `if (!isOpen) return null` BELOW its hooks, and the parent
 *    (`pages/messaging/Broadcasts.tsx`) keeps it mounted permanently, flipping
 *    only the `isOpen` prop. So every `useState` — `stepIndex` included —
 *    survives a close/open cycle. Case 1 below reproduces exactly that: it
 *    drives the real component from step 0 to a later step, closes it via the
 *    prop, reopens it, and asserts on where it lands.
 *
 * ⚠️ These cases mount the REAL modal and read what an admin would see. They do
 *    not assert on source text, because "which step is showing" is a runtime
 *    fact that a string match cannot prove.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';

const payload: { value: unknown } = { value: null };
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(payload.value),
}));
vi.mock('../services/hook', () => ({
  webhookService: {
    getHooksByGroup: () =>
      Promise.resolve([{ _id: 'a0d00000000000000000001e', line_oa_name: 'OA one' }]),
  },
}));
vi.mock('../services/admin', () => ({ fetchVisibleGroups: () => Promise.resolve([]) }));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';

beforeEach(() => {
  payload.value = null;
});

/** the step rail marks the step it is on with aria-current */
const activeStep = (c: HTMLElement): string | null => {
  const el = c.querySelector('[data-testid^="wizard-step-"][aria-current="step"]')
    ?? c.querySelector('[aria-current="step"]');
  return el?.textContent?.trim() ?? null;
};

describe('[FIX-20260903-REOPENATSTEP1] เปิดใหม่ต้องกลับมาที่ขั้น 1', () => {
  it('🔴 ปิดฟอร์มค้างไว้ที่ขั้นอื่น แล้วเปิดใหม่ ต้องอยู่ขั้น 1 ไม่ใช่ขั้นเดิม', async () => {
    /* 🔴 THE REGRESSION. Before the fix, `stepIndex` survived the close because
       the component never unmounts — the reopened form appeared on whatever
       step the previous session ended on, with steps 1-4 unfilled.
     *
     * ⚠️ ใช้ `mode="view"` โดยเจตนา: `tryGoTo` ปล่อยให้ไปขั้นไหนก็ได้เมื่อ
     *    `isReadOnly` (ดู `tryGoTo`) · ถ้าใช้ `mode="create"` ด่านกันข้ามขั้น
     *    (NOSTEPSKIP) จะปฏิเสธการกดเพราะขั้น 1 ยังว่าง ⇒ ขั้นไม่ขยับเลย ⇒
     *    เคสจะเขียวโดยไม่ได้วัดอะไร
     *    🔴 เจอมาแล้วจริง: เวอร์ชันแรกของเคสนี้ **mutation รอด** เพราะเหตุนี้เป๊ะ ๆ
     *    ⇒ จึงต้อง assert ว่าขั้น "ขยับจริง" ก่อน แล้วค่อยปิด-เปิด */
    const props = {
      onClose: () => {},
      onSubmit: () => Promise.resolve(),
      mode: 'view' as const,
      initialData: { name: 'a job', description: 'why', hook_ids: [] } as never,
    };
    const view = render(<BroadcastFormModal isOpen {...props} />);

    const chips = await waitFor(() => {
      const found = view.container.querySelectorAll('[data-testid^="wizard-step-"]');
      expect(found.length).toBeGreaterThan(1);
      return found;
    });
    const firstStep = activeStep(view.container as HTMLElement);
    expect(firstStep, 'ต้องเริ่มที่ขั้นแรก').toBeTruthy();

    /* move to the LAST chip, then prove it really moved */
    fireEvent.click(chips[chips.length - 1]);
    const movedStep = await waitFor(() => {
      const now = activeStep(view.container as HTMLElement);
      /* 🔴 ด่านกันเคสหลอกตัวเอง — ถ้าขั้นไม่ขยับ เคสนี้ต้องแดงที่บรรทัดนี้
         ไม่ใช่ผ่านไปแล้วเขียวตอนท้าย */
      expect(now, 'ขั้นต้องขยับออกจากขั้นแรกก่อน ไม่งั้นเคสนี้ไม่ได้วัดอะไร')
        .not.toBe(firstStep);
      return now;
    });
    expect(movedStep).not.toBe(firstStep);

    /* close, then reopen — the prop flip is exactly what the parent does */
    view.rerender(<BroadcastFormModal isOpen={false} {...props} />);
    view.rerender(<BroadcastFormModal isOpen {...props} />);

    await waitFor(() => {
      expect(
        activeStep(view.container as HTMLElement),
        'เปิดใหม่ต้องกลับมาขั้นแรก ไม่ใช่ขั้นที่ค้างไว้',
      ).toBe(firstStep);
    });
  });

  it('⭐⭐ การรีเซ็ตเกิดตอน "เปิด" และแตะ stepIndex ตัวเดียว', () => {
    /* ⚠️ ปักว่าไม่ได้เผลอล้าง `showAllSteps` ไปด้วย ซึ่งเป็นการตั้งค่าการมอง
       ของผู้ใช้ ไม่ใช่ตำแหน่งในฟอร์ม (เกินที่เจ้าของสั่ง) */
    const src = readFileSync(
      join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
      'utf8',
    );
    expect(src).toContain('setStepIndex(0)');
    expect(src).not.toContain('setShowAllSteps(false)');
  });
});

describe('[FIX-20260903-STEPRAILALWAYS] แถบขั้นตอนต้องไม่เลื่อนหาย', () => {
  it('🔴 แถบขั้นตอนอยู่นอก <form> ที่เลื่อน — ไม่ใช่ข้างใน', () => {
    /* 🔴 THE REGRESSION. The rail used to sit inside the `overflow-y-auto`
       <form>, so scrolling down to the lower fields scrolled the navigation
       itself off screen. jsdom cannot scroll, so the structural fact — which
       element the rail is a descendant of — is what proves it. */
    const view = render(
      <BroadcastFormModal
        isOpen
        onClose={() => {}}
        onSubmit={() => Promise.resolve()}
        mode="create"
      />,
    );
    const chip = view.container.querySelector('[data-testid^="wizard-step-"]');
    expect(chip, 'ไม่เจอชิปขั้นตอนเลย').not.toBeNull();
    /* the scrolling container is the <form> itself (see [UI-20260828-SCROLLHINT]) */
    expect((chip as HTMLElement).closest('form#broadcast-form')).toBeNull();
  });

  it('⭐⭐ ยังกดกระโดดขั้นได้เหมือนเดิมหลังย้าย', async () => {
    /* การย้าย JSX ต้องไม่ทำให้ prop หลุด — ชิปต้องยังเป็นปุ่มที่กดได้ */
    const view = render(
      <BroadcastFormModal
        isOpen
        onClose={() => {}}
        onSubmit={() => Promise.resolve()}
        mode="create"
      />,
    );
    const chips = await waitFor(() => {
      const found = view.container.querySelectorAll('[data-testid^="wizard-step-"]');
      expect(found.length).toBeGreaterThan(1);
      return found;
    });
    expect(() => fireEvent.click(chips[0])).not.toThrow();
  });
});

describe('[FIX-20260903-CLOSEONSENT] บันทึกสำเร็จต้องปิดฟอร์ม', () => {
  it('🔴 หน้าแม่ปิดฟอร์มทันทีที่บันทึกสำเร็จ ก่อนรอรีเฟรชรายการ', () => {
    /* 🔴 THE REGRESSION, measured from the real BE log: `POST /:id/send`
       answered 201 in `responseTime: 3115` ms because it refetches site rules
       first. `closeForm()` used to run only after `await onSubmit(...)` had
       ALSO awaited `fetchItems()`, so the confirm dialog stayed on screen for
       seconds with no feedback — the "stuck" the owner saw.
       ⚠️ ปักลำดับ: closeForm() ต้องมาก่อน fetchItems() ในไฟล์หน้าแม่ */
    const page = readFileSync(
      join(process.cwd(), 'pages/messaging/Broadcasts.tsx'),
      'utf8',
    );
    const closeAt = page.indexOf('closeForm();\n      await fetchItems();');
    expect(closeAt, 'closeForm() ต้องอยู่ก่อน fetchItems() ใน submitForm').toBeGreaterThan(-1);
  });

  it('⭐⭐ ปุ่มยืนยันบอกว่ากำลังทำงาน และกดซ้ำไม่ได้', () => {
    /* 3 วินาทีที่ไม่มีอะไรขยับ = คนกดซ้ำ ⇒ สร้างงานซ้ำแล้วส่งซ้ำ */
    const src = readFileSync(
      join(process.cwd(), 'components/campaign/BroadcastFormModal.tsx'),
      'utf8',
    );
    expect(src).toContain('confirmDisabled={loading}');
    expect(src).toContain("broadcast.confirm_working");
  });

  it('⭐ คีย์แปลใหม่มีครบทั้งสองภาษา', () => {
    /* คีย์ที่มีภาษาเดียว = อีกภาษาโชว์ชื่อคีย์ดิบบนจอ */
    for (const lang of ['th', 'en']) {
      const dict = JSON.parse(
        readFileSync(join(process.cwd(), `i18n/translations/${lang}.json`), 'utf8'),
      ) as Record<string, string>;
      expect(dict['broadcast.confirm_working'], `${lang} ขาดคีย์`).toBeTruthy();
    }
  });
});
