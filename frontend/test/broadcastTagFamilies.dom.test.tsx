/**
 * [UI-20260903-BCASTTAGFAMILIES] Broadcast ใช้ site rule ได้ — หน้าจอต้องพูดแบบนั้น
 *
 * เจ้าของ 03/09: *"ต้องอธิบายให้ broadcast ใช้ site rule ได้ (ไม่ใช่ profile)"* และ
 * ย้ำอีกครั้งว่า *"broadcast ไม่รองรับ profile person รองรับแค่ site rule"*
 *
 * ── สิ่งที่เทสนี้พิสูจน์ และสิ่งที่มันพิสูจน์ไม่ได้ ──────────────────────────────
 * พิสูจน์ได้: mount ฟอร์มจริง สลับ dropdown จริง แล้วอ่านสิ่งที่แอดมินเห็นจริง
 * พิสูจน์ไม่ได้: ว่า BE ยอมหรือไม่ยอมส่ง — นั่นเป็นของ
 *   `omnidesk-api/z-test/unit/broadcast-site-rules.spec.ts` และ
 *   `[FIX-20260831-BCASTPROFILEGATE]` · ไฟล์นี้คุมแค่ว่าหน้าจอ **ไม่โกหก**
 *
 * 🔴 เคสสุดท้ายคือหัวใจ: multicast + การ์ด "ธรรมดา" ยังเติมค่ารายคนไม่ได้
 *    ⇒ ถ้าเงื่อนไขในคอมโพเนนต์เผลอเช็คแค่ `sendKind === 'multicast'` เคสนั้นจะแดง
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
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
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const mount = () => {
  const r = render(
    <I18nProvider>
      <BroadcastFormModal
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn(() => Promise.resolve())}
        mode="create"
      />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return r;
};

const sendSelect = (c: HTMLElement) =>
  c.querySelector('select[name="send_kind"]') as HTMLSelectElement;
const cardSelect = (c: HTMLElement) =>
  c.querySelector('select[name="card_type"]') as HTMLSelectElement | null;
const block = (c: HTMLElement) =>
  c.querySelector('[data-testid="broadcast-tag-families"]');

describe('[BCASTTAGFAMILIES] หน้าจอบอกว่าตัวแปรตระกูลไหนใช้ได้', () => {
  it('⭐⭐ Broadcast: site rule ใช้ได้ · ค่ารายคนใช้ไม่ได้ และบอกเหตุผล', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: 'broadcast' } });

    await waitFor(() => expect(block(c)).not.toBeNull());
    const text = block(c)?.textContent ?? '';
    expect(text).toContain('site_rules.*');
    expect(text).toContain('hook_domain');
    /* ค่ารายคนต้องถูกบอกว่า "ใช้ไม่ได้" ไม่ใช่หายไปเฉย ๆ */
    expect(
      c.querySelector('[data-testid="tag-families-person-off"]'),
    ).not.toBeNull();
    expect(
      c.querySelector('[data-testid="tag-families-person-on"]'),
    ).toBeNull();
  });

  it('⭐⭐ คำอธิบายใต้ช่องวิธีส่งไม่พูดแค่ครึ่งเดียวอีกแล้ว', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());

    /* 🔴 อ่านจาก <p> ของ hint โดยตรง ไม่ใช่จาก textContent ของทั้งฟอร์ม —
       รอบแรกเขียนแบบหลัง แล้ว mutation U2 เผยว่ามันผ่านได้ด้วยข้อความจาก
       บล็อกใหม่ ทั้งที่ hint ยังพูดครึ่งเดียวเหมือนเดิม
       เทสที่เขียวได้จากที่อื่น = ไม่ได้วัดสิ่งที่ตั้งใจวัด */
    const hint = c.querySelector('[data-testid="send-kind-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? '').toContain('site_rules.*');
    expect(hint?.textContent ?? '').toContain('Multicast');
  });

  it('⭐⭐ Multicast + การ์ดรายคน: ได้ทั้งสองตระกูล', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });
    await waitFor(() => expect(cardSelect(c)).not.toBeNull());
    fireEvent.change(cardSelect(c) as HTMLSelectElement, {
      target: { value: 'personal' },
    });

    await waitFor(() =>
      expect(
        c.querySelector('[data-testid="tag-families-person-on"]'),
      ).not.toBeNull(),
    );
    const text = block(c)?.textContent ?? '';
    /* 🔴 personal เป็น superset — site rule ต้องยังอยู่ ไม่ใช่ถูกแทนที่ */
    expect(text).toContain('site_rules.*');
    expect(text).toContain('profile.*');
  });

  it('🔴 Multicast + การ์ดธรรมดา: ค่ารายคนยังใช้ไม่ได้', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });

    await waitFor(() => expect(block(c)).not.toBeNull());
    expect(
      c.querySelector('[data-testid="tag-families-person-off"]'),
    ).not.toBeNull();
  });

  it('ยังไม่เลือกวิธีส่ง = ไม่มีบล็อกนี้ให้รก', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: '' } });
    await waitFor(() => expect(block(c)).toBeNull());
  });
});
