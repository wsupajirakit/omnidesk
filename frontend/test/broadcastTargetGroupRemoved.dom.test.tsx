/**
 * [FEAT-2708-TARGETGROUPCUT] (งาน 5.4) ตัด "เลือกตามกลุ่มเครือข่าย" ออกจาก step 5
 * ===========================================================================
 * เจ้าของ 27/08: *"ทำไมถึงมีเลือกตามกลุ่มเครือข่ายอีกมันซ้ำซ้อน (ตรงนี้ให้ใช้
 * กลุ่มเป้าหมายจาก step 3)"* — dive (todo10 §4) พิสูจน์แล้วว่าปุ่มนี้**ไม่ใช่
 * ตัวกรองผู้รับ**: มันเหมา OA ทั้งกลุ่มเข้า hook_ids ตอน create เท่านั้น (ขา
 * update ไม่ทำงานด้วยซ้ำ) ซึ่ง step 3+4 (grid + เลือกทั้งหมด) ทำแทนได้ครบ ·
 * DB จริง: job ที่ใช้ mode='group' = 0 แถว
 *
 * กติกาที่ตรึง:
 *   · ปุ่ม target_group หายจากจอ — target_all / target_rules ยังอยู่ครบ
 *   · ⚠️ ห้าม migrate เงียบ: job เก่า mode='group' เปิด edit แล้วเซฟโดยไม่แตะ
 *     mode ⇒ payload ต้องพก mode:'group' + group_ids เดิมครบ (BE ไม่ถูกแตะ
 *     ยังรับ/ส่งของเก่าได้เหมือนเดิมทุกประการ)
 *   · groupPickKey เลิกอ่าน target.group_ids (แหล่ง OA เหลือ step 3 ทางเดียว)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: () => Promise.resolve([{ _id: 'h1', name: 'OA', line_oa_name: 'OA' }]) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve([{ _id: 'g1', group_name: 'A' }]),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const oldGroupJob = {
  id: 'b1',
  _id: 'b1',
  name: 'งานเก่าโหมดกลุ่ม',
  hook_ids: ['h1'],
  assign_group_ids: ['g1'],
  target: { mode: 'group', group_ids: ['g9'] },
  message: { type: 'text', text: 'สวัสดี' },
  status: 'draft',
  send_kind: 'multicast',
  description: 'ของเก่า',
};

const mount = (onSubmit = vi.fn(() => Promise.resolve())) => {
  const r = render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={vi.fn()} onSubmit={onSubmit} mode="update" initialData={oldGroupJob as never} />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return { ...r, onSubmit };
};

describe('[TARGETGROUPCUT] ปุ่มหาย ของเก่าอยู่ครบ', () => {
  it('⭐⭐ ไม่มีปุ่ม target_group — target_all/target_rules ยังอยู่', async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('button[name="target_all"]')).not.toBeNull(),
    );
    expect(container.querySelector('button[name="target_group"]')).toBeNull();
    expect(container.querySelector('button[name="target_rules"]')).not.toBeNull();
    expect(screen.queryByTestId('target-group-picker')).toBeNull();
  });

  it('⭐⭐ job เก่า mode=group: เซฟโดยไม่แตะ ⇒ payload พก mode+group_ids เดิมครบ (ห้าม migrate เงียบ)', async () => {
    const { container, onSubmit } = mount();
    const c = container as HTMLElement;
    await waitFor(() =>
      expect(c.querySelector('button[name="target_all"]')).not.toBeNull(),
    );
    // เดินไปขั้นสุดท้ายแล้วยืนยัน (งานเก่ากรอกครบ — ด่าน 5.1 ปล่อยผ่าน)
    for (let i = 0; i < 10; i++) {
      const next = Array.from(c.querySelectorAll('button')).find((b) =>
        (b.textContent || '').includes('ต่อไป'),
      );
      if (!next) break;
      fireEvent.click(next);
      await new Promise((r) => setTimeout(r, 0));
    }
    fireEvent.submit(c.querySelector('form#broadcast-form') as HTMLFormElement);
    const consent = await waitFor(() => {
      const box = document.querySelector('[data-testid="send-consent-input"]') as HTMLInputElement | null;
      expect(box).not.toBeNull();
      return box!;
    });
    fireEvent.click(consent);
    const all = screen.getAllByText('ยืนยัน').map((el) => el.closest('button')).filter(Boolean) as HTMLButtonElement[];
    fireEvent.click(all[all.length - 1]!);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = (onSubmit.mock.calls as unknown[][])[0]?.[0] as {
      target: { mode: string; group_ids: string[] };
    };
    expect(payload.target.mode).toBe('group');
    expect(payload.target.group_ids).toEqual(['g9']);
  });

  it('⭐ groupPickKey เลิกอ่าน target.group_ids — OA มาจาก step 3 ทางเดียว', () => {
    const src = readFileSync(
      join(__dirname, '..', 'components', 'campaign', 'BroadcastFormModal.tsx'),
      'utf8',
    );
    const at = src.indexOf('const groupPickKey');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 500);
    expect(block).not.toContain('target.group_ids');
  });
});
