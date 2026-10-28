/**
 * [FEAT-2708-TIERUNLOCK] (งาน 5.5) customer tags "เก็ทใหม่ทุกครั้งเวลากด"
 * — เดิม fetch ครั้งเดียวตอน mount + pane ของ wizard ซ่อนแบบไม่ unmount
 *   ⇒ เปิดฟอร์มค้าง tag ใหม่ไม่โผล่ · ตอนนี้เปิดเมนูเมื่อไหร่ = ยิงใหม่
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

const popularTags = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ data: [{ _id: 'a'.repeat(24), tag: 'VIP', color: '#fff', count: 3 }] }),
);
vi.mock('../services/chat', () => ({
  chatService: { popularTags: (...a: unknown[]) => popularTags(...(a as [number])) },
}));

import { TagValuePicker } from '../components/campaign/audience/TagValuePicker';
import { I18nProvider } from '../i18n';

describe('[TIERUNLOCK] tag fetch-on-open', () => {
  it('⭐⭐ เปิดเมนู 2 รอบ = fetch เพิ่มจาก mount อีก ≥2 ครั้ง', async () => {
    render(
      <I18nProvider>
        <TagValuePicker value={undefined} op="eq" onChange={vi.fn()} name="rule-0" />
      </I18nProvider>,
    );
    await waitFor(() => expect(popularTags).toHaveBeenCalledTimes(1)); // mount (resolve label ของค่าที่เซฟไว้)
    const trigger = screen.getByTestId('rule-0-tag-trigger');
    fireEvent.click(trigger);
    await waitFor(() => expect(popularTags).toHaveBeenCalledTimes(2));
    fireEvent.click(trigger); // ปิด
    fireEvent.click(trigger); // เปิดใหม่
    await waitFor(() => expect(popularTags).toHaveBeenCalledTimes(3));
  });
});
