/**
 * [FEAT-20260909-VENDORTRANSLATE] What the two clone paths do with the new
 * column — and this file BUILDS NOTHING.
 * ============================================================================
 * Owner, 09/09: `ai_vendor_translate` is chosen independently — if it is
 * ticked it travels with the clone, and if it is not, it does not.
 *
 * 🔴 THE FIRST DRAFT OF THIS TASK WAS WRONG, AND IT IS WORTH RECORDING WHY.
 *    The plan called for a new cross-vendor guard here, quoting `ai-pair.ts`'s
 *    header — *"a Google key would be sent to api.deepseek.com"*. That comment
 *    is dated 18/08. The hazard it describes was closed structurally on 04/09
 *    by the per-vendor key columns, and the owner said so. A comment records the
 *    past; only the code says the present.
 *    ⇒ so this file ASSERTS the behaviour the existing mechanism already gives.
 *      A guard added here would be debt paid to prevent something unreachable.
 *
 * WHY ASSERT IT AT ALL, THEN. Because "it works by inheritance" is exactly the
 * kind of property that a later, reasonable-looking edit deletes for free. The
 * tick behaviour is not written anywhere in the clone code as a rule about this
 * field — it falls out of `FIELD_TAB` and the per-field pick. These cases are
 * what turns that accident into a decision.
 *
 * Harness copied from `wrap-ai-p2a-clone-vendor.spec.ts` deliberately: the
 * constructor order and the group-access shape there are hard-won, and a second
 * hand-rolled stub would drift from it.
 *
 * revert: delete this file together with the `ai_vendor_translate` Prop.
 */

import { Types } from 'mongoose';

import { HooksService } from '@/modules/hooks/hooks.service';
import { NEVER_CLONE, FIELD_TAB } from '@/modules/hooks/hook-field-tabs';
import {
  aiPairFieldsToSkip,
  AI_PAIR_FIELDS,
} from '@/modules/hooks/hook-clone/ai-pair';

const SOURCE_ID = new Types.ObjectId().toHexString();
const TARGET_ID = new Types.ObjectId().toHexString();
const GROUP_ID = new Types.ObjectId().toHexString();

interface Row {
  _id: string;
  alias: string;
  group: string;
  [k: string]: unknown;
}

function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['populate', 'lean', 'sort', 'limit', 'select', 'session']) {
    q[m] = () => q;
  }
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
  return q;
}

function buildService(source: Partial<Row>, target: Partial<Row>) {
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const src: Row = {
    _id: SOURCE_ID,
    alias: 'src-oa',
    group: GROUP_ID,
    ...source,
  };
  const tgt: Row = {
    _id: TARGET_ID,
    alias: 'tgt-oa',
    group: GROUP_ID,
    ...target,
  };

  const hookModel = {
    findById: (id: string) => query(id === SOURCE_ID ? src : tgt),
    updateOne: (_f: unknown, u: Record<string, unknown>) => {
      updates.push((u['$set'] ?? u) as Record<string, unknown>);
      return query({ acknowledged: true });
    },
  };
  const passthroughModel = {
    find: () => query([]),
    findOne: () => query(null),
    findById: () => query(null),
    updateOne: () => query({ acknowledged: true }),
  };
  const service = new HooksService(
    hookModel as never,
    passthroughModel as never,
    passthroughModel as never,
    passthroughModel as never,
    { safeDecrypt: (v: string) => v, encrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      invalidateHookCache: () => Promise.resolve(),
    } as never,
    {
      createAuditLog: (row: Record<string, unknown>) => {
        audits.push(row);
        return Promise.resolve();
      },
    } as never,
    {
      verifyDocId: () => Promise.resolve(),
      verifyLineKey: () => Promise.resolve(),
      verifyCustomAiKey: () => Promise.resolve(),
    } as never,
    { getToolForHook: () => Promise.resolve(null) } as never,
    { setEnabled: () => Promise.resolve() } as never,
    {} as never,
  );
  return { service, updates, audits };
}

const ctx = {
  user: { roleName: 'superadmin', id: 'u1', groups: [GROUP_ID] },
} as never;

const cloneBody = (over: Record<string, unknown> = {}) => ({
  target_ids: [TARGET_ID],
  tabs: ['ai'],
  confirm: true,
  ...over,
});

describe('[VENDORTRANSLATE clone] ticked it travels, unticked it stays', () => {
  it('T1 · the whole AI tab ⇒ the translate vendor travels with it', async () => {
    const { service, updates } = buildService(
      { ai_vendor: 'gemini', ai_vendor_translate: 'deepseek' },
      { ai_vendor: null, ai_vendor_translate: null },
    );
    await service.cloneHookSettings(SOURCE_ID, cloneBody(), ctx);
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['ai_vendor_translate']).toBe('deepseek');
  });

  it('T2 · ⭐ NOT ticked ⇒ NOT written, and the tab around it still copies', async () => {
    const { service, updates } = buildService(
      { ai_vendor: 'gemini', ai_vendor_translate: 'deepseek' },
      { ai_vendor: null, ai_vendor_translate: null },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      /* Everything on the tab EXCEPT the new field. This is the owner's
         rule in its most literal form: no tick, no copy. */
      cloneBody({ fields: ['ai_vendor'] }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written).not.toHaveProperty('ai_vendor_translate');
    /* The neighbour still moved — so T2 is failing on the tick, not on a clone
       that did nothing at all. A spec that passes because NOTHING happened is
       the failure mode this whole feature keeps meeting. */
    expect(written['ai_vendor']).toBe('gemini');
  });

  it('T3 · ⭐ ticked ALONE ⇒ only it moves — the two vendors are independent', async () => {
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', ai_vendor_translate: 'gemini' },
      { ai_vendor: null, ai_vendor_translate: null },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ fields: ['ai_vendor_translate'] }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['ai_vendor_translate']).toBe('gemini');
    /* The whole point of a second column: the target keeps answering customers
       on whatever it was answering on. Taking the translate choice must not
       drag the webhook's vendor with it. */
    expect(written).not.toHaveProperty('ai_vendor');
  });

  it('T4 · it is cloneable at all — on a tab, and not on the never-clone list', () => {
    expect(FIELD_TAB['ai_vendor_translate']).toBe('ai');
    /* NEVER_CLONE holds identity and credentials — alias, channel secret,
       access token. A vendor NAME is neither, and putting it there would make
       "ticked it travels" impossible to honour. */
    expect(NEVER_CLONE.has('ai_vendor_translate')).toBe(false);
  });
});

describe('[VENDORTRANSLATE clone-to-create] the pair rule, and what it is keyed on', () => {
  it('T5 · it is NOT an AI pair field — a name is not a credential', () => {
    /* AI_PAIR_FIELDS is the "do not inherit when the vendor moved" list, and it
       holds keys and model ids: things that BELONG to a vendor's account.
       A choice of vendor is not one of those, and adding it here would strip
       the operator's choice on every vendor move for no benefit. */
    expect(AI_PAIR_FIELDS).not.toContain('ai_vendor_translate');
    expect([...AI_PAIR_FIELDS]).toEqual([
      'custom_ai_key',
      'ai_model',
      'custom_ai_key_sec',
      'ai_model_sec',
    ]);
  });

  it('T6 · a translate-vendor difference ALONE does not strip the source pair', () => {
    /* The rule fires on a move of `ai_vendor`, and only that. A new OA that
       merely translates elsewhere is not a vendor move: its webhook still runs
       on the source's vendor, so the source's pair is still the right pair. */
    const skip = aiPairFieldsToSkip(
      { ai_vendor: 'gemini', ai_vendor_translate: 'deepseek' },
      { ai_vendor: 'gemini', ai_vendor_translate: null },
    );
    expect(skip).toEqual([]);
  });

  it('T7 · ⭐ a real vendor move still strips all four, so an inherited translate choice lands KEYLESS', () => {
    /* This is the case that makes the safety argument concrete. The new OA is
       created as DeepSeek and inherits `ai_vendor_translate: 'deepseek'` from
       the source — but the four pair fields are skipped, so it arrives with no
       DeepSeek key. `resolveVendorPair` then finds nothing and the lane
       REFUSES, which is the behaviour the owner's key rule has demanded since
       18/08: the hook's own key or nothing. There is no borrowing to prevent,
       because there is no key to borrow.
       A vendor move inherits no key at all, so translation stays unavailable
       until an admin enters this OA's own. */
    const skip = aiPairFieldsToSkip(
      { ai_vendor: 'deepseek', ai_vendor_translate: 'deepseek' },
      { ai_vendor: 'gemini', custom_ai_key: 'enc:SOURCE-GEMINI-KEY' },
    );
    expect([...skip]).toEqual([...AI_PAIR_FIELDS]);
    expect(skip).toContain('custom_ai_key_sec');
  });
});
