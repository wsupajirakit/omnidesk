/**
 * [FEAT-20260824-BCASTMINT] ปุ่ม mint ขับผ่าน **ฟอร์มจริง** ไม่ใช่ปุ่มเดี่ยว ๆ
 * ===========================================================================
 * เจ้าของ 24/08: *"เรื่อง mint ต้องใช้ได้ ได้จริงบน fe ทำให้เสร็จอย่าเดา"*.
 *
 * 🔴 ทำไมต้องมีไฟล์นี้ ทั้งที่ `broadcastMint.dom.test.tsx` เขียวอยู่แล้ว
 *    ไฟล์นั้น mount `<MintButton>` เดี่ยว ๆ ⇒ พิสูจน์แค่ว่า "ตัวปุ่มทำงาน"
 *    สิ่งที่พังได้จริงคือ **การต่อสาย**: ปุ่มโผล่ตอนไหน · ค่าที่ mint ออกมาไหลกลับ
 *    เข้า `formData.target` จริงไหม · แล้ว `AudienceRuleBuilder` ที่อยู่ข้างล่าง
 *    มองเห็นมันไหม — ทั้งสามอย่างอยู่ใน `BroadcastFormModal` ไม่ได้อยู่ในตัวปุ่ม
 *    ⇒ เทสที่ mount component เดี่ยวจะเขียวสนิททั้งที่หน้าจอยังใช้ไม่ได้
 *    (บทเรียนเดียวกับ `broadcastPickers.dom.test.tsx` ที่จับ hook picker ถูกล็อกไว้)
 *
 * ⚠️ ปุ่ม mint อยู่ในบล็อกที่ render เมื่อ `formData.target.rules !== undefined`
 *    เท่านั้น ⇒ ต้องกด "ตามเงื่อนไข" ก่อน ปุ่มถึงจะมี ซึ่งเป็นพฤติกรรมที่ตั้งใจ
 *    (mint = เครื่องมือของโหมดเงื่อนไข) แต่ต้องถูกพิสูจน์ ไม่ใช่เดา
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const GROUPS = [{ _id: 'g1', group_name: 'Alpha Group' }];
const HOOKS: Record<string, { _id: string; line_oa_name: string; group: string }[]> = {
  g1: [{ _id: 'h1', line_oa_name: 'OA Alpha', group: 'g1' }],
};

/**
 * ⚠️ รายการฟิลด์มาจาก BE ตอน runtime — ต้องมีคีย์ที่ mint ใช้อยู่ในนี้ ไม่งั้น
 *    `AudienceRuleBuilder` จะไม่มี option ให้ `<select>` แสดงผลค่าที่ mint ใส่
 *    (สะท้อนของจริง: `audience-source.registry.ts:41-60`)
 */
const SOURCES = [
  {
    key: 'display_name',
    label_th: 'ชื่อที่ตั้งใน LINE',
    label_en: 'LINE display name',
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
  {
    key: 'follow_up.notice_withdraw_at',
    label_th: 'เคยได้รับแจ้งเตือนเรื่องถอน',
    label_en: 'Was notified about withdrawals',
    type: 'date',
    ops: ['lte', 'gte'],
    requires_hook_scope: false,
    indexed: true,
  },
];

vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: () => Promise.resolve({ ok: true, status: 200 } as never),
  handleApiResponse: () => Promise.resolve(null),
}));
vi.mock('../services/hook', () => ({
  webhookService: { getHooksByGroup: (id: string) => Promise.resolve(HOOKS[id] ?? []) },
}));
vi.mock('../services/messaging/broadcastService', () => ({
  broadcastService: { getAudienceSources: () => Promise.resolve(SOURCES) },
}));
vi.mock('../services/admin', () => ({
  fetchVisibleGroups: () => Promise.resolve(GROUPS),
  getInitialPreferences: () => null,
  savePreferences: () => Promise.resolve(),
}));

import { BroadcastFormModal } from '../components/campaign/BroadcastFormModal';
/* [FEAT-20260825-BCASTFOLD] การ์ดพับเป็นค่าเริ่มต้นตั้งแต่ 25/08 ⇒ กางก่อนทดสอบ
   ดูเหตุผลที่ `openAllFormSections` ใน test/setup.ts */
import { openAllFormSections } from './setup';
import { I18nProvider } from '../i18n';

const onClose = vi.fn();
const onSubmit = vi.fn(() => Promise.resolve());

beforeEach(() => {
  onClose.mockClear();
  onSubmit.mockClear();
});

const open = (mode: 'create' | 'view' = 'create') =>
  {
    const r = render(
    <I18nProvider>
      <BroadcastFormModal isOpen onClose={onClose} onSubmit={onSubmit} mode={mode} />
    </I18nProvider>,
    );
    openAllFormSections(r.container as HTMLElement);
    return r;
  }

const q = (c: HTMLElement, id: string) =>
  c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** กด "ตามเงื่อนไข" — ประตูเดียวที่ทำให้ส่วนเงื่อนไข (และปุ่ม mint) โผล่ */
const openRulesMode = (c: HTMLElement) => {
  /* [FIX-20260825-CONDMULTICASTONLY] บล็อกเงื่อนไข (และปุ่ม mint ในนั้น) แสดงเฉพาะ
     ตอน Multicast ตั้งแต่ 25/08 — `/message/broadcast` ไม่มีรายชื่อผู้รับ เงื่อนไข
     จึงไม่มีผล เจ้าของสั่งให้ซ่อนไปเลยแทนการเตือน ⇒ ต้องเลือก multicast ก่อน */
  const kind = c.querySelector('select[name="send_kind"]') as HTMLSelectElement | null;
  if (kind) fireEvent.change(kind, { target: { value: 'multicast' } });
  const btn = c.querySelector('[name="target_rules"]') as HTMLElement | null;
  expect(btn).not.toBeNull();
  fireEvent.click(btn as HTMLElement);
};

describe('[FEAT-20260824-BCASTMINT] ปุ่ม mint บนฟอร์มจริง', () => {
  it('ยังไม่โผล่ก่อนเข้าโหมด "ตามเงื่อนไข"', () => {
    const { container } = open();
    /* mint เป็นเครื่องมือของโหมดเงื่อนไข — โผล่ในโหมด "ทุกคน" จะสื่อว่ากดแล้ว
       มีผล ทั้งที่ยังไม่มีที่ให้ค่าลง */
    expect(q(container, 'mint-buttons')).toBeNull();
  });

  it('🔴 โผล่ทันทีที่เข้าโหมดเงื่อนไข — นี่คือการต่อสายที่เทสปุ่มเดี่ยวไม่เห็น', () => {
    const { container } = open();
    openRulesMode(container);
    expect(q(container, 'mint-buttons')).not.toBeNull();
    expect(q(container, 'mint-open-follow_up_notice')).not.toBeNull();
  });

  it('🔴 กด mint แล้วเงื่อนไขไปโผล่ใน rule builder จริง (ค่าไหลกลับเข้า formData)', async () => {
    const { container } = open();
    openRulesMode(container);

    /* ก่อนกด: ยังไม่มีเงื่อนไขสักข้อ */
    expect(q(container, 'audience-no-rules')).not.toBeNull();

    fireEvent.click(q(container, 'mint-open-follow_up_notice') as HTMLElement);
    fireEvent.click(q(container, 'mint-choice-deposit') as HTMLElement);
    /* [FIX-20260825-MINTMULTI] ติ๊กแล้วโมดัลยังไม่ปิด — ต้องกด \"ตกลง\" อีกที
       เพราะเลือกฝาก+ถอนพร้อมกันได้แล้ว */
    fireEvent.click(q(container, 'mint-confirm') as HTMLElement);

    await waitFor(() => {
      expect(q(container, 'audience-no-rules')).toBeNull();
    });

    /* คีย์ที่ mint ใส่ ต้องถูก `<select>` ของ rule builder เลือกไว้จริง
       ถ้าคีย์ไม่ตรงกับที่ BE ส่งมา select จะไม่มี option นี้ แล้วค่าจะเป็น '' */
    const selects = Array.from(
      container.querySelectorAll('select'),
    ) as HTMLSelectElement[];
    const keySelect = selects.find(s =>
      Array.from(s.options).some(o => o.value === 'follow_up.notice_deposit_at'),
    );
    expect(keySelect).toBeDefined();
    expect(keySelect!.value).toBe('follow_up.notice_deposit_at');

    /* และ op ต้องเป็น lte ตามที่เจ้าของเลือก */
    const opSelect = selects.find(s =>
      Array.from(s.options).every(o => ['lte', 'gte'].includes(o.value)),
    );
    expect(opSelect).toBeDefined();
    expect(opSelect!.value).toBe('lte');
  });

  it('เลือก withdraw ได้คีย์อีกตัว ไม่ใช่ตัวเดิม', async () => {
    const { container } = open();
    openRulesMode(container);
    fireEvent.click(q(container, 'mint-open-follow_up_notice') as HTMLElement);
    fireEvent.click(q(container, 'mint-choice-withdraw') as HTMLElement);
    /* [FIX-20260825-MINTMULTI] ติ๊กแล้วโมดัลยังไม่ปิด — ต้องกด \"ตกลง\" อีกที
       เพราะเลือกฝาก+ถอนพร้อมกันได้แล้ว */
    fireEvent.click(q(container, 'mint-confirm') as HTMLElement);

    await waitFor(() => expect(q(container, 'audience-no-rules')).toBeNull());

    const keySelect = Array.from(container.querySelectorAll('select')).find(s =>
      Array.from((s as HTMLSelectElement).options).some(
        o => o.value === 'follow_up.notice_withdraw_at',
      ),
    ) as HTMLSelectElement | undefined;
    expect(keySelect?.value).toBe('follow_up.notice_withdraw_at');
  });

  it('🔴 mint ทับของเดิม แล้วเตือนก่อน — ทั้งสองอย่างบนฟอร์มจริง', async () => {
    const { container } = open();
    openRulesMode(container);

    /* กด mint หนึ่งรอบเพื่อให้มีเงื่อนไขค้างอยู่ 1 ข้อ */
    fireEvent.click(q(container, 'mint-open-follow_up_notice') as HTMLElement);
    fireEvent.click(q(container, 'mint-choice-deposit') as HTMLElement);
    /* [FIX-20260825-MINTMULTI] ติ๊กแล้วโมดัลยังไม่ปิด — ต้องกด \"ตกลง\" อีกที
       เพราะเลือกฝาก+ถอนพร้อมกันได้แล้ว */
    fireEvent.click(q(container, 'mint-confirm') as HTMLElement);
    await waitFor(() => expect(q(container, 'audience-no-rules')).toBeNull());

    /* รอบสอง: ต้องเตือน เพราะมีของจะเสีย */
    fireEvent.click(q(container, 'mint-open-follow_up_notice') as HTMLElement);
    const warn = q(container, 'mint-replace-warning');
    expect(warn).not.toBeNull();
    expect(warn!.textContent).toContain('1');

    fireEvent.click(q(container, 'mint-choice-withdraw') as HTMLElement);
    /* [FIX-20260825-MINTMULTI] ติ๊กแล้วโมดัลยังไม่ปิด — ต้องกด \"ตกลง\" อีกที
       เพราะเลือกฝาก+ถอนพร้อมกันได้แล้ว */
    fireEvent.click(q(container, 'mint-confirm') as HTMLElement);

    /* ทับ ไม่ใช่ต่อท้าย — ยังต้องเหลือเงื่อนไขเดียว */
    await waitFor(() => {
      const keySelects = Array.from(container.querySelectorAll('select')).filter(s =>
        Array.from((s as HTMLSelectElement).options).some(o =>
          o.value.startsWith('follow_up.'),
        ),
      );
      expect(keySelects).toHaveLength(1);
      expect((keySelects[0] as HTMLSelectElement).value).toBe(
        'follow_up.notice_withdraw_at',
      );
    });
  });

  it('โหมดดูอย่างเดียว กดไม่ได้', () => {
    const { container } = open('view');
    const btn = container.querySelector('[name="target_rules"]') as HTMLElement | null;
    if (btn) fireEvent.click(btn);
    const mint = q(container, 'mint-open-follow_up_notice') as HTMLButtonElement | null;
    /* อาจไม่ render เลย (โหมด view เปิดส่วนเงื่อนไขไม่ได้) — ถ้า render ต้อง disabled */
    if (mint) expect(mint.disabled).toBe(true);
  });
});
