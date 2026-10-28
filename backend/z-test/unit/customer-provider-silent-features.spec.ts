/**
 * [FEAT-20261014-PROVFEATURES] A provider can silence whole bot worlds — in code, one boolean each.
 * ============================================================================
 * Owner 14/10/2026: "สินเชื่อ abandon/ลงทะเบียน ต้องเงียบ · อะไรก็ตามที่เงียบ มี flag เปิด ปิด
 * สลับได้ในระดับ code". The loan site's notice / follow-up / register / payment worlds are
 * declared off in `providers/loan-v1/index.ts`; shop-api declares nothing and must not move.
 *
 * Two suites, kept apart on purpose (line-flow-test §4):
 *   TARGET — with loan_v1 bound, each world's ONE choke point says nothing.
 *   PIN    — unbound, or shop-api bound, every choke point answers exactly as before.
 * Each choke point is driven through the SHIPPED function, never a copy of its rule.
 */
import {
  ABANDON_TRIGGER_SOURCE_KEYS,
  shouldStampAbandon,
} from '@/modules/content';
import {
  CustomerProviderService,
  DEFAULT_CUSTOMER_PROVIDER,
  PROVIDER_FEATURES,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  featuresOff,
  providerFeatureOn,
  resetActiveProvider,
  resolveProviderFeatures,
  slipCallbackContractSource,
} from '@/modules/customer-provider';
import { CustomerLinkService } from '@/modules/customer-link';
import { PaymentRunnerService } from '@/modules/payment';
import {
  CUSTOMER_REGISTER_KEYWORD,
  decideNoticeAll,
  helperQrBodyStep,
  isCustomerRegisterKeyword,
  runFollowUpGate,
  type NoticeContext,
} from '@/modules/webhook';

const shopapiV1Provider = DEFAULT_CUSTOMER_PROVIDER;
const loanV1Provider = buildCustomerProviderRegistry().get('loan_v1')!;

afterEach(() => resetActiveProvider());

/* ── the four choke points, each driven with an input that WOULD act today ── */

/** Case A's exact conditions (notice-runtime-cases.spec.ts) — fires on an unsilenced site. */
const NOTICE_A: NoticeContext = {
  eventKind: 'text',
  hookStatusOff: false,
  assisted: false,
  depositOn: true,
  withdrawOn: false,
  depositScope: 'text',
  depositWord: true,
  withdrawWord: false,
  qrFound: false,
  inWindow: true,
  depositSiteStatusFirst: false,
  withdrawSiteStatusFirst: false,
  depositOff: false,
  withdrawOff: false,
};

const AT = 'abandon_trigger_at';
const markedMember = {
  config: { follow_up: { line: { [AT]: new Date('2026-10-01T00:00:00Z') } } },
};
const followUpDeps = () => {
  const updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  });
  const find = jest.fn().mockReturnValue({
    sort: () => ({
      limit: () => ({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
      }),
    }),
  });
  return {
    deps: {
      chatMessageModel: { find } as never,
      memberModel: { updateOne } as never,
      warn: jest.fn(),
    },
    updateOne,
  };
};
const followUp = (hasProfile: boolean) => {
  const { deps, updateOne } = followUpDeps();
  return runFollowUpGate(
    {
      hasProfile,
      room: { _id: 'r1' },
      member: markedMember,
      channelUserId: 'Uabc',
    },
    deps,
  ).then((v) => ({ v, updateOne }));
};

const KEYWORD_EVENT = {
  type: 'message',
  message: { type: 'text', text: CUSTOMER_REGISTER_KEYWORD },
} as never;
const LINKING_HOOK = { customer_link_enabled: true } as never;

const PAY_TOOL = { _id: 'pt1', status: true, category: 'payment' };
const payRunner = () => {
  const r = Object.create(PaymentRunnerService.prototype) as Record<
    string,
    unknown
  >;
  const log = jest.fn();
  r['logger'] = { log, warn: jest.fn(), error: jest.fn() };
  r['customTool'] = { getTool: jest.fn().mockResolvedValue(PAY_TOOL) };
  return { runner: r as unknown as PaymentRunnerService, log };
};
const BOUND_HOOK = {
  alias: 'oa',
  payment_tool_status: true,
  payment_tool_id: 'pt1',
} as never;

const STAMPING_JOB = {
  usedKeys: [ABANDON_TRIGGER_SOURCE_KEYS[0]!],
  directTicket: false,
};

/* ═══════════════════════════════ declarations ═══════════════════════════════ */

describe('[PROVFEATURES] what each provider declares', () => {
  it('absent = on: an empty declaration resolves every world ON', () => {
    const set = resolveProviderFeatures(undefined);
    for (const f of PROVIDER_FEATURES)
      expect({ f, on: set[f] }).toEqual({ f, on: true });
  });

  it('only an explicit false silences — undefined is not false', () => {
    const set = resolveProviderFeatures({ notice: undefined, payment: false });
    expect(set.notice).toBe(true);
    expect(set.payment).toBe(false);
  });

  it('🔴 PIN: shopapi_v1 declares no feature at all, so every world is today’s', () => {
    expect(shopapiV1Provider.features).toBeUndefined();
    expect(
      featuresOff(resolveProviderFeatures(shopapiV1Provider.features)),
    ).toEqual([]);
  });

  /* FLIPPED 18/10/2026: a fifth world `siteRules` joined the list ([FEAT-20261018-SITERULESWORLD],
     owner: the loan partner has no site rules) — its choke points are pinned in
     `site-rules-provider-world.spec.ts`. The four earlier worlds are unchanged. */
  it('TARGET: loan_v1 silences all five worlds', () => {
    expect(
      featuresOff(resolveProviderFeatures(loanV1Provider.features)),
    ).toEqual(['notice', 'followUp', 'register', 'payment', 'siteRules']);
  });

  it('loan_v1: each world has ONE switch — the screen half follows the bot half', () => {
    const set = resolveProviderFeatures(loanV1Provider.features);
    expect(loanV1Provider.showFollowUps).toBe(set.followUp);
    expect(loanV1Provider.showRegisterAction).toBe(set.register);
    expect(loanV1Provider.showWalletpayCard).toBe(set.payment);
  });
});

describe('[PROVFEATURES] the service binds the resolved provider at boot', () => {
  const make = (name: string | undefined) =>
    new CustomerProviderService({ name });

  it('🔴 PIN: unset CUSTOMER_PROVIDER ⇒ every world on', () => {
    make(undefined);
    for (const f of PROVIDER_FEATURES)
      expect({ f, on: providerFeatureOn(f) }).toEqual({ f, on: true });
  });

  it('TARGET: CUSTOMER_PROVIDER=loan_v1 ⇒ the four worlds are silent process-wide', () => {
    make('loan_v1');
    for (const f of PROVIDER_FEATURES)
      expect({ f, on: providerFeatureOn(f) }).toEqual({ f, on: false });
  });

  it('[CALLBACKCONTRACT] the callback source is bound with the worlds: legacy unless declared', () => {
    make(undefined);
    expect(slipCallbackContractSource()).toBe('legacy');
    make('loan_v1');
    expect(slipCallbackContractSource()).toBe('profile_code');
    expect(shopapiV1Provider.slipCallbackContract).toBeUndefined();
  });

  it('🔴 PIN: an unknown value falls back to shop-api, worlds included', () => {
    make('loan_v1');
    make('lona_v1');
    expect(providerFeatureOn('notice')).toBe(true);
  });
});

/* ═══════════════════════════════ TARGET ═══════════════════════════════ */

describe('[PROVFEATURES] TARGET — loan_v1 bound: every world says nothing', () => {
  beforeEach(() => bindActiveProvider(loanV1Provider));

  it('notice: case A’s conditions decide no card (so no send and no stamp)', () => {
    expect(decideNoticeAll(NOTICE_A)).toEqual([]);
  });

  it('followUp: a marked, unregistered customer is NOT handed to register — quiet', async () => {
    const { v } = await followUp(false);
    expect(v).toEqual({
      memberNeedRegister: false,
      handOffToRegister: false,
      cleared: false,
    });
  });

  it('🔴 followUp: level 0 STILL clears the mark when the customer registers', async () => {
    const { v, updateOne } = await followUp(true);
    expect(v.cleared).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('register: the customer-register keyword is not recognised', () => {
    expect(isCustomerRegisterKeyword(KEYWORD_EVENT, LINKING_HOOK)).toBe(false);
  });

  it('payment: a bound, working payment tool is refused — same null as "not bound"', async () => {
    const { runner, log } = payRunner();
    expect(await runner.resolvePaymentTool(BOUND_HOOK)).toBeNull();
    expect(log.mock.calls.flat().join(' ')).toContain('payment: SILENCED');
  });

  it('followUp: a multicast does not arm anyone', () => {
    expect(shouldStampAbandon(STAMPING_JOB)).toBe(false);
  });
});

/* ═══════════════════════════════ PIN ═══════════════════════════════ */

describe.each([
  ['unbound (unit tests, CLIs)', () => resetActiveProvider()],
  [
    'shopapi_v1 bound (the shop-api site)',
    () => bindActiveProvider(shopapiV1Provider),
  ],
])(
  '[PROVFEATURES] 🔴 PIN — %s: every choke point answers as before',
  (_label, bind) => {
    beforeEach(() => bind());

    it('notice: case A still decides its card', () => {
      expect(decideNoticeAll(NOTICE_A).map((d) => d.caseId)).toEqual(['A']);
    });

    it('followUp: a marked customer is still handed to register', async () => {
      const { v } = await followUp(false);
      expect(v.handOffToRegister).toBe(true);
    });

    it('followUp: level 0 still clears', async () => {
      const { v } = await followUp(true);
      expect(v.cleared).toBe(true);
    });

    it('register: the keyword is still recognised', () => {
      expect(isCustomerRegisterKeyword(KEYWORD_EVENT, LINKING_HOOK)).toBe(true);
    });

    it('payment: the bound tool is still resolved', async () => {
      expect(await payRunner().runner.resolvePaymentTool(BOUND_HOOK)).toBe(
        PAY_TOOL,
      );
    });

    it('followUp: a multicast still arms', () => {
      expect(shouldStampAbandon(STAMPING_JOB)).toBe(true);
    });
  },
);

/* ═══ [FEAT-20261014-PROVFEATURES] the register world, its two remaining doors ═══════════
   1. The AI's customer-helper marker invites the customer to register (minted link,
      helper card / quick-reply "ลงทะเบียน"). On a site with no register world that invitation
      leads nowhere — the keyword answers nothing and the landing refuses — so the buttons are
      not offered; the helper TEXT still answers (an empty reply is the silence
      [FIX-20260801-HELPEREMPTY] exists to prevent).
   2. The customer-link HTTP routes (landing profile, match, admin token, admin edit) share
      one readiness gate; with no register world it refuses like a disabled OA. Admin UNLINK
      (clear data) is not behind that gate and stays. */
describe('[PROVFEATURES] register world — the helper invitation and the link routes', () => {
  const helperCtx = () =>
    ({
      tags: { wantsHelperQuickReply: true },
      replyViaPush: false,
      userId: 'U1',
      hook: { customer_helper_text: 'ผูกบัญชีได้ที่ลิงก์ครับ' },
      finalReplyForLine: '',
      useHelperQr: false,
      replyBodyForLine: '',
    }) as never as Parameters<typeof helperQrBodyStep.run>[0];
  const readyHook = {
    customer_link_enabled: true,
    custom_tool_status: true,
    custom_tool_id: 't1',
  };
  const linkSvc = Object.create(
    CustomerLinkService.prototype,
  ) as CustomerLinkService;

  it('TARGET: loan — the marker still answers with the helper text, but no register buttons', () => {
    bindActiveProvider(loanV1Provider);
    const c = helperCtx();
    void helperQrBodyStep.run(c, {} as never);
    expect(c.useHelperQr).toBe(false);
    expect(c.replyBodyForLine).toBe('ผูกบัญชีได้ที่ลิงก์ครับ');
  });

  it('🔴 PIN: shop-api / unbound — buttons offered and the helper text answers, as before', () => {
    const c = helperCtx();
    void helperQrBodyStep.run(c, {} as never);
    expect(c.useHelperQr).toBe(true);
    expect(c.replyBodyForLine).toBe('ผูกบัญชีได้ที่ลิงก์ครับ');
  });

  it('TARGET: loan — the link routes refuse even for a fully configured OA', () => {
    bindActiveProvider(loanV1Provider);
    expect(linkSvc.notReadyRejection(readyHook as never)?.error?.code).toBe(
      'CUSTOMER_LINK_DISABLED',
    );
  });

  it('🔴 PIN: shop-api / unbound — a configured OA passes, a disabled one is refused as before', () => {
    expect(linkSvc.notReadyRejection(readyHook as never)).toBeNull();
    expect(
      linkSvc.notReadyRejection({
        ...readyHook,
        customer_link_enabled: false,
      })?.error?.code,
    ).toBe('CUSTOMER_LINK_DISABLED');
  });
});
