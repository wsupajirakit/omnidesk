/**
 * [FEAT-20260822-CLONEFIELDS] Multi-Clone can tick SOME fields of a tab.
 *
 * Owner (22/08): "ค่าในกล่องแน่ ติ๊กเฉพาะบางรายการได้ เช่นเอาแค่ doc ก็ได้ · proof test
 * ติ๊กอะไรไปแค่นั้น ห้ามมั่ว". So:
 *   · `fields` ABSENT → the whole tab, exactly as before (pinned first).
 *   · `fields` PRESENT → only those — and only if each one belongs to a ticked
 *     tab; anything else is a 400 BEFORE any target is touched.
 *   · the existing gates still hold: NEVER_CLONE, secrets only via
 *     include_secrets, and the ai_vendor/custom_ai_key pair.
 * Real HooksService, stubbed models — the same harness the vendor-pair spec uses.
 */
import { Types } from 'mongoose';

import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';
import { HooksService } from '@/modules/hooks';

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

const AI_SOURCE = {
  doc_id: 'DOC-SRC',
  hook_text_reply_mode: 'flex',
  ai_vendor: 'gemini',
  custom_ai_key: 'enc-src',
  fast_mode: true,
};

describe('⭐ seamless: no `fields` → the whole tab, as before', () => {
  it('every ai-tab field of the source lands on the target', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await service.cloneHookSettings(SOURCE_ID, cloneBody(), ctx);
    expect(updates).toHaveLength(1);
    const u = updates[0]!;
    expect(u['doc_id']).toBe('DOC-SRC');
    expect(u['hook_text_reply_mode']).toBe('flex');
    expect(u['ai_vendor']).toBe('gemini');
    expect(Object.keys(u).length).toBeGreaterThan(3);
  });
});

describe('fields: tick only some', () => {
  it('"เอาแค่ doc" → exactly doc_id reaches the target, nothing else', async () => {
    const { service, updates } = buildService(AI_SOURCE, {
      doc_id: 'DOC-OLD',
      hook_text_reply_mode: 'off',
    });
    const res = await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ fields: ['doc_id'] }),
      ctx,
    );
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]!)).toEqual(['doc_id']);
    expect(updates[0]!['doc_id']).toBe('DOC-SRC');
    expect((res as { fields_applied?: unknown }).fields_applied).toEqual([
      'doc_id',
    ]);
  });

  it('two fields → exactly those two, in registry order', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ fields: ['hook_text_reply_mode', 'doc_id'] }),
      ctx,
    );
    expect(Object.keys(updates[0]!).sort()).toEqual([
      'doc_id',
      'hook_text_reply_mode',
    ]);
  });

  it('a field outside the ticked tabs → 400, no target touched', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await expect(
      service.cloneHookSettings(
        SOURCE_ID,
        cloneBody({ fields: ['telegram_chat_id'] }),
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('an unknown field → 400, no target touched', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await expect(
      service.cloneHookSettings(
        SOURCE_ID,
        cloneBody({ fields: ['nope'] }),
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('an empty fields[] → 400 (ticking nothing is not "everything")', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await expect(
      service.cloneHookSettings(SOURCE_ID, cloneBody({ fields: [] }), ctx),
    ).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('a secret in fields WITHOUT include_secrets → 400: the secret gate is not bypassed', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await expect(
      service.cloneHookSettings(
        SOURCE_ID,
        cloneBody({ fields: ['custom_ai_key'] }),
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('⭐ ai_vendor alone copies ONLY the vendor — its key is not dragged along', async () => {
    /* ⚠️ [FEAT-20260904-VENDORSECCOL] FLIPPED 04/09, kept for the argument.
       This used to expect `['ai_vendor', 'custom_ai_key']`: picking the vendor
       alone dragged its key too, so the target never sat on a vendor it had no
       key for. Owner's rule of 04/09 — *a key is written only if it was ticked,
       never copied and never cleared* — retires that, and the split makes it
       safe: each vendor reads its own column, so a leftover key is not sent
       anywhere. An OA left without its vendor's key is REPORTED on the result
       row (`ai_key_missing_for_vendor`) instead of quietly completed.
       เลือกแค่ vendor = ได้แค่ vendor · คีย์ต้องติ๊กเอง */
    const { service, updates } = buildService(AI_SOURCE, {});
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ fields: ['ai_vendor'] }),
      ctx,
    );
    expect(Object.keys(updates[0]!).sort()).toEqual(['ai_vendor']);
  });

  it('a field from a tab that was NOT ticked → 400 even though the field exists', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    // slip tab not ticked
    await expect(
      service.cloneHookSettings(
        SOURCE_ID,
        cloneBody({ fields: ['doc_id', 'slip_check'] }),
        ctx,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(updates).toHaveLength(0);
  });

  it('⭐ ticking SOME fields AND a secret → both the picked fields AND the secret are written', async () => {
    const { service, updates } = buildService(AI_SOURCE, {});
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({
        fields: ['doc_id'],
        include_secrets: ['custom_ai_key'],
      }),
      ctx,
    );
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]!).sort()).toEqual([
      'custom_ai_key',
      'doc_id',
    ]);
    expect(updates[0]!['doc_id']).toBe('DOC-SRC');
    expect(updates[0]!['custom_ai_key']).toBe('enc-src');
  });
});

/* ── [FIX-20260822-CLONEUNDEF] a field the SOURCE does not have is not a write ──
 * ===========================================================================
 * The differ compares `JSON.stringify(prev) !== JSON.stringify(next)`, and
 * `JSON.stringify(undefined)` is `undefined`, so a source row that never stored
 * a field still lands in the update bag — as an explicit `undefined`. Mongoose
 * strips those out of `$set` (verified on 9.9.1: `{a: undefined, b: 1, c: null}`
 * casts to `{b: 1, c: null}`), so NOTHING is written — yet the clone counted it
 * as `changed`, wrote an audit row naming a change that never happened, and
 * invalidated the hook cache for a write that did not occur.
 * นับว่าเปลี่ยน ทั้งที่ไม่ได้เขียนอะไรเลย = log โกหก. */
describe('⭐ a source field that does not exist is never reported as changed', () => {
  it('⭐ nothing is written, nothing is audited, and the count is honest', async () => {
    const { service, updates, audits } = buildService(
      // the source never stored `doc_id`
      { hook_text_reply_mode: 'flex' },
      // the target has one — cloning "absence" must not claim to clear it
      { doc_id: 'DOC-TGT' },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ fields: ['doc_id'] }),
      ctx,
    )) as { results: Array<Record<string, unknown>> };

    expect(updates).toEqual([]); // no updateOne at all
    expect(audits).toEqual([]); // and no audit row for a write that never was
    expect(res.results[0]).toMatchObject({ ok: true, changed: 0 });
  });

  it('⭐ a mixed pick writes and counts ONLY the field that really moves', async () => {
    const { service, updates, audits } = buildService(
      { doc_id: 'DOC-SRC' }, // real change
      { doc_id: 'DOC-TGT', hook_text_reply_mode: 'text' },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      // `hook_text_reply_mode` is absent on the source → not a write
      cloneBody({ fields: ['doc_id', 'hook_text_reply_mode'] }),
      ctx,
    )) as { results: Array<Record<string, unknown>> };

    expect(updates).toEqual([{ doc_id: 'DOC-SRC' }]);
    expect(res.results[0]).toMatchObject({ changed: 1 });
    const changed = audits[0]?.['changed_fields'] as Array<{ field: string }>;
    expect(changed.map((c) => c.field)).toEqual(['doc_id']);
  });

  it('⭐ an explicit null still clears — absence and null are different answers', async () => {
    /* `null` is a value the source really holds, so cloning it IS a write.
       Only `undefined` (the field was never there) is skipped. */
    const { service, updates } = buildService(
      { doc_id: null },
      { doc_id: 'DOC-TGT' },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ fields: ['doc_id'] }),
      ctx,
    );
    expect(updates).toEqual([{ doc_id: null }]);
  });
});

/* ── [FIX-20260822-NOTICEHARDEN] #12 · the card gate, on the REAL clone path ──
 * The gate was pinned by source text only; this drives the service. */
describe('⭐ #12 the notice card gate refuses a target on the clone path itself', () => {
  const NOTICE_TARGET = {
    notice_deposit_status: true,
    notice_deposit_scope: 'text',
    notice_deposit_flex_id: 'a'.repeat(24),
    notice_deposit_offtime_flex_id: 'b'.repeat(24),
  };

  it('⭐ a scope-only clone that would wedge the hook is skipped, and nothing is written', async () => {
    const { service, updates, audits } = buildService(
      { notice_deposit_scope: 'slip' }, // source: slip scope, no `all` cards
      NOTICE_TARGET,
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['notice'], fields: ['notice_deposit_scope'] }),
      ctx,
    )) as { results: Array<Record<string, unknown>>; failed: number };

    expect(res.results[0]).toMatchObject({
      ok: false,
      reason: 'notice_cards_incomplete',
    });
    expect(res.failed).toBe(1);
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('⭐ the same clone onto a target that HAS the all-cards is written normally', async () => {
    const { service, updates } = buildService(
      { notice_deposit_scope: 'slip' },
      {
        ...NOTICE_TARGET,
        notice_all_offtime_flex_id: 'c'.repeat(24),
        notice_all_disable_flex_id: 'd'.repeat(24),
      },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['notice'], fields: ['notice_deposit_scope'] }),
      ctx,
    )) as { results: Array<Record<string, unknown>> };

    expect(res.results[0]).toMatchObject({ ok: true, changed: 1 });
    expect(updates).toEqual([{ notice_deposit_scope: 'slip' }]);
  });
});

/* ── [FEAT-20260822-QRPRESCANFE] the prescan mode travels with a slip clone ──
 * The dashboard can now set `qr_prescan_mode`, so the next question an operator
 * asks is "does Multi-Clone carry it?". It does — the field sits in the 'slip'
 * tab and is not in NEVER_CLONE — but nothing proved it, and a single line in
 * either list would take it away silently: the clone would report success and
 * the target would keep an old value, which for 'off' means its slip cards can
 * never fire. โคลนแท็บสลิปต้องพาโหมดนี้ไปด้วย และต้องมีเทสยืนยัน. */
describe('⭐ qr_prescan_mode is carried by a slip-tab clone', () => {
  it('⭐ the source value lands on the target', async () => {
    const { service, updates } = buildService(
      { qr_prescan_mode: 'skip' },
      { qr_prescan_mode: 'off' },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'], fields: ['qr_prescan_mode'] }),
      ctx,
    )) as { results: Array<Record<string, unknown>> };

    expect(updates).toEqual([{ qr_prescan_mode: 'skip' }]);
    expect(res.results[0]).toMatchObject({ ok: true, changed: 1 });
  });

  it('⭐ a whole-slip-tab clone carries it too — no `fields` list needed', async () => {
    const { service, updates } = buildService(
      { qr_prescan_mode: 'log', slip_check: true },
      { qr_prescan_mode: 'off', slip_check: false },
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'] }),
      ctx,
    );
    expect(updates[0]).toMatchObject({ qr_prescan_mode: 'log' });
  });

  it('⭐ and a target whose column was never written is the case that matters', async () => {
    /* the OA the whole D14 question is about: no column at all, so the runtime
       reads 'off' and its slip cards are silent. Cloning a configured OA onto it
       is the fix that needs no migration. */
    const { service, updates } = buildService(
      { qr_prescan_mode: 'skip' },
      {}, // no qr_prescan_mode at all
    );
    await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'], fields: ['qr_prescan_mode'] }),
      ctx,
    );
    expect(updates).toEqual([{ qr_prescan_mode: 'skip' }]);
  });
});

/* [FEAT-20261016-SLIPGUARDLOAN] the clone route keeps a slip provider and its key together — the
 * switchboard tripwire's condition #1, for the loan site where SlipGuard is a provider. Rule:
 * `hooks/hook-clone/slip-pair.ts`. shop-api: slipguard is not a provider there, so nothing is held. */
describe('[SLIPGUARDLOAN] clone tab: a slip provider move without its key is held for that target', () => {
  const site = (n: string) =>
    CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n)!;
  const SLIPGUARD_SRC = {
    slip_provider: 'slipguard',
    slip_verify_branch: '12345',
    slip_verify_key: 'enc-slipguard',
    slip_check: true,
  };
  const SWIFTCHECK_TGT = {
    slip_provider: '',
    slip_verify_key: 'enc-swiftcheck',
    slip_check: false,
  };
  afterEach(() => resetActiveProvider());

  it('⭐ loan, key not ticked ⇒ provider + branch held, the rest written, the result says so', async () => {
    bindActiveProvider(site('loan_v1'));
    const { service, updates, audits } = buildService(
      SLIPGUARD_SRC,
      SWIFTCHECK_TGT,
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'] }),
      ctx,
    )) as {
      results: Record<string, unknown>[];
    };
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ slip_check: true });
    expect(updates[0]).not.toHaveProperty('slip_provider');
    expect(updates[0]).not.toHaveProperty('slip_verify_branch');
    expect(updates[0]).not.toHaveProperty('slip_verify_key');
    const audited = (audits[0]?.['changed_fields'] as { field: string }[]).map(
      (c) => c.field,
    );
    expect(audited).not.toContain('slip_provider');
    expect(res.results[0]).toMatchObject({
      ok: true,
      slip_provider_held_without_key: true,
    });
  });

  it('⭐ loan, key ticked ⇒ provider, branch and key travel together, nothing held', async () => {
    bindActiveProvider(site('loan_v1'));
    const { service, updates } = buildService(SLIPGUARD_SRC, SWIFTCHECK_TGT);
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'], include_secrets: ['slip_verify_key'] }),
      ctx,
    )) as { results: Record<string, unknown>[] };
    expect(updates[0]).toMatchObject({
      slip_provider: 'slipguard',
      slip_verify_branch: '12345',
      slip_verify_key: 'enc-slipguard',
    });
    expect(res.results[0]).not.toHaveProperty('slip_provider_held_without_key');
  });

  it('loan, the only change was the held provider ⇒ changed 0, still reported', async () => {
    bindActiveProvider(site('loan_v1'));
    const { service, updates } = buildService(
      { slip_provider: 'slipguard' },
      { slip_provider: '' },
    );
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'], fields: ['slip_provider'] }),
      ctx,
    )) as { results: Record<string, unknown>[] };
    expect(updates).toEqual([]);
    expect(res.results[0]).toMatchObject({
      ok: true,
      changed: 0,
      slip_provider_held_without_key: true,
    });
  });

  it('🔴 PIN — shop-api: the same clone writes the provider exactly as before, no flag', async () => {
    bindActiveProvider(site('shopapi_v1'));
    const { service, updates } = buildService(SLIPGUARD_SRC, SWIFTCHECK_TGT);
    const res = (await service.cloneHookSettings(
      SOURCE_ID,
      cloneBody({ tabs: ['slip'] }),
      ctx,
    )) as {
      results: Record<string, unknown>[];
    };
    expect(updates[0]).toMatchObject({
      slip_provider: 'slipguard',
      slip_verify_branch: '12345',
    });
    expect(res.results[0]).not.toHaveProperty('slip_provider_held_without_key');
  });
});
