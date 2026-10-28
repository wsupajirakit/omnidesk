/**
 * [FEAT-2708-GUARDWINDOW] ช่อง guard window บนฟอร์ม broadcast (งาน 4.1 ฝั่ง FE)
 * ===========================================================================
 * กติกาที่ตรึง (เจ้าของ 27/08):
 *   · ช่องโผล่เฉพาะเมื่อ job เป็น multicast และมี rule บนคีย์ที่ endpoint ติดธง
 *     `guard_window: true` — FE ไม่มี list ของตัวเอง (BE policy เป็นเจ้าของเดียว)
 *   · ว่างได้ = ไม่มี guard · กรอกแล้วต้อง 1-72 จำนวนเต็ม (0 ห้าม)
 *   · ขากลับ: เปิด edit ต้องเห็นค่าเดิม · เซฟต้องพกค่าไปใน payload
 *     (จุดหายเงียบ: `normalizeBroadcast` FE + pick-list BE — เทสฝั่งละตัว)
 *
 * mount จริง กดจริง — ไม่อ่านซอร์ส
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
/* ธง guard_window มาจาก endpoint — mock ที่ SERVICE ตัวจริงที่ทุกชิ้นเรียก */
vi.mock('../services/messaging/broadcastService', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    broadcastService: {
      ...(real.broadcastService as Record<string, unknown>),
      getAudienceSources: () =>
        Promise.resolve([
          {
            key: 'follow_up.notice_deposit_at',
            label_th: 'ติดตามฝาก',
            label_en: 'deposit',
            type: 'date',
            ops: ['has_value'],
            requires_hook_scope: false,
            indexed: true,
            guard_window: true,
          },
          {
            key: 'follow_up.abandon_at',
            label_th: 'ชวนลงทะเบียน',
            label_en: 'abandon',
            type: 'date',
            ops: ['lte', 'gte'],
            requires_hook_scope: false,
            indexed: true,
          },
        ]),
    },
  };
});

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { normalizeBroadcast } from '../services/messaging/broadcastService';
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const job = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  _id: 'b1',
  name: 'งานทดสอบ',
  hook_ids: ['h1'],
  assign_group_ids: ['g1'],
  target: {
    mode: 'all',
    group_ids: [],
    match: 'and',
    rules: [{ key: 'follow_up.notice_deposit_at', op: 'has_value' }],
  },
  message: { type: 'text', text: 'สวัสดี' },
  status: 'draft',
  send_kind: 'multicast',
  description: 'ทดสอบ guard',
  ...over,
});

const mount = (initialData: Record<string, unknown>, onSubmit = vi.fn(() => Promise.resolve())) => {
  const r = render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        mode="update"
        initialData={initialData as never}
      />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return { ...r, onSubmit };
};

const guardInput = (c: HTMLElement) =>
  c.querySelector('input[name="guard_window_hours"]') as HTMLInputElement | null;

describe('[GUARDWINDOW-FE] ขากลับผ่าน normalize — จุดหายเงียบฝั่ง FE', () => {
  it('⭐ normalizeBroadcast พกค่า · แถวเก่า = null ไม่ใช่ undefined', () => {
    expect(normalizeBroadcast(job({ guard_window_hours: 6 })).guard_window_hours).toBe(6);
    expect(normalizeBroadcast(job()).guard_window_hours).toBeNull();
  });
});

describe('[GUARDWINDOW-FE] ช่องโผล่เมื่อไหร่', () => {
  it('⭐⭐ multicast + rule บนคีย์ที่ติดธง ⇒ เห็นช่อง · ค่าเดิมโชว์', async () => {
    const { container } = mount(job({ guard_window_hours: 6 }));
    await waitFor(() => expect(guardInput(container as HTMLElement)).not.toBeNull());
    expect(guardInput(container as HTMLElement)!.value).toBe('6');
  });

  it('⭐ rule เป็นคีย์ที่ไม่ติดธง ⇒ ไม่มีช่อง', async () => {
    const { container } = mount(
      job({
        target: {
          mode: 'all',
          group_ids: [],
          match: 'and',
          rules: [{ key: 'follow_up.abandon_at', op: 'gte', value: '2026-08-20' }],
        },
      }),
    );
    // ให้เวลาส่วน async (sources) ทำงานก่อนค่อยสรุปว่าไม่มี
    await waitFor(() => expect((container.textContent || '').length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(guardInput(container as HTMLElement)).toBeNull();
  });

  it('⭐ send_kind = broadcast ⇒ ไม่มีช่อง แม้ rule จะเป็นคีย์ที่ติดธง', async () => {
    const { container } = mount(job({ send_kind: 'broadcast' }));
    await waitFor(() => expect((container.textContent || '').length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(guardInput(container as HTMLElement)).toBeNull();
  });
});

describe('[GUARDWINDOW-FE] validate + payload', () => {
  const form = (c: HTMLElement) =>
    c.querySelector('form#broadcast-form') as HTMLFormElement;
  /* เดิน wizard ไปขั้นสุดท้าย — handleSubmit เปิดกล่องยืนยันเฉพาะขั้นสุดท้าย
     (CONFIRMLASTSTEP) · ปุ่ม "ต่อไป" หายไปเมื่อถึงขั้นสุดท้าย */
  const walkToLastStep = async (c: HTMLElement) => {
    for (let i = 0; i < 10; i++) {
      const next = Array.from(c.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('ต่อไป'),
      );
      if (!next) return;
      fireEvent.click(next);
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const dialogConfirm = () => {
    // กล่องยืนยันอยู่นอก panel (afterPanel) — ปุ่มยืนยันตัวสุดท้ายของทั้งจอ
    const all = screen
      .getAllByText('ยืนยัน')
      .map((el) => el.closest('button'))
      .filter(Boolean) as HTMLButtonElement[];
    return all[all.length - 1]!;
  };

  it('⭐⭐ 0 ติด validate ไม่ผ่าน — onSubmit ต้องไม่ถูกเรียก', async () => {
    const { container, onSubmit } = mount(job({ guard_window_hours: 6 }));
    const c = container as HTMLElement;
    await waitFor(() => expect(guardInput(c)).not.toBeNull());
    fireEvent.change(guardInput(c)!, { target: { value: '0' } });
    fireEvent.submit(form(c));
    await waitFor(() =>
      expect(c.textContent || '').toMatch(/1 ถึง 72/),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('⭐⭐ ค่า 6 เซฟผ่าน — payload พก guard_window_hours: 6', async () => {
    const { container, onSubmit } = mount(job({ guard_window_hours: 12 }));
    const c = container as HTMLElement;
    await waitFor(() => expect(guardInput(c)).not.toBeNull());
    fireEvent.change(guardInput(c)!, { target: { value: '6' } });
    await walkToLastStep(c);
    fireEvent.submit(form(c));
    // กล่องยืนยัน + ติ๊กรับทราบ (SENDCONSENT) แล้วค่อยยืนยันจริง
    const consent = await waitFor(() => {
      const box = document.querySelector(
        '[data-testid="send-consent-input"]',
      ) as HTMLInputElement | null;
      expect(box).not.toBeNull();
      return box!;
    });
    fireEvent.click(consent);
    fireEvent.click(dialogConfirm());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = (onSubmit.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(payload.guard_window_hours).toBe(6);
  });

  it('⭐ ล้างช่องเป็นว่าง ⇒ payload พก null (ไม่ใช่ 0 ไม่ใช่ สตริงว่าง)', async () => {
    const { container, onSubmit } = mount(job({ guard_window_hours: 12 }));
    const c = container as HTMLElement;
    await waitFor(() => expect(guardInput(c)).not.toBeNull());
    fireEvent.change(guardInput(c)!, { target: { value: '' } });
    await walkToLastStep(c);
    fireEvent.submit(form(c));
    const consent = await waitFor(() => {
      const box = document.querySelector(
        '[data-testid="send-consent-input"]',
      ) as HTMLInputElement | null;
      expect(box).not.toBeNull();
      return box!;
    });
    fireEvent.click(consent);
    fireEvent.click(dialogConfirm());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const p2 = (onSubmit.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown>;
    expect(p2.guard_window_hours).toBeNull();
  });
});
