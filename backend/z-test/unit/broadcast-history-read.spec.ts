/**
 * [FEAT-20260823-BCASTHISTREAD] Reading the run record back out.
 * ===========================================================================
 * Rows have been written on every run since 22/08 and NOTHING read them: there
 * was no endpoint, so a run's own measurements lived in Mongo and reached no
 * screen. A counter nobody can read is a counter nobody kept.
 *
 * 🔴 THE ONE THING THIS FILE EXISTS TO PROTECT: `images_replaced` distinguishes
 *    **absent = nobody looked** from **0 = looked, none broken**. The schema
 *    gives it no default precisely so that difference survives, and the
 *    obvious-looking `row.images_replaced ?? 0` in a reader throws it away —
 *    every dry-run row would then claim every picture was fine. The `??` that
 *    reads as tidy defensive code IS the bug.
 *    เติม 0 ให้ค่าที่ไม่มี = โกหกว่าเคยตรวจแล้ว.
 */
import {
  BroadcastHistoryReadService,
  HISTORY_READ_COLUMNS,
  historyOfJobQuery,
  toHistoryReadRow,
} from '@/modules/content';

const ROW = {
  run_id: 'run-1',
  hook_id: 'h1',
  hook_alias: 'OA One',
  matched: 10,
  targeted: 8,
  sent: 7,
  failed: 1,
  unsent: 2,
  requests_planned: 1,
  requests_made: 1,
  chunks_planned: 1,
  chunks_done: 1,
  status: 'partial',
  started_at: new Date('2026-08-22T10:00:00Z'),
  finished_at: new Date('2026-08-22T10:00:09Z'),
};

describe('images_replaced — absent and 0 are different answers', () => {
  it('🔴 a row that measured NOTHING comes back with no field at all', () => {
    const out = toHistoryReadRow({ ...ROW });
    expect(out).not.toHaveProperty('images_replaced');
  });

  it('🔴 a measured 0 comes back as 0, not as absent', () => {
    const out = toHistoryReadRow({ ...ROW, images_replaced: 0 });
    expect(out.images_replaced).toBe(0);
  });

  it('a real count comes through', () => {
    expect(
      toHistoryReadRow({ ...ROW, images_replaced: 3 }).images_replaced,
    ).toBe(3);
  });
});

describe('unknown_tags — absent, empty and full are three answers', () => {
  it('🔴 a run that rendered nothing has NO field', () => {
    /* Not `[]`. An empty array says "we looked and every tag resolved", which
       about a run that never rendered is a lie. ไม่ได้เรนเดอร์ ≠ tag ครบดี. */
    expect(toHistoryReadRow({ ...ROW })).not.toHaveProperty('unknown_tags');
  });

  it('🔴 an EMPTY array survives — it is a real answer', () => {
    /* The easy bug: `raw.unknown_tags?.length ? ... : {}` drops `[]` and turns
       "rendered, all fine" back into "never measured". */
    const out = toHistoryReadRow({ ...ROW, unknown_tags: [] });
    expect(out).toHaveProperty('unknown_tags');
    expect(out.unknown_tags).toEqual([]);
  });

  it('the tag names come through', () => {
    const out = toHistoryReadRow({
      ...ROW,
      unknown_tags: ['profile.bank_code', 'member.nickname'],
    });
    expect(out.unknown_tags).toEqual(['profile.bank_code', 'member.nickname']);
  });

  it('a non-array is treated as absent, not as garbage', () => {
    expect(
      toHistoryReadRow({ ...ROW, unknown_tags: 'profile.x' }),
    ).not.toHaveProperty('unknown_tags');
  });

  it('🔴 it is in the column whitelist, or the read never sees it', () => {
    expect(HISTORY_READ_COLUMNS).toHaveProperty('unknown_tags');
  });
});

describe('the ordinary counters DO default — the schema gives them one', () => {
  it('a row predating a counter reads it as 0, which is honest there', () => {
    const { sent, failed, ...rest } = ROW;
    void sent;
    void failed;
    const out = toHistoryReadRow(rest);
    expect(out.sent).toBe(0);
    expect(out.failed).toBe(0);
  });

  it('a non-number never leaks through as a string', () => {
    const out = toHistoryReadRow({ ...ROW, sent: '7' });
    expect(out.sent).toBe(0);
  });
});

describe('recipient state never leaves the collection', () => {
  it('🔴 the column whitelist excludes the resume bookkeeping', () => {
    /* `recipients_captured` is a Mixed map that grows with the audience, and
       `resume_after_id` / `next_chunk_index` are the resume machinery's own
       state — none of them answer "what happened". A whitelist also means a
       column added later stays invisible until somebody chooses to expose it,
       which is the safe direction for a collection that touches recipients. */
    for (const banned of [
      'recipients_captured',
      'resume_after_id',
      'next_chunk_index',
    ]) {
      expect(HISTORY_READ_COLUMNS).not.toHaveProperty(banned);
    }
  });

  it('🔴 and a row carrying them does not pass them on', () => {
    const out = toHistoryReadRow({
      ...ROW,
      recipients_captured: { chunk0: true },
      resume_after_id: 'abc',
      next_chunk_index: 4,
    }) as unknown as Record<string, unknown>;
    expect(out['recipients_captured']).toBeUndefined();
    expect(out['resume_after_id']).toBeUndefined();
    expect(out['next_chunk_index']).toBeUndefined();
  });
});

describe('optional text fields say nothing rather than empty string', () => {
  it('an absent stop_reason is absent, not ""', () => {
    const out = toHistoryReadRow({ ...ROW });
    expect(out).not.toHaveProperty('stop_reason');
  });

  it('an empty stored string is treated as absent too', () => {
    /* `''` in one of these means "never set" — forwarding it would put an
       empty cell in the table where "—" belongs. */
    const out = toHistoryReadRow({ ...ROW, error_message: '' });
    expect(out).not.toHaveProperty('error_message');
  });

  it('a real reason comes through', () => {
    const out = toHistoryReadRow({ ...ROW, stop_reason: 'oa-quota' });
    expect(out.stop_reason).toBe('oa-quota');
  });

  it('an unknown status is named, never blanked', () => {
    expect(toHistoryReadRow({ ...ROW, status: undefined }).status).toBe(
      'unknown',
    );
  });
});

describe('the query matches the index that exists', () => {
  it('🔴 sorts on started_at, which is half of the compound index', () => {
    /* `{broadcast_id: 1, started_at: -1}` is declared on the schema. Sorting on
       `_id` instead would compile, return almost the same order, and stop
       using that index. เรียงผิดคีย์ = index ที่มีอยู่ไม่ถูกใช้. */
    const q = historyOfJobQuery('job1');
    expect(q.filter).toEqual({ broadcast_id: 'job1' });
    expect(q.sort).toEqual({ started_at: -1 });
  });

  it('newest first — an admin opens this to see the last run', () => {
    expect(historyOfJobQuery('j').sort['started_at']).toBe(-1);
  });
});

/* ── the service: what an admin's request really does ────────────────────── */

const ID = 'a0d000000000000000000012';

const chain = (rows: unknown[]) => ({
  select: () => chain(rows),
  sort: () => chain(rows),
  skip: () => chain(rows),
  limit: () => chain(rows),
  lean: () => chain(rows),
  exec: () => Promise.resolve(rows),
});
const one = (row: unknown) => ({
  select: () => one(row),
  lean: () => one(row),
  exec: () => Promise.resolve(row),
});

function makeService(job: unknown = { _id: ID }, rows: unknown[] = [ROW]) {
  const seen: { find: unknown[]; skip: number[]; limit: number[] } = {
    find: [],
    skip: [],
    limit: [],
  };
  const historyModel = {
    find: (f: unknown) => {
      seen.find.push(f);
      const c: Record<string, unknown> = {
        select: () => c,
        sort: () => c,
        skip: (n: number) => {
          seen.skip.push(n);
          return c;
        },
        limit: (n: number) => {
          seen.limit.push(n);
          return c;
        },
        lean: () => c,
        exec: () => Promise.resolve(rows),
      };
      return c;
    },
    countDocuments: () => ({ exec: () => Promise.resolve(rows.length) }),
  };
  const service = new BroadcastHistoryReadService(
    { findOne: () => one(job) } as never,
    historyModel as never,
    {} as never,
    /* [FEAT-20260824-RUNDETAIL] the webhook_log model. Every case here reads the
         history LIST, which never touches it — an empty answer proves that
         rather than assuming it. ไม่มีเคสไหนควรแตะ log ⇒ ตอบว่างไว้ให้ฟ้อง. */
    {
      find: () => ({
        select: () => ({
          sort: () => ({
            limit: () => ({
              lean: () => ({ exec: () => Promise.resolve([]) }),
            }),
          }),
        }),
      }),
    } as never,
  );
  return { service, seen };
}

describe('history endpoint — reads, and only reads', () => {
  it('🔴 a job that never ran answers an EMPTY page, not a 404', async () => {
    const { service } = makeService({ _id: ID }, []);
    const out = await service.historyOf(ID);
    expect(out.data).toEqual([]);
    expect(out.meta.total).toBe(0);
  });

  it('🔴 a job that does NOT EXIST is a 404 — a different answer', async () => {
    /* An empty list cannot tell "never ran" from "no such job", and the admin
       would sit waiting for a run that can never happen.
       ไม่มีงาน กับ ยังไม่เคยรัน คนละเรื่อง. */
    const { service } = makeService(null);
    await expect(service.historyOf(ID)).rejects.toThrow(/not found/i);
  });

  it('a malformed id is refused before any read', async () => {
    const { service } = makeService();
    await expect(service.historyOf('nope')).rejects.toThrow(
      /Invalid broadcast identifier/,
    );
  });

  it('🔴 never writes — the model it holds is asked to find and count only', async () => {
    const touched: string[] = [];
    const trap = new Proxy(
      {
        find: () => chain([ROW]),
        countDocuments: () => ({ exec: () => Promise.resolve(1) }),
      },
      {
        get(t, prop: string) {
          touched.push(prop);
          return (t as Record<string, unknown>)[prop];
        },
      },
    );
    const svc = new BroadcastHistoryReadService(
      { findOne: () => one({ _id: ID }) } as never,
      trap as never,
      {} as never,
      /* [FEAT-20260824-RUNDETAIL] the webhook_log model. Every case here reads the
         history LIST, which never touches it — an empty answer proves that
         rather than assuming it. ไม่มีเคสไหนควรแตะ log ⇒ ตอบว่างไว้ให้ฟ้อง. */
      {
        find: () => ({
          select: () => ({
            sort: () => ({
              limit: () => ({
                lean: () => ({ exec: () => Promise.resolve([]) }),
              }),
            }),
          }),
        }),
      } as never,
    );
    await svc.historyOf(ID);
    expect([...new Set(touched)].sort()).toEqual(['countDocuments', 'find']);
  });
});

describe('history endpoint — paging is bounded', () => {
  it('defaults to page 1', async () => {
    const { service, seen } = makeService();
    await service.historyOf(ID);
    expect(seen.skip).toEqual([0]);
    expect(seen.limit).toEqual([25]);
  });

  it('🔴 an absurd limit is clamped — one request cannot ask for everything', async () => {
    const { service, seen } = makeService();
    await service.historyOf(ID, { limit: '99999' });
    expect(seen.limit).toEqual([200]);
  });

  it('garbage paging falls back instead of producing NaN', async () => {
    const { service, seen } = makeService();
    await service.historyOf(ID, { page: 'x', limit: 'y' });
    expect(seen.skip).toEqual([0]);
    expect(seen.limit).toEqual([25]);
  });

  it('page 3 skips the first two pages', async () => {
    const { service, seen } = makeService();
    await service.historyOf(ID, { page: '3', limit: '10' });
    expect(seen.skip).toEqual([20]);
  });

  it('page 0 and negatives clamp to the first page', async () => {
    const { service, seen } = makeService();
    await service.historyOf(ID, { page: '-4' });
    expect(seen.skip).toEqual([0]);
  });
});
