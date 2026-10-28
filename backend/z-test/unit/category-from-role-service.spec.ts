import { CustomToolsService } from '@/modules/hooks';

/**
 * ==== [FIX-20260810-CATFROMROLE] the ONE-SAVE guarantee, at the service layer ====
 *
 * `category-from-role.spec.ts` pins the pure derivation. This file pins the thing
 * the owner actually asked for: adding a `pay_topup` line to an existing Shop-API tool
 * and pressing save ONCE must produce a payment tool — endpoints, category and the
 * payment block all settled in that single write.
 *
 * That guarantee lives in the ORDER of the update path: the category is derived from
 * the INCOMING endpoints, before `doc.endpoints` is written and before the `payment`
 * block (which reads `doc.category`) runs. Deriving from the stored endpoints instead
 * compiles, passes the unit tests, and silently reintroduces the two-save flow — so
 * it needs a test of its own.
 */

/** A doc shaped like the tool the owner already runs: profile + link + site rules. */
function existingShopapiTool() {
  return {
    _id: 'a0d000000000000000000014',
    name: 'Shop-API v1',
    category: 'generic',
    auth_type: 'hmac',
    status: true,
    endpoints: [
      {
        key: 'PROFILE',
        method: 'GET',
        path: '/p',
        role: 'profile',
        status: true,
      },
      { key: 'LINK', method: 'POST', path: '/l', role: 'link', status: true },
      {
        key: 'SITE_RULES',
        method: 'GET',
        path: '/s',
        role: 'other',
        status: true,
      },
    ],
    payment: undefined as unknown,
    save: jest.fn().mockResolvedValue(undefined),
    // `update` returns `toPublic(doc.toObject())`; a plain snapshot is enough
    // since these tests assert on the mutated doc, not the response body.
    toObject(): Record<string, unknown> {
      return { ...this };
    },
  };
}

function buildService(doc: ReturnType<typeof existingShopapiTool>) {
  const customToolModel = {
    findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(doc) })),
    findById: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(doc) })),
  };
  const service = new CustomToolsService(
    customToolModel as never,
    {} as never, // hookModel
    { encrypt: (v: string) => v, decrypt: (v: string) => v } as never, // crypto
    { log: jest.fn(), record: jest.fn(), write: jest.fn() } as never, // audit
    { invalidateHookCache: async () => {} } as never, // [FIX-20260812-ASSIGNCACHE] hookCache
  );
  return { service, customToolModel };
}

/** The endpoints the operator sees after clicking "+ เส้นเติมเงิน (topup)". */
function withTopupLine(doc: ReturnType<typeof existingShopapiTool>) {
  return [
    ...doc.endpoints,
    {
      key: 'PAY_TOPUP',
      method: 'POST',
      path: '/validate-slip',
      role: 'pay_topup',
      status: true,
    },
  ];
}

describe('[FIX-20260810-CATFROMROLE] one save turns an Shop-API tool into a payment tool', () => {
  it('derives the category from the INCOMING endpoints, not the stored ones', async () => {
    // The regression this exists to catch: deriving from `doc.endpoints` leaves the
    // tool generic on this save, so the operator must press save a second time
    // before the topup line does anything — exactly the flow the fix removes.
    const doc = existingShopapiTool();
    const { service } = buildService(doc);

    await service.update(
      String(doc._id),
      { endpoints: withTopupLine(doc) },
      { _id: 'u1', role: 'superadmin' } as never,
      {}, // audit request meta
    );

    expect(doc.category).toBe('payment');
  });

  it('the generic endpoints survive that save untouched', async () => {
    // "profile site + payment + topup + walletpay ต้องทำงานเหมือนเดิม"
    const doc = existingShopapiTool();
    const { service } = buildService(doc);

    await service.update(
      String(doc._id),
      { endpoints: withTopupLine(doc) },
      { _id: 'u1', role: 'superadmin' } as never,
      {}, // audit request meta
    );

    expect(doc.endpoints.map((e) => e.role)).toEqual([
      'profile',
      'link',
      'other',
      'pay_topup',
    ]);
  });

  it('the payment block is attached in the SAME save', async () => {
    // The block is written only when `doc.category === 'payment'`, so it proves the
    // category was already derived by the time that check ran.
    const doc = existingShopapiTool();
    const { service } = buildService(doc);

    await service.update(
      String(doc._id),
      { endpoints: withTopupLine(doc) },
      { _id: 'u1', role: 'superadmin' } as never,
      {}, // audit request meta
    );

    expect(doc.payment).toBeTruthy();
  });

  it('a body.category that contradicts the roles is ignored', async () => {
    // The roles are the single source of truth — a caller hitting the API directly
    // cannot mark a tool payment without giving it a payment leg.
    const doc = existingShopapiTool();
    const { service } = buildService(doc);

    await service.update(
      String(doc._id),
      { category: 'payment' },
      { _id: 'u1', role: 'superadmin' } as never,
      {}, // audit request meta
    );

    expect(doc.category).toBe('generic');
  });

  it('removing the last payment leg drops the tool back to generic', async () => {
    const doc = existingShopapiTool();
    doc.category = 'payment';
    doc.endpoints = withTopupLine(doc);
    const { service } = buildService(doc);

    await service.update(
      String(doc._id),
      {
        endpoints: [
          {
            key: 'PROFILE',
            method: 'GET',
            path: '/p',
            role: 'profile',
            status: true,
          },
        ],
      },
      { _id: 'u1', role: 'superadmin' } as never,
      {}, // audit request meta
    );

    expect(doc.category).toBe('generic');
  });
});
