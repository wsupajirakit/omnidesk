/**
 * [FEAT-20260808-PAYTOOL-P1] Before/after guard for the payment-tool Phase 1
 * foundation: the additive custom-tool `category` (3-file wiring) and the
 * SEPARATE hook `payment_tool_*` binding pair.
 *
 * Proves three things with FAKES ONLY (no DB, no network, no real keys):
 *  (a) an existing/generic tool round-trips byte-identical — `category` defaults
 *      to 'generic', unknown roles still coerce to '', existing validate rules
 *      fire with their exact Thai messages;
 *  (b) a `category:'payment'` tool + `pay_topup`/`pay_walletpay` roles SURVIVE
 *      normalize + validate (proves the schema+normalize+validate wiring, i.e.
 *      the field is not silently dropped on save);
 *  (c) a hook gets the two new fields defaulting OFF, they are a SEPARATE
 *      typed pair, and they do not touch the existing `custom_tool_*` path.
 *
 * revert: delete this file together with the [FEAT-20260808-PAYTOOL-P1] edits.
 */
import mongoose from 'mongoose';

import {
  CustomToolSchema,
  HookSchema,
  TOOL_CATEGORIES,
  assertCustomToolConfig,
  normalizeCategory,
  normalizeEndpoints,
} from '@/modules/hooks';

// Throwaway models — constructing a document applies schema defaults WITHOUT a
// live connection, so nothing leaves the process.
const CustomToolModel = mongoose.model(
  'PayToolP1_CustomTool',
  CustomToolSchema,
);
const HookModel = mongoose.model('PayToolP1_Hook', HookSchema);

describe('[PAYTOOL-P1] custom-tool category — additive 3-file wiring', () => {
  it('(a) a new/generic tool materialises category:"generic" (byte-identical default)', () => {
    const doc = new CustomToolModel({
      name: 'legacy-tool',
      base_url: 'https://example.test',
    });
    // A defaulted field materialises the same value legacy would ⇒ no migration.
    expect(doc.get('category')).toBe('generic');
  });

  it('(a) normalizeCategory coerces absent/unknown to "generic"', () => {
    expect(normalizeCategory(undefined)).toBe('generic');
    expect(normalizeCategory('')).toBe('generic');
    expect(normalizeCategory('nonsense')).toBe('generic');
    expect(normalizeCategory('payment')).toBe('payment');
    expect(normalizeCategory('generic')).toBe('generic');
  });

  it('(a) an unknown endpoint role still coerces to "" (existing behaviour intact)', () => {
    const eps = normalizeEndpoints([
      { key: 'X', path: '/x', role: 'totally_made_up' },
    ]);
    expect(eps[0]?.role).toBe('');
  });

  it('(a) existing validate rules keep firing with their exact messages', () => {
    // duplicate key
    expect(() =>
      assertCustomToolConfig('none', [
        base({ key: 'DUP' }),
        base({ key: 'DUP' }),
      ]),
    ).toThrow('endpoint key ซ้ำ: DUP (ห้ามซ้ำภายใน tool เดียวกัน)');
    // two logins
    expect(() =>
      assertCustomToolConfig('none', [
        base({ key: 'A', is_login: true }),
        base({ key: 'B', is_login: true }),
      ]),
    ).toThrow('มีเส้น login มากกว่า 1 (A, B)');
    // a plain generic config passes (category omitted ⇒ no new failure)
    expect(() =>
      assertCustomToolConfig('none', [base({ key: 'OK' })]),
    ).not.toThrow();
  });

  it('(b) a payment tool: category + pay_topup/pay_walletpay survive normalize', () => {
    const eps = normalizeEndpoints([
      { key: 'TOPUP', method: 'POST', path: '/topup', role: 'pay_topup' },
      {
        key: 'WALLETPAY',
        method: 'POST',
        path: '/walletpay',
        role: 'pay_walletpay',
        request_type: 'form-data',
      },
    ]);
    expect(eps.map((e) => e.role)).toEqual(['pay_topup', 'pay_walletpay']);
    // request_type:'form-data' already supported by the endpoint schema.
    expect(eps[1]?.request_type).toBe('form-data');
    expect(normalizeCategory('payment')).toBe('payment');
  });

  it('(b) validate accepts category:"payment" and the pay_* roles (no branch on names)', () => {
    expect(() =>
      assertCustomToolConfig(
        'hmac_signature',
        [
          base({ key: 'TOPUP', role: 'pay_topup', require_jwt: false }),
          base({ key: 'WALLETPAY', role: 'pay_walletpay', require_jwt: false }),
        ],
        'payment',
      ),
    ).not.toThrow();
  });

  it('(b) validate rejects an unrecognised category value', () => {
    expect(() =>
      assertCustomToolConfig('none', [base({ key: 'A' })], 'bogus'),
    ).toThrow(
      `category ไม่ถูกต้อง: bogus (ต้องเป็น ${TOOL_CATEGORIES.join(' | ')})`,
    );
  });

  it('(b) a payment tool doc stores category:"payment"', () => {
    const doc = new CustomToolModel({
      name: 'pay-tool',
      base_url: 'https://pay.test',
      category: 'payment',
    });
    expect(doc.get('category')).toBe('payment');
  });
});

describe('[PAYTOOL-P1] hook payment_tool_* — SEPARATE binding pair, off by default', () => {
  it('(c) defaults off: payment_tool_status=false, payment_tool_id=null', () => {
    const hook = new HookModel({});
    expect(hook.get('payment_tool_status')).toBe(false);
    expect(hook.get('payment_tool_id') ?? null).toBeNull();
  });

  it('(c) payment_tool_id is a real ObjectId path (NOT Mixed) — find() would match', () => {
    // The custom_tool_id lesson: a value-class @Prop degrades to Mixed and
    // find({id}) matches nothing. Whatever mongoose labels an ObjectId path,
    // the two bindings must share it (and it must NOT be 'Mixed').
    const objectIdInstance = HookSchema.path('custom_tool_id').instance;
    expect(objectIdInstance).not.toBe('Mixed');
    expect(HookSchema.path('payment_tool_id').instance).toBe(objectIdInstance);
  });

  it('(c) the two bindings are SEPARATE fields (payment never reuses custom_tool_id)', () => {
    expect(HookSchema.path('payment_tool_id')).toBeDefined();
    expect(HookSchema.path('custom_tool_id')).toBeDefined();
    expect(HookSchema.path('payment_tool_status')).toBeDefined();
    expect(HookSchema.path('custom_tool_status')).toBeDefined();
  });

  it('(c) setting the payment pair does not touch the custom_tool_* pair', () => {
    const id = new mongoose.Types.ObjectId();
    const hook = new HookModel({
      payment_tool_id: id,
      payment_tool_status: true,
    });
    expect(String(hook.get('payment_tool_id'))).toBe(String(id));
    expect(hook.get('payment_tool_status')).toBe(true);
    // The generic-tool binding stays at its untouched defaults.
    expect(hook.get('custom_tool_status')).toBe(false);
    expect(hook.get('custom_tool_id') ?? null).toBeNull();
  });
});

/** Minimal endpoint shape for the validator. */
function base(
  over: Partial<{
    key: string;
    is_login: boolean;
    is_refresh: boolean;
    is_profile: boolean;
    require_jwt: boolean;
    status: boolean;
    role: string;
    cache_ttl_sec: number | null;
  }>,
) {
  return {
    key: 'K',
    is_login: false,
    is_refresh: false,
    is_profile: false,
    require_jwt: false,
    status: true,
    role: '',
    cache_ttl_sec: null,
    ...over,
  };
}
