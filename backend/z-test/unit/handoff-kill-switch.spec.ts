/**
 * Pins the per-OA handoff kill switch: PATCH /hook/handoff/bulk.
 *
 * WHAT THESE TESTS ESTABLISH, AND WHAT THEY DO NOT
 * They prove the endpoint drives the DATABASE to the right state — which
 * bindings flip, which are left alone, and that the two targets never diverge.
 * They do NOT prove a disabled OA stops dispatching: the runtime gate
 * (`oaEnabled` / `eligibleTargets` / `enqueue`, ~817 lines in legacy) is not
 * ported into this codebase yet. `scope.bindings[].enabled` is the flag that
 * gate reads, so writing it correctly is necessary but not sufficient. Do not
 * read a green run here as "handoff is off end to end".
 *
 * THE INVARIANT UNDER TEST (stated by the owner)
 *   "Bind ต้องเหมือนกันตลอด · OA ที่จะใช้ได้จะเท่ากัน ·
 *    จะไม่มี OA ที่ขาด handoff ตัวใดตัวนึง · จะไม่มี OA ผสม"
 * `topup` and `walletpay` always carry identical bindings, so a flip must land on
 * every target at once. A half-applied flip — an OA off on one target and on
 * for the other — is the worst outcome available here, so it is asserted after
 * every mutation rather than only at the end.
 *
 * No I/O: an in-memory double stands in for the Mongoose model and applies the
 * same `arrayFilters` semantics the real `updateMany` does.
 */
/*
 * Leaf import, not the barrel: '@/modules/handoff' re-exports handoff.module.ts,
 * which drags the whole Nest graph into a test that needs one class and no I/O.
 */
// eslint-disable-next-line no-restricted-imports
import { HandoffBindingSwitchService } from '@/modules/handoff/handoff-binding-switch.service';

type Binding = { hook_id: string; enabled?: boolean };
type TargetDoc = {
  key: string;
  scope: { bindings: Binding[] };
  deleted_at: null;
};

const A1 = 'a0d00000000000000000003b';
const A2 = 'a0d000000000000000000059';
const B1 = 'a0d00000000000000000005a';
const UNBOUND = 'a0d00000000000000000005b';

/** 24-hex ids so `Types.ObjectId.isValid` accepts them. */
const hex = (s: string): string => s;

/**
 * Minimal stand-in for `Model<HandoffTarget>`.
 *
 * Implements only `find().select().lean().exec()` and `updateMany()`, applying
 * the same positional-filter semantics as MongoDB: a binding flips only when it
 * matches BOTH the id list and `enabled !== value`.
 */
function fakeModel(docs: TargetDoc[]) {
  return {
    find(selector: Record<string, unknown>) {
      const elem = (
        selector['scope.bindings'] as {
          $elemMatch: {
            hook_id: { $in: unknown[] };
            enabled: { $ne: boolean };
          };
        }
      ).$elemMatch;
      const ids = elem.hook_id.$in.map(String);
      const value = elem.enabled.$ne;
      const matched = docs.filter((d) =>
        d.scope.bindings.some(
          (b) =>
            ids.includes(String(b.hook_id)) && (b.enabled ?? true) !== value,
        ),
      );
      return {
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(matched) }),
        }),
      };
    },
    updateMany(
      _selector: Record<string, unknown>,
      _update: Record<string, unknown>,
      options: { arrayFilters: Array<Record<string, unknown>> },
    ) {
      const filter = options.arrayFilters[0] as {
        'b.hook_id': { $in: unknown[] };
        'b.enabled': { $ne: boolean };
      };
      const ids = filter['b.hook_id'].$in.map(String);
      const value = filter['b.enabled'].$ne;

      let modified = 0;
      for (const doc of docs) {
        let touched = false;
        for (const b of doc.scope.bindings) {
          if (
            ids.includes(String(b.hook_id)) &&
            (b.enabled ?? true) !== value
          ) {
            b.enabled = value;
            touched = true;
          }
        }
        if (touched) modified += 1;
      }
      return {
        exec: () =>
          Promise.resolve({ matchedCount: modified, modifiedCount: modified }),
      };
    },
  };
}

/** The two targets, bound to the same three OAs — the real-world shape. */
function seed(): TargetDoc[] {
  const bindings = (): Binding[] => [
    { hook_id: hex(A1), enabled: true },
    { hook_id: hex(A2), enabled: true },
    { hook_id: hex(B1), enabled: true },
  ];
  return [
    { key: 'topup', scope: { bindings: bindings() }, deleted_at: null },
    // Deliberately a DIFFERENT array order: the real documents store the same
    // OAs in different positions, so any comparison here must be order-blind.
    {
      key: 'walletpay',
      scope: { bindings: bindings().reverse() },
      deleted_at: null,
    },
  ];
}

/** Order-insensitive view of one target's bindings. */
const view = (doc: TargetDoc): string[] =>
  doc.scope.bindings.map((b) => `${b.hook_id}:${b.enabled ?? true}`).sort();

/** The invariant: the two targets must carry an identical binding set. */
const assertInvariant = (docs: TargetDoc[]): void => {
  const topup = docs.find((d) => d.key === 'topup')!;
  const walletpay = docs.find((d) => d.key === 'walletpay')!;
  expect(view(topup)).toEqual(view(walletpay));
};

const build = (docs: TargetDoc[]): HandoffBindingSwitchService =>
  new HandoffBindingSwitchService(fakeModel(docs) as never);

describe('handoff kill switch — binding writes', () => {
  it('turns every binding off across BOTH targets in one call', async () => {
    const docs = seed();
    assertInvariant(docs);

    const result = await build(docs).setBindingEnabledForHooks(
      [A1, A2, B1],
      false,
    );

    // 3 OAs x 2 targets = 6 bindings, 2 documents.
    expect(result.changedBindings).toBe(6);
    expect(result.modifiedTargets).toBe(2);
    expect(new Set(result.changedHookIds)).toEqual(new Set([A1, A2, B1]));
    for (const doc of docs) {
      expect(doc.scope.bindings.every((b) => b.enabled === false)).toBe(true);
    }
    assertInvariant(docs);
  });

  it('turns them back on', async () => {
    const docs = seed();
    const svc = build(docs);
    await svc.setBindingEnabledForHooks([A1, A2, B1], false);
    assertInvariant(docs);

    const result = await svc.setBindingEnabledForHooks([A1, A2, B1], true);

    expect(result.changedBindings).toBe(6);
    for (const doc of docs) {
      expect(doc.scope.bindings.every((b) => b.enabled === true)).toBe(true);
    }
    assertInvariant(docs);
  });

  it('is idempotent — a repeated call writes nothing the second time', async () => {
    const docs = seed();
    const svc = build(docs);

    const first = await svc.setBindingEnabledForHooks([A1], false);
    const second = await svc.setBindingEnabledForHooks([A1], false);

    expect(first.changedBindings).toBe(2);
    // The claim that matters: no write, so the caller records no audit row.
    expect(second.changedBindings).toBe(0);
    expect(second.modifiedTargets).toBe(0);
    expect(second.changedHookIds).toEqual([]);
    assertInvariant(docs);
  });

  it('flips ONE OA on every target, leaving the other OAs alone', async () => {
    const docs = seed();

    await build(docs).setBindingEnabledForHooks([A1], false);

    for (const doc of docs) {
      const byId = new Map(
        doc.scope.bindings.map((b) => [b.hook_id, b.enabled]),
      );
      expect(byId.get(A1)).toBe(false);
      expect(byId.get(A2)).toBe(true);
      expect(byId.get(B1)).toBe(true);
    }
    // The half-applied case this exists to catch: A1 must be off on BOTH.
    assertInvariant(docs);
  });

  it('NEVER creates a binding for an OA bound to nothing', async () => {
    const docs = seed();
    const before = docs.map((d) => d.scope.bindings.length);

    const result = await build(docs).setBindingEnabledForHooks(
      [UNBOUND],
      false,
    );

    // An unbound target already reaches nobody, so "off" is already the state.
    // Writing a row would change the document to express what it already says.
    expect(result.changedBindings).toBe(0);
    expect(docs.map((d) => d.scope.bindings.length)).toEqual(before);
    expect(
      docs.every((d) => !d.scope.bindings.some((b) => b.hook_id === UNBOUND)),
    ).toBe(true);
    assertInvariant(docs);
  });

  it('NEVER removes a binding row — it flags it, so config survives a round trip', async () => {
    const docs = seed();
    const svc = build(docs);

    await svc.setBindingEnabledForHooks([A1, A2, B1], false);

    // Still three rows per target while fully disabled: an operator can toggle
    // back without re-picking every OA.
    for (const doc of docs) expect(doc.scope.bindings).toHaveLength(3);

    await svc.setBindingEnabledForHooks([A1, A2, B1], true);
    for (const doc of docs) expect(doc.scope.bindings).toHaveLength(3);
    assertInvariant(docs);
  });

  it('treats a binding with no `enabled` field as enabled, not as off', async () => {
    // A row written before the field existed must not read as disabled, or a
    // kill switch would report "already off" and skip a live OA.
    const docs: TargetDoc[] = [
      {
        key: 'topup',
        scope: { bindings: [{ hook_id: A1 }] },
        deleted_at: null,
      },
      {
        key: 'walletpay',
        scope: { bindings: [{ hook_id: A1 }] },
        deleted_at: null,
      },
    ];

    const result = await build(docs).setBindingEnabledForHooks([A1], false);

    expect(result.changedBindings).toBe(2);
    expect(docs.every((d) => d.scope.bindings[0]?.enabled === false)).toBe(
      true,
    );
  });

  it('ignores malformed ids instead of writing on a guess', async () => {
    const docs = seed();

    const result = await build(docs).setBindingEnabledForHooks(
      ['not-an-objectid'],
      false,
    );

    expect(result.changedBindings).toBe(0);
    expect(
      docs.every((d) => d.scope.bindings.every((b) => b.enabled === true)),
    ).toBe(true);
  });

  it('reports only the OAs that actually moved, so the audit trail stays true', async () => {
    const docs = seed();
    const svc = build(docs);
    await svc.setBindingEnabledForHooks([A1], false);

    // A1 is already off; only A2 moves. Auditing both would record `from: true`
    // against an OA that was already false.
    const result = await svc.setBindingEnabledForHooks([A1, A2], false);

    expect(result.changedHookIds).toEqual([A2]);
    expect(result.changedBindings).toBe(2);
    assertInvariant(docs);
  });
});
