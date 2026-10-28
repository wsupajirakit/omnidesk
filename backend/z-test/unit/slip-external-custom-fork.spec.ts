/**
 * [FEAT-20260827-BPCUSTOMSLIP] slip detail's `external_data` reads the CUSTOM
 * TOOL ONLY — the legacy ExternalApiService leg is GONE from this path.
 * ============================================================================
 * Owner rule (v2.md §2.6, 06/09): no fork, no else-branch. A hook with the
 * custom tool on reads the combined bag's `is_profile` block; a hook without
 * one gets `externalData = null`. The legacy client is never constructed into
 * this service any more (its only use here WAS this block — keeping the
 * injection would be debt, iron rule 7).
 *
 * Adapted from the dev_custom archive's spec of the same name, which proved a
 * FORK (custom : legacy). This version proves the REMOVAL. Ranked by what it
 * protects:
 *   1. ⭐ custom hook → custom tool called once; raw partner body comes out in
 *      the exact legacy shape (`block.data ?? block ?? null`) — the dashboard
 *      modal and every downstream reader keep working.
 *   2. 🔴 NO hook shape — none at all — may reach any legacy method. The
 *      custom-tool stub here has NO legacy methods, so a wrong turn is a loud
 *      TypeError, never a silent pass.
 *   3. no-tool hook → externalData is null (measured: 0 such hooks exist on
 *      real data — v2.md §3b-G2 — so nobody sees this today).
 *   4. the profile key comes from the `is_profile` flag, never a hardcoded name.
 * The Mongo chain is pinned (`findById().populate().populate().lean().exec()`)
 * so a harness drift fails for its own reason, not a fake one.
 * revert: restore the legacy block + the ExternalApiService injection (see the
 * service's comment), and take the archive spec back verbatim.
 */
import {
  bindActiveProvider,
  buildCustomerProviderRegistry,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { SlipVerificationService } from '@/modules/slip/slip-verification.service';

const HOOK_ID = 'a0d000000000000000000017';
const UID = 'Uabc';

/** The raw partner body — the one shape the existing page knows. */
const RAW_BODY = {
  success: true,
  status_code: 200,
  data: { customer: { customer_name: 'ก' }, contract: { code: 'CT1' } },
};

function build(opts: {
  hook: Record<string, unknown> | null;
  combined?: Record<string, unknown>;
  tool?: unknown;
}) {
  const calls = { custom: 0 };
  const slipRow = {
    _id: 'slip1',
    sender_line_user_id: UID,
    hook_id: HOOK_ID,
    toObject() {
      return { _id: 'slip1', sender_line_user_id: UID, hook_id: HOOK_ID };
    },
  };
  /* Chain must match the real read: findById().populate().populate().lean().exec() */
  const chain = {
    populate() {
      return chain;
    },
    lean() {
      return chain;
    },
    exec: () => Promise.resolve(slipRow),
  };
  const slipModel = { findById: () => chain };
  const hookModel = {
    findById: () => ({
      lean: () => ({ exec: () => Promise.resolve(opts.hook) }),
    }),
    find: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
  };
  /* The ONLY partner door this service owns now. It deliberately carries no
     legacy method names — a call to getValidToken/getCustomerProfile lands on
     undefined and explodes, which is the point. */
  const customTool = {
    getCombinedData: jest.fn(() => {
      calls.custom++;
      return Promise.resolve(opts.combined ?? {});
    }),
    getToolForHook: jest.fn(() => Promise.resolve(opts.tool ?? null)),
  };
  const service = new SlipVerificationService(
    slipModel as never,
    customTool as never, // ← position 2: CustomToolService (was ExternalApiService)
    {} as never,
    hookModel as never,
    {} as never,
  );
  return { service, calls, customTool };
}

const getExternal = async (svc: SlipVerificationService) => {
  const res = await svc.getById('slip1');
  return res.data['external_data'];
};

describe('[BPCUSTOMSLIP] no custom tool — null, and NO legacy call exists to make', () => {
  it.each([
    ['no custom fields at all', {}],
    ['switch off', { custom_tool_status: false, custom_tool_id: 'x' }],
    ['switch on but no tool id', { custom_tool_status: true }],
    ['hook not found', null],
  ])(
    '🔴 %s ⇒ external_data null · custom tool untouched',
    async (_label, hook) => {
      const { service, calls } = build({
        hook: hook,
      });
      const out = await getExternal(service);
      expect(calls.custom).toBe(0);
      expect(out).toBeNull();
    },
  );
});

describe('[BPCUSTOMSLIP] custom hook — the only partner door', () => {
  const HOOK_CUSTOM = {
    _id: HOOK_ID,
    custom_tool_status: true,
    custom_tool_id: 'tool1',
  };
  const TOOL = {
    endpoints: [
      { key: 'LOGIN', is_login: true },
      { key: 'CUSTOMER_PROFILE', is_profile: true },
    ],
  };

  it('⭐ calls the custom tool once and emits the raw partner body, legacy shape', async () => {
    const { service, calls } = build({
      hook: HOOK_CUSTOM,
      tool: TOOL,
      combined: { CUSTOMER_PROFILE: { success: true, data: RAW_BODY } },
    });
    const out = await getExternal(service);
    expect(calls.custom).toBe(1);
    expect(out).toStrictEqual(RAW_BODY);
  });

  it('⭐ 🔴 the profile key comes from the is_profile flag, never a hardcoded name', async () => {
    const { service } = build({
      hook: HOOK_CUSTOM,
      tool: { endpoints: [{ key: 'MEMBER_INFO', is_profile: true }] },
      combined: { MEMBER_INFO: { success: true, data: RAW_BODY } },
    });
    expect(await getExternal(service)).toStrictEqual(RAW_BODY);
  });

  it('block without a data wrap falls back to the block itself', async () => {
    /* NOTE: the block here must NOT carry a `data` key — a block that has one
       is unwrapped by contract (`block.data ?? block`), which is the previous
       case. The first draft of this case used RAW_BODY (which has `.data`)
       and failed against CORRECT code — fixture bug, recorded honestly. */
    const BARE = { plain: true, note: 'no data wrap' };
    const { service } = build({
      hook: HOOK_CUSTOM,
      tool: { endpoints: [{ key: 'P', is_profile: true }] },
      combined: { P: BARE },
    });
    expect(await getExternal(service)).toStrictEqual(BARE);
  });

  it('tool with no is_profile endpoint ⇒ null, never a throw (the page survives)', async () => {
    const { service } = build({
      hook: HOOK_CUSTOM,
      tool: { endpoints: [{ key: 'X' }] },
      combined: { X: { success: true, data: RAW_BODY } },
    });
    expect(await getExternal(service)).toBeNull();
  });
});

/* ── [FEAT-20261014-SCREENHIDE] D7 — device ids never reach the slip-detail screen ──────────
   The slip-detail modal prints `external_data` as raw JSON, and on the loan site that body
   carries `product.device_imei` / `device_serial` — the ids the loan provider's own rule
   keeps off every screen (`loan-v1/field-paths.ts`). A provider declares `screenHiddenPaths`;
   the detail answer carries `[redacted]` there. shop-api declares nothing ⇒ the same object. */
describe('[SCREENHIDE] D7 — device ids are hidden in the slip detail, per provider', () => {
  const LOAN_BODY = {
    success: true,
    data: {
      customer: { customer_name: 'ก', customer_tel: '0640000000' },
      contract: { contract_number: 'CT1' },
      product: {
        device_model: 'iPhone',
        device_imei: '356789012345678',
        device_serial: 'SN123',
      },
    },
  };
  const PROFILE_TOOL = {
    endpoints: [{ key: 'CUSTOMER_PROFILE', is_profile: true }],
  };
  const hook = { _id: HOOK_ID, custom_tool_status: true, custom_tool_id: 't1' };
  const detail = async () => {
    const { service } = build({
      hook,
      combined: { CUSTOMER_PROFILE: { success: true, data: LOAN_BODY } },
      tool: PROFILE_TOOL,
    });
    return (await service.getById('slip1')).data[
      'external_data'
    ] as typeof LOAN_BODY;
  };
  afterEach(() => resetActiveProvider());

  it('TARGET: loan_v1 — imei / serial are [redacted]; the customer + contract stay readable', async () => {
    bindActiveProvider(buildCustomerProviderRegistry().get('loan_v1')!);
    const ext = await detail();
    expect(ext.data.product.device_imei).toBe('[redacted]');
    expect(ext.data.product.device_serial).toBe('[redacted]');
    expect(ext.data.product.device_model).toBe('iPhone');
    expect(ext.data.customer.customer_name).toBe('ก');
    expect(ext.data.contract.contract_number).toBe('CT1');
  });

  it('🔴 PIN: unbound / shop-api — the detail carries the very same body', async () => {
    const ext = await detail();
    expect(ext).toBe(LOAN_BODY);
  });
});
