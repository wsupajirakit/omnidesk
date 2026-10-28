/**
 * [FEAT-20260823-BCASTACTOR] Naming the admin behind a campaign.
 * ===========================================================================
 * A broadcast stored `created_by` as an ObjectId and every read handed that
 * straight out. An id answers "is this mine?" and nothing else — the question
 * an admin actually asks in a shared console is *who set this up*.
 *
 * 🔴 RESOLVED AT READ TIME, NOT DENORMALISED. A stored `created_by_name` would
 *    freeze the name as it was, so one admin who later renames themselves
 *    becomes two people across the list. The OPPOSITE is right for
 *    `broadcast_histories.triggered_by_name` and stays there: a history row
 *    records a moment, so the name as it WAS is the honest one.
 *    สองตาราง สองกฎ โดยตั้งใจ.
 *
 * 🔴 ONE QUERY PER PAGE. Resolving per row is an N+1 against `users` on every
 *    list load — the shape this file exists to prevent, not to introduce.
 */
import {
  BroadcastsService,
  NO_ACTOR_NAMES,
  actorNameOf,
  bestActorName,
  resolveActorNames,
} from '@/modules/content';

const users = [
  { _id: 'u1', username: 'admin.one', display_name: 'Admin One' },
  { _id: 'u2', username: 'admin.two', display_name: '' },
  { _id: 'u3', username: '', display_name: '' },
];

function fakeUserModel(rows = users) {
  const asked: unknown[] = [];
  const model = {
    find: (f: { _id?: { $in?: unknown[] } }) => {
      asked.push(f);
      const ids = f?._id?.$in;
      const out = Array.isArray(ids)
        ? rows.filter((u) => ids.includes(u._id))
        : rows;
      const c: Record<string, unknown> = {
        select: () => c,
        lean: () => c,
        exec: () => Promise.resolve(out),
      };
      return c;
    },
  };
  return { model, asked };
}

const row = (over: Record<string, unknown> = {}) => ({
  _id: 'b1',
  created_by: 'u1',
  updated_by: 'u1',
  ...over,
});

describe('bestActorName — display name first, username as the fallback', () => {
  it('prefers the display name', () => {
    expect(bestActorName(users[0] as never)).toBe('Admin One');
  });

  it('falls back to the username when there is no display name', () => {
    expect(bestActorName(users[1] as never)).toBe('admin.two');
  });

  it('🔴 never invents a name from the id', () => {
    /* An id rendered as a name reads like a person called `u3`. Absent is the
       honest answer, and the caller still has the id. */
    expect(bestActorName(users[2] as never)).toBeNull();
  });
});

describe('resolveActorNames — one query for the whole page', () => {
  it('🔴 asks ONCE, with every distinct id', async () => {
    /* Ten rows by two admins must be one query for two ids, not ten queries
       — nor one query for ten. ต่อหน้า ไม่ใช่ต่อแถว. */
    const { model, asked } = fakeUserModel();
    const rows = [
      row(),
      row({ created_by: 'u2', updated_by: 'u1' }),
      row({ created_by: 'u1', updated_by: 'u2' }),
    ];
    await resolveActorNames(model as never, rows);

    expect(asked).toHaveLength(1);
    const ids = (asked[0] as { _id: { $in: string[] } })._id.$in;
    expect([...ids].sort()).toEqual(['u1', 'u2']);
  });

  it('does not ask at all when no row names anyone', async () => {
    const { model, asked } = fakeUserModel();
    const out = await resolveActorNames(model as never, [
      { _id: 'b1' },
      { _id: 'b2', created_by: null },
    ]);
    expect(asked).toHaveLength(0);
    expect(out.size).toBe(0);
  });

  it('🔴 a lookup that THROWS costs the names, never the page', async () => {
    /* A list that refuses to load because a name could not be found is a worse
       answer than a list showing ids. อ่านชื่อไม่ได้ ≠ โหลดหน้าไม่ขึ้น. */
    const model = {
      find: () => {
        throw new Error('users unavailable');
      },
    };
    await expect(resolveActorNames(model as never, [row()])).resolves.toBe(
      NO_ACTOR_NAMES,
    );
  });

  it('no model at all is the same quiet answer', async () => {
    await expect(resolveActorNames(undefined, [row()])).resolves.toBe(
      NO_ACTOR_NAMES,
    );
  });

  it('an id with no matching user simply has no name', async () => {
    const { model } = fakeUserModel();
    const names = await resolveActorNames(model as never, [
      row({ created_by: 'deleted-account' }),
    ]);
    expect(actorNameOf(names, 'deleted-account')).toBeNull();
  });
});

describe('actorNameOf — what a row ends up carrying', () => {
  it('returns the resolved name', async () => {
    const { model } = fakeUserModel();
    const names = await resolveActorNames(model as never, [row()]);
    expect(actorNameOf(names, 'u1')).toBe('Admin One');
  });

  it('🔴 an unresolved id is null — NOT the id rendered as a name', () => {
    expect(actorNameOf(NO_ACTOR_NAMES, 'u1')).toBeNull();
  });

  it('an absent actor is null, not a crash', () => {
    expect(actorNameOf(NO_ACTOR_NAMES, undefined)).toBeNull();
    expect(actorNameOf(NO_ACTOR_NAMES, null)).toBeNull();
    expect(actorNameOf(NO_ACTOR_NAMES, {})).toBeNull();
  });
});

/* ── the row an admin actually receives ──────────────────────────────────── */

describe('sanitizeBroadcast — the name reaches the response', () => {
  /**
   * ⚠️ WRITTEN BECAUSE A MUTATION SURVIVED. Deleting the `created_by_name` line
   * from the response left every case above green: the resolver was proven and
   * the thing that USES it was not. A helper tested in isolation says nothing
   * about whether anyone calls it. เทส helper อย่างเดียว ไม่ได้แปลว่ามีคนเรียก.
   */
  const service = () =>
    new BroadcastsService(
      { findOne: () => ({ lean: () => Promise.resolve(null) }) } as never,
      {} as never,
      {} as never,
      {} as never,
      { safeDecrypt: (v: unknown) => v } as never,
      { createAuditLog: jest.fn() } as never,
    );

  const names: ReadonlyMap<string, string> = new Map([['u1', 'Admin One']]);
  const stored = {
    _id: 'b1',
    name: 'promo',
    status: 'draft',
    created_by: 'u1',
    updated_by: 'u1',
  };

  it('🔴 carries created_by_name and updated_by_name', () => {
    const out = service().sanitizeBroadcast(stored as never, names);
    expect(out?.created_by_name).toBe('Admin One');
    expect(out?.updated_by_name).toBe('Admin One');
  });

  it('🔴 keeps the RAW id alongside the name — the name is not a replacement', () => {
    /* The id is what a support ticket traces. Replacing it with a name would
       make two admins sharing a display name indistinguishable.
       ชื่อไว้ให้คนอ่าน · id ไว้ให้ตามเรื่อง ต้องมีทั้งคู่. */
    const out = service().sanitizeBroadcast(stored as never, names);
    expect(out?.created_by).toBe('u1');
  });

  it('an unresolved actor comes back as null, with the id still present', () => {
    const out = service().sanitizeBroadcast(
      { ...stored, created_by: 'gone' } as never,
      names,
    );
    expect(out?.created_by_name).toBeNull();
    expect(out?.created_by).toBe('gone');
  });

  it('a caller that passes no names still gets a usable row', () => {
    const out = service().sanitizeBroadcast(stored as never);
    expect(out?.created_by).toBe('u1');
    expect(out?.created_by_name).toBeNull();
  });
});
