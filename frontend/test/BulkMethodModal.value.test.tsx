import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* [FE] BulkMethodModal — the /#/hooks "choose method" stepper.
 * Proves: the stepper drives the RIGHT service call with the RIGHT args per method,
 * the double-confirm (nested modal + ✓) gates the write, the pick path targets exactly
 * the ticked OAs, and MULTI-GROUP (tick several groups → OAs merged across them) works.
 * Selectors use data-testid so the assertions are language-independent.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// hoisted so the vi.mock factories (hoisted to the top) can reference them
const { bulkUpdateHookStatus, bulkUpdateHookSetting, bulkUpdateHookPayment, bulkUpdateHookAbandon, bulkUpdateHookAi, getHooksByGroup } = vi.hoisted(() => ({
  bulkUpdateHookStatus: vi.fn(),
  bulkUpdateHookSetting: vi.fn(),
  // [FEAT-20260809-BULKPAYMENT] payment has its OWN validated endpoint
  bulkUpdateHookPayment: vi.fn(),
  // [FEAT-20260821-BULKABANDON] so does the abandon chase — see its describe below
  bulkUpdateHookAbandon: vi.fn(),
  // [FEAT-20260828-BULKAI] AI ก็มีเส้นของตัวเองเช่นกัน — ดู describe ข้างล่าง
  bulkUpdateHookAi: vi.fn(),
  getHooksByGroup: vi.fn(),
}));

vi.mock('../services/hook', () => ({
  webhookService: { bulkUpdateHookStatus, bulkUpdateHookSetting, bulkUpdateHookPayment, bulkUpdateHookAbandon, bulkUpdateHookAi, getHooksByGroup },
}));
vi.mock('../services/admin/visibleGroups', () => ({
  fetchVisibleGroups: () => Promise.resolve([
    { _id: 'grp1', group_name: 'Group A', description: '' },
    { _id: 'grp2', group_name: 'Group B', description: '' },
  ]),
  filterVisibleHooks: (hs: any[]) => hs,
}));

import { BulkMethodModal } from '../components/bulk';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});
beforeEach(() => {
  bulkUpdateHookStatus.mockReset(); bulkUpdateHookStatus.mockResolvedValue({ success: true, modified: 2 });
  bulkUpdateHookSetting.mockReset(); bulkUpdateHookSetting.mockResolvedValue({ success: true, modified: 2 });
  bulkUpdateHookPayment.mockReset(); bulkUpdateHookPayment.mockResolvedValue({ success: true, modified: 2 });
  // [FEAT-20260821-BULKABANDON] reset it like every sibling — a spy that carries calls
  // between cases makes `toHaveBeenCalledTimes(1)` fail on the SECOND test for no reason
  // that has anything to do with the code. ต้องรีเซ็ตเหมือนตัวอื่น ไม่งั้นนับสะสม.
  bulkUpdateHookAbandon.mockReset(); bulkUpdateHookAbandon.mockResolvedValue({ success: true, modified: 2 });
  bulkUpdateHookAi.mockReset(); bulkUpdateHookAi.mockResolvedValue({ success: true, modified: 2 });
  getHooksByGroup.mockReset();
  getHooksByGroup.mockImplementation((gid: string) => Promise.resolve(
    gid === 'grp1' ? [{ _id: 'gaOA1', line_oa_name: 'GA OA One', alias: 'ga-1' }, { _id: 'gaOA2', line_oa_name: 'GA OA Two', alias: 'ga-2' }]
    : gid === 'grp2' ? [{ _id: 'gbOA1', line_oa_name: 'GB OA One', alias: 'gb-1' }]
    : []
  ));
});

const preselected = [{ id: 'h1', name: 'OA One' }, { id: 'h2', name: 'OA Two' }];
const mount = (props: any) =>
  render(<I18nProvider><BulkMethodModal isOpen onClose={props.onClose || (() => {})} preselected={props.preselected ?? preselected} onApplied={props.onApplied || (() => {})} /></I18nProvider>);

describe('BulkMethodModal — method stepper', () => {
  it('selected path · Slip Verification ON → bulkUpdateHookSetting(ids, slip_check, true); the nested ✓ gates the write', async () => {
    const onApplied = vi.fn(); const onClose = vi.fn();
    const { getByTestId } = mount({ onApplied, onClose });

    fireEvent.click(getByTestId('bm-next'));                 // target(selected) → method
    fireEvent.click(getByTestId('bm-method-slip_check'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));                 // method → confirm
    fireEvent.click(getByTestId('bm-review'));               // opens the 2nd (nested) confirm modal

    expect(bulkUpdateHookSetting).not.toHaveBeenCalled();    // nothing written until the ✓

    fireEvent.click(getByTestId('bm-confirm'));              // the ✓ check
    await waitFor(() => expect(bulkUpdateHookSetting).toHaveBeenCalledTimes(1));
    expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['h1', 'h2'], 'slip_check', true);
    expect(bulkUpdateHookStatus).not.toHaveBeenCalled();
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(onApplied.mock.calls[0][0]).toMatchObject({ state: true, count: 2 });
    expect(onClose).toHaveBeenCalled();
  });

  it('selected path · OA status method routes to bulkUpdateHookStatus(ids, 1) — not the settings endpoint', async () => {
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-method-status'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
    await waitFor(() => expect(bulkUpdateHookStatus).toHaveBeenCalledWith(['h1', 'h2'], 1));
    expect(bulkUpdateHookSetting).not.toHaveBeenCalled();
  });

  it('selected path · Custom Tool OFF → bulkUpdateHookSetting(ids, custom_tool_status, false)', async () => {
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-method-custom_tool_status'));
    fireEvent.click(getByTestId('bm-value-off'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
    await waitFor(() => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['h1', 'h2'], 'custom_tool_status', false));
  });

  it('pick ONE group → OA path targets exactly the ticked OA', async () => {
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-target-pick'));           // tick "pick group → OA"
    fireEvent.click(getByTestId('bm-next'));                  // target → group
    fireEvent.click(getByTestId('bm-group-toggle'));          // open dropdown
    fireEvent.click(await waitFor(() => getByTestId('bm-group-grp1')));  // tick Group A
    fireEvent.click(getByTestId('bm-next'));                  // group → oa
    fireEvent.click(await waitFor(() => getByTestId('bm-oa-gaOA2')));    // pick only GA OA Two
    fireEvent.click(getByTestId('bm-next'));                  // oa → method
    fireEvent.click(getByTestId('bm-method-customer_link_enabled'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
    await waitFor(() => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['gaOA2'], 'customer_link_enabled', true));
    expect(getHooksByGroup).toHaveBeenCalledWith('grp1');
  });

  it('MULTI-GROUP · tick Group A + Group B → OAs merge; pick one from each → ids span both groups', async () => {
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-target-pick'));
    fireEvent.click(getByTestId('bm-next'));                  // → group
    fireEvent.click(getByTestId('bm-group-toggle'));
    fireEvent.click(await waitFor(() => getByTestId('bm-group-grp1')));  // tick A (dropdown stays open)
    fireEvent.click(getByTestId('bm-group-grp2'));            // tick B too
    fireEvent.click(getByTestId('bm-next'));                  // → oa (OAs from A + B)
    fireEvent.click(await waitFor(() => getByTestId('bm-oa-gaOA2')));    // one from A
    fireEvent.click(await waitFor(() => getByTestId('bm-oa-gbOA1')));    // one from B
    fireEvent.click(getByTestId('bm-next'));                  // → method
    fireEvent.click(getByTestId('bm-method-slip_check'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
    await waitFor(() => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['gaOA2', 'gbOA1'], 'slip_check', true));
    expect(getHooksByGroup).toHaveBeenCalledWith('grp1');
    expect(getHooksByGroup).toHaveBeenCalledWith('grp2');
  });

  it('0 preselected (toolbar On/Off with nothing selected) → starts on group→OA pick path, no target step', async () => {
    const { getByTestId, queryByTestId } = mount({ preselected: [] });
    expect(queryByTestId('bm-target-selected')).toBeNull();   // target step skipped
    fireEvent.click(getByTestId('bm-group-toggle'));
    fireEvent.click(await waitFor(() => getByTestId('bm-group-grp1')));
    fireEvent.click(getByTestId('bm-next'));                   // group → oa
    fireEvent.click(await waitFor(() => getByTestId('bm-oa-gaOA1')));
    fireEvent.click(getByTestId('bm-next'));                   // oa → method
    fireEvent.click(getByTestId('bm-method-slip_check'));
    fireEvent.click(getByTestId('bm-value-off'));
    fireEvent.click(getByTestId('bm-next'));                   // method → confirm
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
    await waitFor(() => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['gaOA1'], 'slip_check', false));
  });
});

/* ==== [FEAT-20260809-BULKPAYMENT] the validated payment switch ====================
 * Payment routes to its OWN endpoint because turning it ON is validated server-side and is
 * all-or-nothing: if any target is not ready the BE refuses the WHOLE batch with 403 +
 * blocked[{alias, reason}] and writes nothing. Turning OFF skips validation — a kill switch
 * must work even on a misconfigured OA. เปิดต้องพร้อมทุกตัว · ปิดต้องปิดได้เสมอ
 */
describe('BulkMethodModal — payment (validated endpoint)', () => {
  it('routes to bulkUpdateHookPayment, NOT the generic settings endpoint', async () => {
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-method-payment_tool_status'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));

    await waitFor(() => expect(bulkUpdateHookPayment).toHaveBeenCalledTimes(1));
    // routing it through settings/bulk would skip the readiness check entirely
    expect(bulkUpdateHookSetting).not.toHaveBeenCalled();
    expect(bulkUpdateHookStatus).not.toHaveBeenCalled();
  });

  it.each([['on', true], ['off', false]])(
    'sends %s as a real BOOLEAN, never a string',
    async (which, expected) => {
      const { getByTestId } = mount({});
      fireEvent.click(getByTestId('bm-next'));
      fireEvent.click(getByTestId('bm-method-payment_tool_status'));
      fireEvent.click(getByTestId(`bm-value-${which}`));
      fireEvent.click(getByTestId('bm-next'));
      fireEvent.click(getByTestId('bm-review'));
      fireEvent.click(getByTestId('bm-confirm'));

      await waitFor(() => expect(bulkUpdateHookPayment).toHaveBeenCalledTimes(1));
      const [, value] = bulkUpdateHookPayment.mock.calls[0];
      // ⚠️ the string "false" is TRUTHY in JS — sending it would enable the very OAs an
      // operator was trying to kill. The BE rejects non-booleans for exactly this reason.
      expect(typeof value).toBe('boolean');
      expect(value).toBe(expected);
    },
  );

  it('renders the 403 blocked[] as one row per refused OA, with its reason', async () => {
    // the whole point of the contract: NOTHING was written, so the operator must see which
    // OAs to fix. A generic toast would throw that away.
    const err: any = new Error('payment bulk refused');
    err.blocked = [
      { alias: 'oa-alpha', reason: 'ยังไม่ได้ผูก payment tool' },
      { alias: 'oa-beta', reason: 'tool ที่ผูกไว้ถูกลบไปแล้ว' },
    ];
    bulkUpdateHookPayment.mockRejectedValueOnce(err);

    const onApplied = vi.fn(); const onClose = vi.fn();
    const { getByTestId, getAllByTestId } = mount({ onApplied, onClose });
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-method-payment_tool_status'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));

    // NOTE: the list renders in BOTH the confirm step and the nested confirm modal (which is
    // still open on failure), so there are two copies — assert on all of them, not one.
    const lists = await waitFor(() => {
      const els = getAllByTestId('bm-blocked');
      if (!els.length) throw new Error('blocked list not rendered');
      return els;
    });
    const text = lists.map((e) => e.textContent || '').join(' ');
    // 2 refused OAs × the number of places the list is shown
    expect(getAllByTestId('bm-blocked-row')).toHaveLength(2 * lists.length);
    // both the OA name and the backend's operator-facing Thai reason must be on screen
    expect(text).toContain('oa-alpha');
    expect(text).toContain('ยังไม่ได้ผูก payment tool');
    expect(text).toContain('oa-beta');
    expect(text).toContain('tool ที่ผูกไว้ถูกลบไปแล้ว');

    // a refusal is not a success: the modal stays open so the operator can act on it
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* ==== [FEAT-20260821-BULKABANDON] the abandon chase switch =========================
 * `ignore_abandon_assist` says "this OA does not chase customers who were asked to
 * register and went quiet". The backend route has existed since 21/08
 * (`hooks.controller.ts:340` → `hooks.service.ts:2816`); the screen simply had no
 * entry for it, so an operator with 50 OAs had to open each one by hand.
 *
 * ⚠️ ITS OWN ENDPOINT, NOT THE GENERIC WHITELIST. Adding the field name to
 * `BULK_SETTING_FIELDS` would change a 400 message that `hook-write.golden-spec`
 * compares with legacy BYTE FOR BYTE, and legacy has never heard of this field —
 * every hook-write golden case would disagree for ever. The BE service header says
 * so at `hooks.service.ts:2790-2814`; this test is the front-end half of that rule.
 * อย่าลัดไป route กลาง · golden จะพังถาวร.
 */
describe('BulkMethodModal — abandon chase (its own endpoint)', () => {
  it('⭐⭐ routes to bulkUpdateHookAbandon, NOT the generic settings endpoint', async () => {
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-method-ignore_abandon_assist'));
    fireEvent.click(getByTestId('bm-value-on'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));

    await waitFor(() => expect(bulkUpdateHookAbandon).toHaveBeenCalledTimes(1));
    expect(bulkUpdateHookSetting).not.toHaveBeenCalled();
    expect(bulkUpdateHookStatus).not.toHaveBeenCalled();
    expect(bulkUpdateHookPayment).not.toHaveBeenCalled();
  });

  it.each([['on', true], ['off', false]])(
    '⭐ sends %s as a real BOOLEAN, never a string',
    async (which, expected) => {
      /* ⚠️ the BE rejects a non-boolean on purpose (`hooks.service.ts:2828`): the
         string "false" is TRUTHY in JS, so sending it would SILENCE the chase on
         every OA an operator was trying to switch back on. */
      const { getByTestId } = mount({});
      fireEvent.click(getByTestId('bm-next'));
      fireEvent.click(getByTestId('bm-method-ignore_abandon_assist'));
      fireEvent.click(getByTestId(`bm-value-${which}`));
      fireEvent.click(getByTestId('bm-next'));
      fireEvent.click(getByTestId('bm-review'));
      fireEvent.click(getByTestId('bm-confirm'));

      await waitFor(() => expect(bulkUpdateHookAbandon).toHaveBeenCalledTimes(1));
      const [ids, value] = bulkUpdateHookAbandon.mock.calls[0];
      expect(Array.isArray(ids)).toBe(true);
      expect(typeof value).toBe('boolean');
      expect(value).toBe(expected);
    },
  );

  it('⭐ the method has a label in BOTH languages — never a raw key on screen', () => {
    /* a missing entry renders the key itself, which reads like a bug to the operator */
    const th = JSON.parse(readFileSync(join(process.cwd(), 'i18n/translations/th.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(process.cwd(), 'i18n/translations/en.json'), 'utf8'));
    expect((th['bulk_method.m_abandon'] ?? '').length).toBeGreaterThan(0);
    expect((en['bulk_method.m_abandon'] ?? '').length).toBeGreaterThan(0);
  });
});

/**
 * [FEAT-20260828-BULKAI] ตั้ง AI vendor / model ให้หลาย OA พร้อมกัน
 * ===========================================================================
 * เจ้าของ 28/08: *"หัวข้อ ai แยกเลย / กำหนด ai model / vendor ได้ ติ๊กแยกสองอย่าง
 * นี้ได้ ... ไม่ต้องพ่วงกัน"* พร้อมสั่งกำกับ *"proof ไม่กระทบ method อื่น
 * backtest ทุกตัวใน method ... เลือกไม่เลือกอะไรต้องไม่พัง"*
 *
 * 🔴 หัวใจของเคสชุดนี้คือ **ช่องที่ไม่ได้ติ๊กต้องไม่โผล่ใน body เลย**
 *    ฝั่ง BE แยก "ไม่ได้ส่งมา" (อย่าไปยุ่ง) ออกจาก "ส่ง null" (ล้างเป็นค่าเริ่มต้น)
 *    ⇒ ส่ง `null` มาทั้งที่ผู้ใช้ไม่ได้ติ๊ก = ไปล้างค่าเดิมของ OA ทิ้งโดยไม่มีใครสั่ง
 *    เคสที่ใช้ `toEqual` (ไม่ใช่ `toMatchObject`) คือตัวที่จับเรื่องนี้ได้
 */
describe('[BULKAI] AI vendor / model — ติ๊กแยกกันได้', () => {
  const toAiStep = (getByTestId: any) => {
    fireEvent.click(getByTestId('bm-next'));        // target(selected) → method
    fireEvent.click(getByTestId('bm-method-ai'));
  };
  const writeIt = (getByTestId: any) => {
    fireEvent.click(getByTestId('bm-next'));        // method → confirm
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
  };

  it('⭐⭐ 🔴 ติ๊ก vendor อย่างเดียว ⇒ ส่งเฉพาะ ai_vendor · ai_model ต้องไม่ถูกส่งไป', async () => {
    const { getByTestId } = mount({});
    toAiStep(getByTestId);

    fireEvent.click(getByTestId('bm-ai-vendor-on'));
    fireEvent.change(getByTestId('bm-ai-vendor'), { target: { value: 'gemini' } });
    writeIt(getByTestId);

    await waitFor(() => expect(bulkUpdateHookAi).toHaveBeenCalledTimes(1));
    /* toEqual ไม่ใช่ toMatchObject — คีย์ส่วนเกินต้องทำให้เคสนี้แดง */
    expect(bulkUpdateHookAi).toHaveBeenCalledWith(['h1', 'h2'], { ai_vendor: 'gemini' });
  });

  it('⭐⭐ 🔴 ติ๊ก model อย่างเดียว ⇒ ส่งเฉพาะ ai_model · ai_vendor ต้องไม่ถูกส่งไป', async () => {
    const { getByTestId } = mount({});
    toAiStep(getByTestId);

    fireEvent.click(getByTestId('bm-ai-model-on'));
    fireEvent.change(getByTestId('bm-ai-model'), { target: { value: ' gemini-3.5-flash ' } });
    writeIt(getByTestId);

    await waitFor(() => expect(bulkUpdateHookAi).toHaveBeenCalledTimes(1));
    expect(bulkUpdateHookAi).toHaveBeenCalledWith(['h1', 'h2'], { ai_model: 'gemini-3.5-flash' });
  });

  it('⭐⭐ ติ๊กทั้งคู่ ⇒ ส่งทั้งสองช่องในคำขอเดียว', async () => {
    const { getByTestId } = mount({});
    toAiStep(getByTestId);

    fireEvent.click(getByTestId('bm-ai-vendor-on'));
    fireEvent.change(getByTestId('bm-ai-vendor'), { target: { value: 'deepseek' } });
    fireEvent.click(getByTestId('bm-ai-model-on'));
    fireEvent.change(getByTestId('bm-ai-model'), { target: { value: 'deepseek-chat' } });
    writeIt(getByTestId);

    await waitFor(() => expect(bulkUpdateHookAi).toHaveBeenCalledTimes(1));
    expect(bulkUpdateHookAi).toHaveBeenCalledWith(['h1', 'h2'], {
      ai_vendor: 'deepseek',
      ai_model: 'deepseek-chat',
    });
  });

  it('⭐⭐ 🔴 ติ๊ก model แล้วปล่อยว่าง ⇒ null = ใช้ค่าเริ่มต้น (ไม่ใช่สตริงว่าง)', async () => {
    /* `''` กับ `null` คนละความหมายฝั่ง BE · ส่ง `''` ไปคือค่าที่ schema ไม่ได้ตั้งใจเก็บ */
    const { getByTestId } = mount({});
    toAiStep(getByTestId);

    fireEvent.click(getByTestId('bm-ai-model-on'));
    writeIt(getByTestId);

    await waitFor(() => expect(bulkUpdateHookAi).toHaveBeenCalledTimes(1));
    expect(bulkUpdateHookAi).toHaveBeenCalledWith(['h1', 'h2'], { ai_model: null });
  });

  it('⭐⭐ 🔴 ไม่ติ๊กอะไรเลย ⇒ ไปต่อไม่ได้ และไม่มีการเขียนใด ๆ', async () => {
    const { getByTestId } = mount({});
    toAiStep(getByTestId);

    expect((getByTestId('bm-next') as HTMLButtonElement).disabled).toBe(true);
    expect(bulkUpdateHookAi).not.toHaveBeenCalled();
  });

  it('⭐⭐ 🔴 ติ๊ก vendor แต่ยังไม่เลือกค่า ⇒ ไปต่อไม่ได้', async () => {
    /* ติ๊กแล้วปล่อยว่างบนช่อง vendor แยกจาก "ยังไม่ได้เลือก" ไม่ออกบนจอ
       ⇒ กันไว้ที่ปุ่มไปต่อ ไม่ใช่ปล่อยให้ส่ง null ไปเงียบ ๆ */
    const { getByTestId } = mount({});
    toAiStep(getByTestId);

    fireEvent.click(getByTestId('bm-ai-vendor-on'));
    expect((getByTestId('bm-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('⭐ เตือนเมื่อตั้ง model โดยไม่ตั้ง vendor — เตือน ไม่ห้าม', async () => {
    /* 🔴 ต้องไม่บล็อก: เคส "แก้โมเดลให้ OA ที่รู้ว่าใช้ vendor เดียวกันหมด" ถูกต้อง
       และต้องทำได้ · ดู `hook.schema.ts:225` ว่าทำไมถึงต้องเตือน */
    const { getByTestId, queryByTestId } = mount({});
    toAiStep(getByTestId);

    fireEvent.click(getByTestId('bm-ai-model-on'));
    expect(queryByTestId('bm-ai-model-warn')).not.toBeNull();
    expect((getByTestId('bm-next') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(getByTestId('bm-ai-vendor-on'));
    fireEvent.change(getByTestId('bm-ai-vendor'), { target: { value: 'gemini' } });
    expect(queryByTestId('bm-ai-model-warn')).toBeNull();
  });

  it('⭐⭐ 🔴 AI ไม่โชว์ปุ่ม เปิด/ปิด — ปุ่มที่กดแล้วไม่มีผลคือปุ่มหลอก', async () => {
    const { getByTestId, queryByTestId } = mount({});
    toAiStep(getByTestId);

    expect(queryByTestId('bm-ai-panel')).not.toBeNull();
    expect(queryByTestId('bm-value-on')).toBeNull();
    expect(queryByTestId('bm-value-off')).toBeNull();
  });
});

describe('[BULKAI] backtest — 6 method เดิมยังทำงานเหมือนเดิมทุกตัว', () => {
  /* 🔴 เคสชุดนี้คือคำตอบของคำสั่ง *"proof ไม่กระทบ method อื่น"* · ทางลัดที่อันตราย
     ที่สุดคือไปแก้ `canNext` / `applyNow` ให้หลวมลงเพื่อรองรับ AI แล้วหกตัวเดิม
     พลอยหลวมตาม — เคสข้างล่างจับได้ทันที */
  const run = (getByTestId: any, methodKey: string, on: boolean) => {
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId(`bm-method-${methodKey}`));
    fireEvent.click(getByTestId(on ? 'bm-value-on' : 'bm-value-off'));
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-review'));
    fireEvent.click(getByTestId('bm-confirm'));
  };

  it('⭐⭐ 🔴 ยังต้องเลือก เปิด/ปิด ก่อนถึงจะไปต่อได้ — AI ไม่ได้ทำให้ด่านนี้หลวม', async () => {
    for (const key of ['status', 'slip_check', 'customer_link_enabled', 'custom_tool_status', 'payment_tool_status', 'ignore_abandon_assist']) {
      const { getByTestId, unmount } = mount({});
      fireEvent.click(getByTestId('bm-next'));
      fireEvent.click(getByTestId(`bm-method-${key}`));
      expect((getByTestId('bm-next') as HTMLButtonElement).disabled).toBe(true);
      unmount();
    }
  });

  it('⭐⭐ 🔴 แต่ละ method ยังยิงเส้นของตัวเอง และไม่มีตัวไหนหลุดไปเส้น AI', async () => {
    const cases: Array<[string, boolean, () => void]> = [
      ['status', true, () => expect(bulkUpdateHookStatus).toHaveBeenCalledWith(['h1', 'h2'], 1)],
      ['slip_check', true, () => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['h1', 'h2'], 'slip_check', true)],
      ['customer_link_enabled', false, () => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['h1', 'h2'], 'customer_link_enabled', false)],
      ['custom_tool_status', true, () => expect(bulkUpdateHookSetting).toHaveBeenCalledWith(['h1', 'h2'], 'custom_tool_status', true)],
      ['payment_tool_status', true, () => expect(bulkUpdateHookPayment).toHaveBeenCalledWith(['h1', 'h2'], true)],
      ['ignore_abandon_assist', false, () => expect(bulkUpdateHookAbandon).toHaveBeenCalledWith(['h1', 'h2'], false)],
    ];

    for (const [key, on, assertCall] of cases) {
      bulkUpdateHookStatus.mockClear(); bulkUpdateHookSetting.mockClear();
      bulkUpdateHookPayment.mockClear(); bulkUpdateHookAbandon.mockClear();
      bulkUpdateHookAi.mockClear();

      const { getByTestId, unmount } = mount({});
      run(getByTestId, key, on);
      await waitFor(() => assertCall());
      /* 🔴 ตัวชี้ขาด: ไม่มี method เดิมตัวไหนไปเรียกเส้น AI */
      expect(bulkUpdateHookAi).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('⭐ สลับไป AI แล้วสลับกลับ ⇒ ยังต้องเลือก เปิด/ปิด ใหม่ ไม่ใช่ค้างค่าจาก AI', async () => {
    /* สถานะของ AI ต้องไม่ไหลไปเป็น "พร้อมส่ง" ให้ method ที่เป็นสวิตช์ */
    const { getByTestId } = mount({});
    fireEvent.click(getByTestId('bm-next'));
    fireEvent.click(getByTestId('bm-method-ai'));
    fireEvent.click(getByTestId('bm-ai-model-on'));
    expect((getByTestId('bm-next') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(getByTestId('bm-method-slip_check'));
    expect((getByTestId('bm-next') as HTMLButtonElement).disabled).toBe(true);
  });
});
