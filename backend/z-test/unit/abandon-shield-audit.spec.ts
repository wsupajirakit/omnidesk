/* [FEAT-20260821-ABANDONSHIELD] the audit row behind the shield
 * ===========================================================================
 * The shield on the ticket screen flips one boolean, and the owner asked for
 * that flip to be recorded: *"audit log เซฟด้วย"*. This file pins the three
 * decisions in `member-abandon-audit.helper.ts` that are easy to undo by
 * accident, because each of them looks like an improvement from the outside:
 *
 *   · it must NOT write when the value did not move — a row saying "changed"
 *     for a click that changed nothing is a false entry in a trail somebody
 *     will later use to reconstruct who did what;
 *   · it must NOT reject when the audit write fails — the column is ALREADY
 *     written by then, so failing here tells the operator their change did not
 *     happen when it did, and they click again;
 *   · `before === undefined` (every row that predates the column) must read as
 *     `false`, not as "unknown" — otherwise turning the shield off on a legacy
 *     row records `from: undefined` and the trail cannot be read back.
 *
 * The helper takes its collaborators as arguments, so these are real calls —
 * no source-grepping, no Nest container.
 */
import {
  auditAbandonShieldFlip,
  type AbandonAuditWriter,
} from '@/modules/chat';

type Row = Record<string, unknown>;

/** `noUncheckedIndexedAccess` is on — read row 0 without an assertion. */
const first = (rows: Row[]): Row => rows[0] ?? {};

const harness = (opts: { fail?: boolean } = {}) => {
  const rows: Row[] = [];
  const warnings: string[] = [];
  const audit: AbandonAuditWriter = {
    createAuditLog: (payload) => {
      /* [FIX-20260827-ABANDONAUDITSHAPE] faithful to the REAL gate
         (`hook-audit-log.service.ts` `create`): a non-array `changed_fields`
         is normalised to `[]` and an 'update' with no changes is REFUSED —
         before any row is written. The old fake accepted anything, which is
         exactly how the object-shape bug stayed green while the live DB held
         zero `parent: 'line_user'` rows. */
      const changed = Array.isArray(payload.changed_fields)
        ? (payload.changed_fields as unknown[])
        : [];
      if (payload.action === 'update' && changed.length === 0) {
        return Promise.reject(
          new Error('changed_fields is required for update'),
        );
      }
      rows.push(payload);
      return opts.fail
        ? Promise.reject(new Error('mongo is down'))
        : Promise.resolve(payload);
    },
  };
  return {
    rows,
    warnings,
    deps: { audit, warn: (m: string) => warnings.push(m) },
  };
};

const auth = {
  userId: 'u-1',
  username: 'someone',
  displayName: 'Someone',
} as never;

describe('⭐ a row is written only when the value actually moved', () => {
  it('⭐ off → on writes exactly one row', () => {
    const h = harness();
    auditAbandonShieldFlip(
      { memberId: 'm-1', before: false, after: true, auth },
      h.deps,
    );
    expect(h.rows).toHaveLength(1);
    expect(first(h.rows).changed_fields).toEqual([
      { field: 'ignore_abandon_assist', from: false, to: true },
    ]);
  });

  it('⭐ on → off writes exactly one row, the other way round', () => {
    const h = harness();
    auditAbandonShieldFlip(
      { memberId: 'm-1', before: true, after: false, auth },
      h.deps,
    );
    expect(h.rows).toHaveLength(1);
    expect(first(h.rows).changed_fields).toEqual([
      { field: 'ignore_abandon_assist', from: true, to: false },
    ]);
  });

  it('⭐ confirming the state it is already in writes NOTHING', () => {
    /* the modal lets an operator confirm either way — a no-op confirm must not
       leave a row claiming a change. */
    const h = harness();
    auditAbandonShieldFlip(
      { memberId: 'm-1', before: true, after: true, auth },
      h.deps,
    );
    auditAbandonShieldFlip(
      { memberId: 'm-1', before: false, after: false, auth },
      h.deps,
    );
    expect(h.rows).toHaveLength(0);
  });

  it('⭐ a legacy row (no column at all) counts as OFF, not as unknown', () => {
    /* `.lean()` does not apply schema defaults, so members created before this
       column read `undefined` forever. Turning the shield ON must record
       `from: false`; and a legacy row "set to off" is not a change at all. */
    const h = harness();
    auditAbandonShieldFlip(
      { memberId: 'm-1', before: undefined, after: true, auth },
      h.deps,
    );
    expect(first(h.rows).changed_fields).toEqual([
      { field: 'ignore_abandon_assist', from: false, to: true },
    ]);

    const h2 = harness();
    auditAbandonShieldFlip(
      { memberId: 'm-1', before: undefined, after: false, auth },
      h2.deps,
    );
    expect(h2.rows).toHaveLength(0);
  });

  it('⭐ only a real boolean true counts as on', () => {
    /* a string "true" arriving from anywhere must not read as on — the same
       trap the DTO hit, where `enableImplicitConversion` turned "false" into
       `true` before any validator ran. */
    for (const before of ['true', 1, {}, 'false', 0, null]) {
      const h = harness();
      auditAbandonShieldFlip(
        { memberId: 'm-1', before, after: false, auth },
        h.deps,
      );
      expect(h.rows).toHaveLength(0);
    }
  });
});

describe('⭐ the audit never breaks the request that carried it', () => {
  it('⭐ returns undefined — the caller cannot await it by mistake', () => {
    const h = harness();
    const out = auditAbandonShieldFlip(
      { memberId: 'm-1', before: false, after: true, auth },
      h.deps,
    );
    expect(out).toBeUndefined();
  });

  it('⭐ a failing audit write does not throw and does not reject', async () => {
    /* the column is already saved by the time this runs. เขียน audit พลาด
       ยอมได้ · บอกว่าเซฟไม่ได้ทั้งที่เซฟแล้ว ยอมไม่ได้. */
    const h = harness({ fail: true });
    expect(() =>
      auditAbandonShieldFlip(
        { memberId: 'm-1', before: false, after: true, auth },
        h.deps,
      ),
    ).not.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0] ?? '').toContain('mongo is down');
  });

  it('⭐ a request with no signed-in actor is warned about, not thrown', () => {
    /* `createAuditLog` throws on a missing actor; the route always has one, but
       losing the row still beats losing the response. */
    const h = harness();
    expect(() =>
      auditAbandonShieldFlip(
        { memberId: 'm-1', before: false, after: true },
        h.deps,
      ),
    ).not.toThrow();
    expect(h.rows).toHaveLength(0);
    expect(h.warnings[0] ?? '').toContain('no actor');
  });
});

describe('⭐ the row addresses the member, in the shape the FE precedent uses', () => {
  it('⭐ ref_id = the member id · parent says which collection', () => {
    /* `hook_audit_logs.ref_id` is a bare ObjectId with NO `ref`, so `parent` is
       the only thing saying what it points at. Both writers must agree, or the
       existing screen and this one file rows nobody can join back together. */
    const h = harness();
    auditAbandonShieldFlip(
      {
        memberId: 'a0d000000000000000000006',
        before: false,
        after: true,
        auth,
      },
      h.deps,
    );
    expect(first(h.rows)).toMatchObject({
      ref_id: 'a0d000000000000000000006',
      parent: 'line_user',
      action: 'update',
      actor: { user_id: 'u-1', username: 'someone', display_name: 'Someone' },
    });
  });
});
