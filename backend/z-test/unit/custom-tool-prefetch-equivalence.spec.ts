/**
 * [FEAT-20260827-BPPREFETCHPOST] The measured no-op, pinned forever.
 * ============================================================================
 * G1 (v2.md §12.2) removed the `method === 'GET'` clause from getCombinedData's
 * prefetch filter. The claim that makes it safe is NOT "it should be fine" —
 * it is a MEASUREMENT taken twice on the real database (27/08 on the lane
 * clone, 06/09 on dev's local_db_10_aug_26 and again on v2_db_07_sep_26):
 * across every tool, every non-GET endpoint is purpose 'write' or 'auth', so
 * dropping the verb clause changes NOTHING for any existing tool — except
 * acme, whose 4 php read endpoints (POST + purpose 'data') it unlocks.
 *
 * This spec freezes that measurement as data: the fixtures below are derived
 * from the REAL tool configs (v2.md §12.0.1 + §12.8b — Shop-API v1, Shop-API-stg,
 * both Demo Shop-API v3 rows, walletpay, ddd, acme). If a future tool violates
 * the invariant, re-run the aggregate in v2.md §3b-G1 against the live DB and
 * extend the fixture — do not weaken the assertion.
 *
 * The behaviour-level twin is custom-tool-prefetch-purpose.spec.ts (drives the
 * real service). This file pins the DATA-level equivalence claim.
 * revert: delete this file (only if G1 itself is reverted).
 */

type Ep = {
  key: string;
  method?: string;
  purpose?: string;
  status?: boolean;
  is_login?: boolean;
  is_refresh?: boolean;
};

/** The filter BEFORE G1 — dev's original, verb clause included (custom-tool.service.ts pre-edit). */
const oldFilter = (eps: Ep[]): string[] =>
  eps
    .filter(
      (e) =>
        e.status !== false &&
        !e.is_login &&
        !e.is_refresh &&
        e.purpose !== 'auth' &&
        e.purpose !== 'write' &&
        String(e.method || 'GET').toUpperCase() === 'GET',
    )
    .map((e) => e.key);

/** The filter AFTER G1 — purpose-only (must mirror custom-tool.service.ts post-edit). */
const newFilter = (eps: Ep[]): string[] =>
  eps
    .filter(
      (e) =>
        e.status !== false &&
        !e.is_login &&
        !e.is_refresh &&
        e.purpose !== 'auth' &&
        e.purpose !== 'write',
    )
    .map((e) => e.key);

/* Fixtures derived from the REAL rows (v2.md §12.0.1, §12.8b, G1 aggregate 06/09). */
const REAL_TOOLS: Record<string, Ep[]> = {
  'Shop-API v1': [
    { key: 'CUSTOMER_PROFILE', method: 'GET', purpose: 'data', status: true },
    { key: 'SITE_RULES', method: 'GET', purpose: 'data', status: true },
    { key: 'CUSTOMER_LINK', method: 'POST', purpose: 'write', status: true },
    { key: 'PAY_TOPUP', method: 'POST', purpose: 'write', status: true },
  ],
  'Shop-API-stg': [
    { key: 'CUSTOMER_PROFILE', method: 'GET', purpose: 'data', status: true },
    { key: 'SITE_RULES', method: 'GET', purpose: 'data', status: true },
    { key: 'CUSTOMER_LINK', method: 'POST', purpose: 'write', status: true },
    { key: 'PAY_TOPUP', method: 'POST', purpose: 'write', status: true },
  ],
  'Demo Shop-API (v3) [status:false tool]': [
    {
      key: 'LOGIN',
      method: 'POST',
      purpose: 'auth',
      status: true,
      is_login: true,
    },
    {
      key: 'REFRESH',
      method: 'POST',
      purpose: 'auth',
      status: true,
      is_refresh: true,
    },
    { key: 'CUSTOMER_MATCH', method: 'POST', purpose: 'write', status: true },
    { key: 'CUSTOMER_UPDATE', method: 'PATCH', purpose: 'write', status: true },
    { key: 'CUSTOMER_EDIT', method: 'PATCH', purpose: 'write', status: true },
    { key: 'CUSTOMER_UNLINK', method: 'POST', purpose: 'write', status: true },
    { key: 'CUSTOMER_LOOKUP', method: 'GET', purpose: 'data', status: true },
  ],
  'Demo Shop-API (v3)ๅๅๅ': [
    {
      key: 'LOGIN',
      method: 'POST',
      purpose: 'auth',
      status: true,
      is_login: true,
    },
    {
      key: 'REFRESH',
      method: 'POST',
      purpose: 'auth',
      status: true,
      is_refresh: true,
    },
    { key: 'CUSTOMER_MATCH', method: 'POST', purpose: 'write', status: true },
    { key: 'CUSTOMER_UPDATE', method: 'PATCH', purpose: 'write', status: true },
    { key: 'CUSTOMER_LOOKUP', method: 'GET', purpose: 'data', status: true },
  ],
  'walletpay (payin slip)': [
    { key: 'PAY_WALLETPAY', method: 'POST', purpose: 'write', status: true },
  ],
  ddd: [],
};

/* acme — the ONE tool the change exists for (v2.md §12.0.1, live-proven). */
const ACME: Ep[] = [
  {
    key: 'LOGIN',
    method: 'POST',
    purpose: 'auth',
    status: true,
    is_login: true,
  },
  { key: 'CUSTOMER_PROFILE', method: 'GET', purpose: 'data', status: true },
  { key: 'INSTALLMENT_CURRENT', method: 'POST', purpose: 'data', status: true },
  { key: 'PAYMENT_HISTORY', method: 'POST', purpose: 'data', status: true },
  { key: 'CONTRACT_INFO', method: 'POST', purpose: 'data', status: true },
  { key: 'ALL_INSTALLMENTS', method: 'POST', purpose: 'data', status: true },
];

describe('[BPPREFETCHPOST] filter equivalence — shop-api untouched, acme unlocked', () => {
  it.each(Object.entries(REAL_TOOLS))(
    'existing tool "%s": old filter === new filter (the measured no-op)',
    (_name, eps) => {
      expect(newFilter(eps)).toEqual(oldFilter(eps));
    },
  );

  it('acme is the ONLY divergence, and the delta is exactly its 4 php reads', () => {
    expect(oldFilter(ACME)).toEqual(['CUSTOMER_PROFILE']);
    expect(newFilter(ACME)).toEqual([
      'CUSTOMER_PROFILE',
      'INSTALLMENT_CURRENT',
      'PAYMENT_HISTORY',
      'CONTRACT_INFO',
      'ALL_INSTALLMENTS',
    ]);
  });

  it('login/refresh/auth/write can never leak into the prefetch set, any verb', () => {
    const hostile: Ep[] = [
      { key: 'W_GET', method: 'GET', purpose: 'write', status: true },
      { key: 'A_GET', method: 'GET', purpose: 'auth', status: true },
      {
        key: 'L_GET',
        method: 'GET',
        purpose: 'data',
        status: true,
        is_login: true,
      },
      {
        key: 'R_POST',
        method: 'POST',
        purpose: 'data',
        status: true,
        is_refresh: true,
      },
      { key: 'OFF', method: 'GET', purpose: 'data', status: false },
    ];
    expect(newFilter(hostile)).toEqual([]);
    expect(oldFilter(hostile)).toEqual([]);
  });
});
