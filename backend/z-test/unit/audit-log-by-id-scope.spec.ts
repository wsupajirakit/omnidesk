/**
 * [FIX-20260819-AUDITREADSCOPE] `GET /audit/logs/:auditLogId` is scoped like the list.
 *
 * WHAT WAS WRONG. The single-row read was the only endpoint in `audit-log.controller.ts`
 * that never asked who was calling:
 *
 *     @Get('logs/:auditLogId')
 *     public async getLog(@Param('auditLogId') auditLogId: string) {
 *       return { data: await this.auditLogService.getAuditLogById(auditLogId) };
 *     }
 *
 * and the service behind it did `findById(id).lean()` with no scope argument at all
 * (`audit-log.service.ts:303-311`). The route sits behind the global JwtAuthGuard, so
 * "authenticated" was the ONLY gate: any operator who knew or guessed a 24-hex ObjectId
 * read any tenant's audit row — `changed_fields` included, which is where the before/after
 * values of every edit live.
 *
 * THE SIBLING IS THE SPEC. `listAuditLogs` in the SAME service already answers this
 * question (`audit-log.service.ts:231-253`): `isSuper = roleName === 'superadmin'` skips
 * the filter entirely, and everyone else is narrowed to
 * `group_id: { $in: [...their groups, null] }`. These cases pin the single-row read to
 * that same rule, field for field. Mirrored, not invented.
 *
 * THE THREE DECISIONS, STATED OUT LOUD (each one is the list's answer, not a new one):
 *
 *  1. THE TENANT FIELD IS `group_id`. Read off real rows, not off the source
 *     (`hook_audit_logs`, 937 rows: 509 carry a non-null `group_id`, 428 are null, 0 are
 *     missing the key). It is the field the list filters on, so it is the field this
 *     filters on.
 *
 *  2. A ROW WITH NO GROUP (`group_id: null` — 428 of 937) STAYS VISIBLE TO A GROUP-SCOPED
 *     CALLER, not only to a super user. That is what the list does, deliberately and with
 *     a comment saying so: "`null` is included so entries recorded without a group stay
 *     visible to group-scoped users, exactly as legacy does." Restricting null-group rows
 *     to supers here would be a DIFFERENT and stricter model than the list — it would hide
 *     rows from the single-row read that the list hands the same caller on the same screen.
 *     Mirroring wins.
 *
 *  3. A REFUSAL IS 404, NOT 403. `assertHookInScope` answers 403 for an OA, but it is
 *     answering about an id the caller already named and can see the existence of. Here the
 *     id IS the secret: a 403 on someone else's row and a 404 on a row that does not exist
 *     would turn this endpoint into an existence oracle over the whole collection —
 *     precisely the leak this fix closes. The list has no such tell (an out-of-scope row is
 *     simply absent), so the single-row read answers the one message it already had,
 *     'Audit log not found', for both cases. Refused and missing must be indistinguishable.
 *
 * A caller with NO groups reads nothing at all, including null-group rows — that is the
 * list's short-circuit (`normalizedGroupIds.length === 0` returns an empty page before the
 * `null` is ever added to the filter), reproduced as the same 404. Fail closed.
 */

import { AuditLogController } from '@/modules/audit';
import { AuditLogService } from '@/modules/audit';
import type { AuthenticatedUser } from '@/common';

const GROUP_A = 'a0d00000000000000000001e';
const GROUP_B = 'a0d00000000000000000001f';

const ROW_IN_A = 'a0d000000000000000000020';
const ROW_IN_B = 'a0d000000000000000000021';
const ROW_NO_GROUP = 'a0d000000000000000000022';
const ROW_ABSENT = 'a0d000000000000000000010';

/**
 * What a Mongo filter value can be here: a string id, a real `ObjectId` (which is what the
 * fixed service builds), or `null`. Typed rather than `unknown` so the comparison below is
 * a real `toString()` on a real value and not a blind `String(...)` over `any`.
 */
type Stringable = { toString: () => string } | string | null | undefined;

interface Row {
  _id: string;
  group_id: string | null;
  changed_fields: Array<{ field: string; from: string; to: string }>;
}

const ROWS: Row[] = [
  {
    _id: ROW_IN_A,
    group_id: GROUP_A,
    changed_fields: [{ field: 'alias', from: 'a-old', to: 'a-new' }],
  },
  {
    _id: ROW_IN_B,
    group_id: GROUP_B,
    // The payload that must not cross a tenant boundary.
    changed_fields: [{ field: 'alias', from: 'b-secret', to: 'b-secret-2' }],
  },
  { _id: ROW_NO_GROUP, group_id: null, changed_fields: [] },
];

/**
 * An in-memory stand-in for `Model<HookAuditLogDocument>` that answers BOTH
 * `findById(id)` and `findOne(filter)` over the same rows.
 *
 * Supporting both is the whole point: the pre-fix service calls `findById`, the fixed one
 * calls `findOne` with a filter. A stub that knew only one of them would make the pre-fix
 * run die on "findOne is not a function" — a red for the wrong reason, which proves nothing
 * about scoping. With both wired to the same evaluator the case goes red on the DEFECT
 * ITSELF: the row comes back to a caller from another tenant.
 */
function makeModel(): {
  model: unknown;
  filters: Array<Record<string, unknown>>;
} {
  const filters: Array<Record<string, unknown>> = [];

  // ObjectId | string | null all collapse to the same key, the way Mongo compares them
  // once the driver has cast the filter.
  const key = (value: Stringable): string | null =>
    value === null || value === undefined ? null : value.toString();

  const matches = (row: Row, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([field, condition]) => {
      const actual = field === '_id' ? row._id : row.group_id;
      // Only `$in` appears in this filter; anything else is a plain equality.
      if (condition && typeof condition === 'object' && '$in' in condition) {
        const wanted = (condition as { $in: Stringable[] }).$in.map(key);
        return wanted.includes(key(actual));
      }
      return key(actual) === key(condition as Stringable);
    });

  const lean = (row: Row | undefined) => ({
    lean: (): Promise<Row | null> => Promise.resolve(row ?? null),
  });

  const model = {
    findById: (id: unknown) => {
      filters.push({ _id: id });
      return lean(ROWS.find((r) => r._id === String(id)));
    },
    findOne: (filter: Record<string, unknown>) => {
      filters.push(filter);
      return lean(ROWS.find((r) => matches(r, filter)));
    },
  };

  return { model, filters };
}

const user = (roleName: string, groups: string[]): AuthenticatedUser =>
  ({
    userId: 'a0d00000000000000000000a',
    username: 'op',
    displayName: 'Operator',
    roleName,
    groups,
    allowedHooks: null,
  }) as unknown as AuthenticatedUser;

/**
 * Widened call signatures, on purpose — the same device
 * `audit-actor-authority.spec.ts` uses for the same reason. Against the UNCHANGED code both
 * of these take one argument, so a directly-typed two-argument call would fail to COMPILE
 * and the assertion would never run. This shape executes on both versions.
 */
type GetById = (id: string, scope: unknown) => Promise<unknown>;
type GetLog = (id: string, user: unknown) => Promise<{ data: unknown }>;

function makeService(): {
  service: AuditLogService;
  filters: Array<Record<string, unknown>>;
} {
  const { model, filters } = makeModel();
  return { service: new AuditLogService(model as never), filters };
}

const readAs = (
  service: AuditLogService,
  id: string,
  caller: AuthenticatedUser,
): Promise<unknown> =>
  (service.getAuditLogById.bind(service) as GetById)(id, {
    groupIds: caller.groups,
    roleName: caller.roleName ?? undefined,
  });

describe('[FIX-20260819-AUDITREADSCOPE] GET /audit/logs/:auditLogId is group-scoped', () => {
  it('a non-super caller in group A cannot read a row owned by group B', async () => {
    const { service } = makeService();

    await expect(
      readAs(service, ROW_IN_B, user('admin', [GROUP_A])),
    ).rejects.toThrow('Audit log not found');
  });

  it('the row content never reaches the wrong tenant', async () => {
    // The list already refuses to page this row to group A; the single-row read must not
    // be the back door that hands over the same `changed_fields`.
    const { service } = makeService();

    await expect(
      readAs(service, ROW_IN_B, user('admin', [GROUP_A])),
    ).rejects.toBeDefined();
  });

  it('the owning group still reads its own row, unchanged', async () => {
    const { service } = makeService();

    const row = (await readAs(
      service,
      ROW_IN_B,
      user('admin', [GROUP_B]),
    )) as Row;
    expect(row._id).toBe(ROW_IN_B);
    expect(row.changed_fields[0]).toEqual({
      field: 'alias',
      from: 'b-secret',
      to: 'b-secret-2',
    });
  });

  it('a superadmin still reads any row, from any group', async () => {
    const { service, filters } = makeService();

    const row = (await readAs(
      service,
      ROW_IN_B,
      user('superadmin', []),
    )) as Row;
    expect(row._id).toBe(ROW_IN_B);
    // Super is not merely allowed through — no group filter is applied at all,
    // exactly as `listAuditLogs` skips the block for `roleName === 'superadmin'`.
    expect(filters[0]).not.toHaveProperty('group_id');
  });

  it('a row with no group stays visible to a group-scoped caller (decision 2)', async () => {
    const { service } = makeService();

    const row = (await readAs(
      service,
      ROW_NO_GROUP,
      user('admin', [GROUP_A]),
    )) as Row;
    expect(row._id).toBe(ROW_NO_GROUP);
  });

  it('a caller with no groups reads nothing — not even a null-group row', async () => {
    const { service } = makeService();

    await expect(
      readAs(service, ROW_NO_GROUP, user('admin', [])),
    ).rejects.toThrow('Audit log not found');
  });

  it('refused and genuinely missing are indistinguishable (decision 3)', async () => {
    const { service } = makeService();
    const caller = user('admin', [GROUP_A]);

    const refused = await readAs(service, ROW_IN_B, caller).catch(
      (e: unknown) => e,
    );
    const missing = await readAs(service, ROW_ABSENT, caller).catch(
      (e: unknown) => e,
    );

    const shape = (e: unknown) => ({
      status: (e as { getStatus?: () => number }).getStatus?.(),
      message: (e as Error).message,
    });
    expect(shape(refused)).toEqual(shape(missing));
    expect(shape(refused).status).toBe(404);
  });

  it('the group filter is the list-endpoint filter, groups plus null', async () => {
    const { service, filters } = makeService();

    await readAs(service, ROW_IN_A, user('admin', [GROUP_A, GROUP_B]));

    const groupCondition = filters[0]?.['group_id'] as { $in: unknown[] };
    expect(groupCondition).toBeDefined();
    expect(
      (groupCondition.$in as Stringable[]).map((v) =>
        v === null || v === undefined ? null : v.toString(),
      ),
    ).toEqual([GROUP_A, GROUP_B, null]);
  });

  // ── the checks that already worked and must keep working ──────────────────
  it('id validation still comes first, before any scope work', async () => {
    const { service } = makeService();
    const caller = user('admin', [GROUP_A]);

    await expect(
      readAs(service, 'not-a-valid-object-id', caller),
    ).rejects.toThrow('Invalid audit log ID');
    await expect(readAs(service, '', caller)).rejects.toThrow(
      'audit log ID is required',
    );
  });

  it('the controller hands the caller identity to the service', async () => {
    const audit = {
      getAuditLogById: jest.fn().mockResolvedValue({ _id: ROW_IN_A }),
    };
    const controller = new AuditLogController(
      audit as never,
      {} as never,
      {} as never,
    );

    await (controller.getLog.bind(controller) as GetLog)(
      ROW_IN_A,
      user('admin', [GROUP_A]),
    );

    expect(audit.getAuditLogById).toHaveBeenCalledTimes(1);
    const [id, scope] = audit.getAuditLogById.mock.calls[0];
    expect(id).toBe(ROW_IN_A);
    expect(scope).toEqual({ groupIds: [GROUP_A], roleName: 'admin' });
  });

  it('an unauthenticated-shaped caller is scoped to nothing, never to everything', async () => {
    // Belt and braces: the guard already refuses these, but a `undefined` user must not
    // decay into "no filter" the way `null` does for `getAllowedHookIds`.
    const audit = { getAuditLogById: jest.fn().mockResolvedValue({}) };
    const controller = new AuditLogController(
      audit as never,
      {} as never,
      {} as never,
    );

    await (controller.getLog.bind(controller) as GetLog)(ROW_IN_A, undefined);

    expect(audit.getAuditLogById.mock.calls[0][1]).toEqual({
      groupIds: [],
      roleName: undefined,
    });
  });
});
