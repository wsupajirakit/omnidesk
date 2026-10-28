/**
 * [FEAT-20260808-PAYTOOL-P4] Pins PATCH /hook/payment/bulk — the per-OA payment
 * kill switch, and specifically its enable-time readiness check.
 *
 * WHAT THESE TESTS ESTABLISH
 * That the endpoint drives the DATABASE to the right state, refuses an unready
 * batch WHOLE (nothing written), always lets the OFF direction through, and
 * evicts the hook cache for every hook it touches.
 *
 * WHAT THEY DO NOT
 * They do not prove payment runs or stops end to end — `payment-runner.service`
 * reads this flag but is exercised by its own specs. A green run here means
 * "the switch writes the state the runner reads", nothing more.
 *
 * THE FAILURE UNDER TEST (why the readiness check exists)
 * Switch ON + `payment_tool_id` null/dangling ⇒ the runner's gate returns null
 * and does nothing, silently: no error, no log, toggle still green. This suite
 * exists so that state cannot be reached through the bulk route.
 *
 * No I/O: in-memory doubles stand in for the Mongoose models, the hook cache
 * and the audit log. Nothing here touches Mongo, Redis or the network.
 *
 * revert: delete this file together with the [FEAT-20260808-PAYTOOL-P4] edits.
 */
import { BadRequestException } from '@nestjs/common';

import { BlockedHooksException, HooksService } from '@/modules/hooks';

/** 24-hex ids so `isValidObjectId` accepts them. */
const OA_READY = 'a0d00000000000000000003b';
const OA_READY_2 = 'a0d000000000000000000059';
const OA_UNBOUND = 'a0d00000000000000000005a';
const OA_DANGLING = 'a0d00000000000000000003c';
const OA_GENERIC = 'a0d000000000000000000076';
const TOOL_PAY = 'a0d00000000000000000005b';
const TOOL_GENERIC = 'a0d000000000000000000077';
const TOOL_GONE = 'a0d000000000000000000078';

type HookDoc = Record<string, unknown>;

/**
 * Minimal stand-in for `Model<Hook>`: only `find().lean().exec()` and
 * `updateMany()`, applying the same `$in` + `$set` semantics Mongo would.
 */
function fakeHookModel(docs: HookDoc[]) {
  const writes: { ids: string[]; set: Record<string, unknown> }[] = [];
  return {
    writes,
    docs,
    find(selector: Record<string, unknown>) {
      const inList = ((selector['_id'] as { $in?: unknown[] })?.$in ?? []).map(
        String,
      );
      /**
       * ⚠️ Returns COPIES, exactly as `.lean()` does. A real `updateMany` writes
       * in the database and cannot reach back into objects a previous `find`
       * already handed out — so the service's `from:` audit value stays the
       * pre-write one. Handing out live references instead would make this fake
       * report post-write values and fake an audit bug that does not exist.
       */
      const found = docs
        .filter((d) => inList.includes(String(d['_id'])))
        .map((d) => ({ ...d }));
      return { lean: () => ({ exec: () => Promise.resolve(found) }) };
    },
    updateMany(
      selector: Record<string, unknown>,
      update: Record<string, unknown>,
    ) {
      const inList = ((selector['_id'] as { $in?: unknown[] })?.$in ?? []).map(
        String,
      );
      const set = update['$set'] as Record<string, unknown>;
      writes.push({ ids: inList, set });
      for (const d of docs) {
        if (inList.includes(String(d['_id']))) Object.assign(d, set);
      }
      return { exec: () => Promise.resolve({ modifiedCount: inList.length }) };
    },
  };
}

/** Tools the readiness check resolves against. */
const TOOLS: Record<string, Record<string, unknown>> = {
  [TOOL_PAY]: { _id: TOOL_PAY, category: 'payment', status: true },
  [TOOL_GENERIC]: { _id: TOOL_GENERIC, category: 'generic', status: true },
  // TOOL_GONE is deliberately absent — deleted or switched off.
};

/**
 * Builds a HooksService with everything faked. Only the collaborators the
 * payment bulk path actually reaches are real-shaped; the rest are stubs that
 * throw if touched, so an accidental new dependency shows up as a failure
 * rather than as a silent undefined.
 */
function buildService(hooks: HookDoc[]) {
  const hookModel = fakeHookModel(hooks);
  const cached: { id: string; previousAlias?: string; status: unknown }[] = [];
  const audits: Record<string, unknown>[] = [];
  const toolLookups: string[] = [];

  const hookCache = {
    cacheHook: (
      doc: Record<string, unknown>,
      opts?: { previousAlias?: string },
    ) => {
      cached.push({
        id: String(doc['_id']),
        previousAlias: opts?.previousAlias,
        status: doc['payment_tool_status'],
      });
      return Promise.resolve();
    },
  };
  const auditLog = {
    writeInBackground: (entry: Record<string, unknown>) => {
      audits.push(entry);
    },
  };
  const customTools = {
    findPaymentToolForBinding: (id: string) => {
      toolLookups.push(id);
      return Promise.resolve(TOOLS[id] ?? null);
    },
  };

  const service = new HooksService(
    hookModel as never,
    {} as never, // groupModel — unused on this path
    {} as never, // flexModel
    {} as never, // userModel
    {} as never, // crypto
    hookCache as never,
    auditLog as never,
    {} as never, // credentialCheck
    customTools as never,
    {} as never, // handoffBindings
    /* [PHASE3-I-QUOTA] LineQuotaApi — this spec never reaches the quota path. */
    {} as never,
  );

  return { service, hookModel, cached, audits, toolLookups };
}

/**
 * A superuser context, so `ensureGroupAccess` always passes and group scoping
 * never masks a readiness result. `roleName` is the field the shared
 * `isSuperUser` predicate reads — not `role`.
 */
const CTX = { user: { roleName: 'superadmin' } } as never;

/** Hook fixtures — one per readiness outcome. */
const fixtures = (): HookDoc[] => [
  {
    _id: OA_READY,
    alias: 'shop-ready',
    group: 'g1',
    payment_tool_status: false,
    payment_tool_id: TOOL_PAY,
  },
  {
    _id: OA_READY_2,
    alias: 'shop-ready-2',
    group: 'g1',
    payment_tool_status: false,
    payment_tool_id: TOOL_PAY,
  },
  {
    _id: OA_UNBOUND,
    alias: 'shop-unbound',
    group: 'g1',
    payment_tool_status: false,
    payment_tool_id: null,
  },
  {
    _id: OA_DANGLING,
    alias: 'shop-dangling',
    group: 'g1',
    payment_tool_status: false,
    payment_tool_id: TOOL_GONE,
  },
  {
    _id: OA_GENERIC,
    alias: 'shop-generic',
    group: 'g1',
    payment_tool_status: false,
    payment_tool_id: TOOL_GENERIC,
  },
];

describe('[PAYTOOL-P4b] payment/bulk — enabling requires every target to be ready', () => {
  it('enables a batch where every OA is bound to a live payment tool', async () => {
    const { service, hookModel } = buildService(fixtures());
    const res = await service.bulkUpdateHookPayment(
      { ids: [OA_READY, OA_READY_2], value: true },
      CTX,
    );
    expect(res['success']).toBe(true);
    expect(res['modified']).toBe(2);
    expect(hookModel.docs[0]?.['payment_tool_status']).toBe(true);
    expect(hookModel.docs[1]?.['payment_tool_status']).toBe(true);
  });

  it('refuses the WHOLE batch when one OA has no payment_tool_id', async () => {
    const { service, hookModel } = buildService(fixtures());
    // All-or-nothing: two perfectly good OAs are refused along with the bad one.
    await expect(
      service.bulkUpdateHookPayment(
        { ids: [OA_READY, OA_READY_2, OA_UNBOUND], value: true },
        CTX,
      ),
    ).rejects.toBeInstanceOf(BlockedHooksException);
    // ⚠️ The point of all-or-nothing: NOTHING was written, not even the OAs
    // that would have passed.
    expect(hookModel.writes).toHaveLength(0);
    expect(
      hookModel.docs.every((d) => d['payment_tool_status'] === false),
    ).toBe(true);
  });

  it('names the offending OAs in the existing `blocked` 403 contract', async () => {
    const { service } = buildService(fixtures());
    // A NEW USE of the existing shape, not a new pattern — same exception the
    // group-access failure throws, so the dashboard renders it unchanged.
    const err = await service
      .bulkUpdateHookPayment(
        { ids: [OA_READY, OA_UNBOUND, OA_GENERIC], value: true },
        CTX,
      )
      .catch((e: unknown) => e as BlockedHooksException);
    expect(err).toBeInstanceOf(BlockedHooksException);
    const blocked = (err as BlockedHooksException).blocked;
    // Only the unready ones are listed — the operator learns exactly what to fix.
    expect(blocked.map((b) => b.alias).sort()).toEqual([
      'shop-generic',
      'shop-unbound',
    ]);
    // Every entry carries a per-OA reason; the class message stays the ported
    // legacy string, so the reason is where the real cause lives.
    expect(blocked.every((b) => Boolean(b.reason))).toBe(true);
  });

  it('refuses an OA whose tool was deleted or switched off (dangling id)', async () => {
    const { service } = buildService(fixtures());
    const err = await service
      .bulkUpdateHookPayment({ ids: [OA_DANGLING], value: true }, CTX)
      .catch((e: unknown) => e as BlockedHooksException);
    expect(err).toBeInstanceOf(BlockedHooksException);
    expect((err as BlockedHooksException).blocked[0]?.alias).toBe(
      'shop-dangling',
    );
  });

  it('refuses an OA bound to a tool that is not category "payment"', async () => {
    const { service } = buildService(fixtures());
    const err = await service
      .bulkUpdateHookPayment({ ids: [OA_GENERIC], value: true }, CTX)
      .catch((e: unknown) => e as BlockedHooksException);
    expect(err).toBeInstanceOf(BlockedHooksException);
    // A generic tool resolves to null in the runner exactly like a missing one.
    expect((err as BlockedHooksException).blocked[0]?.reason).toContain(
      'payment',
    );
  });
});

describe('[PAYTOOL-P4b] payment/bulk — the kill switch is never blocked', () => {
  it('turning OFF skips the readiness check entirely (deliberate asymmetry)', async () => {
    // Every one of these OAs would be REFUSED on the ON path. Switching off
    // must still work: a kill switch that a misconfigured OA can reject is not
    // a kill switch. ปิดต้องได้เสมอ.
    const docs = fixtures().map((d) => ({ ...d, payment_tool_status: true }));
    const { service, hookModel, toolLookups } = buildService(docs);
    const res = await service.bulkUpdateHookPayment(
      { ids: [OA_UNBOUND, OA_DANGLING, OA_GENERIC], value: false },
      CTX,
    );
    expect(res['success']).toBe(true);
    expect(res['modified']).toBe(3);
    // Not one tool was even looked up on the OFF path.
    expect(toolLookups).toHaveLength(0);
    expect(
      hookModel.docs
        .filter((d) => d['_id'] !== OA_READY && d['_id'] !== OA_READY_2)
        .every((d) => d['payment_tool_status'] === false),
    ).toBe(true);
  });
});

describe('[PAYTOOL-P4b] payment/bulk — contract shared with the sibling bulk routes', () => {
  it('rejects a non-boolean value — "false" must never enable payment', async () => {
    const { service, hookModel } = buildService(fixtures());
    // The string "false" is truthy. Coercing it would ENABLE an OA the operator
    // was trying to kill — matches bulkUpdateHookHandoff's guard verbatim.
    for (const bad of ['false', 'true', 1, 0, null]) {
      await expect(
        service.bulkUpdateHookPayment({ ids: [OA_READY], value: bad }, CTX),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(hookModel.writes).toHaveLength(0);
  });

  it('rejects an empty id list before anything else', async () => {
    const { service } = buildService(fixtures());
    await expect(
      service.bulkUpdateHookPayment({ ids: [], value: true }, CTX),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is idempotent — a repeat call writes nothing and audits nothing', async () => {
    const docs = fixtures().map((d) =>
      d['_id'] === OA_READY ? { ...d, payment_tool_status: true } : d,
    );
    const { service, hookModel, audits } = buildService(docs);
    const res = await service.bulkUpdateHookPayment(
      { ids: [OA_READY], value: true },
      CTX,
    );
    expect(res['modified']).toBe(0);
    expect(hookModel.writes).toHaveLength(0);
    // No false trail entry against an OA that did not move — the precedent
    // bulkUpdateHookHandoff sets deliberately.
    expect(audits).toHaveLength(0);
  });

  it('evicts the hook cache for every touched hook, with previousAlias', async () => {
    // Mandatory, not an optimisation: an in-flight webhook would otherwise keep
    // reading the OLD payment_tool_status from L1/L2 until the TTL expired.
    const { service, cached } = buildService(fixtures());
    await service.bulkUpdateHookPayment(
      { ids: [OA_READY, OA_READY_2], value: true },
      CTX,
    );
    expect(cached).toHaveLength(2);
    expect(cached.map((c) => c.previousAlias).sort()).toEqual([
      'shop-ready',
      'shop-ready-2',
    ]);
    // The cached copy carries the NEW value, not the stale one.
    expect(cached.every((c) => c.status === true)).toBe(true);
  });

  it('writes one audit row per hook that actually moved', async () => {
    const { service, audits } = buildService(fixtures());
    await service.bulkUpdateHookPayment(
      { ids: [OA_READY, OA_READY_2], value: true },
      CTX,
    );
    expect(audits).toHaveLength(2);
    const changed = audits[0]?.['changed_fields'] as Record<string, unknown>[];
    expect(changed[0]?.['field']).toBe('payment_tool_status');
    expect(changed[0]?.['from']).toBe(false);
    expect(changed[0]?.['to']).toBe(true);
  });

  it('does not require confirm:true, matching the sibling bulk routes', async () => {
    // Only cloneHookSettings demands confirmation; it overwrites many unrelated
    // settings irreversibly. This writes one boolean the same route can undo.
    const { service } = buildService(fixtures());
    const res = await service.bulkUpdateHookPayment(
      { ids: [OA_READY], value: true },
      CTX,
    );
    expect(res['success']).toBe(true);
  });
});
