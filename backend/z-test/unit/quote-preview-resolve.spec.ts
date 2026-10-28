/**
 * [FEAT-20260831-QUOTESRC] The read that makes a quote block show its SOURCE.
 * ===========================================================================
 * Until now the dashboard resolved a quote inside the page it had already
 * loaded — ten messages — so quoting anything older rendered a neutral
 * stand-in. This resolves the same id-space server-side, for the page being
 * returned, in ONE query.
 *
 * The rules that matter are all cost rules, so they are asserted as queries,
 * not as return values:
 *   · a page with no quotes must issue NO query at all
 *   · a page with quotes must issue exactly ONE, scoped to the room, with the
 *     ids de-duplicated
 * ห้ามงอกคิวรีต่อข้อความ — เทสนี้คุมค่าใช้จ่าย ไม่ใช่แค่ผลลัพธ์.
 */
import { Types } from 'mongoose';

import { resolveQuotedPreviews, withQuotedPreviews } from '@/modules/chat';

const ROOM = new Types.ObjectId();

/** Minimal `find(...).select(...).lean()` fake — the calls ARE the assertion. */
function model(rows: Record<string, unknown>[]) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    find: (q: Record<string, unknown>) => {
      calls.push(q);
      const chain = {
        select: () => chain,
        lean: () =>
          Promise.resolve(
            rows.filter((r) => {
              const ids = (
                q['provider_msg_id'] as { $in?: unknown[] } | undefined
              )?.$in;
              const sameRoom = String(r['room_id']) === String(q['room_id']);
              return sameRoom && !!ids?.includes(r['provider_msg_id']);
            }),
          ),
      };
      return chain;
    },
  };
}

const quoting = (quotedId?: string) => ({
  quoted_provider_msg_id: quotedId,
});

describe('resolveQuotedPreviews — one query, or none at all', () => {
  it('a page where nothing quotes anything issues NO query and resolves empty', async () => {
    const m = model([{ room_id: ROOM, provider_msg_id: '1' }]);
    const out = await resolveQuotedPreviews(m as never, ROOM, [
      quoting(undefined),
      quoting(undefined),
    ]);
    expect(out.size).toBe(0);
    expect(m.calls).toEqual([]);
  });

  it('resolves the quoted message by provider id, scoped to the room', async () => {
    const m = model([
      {
        room_id: ROOM,
        provider_msg_id: '625',
        _id: 'row-1',
        sender_type: 'customer',
        message_type: 'text',
        content: 'โอนแล้วครับ',
      },
    ]);
    const out = await resolveQuotedPreviews(m as never, ROOM, [quoting('625')]);
    expect(out.get('625')).toEqual({
      id: 'row-1',
      sender_type: 'customer',
      message_type: 'text',
      text: 'โอนแล้วครับ',
    });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]).toEqual({
      room_id: ROOM,
      provider_msg_id: { $in: ['625'] },
    });
  });

  it('ten bubbles quoting the same message still cost ONE query with ONE id', async () => {
    const m = model([
      {
        room_id: ROOM,
        provider_msg_id: '700',
        _id: 'r',
        sender_type: 'bot',
        content: 'x',
      },
    ]);
    await resolveQuotedPreviews(
      m as never,
      ROOM,
      Array.from({ length: 10 }, () => quoting('700')),
    );
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0]!['provider_msg_id']).toEqual({ $in: ['700'] });
  });

  it('a quoted message that is not in this room resolves to nothing — never a wrong bubble', async () => {
    const other = new Types.ObjectId();
    const m = model([
      {
        room_id: other,
        provider_msg_id: '999',
        _id: 'elsewhere',
        sender_type: 'customer',
        content: 'ของห้องอื่น',
      },
    ]);
    const out = await resolveQuotedPreviews(m as never, ROOM, [quoting('999')]);
    expect(out.size).toBe(0);
  });

  it('carries the operator name, so an admin-sent row can be labelled as one', async () => {
    const m = model([
      {
        room_id: ROOM,
        provider_msg_id: '800',
        _id: 'r8',
        sender_type: 'bot',
        message_type: 'text',
        content: 'ยอดเข้าแล้วค่ะ',
        metadata: { sender_name: 'CS_Daw' },
      },
    ]);
    const out = await resolveQuotedPreviews(m as never, ROOM, [quoting('800')]);
    expect(out.get('800')).toMatchObject({ sender_name: 'CS_Daw' });
  });

  it('trims the text — the block is one line, and the payload rides on every page', async () => {
    const long = 'ก'.repeat(400);
    const m = model([
      {
        room_id: ROOM,
        provider_msg_id: '900',
        _id: 'r9',
        sender_type: 'customer',
        message_type: 'text',
        content: long,
      },
    ]);
    const out = await resolveQuotedPreviews(m as never, ROOM, [quoting('900')]);
    const text = out.get('900')!.text;
    expect(text.length).toBeLessThanOrEqual(120);
    expect(long.startsWith(text)).toBe(true);
  });

  it('a media row keeps its kind and an empty text — the caller words it, not us', async () => {
    const m = model([
      {
        room_id: ROOM,
        provider_msg_id: '1000',
        _id: 'r10',
        sender_type: 'customer',
        message_type: 'image',
        content: '[image]',
      },
    ]);
    expect(
      out(await resolveQuotedPreviews(m as never, ROOM, [quoting('1000')])),
    ).toEqual({
      id: 'r10',
      sender_type: 'customer',
      message_type: 'image',
      text: '[image]',
    });
  });
});

/** tiny reader so the last case reads as one line */
function out(map: Map<string, unknown>) {
  return map.get('1000');
}

describe('withQuotedPreviews — attaches to the page, changes nothing else', () => {
  it('a page with no quotes comes back UNTOUCHED and costs no query', async () => {
    const rows = [
      { _id: 'a', content: 'hi' },
      { _id: 'b', content: 'there' },
    ];
    const m = model([]);
    const outRows = await withQuotedPreviews(m as never, ROOM, rows as never);
    expect(outRows).toEqual(rows);
    expect(m.calls).toEqual([]);
  });

  it('only the bubble that quotes gets the key — every other row keeps its exact shape', async () => {
    const m = model([
      {
        room_id: ROOM,
        provider_msg_id: '625',
        _id: 'src',
        sender_type: 'customer',
        message_type: 'text',
        content: 'โอนแล้วครับ',
      },
    ]);
    const rows = [
      { _id: 'plain', content: 'no quote here' },
      { _id: 'reply', content: 'รับทราบค่ะ', quoted_provider_msg_id: '625' },
    ];
    const outRows = (await withQuotedPreviews(
      m as never,
      ROOM,
      rows as never,
    )) as Array<Record<string, unknown>>;

    expect(outRows[0]).toEqual({ _id: 'plain', content: 'no quote here' });
    expect('quoted_preview' in outRows[0]!).toBe(false);
    expect(outRows[1]).toMatchObject({
      _id: 'reply',
      quoted_provider_msg_id: '625',
      quoted_preview: { id: 'src', text: 'โอนแล้วครับ' },
    });
  });

  it('quotes a message the room no longer holds → no key, so the UI keeps its stand-in', async () => {
    const m = model([]);
    const outRows = (await withQuotedPreviews(m as never, ROOM, [
      { _id: 'x', quoted_provider_msg_id: 'gone' },
    ] as never)) as Array<Record<string, unknown>>;
    expect('quoted_preview' in outRows[0]!).toBe(false);
  });
});
