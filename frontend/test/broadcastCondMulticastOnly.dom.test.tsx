/**
 * [FIX-20260825-CONDMULTICASTONLY] เงื่อนไขผู้รับต้องโผล่เฉพาะตอน Multicast
 *
 * เจ้าของ 25/08: *"ย้ายวิธีส่งไปก่อนปุ่ม mint แล้วซ่อนเงื่อนไขถ้า broadcast /
 * แต่ multicast แสดงเงื่อนไข / ส่วนการตั้งเวลา ทำซ้ำ ยังเหมือนเดิม
 * broadcast / multi ใช้ได้ทั้งคู่"*
 *
 * เหตุผลเชิงระบบตรงกับที่โค้ดเขียนไว้เองอยู่แล้ว: `/message/broadcast` ไม่มีรายชื่อ
 * ผู้รับ LINE กระจายเองทุก follower ⇒ เงื่อนไขไม่มีผล · เดิมแค่ "เตือน" ตอนนี้ซ่อน
 *
 * mount จริงแล้วสลับ dropdown จริง — ไม่ใช่การอ่านซอร์ส
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
      <BroadcastFormModal isOpen onClose={vi.fn()} onSubmit={vi.fn(() => Promise.resolve())} mode="create" />
    </I18nProvider>,
  );
  openAllFormSections(r.container as HTMLElement);
  return r;
};

const sendSelect = (c: HTMLElement) =>
  c.querySelector('select[name="send_kind"]') as HTMLSelectElement;

/* บล็อกเงื่อนไขมีประตูอีกชั้น: `target.rules` ต้องถูกนิยามก่อน ซึ่งเกิดจากการกด
   ปุ่ม "ตามเงื่อนไข" · ไม่กดก่อน = ไม่มีอะไรให้ซ่อนหรือแสดงตั้งแต่ต้น */
const chooseRulesMode = (c: HTMLElement) => {
  const b = c.querySelector('button[name="target_rules"]') as HTMLElement | null;
  expect(b).not.toBeNull();
  fireEvent.click(b as HTMLElement);
};

/** ตัวสร้างเงื่อนไข — ใช้ปุ่ม "เพิ่มเงื่อนไข" เป็นตัวชี้ว่าบล็อกนี้แสดงอยู่ */
const conditionsVisible = (c: HTMLElement) =>
  !!c.querySelector('[data-testid="audience-add-rule"]') ||
  (c.textContent || '').includes('เพิ่มเงื่อนไข');

describe('[CONDMULTICASTONLY] เงื่อนไขโผล่เฉพาะ Multicast', () => {
  it('⭐⭐ Broadcast = ไม่มีบล็อกเงื่อนไขให้เห็นเลย', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    // เลือกโหมดเงื่อนไขไว้ก่อน แล้วค่อยสลับเป็น broadcast — ถ้าไม่ซ่อนจะเห็นทันที
    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });
    chooseRulesMode(c);
    await waitFor(() => expect(conditionsVisible(c)).toBe(true));
    fireEvent.change(sendSelect(c), { target: { value: 'broadcast' } });
    await waitFor(() => expect(conditionsVisible(c)).toBe(false));
  });

  it('⭐⭐ Multicast = เงื่อนไขกลับมาแสดง', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });
    chooseRulesMode(c);
    await waitFor(() => expect(conditionsVisible(c)).toBe(true));
  });

  it('⭐ วิธีส่งอยู่ "ก่อน" บล็อกเงื่อนไขในลำดับ DOM จริง', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });
    chooseRulesMode(c);
    await waitFor(() => expect(conditionsVisible(c)).toBe(true));
    const html = c.innerHTML;
    expect(html.indexOf('name="send_kind"')).toBeLessThan(html.indexOf('เพิ่มเงื่อนไข'));
  });

  it('⭐ ตั้งเวลา/ทำซ้ำ ยังอยู่ทั้งสองแบบ — เจ้าของสั่งว่าใช้ได้ทั้งคู่ (PIN)', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    for (const kind of ['broadcast', 'multicast']) {
      fireEvent.change(sendSelect(c), { target: { value: kind } });
      await waitFor(() =>
        expect(c.querySelector('[data-testid="section-send"]')).not.toBeNull(),
      );
    }
  });

  /* [FIX-20260825-RULESACTIVE] เจ้าของ 25/08 พร้อมภาพ: *"บัค active เลือกตามเงื่อนไข
     แต่ไม่ active"* — ปุ่มเช็ค `rules.length > 0` แต่การกดให้ `rules: []` (ยาว 0)
     ⇒ เลือกแล้วปุ่มไม่สว่างจนกว่าจะเพิ่มเงื่อนไขจริง · แก้ให้ใช้ประตูเดียวกับที่
     ใช้ตัดสินว่าจะ render บล็อกไหม (`rules !== undefined`) */
  it('⭐⭐ กด "ตามเงื่อนไข" แล้วปุ่มต้องสว่างทันที ไม่ต้องรอเพิ่มเงื่อนไข', async () => {
    const { container } = mount();
    const c = container as HTMLElement;
    await waitFor(() => expect(sendSelect(c)).not.toBeNull());
    fireEvent.change(sendSelect(c), { target: { value: 'multicast' } });
    const btn = c.querySelector('button[name="target_rules"]') as HTMLElement;
    expect(btn.className).not.toContain('border-emerald-500');
    fireEvent.click(btn);
    await waitFor(() =>
      expect(
        (c.querySelector('button[name="target_rules"]') as HTMLElement).className,
      ).toContain('border-emerald-500'),
    );
  });
});
