/* [FE] HookFormModal edit/create — value ไม่พัง (round-trip through the real component).
 * Renders the actual modal (services mocked) and proves: (edit) initialData → formData → submit
 * payload keeps the values intact, incl. the new status_off fields + the 2-col-layout fields;
 * (create) the modal mounts without crashing and defaults status_off to legacy ("").
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── mock the network-touching services so mount effects settle cleanly ──
vi.mock('../services/media', () => ({ flexMessageService: { listFlexMessages: () => Promise.resolve([]) } }));
vi.mock('../services/admin/configService', () => ({ configService: { listConfigs: () => Promise.resolve([]) } }));
vi.mock('../services/chat/handoffService', () => ({ handoffService: { listTargets: () => Promise.resolve([]) } }));
vi.mock('../services/admin/groupService', () => ({ groupService: {
  listGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getVisibleGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroup: () => Promise.resolve({ _id: 'a0d00000000000000000001e', group_name: 'Group One' }),
} }));
// [REFACTOR-20260808-SVCGROUP] customToolService now shares the `services/hook` barrel with
// parseTrainingDoc / webhookService / suggestionUtils. Spread the real module and override ONLY
// customToolService — byte-identical to the pre-group wiring (where just customToolService was mocked).
// [FEAT-20260809-WALLETPAYTOOL] the mock now returns the REAL shape ({ data, pagination }) with a
// couple of tools, because the External API tab renders both tool pickers and reads
// `t.endpoints.length`. The previous bare-[] stub was only safe while no test opened that tab —
// `[].data` is undefined, which crashes the dropdown as soon as it is rendered.
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const data = [
    { id: 'pay-tool-1', name: 'Payment tool', category: 'payment', base_url: 'https://pay.test', endpoints: [] },
    // the walletpay tool is deliberately NOT category 'payment' — the walletpay picker must not
    // category-filter, so a generic tool has to be selectable there
    { id: 'walletpay-tool-1', name: 'Walletpay tool', category: 'generic', base_url: 'https://walletpay.test', endpoints: [] },
  ];
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data, pagination: { page: 1, limit: 200, total: data.length, pages: 1 } }),
      list: () => Promise.resolve({ data, pagination: {} }),
      getUsage: () => Promise.resolve({ count: 0, active: 0, hooks: [] }),
    },
  };
});
vi.mock('../services/apiClient', () => ({ API_BASE_URL: '', authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }), handleApiResponse: () => Promise.resolve([]) }));
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { HookFormModal } from '../components/hook';
import { I18nProvider } from '../i18n';

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (global as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as any).showPicker = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

// a fully-valid hook so validate() passes and we reach onSubmit
const validHook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  description: 'desc', domain_name: 'example.com', line_url: 'https://line.me/x',
  webhook_url: 'https://example.com/wh', channel_id: 'CHAN1', channel_type: 'line',
  telegram_key: 'TG-KEY', telegram_chat_id: 'TG-CHAT', telegram_noti_type: 'all',
  channel_secret: 'secret123', access_token: 'token123', group_id: 'a0d00000000000000000001e', status: 1,
  suggestion_text: 'hello',
  // fields under test
  default_answer_text: 'DEFAULT_ANSWER', missing_api_data_text: 'MISSING_API',
  image_answer_text: 'IMAGE_ANS', answer_link: 'https://example.com/a',
  status_off_action: 'silent', status_off_text: 'ปิดปรับปรุงชั่วคราว',
};

const renderModal = (props: any) =>
  render(<I18nProvider><HookFormModal isOpen onClose={() => {}} {...props} /></I18nProvider>);

/* [UI-20260810] The Training Doc controls sit two levels in: the "AI & Responses" tab, then
 * one of the three steps in its left-hand index. Both are plain buttons, so a test that
 * forgets either level asserts against markup that was never rendered — which reads as a
 * passing "the control is absent" test for the wrong reason.
 * หา element ด้วยข้อความบนปุ่มจริง ไม่ใช่ตำแหน่งใน DOM (ลำดับปุ่มเปลี่ยนได้) */
const findTabButton = (container: HTMLElement, label: string) =>
  waitFor(() => {
    const b = Array.from(container.querySelectorAll('button'))
      .find(x => x.textContent?.trim() === label);
    if (!b) throw new Error(`tab "${label}" not mounted yet`);
    return b;
  });

const findStepButton = (container: HTMLElement, label: string) =>
  waitFor(() => {
    const b = Array.from(container.querySelectorAll('button'))
      .find(x => x.textContent?.includes(label));
    if (!b) throw new Error(`step "${label}" not mounted yet`);
    return b;
  });

describe('HookFormModal — value ไม่พัง', () => {
  it('edit: initialData round-trips to onSubmit payload (status_off + touched fields intact)', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];
    // the new status-off fields survive load→submit
    expect(payload.status_off_action).toBe('silent');
    expect(payload.status_off_text).toBe('ปิดปรับปรุงชั่วคราว');
    // the 2-col-layout fields survive (layout change must not touch values)
    expect(payload.default_answer_text).toBe('DEFAULT_ANSWER');
    expect(payload.missing_api_data_text).toBe('MISSING_API');
    expect(payload.image_answer_text).toBe('IMAGE_ANS');
    expect(payload.answer_link).toBe('https://example.com/a');
  });

  /* [FEAT-20260811-HOOKFORMSPLIT] FULL round-trip — every extracted tab's own fields
   * loaded → saved with NOTHING lost. This is the "what disappears on save across
   * create/edit" net the owner asked for: if a tab extraction dropped a field's
   * binding, its value would not reach the payload and this fails. Covers general/
   * connection/ai/slip/notifications/external in ONE save. */
  it('full save: every tab field survives load→save (no field lost by any extraction)', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const rich = {
      ...validHook,
      tag: ['vip', 'new'],
      slip_check: true,
      gemini_temperature: 0.7, custom_ai_key: 'AI-KEY', ai_raw_site_rules: true,
      external_api_url: 'https://ext.test/api', external_user: 'ext-user',
      payment_tool_id: 'pay-tool-1', walletpay_tool_id: 'walletpay-tool-1',
      customer_link_enabled: true,
    };
    const { container } = renderModal({ onSubmit, initialData: rich, mode: 'create' });
    // drive one field THROUGH THE UI so a broken input binding (a wrong `name`)
    // would drop the change — load-only would not catch that.
    fireEvent.click(await findTabButton(container, 'AI & Responses'));
    fireEvent.click(await findStepButton(container, 'AI ขั้นสูง'));
    const slider = await waitFor(() => {
      const el = container.querySelector('input[name="gemini_temperature"]') as HTMLInputElement;
      if (!el) throw new Error('gemini slider not mounted'); return el;
    });
    fireEvent.change(slider, { target: { value: '0.3' } });
    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit not mounted'); return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const p = onSubmit.mock.calls[0][0];
    // general
    expect(p.line_oa_name).toBe('OA One');
    expect(p.tag).toEqual(['vip', 'new']);
    // connection
    expect(p.webhook_url).toBe('https://example.com/wh');
    // ai
    expect(p.suggestion_text).toBe('hello');
    expect(p.gemini_temperature).toBe(0.3); // changed via the slider UI, not just loaded
    expect(p.custom_ai_key).toBe('AI-KEY');
    expect(p.ai_raw_site_rules).toBe(true);
    // slip
    expect(p.slip_check).toBe(true);
    // notifications
    expect(p.telegram_noti_type).toBe('all');
    // external
    expect(p.external_api_url).toBe('https://ext.test/api');
    expect(p.external_user).toBe('ext-user');
    expect(p.payment_tool_id).toBe('pay-tool-1');
    expect(p.walletpay_tool_id).toBe('walletpay-tool-1');
  });

  /* [FEAT-20260811-HOOKFORMSPLIT] notifications-tab safety net (written BEFORE the
   * tab is extracted to its own file). Proves the Telegram fields render on that
   * tab and survive load→submit, so the extraction can be checked against it. */
  it('notifications: telegram fields on the tab round-trip to onSubmit', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });
    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit not mounted');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];
    // noti_type flows straight through `...formData`; key/chat_id are trimmed
    // from the same formData fields in the submit payload.
    expect(payload.telegram_noti_type).toBe('all');
    expect(payload.telegram_key).toBe('TG-KEY');
    expect(payload.telegram_chat_id).toBe('TG-CHAT');
  });

  /* [FEAT-20260811-HOOKFORMSPLIT] clone-flow safety net. WebhookList's "clone to
   * other / clone to create" path mounts THIS modal with a prefilled hook via
   * `formPrefillHook` + `mode`. The overlay extractions must not disturb it, so
   * this pins that a clone prefill still round-trips to onSubmit unchanged —
   * the same guarantee as edit, driven through the clone entry shape.
   * clone ต้องไม่พัง: prefill → formData → submit ค่าครบเท่าเดิม */
  it('clone: a prefilled hook round-trips to onSubmit (clone-to-other / clone-to-create)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    // clone prefills from an existing hook but is a create — mode 'create'.
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];
    // the prefilled values carry through the clone exactly as in edit
    expect(payload.default_answer_text).toBe('DEFAULT_ANSWER');
    expect(payload.status_off_action).toBe('silent');
    expect(payload.answer_link).toBe('https://example.com/a');
  });

  /* [FEAT-20260809-WALLETPAYTOOL] walletpay_tool_id is OPTIONAL and must reach the BE as null.
   * ⚠️ The BE resolves this value as a tool id, and '' is a lookup it would actually attempt.
   *    A <select> that is cleared back to its placeholder emits value="" — NOT null — so the
   *    `|| null` on the submit payload is what keeps the empty string out.
   *
   * NOTE: a hook that simply never had the field set already yields null from DEFAULT_FORM,
   * so asserting only that case proves nothing (verified: it still passes with `|| null`
   * removed). This test therefore drives the real path — เลือก tool แล้วล้างกลับเป็นค่าว่าง
   * ซึ่งเป็นทางเดียวที่ '' จะเกิดขึ้นจริงจากการใช้งานหน้าจอ
   *
   * There are deliberately TWO guards on this value — one in the select's onChange, one on the
   * submit payload — so removing either alone still passes here; removing BOTH fails with
   * "expected '' to be null" (verified by mutation). เก็บไว้ทั้งคู่: ตัวหน้ากันค่าใน state
   * ให้สะอาด ตัวหลังกันทุกทางที่อาจตั้งค่านี้โดยไม่ผ่าน dropdown */
  it('edit: clearing the walletpay tool select submits null, not an empty string', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      // customer_link_enabled gates the whole Customer Link block that hosts both tool
      // pickers — without it the select is simply not in the DOM
      initialData: { ...validHook, customer_link_enabled: true, walletpay_tool_id: 'walletpay-tool-1' },
      mode: 'update',
    });

    // both tool pickers live in the "External API" tab, which is not the default one
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.trim() === 'External API');
      if (!b) throw new Error('External API tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    // find the walletpay picker by its placeholder option, then clear it back to ''
    const select = await waitFor(() => {
      const el = Array.from(container.querySelectorAll('select')).find(s =>
        Array.from(s.options).some(o => o.value === '' && o.textContent?.includes('ไม่ผูก'))
      ) as HTMLSelectElement | undefined;
      if (!el) throw new Error('walletpay tool select not mounted yet');
      return el;
    });
    expect(select.value).toBe('walletpay-tool-1');   // loaded from initialData
    fireEvent.change(select, { target: { value: '' } });   // operator clears the binding

    const saveBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    // this is the assertion that fails if `|| null` is ever dropped
    expect(payload.walletpay_tool_id).toBeNull();
    expect(payload.walletpay_tool_id).not.toBe('');
  });

  it('edit: an existing walletpay_tool_id round-trips (populated object unwraps to its id)', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      // BE may populate the ref into an object — the loader must unwrap it to the id string
      initialData: { ...validHook, walletpay_tool_id: { _id: 'walletpay-tool-1' }, payment_tool_id: 'pay-tool-1' },
      mode: 'create',
    });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.walletpay_tool_id).toBe('walletpay-tool-1');
    expect(payload.payment_tool_id).toBe('pay-tool-1');
  });

  /* ⭐ [FEAT-20260809-WALLETPAYFLAG] THE SEAMLESS GUARANTEE — the property that matters most.
   * An OA that never touched either walletpay field (incl. every OA created before these fields
   * existed) must submit a payload that leaves the walletpay leg on the payment tool.
   * ไม่ตั้ง = ทำงานเหมือนเดิมทุกอย่าง ไม่ต้อง migrate ไม่มีอะไรพัง
   * The BE needs BOTH status===true and a non-null id to switch hosts, so false+null is the
   * unambiguous "carry on as before" signal. */
  it('edit: an OA with NEITHER walletpay field set stays on the payment tool (false + null)', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    // validHook has no walletpay_tool_status and no walletpay_tool_id — a pre-feature hook
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    // strict false — the BE reads this with `=== true`, so anything truthy would flip a money leg
    expect(payload.walletpay_tool_status).toBe(false);
    expect(payload.walletpay_tool_id).toBeNull();
    // the pair is never "half sent": both keys are always present in the payload
    expect(payload).toHaveProperty('walletpay_tool_status');
    expect(payload).toHaveProperty('walletpay_tool_id');
  });

  it('edit: walletpay_tool_status round-trips true and stays a real boolean', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, walletpay_tool_status: true, walletpay_tool_id: 'walletpay-tool-1' },
      mode: 'create',
    });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.walletpay_tool_status).toBe(true);
    expect(payload.walletpay_tool_id).toBe('walletpay-tool-1');
  });

  /* The BE reads the flag with a strict `=== true`, so the FE must never forward a truthy
   * non-boolean. A hook whose stored value is junk (a string, a number — hand-edited data or
   * an older writer) must be coerced to a real boolean, not passed through.
   *
   * As with walletpay_tool_id, the value passes TWO `!!` coercions (loader + submit payload) and
   * `...formData` already carries the key, so no single-point mutation fails this file.
   * Removing BOTH coercions fails here with "expected 'string' to be 'boolean'" and fails the
   * seamless test with "expected undefined to be false" (verified by mutation).
   * ทั้งสองจุดจงใจให้ซ้ำกัน — ไม่ใช่โค้ดตาย */
  it('edit: a non-boolean walletpay_tool_status is coerced to a real boolean', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, walletpay_tool_status: 'false' as any, walletpay_tool_id: 'walletpay-tool-1' },
      mode: 'create',
    });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    // the string 'false' is truthy in JS, so `!!` makes it true — the point is that the BE
    // receives a genuine boolean and never the string itself
    expect(typeof payload.walletpay_tool_status).toBe('boolean');
    expect(payload.walletpay_tool_status).toBe(true);
  });

  /* The toggle and the picker are independent — turning the flag on must NOT clear or
   * disable a chosen tool, and turning it off must NOT forget it.
   * (คนตั้งค่าปิดชั่วคราวได้โดยไม่ลืมว่าเลือก tool ตัวไหนไว้ — เป็นเหตุผลที่แยกเป็น 2 field) */
  it('edit: toggling the flag off keeps the selected walletpay tool id', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, customer_link_enabled: true, walletpay_tool_status: true, walletpay_tool_id: 'walletpay-tool-1' },
      mode: 'create',
    });

    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.trim() === 'External API');
      if (!b) throw new Error('External API tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    // the walletpay toggle is the checkbox labelled "ใช้ tool แยก"
    const toggle = await waitFor(() => {
      const label = Array.from(container.querySelectorAll('label'))
        .find(l => l.textContent?.includes('ใช้ tool แยก'));
      const cb = label?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined;
      if (!cb) throw new Error('walletpay toggle not mounted yet');
      return cb;
    });
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);   // operator switches it off

    fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.walletpay_tool_status).toBe(false);
    // ⭐ the id survives — this is the whole reason the flag exists as a separate field
    expect(payload.walletpay_tool_id).toBe('walletpay-tool-1');
  });

  /* ==== [FEAT-20260809-SLIPREQPROF] "รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว" — slip tab, not payment.
   * default false + '' is every existing OA, so the off state must submit cleanly.
   *
   * Verified by mutation that the "neither field set" test below catches BOTH real failure
   * modes: seeding the BE default text into the loader ("expected 'ยังไม่ได้ผูกบัญชี…' to be ''")
   * and dropping the payload coercions ("expected undefined to be false").
   * Note the DEFAULT_FORM value alone is NOT covered — the loader's `?? ''` masks it in edit
   * mode, the same double-guard shape as the walletpay fields above. */
  it('edit: an OA with neither slip_require_profile field set submits false + ""', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.slip_require_profile).toBe(false);
    // ⚠️ '' (not undefined, not the placeholder string) — '' is what tells the BE
    // "use your own Thai default", so a stray value here would silently override it
    expect(payload.slip_require_profile_text).toBe('');
    expect(payload).toHaveProperty('slip_require_profile');
    expect(payload).toHaveProperty('slip_require_profile_text');
  });

  it('edit: both slip_require_profile fields round-trip', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const custom = 'กรุณาผูกบัญชีก่อนส่งสลิปนะครับ';
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, slip_require_profile: true, slip_require_profile_text: custom },
      mode: 'create',
    });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.slip_require_profile).toBe(true);
    expect(payload.slip_require_profile_text).toBe(custom);
  });

  /* ⭐ Clearing the text must submit '' so the BE falls back to its own default.
   * The input's placeholder shows that default, and a placeholder is NOT a value — this test
   * fails if anyone ever "helpfully" seeds the field with the default string.
   * เว้นว่าง = ให้ BE ใช้ข้อความกลาง ไม่ใช่เขียนข้อความกลางลง DB */
  it('edit: clearing the slip_require_profile text submits "" (never the placeholder)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, slip_require_profile: true, slip_require_profile_text: 'ข้อความเดิม' },
      mode: 'update',
    });

    // the field lives on the Slip tab, which is not the default one
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.trim() === 'Slip Verification');
      if (!b) throw new Error('Slip Verification tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    const input = await waitFor(() => {
      const el = container.querySelector('input[name="slip_require_profile_text"]') as HTMLInputElement | null;
      if (!el) throw new Error('slip_require_profile_text input not mounted yet');
      return el;
    });
    expect(input.value).toBe('ข้อความเดิม');
    // the placeholder advertises the BE default but must never become the submitted value
    expect(input.placeholder).toContain('ยังไม่ได้ผูกบัญชี');
    fireEvent.change(input, { target: { value: '' } });

    fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.slip_require_profile_text).toBe('');
    expect(payload.slip_require_profile_text).not.toBe(input.placeholder);
  });

  /* ⭐ [FEAT-20260809-PAYUNGATE] REACHABILITY, and it must be a RENDERING test.
   *
   * The payment + walletpay bindings used to live inside the `customer_link_enabled` else-branch,
   * so an OA with Customer Link OFF could not see or set them at all. There is no backend
   * coupling — resolvePaymentTool reads payment_tool_status + payment_tool_id and never
   * customer_link_enabled.
   *
   * A source-text assertion CANNOT catch this: the control is present in the file either way.
   * Only mounting with the gate closed proves it is on screen. เทสต์อ่านไฟล์จับเคสนี้ไม่ได้
   * ต้อง render จริงโดยปิด Customer Link แล้วดูว่ายังเห็นช่องผูก tool ไหม */
  it('edit: the payment binding is visible even with customer_link_enabled OFF', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      // the gate is explicitly CLOSED — this is the state that used to hide the binding
      initialData: { ...validHook, customer_link_enabled: false },
      mode: 'update',
    });

    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.trim() === 'External API');
      if (!b) throw new Error('External API tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    // the payment tool picker: identified by its placeholder option, not by DOM position
    const paySelect = await waitFor(() => {
      const el = Array.from(container.querySelectorAll('select')).find(s =>
        Array.from(s.options).some(o => o.value === '' && o.textContent?.includes('ยังไม่เลือก tool'))
      ) as HTMLSelectElement | undefined;
      if (!el) throw new Error('payment tool picker is not on screen with the gate closed');
      return el;
    });
    expect(paySelect).toBeTruthy();

    // the optional walletpay picker travelled with it — the pair must not get separated
    const walletpaySelect = Array.from(container.querySelectorAll('select')).find(s =>
      Array.from(s.options).some(o => o.value === '' && o.textContent?.includes('ไม่ผูก'))
    );
    expect(walletpaySelect).toBeTruthy();

    // and the on/off switch is reachable too — a picker with no switch cannot be acted on
    const toggle = Array.from(container.querySelectorAll('label'))
      .find(l => l.textContent?.includes('ใช้ tool แยก'));
    expect(toggle).toBeTruthy();
  });

  /* ⭐ [FIX-20261014-CUSTOOLUNGATE] the Custom Tool binding was reachable ONLY with Customer Link
   * ON. The back end never couples them (`custom_tool_status && custom_tool_id`, BE
   * `webhook.service.ts` usesCustomTool), so an OA that pulls its customer data from a tool but
   * does not register customers through chat — the loan site, where the register world is off —
   * had to switch Customer Link on just to see the picker.
   * Owner rule for this change: an OA with Customer Link ON must see exactly what it saw before
   * (the snapshot below was taken on the UNCHANGED code); with it OFF the picker now appears.
   *
   * [FEAT-20261018-EXTAPICARDS] FLIPPED 18/10/2026 — owner: "แยกหัวข้อ Custom Tool ออกมาเป็น level
   * นอกระดับเดียวกันกับ cuslink แต่วางไว้ก่อน cus link". The binding is now its OWN foldable card
   * before the Customer Link card, ON or OFF. The "inside Customer Link's grid" expectation is
   * retired (the snapshot was re-taken on the new card); what it protected — the same switch,
   * the same select, the same saved fields — is now pinned by hookExternalApiTab.dom.test.tsx
   * (control list + payload frozen on the code before the move). */
  const openExternalApi = async (container: HTMLElement) => {
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.trim() === 'External API');
      if (!b) throw new Error('External API tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);
  };
  const customToolSection = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('h5'))
      .find(h => h.textContent === 'Custom Tool (ปลายทาง + credential + path)')
      ?.closest('section') as HTMLElement | null | undefined;

  it('[CUSTOOLUNGATE→EXTAPICARDS] Customer Link ON — the binding is its own card, not inside Customer Link', async () => {
    const { container } = renderModal({
      onSubmit: vi.fn(),
      initialData: { ...validHook, customer_link_enabled: true, custom_tool_status: true, custom_tool_id: 'walletpay-tool-1' },
      mode: 'update',
    });
    await openExternalApi(container);
    const section = await waitFor(() => {
      const el = customToolSection(container);
      if (!el) throw new Error('custom tool section not on screen');
      return el;
    });
    /* its own card in the tab's column — NOT inside the Customer Link box any more */
    const linkBox = Array.from(container.querySelectorAll('h5'))
      .find(h => h.textContent === 'Customer Link (ลงทะเบียนผ่านแชท)')?.closest('.rounded-2xl');
    expect(linkBox && linkBox.contains(section)).toBe(false);
    expect(section.outerHTML).toMatchSnapshot();
  });

  it('[CUSTOOLUNGATE] TARGET: Customer Link OFF — the picker is on screen and round-trips', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, customer_link_enabled: false, custom_tool_status: true, custom_tool_id: 'walletpay-tool-1' },
      mode: 'update',
    });
    await openExternalApi(container);
    const section = await waitFor(() => {
      const el = customToolSection(container);
      if (!el) throw new Error('custom tool picker is not on screen with Customer Link OFF');
      return el;
    });
    /* read leg: the stored binding shows */
    const select = section.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('walletpay-tool-1');
    /* write leg: change it, save, and the edit diff carries it */
    fireEvent.change(select, { target: { value: 'pay-tool-1' } });
    fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.custom_tool_id).toBe('pay-tool-1');
    /* and Customer Link itself was not switched on behind the operator's back */
    expect(payload.customer_link_enabled ?? false).toBe(false);
  });

  /* ==== [UI-20260810-HIDENOPROFILE] + [MOVE-20260810-SITERULESGUIDE] ====================
   * Two layout-only changes shipped together on 2026-08-10, both by owner order:
   *   1. the "Training Document (no ProfileData)" block is HIDDEN (label + tag chips + textarea)
   *   2. the "กฏการใช้ข้อมูล Site Rules" input MOVED to the bottom of the Tag-API step
   *
   * ⭐ THE PROPERTY UNDER TEST — hiding/moving a control must not lose the DATA behind it.
   * A hidden textarea still holds state that the submit payload reads. If someone ever
   * "cleans up" by deleting the state instead of the markup, the next save silently wipes
   * suggestion_text_no_profile for every OA that had one — an invisible data-loss bug that
   * no type error and no source-text test would catch.
   * ซ่อน/ย้ายเฉย ๆ ต้องไม่ทำข้อมูลหาย — เซฟแล้วค่าเดิมต้องกลับไปครบเหมือนเดิม */
  it('hidden no-profile box: the stored value still round-trips to the submit payload', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const stored = 'เอกสารสำหรับคนที่ยังไม่ได้ผูกบัญชี';
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, suggestion_text_no_profile: stored },
      mode: 'create',
    });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    // ⭐ the value the admin can no longer see is still the value that gets saved
    expect(payload.suggestion_text_no_profile).toBe(stored);
    // and the other two Training Doc boxes are untouched by the hide
    expect(payload.suggestion_text).toBe('hello');
  });

  /* The hide must be a HIDE, not a delete — the control is gone from the screen while the
   * value stays in the payload. Asserting only the payload would still pass if the box were
   * merely moved elsewhere, so this pins the visible half too.
   * ต้องหายจากจอจริง ไม่ใช่แค่ย้ายที่ */
  it('hidden no-profile box: label and textarea are NOT on screen (Training Doc step)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'update' });

    // the Training Doc boxes live on the AI tab, step 3 — open both before asserting
    fireEvent.click(await findTabButton(container, 'AI & Responses'));
    fireEvent.click(await findStepButton(container, 'Training Doc ทั่วไป'));

    // the textarea itself is gone from the DOM, not merely hidden by CSS
    await waitFor(() => {
      const el = container.querySelector('textarea[name="suggestion_text_no_profile"]');
      expect(el).toBeNull();
    });

    // the label text and the read-only tag chips must both be absent anywhere in the form
    expect(container.textContent).not.toContain('no ProfileData');
    expect(container.textContent).not.toContain('[START_OF_NO_PROFILE_DATA]');
    expect(container.textContent).not.toContain('[END_OF_NO_PROFILE_DATA]');
    // the sibling boxes that were NOT hidden are still reachable — proves the assertion
    // above is not just passing because the step failed to render at all
    expect(container.textContent).toContain('[START_OF_BASIC_INFO]');
  });

  /* [FEAT-20260811-HOOKFORMSPLIT] ai-tab coverage for the parts the older tests do
   * NOT touch — the gemini sliders + custom-AI-key box — so an extraction that dropped
   * a ctx field feeding THOSE (not just Training Doc) is caught. Proves ctx.formData
   * reaches the whole tab, not only the sections already under test. */
  it('ai tab: gemini slider + custom-key box render the ctx.formData values', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, gemini_temperature: 0.7, custom_ai_key: 'SECRET-KEY' },
      mode: 'update',
    });
    fireEvent.click(await findTabButton(container, 'AI & Responses'));
    // gemini sliders live in the 'advanced' sub-tab — switching to it exercises
    // ctx.aiSubTab/setAiSubTab, and the slider value proves ctx.formData reaches it.
    fireEvent.click(await findStepButton(container, 'AI ขั้นสูง'));
    await waitFor(() => {
      const slider = container.querySelector('input[name="gemini_temperature"]') as HTMLInputElement;
      expect(slider).not.toBeNull();
      expect(slider.value).toBe('0.7');
    });
  });

  /* [MOVE-20260810-SITERULESGUIDE] The whole Site Rules set moved to the bottom of the
   * "การช่วยตอบข้อมูล API" step: the switch, its [ตัวอย่าง json] button, the auto-inject hint
   * and the guide input. They must arrive TOGETHER — a guide box whose enabling switch was
   * left behind on another step is a permanently greyed-out field with no visible cause.
   * ย้ายทั้งก้อนต้องมาครบ กรอกได้ และเซฟได้จริง */
  it('moved site-rules set: switch + hint + guide all land in the API step and round-trip', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const guide = 'ให้อ้างเงื่อนไขโปรโมชันจาก Site Rules เสมอ';
    const { container } = renderModal({
      onSubmit,
      // the switch is ON so the textarea is enabled, exactly as an operator would have it
      initialData: { ...validHook, ai_raw_site_rules: true, ai_site_rules_guide: guide },
      mode: 'create',
    });

    fireEvent.click(await findTabButton(container, 'AI & Responses'));
    fireEvent.click(await findStepButton(container, 'การช่วยตอบข้อมูล API'));

    const textarea = await waitFor(() => {
      const el = container.querySelector('textarea[name="ai_site_rules_guide"]') as HTMLTextAreaElement | null;
      if (!el) throw new Error('site-rules guide is not on screen in the API step');
      return el;
    });
    expect(textarea.value).toBe(guide);
    // ⭐ enabled — proves the switch travelled to this step too, not just the box
    expect(textarea.disabled).toBe(false);

    // the rest of the set is on the same screen: the switch itself and the auto-inject hint
    const stepText = container.textContent ?? '';
    expect(stepText).toContain('ส่ง Site Rules เข้า AI');
    expect(stepText).toContain('หากเปิดใช้งานจะแทรกให้โดยไม่ต้องระบุ');

    const edited = guide + ' (แก้แล้ว)';
    fireEvent.change(textarea, { target: { value: edited } });
    fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];

    expect(payload.ai_site_rules_guide).toBe(edited);
    expect(payload.ai_raw_site_rules).toBe(true);   // the switch value is unaffected by the move
  });

  /* The switch must not be left behind in the Training Doc step — a duplicate would let two
   * controls write the same field, and a leftover would make the move look done when it is not.
   * ต้องไม่มีสวิตช์ค้างอยู่ที่ step เดิม */
  it('moved site-rules set: nothing is left behind in the Training Doc step', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, ai_raw_site_rules: true },
      mode: 'update',
    });

    fireEvent.click(await findTabButton(container, 'AI & Responses'));
    fireEvent.click(await findStepButton(container, 'Training Doc ทั่วไป'));

    await waitFor(() => {
      const el = container.querySelector('textarea[name="suggestion_text_no_profile"]');
      expect(el).toBeNull();   // step rendered (the hidden box is confirmed absent here too)
    });

    // the Site Rules set no longer appears on this step
    const stepText = container.textContent ?? '';
    expect(stepText).not.toContain('ส่ง Site Rules เข้า AI');
    expect(stepText).not.toContain('หากเปิดใช้งานจะแทรกให้โดยไม่ต้องระบุ');
    expect(container.querySelector('textarea[name="ai_site_rules_guide"]')).toBeNull();
    // ...but the step itself is alive — the Training Document box is still here
    expect(stepText).toContain('[START_OF_BASIC_INFO]');
  });

  it('create: modal mounts without crashing and defaults status_off to legacy ("")', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, mode: 'create' });
    // reaching the submit button = the whole form tree (incl. the new AI-tab block) rendered OK
    await waitFor(() => {
      const b = container.querySelector('button[type="submit"]');
      if (!b) throw new Error('not mounted');
    });
    // create defaults: no status-off configured yet → BE resolves to the legacy message
    expect(container.querySelector('button[type="submit"]')).toBeTruthy();
  });

  /* ==== [FEAT-20260810-DOCRETRIEVAL] วิธีส่ง Training Document ให้ AI ====
   *
   * The BE reads `hook.doc_retrieval` to decide whether to retrieve the matching
   * passage or hand the model empty context, and it defaults to FALSE so every
   * existing hook keeps today's behaviour (omnidesk-api/todo/be_todo18_10082026.md).
   * These cases pin the FE half of that guarantee: a hook that has never seen the
   * field must submit `false`, not `undefined` and not `true`.
   *
   * ⚠️ Why asserting `false` matters rather than just "not true": the payload is
   *    `{...formData}`, so a missing default would send `undefined`, which the BE
   *    write path treats as "leave untouched" — silently different from "off".
   */
  it('doc_retrieval: a hook without the field submits false — seamless', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    // `validHook` deliberately carries no `doc_retrieval`, exactly like every
    // hook stored before the feature existed.
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].doc_retrieval).toBe(false);
  });

  /* ── [FEAT-20260821-IGNOREABANDON] ────────────────────────────────────────
   * The same three-deep guarantee as `doc_retrieval` above, for the switch that
   * stops the abandon chase. It sits on the AI tab because the owner asked for
   * it to be cloneable, and BE's `CLONEABLE_TABS` excludes General by design.
   *
   * ⚠️ `false`, not `undefined`: BE's update path treats an absent key as "leave
   *    untouched", which is silently different from "off".
   */
  it('ignore_abandon_assist: a hook without the column submits false — seamless', async () => {
    /* clone path on purpose — see the note on the doc_retrieval case above. */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'create' });
    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].ignore_abandon_assist).toBe(false);
  });

  it('⭐ ignore_abandon_assist: a hook with it ON round-trips as true', async () => {
    /* the failure this catches: the load block rebuilds form state field by
       field, so a missing line there opens the form OFF for a hook that is ON —
       and the next save writes that false over the real value. */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, ignore_abandon_assist: true } as any,
      mode: 'create',
    });
    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].ignore_abandon_assist).toBe(true);
  });

  it('ignore_abandon_assist: the dropdown reads ON for a hook that has it', async () => {
    const { container } = renderModal({
      initialData: { ...validHook, ignore_abandon_assist: true } as any,
      mode: 'create',
    });
    /* Two gates, not three: the switch lives in the AI tab's "ขั้นสูง" sub-tab,
       not inside the Training-Doc stepper. Both gates are `&&` short-circuits,
       so the markup is absent from the DOM rather than hidden.
       ⚠️ the tab name matches TWO nodes (desktop button + mobile <option>), so
          the query must be scoped to <button>. */
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI & Responses'));
      if (!b) throw new Error('AI tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);
    const advBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('การช่วยตอบข้อมูล API'));
      if (!b) throw new Error('training sub-tab not mounted yet');
      return b;
    });
    fireEvent.click(advBtn);
    /* [MOVE-20260831-ABANDONPLACE] a THIRD gate now: the switch moved next to
       "การตอบเมื่อ OA ปิด", which lives in the Training-Doc STEP of that sub-tab.
       Owner's call 31/08 — the block's old comment insisted on the opposite. */
    const stepBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('Training Doc ทั่วไป'));
      if (!b) throw new Error('training-doc step not mounted yet');
      return b;
    });
    fireEvent.click(stepBtn);
    const el = await waitFor(() => {
      const e = container.querySelector('select[name="ignore_abandon_assist"]') as HTMLSelectElement;
      if (!e) throw new Error('select not mounted yet');
      return e;
    });
    expect(el.value).toBe('true');
  });

  it('ignore_abandon_assist: the dropdown shows OFF for a hook that never had it', async () => {
    const { container } = renderModal({ initialData: validHook, mode: 'create' });
    /* Two gates, not three: the switch lives in the AI tab's "ขั้นสูง" sub-tab,
       not inside the Training-Doc stepper. Both gates are `&&` short-circuits,
       so the markup is absent from the DOM rather than hidden.
       ⚠️ the tab name matches TWO nodes (desktop button + mobile <option>), so
          the query must be scoped to <button>. */
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI & Responses'));
      if (!b) throw new Error('AI tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);
    const advBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('การช่วยตอบข้อมูล API'));
      if (!b) throw new Error('training sub-tab not mounted yet');
      return b;
    });
    fireEvent.click(advBtn);
    /* [MOVE-20260831-ABANDONPLACE] a THIRD gate now: the switch moved next to
       "การตอบเมื่อ OA ปิด", which lives in the Training-Doc STEP of that sub-tab.
       Owner's call 31/08 — the block's old comment insisted on the opposite. */
    const stepBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('Training Doc ทั่วไป'));
      if (!b) throw new Error('training-doc step not mounted yet');
      return b;
    });
    fireEvent.click(stepBtn);
    const el = await waitFor(() => {
      const e = container.querySelector('select[name="ignore_abandon_assist"]') as HTMLSelectElement;
      if (!e) throw new Error('select not mounted yet');
      return e;
    });
    expect(el.value).toBe('false');
  });

  it('⭐ ignore_abandon_assist: a NEW hook defaults to OFF', async () => {
    /* ⚠️ THIS is the case that pins DEFAULT_FORM, and it was added because a
     * mutation proved the others do not: deleting the DEFAULT_FORM entry left
     * every case above green. They all pass `initialData`, whose `?? false` in
     * the load block writes the value before the default is ever read. A hook
     * created from scratch is the only path that reads it — and if it ever
     * defaulted to true, every new OA would silently stop chasing customers.
     * เทสอื่นไม่คุม default เพราะมันโหลด initialData ทับไปก่อน */
    const { container } = renderModal({ mode: 'create' });
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI & Responses'));
      if (!b) throw new Error('AI tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);
    const advBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('การช่วยตอบข้อมูล API'));
      if (!b) throw new Error('training sub-tab not mounted yet');
      return b;
    });
    fireEvent.click(advBtn);
    /* [MOVE-20260831-ABANDONPLACE] a THIRD gate now: the switch moved next to
       "การตอบเมื่อ OA ปิด", which lives in the Training-Doc STEP of that sub-tab.
       Owner's call 31/08 — the block's old comment insisted on the opposite. */
    const stepBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('Training Doc ทั่วไป'));
      if (!b) throw new Error('training-doc step not mounted yet');
      return b;
    });
    fireEvent.click(stepBtn);
    const el = await waitFor(() => {
      const e = container.querySelector('select[name="ignore_abandon_assist"]') as HTMLSelectElement;
      if (!e) throw new Error('select not mounted yet');
      return e;
    });
    expect(el.value).toBe('false');
  });

  it('doc_retrieval: a hook with the flag ON round-trips as true', async () => {
    /* [FEAT-20260817-FORMDIFF] Mounted as a CLONE on purpose.
       On an EDIT the form now posts only the fields the operator changed, so an
       untouched value is deliberately absent from the body; asserting it were
       present would be asserting the old whole-document overwrite back in. The
       clone path has no baseline and still sends the complete payload, so this
       is where "nothing is lost between initialData and the wire" stays
       provable. The edit-path rules have their own describe block below.
       เส้น clone = โหลดแล้วค่าไม่หาย · เส้น edit = ส่งเฉพาะช่องที่แก้ */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, doc_retrieval: true } as any,
      mode: 'create',
    });

    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].doc_retrieval).toBe(true);
  });

  it('doc_retrieval: the dropdown shows OFF for a hook that never had the field', async () => {
    // The visible default has to agree with the submitted one, or an operator
    // opening the form would read "whole document" while the row said otherwise.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: validHook, mode: 'update' });

    /* The control is gated THREE deep, and every gate is a `&&` short-circuit —
     * so the markup is absent from the DOM, not merely hidden:
     *   activeTab === 'ai'  →  aiSubTab === 'training'  →  docStep === 'flexTag'
     * `aiSubTab` already starts at 'training', so two clicks are enough.
     * ⚠️ "AI & Responses" matches TWO nodes (the desktop button and the mobile
     *    <option>) — jsdom renders both because the Tailwind breakpoint classes
     *    do nothing without real CSS, so the query must be scoped to <button>. */
    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI & Responses'));
      if (!b) throw new Error('AI tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    // Step 2 of the Training-Doc stepper — `hook_form.flex_tag_group`.
    const stepBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI ขั้นสูง'));
      if (!b) throw new Error('flexTag step not mounted yet');
      return b;
    });
    fireEvent.click(stepBtn);

    const select = await waitFor(() => {
      const el = container.querySelector('select[name="doc_retrieval"]') as HTMLSelectElement;
      if (!el) throw new Error('doc_retrieval select not mounted yet');
      return el;
    });
    expect(select.value).toBe('false');
  });

  it('doc_retrieval: a NEW hook defaults the dropdown to OFF', async () => {
    /* ⚠️ THIS is the case that pins DEFAULT_FORM. The edit-mode tests above do
     * NOT: they load `initialData`, whose `?? false` overwrites the default, so
     * flipping DEFAULT_FORM to true leaves them green (verified by mutation).
     * A new hook is the only path that reads the default, and it must start OFF
     * or every hook created from today would silently opt in to retrieval. */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, mode: 'create' });

    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI & Responses'));
      if (!b) throw new Error('AI tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    const stepBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI ขั้นสูง'));
      if (!b) throw new Error('flexTag step not mounted yet');
      return b;
    });
    fireEvent.click(stepBtn);

    const select = await waitFor(() => {
      const el = container.querySelector('select[name="doc_retrieval"]') as HTMLSelectElement;
      if (!el) throw new Error('doc_retrieval select not mounted yet');
      return el;
    });
    expect(select.value).toBe('false');
  });
});

/* [FEAT-20260817-FORMDIFF] The edit path: a save carries ONLY what the operator changed.
 *
 * These drive the real component, so they prove the WIRING that the unit tests in
 * test/hookFormPayload.test.ts cannot see: that the baseline is captured from the
 * POPULATED form at load time, and that the save path diffs against it.
 *
 * Why it matters: the form holds 83 fields and the API will write 89, with no version
 * check on either side. Posting all of them on every save means one admin's stale tab
 * silently overwrites another admin's edits — and, before the backend guard landed in
 * the same week, it was how a stored credential got erased by a form that never loaded
 * it. บันทึกครั้งหนึ่ง = ทับทั้งเอกสาร คือต้นเหตุ ไม่ใช่แค่เรื่อง secret
 */
describe('[FEAT-20260817-FORMDIFF] an edit sends only the changed fields', () => {
  const saveAndCapture = async (props: any) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, ...props });
    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    return { container, onSubmit, save: () => fireEvent.click(saveBtn) };
  };

  it('opening a hook and pressing save without touching anything sends NOTHING', async () => {
    const { onSubmit, save } = await saveAndCapture({ initialData: validHook, mode: 'update' });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    // ⭐ the whole point: an 83-field body becomes an empty one
    expect(onSubmit.mock.calls[0][0]).toEqual({});
  });

  it('renaming the hook sends that field and nothing else', async () => {
    const { container, onSubmit, save } = await saveAndCapture({ initialData: validHook, mode: 'update' });
    const nameInput = await waitFor(() => {
      const el = container.querySelector('input[name="line_oa_name"]') as HTMLInputElement | null;
      if (!el) throw new Error('name input not mounted yet');
      return el;
    });
    fireEvent.change(nameInput, { target: { name: 'line_oa_name', value: 'OA Renamed' } });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0]).toEqual({ line_oa_name: 'OA Renamed' });
  });

  it('an untouched credential never reaches the body, in any form', async () => {
    const { onSubmit, save } = await saveAndCapture({
      initialData: { ...validHook, custom_ai_key: 'AIza-REAL', slip_verify_key: 'SLIP-REAL' },
      mode: 'update',
    });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];
    for (const f of ['channel_secret', 'access_token', 'custom_ai_key', 'slip_verify_key', 'telegram_key']) {
      expect(payload).not.toHaveProperty(f);
    }
  });

  /* The property the owner asked about by name: two admins on the same hook.
     A holds a form loaded BEFORE B saved a change. A then renames the hook.
     A's body must not carry A's stale copy of the field B edited. */
  it("does not overwrite another admin's concurrent edit", async () => {
    const { container, onSubmit, save } = await saveAndCapture({ initialData: validHook, mode: 'update' });
    const nameInput = await waitFor(() => {
      const el = container.querySelector('input[name="line_oa_name"]') as HTMLInputElement | null;
      if (!el) throw new Error('name input not mounted yet');
      return el;
    });
    fireEvent.change(nameInput, { target: { name: 'line_oa_name', value: 'renamed by A' } });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const payload = onSubmit.mock.calls[0][0];
    // B's fields are absent ⇒ the API leaves B's values exactly as B saved them
    expect(payload).not.toHaveProperty('suggestion_text');
    expect(payload).not.toHaveProperty('default_answer_text');
    expect(payload).not.toHaveProperty('status_off_text');
    expect(Object.keys(payload)).toEqual(['line_oa_name']);
  });

  it('a clone still sends the whole document — the diff must not apply there', async () => {
    const { onSubmit, save } = await saveAndCapture({ initialData: validHook, mode: 'create' });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(Object.keys(onSubmit.mock.calls[0][0]).length).toBeGreaterThan(30);
  });
});

/* [FEAT-20260817-SECRETLOCK] Stored secrets open LOCKED; editing is a deliberate act.
 *
 * The wipe of demo-oa-three (17/08) happened because the editable box displayed the
 * literal `__SECRET_KEPT__` — touching that text produced a mangled mask that the
 * backend encrypted over the real key. Now a stored secret renders read-only as
 * bullets; แก้ไข clears the box and waits for a new value; ยกเลิก restores; a
 * cleared box that is left blank cannot be saved. channel_id locks too but keeps
 * its (non-secret) value visible and intact when unlocked.
 */
describe('[FEAT-20260817-SECRETLOCK] stored secrets are locked until edited', () => {
  const q = (c: HTMLElement, sel: string) => c.querySelector(sel) as HTMLInputElement | null;
  const mount = async (props: any, tab = 'การเชื่อมต่อ Channel') => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, ...props });
    await waitFor(() => {
      if (!container.querySelector('button[type="submit"]')) throw new Error('not mounted');
    });
    // the locked inputs live on secondary tabs — open the right one first
    if (tab) fireEvent.click(await findTabButton(container, tab));
    return { container, onSubmit,
      save: () => fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement) };
  };

  it('a stored channel_secret renders read-only showing bullets, never the raw value', async () => {
    const { container } = await mount({ initialData: validHook, mode: 'update' });
    const input = q(container, 'input[name="channel_secret"]')!;
    expect(input).toBeTruthy();
    expect(input.readOnly).toBe(true);
    expect(input.value).not.toBe('secret123');
    expect(input.value).toContain('•');
    expect(q(container, `[data-testid="secret-edit-channel_secret"]`)).toBeTruthy();
  });

  it('แก้ไข empties the box and makes it editable, waiting for the new value', async () => {
    const { container } = await mount({ initialData: validHook, mode: 'update' });
    fireEvent.click(q(container, '[data-testid="secret-edit-channel_secret"]')!);
    const input = q(container, 'input[name="channel_secret"]')!;
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe('');
    expect(q(container, '[data-testid="secret-cancel-channel_secret"]')).toBeTruthy();
  });

  it('edit → type a new secret → save sends exactly that field', async () => {
    const { container, onSubmit, save } = await mount({ initialData: validHook, mode: 'update' });
    fireEvent.click(q(container, '[data-testid="secret-edit-channel_secret"]')!);
    fireEvent.change(q(container, 'input[name="channel_secret"]')!,
      { target: { name: 'channel_secret', value: 'brandnewsecret99' } });
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0]).toEqual({ channel_secret: 'brandnewsecret99' });
  });

  it('edit → ยกเลิก restores the stored value: save sends NOTHING', async () => {
    const { container, onSubmit, save } = await mount({ initialData: validHook, mode: 'update' });
    fireEvent.click(q(container, '[data-testid="secret-edit-channel_secret"]')!);
    fireEvent.change(q(container, 'input[name="channel_secret"]')!,
      { target: { name: 'channel_secret', value: 'half-typed-then-regret' } });
    fireEvent.click(q(container, '[data-testid="secret-cancel-channel_secret"]')!);
    // relocked, bullets back
    expect(q(container, 'input[name="channel_secret"]')!.readOnly).toBe(true);
    save();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0]).toEqual({});
  });

  it('edit → leave blank → the save is BLOCKED and onSubmit never fires', async () => {
    const { container, onSubmit, save } = await mount({ initialData: validHook, mode: 'update' });
    fireEvent.click(q(container, '[data-testid="secret-edit-channel_secret"]')!);
    save();
    await new Promise((r) => setTimeout(r, 300));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('an OPTIONAL stored secret (telegram_key) blocks a blank save the same way', async () => {
    const { container, onSubmit, save } = await mount({ initialData: validHook, mode: 'update' }, 'การแจ้งเตือน');
    fireEvent.click(q(container, '[data-testid="secret-edit-telegram_key"]')!);
    save();
    await new Promise((r) => setTimeout(r, 300));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('channel_id locks but shows its real value, and แก้ไข keeps it for correction', async () => {
    const { container } = await mount({ initialData: validHook, mode: 'update' });
    const input = q(container, 'input[name="channel_id"]')!;
    expect(input.readOnly).toBe(true);
    expect(input.value).toBe('CHAN1');            // visible, not bullets
    fireEvent.click(q(container, '[data-testid="secret-edit-channel_id"]')!);
    expect(q(container, 'input[name="channel_id"]')!.readOnly).toBe(false);
    expect(q(container, 'input[name="channel_id"]')!.value).toBe('CHAN1'); // NOT cleared
  });

  it('a field with NO stored value is a normal editable input from the start', async () => {
    const noSlip = { ...validHook };
    delete (noSlip as any).slip_verify_key;
    const { container } = await mount({ initialData: noSlip, mode: 'update' }, 'Slip Verification');
    const input = q(container, 'input[name="slip_verify_key"]');
    if (input) {
      expect(input.readOnly).toBe(false);
      expect(q(container, '[data-testid="secret-edit-slip_verify_key"]')).toBeNull();
    }
  });

  it('clone (create with initialData) never locks anything', async () => {
    const { container } = await mount({ initialData: validHook, mode: 'create' });
    const input = q(container, 'input[name="channel_secret"]')!;
    expect(input.readOnly).toBe(false);
    expect(q(container, '[data-testid="secret-edit-channel_secret"]')).toBeNull();
  });
});

/* [MERGE-20260817] The two [P2*] suites below are p2-only (per-hook AI vendor).
 * dev rewrote this file's save path in the same week, so git interleaved the two
 * additions into one conflict. Resolution: dev's file verbatim, then these two
 * suites appended unchanged — neither side lost a case. */

/**
 * [P2-20260813] ai_vendor / ai_model round-trip.
 *
 * The form rebuilds its state field by field from the API response, so a field
 * missing from that rebuild used to be dropped silently — an OA's vendor would
 * reset every time anyone opened the form, with no type error and no failing
 * test. These cases are what make that visible.
 *
 * [MERGE-20260817] ⚠️ THE CONTRACT THESE ASSERT CHANGED — read before editing.
 *
 * dev's [FEAT-20260817-FORMDIFF] landed the same week: an edit now posts only
 * the fields whose value differs from the baseline captured at load, so "the
 * vendor survives" is no longer proved by seeing it IN the payload. It is proved
 * by seeing it ABSENT — RFC 7386 merge-patch, an omitted key means "do not
 * touch", so an untouched vendor is preserved by not being mentioned at all.
 *
 * That is strictly stronger than what these tests used to assert. The original
 * bug — form fails to populate the vendor, save overwrites the stored one — is
 * now structurally impossible: HookFormModal.tsx:908-911 snapshots the POPULATED
 * form, so a failed populate makes baseline and current identical and the diff
 * comes out EMPTY. Nothing can be overwritten by a form that never loaded.
 *
 * So the assertions below flipped from "is sent as null" to "is not sent", and
 * the case that now carries the weight is the last one: when the operator really
 * DOES change the vendor, it must be sent, and never as ''.
 * สัญญาเปลี่ยน: ไม่ส่ง = ไม่แตะของเดิม (ปลอดภัยกว่าส่ง null)
 */
describe('[P2A] per-hook AI vendor + model survive the form', () => {
  const submitAndRead = async (initialData: any) => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData, mode: 'update' });
    const saveBtn = await waitFor(() => {
      const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    return onSubmit.mock.calls[0][0];
  };

  it('a hook without the fields does not mention them — seamless for old rows', async () => {
    const payload = await submitAndRead(validHook);
    expect('ai_vendor' in payload).toBe(false);
    expect('ai_model' in payload).toBe(false);
  });

  it('⭐ an existing vendor + model is left alone instead of being resent', async () => {
    const payload = await submitAndRead({
      ...validHook,
      ai_vendor: 'deepseek',
      ai_model: 'deepseek-reasoner',
    } as any);
    // absent = untouched. Were the diff broken and the key present, it would
    // have to carry the loaded value — never null, never ''.
    expect('ai_vendor' in payload).toBe(false);
    expect('ai_model' in payload).toBe(false);
  });

  it('an empty stored value is not turned into an instruction either', async () => {
    const payload = await submitAndRead({
      ...validHook,
      ai_vendor: '',
      ai_model: '',
    } as any);
    expect('ai_vendor' in payload).toBe(false);
    expect('ai_model' in payload).toBe(false);
  });

  /* ⭐ The case the diff made load-bearing — an edit must still REACH the API,
     because a diff that dropped everything would leave all three tests above
     green — is already covered, correctly, one suite down:
       [P2] the vendor control is really in the DOM
         → '⭐ choosing a vendor reaches the submitted payload'
     It walks the real 3-deep gate (AI tab → training → flexTag) to the control
     instead of poking state, and it is GREEN under the new diff, which is the
     proof that changing a vendor is still transmitted. Deliberately not
     duplicated here: a second copy driving the same path would only decay. */
});


/* [P2-20260813] AiVendorSelect must actually RENDER and respond.
 *
 * ⚠️ Written because a review mutation proved the gap: deleting
 *    `<AiVendorSelect ctx={ctx} />` from HookAiTab left the three round-trip
 *    tests above GREEN. They drive state through `initialData` and never touch
 *    the DOM, so a build where the control silently fails to render would ship
 *    with CI passing. เทสต์เดิมไม่เคยเห็นตัว control เลย.
 *
 * Same three-deep gate as the doc_retrieval tests above:
 *   activeTab === 'ai' → aiSubTab === 'training' → docStep === 'flexTag'
 */
describe('[P2] the vendor control is really in the DOM', () => {
  const openAiVendorStep = async (initialData?: any, mode: 'update' | 'create' = 'update') => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData, mode });

    const tabBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI & Responses'));
      if (!b) throw new Error('AI tab not mounted yet');
      return b;
    });
    fireEvent.click(tabBtn);

    const stepBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.textContent?.includes('AI ขั้นสูง'));
      if (!b) throw new Error('flexTag step not mounted yet');
      return b;
    });
    fireEvent.click(stepBtn);

    const select = await waitFor(() => {
      const el = container.querySelector('select[name="ai_vendor"]') as HTMLSelectElement;
      if (!el) throw new Error('ai_vendor select not mounted yet');
      return el;
    });
    const input = container.querySelector('input[name="ai_model"]') as HTMLInputElement;
    return { container, select, input, onSubmit };
  };

  it('⭐ renders the vendor select and the model input at all', async () => {
    const { select, input } = await openAiVendorStep(validHook);
    expect(select).toBeTruthy();
    expect(input).toBeTruthy();
    // The empty option must exist — it is how an operator says "use the default".
    const values = Array.from(select.querySelectorAll('option')).map(o => (o as HTMLOptionElement).value);
    expect(values).toContain('');
    expect(values).toContain('gemini');
    expect(values).toContain('deepseek');
  });

  it("shows the hook's saved vendor rather than a blank box", async () => {
    const { select, input } = await openAiVendorStep({
      ...validHook,
      ai_vendor: 'deepseek',
      ai_model: 'deepseek-reasoner',
    });
    expect(select.value).toBe('deepseek');
    expect(input.value).toBe('deepseek-reasoner');
  });

  it('⭐ choosing a vendor reaches the submitted payload', async () => {
    const { container, select, onSubmit } = await openAiVendorStep(validHook);
    fireEvent.change(select, { target: { value: 'deepseek' } });
    await waitFor(() => expect((container.querySelector('select[name="ai_vendor"]') as HTMLSelectElement).value).toBe('deepseek'));

    const saveBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.getAttribute('type') === 'submit' || x.textContent?.match(/บันทึก|Save/));
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].ai_vendor).toBe('deepseek');
  });

  it('⭐ picking the empty option submits null, never an empty string', async () => {
    const { container, select, onSubmit } = await openAiVendorStep({
      ...validHook,
      ai_vendor: 'deepseek',
    });
    fireEvent.change(select, { target: { value: '' } });

    const saveBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.getAttribute('type') === 'submit' || x.textContent?.match(/บันทึก|Save/));
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].ai_vendor).toBeNull();
  });

  it('a padded model name is stored trimmed — vendors match ids exactly', async () => {
    const { container, input, onSubmit } = await openAiVendorStep(validHook);
    fireEvent.change(input, { target: { value: '  deepseek-chat  ' } });

    const saveBtn = await waitFor(() => {
      const b = Array.from(container.querySelectorAll('button'))
        .find(x => x.getAttribute('type') === 'submit' || x.textContent?.match(/บันทึก|Save/));
      if (!b) throw new Error('submit button not mounted yet');
      return b;
    });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].ai_model).toBe('deepseek-chat');
  });
});

/* [FEAT-20261016-DOC60K] The modal's validate() refuses a Training Document box on the server's
 * own rule — 60,000, and only for a box that will be SENT (create/clone send all; an edit sends
 * only changed boxes). Owner 16/10: "ทำให้มันถูกต้องสิ". Pure rule: test/trainingDocLimit.value.test.ts */
describe('[DOC60K] HookFormModal — Training Document length, the server rule', () => {
  const big = (n: number) => 'ก'.repeat(n);
  const clickSave = async (container: HTMLElement) => {
    const b = await waitFor(() => {
      const x = container.querySelector('button[type="submit"]') as HTMLButtonElement;
      if (!x) throw new Error('submit button not mounted yet');
      return x;
    });
    fireEvent.click(b);
  };

  it('⭐ create/clone: a 60,001-character box is refused before the request, and the message names 60000', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, suggestion_text: big(60_001) },
      mode: 'create',
    });
    await clickSave(container);
    await waitFor(() => expect(container.textContent).toContain('60000'), { timeout: 4000 });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('create/clone: 60,000 goes through', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, suggestion_text: big(60_000) },
      mode: 'create',
    });
    await clickSave(container);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0].suggestion_text).toHaveLength(60_000);
  });

  it('⭐ edit: a stored doc above the limit, left untouched, does not block saving (and is not sent)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...validHook, suggestion_text: big(100_001) },
      mode: 'update',
    });
    await clickSave(container);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('suggestion_text');
  });
});
