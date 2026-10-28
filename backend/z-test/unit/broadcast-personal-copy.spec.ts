/**
 * [FIX-20260831-PERSONALCOPY] a personal multicast's chat copy is each
 * person's REAL card — never the raw `{{profile.*}}` template.
 * ===========================================================================
 * The bug this pins shut, measured on stg 30/08 (job "เชคโปรทดสอบ"): LINE
 * delivered correctly substituted cards, while every chat room stored the raw
 * saved card — nine `{{profile.*}}` tags on screen. The send path threw each
 * render away (`PersonalCardMessageBuilder` kept nothing), so the transcript
 * had nothing real to write and fell back to the template. Re-rendering later
 * is impossible by design: the paged var source forgets each member page as
 * the next loads.
 *
 * Three layers, one file — the retention (builder), the per-target override
 * (writer), and the whole run (service), because the failure lived in the
 * seams BETWEEN them and a green unit on each side proved nothing.
 */
import {
  BroadcastNewSendService,
  PersonalCardMessageBuilder,
} from '@/modules/content';
/* the writer is folder-scoped, same import the transcript spec uses */
import { writeCampaignTranscript } from '@/modules/content/broadcast-transcript';
import type { LineSendResult } from '@/infra/line';

const OK: LineSendResult = {
  ok: true,
  status: 200,
  attempts: 1,
  durationMs: 1,
};

/* ────────────────────────────────────────────────────────────────────────────
 * Layer 1 — the builder retains what each person was sent
 * ──────────────────────────────────────────────────────────────────────────── */
describe('PersonalCardMessageBuilder keeps each person’s rendered card', () => {
  const CARD = {
    type: 'text',
    text: 'ทำแล้ว {{profile.act_done_fashion}}',
  } as never;

  /** counts varsFor calls — an existing spec pins that exact count elsewhere */
  const source = () => {
    const calls: string[] = [];
    return {
      calls,
      varsFor: (id: string) => {
        calls.push(id);
        return id === 'U1'
          ? { 'profile.act_done_fashion': '111' }
          : id === 'U2'
            ? { 'profile.act_done_fashion': '222' }
            : null;
      },
    };
  };

  it('⭐ sentPayloadFor answers the very payload messagesFor rendered', () => {
    const s = source();
    const b = new PersonalCardMessageBuilder(CARD, s);
    const out = b.messagesFor({ index: 0, to: ['U1'] }, 'h1');

    expect(out.messages).toHaveLength(1);
    expect(b.sentPayloadFor('U1', 'h1')).toBe(out.messages[0]);
    expect(JSON.stringify(b.sentPayloadFor('U1', 'h1'))).toContain('111');
  });

  it('⭐ two people, two answers — never each other’s', () => {
    const b = new PersonalCardMessageBuilder(CARD, source());
    b.messagesFor({ index: 0, to: ['U1'] }, 'h1');
    b.messagesFor({ index: 1, to: ['U2'] }, 'h1');

    expect(JSON.stringify(b.sentPayloadFor('U1', 'h1'))).toContain('111');
    expect(JSON.stringify(b.sentPayloadFor('U1', 'h1'))).not.toContain('222');
    expect(JSON.stringify(b.sentPayloadFor('U2', 'h1'))).toContain('222');
  });

  it('🔴 retention never calls varsFor again — a spec elsewhere counts those', () => {
    const s = source();
    const b = new PersonalCardMessageBuilder(CARD, s);
    b.messagesFor({ index: 0, to: ['U1'] }, 'h1');
    const before = s.calls.length;

    b.sentPayloadFor('U1', 'h1');
    b.sentPayloadFor('U1', 'h1');

    expect(s.calls.length).toBe(before);
  });

  it('a refused render stores NOTHING — a failed chunk must stay failed', () => {
    const b = new PersonalCardMessageBuilder(CARD, source());
    b.messagesFor({ index: 0, to: ['U-unknown'] }, 'h1'); // varsFor null
    b.messagesFor({ index: 1, to: ['U1', 'U2'] }, 'h1'); // batch refused

    expect(b.sentPayloadFor('U-unknown', 'h1')).toBeUndefined();
    expect(b.sentPayloadFor('U1', 'h1')).toBeUndefined();
  });

  it('the key carries the OA — one person on two OAs keeps two cards', () => {
    const b = new PersonalCardMessageBuilder(CARD, source());
    b.messagesFor({ index: 0, to: ['U1'] }, 'h1');

    expect(b.sentPayloadFor('U1', 'h1')).toBeDefined();
    expect(b.sentPayloadFor('U1', 'h2')).toBeUndefined();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Layer 2 — the writer honours a per-target copy, blob as fallback
 * ──────────────────────────────────────────────────────────────────────────── */
describe('writeCampaignTranscript per-target copy', () => {
  const write = async (targets: unknown[]) => {
    const rows: Record<string, unknown>[] = [];
    const model = {
      insertMany: (r: Record<string, unknown>[]) => {
        rows.push(...r);
        return Promise.resolve(r);
      },
    } as never;
    await writeCampaignTranscript(model, {
      kind: 'multicast',
      jobId: 'a'.repeat(24),
      jobName: 'เชคโปรทดสอบ',
      runId: 'run-1',
      messageType: 'flex',
      content: '[Flex] เชคโปรทดสอบ',
      flexJson: { raw: '{{profile.act_done_fashion}}' },
      targets: targets as never,
    });
    return rows;
  };

  it('⭐ a target with its own copy gets IT; one without gets the blob', async () => {
    const rows = await write([
      {
        roomId: 'r1',
        hookId: 'h1',
        content: '[Flex] เชคโปรทดสอบ',
        flexJson: { raw: '111' },
      },
      { roomId: 'r2', hookId: 'h1' },
    ]);
    const msgs = rows.filter((r) => r['message_type'] === 'flex');

    expect(msgs).toHaveLength(2);
    const meta1 = msgs[0]!['metadata'] as Record<string, unknown>;
    const meta2 = msgs[1]!['metadata'] as Record<string, unknown>;
    expect(JSON.stringify(meta1['flex_json'])).toContain('111');
    expect(JSON.stringify(meta2['flex_json'])).toContain('{{profile.');
  });

  it('the row-shape invariants survive the override', async () => {
    const rows = await write([
      { roomId: 'r1', hookId: 'h1', content: 'own', flexJson: { v: 1 } },
      { roomId: 'r2', hookId: 'h1' },
    ]);

    // two rows per room — message + divider
    expect(rows).toHaveLength(4);
    // content stays a STRING on every row (the chat page calls .includes on it)
    for (const r of rows) expect(typeof r['content']).toBe('string');
    // every message row shares ONE instant; every divider the same later one
    const msgs = rows.filter((r) => r['message_type'] === 'flex');
    const divs = rows.filter((r) => r['message_type'] === 'divider');
    expect(msgs[0]!['created_at']).toEqual(msgs[1]!['created_at']);
    expect(divs[0]!['created_at']).toEqual(divs[1]!['created_at']);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Layer 3 — the whole run: a personal multicast writes each room ITS card
 * ────────────────────────────────────────────────────────────────────────────
 * The harness mirrors broadcast-new-send-service.spec.ts (plain-object fakes,
 * one declared cast). The member/chat_room fakes answer the three query shapes
 * the run really makes, told apart by their filters — read from
 * mongo-ports.factory.ts / recipient.pager.ts / oa-scope.ts, not guessed:
 *   pager page 1   members.find({...})            → _id rows
 *   pager page 2+  members.find({_id:{$gt}})      → []  (ObjectId cursor!)
 *   prefetch       members.find({line_user_id:{$in}}) → full rows
 *   OA scope       chat_rooms.find({user_id:{$in},hook_id})   → line ids
 *   transcript     chat_rooms.find({hook_id,line_user_id:{$in}}) → rooms
 */
const model = (fake: Record<string, unknown>): never => fake as never;
const chain = (rows: unknown[]): Record<string, unknown> => ({
  select: () => chain(rows),
  sort: () => chain(rows),
  limit: () => chain(rows),
  lean: () => chain(rows),
  exec: () => Promise.resolve(rows),
});
const one = (row: unknown): Record<string, unknown> => ({
  select: () => one(row),
  sort: () => one(row),
  lean: () => one(row),
  exec: () => Promise.resolve(row),
});

/* real 24-hex ids — the pager cursor does `new Types.ObjectId(id)` and a
   fake id like 'm1' would throw inside the run, not in this spec */
const M1 = 'a0d00000000000000000003e';
const M2 = 'a0d00000000000000000003f';

const HOOKS: Record<string, Record<string, unknown>> = {
  h1: { _id: 'h1', alias: 'OA-ONE', group: 'g1', access_token: 'tok-1' },
  h2: { _id: 'h2', alias: 'OA-TWO', group: 'g2', access_token: 'tok-2' },
};

const MEMBERS = [
  /* the envelope readProfileObject really unwraps — `{data:{profile:{…}}}`
     ("the shape Mongo actually holds", raw-blob.reader.ts) · a bare promotion
     object matches NONE of its shapes and every tag renders N/A (this fixture
     was first written that way and the test caught it) */
  {
    _id: M1,
    line_user_id: 'U1',
    raw_profile_data: {
      data: {
        profile: { promotion: { activity_volume_done: { fashion: 111 } } },
      },
    },
  },
  {
    _id: M2,
    line_user_id: 'U2',
    raw_profile_data: {
      data: {
        profile: { promotion: { activity_volume_done: { fashion: 222 } } },
      },
    },
  },
];

const FLEX_CARD = {
  type: 'bubble',
  body: {
    type: 'box',
    layout: 'vertical',
    contents: [{ type: 'text', text: 'ทำแล้ว {{profile.act_done_fashion}}' }],
  },
};

const PERSONAL_JOB = {
  _id: 'b1',
  name: 'เชคโปรทดสอบ',
  hook_ids: ['h1'],
  send_kind: 'multicast',
  card_type: 'personal',
  target: { mode: 'all', group_ids: [] },
  message: { type: 'flex', flex_json: FLEX_CARD },
};

interface Seen {
  readonly chatRows: Record<string, unknown>[];
  readonly dispatched: Record<string, unknown>[];
}

function buildService(
  opts: {
    hookIds?: string[];
    cardType?: string | null;
    transcriptThrowsForHook?: string;
  } = {},
): { service: BroadcastNewSendService; seen: Seen } {
  const seen: Seen = { chatRows: [], dispatched: [] };
  const isRec = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null;

  const memberModel = {
    find: (q: unknown) => {
      const f = isRec(q) ? q : {};
      const lid = f['line_user_id'];
      if (isRec(lid) && Array.isArray(lid['$in'])) {
        // personal prefetch — full rows for exactly these ids
        return chain(
          MEMBERS.filter((m) =>
            (lid['$in'] as unknown[]).includes(m.line_user_id),
          ),
        );
      }
      const idc = f['_id'];
      if (isRec(idc) && idc['$gt'] !== undefined) return chain([]); // page 2+
      return chain(MEMBERS.map((m) => ({ _id: m._id }))); // page 1 / count
    },
  };

  const chatRoomModel = {
    countDocuments: () => Promise.resolve(2),
    find: (q: unknown) => {
      const f = isRec(q) ? q : {};
      const uid = f['user_id'];
      if (isRec(uid) && Array.isArray(uid['$in'])) {
        // OA scope: member ids → line ids on this hook
        return chain(
          MEMBERS.filter((m) =>
            (uid['$in'] as unknown[]).map(String).includes(m._id),
          ).map((m) => ({ line_user_id: m.line_user_id })),
        );
      }
      const lid = f['line_user_id'];
      if (isRec(lid) && Array.isArray(lid['$in'])) {
        // transcript rooms for this hook
        if (
          opts.transcriptThrowsForHook !== undefined &&
          f['hook_id'] === opts.transcriptThrowsForHook
        ) {
          return {
            select: () => ({
              lean: () => ({
                exec: () => Promise.reject(new Error('room read broke')),
              }),
            }),
          };
        }
        return chain(
          MEMBERS.filter((m) =>
            (lid['$in'] as unknown[]).includes(m.line_user_id),
          ).map((m) => ({
            _id: `room-${String(f['hook_id'])}-${m.line_user_id}`,
            hook_id: f['hook_id'],
            line_user_id: m.line_user_id,
          })),
        );
      }
      return chain([]);
    },
  };

  const service = new BroadcastNewSendService(
    model({
      countDocuments: () => Promise.resolve(0),
      findOneAndUpdate: () => ({
        lean: () => ({ exec: () => Promise.resolve({ _id: 'b1' }) }),
      }),
    }),
    model({
      findById: (id: unknown) => one(HOOKS[String(id)] ?? null),
      find: () => chain(Object.values(HOOKS)),
    }),
    model({ findById: () => ({ lean: () => Promise.resolve(null) }) }),
    model({
      model: (name: string) =>
        name === 'Member'
          ? memberModel
          : name === 'ChatMessage'
            ? {
                insertMany: (rows: Record<string, unknown>[]) => {
                  seen.chatRows.push(...rows);
                  return Promise.resolve(rows);
                },
              }
            : chatRoomModel,
    }),
    model({
      countDocuments: () => Promise.resolve(0),
      findOne: () => one(null),
      find: () => chain([]),
      insertMany: () => Promise.resolve([]),
    }),
    model({ persist: (d: Record<string, unknown>) => Promise.resolve(d) }),
    model({ safeDecrypt: (v: string) => v }),
    model({
      dispatch: (req: Record<string, unknown>) => {
        seen.dispatched.push(req);
        return Promise.resolve(OK);
      },
    }),
    model({ translate: () => null }),
  );
  return { service, seen };
}

const ACTOR = { id: 'u1', name: 'admin one' };

describe('a personal multicast run — end to end', () => {
  it('⭐ THE BUG: each room stores ITS person’s substituted card, no raw tags', async () => {
    const { service, seen } = buildService();
    await service.send(PERSONAL_JOB, ACTOR);

    const msgs = seen.chatRows.filter((r) => r['message_type'] === 'flex');
    expect(msgs).toHaveLength(2);

    const byRoom = new Map(msgs.map((r) => [String(r['room_id']), r]));
    const j1 = JSON.stringify(
      (byRoom.get('room-h1-U1')!['metadata'] as Record<string, unknown>)[
        'flex_json'
      ],
    );
    const j2 = JSON.stringify(
      (byRoom.get('room-h1-U2')!['metadata'] as Record<string, unknown>)[
        'flex_json'
      ],
    );

    expect(j1).toContain('111');
    expect(j2).toContain('222');
    // the raw template must be GONE from both
    expect(j1).not.toContain('{{profile.');
    expect(j2).not.toContain('{{profile.');
    // and NEVER each other's — sending A's numbers into B's room is the
    // failure mode worse than the bug being fixed
    expect(j1).not.toContain('222');
    expect(j2).not.toContain('111');
  });

  it('what LINE was sent and what the room stored are the SAME card', async () => {
    const { service, seen } = buildService();
    await service.send(PERSONAL_JOB, ACTOR);

    /* the dispatch request carries `to` at the TOP level (inline.sink.ts:157-168) */
    const sentTo = (id: string) =>
      JSON.stringify(
        seen.dispatched.find(
          (d) => Array.isArray(d['to']) && (d['to'] as unknown[]).includes(id),
        ),
      );
    const stored = (room: string) =>
      JSON.stringify(
        seen.chatRows.find(
          (r) => String(r['room_id']) === room && r['message_type'] === 'flex',
        ),
      );

    expect(sentTo('U1')).toContain('111');
    expect(stored('room-h1-U1')).toContain('111');
    expect(sentTo('U2')).toContain('222');
    expect(stored('room-h1-U2')).toContain('222');
  });

  it('🔴 one OA’s broken room read no longer starves the next OA’s copy', async () => {
    const { service, seen } = buildService({ transcriptThrowsForHook: 'h1' });
    await service.send({ ...PERSONAL_JOB, hook_ids: ['h1', 'h2'] }, ACTOR);

    const rooms = seen.chatRows
      .filter((r) => r['message_type'] === 'flex')
      .map((r) => String(r['room_id']));
    // h1's copy is lost to the broken read — but h2's two rooms still got theirs
    expect(rooms.some((r) => r.startsWith('room-h2-'))).toBe(true);
    expect(rooms.some((r) => r.startsWith('room-h1-'))).toBe(false);
  });

  it('a PLAIN multicast still writes one identical card to every room', async () => {
    const { service, seen } = buildService();
    await service.send({ ...PERSONAL_JOB, card_type: null }, ACTOR);

    const msgs = seen.chatRows.filter((r) => r['message_type'] === 'flex');
    expect(msgs).toHaveLength(2);
    const j = msgs.map((r) =>
      JSON.stringify((r['metadata'] as Record<string, unknown>)['flex_json']),
    );
    expect(j[0]).toEqual(j[1]); // the run-wide blob, exactly as before
  });
});
