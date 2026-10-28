/**
 * [FEAT-2708-NOSTEPSKIP] (งาน 5.1) เดินหน้าได้เมื่อขั้นที่ผ่านมาครบเท่านั้น
 * ===========================================================================
 * เจ้าของ 27/08: *"ห้ามกด ข้าม step (ตอนนี้มันข้ามได้)"*
 * กติกาที่ตรึง:
 *   · "ต่อไป"/chip เดินหน้า = ไปได้ไกลสุดแค่ **ขั้นแรกที่ยังมี error** —
 *     งานที่กรอกครบแล้ว (edit) จึง jump อิสระโดยธรรมชาติ ไม่ต้องมีโหมดพิเศษ
 *   · ย้อนกลับ = ได้เสมอ · โหมด view = เดินอิสระ (ไม่มีอะไรให้กรอก)
 *   · โดน block = พาไปยืนขั้นที่ติด + error ของขั้นนั้นโชว์ (ช่องแดง + badge)
 *   · ปุ่มยืนยัน/fade/แสดงทุกขั้นตอน ไม่ถูกแตะ (confirmFade ต้องเขียวเหมือนเดิม)
 *
 * mount จริง กดจริง — ทุกเคสอ่าน aria-current ของ chip เป็นตัวตัดสิน
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: () => Promise.resolve([]) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve([{ _id: 'g1', group_name: 'A' }]),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { I18nProvider } from '../i18n';

const activeStep = () =>
  document.querySelector('[aria-current="step"]')?.getAttribute('data-testid');

const mountCreate = () =>
  render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn(() => Promise.resolve())} mode="create" />
    </I18nProvider>,
  );

const fullJob = {
  id: 'b1',
  _id: 'b1',
  name: 'งานเดิม',
  hook_ids: ['h1'],
  assign_group_ids: ['g1'],
  target: { mode: 'all', group_ids: [], match: 'and', rules: [] },
  message: { type: 'text', text: 'สวัสดี' },
  status: 'draft',
  send_kind: 'multicast',
  description: 'กรอกครบแล้ว',
};

const mountEdit = (over: Record<string, unknown> = {}, mode: 'update' | 'view' = 'update') =>
  render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
        mode={mode}
        initialData={{ ...fullJob, ...over } as never}
      />
    </I18nProvider>,
  );

describe('[NOSTEPSKIP] create — ขั้นแรกยังไม่ครบ ห้ามขยับ', () => {
  it('⭐⭐ กด "ต่อไป" ทั้งที่ชื่อว่าง → อยู่ขั้น 1 เท่าเดิม + error โชว์', async () => {
    mountCreate();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.click(screen.getAllByTestId('wizard-next')[0]!);
    expect(activeStep()).toBe('wizard-step-section-basic');
    // error ของขั้นนี้ต้องติด (badge บน chip)
    await waitFor(() =>
      expect(screen.queryByTestId('wizard-step-badge-section-basic')).not.toBeNull(),
    );
  });

  it('⭐⭐ chip โดดไปขั้นส่ง (6) → ถูกจับยืนที่ขั้นแรกที่ยังไม่ผ่าน (1)', async () => {
    mountCreate();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.click(screen.getByTestId('wizard-step-section-send'));
    expect(activeStep()).toBe('wizard-step-section-basic');
  });

  it('⭐ กรอกขั้น 1 ครบ → "ต่อไป" ไปขั้น 2 ได้', async () => {
    const { container } = mountCreate();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.change(container.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: 'งานใหม่' },
    });
    fireEvent.change(
      container.querySelector('textarea[name="description"]') as HTMLTextAreaElement,
      { target: { value: 'ทำเพื่อทดสอบ' } },
    );
    fireEvent.click(screen.getAllByTestId('wizard-next')[0]!);
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-message'));
  });

  it('⭐ ย้อนกลับได้เสมอ', async () => {
    const { container } = mountCreate();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.change(container.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: 'งานใหม่' },
    });
    fireEvent.change(
      container.querySelector('textarea[name="description"]') as HTMLTextAreaElement,
      { target: { value: 'ทำเพื่อทดสอบ' } },
    );
    fireEvent.click(screen.getAllByTestId('wizard-next')[0]!);
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-message'));
    fireEvent.click(screen.getAllByTestId('wizard-back')[0]!);
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
  });
});

describe('[NOSTEPSKIP] edit/view — งานที่ครบแล้วเดินอิสระโดยธรรมชาติ', () => {
  it('⭐ edit งานที่กรอกครบ: chip โดดไปขั้นส่งได้ทันที (ทุกขั้นผ่าน validation)', async () => {
    mountEdit();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.click(screen.getByTestId('wizard-step-section-send'));
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-send'));
  });

  it('⭐ edit งานที่ "ชื่อถูกลบ" → chip โดดไกลถูกจับที่ขั้น 1', async () => {
    const { container } = mountEdit();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.change(container.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('wizard-step-section-send'));
    expect(activeStep()).toBe('wizard-step-section-basic');
  });

  it('⭐ ย้อน "ทีละขั้น" ต้องไม่ถูกด่านเทเลพอร์ต — ขั้นแรกพังอยู่ก็ย้อน 5→4 ได้', async () => {
    /* 🔴 mutation ที่เทสชุดแรกจับไม่ได้: ตัด free-pass ของขาย้อน (`next <=
       stepIndex`) แล้วขาย้อนตกไปเข้าด่าน ⇒ ย้อนจากขั้น 6 ไปขั้น 5 ทั้งที่ชื่อ
       (ขั้น 1) ถูกลบ จะโดนลากไปขั้น 1 แทน — ผิดกติกา "ย้อนกลับได้เสมอ" */
    const { container } = mountEdit();
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.click(screen.getByTestId('wizard-step-section-send'));
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-send'));
    // pane ซ่อนด้วย hidden ไม่ unmount — ช่องชื่อยังอยู่ใน DOM แก้ได้
    fireEvent.change(container.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: '' },
    });
    /* กด "chip" ย้อน (เส้นที่ผ่านด่าน tryGoTo — ปุ่มย้อนทีละขั้นไม่เข้าด่านอยู่แล้ว) */
    fireEvent.click(screen.getByTestId('wizard-step-section-target'));
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-target'));
  });

  it('view: เดินอิสระเหมือนเดิม (ดูอย่างเดียว ไม่มีอะไรให้กรอก)', async () => {
    mountEdit({ name: '' }, 'view');
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-basic'));
    fireEvent.click(screen.getByTestId('wizard-step-section-send'));
    await waitFor(() => expect(activeStep()).toBe('wizard-step-section-send'));
  });
});

describe('[NOSTEPSKIP] งาน 4 พ่วง: guard_window_hours ต้องสังกัดขั้น 5', () => {
  it('⭐ fields ของ section-target มี guard_window_hours (ไม่งั้น error ลอยไร้ขั้น)', async () => {
    const { BROADCAST_STEPS } = await import('../components/campaign/form/broadcastSteps');
    const target = BROADCAST_STEPS.find((s) => s.id === 'section-target');
    expect(target?.fields).toContain('guard_window_hours');
  });
});
