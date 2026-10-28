/**
 * [FIX-20260820-DIVIDEROWNER] the row says which case it belongs to
 * ===========================================================================
 * Owner, 2026-08-20, after seeing one case draw two orange lines and being told
 * the first fix lived in the dashboard: "เอาวิธีที่ดีที่สุด · abandon ต้องไม่เบิ้ล ·
 * ไม่มาแก้ไขปลายเหตุ · ทุกอย่างต้องปกติ พวก slip ปกติ seamless ห้ามกระทบ".
 *
 * THE ACTUAL ROOT CAUSE, and it is not in the dashboard. `ticket.direct_ticket`
 * has been carrying TWO meanings at once:
 *   1. "the system opened this case"          → the orange badge on the avatar
 *   2. "nobody wrote the line, please draw it" → the dashboard's synthetic divider
 * Meaning 2 was true in 2026-08-10 because no path wrote a real row. It stopped
 * being true when `claimRoomAndOpenCase` started writing one — but the flag still
 * said it, so the transcript drew the line a second time. The bug is a conflated
 * boolean, not a rendering mistake.
 * flag ตัวเดียวถือสองความหมาย · พอความหมายที่สองเลิกจริง เส้นเลยซ้ำ.
 *
 * THE FIX: the writer states fact 2 itself. `writeTicketDivider` stamps the row
 * with the case it was written for, so "was this case's line already written" is
 * answered by the row, exactly, instead of being inferred from a name, a time
 * window, or anything else in the neighbourhood.
 *
 * WHY THIS IS SEAMLESS, case by case — the property this file measures:
 *   abandon (new)     stamped     → dashboard draws nothing → one line
 *   slip → opened     no row      → nothing stamped → dashboard draws it, as today
 *   slip → claimed    no ticket   → untouched
 *   every old row     no stamp    → dashboard draws it, exactly as today
 *   the write failed  no stamp    → dashboard still draws it — the line survives
 *   both in one room  own stamps  → neither can suppress the other
 *
 * ⚠️ NO SCHEMA CHANGE. `chat_messages.metadata` is Mixed, and this writer already
 * adds a key conditionally (`actor_name`). An unstamped row is simply a row whose
 * metadata has no `ticket_id`. metadata เป็น Mixed ⇒ ไม่ต้องแตะ schema เลย.
 *
 * ⚠️ THIS REPLACED A WORSE FIX. The first attempt suppressed the synthetic when
 * the room held any `direct_ticket` row carrying `actor_name` — a signature that
 * worked on today's data but could not tell one case from another, so a slip case
 * in a room that had ever seen a system case would have lost its line. That file
 * (`omnidesk-console/components/chat/systemCaseDivider.ts`) is deleted.
 *
 * revert: drop `ticketId` from `WriteDividerInput` and from the call in
 * `claimRoomAndOpenCase`; rows stop being stamped and the dashboard goes back to
 * drawing a line for every `direct_ticket` case.
 */
import { writeTicketDivider } from '@/modules/tickets/ticket-divider.helper';
import { openTicketBySystem } from '@/modules/tickets/create-by-admin';

const room = { _id: 'room-1' };

function deps() {
  const created: Record<string, unknown>[] = [];
  return {
    created,
    d: {
      chatMessageModel: {
        create: (doc: Record<string, unknown>) => {
          created.push(doc);
          return Promise.resolve({ _id: 'msg-1' });
        },
      } as never,
      chatRoomModel: {
        /* the real chain is findOne().select().lean().exec() — the writer reads
           `user_id` (the member _id), never `line_user_id`. */
        findOne: () => ({
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve(room) }),
          }),
        }),
      } as never,
      warn: jest.fn(),
    },
  };
}

const base = {
  memberId: 'm1',
  hookId: 'h1',
  variant: 'direct_ticket' as const,
  content: 'เคสนี้สร้างโดยระบบ ต้องการลงทะเบียน',
};

const metaOf = (rows: Record<string, unknown>[]): Record<string, unknown> =>
  (rows[0]?.['metadata'] ?? {}) as Record<string, unknown>;

describe('⭐ a row written for a case carries that case', () => {
  it('stamps `metadata.ticket_id` when it is told which case', async () => {
    const { created, d } = deps();
    await writeTicketDivider({ ...base, ticketId: 'tkt-9' }, d);
    expect(metaOf(created)['ticket_id']).toBe('tkt-9');
  });

  it('stores it as a string — an ObjectId must not reach the row as an object', async () => {
    /* the caller hands over `ticket._id`, which is an ObjectId. Stored raw it
       would compare unequal to the string the dashboard holds.
       เก็บเป็น string ไม่งั้นฝั่งหน้าจอเทียบไม่ติด. */
    const { created, d } = deps();
    const oid = { toString: () => 'tkt-oid' };
    await writeTicketDivider({ ...base, ticketId: oid }, d);
    expect(metaOf(created)['ticket_id']).toBe('tkt-oid');
  });

  it('keeps the keys it already wrote — variant and actor are untouched', async () => {
    const { created, d } = deps();
    await writeTicketDivider(
      { ...base, actorName: 'ระบบ', ticketId: 'tkt-9' },
      d,
    );
    expect(metaOf(created)).toEqual({
      variant: 'direct_ticket',
      actor_name: 'ระบบ',
      ticket_id: 'tkt-9',
    });
  });
});

describe('⭐ seamless: a row written without a case looks exactly as it did', () => {
  it('⭐ no `ticket_id` key at all when none is given', async () => {
    /* THE load-bearing case. Every existing caller — the slip path, accept,
       close, bot, assign — passes nothing, and their rows must not gain a key.
       A `null` here would make "unstamped" indistinguishable from "stamped with
       nothing" for the dashboard rule. ของเดิมต้องไม่มีคีย์นี้โผล่มาเลย. */
    const { created, d } = deps();
    await writeTicketDivider(base, d);
    expect('ticket_id' in metaOf(created)).toBe(false);
  });

  it('an empty or null case id is treated as "not given"', async () => {
    for (const ticketId of [null, undefined, '']) {
      const { created, d } = deps();
      await writeTicketDivider({ ...base, ticketId }, d);
      expect('ticket_id' in metaOf(created)).toBe(false);
    }
  });

  it('the whole document is otherwise unchanged for an unstamped row', async () => {
    const { created, d } = deps();
    await writeTicketDivider({ ...base, actorName: 'dev (Developer)' }, d);
    expect(metaOf(created)).toEqual({
      variant: 'direct_ticket',
      actor_name: 'dev (Developer)',
    });
  });
});

describe('⭐ the system case-opener is the one that stamps', () => {
  const src = require('node:fs')
    .readFileSync(
      require('node:path').join(
        process.cwd(),
        'src/modules/tickets/create-by-admin/create-ticket-by-admin.helper.ts',
      ),
      'utf8',
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '') as string;

  it('passes the ticket it just created to the divider writer', () => {
    expect(src).toMatch(/ticketId:\s*ticket\['_id'\]/);
  });

  it('⭐ and does so AFTER the ticket exists — or it would stamp undefined', () => {
    /* the writer runs at step 4 and `ticketModel.create` at step 3; if anyone
       reorders them the stamp silently becomes `undefined` and every case starts
       drawing two lines again. ต้องอยู่หลังสร้าง ticket เท่านั้น. */
    expect(src.indexOf('ticketModel.create')).toBeLessThan(
      src.indexOf('ticketId:'),
    );
  });
});

describe('⭐ every OTHER divider writes exactly the document it wrote before', () => {
  /* owner: "divider เดิมต้องไม่กระทบ มันมีหลายตัว proof ด้วย".
     Not argued — measured, one variant at a time. None of these callers passes a
     case, so none of their rows may gain a key. */
  const VARIANTS = [
    'accept',
    'close',
    'assign',
    'bot',
    'auto_ticket',
    'reopen_by_admin',
    'direct_ticket',
    'suppressed_reply',
  ] as const;

  it.each(VARIANTS)(
    '%s — metadata is variant (+actor) and nothing else',
    async (variant) => {
      const { created, d } = deps();
      await writeTicketDivider(
        { ...base, variant: variant as never, actorName: 'dev (Developer)' },
        d,
      );
      expect(metaOf(created)).toEqual({
        variant,
        actor_name: 'dev (Developer)',
      });
    },
  );

  it.each(VARIANTS)(
    '%s — and without an actor, only the variant',
    async (variant) => {
      const { created, d } = deps();
      await writeTicketDivider({ ...base, variant: variant as never }, d);
      expect(metaOf(created)).toEqual({ variant });
    },
  );

  it('the rest of the row — room, content, type — is untouched too', async () => {
    const { created, d } = deps();
    await writeTicketDivider(
      { ...base, variant: 'accept', content: 'รับเคส โดย dev' },
      d,
    );
    const row = created[0] as Record<string, unknown>;
    expect(row['room_id']).toBe('room-1');
    expect(row['content']).toBe('รับเคส โดย dev');
    expect(row['message_type']).toBe('divider');
  });
});

describe('⭐ abandon cannot double any more — followed through the real opener', () => {
  /* owner: "abandon ต้องไม่เบิ้ล divider". This drives `openTicketBySystem`, the
     door scenario A actually calls, and checks the row it wrote carries the id of
     the ticket it just created — which is the exact value the dashboard compares
     against before deciding to draw. ไล่ผ่านประตูจริงที่ scenario A เรียก. */
  /* real ObjectId strings — the opener validates `roomId` before it does
     anything, so a friendly label like 'room-9' never reaches the divider. */
  const ROOM_ID = 'a0d00000000000000000004c';
  const TICKET_ID = 'a0d00000000000000000004d';
  const ROOM = {
    _id: ROOM_ID,
    user_id: 'a0d00000000000000000004e',
    hook_id: 'a0d00000000000000000004f',
  };

  function openerDeps() {
    const dividers: Record<string, unknown>[] = [];
    const tickets: Record<string, unknown>[] = [];
    return {
      dividers,
      tickets,
      deps: {
        ticketModel: {
          create: (doc: Record<string, unknown>) => {
            tickets.push(doc);
            return Promise.resolve({ ...doc, _id: TICKET_ID });
          },
        },
        chatRoomModel: {
          findById: () => ({ lean: () => Promise.resolve(ROOM) }),
          findOneAndUpdate: () => ({ lean: () => Promise.resolve(ROOM) }),
          updateOne: () => ({ exec: () => Promise.resolve({}) }),
          findOne: () => ({
            select: () => ({
              lean: () => ({ exec: () => Promise.resolve(ROOM) }),
            }),
          }),
        },
        chatMessageModel: {
          create: (doc: Record<string, unknown>) => {
            dividers.push(doc);
            return Promise.resolve({ _id: 'divider-9' });
          },
          findOne: () => ({
            sort: () => ({ lean: () => Promise.resolve(null) }),
          }),
        },
        assignHistoryModel: { create: (d: unknown) => Promise.resolve(d) },
        warn: jest.fn(),
      } as never,
    };
  }

  it('⭐ the row it writes carries the id of the ticket it just opened', async () => {
    const { deps: d, dividers, tickets } = openerDeps();
    const { ticket } = await openTicketBySystem(
      {
        roomId: ROOM_ID,
        category: 'Other',
        needDetail: 'ต้องการลงทะเบียน',
        dividerContent: 'เคสนี้สร้างโดยระบบ ต้องการลงทะเบียน',
      },
      d,
    );
    expect(tickets).toHaveLength(1);
    expect(dividers).toHaveLength(1);
    const meta = (dividers[0]!['metadata'] ?? {}) as Record<string, unknown>;
    expect(meta['ticket_id']).toBe(String(ticket['_id']));
    expect(meta['variant']).toBe('direct_ticket');
  });

  it('⭐ and the dashboard rule, given that exact row, draws nothing', async () => {
    /* the two halves meet here: the row the backend wrote, fed to the same
       predicate the page runs. If either side drifts this goes red.
       สองฝั่งมาเจอกันตรงนี้ ถ้าฝั่งใดเพี้ยน เทสแดงทันที. */
    const { deps: d, dividers } = openerDeps();
    const { ticket } = await openTicketBySystem(
      {
        roomId: ROOM_ID,
        category: 'Other',
        needDetail: 'ต้องการลงทะเบียน',
        dividerContent: 'เคสนี้สร้างโดยระบบ ต้องการลงทะเบียน',
      },
      d,
    );
    const row = { ...dividers[0], message_type: 'divider' };
    expect(feDrewAlready([row], String(ticket['_id']))).toBe(true);
    expect(feDrewAlready([row], 'SOME-OTHER-TICKET')).toBe(false);
  });
});

/**
 * The dashboard's rule, restated here so the backend suite can prove the two
 * halves agree without importing across repositories. Kept to five lines on
 * purpose — if it ever needs more, it has stopped being a lookup.
 * ถอดกฎฝั่งหน้าจอมาไว้ตรงนี้ เพื่อพิสูจน์ว่าสองฝั่งตรงกันจริง.
 */
function feDrewAlready(messages: unknown, ticketId: unknown): boolean {
  const id = String(ticketId ?? '').trim();
  if (!id || !Array.isArray(messages)) return false;
  return messages.some((row) => {
    const m = row as {
      message_type?: unknown;
      metadata?: Record<string, unknown> | null;
    };
    if (!m || m.message_type !== 'divider') return false;
    if (!m.metadata || m.metadata['variant'] !== 'direct_ticket') return false;
    return String(m.metadata['ticket_id'] ?? '').trim() === id;
  });
}
