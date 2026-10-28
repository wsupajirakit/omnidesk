/**
 * [FEAT-20260821-QUOTEREPLY] The two reads the send path needs, kept out of the
 * 2,000-line service:
 *   resolveQuoteToken  — `quote_of` (a chat_messages _id) → LINE quoteToken.
 *                        Column first; the 211 rows that predate the column still
 *                        carry it inside raw_content (owner: no backfill).
 *   findReplyCandidate — the newest inbound row in the room whose reply token
 *                        can still possibly work: present, < 60 s old, not spent.
 * Driven with a minimal model fake; the queries themselves are the assertion.
 */
import { Types } from 'mongoose';

import { findReplyCandidate, resolveQuoteToken } from '@/modules/chat';

const ROOM = new Types.ObjectId();
const id = () => new Types.ObjectId();

function model(rows: Record<string, unknown>[]) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    findOne: (q: Record<string, unknown>) => {
      calls.push(q);
      let sort: Record<string, 1 | -1> | null = null;
      const chain = {
        sort: (s: Record<string, 1 | -1>) => {
          sort = s;
          return chain;
        },
        select: () => chain,
        lean: () => {
          const match = rows.filter((r) =>
            Object.entries(q).every(([k, v]) => {
              const actual = r[k];
              if (v && typeof v === 'object' && '$nin' in v)
                return !(v as { $nin: unknown[] }).$nin.includes(
                  actual ?? null,
                );
              if (v && typeof v === 'object' && '$exists' in v)
                return (v as { $exists: boolean }).$exists === k in r;
              if (v && typeof v === 'object' && '$gte' in v)
                return (actual as Date) >= (v as { $gte: Date }).$gte;
              return String(actual) === String(v);
            }),
          );
          if (sort) {
            const [k, dir] = Object.entries(sort)[0]!;
            match.sort((a, b) =>
              (a[k] as Date) > (b[k] as Date) ? dir : -dir,
            );
          }
          return Promise.resolve(match[0] ?? null);
        },
      };
      return chain;
    },
  };
}

describe('resolveQuoteToken — column first, raw_content second, null never throws', () => {
  it('reads quote_token when the row has it', async () => {
    const m = model([{ _id: 'a', room_id: ROOM, quote_token: 'qt-col' }]);
    await expect(resolveQuoteToken(m as never, ROOM, 'a')).resolves.toEqual({
      quoteToken: 'qt-col',
      providerMsgId: null,
    });
  });

  it('falls back to raw_content.events[0].message.quoteToken for a pre-column row', async () => {
    const m = model([
      {
        _id: 'b',
        room_id: ROOM,
        provider_msg_id: '625',
        raw_content: {
          events: [{ message: { id: '625', quoteToken: 'qt-raw' } }],
        },
      },
    ]);
    await expect(resolveQuoteToken(m as never, ROOM, 'b')).resolves.toEqual({
      quoteToken: 'qt-raw',
      providerMsgId: '625',
    });
  });

  it('a row with neither → null (the caller sends without a quote, loudly)', async () => {
    const m = model([
      {
        _id: 'c',
        room_id: ROOM,
        raw_content: { events: [{ message: { id: '1' } }] },
      },
    ]);
    await expect(resolveQuoteToken(m as never, ROOM, 'c')).resolves.toBeNull();
  });

  it('is scoped to the room — a message id from another room resolves to nothing', async () => {
    const m = model([{ _id: 'd', room_id: id(), quote_token: 'qt-other' }]);
    await expect(resolveQuoteToken(m as never, ROOM, 'd')).resolves.toBeNull();
    expect(m.calls[0]).toMatchObject({ room_id: ROOM });
  });
});

describe('findReplyCandidate — newest inbound, alive, unspent; otherwise null', () => {
  const now = new Date('2026-08-21T12:00:00Z');
  const at = (secAgo: number) => new Date(now.getTime() - secAgo * 1000);

  it('returns the newest customer row with a fresh, unspent token', async () => {
    const m = model([
      {
        _id: 'old',
        room_id: ROOM,
        sender_type: 'customer',
        reply_token: 'rt-old',
        created_at: at(50),
      },
      {
        _id: 'new',
        room_id: ROOM,
        sender_type: 'customer',
        reply_token: 'rt-new',
        created_at: at(5),
      },
    ]);
    await expect(findReplyCandidate(m as never, ROOM, now)).resolves.toEqual({
      replyToken: 'rt-new',
      rowId: 'new',
    });
  });

  it('a token older than 60 s is not a candidate (LINE: valid 60 s)', async () => {
    const m = model([
      {
        _id: 'x',
        room_id: ROOM,
        sender_type: 'customer',
        reply_token: 'rt',
        created_at: at(61),
      },
    ]);
    await expect(findReplyCandidate(m as never, ROOM, now)).resolves.toBeNull();
  });

  it('a token we already spent is not a candidate', async () => {
    const m = model([
      {
        _id: 'x',
        room_id: ROOM,
        sender_type: 'customer',
        reply_token: 'rt',
        created_at: at(5),
        reply_token_used_at: at(2),
      },
    ]);
    await expect(findReplyCandidate(m as never, ROOM, now)).resolves.toBeNull();
  });

  it('the query itself encodes every rule — not a JS filter after a broad read', async () => {
    const m = model([]);
    await findReplyCandidate(m as never, ROOM, now);
    expect(m.calls[0]).toEqual({
      room_id: ROOM,
      sender_type: 'customer',
      reply_token: { $nin: [null, ''] },
      reply_token_used_at: { $exists: false },
      created_at: { $gte: at(60) },
    });
  });
});
