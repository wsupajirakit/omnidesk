/* [FEAT-20260829-MANUALFOLLOWSTAMP] stamping a follow-up time by hand
 * ===========================================================================
 * Owner 29/08: the two follow-up rows on the customer panel are pressable while
 * they read `n/a`, each behind its own confirm, and each press is audited.
 *
 * This file pins the decisions in `member-follow-stamp.helper.ts` that are easy
 * to undo by accident because each looks like a generalisation:
 *
 *   · the kind is an ALLOW-LIST of exactly two. `follow_up.line.*` also holds
 *     `notice_payment_at` and `request_reg_at`, which have their own writers and
 *     meanings; accepting a key off the wire would put them one typo away from
 *     being stamped by hand;
 *   · "empty" means missing OR null OR empty string — the same rule the screen
 *     uses to decide it should render `n/a`. Getting this wrong either hides the
 *     button where it belongs or silently overwrites a real record;
 *   · `changed_fields` must be an ARRAY, or `AuditLogService` refuses the row and
 *     the refusal disappears into the fire-and-forget catch. That exact mistake
 *     dropped every abandon-shield row for six days;
 *   · the audit must never reject — the value is already written by then.
 *
 * The helper takes its collaborators as arguments, so these are real calls.
 */
import {
  auditFollowStampSet,
  FOLLOW_STAMP_KEY_BY_KIND,
  FOLLOW_STAMP_KINDS,
  isFollowStampKind,
  readStoredStamp,
  stampIsEmpty,
  type FollowStampAuditWriter,
} from '@/modules/chat';

type Row = Record<string, unknown>;

const first = (rows: Row[]): Row => rows[0] ?? {};

const harness = (opts: { fail?: boolean } = {}) => {
  const rows: Row[] = [];
  const warnings: string[] = [];
  const audit: FollowStampAuditWriter = {
    createAuditLog: (payload) => {
      /* Faithful to the REAL gate in `hook-audit-log.service.ts`: a non-array
         `changed_fields` becomes `[]`, and an 'update' with no changes is
         REFUSED before any row is written. A permissive fake here is how the
         object-shape bug stayed green last time. */
      const changed = Array.isArray(payload.changed_fields)
        ? (payload.changed_fields as unknown[])
        : [];
      if (payload.action === 'update' && changed.length === 0) {
        return Promise.reject(new Error('update with no changed_fields'));
      }
      if (opts.fail) return Promise.reject(new Error('db down'));
      rows.push(payload);
      return Promise.resolve(payload);
    },
  };
  return {
    rows,
    warnings,
    deps: { audit, warn: (m: string) => warnings.push(m) },
  };
};

const auth = { userId: 'u1', username: 'cs_03', displayName: 'CS 03' } as never;

describe('the allow-list is the point', () => {
  it('accepts exactly the two kinds the owner asked for', () => {
    expect([...FOLLOW_STAMP_KINDS]).toEqual(['deposit', 'withdraw']);
  });

  it('maps each kind to the registry key that actually stores it', () => {
    expect(FOLLOW_STAMP_KEY_BY_KIND.deposit).toBe(
      'follow_up.line.notice_deposit_at',
    );
    expect(FOLLOW_STAMP_KEY_BY_KIND.withdraw).toBe(
      'follow_up.line.notice_withdraw_at',
    );
  });

  it('refuses the OTHER follow_up keys — they have their own writers', () => {
    expect(isFollowStampKind('payment')).toBe(false);
    expect(isFollowStampKind('notice_payment_at')).toBe(false);
    expect(isFollowStampKind('request_reg_at')).toBe(false);
    expect(isFollowStampKind('follow_up.line.notice_payment_at')).toBe(false);
  });

  it('refuses a raw config key, so no caller can name its own path', () => {
    expect(isFollowStampKind('follow_up.line.notice_deposit_at')).toBe(false);
  });

  it('refuses anything that is not a string', () => {
    [undefined, null, 0, 1, true, {}, [], ['deposit']].forEach((v) =>
      expect(isFollowStampKind(v)).toBe(false),
    );
  });

  it('accepts the two real ones', () => {
    expect(isFollowStampKind('deposit')).toBe(true);
    expect(isFollowStampKind('withdraw')).toBe(true);
  });
});

describe('"empty" matches what the screen calls n/a', () => {
  const withStamp = (value: unknown) => ({
    config: { follow_up: { line: { notice_deposit_at: value } } },
  });

  it('a member with no config at all is empty', () => {
    expect(stampIsEmpty({}, 'deposit')).toBe(true);
    expect(stampIsEmpty(null, 'deposit')).toBe(true);
    expect(stampIsEmpty(undefined, 'deposit')).toBe(true);
  });

  it('a half-built path is empty, not a crash', () => {
    expect(stampIsEmpty({ config: {} }, 'deposit')).toBe(true);
    expect(stampIsEmpty({ config: { follow_up: {} } }, 'deposit')).toBe(true);
    expect(
      stampIsEmpty({ config: { follow_up: { line: {} } } }, 'deposit'),
    ).toBe(true);
  });

  it('null and empty string are empty — the same rule the clearers use', () => {
    expect(stampIsEmpty(withStamp(null), 'deposit')).toBe(true);
    expect(stampIsEmpty(withStamp(''), 'deposit')).toBe(true);
  });

  it('a real date is NOT empty, so the route refuses to overwrite it', () => {
    expect(
      stampIsEmpty(withStamp(new Date('2026-08-22T16:30:00.000Z')), 'deposit'),
    ).toBe(false);
    expect(stampIsEmpty(withStamp('2026-08-22T16:30:00.000Z'), 'deposit')).toBe(
      false,
    );
  });

  it('reads each kind from its OWN key — one filled does not fill the other', () => {
    const member = {
      config: { follow_up: { line: { notice_deposit_at: new Date() } } },
    };
    expect(stampIsEmpty(member, 'deposit')).toBe(false);
    expect(stampIsEmpty(member, 'withdraw')).toBe(true);
  });

  it('returns the stored value, not just a boolean', () => {
    const at = new Date('2026-08-22T16:30:00.000Z');
    expect(readStoredStamp(withStamp(at), 'deposit')).toBe(at);
    expect(readStoredStamp({}, 'deposit')).toBeNull();
  });
});

describe('the audit row', () => {
  const at = new Date('2026-08-29T16:30:00.000Z');

  it('records the real key, from null, to the ISO time', () => {
    const h = harness();
    auditFollowStampSet({ memberId: 'm1', kind: 'deposit', at, auth }, h.deps);
    const row = first(h.rows);
    expect(row.ref_id).toBe('m1');
    expect(row.parent).toBe('line_user');
    expect(row.action).toBe('update');
    expect(row.changed_fields).toEqual([
      {
        field: 'follow_up.line.notice_deposit_at',
        from: null,
        to: '2026-08-29T16:30:00.000Z',
      },
    ]);
  });

  it('changed_fields is an ARRAY — an object would be refused and vanish', () => {
    const h = harness();
    auditFollowStampSet({ memberId: 'm1', kind: 'withdraw', at, auth }, h.deps);
    expect(Array.isArray(first(h.rows).changed_fields)).toBe(true);
    expect(h.warnings).toEqual([]);
  });

  it('names the actor so the trail can be read back', () => {
    const h = harness();
    auditFollowStampSet({ memberId: 'm1', kind: 'deposit', at, auth }, h.deps);
    expect(first(h.rows).actor).toEqual({
      user_id: 'u1',
      username: 'cs_03',
      display_name: 'CS 03',
    });
  });

  it('withdraw writes the withdraw key, not the deposit one', () => {
    const h = harness();
    auditFollowStampSet({ memberId: 'm1', kind: 'withdraw', at, auth }, h.deps);
    expect(
      (first(h.rows).changed_fields as { field: string }[])[0]?.field,
    ).toBe('follow_up.line.notice_withdraw_at');
  });

  it('writes nothing and warns when there is no actor', () => {
    const h = harness();
    auditFollowStampSet({ memberId: 'm1', kind: 'deposit', at }, h.deps);
    expect(h.rows).toHaveLength(0);
    expect(h.warnings.join(' ')).toContain('no actor');
  });

  it('never throws when the audit write fails — the value is already stored', () => {
    const h = harness({ fail: true });
    expect(() =>
      auditFollowStampSet(
        { memberId: 'm1', kind: 'deposit', at, auth },
        h.deps,
      ),
    ).not.toThrow();
  });
});
