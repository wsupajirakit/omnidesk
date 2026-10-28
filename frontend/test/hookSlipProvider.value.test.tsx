/* [FEAT-20260903-HOOKSLIPPROV] `slip_provider` lives on the HOOK and must survive the form.
 *
 * WHY IT IS ON THE HOOK AND NOT ON THE PAYMENT TOOL: a backtest showed the payment custom
 * tool is unreachable while payment is switched off, and slip verification still runs for a
 * payment-off hook — which is most of them. A knob parked on the tool would therefore never
 * be consulted by the hooks that actually verify slips. It moved next to `slip_verify_key`
 * on the slip tab, and the previous tool-side knob was reverted in the same change.
 *
 * THE BUG THIS GUARDS (the one that eats new hook fields here, repeatedly):
 *   `HookFormModal`'s populate step is a HAND-WRITTEN REBUILD of the API response, not a
 *   spread of it — see the [P2-20260813] warning above `ai_vendor` in that file. A field the
 *   rebuild forgets is simply absent from form state; submit then spreads `formData`, the
 *   diff drops `undefined`, and the field leaves the payload entirely. The API answers 200,
 *   nothing is logged, and the operator's provider choice is quietly gone. Money path: the
 *   wrong provider verifies the slip.
 *
 * WHY IT DRIVES THE REAL MODAL: the failure lives BETWEEN `initialData` and `formData`, so
 * only a real mount can see it. A unit test over `buildHookPayload` would pass with the
 * populate line deleted, because that helper only ever sees the already-broken form state.
 *
 * ⚠️ NOT A SECRET. It is a provider NAME, so it is deliberately absent from
 * `components/hook/form/secretLock.tsx` and `utils/secretMask.ts`. Locking it would hide
 * the value behind an แก้ไข click for no security gain.
 *
 * ── [FEAT-20260903-FIELDOPTIONS] REWRITTEN TWICE ON 03/09 ───────────────────────────────
 * The field shipped as a free-text `<input placeholder="e.g. slipguard">`. Nothing validated
 * it on either side — the back end stores any string and its resolver falls back to the
 * current provider for a name it does not recognise — so a typo produced no error, no
 * warning and no visible difference, on the value that steers the slip vendor for money.
 *
 * The first fix put a fixed list in THIS repository. That was still wrong in the same way:
 * a client-side list can offer a value the server cannot act on, and it drifts from the
 * registry with nothing to catch it. **The server answers now** — there is no vendor list
 * here at all — and the control renders only when the server reports two or more real
 * choices, so it appears by itself the day a second provider is registered.
 *
 * Seven cases were retired across the two rewrites: four that typed into a box no operator
 * can reach, and three that read a module that no longer exists. A test whose subject
 * cannot happen reads as safety without being it.
 *
 * ⭐ MUTATION-MEASURED after the second rewrite — see the note under each case for what it
 * is guarding. The numbers are re-run rather than carried over, because the cases changed.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Same harness as HookFormModal.value.test.tsx / hookQrPrescanMode.dom.test.tsx — only the
// network boundary is mocked, the modal itself is the real one.
vi.mock('../services/media', () => ({ flexMessageService: { listFlexMessages: () => Promise.resolve([]) } }));
vi.mock('../services/admin/configService', () => ({ configService: { listConfigs: () => Promise.resolve([]) } }));
vi.mock('../services/chat/handoffService', () => ({ handoffService: { listTargets: () => Promise.resolve([]) } }));
vi.mock('../services/admin/groupService', () => ({ groupService: {
  listGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getVisibleGroups: () => Promise.resolve([{ _id: 'a0d00000000000000000001e', group_name: 'Group One' }]),
  getGroup: () => Promise.resolve({ _id: 'a0d00000000000000000001e', group_name: 'Group One' }),
} }));
vi.mock('../services/hook', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const data = [{ id: 'pay-tool-1', name: 'Payment tool', category: 'payment', base_url: 'https://pay.test', endpoints: [] }];
  return {
    ...actual,
    customToolService: {
      listCustomTools: () => Promise.resolve({ data, pagination: { page: 1, limit: 200, total: data.length, pages: 1 } }),
      list: () => Promise.resolve({ data, pagination: {} }),
      getUsage: () => Promise.resolve({ count: 0, active: 0, hooks: [] }),
    },
  };
});
const getFieldOptions = vi.fn();
vi.mock('../services/hook/fieldOptionsService', () => ({
  fieldOptionsService: { get: (k: string) => getFieldOptions(k) },
}));
vi.mock('../services/apiClient', () => ({ API_BASE_URL: '', authFetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }), handleApiResponse: () => Promise.resolve([]) }));
vi.mock('../services/authStorage', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getAuthUser: () => ({ username: 'dev', role: 'superadmin', groups: [], permissions: ['system.manage'] }) };
});

import { HookFormModal } from '../components/hook';
import { I18nProvider } from '../i18n';

/* Default: one real choice, so the control is NOT rendered. That is the fleet's
   actual state — one provider registered — and it keeps every case that is about
   the round trip honest about what an operator can currently see. Cases that care
   override with `mockResolvedValueOnce`. */
beforeEach(() => {
  getFieldOptions.mockReset();
  getFieldOptions.mockResolvedValue({
    key: 'slip_provider',
    options: [
      { value: '', label_key: 'field_options.slip_provider.default', is_default: true },
      { value: 'swiftcheck', label_key: 'field_options.slip_provider.swiftcheck' },
    ],
    choice_count: 1,
  });
});

beforeAll(() => {
  (global as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (global as any).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  (window.HTMLElement.prototype as any).showPicker = vi.fn();
  if (!window.matchMedia) (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
});

/** a hook complete enough that validate() passes and submit is actually reached */
const baseHook: any = {
  _id: 'h1', line_oa_name: 'OA One', alias: 'oa-alias', company_name: 'Company',
  description: 'desc', domain_name: 'example.com', line_url: 'https://line.me/x',
  webhook_url: 'https://example.com/wh', channel_id: 'CHAN1', channel_type: 'line',
  channel_secret: 'secret123', access_token: 'token123',
  group_id: 'a0d00000000000000000001e', status: 1, suggestion_text: 'hello',
};

const renderModal = (props: any) =>
  render(<I18nProvider><HookFormModal isOpen onClose={() => {}} {...props} /></I18nProvider>);

/** the slip tab is not the default one — its button carries the slip label */
const openSlipTab = async (container: HTMLElement) => {
  const btn = await waitFor(() => {
    const b = Array.from(container.querySelectorAll('button')).find((x) =>
      /สลิป|Slip/i.test(x.textContent || ''),
    );
    if (!b) throw new Error('slip tab not mounted yet');
    return b;
  });
  fireEvent.click(btn);
};

const submit = async (container: HTMLElement, onSubmit: any) => {
  const saveBtn = await waitFor(() => {
    const b = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    if (!b) throw new Error('submit button not mounted yet');
    return b;
  });
  fireEvent.click(saveBtn);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1), { timeout: 4000 });
  return onSubmit.mock.calls[0][0];
};

describe('hook slip_provider — the stored provider survives load → save', () => {
  /* ⭐ THE ROUND TRIP. Mounted on the CLONE path (`mode: 'create'` with initialData) on
     purpose: an EDIT posts only the fields the operator changed, so an untouched value is
     deliberately absent from that body and asserting it were present would be asserting the
     old whole-document overwrite back in. The clone path has no baseline and still sends the
     complete payload, which is where "loaded ⇒ still on the wire" stays provable — the same
     reasoning the sibling cases in HookFormModal.value.test.tsx carry. */
  it('⭐ a hook loaded with slip_provider still carries it into the save payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, slip_provider: 'slipguard' },
      mode: 'create',
    });

    const payload = await submit(container, onSubmit);

    // nothing was touched between load and save, so the operator's choice must be intact
    expect(payload.slip_provider).toBe('slipguard');
    // ...and it must not have collapsed into the "use the system's provider" empty state
    expect(payload.slip_provider).not.toBe('');
    expect(payload).toHaveProperty('slip_provider');
  });

  /* ⭐⭐ THE CASE THAT MATTERS MOST NOW THE CONTROL IS HIDDEN.
     An operator opening this hook to change something on ANOTHER tab must not silently
     rewrite its provider. That is not hypothetical here: this modal rebuilds form state by
     hand, and a hidden field is exactly the kind that gets dropped from the rebuild and
     never noticed — nobody can see the box to spot that it went blank. So the round trip is
     asserted on an EDIT, with the field never touched and never rendered. */
  it('⭐⭐ hidden ⇒ still preserved: an edit elsewhere does not rewrite the provider', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, slip_provider: 'slipguard' },
      mode: 'create',
    });

    await openSlipTab(container);
    // the control is genuinely absent — this is the hide, asserted rather than assumed
    expect(container.querySelector('[name="slip_provider"]')).toBeNull();

    const payload = await submit(container, onSubmit);
    expect(payload.slip_provider).toBe('slipguard');
    expect(payload.slip_provider).not.toBe('');
  });

  it('the slip tab renders no free-text box for the provider', async () => {
    /* [FEAT-20260903-SLIPPROVSELECT] The field shipped as an <input> with the placeholder
       "e.g. slipguard", so an operator could type anything into a value that steers the slip
       vendor on the money path — and neither side validates it, so a typo produced no
       error and no visible difference. It is a fixed list now, and hidden until a second
       provider is registered. This case fails if either half is undone. */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: { ...baseHook }, mode: 'update' });

    await openSlipTab(container);
    expect(container.querySelector('input[name="slip_provider"]')).toBeNull();
  });

  /* ==== [FEAT-20260903-VENDORBRANCH] the branch rides the same round trip =====
     Some providers put the merchant account in the ENDPOINT, so a hook needs a
     key AND a branch. The branch is worth exactly as much as the provider name,
     and it goes through the same hand-written rebuild — so it gets the same two
     cases rather than being trusted to behave like its neighbour. */
  it('⭐ a hook loaded with slip_verify_branch still carries it into the save payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, slip_provider: 'slipguard', slip_verify_branch: '75134' },
      mode: 'create',
    });

    const payload = await submit(container, onSubmit);

    expect(payload.slip_verify_branch).toBe('75134');
    expect(payload).toHaveProperty('slip_verify_branch');
  });

  it('⭐⭐ hidden ⇒ still preserved: an edit elsewhere does not wipe the branch', async () => {
    /* 🔴 A WIPED BRANCH IS NOT A COSMETIC LOSS. The provider identifies the
       merchant by it, so an empty branch makes the vendor answer "branch not
       found" on EVERY slip for that hook — and the save that caused it returned
       200 with nothing rendered to notice going blank. */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, slip_provider: 'slipguard', slip_verify_branch: '75134' },
      mode: 'create',
    });

    await openSlipTab(container);
    expect(container.querySelector('[name="slip_verify_branch"]')).toBeNull();

    const payload = await submit(container, onSubmit);
    expect(payload.slip_verify_branch).toBe('75134');
    expect(payload.slip_verify_branch).not.toBe('');
  });

  /* ==== 🔴 [FIX-20260903-HOSTNOTAFIELD] THE HOST IS NOT A FIELD ANY MORE =======
     Two cases stood here: one proving `slip_verify_base_url` survived the save
     round trip, one proving its input was always on the slip tab. Both were
     correct for the few hours the field existed — it was added when the host had
     been read from a Swiftcheck-named env and env was ruled out. Then the owner saw
     the form and ruled again: an operator must not type a host, and it does not
     belong in the database.

     They are REPLACED rather than deleted, because a removed control that leaves
     no test behind looks exactly like one nobody got round to building, and the
     next reader re-adds it. What follows asserts the absence — in the DOM and in
     the payload — so bringing the field back means editing this file on purpose.
     ⇒ ลบของออกต้องเหลือหลักฐานว่าตั้งใจ ไม่ใช่ลืม */
  it('⭐ there is NO host input on the slip tab, at any provider count', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: { ...baseHook }, mode: 'update' });

    await openSlipTab(container);

    expect(container.querySelector('[name="slip_verify_base_url"]')).toBeNull();
    // its two neighbours are hidden for a different reason — one provider registered
    expect(container.querySelector('[name="slip_provider"]')).toBeNull();
    expect(container.querySelector('[name="slip_verify_branch"]')).toBeNull();
  });

  it('⭐ a hook that still carries the old value does NOT send it back', async () => {
    /* Rows written while the field existed keep an ignored `''`, and a stale API
       response could still carry one. Hiding an input while the value rode along
       in `formData` would be the worst of both: invisible to the operator and
       still written on every save. The rebuild must drop it outright.

       🔴 `mode: 'create'`, AND THAT IS THE WHOLE TEST. Written first as `'update'`,
       it passed with the field PUT BACK — because an update sends only what
       changed (`diffHookPayload`), so an unchanged value is absent either way and
       the case proved nothing. A create sends the whole payload, and
       `buildHookPayload` opens with `...formData`, so anything the form state
       holds lands in it. Mutation-checked: re-adding the two lines to
       `DEFAULT_FORM` and the rebuild turns this red.
       ⇒ update ส่งเฉพาะที่เปลี่ยน เทสจะผ่านฟรี · ต้องวัดที่ create */
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, slip_verify_base_url: 'https://slip.mine.example' } as any,
      mode: 'create',
    });

    const payload = await submit(container, onSubmit);

    expect(payload).not.toHaveProperty('slip_verify_base_url');
  });
});

/* ==== [FEAT-20260903-FIELDOPTIONS] the list comes from the SERVER now =========
   Three cases that read a module in this repo were retired: that module is gone.
   A client-side list can offer a value the back end cannot act on — the operator
   picks it, it saves, the runtime ignores it, and nothing reports that the choice
   had no effect. The server answers instead, and these cases pin the contract
   this side has to honour. */
describe('slip provider — the control is driven by what the server offers', () => {
  const optionsResponse = (options: any[], choiceCount: number) => ({
    key: 'slip_provider',
    options,
    choice_count: choiceCount,
  });

  it('renders one <option> per value the server sent, in the order it sent them', async () => {
    /* Order is the server's, not this side's: a client that re-sorts makes the two
       disagree about what "first" means, and the default has to stay first. */
    getFieldOptions.mockResolvedValueOnce(
      optionsResponse(
        [
          { value: '', label_key: 'field_options.slip_provider.default', is_default: true },
          { value: 'swiftcheck', label_key: 'field_options.slip_provider.swiftcheck' },
          { value: 'slipguard', label_key: 'field_options.slip_provider.slipguard' },
        ],
        2,
      ),
    );
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: { ...baseHook }, mode: 'update' });

    await openSlipTab(container);
    const select = await waitFor(() => {
      const el = container.querySelector('select[name="slip_provider"]') as HTMLSelectElement | null;
      if (!el) throw new Error('the select never rendered');
      return el;
    });

    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'swiftcheck', 'slipguard']);
    /* [FEAT-20260903-VENDORBRANCH] the branch input shares this control's
       condition, so it appears the day a second provider is registered — with no
       release here, which is the property the options endpoint exists for. */
    expect(container.querySelector('input[name="slip_verify_branch"]')).not.toBeNull();
  });

  it('⭐ [FALLBACKLABEL] a vendor this build has never heard of shows its NAME, not a raw key', async () => {
    /* 🔴 THE HALF-TRUTH THIS CLOSES. The endpoint's promise is that a provider
       registered on the back end appears here with no release on this side. The
       CONTROL did — the NAME did not: i18n resolves an unknown key to the key
       itself, so the operator would have been offered a choice literally reading
       `field_options.slip_provider.slipguard` on the tab that steers money.

       `slipguard` below has NO translation in this repo on purpose — that is the
       whole scenario. `swiftcheck` does, and it must still win over the server's
       plain name, or every translated label would be silently replaced. */
    getFieldOptions.mockResolvedValueOnce(
      optionsResponse(
        [
          { value: '', label_key: 'field_options.slip_provider.default', is_default: true },
          { value: 'swiftcheck', label_key: 'field_options.slip_provider.swiftcheck', fallback_label: 'swiftcheck' },
          { value: 'slipguard', label_key: 'field_options.slip_provider.slipguard', fallback_label: 'slipguard' },
        ],
        2,
      ),
    );
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: { ...baseHook }, mode: 'update' });

    await openSlipTab(container);
    const select = await waitFor(() => {
      const el = container.querySelector('select[name="slip_provider"]') as HTMLSelectElement | null;
      if (!el) throw new Error('the select never rendered');
      return el;
    });
    const labelOf = (value: string) =>
      Array.from(select.options).find((o) => o.value === value)?.textContent;

    // the untranslated one falls back to the server's plain name …
    expect(labelOf('slipguard')).toBe('slipguard');
    expect(labelOf('slipguard')).not.toContain('field_options.');
    // … while the translated one keeps the wording this side owns
    expect(labelOf('swiftcheck')).toBe('Swiftcheck');
    // and the default, which ships with this build, is translated as always
    expect(labelOf('')).not.toContain('field_options.');
  });

  it('⭐ renders NOTHING when the server offers fewer than two real choices', async () => {
    /* `choice_count` excludes the default, so 1 means "the only thing you can pick
       is what you already have". A control whose every option is a no-op is noise
       on a money tab — and this side must not count the array itself, because that
       would require knowing which entry is the fallback. */
    getFieldOptions.mockResolvedValueOnce(
      optionsResponse(
        [
          { value: '', label_key: 'field_options.slip_provider.default', is_default: true },
          { value: 'swiftcheck', label_key: 'field_options.slip_provider.swiftcheck' },
        ],
        1,
      ),
    );
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({ onSubmit, initialData: { ...baseHook }, mode: 'update' });

    await openSlipTab(container);
    expect(container.querySelector('[name="slip_provider"]')).toBeNull();
  });

  it('⭐ a failed load hides the control and does NOT touch the stored value', async () => {
    /* The dangerous direction. If the request fails and this side rendered an empty
       or default-only control, an operator saving another tab would write that back
       and wipe the hook's provider — 200 OK, no error, choice gone. Failing toward
       "offer nothing, change nothing" is what makes the endpoint safe to depend on. */
    getFieldOptions.mockRejectedValueOnce(new Error('network'));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { container } = renderModal({
      onSubmit,
      initialData: { ...baseHook, slip_provider: 'slipguard' },
      mode: 'create',
    });

    await openSlipTab(container);
    expect(container.querySelector('[name="slip_provider"]')).toBeNull();

    const payload = await submit(container, onSubmit);
    expect(payload.slip_provider).toBe('slipguard');
  });
});
