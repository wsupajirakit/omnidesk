/**
 * [FEAT-20261016-LOGMASK80] The server log masks the loan customer's name, phone and contract — 80%.
 *
 * Owner 16/10/2026: "log ของ server พิมพ์ชื่อ เบอร์ และเลขสัญญาลูกค้าทุกข้อความ … ให้ mask ข้อมูลนั้นๆ
 * ของสินเชื่อ 80%" · "ห้ามกระทบ x api".
 *
 * TARGET (loan_v1): `[PROFILE-CHECK]` and `[Webhook] Saved …` carry the values masked — 80% of the
 *         characters replaced by `*`, the head kept, the length kept (the owner's existing mask
 *         style, `chat/site-rules` `maskValue`) — and never the plain value.
 * PIN:    shop-api / unbound ⇒ both lines byte-identical to before · `N/A` stays `N/A` · the member
 *         row still receives the REAL values (the mask is for the log only, never the data).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { fetchCombinedProfile } from '@/modules/webhook';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};

const NAME = 'สมชาย ใจดีมาก'; // 13 chars
const TEL = '0812345678'; // 10
const CONTRACT = 'CT0226-SRI001-0020-01'; // 21

const TOOL = {
  _id: 't1',
  endpoints: [{ key: 'CUSTOMER_PROFILE', is_profile: true }],
};

const run = async (profile: { name: string; phone: string; code: string }) => {
  const lines: string[] = [];
  const writes: Record<string, unknown>[] = [];
  await fetchCombinedProfile(
    {
      hook: { alias: 'oa', custom_tool_status: true, custom_tool_id: 't1' },
      userId: 'U1',
    },
    {
      logger: {
        log: (m: string) => lines.push(m),
        error: (m: string) => lines.push(m),
      },
      usesCustomTool: () => true,
      loadCombinedProfile: () =>
        Promise.resolve({
          CUSTOMER_PROFILE: {
            success: true,
            status: 200,
            data: {},
            is_profile: true,
          },
        }),
      memberModel: {
        updateOne: (_f: unknown, u: Record<string, unknown>) => {
          writes.push(u);
          return { exec: () => Promise.resolve() };
        },
      },
      customTool: {
        getToolForHook: () => Promise.resolve(TOOL),
        extractProfile: () => ({ ...profile, ok: true }),
      },
    },
  );
  return {
    check: lines.find((l) => l.startsWith('[PROFILE-CHECK]')) ?? '',
    saved: lines.find((l) => l.startsWith('[Webhook] Saved')) ?? '',
    writes,
  };
};

const masked = (s: string) => {
  const hidden = Math.ceil(s.length * 0.8);
  return s.slice(0, s.length - hidden) + '*'.repeat(hidden);
};

afterEach(() => resetActiveProvider());

describe('[LOGMASK80] TARGET — loan: name / phone / contract masked 80% in the server log', () => {
  beforeEach(() => bindActiveProvider(byName('loan_v1')));

  it('⭐ [PROFILE-CHECK] carries the masked values and never the plain ones', async () => {
    const r = await run({ name: NAME, phone: TEL, code: CONTRACT });
    expect(r.check).toContain(`name=${masked(NAME)}`);
    expect(r.check).toContain(`tel=${masked(TEL)}`);
    expect(r.check).toContain(`contract=${masked(CONTRACT)}`);
    for (const plain of [NAME, TEL, CONTRACT])
      expect(r.check).not.toContain(plain);
  });

  it('⭐ [Webhook] Saved … carries the masked values and never the plain ones', async () => {
    const r = await run({ name: NAME, phone: TEL, code: CONTRACT });
    expect(r.saved).toContain(`phone_number: ${masked(TEL)}`);
    expect(r.saved).toContain(`contract_code: ${masked(CONTRACT)}`);
    expect(r.saved).toContain(`full_name: ${masked(NAME)}`);
    for (const plain of [NAME, TEL, CONTRACT])
      expect(r.saved).not.toContain(plain);
  });

  it('80% means: 80% of the characters are `*`, the head is kept, the length is kept', () => {
    expect(masked(TEL)).toBe('08********');
    expect(masked(CONTRACT)).toBe('CT02*****************');
    expect(masked(CONTRACT)).toHaveLength(CONTRACT.length);
  });

  it('🔴 PIN — the member row still gets the REAL values (mask is log-only)', async () => {
    const r = await run({ name: NAME, phone: TEL, code: CONTRACT });
    expect(r.writes[0]).toEqual({
      $set: { phone_number: TEL, contract_code: CONTRACT, full_name: NAME },
    });
  });

  it('PIN — `N/A` (nothing known) is not turned into stars', async () => {
    const r = await run({ name: 'N/A', phone: 'N/A', code: 'N/A' });
    expect(r.check).toContain('name=N/A | tel=N/A | contract=N/A');
  });
});

describe('[LOGMASK80] PIN — shop-api and unbound: the lines are exactly as before', () => {
  const plainCheck = `name=${NAME} | tel=${TEL} | contract=${CONTRACT}`;
  const plainSaved = `[Webhook] Saved phone_number: ${TEL}, contract_code: ${CONTRACT}, full_name: ${NAME} to Member U1`;

  it('⭐ shop-api bound ⇒ plain values, byte-identical', async () => {
    bindActiveProvider(byName('shopapi_v1'));
    const r = await run({ name: NAME, phone: TEL, code: CONTRACT });
    expect(r.check).toContain(plainCheck);
    expect(r.saved).toBe(plainSaved);
  });

  it('unbound ⇒ plain values', async () => {
    const r = await run({ name: NAME, phone: TEL, code: CONTRACT });
    expect(r.check).toContain(plainCheck);
    expect(r.saved).toBe(plainSaved);
  });

  it('loan bound, then reset ⇒ plain again (the ratio does not outlive the binding)', async () => {
    bindActiveProvider(byName('loan_v1'));
    resetActiveProvider();
    const r = await run({ name: NAME, phone: TEL, code: CONTRACT });
    expect(r.saved).toBe(plainSaved);
  });

  it('shop-api declares no ratio; loan declares 0.8', () => {
    expect(byName('shopapi_v1').personalLogMaskRatio).toBeUndefined();
    expect(byName('loan_v1').personalLogMaskRatio).toBe(0.8);
  });
});

describe('[LOGMASK80] the image probe line goes through the same mask (source pin, comments stripped)', () => {
  it('⭐ `customerName` in stage=image-in is masked', () => {
    const src = readFileSync(
      join(__dirname, '../../src/modules/webhook/gates/image-store.step.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(src).toMatch(
      /customerName:\s*maskPersonalForLog\(ctx\.customerName\)/,
    );
  });
});
