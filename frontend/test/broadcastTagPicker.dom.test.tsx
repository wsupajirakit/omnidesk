/**
 * [FEAT-20260824-BCASTTAGPICK] เลือกป้ายลูกค้าจากรายชื่อ แล้วเก็บเป็น id
 * + [FIX-20260824-VALUEINPUTUNWIRED] ช่องค่าถูกต่อสายจริงแล้ว
 * ===========================================================================
 * เจ้าของ 24/08: *"2 ทำสิครับ dive จริงอย่าสร้างหนี้ทำดี ๆ"*
 * (ข้อ 2 = agent รายงานว่า `customer_tag` ยังใช้บน FE ไม่ได้ เพราะค่าต้องเป็น
 * `tags._id` ไม่ใช่ชื่อป้าย ⇒ แอดมินพิมพ์ "VIP" จะโดนปฏิเสธ)
 *
 * 🔴 บั๊กที่เจอระหว่างทาง และเป็นเหตุผลที่ไฟล์นี้ขับผ่าน `AudienceRuleBuilder`
 *    ไม่ใช่ mount `RuleValueInput` เดี่ยว ๆ:
 *    `RuleValueInput.tsx` **ไม่เคยถูกเรียกจากที่ไหนเลย** — grep ทั้ง repo 24/08
 *    เจอแค่ตัวมันเอง กับ `mint/mintRules.ts` ที่ยืมแค่ฟังก์ชัน `toAbsoluteIso`
 *    ⇒ ช่องค่ายังเป็น `<input type="text">` ธรรมดามาตลอด แปลว่า
 *      · ฟิลด์วันที่ไม่เคยเป็นตัวเลือกวันเวลา
 *      · และค่าที่ส่งไม่เคยมี `+07:00` ติดไป ⇒ BE ตีความตาม TZ ของเครื่องมันเอง
 *        ซึ่งเป็นบั๊กเงียบที่ไฟล์นั้นถูกเขียนขึ้นมาเพื่อแก้โดยเฉพาะ
 *    เทสที่ mount component เดี่ยวจะเขียวสนิททั้งที่ของจริงไม่เคยถูกใช้เลย
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const popularTags = vi.fn();

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/chat', () => ({
  chatService: { popularTags: (...a: unknown[]) => popularTags(...a) },
}));
vi.mock('../services/messaging/broadcastService', () => ({
  broadcastService: { getAudienceSources: () => Promise.resolve(SOURCES) },
}));
vi.mock('../services/admin', () => ({
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

/** รูปเดียวกับที่ `/api/broadcasts/audience-sources` ตอบจริง 24/08 */
const SOURCES = [
  {
    key: 'customer_tag',
    label_th: 'ป้ายกำกับลูกค้า (customer tag)',
    label_en: 'Customer tag',
    type: 'string',
    ops: ['eq', 'in'],
    requires_hook_scope: false,
    indexed: true,
  },
  {
    key: 'follow_up.notice_deposit_at',
    label_th: 'เคยได้รับแจ้งเตือนเรื่องฝาก',
    label_en: 'Was notified about deposits',
    type: 'date',
    ops: ['lte', 'gte'],
    requires_hook_scope: false,
    indexed: true,
  },
];

/** แถวจริงจาก `/api/chat/tags/popular` 24/08 */
const TAGS = [
  { _id: 'a0d000000000000000000007', label: '123123', color: null, use_count: 3 },
  { _id: 'a0d00000000000000000002a', label: '4123', color: null, use_count: 1 },
];

import { AudienceRuleBuilder } from '../components/campaign/audience';
import {
  mergeSelectedIntoOptions,
  selectedIds,
  valueForOp,
} from '../components/campaign/audience';
import { I18nProvider } from '../i18n';
import type { AudienceRule } from '../types';

beforeEach(() => {
  popularTags.mockReset();
  popularTags.mockResolvedValue({ success: true, data: TAGS });
});

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** ขับผ่าน builder จริง พร้อม state ที่เด้งกลับเข้าไปเหมือนฟอร์มทำ */
const Harness: React.FC<{ initial: AudienceRule[]; onRules?: (r: AudienceRule[]) => void }> = ({
  initial,
  onRules,
}) => {
  const [rules, setRules] = React.useState<AudienceRule[]>(initial);
  return (
    <AudienceRuleBuilder
      match="and"
      rules={rules}
      onChange={next => {
        setRules(next.rules);
        onRules?.(next.rules);
      }}
    />
  );
};

const mount = (initial: AudienceRule[], onRules?: (r: AudienceRule[]) => void) =>
  render(
    <I18nProvider>
      <Harness initial={initial} onRules={onRules} />
    </I18nProvider>,
  );

describe('ตัวช่วยล้วน ๆ — รูปค่าตาม operator', () => {
  it('eq เก็บค่าเดี่ยว · in เก็บลิสต์', () => {
    /* BE เช็ค SHAPE — ส่ง array ให้ eq = ปฏิเสธทั้ง job */
    expect(valueForOp('eq', ['a', 'b'])).toBe('a');
    expect(valueForOp('in', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('ไม่ได้เลือกอะไร eq คืน "" ไม่ใช่ undefined หรือ []', () => {
    /* หน้าตาต้องเหมือนช่อง text เดิม เพื่อให้เส้นทางปฏิเสธเดิมยังทำงาน */
    expect(valueForOp('eq', [])).toBe('');
    expect(valueForOp('in', [])).toEqual([]);
  });

  it('อ่านค่าที่เซฟไว้ได้ทั้งสองรูป', () => {
    expect(selectedIds('abc')).toEqual(['abc']);
    expect(selectedIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(selectedIds('')).toEqual([]);
    expect(selectedIds(undefined)).toEqual([]);
  });

  /**
   * 🔴 ตัวสำคัญที่สุดในไฟล์นี้ — id ที่เซฟไว้แต่ไม่อยู่ในรายชื่อยอดนิยม
   *    ถ้าไม่ merge แอดมินจะเห็นเงื่อนไข **ว่าง** แล้ว "แก้ให้" ทับ campaign ที่ใช้ได้อยู่
   */
  it('id ที่เลือกไว้แต่ไม่รู้จัก ต้องยังโผล่ โดยใช้ id เป็นชื่อ', () => {
    const out = mergeSelectedIntoOptions(TAGS, ['a0d000000000000000000016']);
    expect(out).toHaveLength(3);
    const stray = out[2]!;
    expect(stray.value).toBe('a0d000000000000000000016');
    expect(stray.label).toBe('a0d000000000000000000016');
  });

  it('ไม่ทำ id ซ้ำ เมื่อ id ที่เลือกอยู่ในรายชื่ออยู่แล้ว', () => {
    const out = mergeSelectedIntoOptions(TAGS, [TAGS[0]!._id]);
    expect(out).toHaveLength(2);
  });
});

describe('[FIX-20260824-VALUEINPUTUNWIRED] ช่องค่าถูกต่อสายแล้วจริง', () => {
  it('🔴 ฟิลด์ประเภทวันที่ ออกมาเป็นตัวเลือกวันเวลา ไม่ใช่ช่องพิมพ์', async () => {
    const { container } = mount([
      { key: 'follow_up.notice_deposit_at', op: 'lte', value: '' } as AudienceRule,
    ]);
    await waitFor(() => {
      expect(q(container, 'audience_value_0-date')).not.toBeNull();
    });
    expect(
      (q(container, 'audience_value_0-date') as HTMLInputElement).type,
    ).toBe('datetime-local');
  });

  it('🔴 ค่าที่ออกจากช่องวันที่ มี offset ติดไปด้วย (นี่คือบั๊กเงียบที่แก้)', async () => {
    const seen: AudienceRule[][] = [];
    const { container } = mount(
      [{ key: 'follow_up.notice_deposit_at', op: 'lte', value: '' } as AudienceRule],
      r => seen.push(r),
    );
    const box = await waitFor(() => {
      const el = q(container, 'audience_value_0-date');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.change(box, { target: { value: '2026-08-24T15:00' } });

    const last = seen.at(-1)?.[0]?.value;
    expect(String(last)).toMatch(/(?:Z|[+-]\d{2}:\d{2})$/);
    /* ค่าดิบจาก datetime-local ต้องไม่ถูกส่งตรง ๆ */
    expect(last).not.toBe('2026-08-24T15:00');
  });
});

describe('customer_tag — เลือกจากรายชื่อ เก็บเป็น id', () => {
  it('🔴 ได้ตัวเลือกป้าย ไม่ใช่ช่องพิมพ์ (type=string ต้องแพ้ให้คีย์)', async () => {
    const { container } = mount([
      { key: 'customer_tag', op: 'in', value: [] } as unknown as AudienceRule,
    ]);
    await waitFor(() => {
      expect(q(container, 'audience_value_0-tag-trigger')).not.toBeNull();
    });
    /* ห้ามเป็นช่อง text ธรรมดา — นั่นคืออาการเดิมที่ใช้งานไม่ได้ */
    expect(q(container, 'audience_value_0-text')).toBeNull();
  });

  it('เลือกป้ายแล้วเก็บ tags._id ไม่ใช่ชื่อ', async () => {
    const seen: AudienceRule[][] = [];
    const { container } = mount(
      [{ key: 'customer_tag', op: 'in', value: [] } as unknown as AudienceRule],
      r => seen.push(r),
    );
    const trigger = await waitFor(() => {
      const el = q(container, 'audience_value_0-tag-trigger');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(trigger);

    const row = await waitFor(() => {
      const el = container.querySelector(
        `[data-testid="audience_value_0-tag-option-${TAGS[0]!._id}"]`,
      );
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.click(row);

    const last = seen.at(-1)?.[0]?.value;
    expect(last).toEqual([TAGS[0]!._id]);
    /* ชื่อป้ายต้องไม่หลุดเข้าไปในค่า */
    expect(JSON.stringify(last)).not.toContain('123123');
  });

  /**
   * 🔴 ถอยเป็นช่องพิมพ์เมื่อโหลดรายชื่อไม่ได้ — เส้น `/api/chat/tags/*` ต้องมี
   *    `ticket.manage` แต่ฟอร์มนี้ใช้ `broadcast.manage` ⇒ คนที่ดูแลบรอดแคสต์
   *    อย่างเดียวจะโดน 403 · เมนูว่างจะอ่านว่า "ไม่มีป้าย" ซึ่งคนละเรื่อง
   */
  it('โหลดไม่ได้ ⇒ ถอยเป็นช่องพิมพ์ + บอกเหตุผล ไม่ใช่เมนูว่าง', async () => {
    popularTags.mockRejectedValue(new Error('403 Forbidden'));
    const { container } = mount([
      { key: 'customer_tag', op: 'in', value: [] } as unknown as AudienceRule,
    ]);
    await waitFor(() => {
      expect(q(container, 'audience_value_0-tag-fallback')).not.toBeNull();
    });
    const note = q(container, 'audience_value_0-tag-fallback-note');
    expect(note?.textContent ?? '').not.toMatch(/broadcast\./);
    expect((note?.textContent ?? '').length).toBeGreaterThan(0);
  });

  it('ค่าที่เซฟไว้แล้วยังแก้ต่อได้ตอนถอยเป็นช่องพิมพ์', async () => {
    popularTags.mockRejectedValue(new Error('403 Forbidden'));
    const { container } = mount([
      {
        key: 'customer_tag',
        op: 'in',
        value: [TAGS[0]!._id],
      } as unknown as AudienceRule,
    ]);
    const box = await waitFor(() => {
      const el = q(container, 'audience_value_0-tag-fallback');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    /* ค่าเดิมต้องอยู่ในช่อง ไม่ใช่ถูกล้างเพราะรายชื่อโหลดไม่ขึ้น */
    expect(box.value).toContain(TAGS[0]!._id);
  });
});
