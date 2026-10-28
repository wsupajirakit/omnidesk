/**
 * [FEAT-20261018-SITERULESWORLD] Site rules are a provider WORLD — a site that has none says nothing.
 * ============================================================================
 * Owner 18/10/2026: the loan site has no site rules ⇒ hide the option there, but keep it a
 * flag per provider so a future company that HAS site rules turns it on by declaring nothing ·
 * "ห้ามกระทบ x api".
 *
 * Dived before writing (18/10): legacy legacy-console / dashboard-for-z-main have NO site rules at
 * all (0 files) — the concept is shop-api's. On a loan OA with the switch on, today:
 *   · the data block is empty (the loan tool has no site-rules endpoint) — harmless;
 *   · the GUIDE block ("กฏการใช้ข้อมูล Site Rules") is STILL sent to the model — the leak;
 *   · the Refresh path warms a prefetch for nothing.
 *
 * TARGET (loan bound): the AI gets neither block · the panel route answers no data · Refresh
 *   does not call the partner · a site-rules endpoint is never prefetched.
 * PIN (unbound / shop-api bound): every one of those answers exactly as before.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';

import { mongoConfig, realtimeConfig } from '@/config/app.config';
import { AuditLogService } from '@/modules/audit';
import { ChatRoom, Member, MembersService } from '@/modules/chat';
import {
  CustomerProviderController,
  CustomerProviderService,
  DEFAULT_CUSTOMER_PROVIDER,
  bindActiveProvider,
  buildCustomerProviderRegistry,
  providerFeaturesOff,
  providerHiddenScreenSections,
  resetActiveProvider,
  siteRulesReachAi,
} from '@/modules/customer-provider';
import { CustomToolService } from '@/modules/external';
import { Hook } from '@/modules/hooks';

const shopapiV1Provider = DEFAULT_CUSTOMER_PROVIDER;
const loanV1Provider = buildCustomerProviderRegistry().get('loan_v1')!;

afterEach(() => resetActiveProvider());

describe('[SITERULESWORLD] siteRulesReachAi — the provider AND the OA switch', () => {
  it('⭐ TARGET — loan_v1: switch ON still sends nothing', () => {
    bindActiveProvider(loanV1Provider);
    expect(siteRulesReachAi(true)).toBe(false);
  });
  it('🔴 PIN — shop-api: switch ON sends, switch OFF / missing does not (exactly `=== true`)', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(siteRulesReachAi(true)).toBe(true);
    for (const v of [false, undefined, null, 'true', 1]) {
      expect({ v, sends: siteRulesReachAi(v) }).toEqual({ v, sends: false });
    }
  });
  it('🔴 PIN — unbound (no provider resolved) behaves as shop-api', () => {
    expect(siteRulesReachAi(true)).toBe(true);
  });
});

describe('[SITERULESWORLD] the one call site — ask-model passes the gate, not the bare switch', () => {
  const src = readFileSync(
    join(__dirname, '../../src/modules/webhook/gates/ask-model.step.ts'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  it('⭐ sendSiteRules comes from siteRulesReachAi(hook.ai_raw_site_rules)', () => {
    expect(src).toMatch(
      /sendSiteRules:\s*siteRulesReachAi\(\s*hook\?\.\['ai_raw_site_rules'\]\s*\)/,
    );
  });
  it('the bare `=== true` read of the switch is gone from the request', () => {
    expect(src).not.toMatch(
      /sendSiteRules:\s*hook\?\.\['ai_raw_site_rules'\]\s*===\s*true/,
    );
  });
});

/* [FEAT-20261018-SCREENSECTIONS] flipped 18/10/2026 (owner: hide Customer Link on loan, and make
   what each provider hides configurable): the route now also carries `hidden` — the sections the
   screen must not draw. `silenced` is unchanged; the exact-shape asserts below were widened to
   name the new field rather than deleted. Table + rules: customer-provider-screen-sections.spec.ts */
describe('[SITERULESWORLD] GET /api/customer-provider/features — what the screen hides', () => {
  const ctl = new CustomerProviderController();
  it('⭐ TARGET — loan_v1 names siteRules among its silenced worlds', () => {
    bindActiveProvider(loanV1Provider);
    expect(providerFeaturesOff()).toContain('siteRules');
    expect(ctl.features()).toEqual({
      success: true,
      data: {
        silenced: providerFeaturesOff(),
        hidden: providerHiddenScreenSections(),
      },
    });
    expect(providerHiddenScreenSections()).toContain('hook-form.site-rules');
  });
  it('🔴 PIN — shop-api silences nothing', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(ctl.features()).toEqual({
      success: true,
      data: { silenced: [], hidden: [] },
    });
  });
});

describe('[SITERULESWORLD] the panel route and its Refresh', () => {
  const HOOK_ID = new Types.ObjectId().toHexString();
  const RULES = { shop: { name: 'demo shop', deposit_min: 100 } };
  const getCombinedData = jest.fn().mockResolvedValue({});
  let service: MembersService;

  beforeAll(async () => {
    const hookDoc = {
      _id: HOOK_ID,
      custom_tool_status: true,
      custom_tool_id: new Types.ObjectId(),
      raw_site_rules_data: RULES,
      site_rules_updated_at: null,
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: getModelToken(Member.name), useValue: {} },
        {
          provide: getModelToken(Hook.name),
          useValue: {
            findById: () => ({ lean: () => Promise.resolve(hookDoc) }),
          },
        },
        { provide: CustomToolService, useValue: { getCombinedData } },
        { provide: getModelToken(ChatRoom.name), useValue: {} },
        { provide: AuditLogService, useValue: { createAuditLog: jest.fn() } },
        {
          provide: CustomerProviderService,
          useValue: {
            resolve: () => ({ name: 'stub' }),
            activeName: () => 'stub',
          },
        },
        { provide: realtimeConfig.KEY, useValue: { wsEnv: 'dev' } },
        {
          provide: mongoConfig.KEY,
          useValue: { uri: 'mongodb://127.0.0.1:27017/testdb' },
        },
      ],
    }).compile();
    service = moduleRef.get(MembersService);
  });
  beforeEach(() => getCombinedData.mockClear());

  it('⭐ TARGET — loan_v1: GET answers no data (soft envelope), even with an old stored copy', async () => {
    bindActiveProvider(loanV1Provider);
    const r = await service.getHookSiteRules(HOOK_ID);
    expect(r).toMatchObject({ success: true, data: null, domain_name: null });
    expect(String(r['reason'])).toMatch(/site rules/i);
  });
  it('⭐ TARGET — loan_v1: Refresh never calls the partner', async () => {
    bindActiveProvider(loanV1Provider);
    const r = await service.refreshHookSiteRules(HOOK_ID);
    expect(getCombinedData).not.toHaveBeenCalled();
    expect(r['data']).toBeNull();
  });
  it('🔴 PIN — shop-api: GET returns the stored rules', async () => {
    bindActiveProvider(shopapiV1Provider);
    const r = await service.getHookSiteRules(HOOK_ID);
    expect(r['data']).toEqual(RULES);
  });
  it('🔴 PIN — shop-api: Refresh warms the prefetch exactly as before', async () => {
    bindActiveProvider(shopapiV1Provider);
    await service.refreshHookSiteRules(HOOK_ID);
    expect(getCombinedData).toHaveBeenCalledTimes(1);
    expect(getCombinedData.mock.calls[0]?.[0]).toBe('');
  });
});
