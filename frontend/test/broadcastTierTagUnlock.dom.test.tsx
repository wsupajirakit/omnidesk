/**
 * [FEAT-2708-TIERUNLOCK] (งาน 5.5) ปลดล็อค tier + customer tags ให้เลือกได้
 * ===========================================================================
 * เจ้าของ 27/08: tier ติ๊กแบบ select+search multi · customer tags เหมือนกัน
 * — ท่อ BE มีครบอยู่แล้ว (registry + prefilter) ที่ปิดคือชั้นจอ:
 * `visibleSources.ts` (ตัด 26/08 แบบ "ซ่อน ไม่ลบ — ย้ายบรรทัดเดียวคืนได้")
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));

import {
  VISIBLE_SOURCE_KEYS,
  isVisibleSource,
} from '../components/campaign/audience/visibleSources';
import { widgetForKey } from '../components/campaign/audience/valueSource.registry';
import { TierValuePicker } from '../components/campaign/audience/TierValuePicker';
import { I18nProvider } from '../i18n';

describe('[TIERUNLOCK] ชั้นซ่อนถูกปลด', () => {
  it('⭐⭐ tier.code + customer_tag อยู่ใน VISIBLE — follow_up 3 ตัวเดิมยังครบ', () => {
    for (const k of [
      'follow_up.notice_deposit_at',
      'follow_up.notice_withdraw_at',
      'follow_up.customer_helper_at',
      'tier.code',
      'customer_tag',
    ]) {
      expect(isVisibleSource(k), k).toBe(true);
    }
    // tier.name คงซ่อน — จอใช้ code ตามคำสั่ง
    expect(VISIBLE_SOURCE_KEYS).not.toContain('tier.name');
  });

  it('⭐ tier.code ได้ widget "tier" — ช่อง text ตาม type ห้ามโผล่', () => {
    expect(widgetForKey('tier.code')).toBe('tier');
    expect(widgetForKey('customer_tag')).toBe('customer-tag');
    expect(widgetForKey('follow_up.notice_deposit_at')).toBeUndefined();
  });
});

describe('[TIERUNLOCK] TierValuePicker — ติ๊กหลายตัว = สลับ op เป็น in', () => {
  it('⭐⭐ เลือก 2 tier → onChange(["normal","silver"], "in") ครั้งเดียว', async () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <TierValuePicker value="normal" op="eq" onChange={onChange} name="rule-0" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByTestId('rule-0-tier-trigger'));
    await waitFor(() => expect(screen.queryByTestId('rule-0-tier-option-silver')).not.toBeNull());
    fireEvent.click(
      screen.getByTestId('rule-0-tier-option-silver').querySelector('input[type="checkbox"]')!,
    );
    /* [FIX-20260828-RULEONEUPDATE] ค่าและ operator ต้องมาใน **การเรียกครั้งเดียว**
       ก่อนหน้านี้แยกเป็น onOpChange('in') แล้ว onChange([...]) ⇒ ตัวแม่ patch จาก
       state เก่าทั้งคู่ อันหลังทับอันแรก ได้ {op:'eq', value:[a,b]} ลง Mongo
       ⇒ campaign ส่งไม่ออก (เกิดจริงบน stg 28/08) */
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['normal', 'silver'], 'in'),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ตัวเลือกมาจาก tierOptions กลาง — ไม่มี fetch', async () => {
    render(
      <I18nProvider>
        <TierValuePicker value={undefined} op="eq" onChange={vi.fn()} name="rule-1" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByTestId('rule-1-tier-trigger'));
    for (const code of ['normal', 'silver', 'gold']) {
      await waitFor(() => expect(screen.queryByTestId(`rule-1-tier-option-${code}`)).not.toBeNull());
    }
  });
});
