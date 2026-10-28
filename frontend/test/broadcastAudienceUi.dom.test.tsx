/**
 * [FEAT-20260823-BCASTAUDUI] Choosing who receives a broadcast.
 * ===========================================================================
 * 🔴 THE FIELD LIST IS READ AT RUNTIME. The backend adds a selectable field by
 *    adding ONE registry entry and changing nothing else, so a list copied into
 *    this repo would hide new fields and keep offering retired ones.
 *    `audienceSeamDrift.value.test.ts` already fails if a key appears in this
 *    repo's source; these cases prove the picker actually USES what came back.
 *
 * 🔴 A RULE THE BACKEND CANNOT BUILD REFUSES THE WHOLE JOB rather than being
 *    dropped — dropping one would make the audience WIDER than asked, the one
 *    mistake that cannot be undone once messages are out. So the picker may
 *    only ever offer keys and operators the registry returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sources: { value: unknown } = { value: null };
vi.mock('../services/messaging/broadcastService', () => ({
  broadcastService: {
    getAudienceSources: () =>
      sources.value instanceof Error
        ? Promise.reject(sources.value)
        : Promise.resolve(sources.value),
  },
}));

import { AudienceRuleBuilder } from '../components/campaign/audience';
import type { AudienceRule } from '../types';

/* [UI-20260826-AUDIENCE3] fixture ถูก **พลิก ไม่ได้ถูกลบ**
   เดิมใช้คีย์สมมติ (`display_name`, `follow_up.abandon_at`) เพื่อพิสูจน์ว่า
   "ตัวเลือกมาจาก BE ไม่ใช่จากที่นี่" — เจตนานั้นยังอยู่ครบ
   แต่ตอนนี้ FE กรองด้วย `visibleSources.ts` ตามที่เจ้าของสั่งให้เหลือ 3 ตัว
   ⇒ fixture ต้องใช้คีย์ที่ **อยู่ในรายการที่แสดงจริง** ไม่งั้นเทสวัดตัวกรอง
     แทนที่จะวัดสิ่งที่ตั้งใจวัด
   ⚠️ ตัวสุดท้ายจงใจใส่คีย์ที่ถูก "ซ่อน" ไว้ เพื่อให้เคสใหม่ด้านล่างพิสูจน์ได้ว่า
      ตัวกรองทำงานจริง — ไม่ใช่แค่บังเอิญว่าง */
const SRC = [
  {
    key: 'follow_up.notice_deposit_at',
    label_th: 'เคยได้รับแจ้งเตือนเรื่องฝาก',
    label_en: 'Was notified about deposits',
    type: 'date',
    ops: ['has_value'],
    requires_hook_scope: false,
    indexed: true,
  },
  {
    key: 'follow_up.customer_helper_at',
    label_th: 'ได้รับการ์ดลงทะเบียนแต่ยังไม่ลงทะเบียน',
    label_en: 'Got the register card',
    type: 'date',
    ops: ['has_value'],
    requires_hook_scope: false,
    indexed: false,
  },
  {
    /* คีย์นี้ BE ส่งมาจริง แต่อยู่ใน HIDDEN_SOURCE_KEYS ⇒ ต้องไม่โผล่บนจอ */
    key: 'follow_up.abandon_at',
    label_th: 'ค้างสมัคร',
    label_en: 'Abandoned at',
    type: 'date',
    ops: ['lte', 'gte'],
    requires_hook_scope: false,
    indexed: false,
  },
];

beforeEach(() => {
  sources.value = SRC;
});

function draw(rules: AudienceRule[] = [], onChange = vi.fn()) {
  const view = render(
    <AudienceRuleBuilder match="and" rules={rules} onChange={onChange} />,
  );
  return { view, onChange };
}

const sel = (c: HTMLElement, n: string) =>
  c.querySelector(`[name="${n}"]`) as HTMLSelectElement | HTMLInputElement | null;

describe('the field list comes from the backend', () => {
  it('🔴 offers exactly what the registry returned', async () => {
    /* ⚠️ Rendered WITH a rule rather than by clicking "add": the builder is a
       controlled component — it reports the new rule and the parent owns the
       list, so a `vi.fn()` parent never re-renders and no row appears. Testing
       through a fake that cannot hold state would prove the component broken
       when it is behaving correctly. คุมจากพ่อ ⇒ ต้องมีแถวมาก่อน. */
    const { view } = draw([{ key: 'follow_up.notice_deposit_at', op: 'eq', value: 'x' }]);
    await waitFor(() => expect(sel(view.container, 'audience_key_0')).not.toBeNull());

    const options = Array.from(
      (sel(view.container, 'audience_key_0') as HTMLSelectElement).options,
    ).map(o => o.value);
    /* คีย์ที่ถูกซ่อน (`follow_up.abandon_at`) ต้อง **ไม่** อยู่ในนี้ */
    expect(options).toEqual(['follow_up.notice_deposit_at', 'follow_up.customer_helper_at']);
  });

  it('🔴 offers only the operators THAT field declares', async () => {
    /* Each source carries its own `ops`. Offering one it did not declare builds
       a rule the backend refuses — and a refused rule stops the whole job. */
    const { view } = draw([{ key: 'follow_up.notice_deposit_at', op: 'eq', value: 'x' }]);
    await waitFor(() => expect(sel(view.container, 'audience_op_0')).not.toBeNull());
    const ops = Array.from(
      (sel(view.container, 'audience_op_0') as HTMLSelectElement).options,
    ).map(o => o.value);
    expect(ops).toEqual(['has_value']);
  });

  it('🔴 switching the field RESETS the operator to one that field allows', async () => {
    /* Keeping `eq` after switching to a date field builds a rule the backend
       refuses. เปลี่ยน field ต้องรีเซ็ต op. */
    const { view, onChange } = draw([{ key: 'follow_up.notice_deposit_at', op: 'eq', value: 'x' }]);
    await waitFor(() => expect(sel(view.container, 'audience_key_0')).not.toBeNull());
    fireEvent.change(sel(view.container, 'audience_key_0') as HTMLSelectElement, {
      target: { value: 'follow_up.customer_helper_at' },
    });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0];
    expect(next.rules[0]).toMatchObject({ key: 'follow_up.customer_helper_at', op: 'has_value' });
  });

  it('🔴 warns when a field has no index — slow is the admin’s call', async () => {
    /* The registry declares `indexed` rather than assuming it. Hiding an
       un-indexed field would be deciding for them. */
    const { view } = draw([{ key: 'follow_up.customer_helper_at', op: 'has_value', value: '' }]);
    await waitFor(() =>
      expect(view.queryByTestId('audience-slow-0')).not.toBeNull(),
    );
  });

  it('an indexed field carries no warning', async () => {
    const { view } = draw([{ key: 'follow_up.notice_deposit_at', op: 'eq', value: 'x' }]);
    await waitFor(() => expect(sel(view.container, 'audience_op_0')).not.toBeNull());
    expect(view.queryByTestId('audience-slow-0')).toBeNull();
  });
});

describe('editing rules', () => {
  /* [UI-20260826-AUDIENCE3] เคสใหม่ — พิสูจน์ว่า "ซ่อน" ทำงานจริง
     BE ส่ง `follow_up.abandon_at` มาใน fixture ด้วย แต่มันอยู่ใน HIDDEN_SOURCE_KEYS
     ⇒ ต้องไม่มีทางโผล่ให้คนเลือก · ถ้าใครลบตัวกรองทิ้ง เคสนี้แดงทันที
     ⚠️ เช็คทั้งสองทาง: ไม่อยู่ในตัวเลือก **และ** จำนวนตัวเลือกน้อยกว่าที่ BE ส่งมา
        (เช็คทางเดียวจะเขียวได้ถ้าตัวเลือกว่างเปล่าเพราะโหลดพัง) */
  it('⭐ คีย์ที่ถูกซ่อนไม่โผล่ให้เลือก ถึงแม้ BE จะส่งมา', async () => {
    const { view } = draw([{ key: 'follow_up.notice_deposit_at', op: 'has_value', value: '' }]);
    await waitFor(() => expect(sel(view.container, 'audience_key_0')).not.toBeNull());
    const options = Array.from(
      (sel(view.container, 'audience_key_0') as HTMLSelectElement).options,
    ).map(o => o.value);
    expect(options).not.toContain('follow_up.abandon_at');
    expect(options.length).toBeLessThan(SRC.length);
    expect(options.length).toBeGreaterThan(0);
  });

  it('adding one uses the first field and ITS first operator', async () => {
    const { view, onChange } = draw();
    await waitFor(() =>
      expect(view.container.querySelector('[name="audience_add"]')).not.toBeNull(),
    );
    fireEvent.click(sel(view.container, 'audience_add') as HTMLButtonElement);
    expect(onChange.mock.calls.at(-1)?.[0].rules[0]).toMatchObject({
      key: 'follow_up.notice_deposit_at',
      op: 'has_value',
    });
  });

  it('removing one leaves the others alone', async () => {
    const { view, onChange } = draw([
      { key: 'follow_up.notice_deposit_at', op: 'eq', value: 'a' },
      { key: 'follow_up.notice_deposit_at', op: 'eq', value: 'b' },
    ]);
    await waitFor(() =>
      expect(sel(view.container, 'audience_remove_0')).not.toBeNull(),
    );
    fireEvent.click(sel(view.container, 'audience_remove_0') as HTMLButtonElement);
    expect(onChange.mock.calls.at(-1)?.[0].rules).toEqual([
      { key: 'follow_up.notice_deposit_at', op: 'eq', value: 'b' },
    ]);
  });

  it('🔴 no rules says so — an empty box must not read as "nothing will send"', async () => {
    const { view } = draw();
    await waitFor(() => expect(view.queryByTestId('audience-no-rules')).not.toBeNull());
  });
});

describe('when the registry cannot be read', () => {
  it('🔴 says so instead of showing an empty picker', async () => {
    /* An admin who sees no fields and no message concludes the feature is
       broken and files a bug against the wrong half.
       ว่างเปล่าโดยไม่บอกเหตุ = โทษผิดฝั่ง. */
    sources.value = new Error('offline');
    const { view } = draw();
    await waitFor(() =>
      expect(view.queryByTestId('audience-load-error')).not.toBeNull(),
    );
    expect(view.queryByTestId('audience-rule-builder')).toBeNull();
  });
});


describe('[FEAT-20260823-BCASTAUDCAP] the ceiling the backend enforces', () => {
  /**
   * 🔴 THE BACKEND REFUSES PAST IT — IT DOES NOT TRIM. So a form that let an
   * admin add a ninth condition would let them save a campaign that can never
   * send, and the error would surface far from the button that caused it.
   * ⚠️ CHANGE ONE, CHANGE BOTH: `audience-filter.ts` is the authority.
   */
  const rule = (i: number) => ({ key: 'follow_up.notice_deposit_at', op: 'eq' as const, value: `v${i}` });
  /* ⚠️ อ่านเพดานจากไฟล์จริง ไม่ฝังตัวเลข — เดิมฝัง 8 ไว้ตรง ๆ แล้วพอเจ้าของสั่ง
     ปลดเป็น 20 (25/08) เคสทั้งสามนี้แดงทันทีทั้งที่ของไม่ได้พัง · ตัวเลขอยู่ที่
     `AudienceRuleBuilder.tsx` และผูกกับ BE ผ่าน `audienceSeamDrift.value.test.ts`
     ⇒ อ่านมาใช้ ทำให้เคสนี้ทดสอบ "ปุ่มหยุดที่เพดาน" ได้โดยไม่ต้องแก้ทุกครั้งที่
     เพดานขยับด้วยเหตุผลที่ตั้งใจ */
  const CAP = Number(
    /const MAX_RULES = (\d+)/.exec(
      readFileSync(resolve(process.cwd(), 'components/campaign/audience/AudienceRuleBuilder.tsx'), 'utf8'),
    )?.[1],
  );
  const eight = Array.from({ length: CAP }, (_, i) => rule(i));

  it('🔴 the add button stops at the ceiling', async () => {
    const { view } = draw(eight);
    await waitFor(() =>
      expect(view.container.querySelector('[name="audience_add"]')).not.toBeNull(),
    );
    expect(
      (view.container.querySelector('[name="audience_add"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('🔴 and says why — a dead button with no reason reads as a bug', async () => {
    const { view } = draw(eight);
    await waitFor(() => expect(view.queryByTestId('audience-at-limit')).not.toBeNull());
  });

  it('🔴 clicking it at the ceiling adds nothing', async () => {
    const { view, onChange } = draw(eight);
    await waitFor(() =>
      expect(view.container.querySelector('[name="audience_add"]')).not.toBeNull(),
    );
    fireEvent.click(view.container.querySelector('[name="audience_add"]') as HTMLButtonElement);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('one below the ceiling is still addable', async () => {
    const { view } = draw(eight.slice(0, 7));
    await waitFor(() =>
      expect(view.container.querySelector('[name="audience_add"]')).not.toBeNull(),
    );
    expect(
      (view.container.querySelector('[name="audience_add"]') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(view.queryByTestId('audience-at-limit')).toBeNull();
  });
});


/* ── card_type: the picker that must not build the impossible pair ───────── */

describe('[FEAT-20260823-BCASTCARDTYPE] a personalised card needs multicast', () => {
  /**
   * 🔴 `/message/broadcast` carries no recipient list, so a card whose body
   * differs per person has nowhere to put the difference. The backend refuses
   * that pair outright — a picker able to build it would let an admin save a
   * campaign that can never send, and they would find out at send time.
   * broadcast ใส่ค่าเฉพาะคนไม่ได้ ⇒ ห้ามเสนอให้เลือกตั้งแต่แรก.
   */
  const modal = readFileSync(
    resolve(root, 'components/campaign/BroadcastFormModal.tsx'),
    'utf8',
  ).replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

  it('🔴 the card-type picker is shown only for multicast', () => {
    expect(modal).toMatch(/formData\.send_kind === 'multicast' &&/);
  });

  it('🔴 leaving multicast CLEARS a personal card', () => {
    /* Left behind, it is the one pair the backend refuses — and its picker is
       no longer on screen, so the admin could neither see nor fix it.
       ค่าที่มองไม่เห็นแล้ว ต้องไม่ค้างอยู่. */
    expect(modal).toMatch(
      /card_type: e\.target\.value === 'multicast' \? prev\.card_type : null/,
    );
  });

  it('🔴 says what a personalised card COSTS, before it is chosen', () => {
    /* One LINE request per recipient. An admin needs that before picking, not
       after a run takes an hour. ต้องรู้ราคาก่อนเลือก.
       [UI-20260903-CARDTYPETWOPLACES] the warning moved into the picker's own
       file when the control gained a second home on step 5 — assert where it
       actually lives now, so BOTH places are covered by one check. */
    const picker = readFileSync(
      resolve(root, 'components/campaign/form/BroadcastCardTypePicker.tsx'),
      'utf8',
    );
    expect(picker).toContain('broadcast.card_type_cost');
    expect(picker).toMatch(/value === 'personal' &&/);
  });

  it('the default is one card for everybody', () => {
    expect(modal).toMatch(/card_type: null/);
  });
});
