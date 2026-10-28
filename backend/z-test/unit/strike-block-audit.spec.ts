/**
 * [FEAT-20260827-ADMINBLOCK] The audit rows for admin block / clear.
 * ===========================================================================
 * 📖 PLAN: `todo/task/27082026/todo8_27082026_admin-block-suspend.md`
 *
 * WHY THIS SUITE IS PICKY ABOUT `changed_fields` BEING AN ARRAY: the abandon
 * precedent (`chat/member-abandon-audit.helper.ts:83`) passes an OBJECT, and
 * `AuditLogService.createAuditLog` silently normalises anything non-array to
 * `[]` — then rejects `action: 'update'` with empty changes, the rejection is
 * swallowed by fire-and-forget, and the row NEVER LANDS (confirmed on the real
 * database 27/08: zero rows with parent `line_user`). This suite exists so the
 * strike rows cannot repeat that failure shape.
 * changed_fields ต้องเป็น array — เป็น object แล้วแถวหายเงียบทั้งใบ
 */
/* Through the barrel — a deep path into a module's internals is an eslint
   error by this repo's layering rule, tests included (see strike/index.ts). */
import { auditStrikeClear, auditStrikeSuspend } from '@/modules/strike';

import type { AuthenticatedUser } from '@/common';

const AUTH = {
  userId: 'a0d00000000000000000000e',
  username: 'admin',
  displayName: 'Administrator',
} as AuthenticatedUser;

const SESSION = {
  _id: 'a0d00000000000000000000f',
  line_user_id: 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1',
  seq: 1,
  status: 'open',
  strike_total: 0,
  by_level: {},
  opened_at: new Date('2026-08-27T10:00:00Z'),
  suspended_at: new Date('2026-08-27T10:00:05Z'),
  suspended_by: 'a0d00000000000000000000e',
  suspended_reason: 'Block จำกัดการคุย',
};

function writer() {
  const rows: Record<string, unknown>[] = [];
  return {
    rows,
    audit: {
      createAuditLog: (payload: Record<string, unknown>) => {
        rows.push(payload);
        return Promise.resolve(payload);
      },
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('auditStrikeSuspend — ใครกด block ให้ใคร', () => {
  it('writes one row: session id, actor by value, and ARRAY changed_fields', async () => {
    const w = writer();

    auditStrikeSuspend(
      { session: SESSION, auth: AUTH },
      { audit: w.audit, warn: () => undefined },
    );
    await flush();

    expect(w.rows).toHaveLength(1);
    const row = w.rows[0]!;
    expect(row).toMatchObject({
      ref_id: SESSION._id,
      parent: 'strike_session',
      action: 'update',
      actor: {
        user_id: AUTH.userId,
        username: 'admin',
        display_name: 'Administrator',
      },
    });
    // the member the block was FOR must be readable from the row itself
    expect(String(row['note'])).toContain(SESSION.line_user_id);
    /* 🔴 THE ARRAY ASSERTION — see the header. An object here means the row
       silently never lands in production. MUTATION: reshape to an object map
       and this goes red while everything else stays green. */
    expect(Array.isArray(row['changed_fields'])).toBe(true);
    const fields = (row['changed_fields'] as { field: string }[]).map(
      (c) => c.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        'suspended_at',
        'suspended_by',
        'suspended_reason',
      ]),
    );
  });

  it('no actor → no row, and the caller is warned rather than lied to', async () => {
    const w = writer();
    const warned: string[] = [];

    auditStrikeSuspend(
      { session: SESSION, auth: undefined },
      { audit: w.audit, warn: (m) => warned.push(m) },
    );
    await flush();

    expect(w.rows).toHaveLength(0);
    expect(warned).toHaveLength(1);
  });

  it('a failing audit write never rejects — fire-and-forget like every sibling', async () => {
    const warned: string[] = [];
    auditStrikeSuspend(
      { session: SESSION, auth: AUTH },
      {
        audit: {
          createAuditLog: () => Promise.reject(new Error('mongo is on fire')),
        },
        warn: (m) => warned.push(m),
      },
    );
    await flush();
    expect(warned).toHaveLength(1);
  });
});

describe('auditStrikeClear — ฝั่งยกเลิกต้องสมมาตร', () => {
  it('writes the clear row with the same shape and names the member', async () => {
    const w = writer();
    const closed = {
      ...SESSION,
      status: 'closed',
      closed_at: new Date('2026-08-27T11:00:00Z'),
      closed_reason: 'unblock',
    };

    auditStrikeClear(
      { session: closed, auth: AUTH },
      { audit: w.audit, warn: () => undefined },
    );
    await flush();

    expect(w.rows).toHaveLength(1);
    const row = w.rows[0]!;
    expect(row).toMatchObject({
      ref_id: SESSION._id,
      parent: 'strike_session',
      action: 'update',
    });
    expect(String(row['note'])).toContain(SESSION.line_user_id);
    expect(Array.isArray(row['changed_fields'])).toBe(true);
    const byField = Object.fromEntries(
      (
        row['changed_fields'] as {
          field: string;
          from?: unknown;
          to?: unknown;
        }[]
      ).map((c) => [c.field, c]),
    );
    expect(byField['status']).toMatchObject({ from: 'open', to: 'closed' });
  });
});
