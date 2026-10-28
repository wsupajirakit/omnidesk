/**
 * =============================================================================
 * [FEAT-20260903-TOPUPPERPROVIDER] binding a `pay_topup` line to one provider
 * =============================================================================
 *
 * `shop-api/v1/customer/validate-slip` was written for Swiftcheck's envelope, so a
 * second vendor may need its own path on the customer's Shop-API. This side lets an
 * operator say which provider a `pay_topup` line serves; saying nothing means it
 * serves everybody, which is what every line holds today.
 *
 * 🔴 THE TWO SHOW CONDITIONS ARE BOTH DELIBERATE and both are asserted:
 *   · only on `role: 'pay_topup'` — walletpay is NOT split per provider (owner's
 *     decision, 03/09), so offering the control there would invite a setting the
 *     back end ignores
 *   · only when the SERVER reports two or more real choices — with one provider
 *     registered there is nothing to bind to, and a control whose every value is
 *     a no-op is noise on a money form
 *
 * ⚠️ THE LIST COMES FROM THE SERVER. There is no vendor name in this file except
 * inside a mocked RESPONSE, and none anywhere in the page.
 *
 * revert: delete with `services/hook/useFieldOptions.ts` and the select it feeds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getFieldOptions = vi.fn();
vi.mock('../services/hook/fieldOptionsService', () => ({
  fieldOptionsService: { get: (k: string) => getFieldOptions(k) },
}));

/* [FIX-20261014-SLIPPROVROUNDTRIP] the two network seams the service touches */
const apiResponse: { value: unknown } = { value: {} };
const lastInit: { value: RequestInit | undefined } = { value: undefined };
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: '',
  authFetch: (_url: string, init?: RequestInit) => {
    lastInit.value = init;
    return Promise.resolve({ ok: true, status: 200 } as Response);
  },
  handleApiResponse: () => Promise.resolve(apiResponse.value),
}));
import { customToolService } from '../services/hook/customToolService';
import { useFieldOptions } from '../services/hook/useFieldOptions';
import { fieldOptionLabel } from '../components/hook/form/fieldOptionLabel';

const TWO_CHOICES = {
  key: 'slip_provider',
  options: [
    { value: '', label_key: 'field_options.slip_provider.default', is_default: true },
    { value: 'swiftcheck', label_key: 'field_options.slip_provider.swiftcheck', fallback_label: 'swiftcheck' },
    { value: 'slipguard', label_key: 'field_options.slip_provider.slipguard', fallback_label: 'slipguard' },
  ],
  choice_count: 2,
};

const ONE_CHOICE = {
  key: 'slip_provider',
  options: TWO_CHOICES.options.slice(0, 2),
  choice_count: 1,
};

beforeEach(() => {
  getFieldOptions.mockReset();
  getFieldOptions.mockResolvedValue(ONE_CHOICE);
});

describe('[TOPUPPERPROVIDER] the control only exists when there is a choice to make', () => {
  it('⭐ reports choiceCount 1 today, so the page renders no binding control', async () => {
    /* The fleet's actual state: one provider registered. Every value an operator
       could pick would mean "serves everybody", so the column stays off the row. */
    const { result } = renderHook(() => useFieldOptions('slip_provider'));

    await waitFor(() => expect(result.current.choiceCount).toBe(1));
    expect(result.current.choiceCount >= 2).toBe(false);
  });

  it('⭐ the day the server registers a second provider, the condition flips', async () => {
    /* No release on this side — which is the property the options endpoint was
       built for, and the reason this page holds no vendor list. */
    getFieldOptions.mockResolvedValueOnce(TWO_CHOICES);
    const { result } = renderHook(() => useFieldOptions('slip_provider'));

    await waitFor(() => expect(result.current.choiceCount).toBe(2));
    expect(result.current.options.map((o) => o.value)).toEqual([
      '',
      'swiftcheck',
      'slipguard',
    ]);
  });

  it('⭐ a failed load CLEARS what was there — it does not keep a stale list', async () => {
    /* 🔴 REWRITTEN AFTER A MUTATION SURVIVED. The first version rejected the
       FIRST request and asserted the state was empty — which it already is
       before any request, so deleting the whole catch body left it green. The
       case only means something when a load SUCCEEDED first: a stale list is
       what would let an operator bind a line to a provider the server has since
       stopped offering, and that is the failure this endpoint exists to remove.

       Driven through a key change, because that is how a second fetch actually
       happens here. */
    getFieldOptions
      .mockResolvedValueOnce(TWO_CHOICES)
      .mockRejectedValueOnce(new Error('network'));

    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useFieldOptions(key),
      { initialProps: { key: 'slip_provider' } },
    );

    await waitFor(() => expect(result.current.choiceCount).toBe(2));

    rerender({ key: 'something_else' });

    await waitFor(() => expect(result.current.options).toEqual([]));
    expect(result.current.choiceCount).toBe(0);
  });

  it('does not fetch at all when disabled', async () => {
    renderHook(() => useFieldOptions('slip_provider', false));

    expect(getFieldOptions).not.toHaveBeenCalled();
  });

  it('⭐ never counts the array itself — the count is the SERVER’s', async () => {
    /* Counting here would mean this side has to know which entry is the
       fallback, which is the one thing the endpoint keeps on the other side.
       Three options, two real choices. */
    getFieldOptions.mockResolvedValueOnce(TWO_CHOICES);
    const { result } = renderHook(() => useFieldOptions('slip_provider'));

    await waitFor(() => expect(result.current.options).toHaveLength(3));
    expect(result.current.choiceCount).toBe(2);
  });
});

describe('[TOPUPPERPROVIDER] the label still comes from this side when it can', () => {
  it('uses a shipped translation, and the server’s plain name when there is none', () => {
    /* Same rule as the hook form: a translation always wins, the fallback covers
       a vendor this build has never heard of, and a raw key is never shown. */
    const t = (k: string) =>
      k === 'field_options.slip_provider.swiftcheck' ? 'Swiftcheck' : k;

    expect(fieldOptionLabel(TWO_CHOICES.options[1]!, t)).toBe('Swiftcheck');
    expect(fieldOptionLabel(TWO_CHOICES.options[2]!, t)).toBe('slipguard');
  });
});

/* ── [FIX-20261014-SLIPPROVROUNDTRIP] the value must survive the way BACK ──────────────
   `normalizeEndpoint` builds a new object field by field and never listed `slip_provider`,
   so a saved binding read back as '' — the select showed "every provider" and the next save
   of ANY field on that tool posted '' over the real value (BE `custom-tool-normalize.ts`
   accepts the field, so it really was erased). Latent today: 0 endpoints hold a value on any
   local DB (14/10), and the control only shows once two providers are registered — which is
   exactly when someone will set it. Both legs walked: GET → normalize → the page's own
   `{ ...e }` edit copy → PUT body. */
describe('[SLIPPROVROUNDTRIP] slip_provider survives GET → form → PUT', () => {
  const RAW = {
    _id: 'tool-1',
    name: 'pay tool',
    category: 'payment',
    endpoints: [
      { key: 'TOPUP', role: 'pay_topup', method: 'POST', path: 'x', slip_provider: 'slipguard' },
      { key: 'PROFILE', method: 'GET', path: 'y' },
    ],
  };

  it('⭐ the read leg keeps the stored provider', async () => {
    apiResponse.value = { data: RAW };
    const tool = await customToolService.getCustomTool('tool-1');
    expect(tool.endpoints[0]?.slip_provider).toBe('slipguard');
  });

  it('⭐ the write leg posts it back unchanged after an unrelated edit', async () => {
    apiResponse.value = { data: RAW };
    const tool = await customToolService.getCustomTool('tool-1');
    /* the page's edit copy (CustomTools.tsx: `endpoints: t.endpoints.map((e) => ({ ...e }))`)
       and an edit to a DIFFERENT field */
    const form = { ...tool, name: 'renamed', endpoints: tool.endpoints.map((e) => ({ ...e })) };
    await customToolService.updateCustomTool('tool-1', form);
    const body = JSON.parse(String(lastInit.value?.body));
    expect(body.endpoints[0].slip_provider).toBe('slipguard');
  });

  it('🔴 PIN: a line with no binding still means "every provider" on screen AND to the BE', async () => {
    /* `?? ''` on purpose: before the fix the value was undefined (the select showed it as '',
       the PUT omitted it, the BE normalised the absence to ''); after, it is ''. Same meaning,
       same stored row — what every existing endpoint holds. */
    apiResponse.value = { data: RAW };
    const tool = await customToolService.getCustomTool('tool-1');
    expect(tool.endpoints[1]?.slip_provider ?? '').toBe('');
    await customToolService.updateCustomTool('tool-1', { ...tool, endpoints: tool.endpoints.map((e) => ({ ...e })) });
    const body = JSON.parse(String(lastInit.value?.body));
    expect(body.endpoints[1].slip_provider ?? '').toBe('');
  });
});
