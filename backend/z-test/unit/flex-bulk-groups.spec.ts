/**
 * [FEAT-20260830-FLEXBULKGROUPS] POST /api/flex-messages/bulk-groups.
 *
 * WHY THIS ENDPOINT EXISTS
 *   Moving twenty cards between network groups meant opening twenty forms. The
 *   dashboard already does this for users (`POST /api/users/bulk-permissions`)
 *   and for dynamic tags (`POST /api/dynamic-tags/bulk-scope`), so a client-side
 *   loop would have been the only inconsistent sibling — and would have put the
 *   scope check in the browser.
 *
 * WHAT IS PINNED
 *   TARGET  the write is REPLACE, the scope filter is applied to BOTH queries,
 *           an empty group list is refused, audit entries appear only for cards
 *           that actually changed, and cards the caller may not see come back as
 *           `skipped` rather than as an error.
 *   PIN     the route is not reachable without `flex.manage`, it answers 200 and
 *           not 201, and the batch never runs the hook grant.
 *
 * ⚠️ REPLACE, not merge, is the whole risk of this feature: "add" and "replace"
 * look identical until somebody loses access. The test states the semantic so a
 * future change to $addToSet is a red test, not a silent access change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';

import { FlexMessagesService } from '@/modules/content';

type Doc = Record<string, unknown>;

const oid = (n: number): string =>
  new mongoose.Types.ObjectId(String(n).padStart(24, '0')).toHexString();

const CARD_A = oid(1);
const CARD_B = oid(2);
const CARD_HIDDEN = oid(3);
const GROUP_OLD = oid(11);
const GROUP_NEW = oid(12);

interface Harness {
  svc: FlexMessagesService;
  finds: Doc[];
  writes: { filter: Doc; update: Doc }[];
  audits: Doc[];
}

/**
 * The service with fake models. `rows` is what the find is allowed to return —
 * the harness applies the service's own scope filter to it, so a test can prove
 * the filter reached the query instead of trusting that it did.
 */
const harness = (rows: Doc[]): Harness => {
  const finds: Doc[] = [];
  const writes: { filter: Doc; update: Doc }[] = [];
  const audits: Doc[] = [];
  const flexModel = {
    find: (f: Doc) => {
      finds.push(f);
      const scoped = f['group_ids']
        ? rows.filter((r) => {
            const wanted = (f['group_ids'] as { $in: unknown[] }).$in.map(
              String,
            );
            return ((r['group_ids'] as unknown[]) ?? [])
              .map(String)
              .some((g) => wanted.includes(g));
          })
        : rows;
      const ids = ((f['_id'] as { $in: unknown[] }).$in ?? []).map(String);
      return {
        lean: () =>
          Promise.resolve(scoped.filter((r) => ids.includes(String(r['_id'])))),
      };
    },
    updateOne: (filter: Doc, update: Doc) => {
      writes.push({ filter, update });
      return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
    },
  };
  const audit = {
    createAuditLog: (entry: Doc) => {
      audits.push(entry);
      return Promise.resolve(entry);
    },
  };
  const svc = new FlexMessagesService(
    flexModel as never,
    {} as never,
    {} as never,
    audit as never,
    {} as never,
  );
  return { svc, finds, writes, audits };
};

const META = { request_id: 'r1', ip: '127.0.0.1', user_agent: 'jest' };
/* `roleName`, and the value is `superadmin` — NOT `role: 'superuser'`.
   `SUPER_ROLE_NAMES` is exactly ['superadmin'] (src/common/auth/super-role.ts:32,
   decided from the real roles collection, where nothing matches /superuser/i).
   Getting this wrong makes the "superuser is not narrowed" cases pass for the
   wrong reason, so the fixture is pinned to the real field. */
const SUPER = {
  userId: oid(21),
  username: 'root',
  roleName: 'superadmin',
  groups: [],
} as never;
const MEMBER = {
  userId: oid(22),
  username: 'staff',
  roleName: 'admin',
  groups: [GROUP_OLD],
} as never;

const rowsForMember = (): Doc[] => [
  { _id: CARD_A, name: 'card A', group_ids: [GROUP_OLD] },
  { _id: CARD_B, name: 'card B', group_ids: [GROUP_OLD] },
  { _id: CARD_HIDDEN, name: 'not yours', group_ids: [oid(99)] },
];

describe('[FEAT-20260830-FLEXBULKGROUPS] the write', () => {
  it('TARGET 1: REPLACES group_ids on every matched card', async () => {
    const h = harness(rowsForMember());
    const out = await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A, CARD_B], group_ids: [GROUP_NEW] },
      SUPER,
      META,
    );
    expect(h.writes).toHaveLength(2);
    for (const w of h.writes) {
      const set = (w.update as { $set: Doc })['$set'];
      // $set, never $addToSet — the semantic the dialog warns about.
      expect(w.update['$addToSet']).toBeUndefined();
      expect((set['group_ids'] as unknown[]).map(String)).toEqual([GROUP_NEW]);
    }
    expect(out.matched).toBe(2);
    expect(out.modified).toBe(2);
    expect(out.group_ids).toEqual([GROUP_NEW]);
  });

  it('TARGET 2: ⭐⭐ the caller’s scope is applied to the READ and to every WRITE', async () => {
    const h = harness(rowsForMember());
    await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A, CARD_HIDDEN], group_ids: [GROUP_NEW] },
      MEMBER,
      META,
    );
    // read: the filter carries the group constraint …
    expect(h.finds[0]?.['group_ids']).toEqual({ $in: [GROUP_OLD] });
    // … and so does the write, closing the window between the two queries.
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.filter['group_ids']).toEqual({ $in: [GROUP_OLD] });
    expect(String(h.writes[0]?.filter['_id'])).toBe(CARD_A);
  });

  it('TARGET 3: a card outside the scope is SKIPPED, not an error', async () => {
    const h = harness(rowsForMember());
    const out = await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A, CARD_HIDDEN], group_ids: [GROUP_NEW] },
      MEMBER,
      META,
    );
    expect(out.matched).toBe(1);
    expect(out.skipped).toEqual([CARD_HIDDEN]);
    expect(out.updated).toEqual([{ id: CARD_A, name: 'card A' }]);
  });

  it('TARGET 4: a superuser is not narrowed by groups', async () => {
    const h = harness(rowsForMember());
    const out = await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A, CARD_HIDDEN], group_ids: [GROUP_NEW] },
      SUPER,
      META,
    );
    expect(h.finds[0]?.['group_ids']).toBeUndefined();
    expect(out.matched).toBe(2);
    expect(out.skipped).toEqual([]);
  });

  it('TARGET 5: deleted cards are never in range', async () => {
    const h = harness(rowsForMember());
    await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A], group_ids: [GROUP_NEW] },
      SUPER,
      META,
    );
    expect(h.finds[0]?.['deleted_at']).toEqual({ $exists: false });
  });
});

describe('[FEAT-20260830-FLEXBULKGROUPS] what it refuses', () => {
  const call = (body: { flex_ids: unknown[]; group_ids: unknown[] }) =>
    harness(rowsForMember()).svc.bulkUpdateGroups(body, SUPER, META);

  it('TARGET 6: ⭐⭐⭐ an EMPTY group list is refused — it would orphan the cards', async () => {
    /* group_ids: [] is a legal single-card write, but in bulk it strips every
       non-superuser's access with no screen left to undo it from. */
    await expect(call({ flex_ids: [CARD_A], group_ids: [] })).rejects.toThrow(
      /อย่างน้อย 1 กลุ่ม/,
    );
  });

  it('TARGET 7: an unparseable group id is a 400, never silently dropped', async () => {
    // ensureValidGroupIds drops what it cannot parse; dropping one here would
    // move the cards to a SMALLER scope than the operator ticked.
    await expect(
      call({ flex_ids: [CARD_A], group_ids: [GROUP_NEW, 'not-an-id'] }),
    ).rejects.toThrow(/Invalid group_ids/);
  });

  it('TARGET 8: an empty or malformed id list is a 400', async () => {
    await expect(
      call({ flex_ids: [], group_ids: [GROUP_NEW] }),
    ).rejects.toThrow(/flex_ids is required/);
    await expect(
      call({ flex_ids: ['nope'], group_ids: [GROUP_NEW] }),
    ).rejects.toThrow(/Invalid flex message id/);
  });

  it('TARGET 9: nothing matched at all is a 404', async () => {
    await expect(
      harness([]).svc.bulkUpdateGroups(
        { flex_ids: [CARD_A], group_ids: [GROUP_NEW] },
        SUPER,
        META,
      ),
    ).rejects.toThrow(/Flex message not found/);
  });
});

describe('[FEAT-20260830-FLEXBULKGROUPS] the audit trail', () => {
  it('TARGET 10: one entry per card whose scope actually changed', async () => {
    const h = harness([
      { _id: CARD_A, name: 'card A', group_ids: [GROUP_OLD] },
      // already in the target scope — re-running a batch must not log it again
      { _id: CARD_B, name: 'card B', group_ids: [GROUP_NEW] },
    ]);
    const out = await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A, CARD_B], group_ids: [GROUP_NEW] },
      SUPER,
      META,
    );
    expect(out.matched).toBe(2);
    expect(out.modified).toBe(1);
    expect(h.audits).toHaveLength(1);
    expect(String(h.audits[0]?.['ref_id'])).toBe(CARD_A);
    expect(h.audits[0]?.['parent']).toBe('flex_message');
    expect(h.audits[0]?.['action']).toBe('update');
    expect(h.audits[0]?.['changed_fields']).toEqual([
      { field: 'group_ids', from: [GROUP_OLD], to: [expect.anything()] },
    ]);
  });

  it('TARGET 11: order does not count as a change', async () => {
    const h = harness([
      { _id: CARD_A, name: 'card A', group_ids: [GROUP_NEW, GROUP_OLD] },
    ]);
    const out = await h.svc.bulkUpdateGroups(
      { flex_ids: [CARD_A], group_ids: [GROUP_OLD, GROUP_NEW] },
      SUPER,
      META,
    );
    expect(out.modified).toBe(0);
    expect(h.audits).toHaveLength(0);
  });
});

describe('[FEAT-20260830-FLEXBULKGROUPS] the route', () => {
  const src = (p: string): string =>
    readFileSync(join(__dirname, '../../src/modules/content', p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('PIN 1: guarded by flex.manage, answers 200, and is a POST', () => {
    const c = src('flex-messages.controller.ts');
    const route = c.slice(c.indexOf("@Post('flex-messages/bulk-groups')"));
    expect(route).toContain("@Post('flex-messages/bulk-groups')");
    expect(route.slice(0, 260)).toContain("@RequirePermissions('flex.manage')");
    expect(route.slice(0, 260)).toContain('@HttpCode(200)');
  });

  it('PIN 2: the batch never runs the hook grant', () => {
    /* updateFlexMessage ticks a card onto every hook in its groups when the
       caller sends grant_all_hooks. This route has no such field, so a bulk
       re-scope must not start granting hooks behind the operator's back. */
    const s = src('flex-messages.service.ts');
    const body = s.slice(
      s.indexOf('public async bulkUpdateGroups'),
      s.indexOf('public async deleteFlexMessage'),
    );
    expect(body.length).toBeGreaterThan(200);
    expect(body).not.toContain('grantFlexToHooks');
    expect(body).not.toContain('grant_all_hooks');
  });

  it('PIN 3: the bulk DTO carries the two arrays and nothing else', () => {
    const d = src('dto/flex-message.dto.ts');
    const cls = d.slice(d.indexOf('export class BulkFlexGroupsDto'));
    expect(cls).toContain('flex_ids!: unknown[]');
    expect(cls).toContain('group_ids!: unknown[]');
    expect(cls).not.toContain('content_json');
    expect(cls).not.toContain('grant_all_hooks');
  });
});
