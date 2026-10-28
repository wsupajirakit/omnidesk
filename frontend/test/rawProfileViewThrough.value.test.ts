import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * [FIX-20260906-VIEWTHROUGH] `view` must survive the trip from the wire to the panel.
 * ===========================================================================
 * THE BUG THIS PINS, and it emptied the entire right-hand panel on a real customer.
 *
 * `GET /api/line-users/:id/raw-profile` answers
 *     { success, data, profile_data_updated_at, view, customer_provider }
 * and `ProfilePanel` draws almost everything through
 *     const pv = readPanelValues(rawProfile?.view)
 *
 * `ticketService.getRawProfile` returned `{ ...json.data, _profile_data_updated_at }`
 * — `view` was read off the wire and dropped one line before the component asked
 * for it. `pv` was therefore empty, every `pv.value(...)` answered `undefined`, and
 * a customer holding 11,664.92 credit with 12,000 in deposits and eight recent
 * products saw `-` in every field. Nothing errored; the panel simply had nothing.
 *
 * ⚠️ WHY THIS TEST IS AT THE SERVICE AND NOT IN A DOM TEST. The panel's own DOM
 * tests build their fixture by hand and hand a `view` straight to the component,
 * so they passed throughout — they never exercised the fetch layer where the key
 * was lost. The seam that broke is the one nothing covered.
 * เทสหน้าจอส่ง view เองเลยไม่มีวันจับได้ ต้องเทสที่ชั้นดึงข้อมูล
 *
 * BOTH entry points are covered: the read (`getRawProfile`) and the refresh
 * (`refreshRawProfile`). Fixing only one leaves the panel correct until somebody
 * presses refresh — an intermittent version of the same blank screen.
 */

/* Only the transport is replaced. `ticketService` itself — the code under test —
   is imported for real; a mock of the service would prove nothing. */
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'http://localhost',
  authFetch: (...args: unknown[]) =>
    (globalThis as unknown as { __fetch: (...a: unknown[]) => unknown }).__fetch(
      ...args,
    ),
  handleApiResponse: (r: unknown) => r,
}));

/** The shape the BE really answers — trimmed to the keys under test. */
const wireAnswer = {
  success: true,
  data: { data: { profile: { phone: '0925550014' } } },
  profile_data_updated_at: '2026-09-06T10:42:30.000Z',
  customer_provider: 'shopapi_v1',
  view: {
    sections: [
      {
        id: 'finance.deposits',
        type: 'amount_rows',
        rows: [
          { key: 'finCredit', label: 'เครดิตคงเหลือ', value: 11664.92 },
          { key: 'finWallet', label: 'เงินค้างในกระเป๋า', value: 0 },
          { key: 'finDepTotal', label: 'ยอดฝากรวม', value: 12000 },
        ],
        amountRows: [{ at: 1, amount: 2000, sign: '+' }],
      },
    ],
  },
};

const okResponse = (body: unknown) => ({
  ok: true,
  json: () => Promise.resolve(body),
});

describe('[FIX-20260906-VIEWTHROUGH] the provider view reaches the panel', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__fetch;
  });

  it('⭐ getRawProfile keeps `view` — the panel draws everything from it', async () => {
    (globalThis as unknown as Record<string, unknown>).__fetch = () =>
      Promise.resolve(okResponse(wireAnswer));
    const { ticketService } = await import('../services/chat/ticketService');
    const out = await ticketService.getRawProfile('m1');

    expect(out?.view).toBeTruthy();
    const rows = out.view.sections[0].rows as { key: string; value: unknown }[];
    // the three the finance card reads BY KEY — the values a real customer had
    expect(rows.find((r) => r.key === 'finCredit')?.value).toBe(11664.92);
    expect(rows.find((r) => r.key === 'finDepTotal')?.value).toBe(12000);
  });

  it('⭐ refreshRawProfile keeps it too — otherwise the panel blanks on refresh', async () => {
    (globalThis as unknown as Record<string, unknown>).__fetch = () =>
      Promise.resolve(okResponse(wireAnswer));
    const { ticketService } = await import('../services/chat/ticketService');
    const out = await ticketService.refreshRawProfile('m1', 'h1');
    expect(out?.view?.sections?.[0]?.id).toBe('finance.deposits');
  });

  it('the raw blob and the timestamp are still carried, unchanged', async () => {
    /* The vacuity guard: a "fix" that returned only `view` would pass the cases
       above while breaking every inline read the panel still does off the blob. */
    (globalThis as unknown as Record<string, unknown>).__fetch = () =>
      Promise.resolve(okResponse(wireAnswer));
    const { ticketService } = await import('../services/chat/ticketService');
    const out = await ticketService.getRawProfile('m1');
    expect(out.data.profile.phone).toBe('0925550014');
    expect(out._profile_data_updated_at).toBe('2026-09-06T10:42:30.000Z');
  });

  it('an unlinked customer still answers null, exactly as before', async () => {
    /* `data: null` has its own documented rule — spreading it would yield `{}`,
       which is truthy, and the card would claim the customer has a profile. */
    (globalThis as unknown as Record<string, unknown>).__fetch = () =>
      Promise.resolve(okResponse({ success: true, data: null }));
    const { ticketService } = await import('../services/chat/ticketService');
    expect(await ticketService.getRawProfile('m1')).toBeNull();
  });

  it('an answer with no `view` degrades to null rather than undefined', async () => {
    /* A provider that emits nothing, or an older BE, must leave the panel empty —
       not crash it. `readPanelValues` treats both the same, and this pins that the
       key is present so a reader never has to guess which it got. */
    (globalThis as unknown as Record<string, unknown>).__fetch = () =>
      Promise.resolve(
        okResponse({ success: true, data: { data: { profile: {} } } }),
      );
    const { ticketService } = await import('../services/chat/ticketService');
    const out = await ticketService.getRawProfile('m1');
    expect(out.view).toBeNull();
  });
});
