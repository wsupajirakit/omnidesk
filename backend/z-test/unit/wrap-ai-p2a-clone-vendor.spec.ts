/**
 * [TEST-20260813-P2A-CLONE] Cloning the AI tab must never leave a half-bound OA.
 *
 * `ai_vendor` is a name (cloned with its tab) and `custom_ai_key` is a
 * credential (opt-in per tick), so the two live in different maps and would
 * separate on a clone — handing the target a vendor with the wrong key or none,
 * which `resolveVendorKey` refuses, leaving that OA silent with nothing in the
 * clone result to explain it.
 *
 * Two honest outcomes are pinned here, plus proof the rule reaches ONLY the AI
 * pair: every other tab and every other secret must behave exactly as before.
 */

import { Types } from 'mongoose';

import { HooksService } from '@/modules/hooks/hooks.service';

const SOURCE_ID = new Types.ObjectId().toHexString();
const TARGET_ID = new Types.ObjectId().toHexString();
/** Group access is checked against real ObjectIds on the user, so use one. */
const GROUP_ID = new Types.ObjectId().toHexString();

interface Row {
  _id: string;
  alias: string;
  group: string;
  [k: string]: unknown;
}

/** Chainable query stub — every method returns itself, then resolves. */
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

  // Constructor order verified against hooks.service.ts:228-254 — four models
  // first, then crypto / cache / audit / credential-check / tools / handoff.
  const passthroughModel = {
    find: () => query([]),
    findOne: () => query(null),
    findById: () => query(null),
    updateOne: () => query({ acknowledged: true }),
  };
  const service = new HooksService(
    hookModel as never, // Hook
    passthroughModel as never, // Group
    passthroughModel as never, // FlexMessage
    passthroughModel as never, // User
    { safeDecrypt: (v: string) => v, encrypt: (v: string) => v } as never, // crypto
    {
      cacheHook: () => Promise.resolve(),
      invalidateHookCache: () => Promise.resolve(),
    } as never, // hookCache
    {
      createAuditLog: (row: Record<string, unknown>) => {
        audits.push(row);
        return Promise.resolve();
      },
    } as never, // auditLog
    {
      verifyDocId: () => Promise.resolve(),
      verifyLineKey: () => Promise.resolve(),
      verifyCustomAiKey: () => Promise.resolve(),
    } as never, // credentialCheck
    { getToolForHook: () => Promise.resolve(null) } as never, // customTools
    { setEnabled: () => Promise.resolve() } as never, // handoffBindings
    /* [PHASE3-I-QUOTA] LineQuotaApi — this spec never reaches the quota path. */
    {} as never,
  );
  return { service, updates, audits };
}

// `ensureGroupAccess` filters `user.groups` for valid ObjectIds — a role string
// alone is not enough, and the source/target groups must be in that list.
const ctx = {
  // [FIX-20260818-HOOKWRITESCOPE] `roleName`, not `role` — see super-role.ts:5.
  user: { roleName: 'superadmin', id: 'u1', groups: [GROUP_ID] },
} as never;

/** The clone body, with only what a test varies. */
const cloneBody = (over: Record<string, unknown> = {}) => ({
  target_ids: [TARGET_ID],
  tabs: ['ai'],
  confirm: true,
  ...over,
});

/* [FEAT-20260904-VENDORSECCOL] ⚠️ FLIPPED 04/09 — kept, not deleted, because the
 * argument they recorded is worth more than the expectations they carried.
 *
 * WHAT THEY USED TO PIN (P2-20260813): a vendor that moved for a target dragged
 * its key along WITHOUT a tick ("mode A"), and `ai_vendor_without_key` CLEARED
 * the target's key ("mode B"). Both existed to stop a half state — an OA holding
 * one vendor's key while pointing at another — because with a single shared
 * `custom_ai_key` column that half state meant a real request going out with the
 * wrong credential.
 *
 * WHY THAT IS RETIRED: each vendor now reads its own column, so a leftover key
 * is never sent anywhere and the half state is merely "this OA may not be able
 * to answer". Owner's rule, 04/09: *a key is written only if it was ticked — not
 * copied, not cleared, not touched.* The information is reported instead, on the
 * target's own result row (`ai_key_missing_for_vendor`).
 * ห้ามทับ ห้ามล้าง เพราะไม่ได้ติ๊ก · สถานะที่ยังไม่ครบให้บอก
 *
 * The fixtures also moved to the `_sec` columns, since a DeepSeek source keeps
 * its key there now. */
describe('[P2A CLONE] a key moves ONLY when it was ticked', () => {
  it('⭐ no tick ⇒ NO key column is written, and the result says the OA has none', async () => {
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      { ai_vendor: null, custom_ai_key: 'enc:OLD-GEMINI-KEY' },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody(),
      ctx,
    )) as { results: Array<Record<string, unknown>> };
    const written = Object.assign({}, ...updates) as Record<string, unknown>;

    expect(written['ai_vendor']).toBe('deepseek');
    // ⭐ neither column moved: not the source's DeepSeek key (never ticked) and
    //    not the target's own Gemini key (a different vendor's slot entirely).
    expect(written).not.toHaveProperty('custom_ai_key_sec');
    expect(written).not.toHaveProperty('custom_ai_key');
    // ⭐ and the operator is TOLD, instead of the code quietly completing it.
    expect(res.results[0]?.['ai_key_missing_for_vendor']).toBe('deepseek');
  });

  it('ticking the secret explicitly behaves exactly as before (no regression)', async () => {
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      { ai_vendor: null, custom_ai_key: null },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      // [FEAT-20260904-VENDORSECCOL] the tick names the column, and a DeepSeek
      // source's key is `custom_ai_key_sec` — "เอาคีย์ค่ายไหน" is now a question
      // the body answers explicitly instead of one the vendor field implies.
      cloneBody({ include_secrets: ['custom_ai_key_sec'] }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['custom_ai_key_sec']).toBe('enc:SRC-KEY');
    expect(written['ai_vendor']).toBe('deepseek');
  });
});

describe('[P2A CLONE] ai_vendor_without_key is a brake, never an eraser', () => {
  it('⭐ does NOT clear the stale key it used to erase — the OA keeps what it had', async () => {
    /* [FEAT-20260904-VENDORSECCOL] ⚠️ THE EXPECTATION HERE IS INVERTED, on the
       owner's rule of 04/09: this used to assert the target's key was written to
       `null`. The target carries a STALE DeepSeek key from an earlier stint on
       that vendor — the shape the clear existed for. It is now LEFT ALONE,
       because nobody ticked it, and a key that is not read by anyone is not
       worth destroying somebody's credential over.
       ห้ามล้าง แม้จะเป็นคีย์ค้าง · ไม่ได้ติ๊ก = ไม่แตะ */
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      {
        ai_vendor: null,
        custom_ai_key: 'enc:OLD-GEMINI-KEY',
        custom_ai_key_sec: 'enc:TGT-STALE-DEEPSEEK-KEY',
      },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ ai_vendor_without_key: true }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['ai_vendor']).toBe('deepseek');
    // ⭐ nothing at all is written to either key column.
    expect(written).not.toHaveProperty('custom_ai_key_sec');
    expect(written).not.toHaveProperty('custom_ai_key');
  });

  it('⭐ it still refuses to CARRY a ticked key — that is all it does now', async () => {
    // The brake: the operator ticked the key AND asked for vendor-only. The
    // tick loses, so no key travels — and still nothing is erased.
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      { ai_vendor: null, custom_ai_key_sec: 'enc:TGT-OWN-KEY' },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({
        include_secrets: ['custom_ai_key_sec'],
        ai_vendor_without_key: true,
      }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['ai_vendor']).toBe('deepseek');
    expect(written).not.toHaveProperty('custom_ai_key_sec');
  });

  it('⭐ a gemini target with no key is NOT reported — it rides the env ladder', async () => {
    /* The warning must mean "this OA is stuck", not "this column is empty".
       A keyless Gemini hook answers perfectly well; saying otherwise would make
       the report noise and teach operators to ignore it.
       ไม่มีคีย์ ≠ ตอบไม่ได้ */
    const { service } = buildService(
      { ai_vendor: 'gemini', custom_ai_key: 'enc:SRC-KEY' },
      { ai_vendor: null, custom_ai_key: null },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody(),
      ctx,
    )) as { results: Array<Record<string, unknown>> };
    expect(res.results[0]).not.toHaveProperty('ai_key_missing_for_vendor');
  });

  it('a target with no key stays null and gets no pointless update row', async () => {
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      { ai_vendor: null, custom_ai_key: null },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ ai_vendor_without_key: true }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['ai_vendor']).toBe('deepseek');
    expect(written).not.toHaveProperty('custom_ai_key');
  });
});

describe('[P2A CLONE] the rule reaches ONLY the AI pair', () => {
  it('cloning another tab never drags custom_ai_key along', async () => {
    const { service, updates } = buildService(
      { slip_check: true, custom_ai_key: 'enc:SRC-KEY' },
      { slip_check: false, custom_ai_key: null },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'] }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written).not.toHaveProperty('custom_ai_key');
  });

  it('⭐ two OAs already on the SAME vendor: the target keeps its own key', async () => {
    /* Found by probing same-vendor→same-vendor, and it was a real defect: the
       pair rule was decided once for the whole request rather than per target,
       so cloning knob settings between two OAs both already on gemini
       overwrote the target's own working key with the source's — no secret
       ticked, nothing in the result to say so. The vendor never moved, so
       there is no binding to preserve. */
    const { service, updates } = buildService(
      { ai_vendor: 'gemini', custom_ai_key: 'enc:SRC-KEY', gemini_top_k: 40 },
      {
        ai_vendor: 'gemini',
        custom_ai_key: 'enc:TGT-OWN-KEY',
        gemini_top_k: 1,
      },
    );
    await service.cloneHookSettings(SOURCE_ID, cloneBody(), ctx);
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['gemini_top_k']).toBe(40);
    expect(written).not.toHaveProperty('custom_ai_key');
  });

  it('⭐ a vendor MOVE between two keyed OAs still writes no key', async () => {
    // The case mode A was built for. The target keeps the key it had, does not
    // receive the source's, and the report carries the consequence.
    const { service, updates } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      { ai_vendor: 'gemini', custom_ai_key: 'enc:TGT-OLD-GEMINI-KEY' },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody(),
      ctx,
    )) as { results: Array<Record<string, unknown>> };
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['ai_vendor']).toBe('deepseek');
    expect(written).not.toHaveProperty('custom_ai_key_sec');
    expect(written).not.toHaveProperty('custom_ai_key');
    expect(res.results[0]?.['ai_key_missing_for_vendor']).toBe('deepseek');
  });

  it('both vendors null (neither OA ever chose one) does not force the key', async () => {
    // Nothing about ai_vendor changed, so there is no binding to preserve.
    const { service, updates } = buildService(
      { ai_vendor: null, custom_ai_key: 'enc:SRC-KEY', gemini_top_k: 40 },
      { ai_vendor: null, custom_ai_key: null, gemini_top_k: 1 },
    );
    await service.cloneHookSettings(SOURCE_ID, cloneBody(), ctx);
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written['gemini_top_k']).toBe(40);
    // ai_vendor is identical on both sides so it is not in the update at all,
    // and the pair rule must not fire off the back of an unchanged value.
    expect(written).not.toHaveProperty('ai_vendor');
  });
});

describe('[P2A CLONE] contradictory ticks resolve to one honest outcome', () => {
  it('⭐ include_secrets AND vendor-only together: ZERO key rows, nothing written', async () => {
    /* Found by probing the two flags together rather than by a failing test:
       the key was copied and then nulled, so the audit trail carried two
       `custom_ai_key` rows — "copied" followed by "cleared" — and a reader could
       not tell what actually happened. The fix then was to write exactly one row.
       ⚠️ [FEAT-20260904-VENDORSECCOL] FLIPPED: the honest outcome is now ZERO
       rows, because neither writing nor clearing may happen without a tick that
       survived. The contradiction still resolves one way — it just resolves to
       "do nothing", which is the one answer that cannot destroy a credential.
       ขัดกันเอง = ไม่ทำอะไรเลย ปลอดภัยที่สุด */
    const { service, updates, audits } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      // [FEAT-20260904-VENDORSECCOL] a stale key in the SAME column the clone is
      // talking about — otherwise there is nothing to clear and no row to count.
      { ai_vendor: null, custom_ai_key_sec: 'enc:TGT-STALE-KEY' },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({
        include_secrets: ['custom_ai_key_sec'],
        ai_vendor_without_key: true,
      }),
      ctx,
    );
    const written = Object.assign({}, ...updates) as Record<string, unknown>;
    expect(written).not.toHaveProperty('custom_ai_key_sec');
    // the target's stale key is still exactly where it was
    const changed = (audits[0]?.['changed_fields'] ?? []) as Array<{
      field: string;
    }>;
    const keyRows = changed.filter((c) => c.field === 'custom_ai_key_sec');
    expect(keyRows).toHaveLength(0);
  });

  it('no audit row ever carries a raw key value', async () => {
    const { service, audits } = buildService(
      { ai_vendor: 'deepseek', custom_ai_key_sec: 'enc:SRC-KEY' },
      { ai_vendor: null, custom_ai_key: 'enc:OLD-SECRET-VALUE' },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ ai_vendor_without_key: true }),
      ctx,
    );
    expect(JSON.stringify(audits)).not.toContain('OLD-SECRET-VALUE');
  });
});
