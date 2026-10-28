/**
 * [PERF-20260826-TKTIMGENVELOPE] 📖 docs/bottleneck_26_aug.md (S1) — the list image read is bounded by the page's
 * own time envelope — and the attachments it returns do not move an inch.
 * ============================================================================
 * WHY THIS SPEC EXISTS. `enrichTicketRows` used to fire
 * `find({ room_id: {$in}, message_type: 'image' })` with NO time bound and no
 * limit, then discard almost everything against the per-ticket −10/+3 minute
 * window in memory. `ticket-image-index.spec.ts` records the measured cost of
 * this family of defect (1,812 messages read to keep 81) — that round fixed the
 * INDEX; the time bound was still missing, so a room whose customer sends
 * images daily paid for its whole history on every list request. The
 * single-ticket path (`populateAttachedFiles`) has carried exactly this bound
 * since legacy — the list path simply never received it.
 *
 * WHAT MAKES THE FIX PROVABLY INVISIBLE. The envelope is
 * [min(created_at) − 10 min, max(created_at) + 3 min] over the page's tickets —
 * the union of every per-ticket window. A message outside it is outside EVERY
 * ticket's window by construction, so the in-memory filter (untouched, still
 * the only thing that decides) would have dropped it anyway.
 * ครอบเท่าที่หน้าต้องใช้ · ตัวตัดสินตัวเดิมยังทำงานครบ ⇒ ผลลัพธ์เท่าเดิมทุกใบ.
 *
 * Harness style: Object.create(TicketsService.prototype) + captured model
 * calls — the same shape `no-case-room-count.spec.ts` uses.
 */
import { Types } from 'mongoose';

import { TicketsService } from '@/modules/tickets';

const MIN_BEFORE_MS = 10 * 60 * 1000; // must equal the per-ticket window below
const MIN_AFTER_MS = 3 * 60 * 1000; //   (tickets.service.ts, both call sites)

type Row = Record<string, unknown>;

/** Chainable model mocks that record the filter each find() was given. */
const build = (opts: {
  rooms: Row[];
  messages: Row[];
}): {
  svc: {
    enrichTicketRows: (
      t: Row[],
      h: Types.ObjectId[],
    ) => Promise<(Row | null)[]>;
  };
  seen: { imageFilter?: Record<string, unknown>; imageFindCalls: number };
} => {
  const seen: {
    imageFilter?: Record<string, unknown>;
    imageFindCalls: number;
  } = {
    imageFindCalls: 0,
  };
  const svc = Object.create(TicketsService.prototype) as Record<
    string,
    unknown
  >;
  svc['chatRoomModel'] = {
    find: () => ({ lean: () => Promise.resolve(opts.rooms) }),
  };
  svc['assignHistoryModel'] = {
    find: () => ({
      populate: () => ({
        populate: () => ({
          sort: () => ({ lean: () => Promise.resolve([]) }),
        }),
      }),
    }),
  };
  svc['chatMessageModel'] = {
    find: (filter: Record<string, unknown>) => {
      seen.imageFilter = filter;
      seen.imageFindCalls += 1;
      return {
        populate: () => ({ lean: () => Promise.resolve(opts.messages) }),
      };
    },
  };
  svc['customerTagModel'] = {
    find: () => ({
      select: () => ({
        populate: () => ({
          sort: () => ({ lean: () => Promise.resolve([]) }),
        }),
      }),
    }),
  };
  return {
    svc: svc as unknown as {
      enrichTicketRows: (
        t: Row[],
        h: Types.ObjectId[],
      ) => Promise<(Row | null)[]>;
    },
    seen,
  };
};

const HOOK = new Types.ObjectId();
const U1 = new Types.ObjectId();
const U2 = new Types.ObjectId();
const R1 = new Types.ObjectId();
const R2 = new Types.ObjectId();

const T1_AT = new Date('2026-08-26T10:00:00.000Z');
const T2_AT = new Date('2026-08-26T12:00:00.000Z');

const ticket = (id: string, user: Types.ObjectId, at: unknown): Row => ({
  _id: new Types.ObjectId(),
  job_status: 0,
  created_at: at,
  chat_user_id: { _id: user },
  hook_id: { _id: HOOK, display_name: `oa-${id}` },
});

const rooms: Row[] = [
  { _id: R1, user_id: U1, hook_id: HOOK },
  { _id: R2, user_id: U2, hook_id: HOOK },
];

const msg = (room: Types.ObjectId, at: Date, url: string): Row => ({
  room_id: room,
  created_at: at,
  message_type: 'image',
  internal_content_id: { _id: new Types.ObjectId(), image_url: url },
});

/** Everything the mock hands back — the DB filter is asserted separately, so the
 *  in-memory per-ticket window has to do ALL the keeping/dropping here. */
const MESSAGES: Row[] = [
  msg(R1, new Date(T1_AT.getTime() - 5 * 60 * 1000), '/u/in-t1.png'), //   inside t1's window
  msg(R2, new Date(T2_AT.getTime() + 2 * 60 * 1000), '/u/in-t2.png'), //   inside t2's window
  msg(R1, new Date(T1_AT.getTime() + 60 * 60 * 1000), '/u/between.png'), // inside envelope, outside BOTH windows
  msg(R1, new Date('2025-08-26T10:00:00.000Z'), '/u/ancient.png'), //      a year old — outside the envelope
];

/* [FIX-20260827-TSCINDEX] `Row | null | undefined`, widened to match what this
   helper ALREADY accepts at run time: the body reads `row?.[...] ?? []`, so an
   absent row was always handled. `enrichTicketRows` returns
   `Array<Record<string, unknown> | null>` (tickets.service.ts:321) and
   `noUncheckedIndexedAccess: true` (tsconfig.json:36) makes `out[0]` carry
   `| undefined` on top of that — so the four call sites below never matched the
   old, narrower signature. TYPE-ONLY: no assertion added, no behaviour changed.
   ห้ามใช้ `out[0]!` แทน — นั่นคือการ "ยืนยันว่ามีแถว" ซึ่งเป็นคนละความหมาย */
const urlsOf = (row: Row | null | undefined): string[] =>
  ((row?.['attached_files'] as Row[]) ?? []).map((f) => String(f['image_url']));

describe('⭐ the image query carries the page envelope', () => {
  it('created_at is bounded to [min−10min, max+3min] of the page tickets', async () => {
    const { svc, seen } = build({ rooms, messages: MESSAGES });
    await svc.enrichTicketRows(
      [ticket('a', U1, T1_AT), ticket('b', U2, T2_AT)],
      [HOOK],
    );

    expect(seen.imageFilter?.['created_at']).toEqual({
      $gte: new Date(T1_AT.getTime() - MIN_BEFORE_MS),
      $lte: new Date(T2_AT.getTime() + MIN_AFTER_MS),
    });
    // the two keys the index serves are untouched
    expect(seen.imageFilter?.['message_type']).toBe('image');
    expect(seen.imageFilter?.['room_id']).toEqual({ $in: [R1, R2] });
  });

  it('a page with no parseable created_at skips the image read outright', async () => {
    /* today every per-ticket window of such a page is NaN and keeps nothing, so
       reading the messages was already pure waste — skipping is byte-identical. */
    const { svc, seen } = build({ rooms, messages: MESSAGES });
    const out = await svc.enrichTicketRows(
      [ticket('x', U1, 'not-a-date')],
      [HOOK],
    );

    expect(seen.imageFindCalls).toBe(0);
    expect(urlsOf(out[0])).toEqual([]);
  });

  it('an unparseable created_at on ONE ticket neither poisons the envelope nor gains files', async () => {
    const { svc, seen } = build({ rooms, messages: MESSAGES });
    const out = await svc.enrichTicketRows(
      [ticket('a', U1, T1_AT), ticket('x', U2, 'not-a-date')],
      [HOOK],
    );

    expect(seen.imageFilter?.['created_at']).toEqual({
      $gte: new Date(T1_AT.getTime() - MIN_BEFORE_MS),
      $lte: new Date(T1_AT.getTime() + MIN_AFTER_MS),
    });
    expect(urlsOf(out[1])).toEqual([]); // NaN window keeps nothing — same as before
  });
});

describe('⭐ attached_files do not move — the per-ticket window still decides alone', () => {
  it('each ticket keeps exactly its own ±window, nothing from the rest of the envelope', async () => {
    const { svc } = build({ rooms, messages: MESSAGES });
    const out = await svc.enrichTicketRows(
      [ticket('a', U1, T1_AT), ticket('b', U2, T2_AT)],
      [HOOK],
    );

    expect(urlsOf(out[0])).toEqual(['/u/in-t1.png']); // between/ancient dropped in memory
    expect(urlsOf(out[1])).toEqual(['/u/in-t2.png']);
  });
});
