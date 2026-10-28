/* [FIX-20260815-DIVIDERRETITLE] the divider must follow the ticket's wording
 * ===========================================================================
 * THE BUG. `retitleDirectTicket` joined the card's reason onto the ticket row
 * and stopped there. The DIVIDER — the line an admin actually reads inside the
 * chat transcript — lives in a different collection and was never updated, so
 * the specific reason existed in the database and was invisible in the UI.
 * Confirmed on live rows 15/08/2026 before this was written:
 *
 *   tickets.direct_ticket_detail  "ยอดที่โอนมา … · ยอดในสลิป 3,022 บาท …"  ✅
 *   chat_messages (divider)       "เคสนี้สร้างโดยระบบ เนื่องจาก ยอดในสลิป 2,354 …" ❌
 *
 * WHAT IS PINNED HERE
 *   1. the divider gets the SAME sentence as the ticket, wrapped in the frame
 *   2. it is scoped to THIS member's room — never the newest divider on the OA
 *   3. the ticket update still happens exactly as before
 *   4. FALLBACK, owner-stated ("ถ้า text จาก ticket null empty fallback เดิม"):
 *      every missing input leaves the existing divider untouched — a blank
 *      reason, no models wired in, no room. Nothing is ever cleared.
 *   5. it never creates a divider (that is `writeTicketDivider`'s job, governed
 *      by `[FIX-20260811-PAYDIVIDER]` — one divider per check)
 *
 * ⚠️ THE TRAP THIS GUARDS. `tickets.line_user_id` holds the MEMBER `_id` while
 * `chat_messages.room_id` holds the ROOM `_id` — near-identical values, verified
 * off live rows. Filtering the divider by hook alone would rewrite ANOTHER
 * customer's transcript with this customer's amounts; case 2 is that regression
 * test and it fails if the room lookup is dropped.
 */
import { retitleDirectTicket } from '@/modules/payment/payment-ticket.helper';
import { retitleLatestDivider } from '@/modules/tickets/ticket-divider.helper';

const TICKET_ID = 'ticket-1';
const MEMBER_ID = 'member-abc';
const HOOK_ID = 'hook-xyz';
const ROOM_ID = 'room-def';

/** Doubles shaped like the real Mongoose calls this helper makes. */
function makeDeps(opts: {
  prevDetail?: string;
  room?: { _id: string } | null;
  withChatModels?: boolean;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const dividerCalls: Array<{
    filter: unknown;
    update: unknown;
    options: unknown;
  }> = [];
  const warns: string[] = [];

  const ticketModel = {
    updateOne: (_f: unknown, u: Record<string, unknown>) => {
      updates.push(u);
      return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
    },
    findById: () => ({
      select: () => ({
        lean: () => ({
          exec: () =>
            Promise.resolve({ line_user_id: MEMBER_ID, hook_id: HOOK_ID }),
        }),
      }),
    }),
    // `findOne` is the pre-update read for the existing detail.
    findOne: () => ({
      select: () => ({
        lean: () => ({
          exec: () =>
            Promise.resolve({ direct_ticket_detail: opts.prevDetail ?? '' }),
        }),
      }),
    }),
  };
  // The helper reads the previous detail through findById().select().lean().
  (ticketModel as unknown as Record<string, unknown>)['findById'] = (() => {
    let call = 0;
    return () => ({
      select: (fields: string) => ({
        lean: () => ({
          exec: () => {
            call += 1;
            return Promise.resolve(
              fields.includes('direct_ticket_detail')
                ? { direct_ticket_detail: opts.prevDetail ?? '' }
                : { line_user_id: MEMBER_ID, hook_id: HOOK_ID },
            );
          },
        }),
      }),
    });
  })();

  const chatMessageModel = {
    findOneAndUpdate: (filter: unknown, update: unknown, options: unknown) => {
      dividerCalls.push({ filter, update, options });
      return { exec: () => Promise.resolve(null) };
    },
  };

  const chatRoomModel = {
    findOne: () => ({
      select: () => ({
        lean: () => Promise.resolve(undefined),
      }),
    }),
  };
  // Real shape: findOne().select().lean().exec()
  (chatRoomModel as unknown as Record<string, unknown>)['findOne'] = () => ({
    select: () => ({
      lean: () => ({
        exec: () =>
          Promise.resolve(
            opts.room === undefined ? { _id: ROOM_ID } : opts.room,
          ),
      }),
    }),
  });

  const deps = {
    ticketModel: ticketModel as never,
    warn: (m: string) => void warns.push(m),
    ...(opts.withChatModels === false
      ? {}
      : {
          chatMessageModel: chatMessageModel as never,
          chatRoomModel: chatRoomModel as never,
        }),
  };
  return { deps, updates, dividerCalls, warns };
}

const dividerContent = (c: { update: unknown }) =>
  String((c.update as { $set?: { content?: unknown } })?.$set?.content ?? '');

describe('[DIVIDERRETITLE] the divider carries the ticket wording', () => {
  it('writes the joined sentence onto the divider, inside the system frame', async () => {
    const { deps, dividerCalls } = makeDeps({
      prevDetail: 'ยอดในสลิป 3,022 บาท · รายการรอฝาก ไม่มี',
    });

    await retitleDirectTicket(
      { ticketId: TICKET_ID, reason: 'ยอดที่โอนมา ไม่ถูกต้อง' },
      deps,
    );

    expect(dividerCalls).toHaveLength(1);
    const content = dividerContent(dividerCalls[0]!);
    expect(content).toContain('เคสนี้สร้างโดยระบบ เนื่องจาก');
    expect(content).toContain('ยอดที่โอนมา ไม่ถูกต้อง'); // the card's reason
    expect(content).toContain('3,022'); // the runner's amounts, preserved
  });

  /* THE REGRESSION GUARD. Narrowing by hook alone would hit another customer's
     transcript. The filter must be scoped by room. */
  it('scopes the update to this member’s room, not the whole OA', async () => {
    const { deps, dividerCalls } = makeDeps({ prevDetail: 'x' });

    await retitleDirectTicket({ ticketId: TICKET_ID, reason: 'r' }, deps);

    const filter = dividerCalls[0]!.filter as Record<string, unknown>;
    expect(filter['room_id']).toBe(ROOM_ID);
    expect(filter['message_type']).toBe('divider');
    expect(filter['metadata.variant']).toBe('direct_ticket');
    // A hook-only filter is exactly the bug this guards against.
    expect(Object.keys(filter)).not.toContain('hook_id');
  });

  it('updates only the LATEST divider', async () => {
    const { deps, dividerCalls } = makeDeps({ prevDetail: 'x' });

    await retitleDirectTicket({ ticketId: TICKET_ID, reason: 'r' }, deps);

    const options = dividerCalls[0]!.options as {
      sort?: Record<string, number>;
    };
    expect(options.sort).toEqual({ created_at: -1 });
  });

  it('still updates the ticket row, as before', async () => {
    const { deps, updates } = makeDeps({ prevDetail: 'keep me' });

    await retitleDirectTicket({ ticketId: TICKET_ID, reason: 'reason' }, deps);

    const set = (updates[0] as { $set?: Record<string, unknown> })?.$set ?? {};
    expect(String(set['direct_ticket_detail'])).toContain('reason');
    expect(String(set['direct_ticket_detail'])).toContain('keep me');
  });

  // ==== FALLBACK CASES — the existing divider must survive untouched ========

  it('a blank reason changes nothing at all', async () => {
    const { deps, updates, dividerCalls } = makeDeps({ prevDetail: 'x' });

    const ok = await retitleDirectTicket(
      { ticketId: TICKET_ID, reason: '  ' },
      deps,
    );

    expect(ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(dividerCalls).toHaveLength(0);
  });

  it('no chat models wired in ⇒ ticket-only, exactly the old behaviour', async () => {
    const { deps, updates, dividerCalls } = makeDeps({
      prevDetail: 'x',
      withChatModels: false,
    });

    const ok = await retitleDirectTicket(
      { ticketId: TICKET_ID, reason: 'r' },
      deps,
    );

    expect(ok).toBe(true);
    expect(updates).toHaveLength(1); // ticket still updated
    expect(dividerCalls).toHaveLength(0); // divider untouched
  });

  it('no room found ⇒ divider untouched, never a widened filter', async () => {
    const { deps, dividerCalls } = makeDeps({ prevDetail: 'x', room: null });

    const ok = await retitleDirectTicket(
      { ticketId: TICKET_ID, reason: 'r' },
      deps,
    );

    expect(ok).toBe(true);
    expect(dividerCalls).toHaveLength(0);
  });

  it('never clears the divider — the update always carries text', async () => {
    const { deps, dividerCalls } = makeDeps({ prevDetail: '' });

    await retitleDirectTicket(
      { ticketId: TICKET_ID, reason: 'only-reason' },
      deps,
    );

    expect(dividerContent(dividerCalls[0]!).trim().length).toBeGreaterThan(10);
  });

  /* It must MODIFY an existing row, never insert one — creating dividers is
     `writeTicketDivider`'s job and doing it here revives the double-divider bug. */
  it('does not upsert a divider when none exists', async () => {
    const { deps, dividerCalls } = makeDeps({ prevDetail: 'x' });

    await retitleDirectTicket({ ticketId: TICKET_ID, reason: 'r' }, deps);

    const options = dividerCalls[0]!.options as Record<string, unknown>;
    expect(options['upsert']).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════════════
   * THE PATH THAT ACTUALLY FIRES IN PRODUCTION — `retitleLatestDivider`.
   * ══════════════════════════════════════════════════════════════════════════
   * `retitleDirectTicket` above needs a ticket id, and the common case has none:
   * when the room is already claimed the runner cannot open a ticket, so
   * `ctx.directTicketId` is null and that branch is skipped entirely. The runner
   * HAD written a divider, and that line was never retitled — which is exactly
   * what the owner kept seeing on 15/08/2026: the bot replied with the card's
   * sentence while the divider still read "ยอดในสลิป 2,354 บาท · รายการรอฝาก ไม่มี".
   *
   * ⚠️ THE THREE-ID TRAP, verified on live rows: the LINE id (`Ubd88e…`), the
   * member `_id` (`6a6de682…33d`) and the room `_id` (`6a6de682…33e`) are three
   * different values. The caller holds the LINE id, `chat_rooms.user_id` holds
   * the member `_id`, `chat_messages.room_id` holds the room `_id`. Skipping a
   * hop finds nothing and fails silently — the last two cases pin both hops. */
  describe('retitleLatestDivider — the no-ticket path', () => {
    function makeDividerDeps(opts: {
      member?: { _id: string } | null;
      room?: { _id: string } | null;
    }) {
      const calls: Array<{ filter: Record<string, unknown>; update: unknown }> =
        [];
      const warns: string[] = [];
      const lean = (v: unknown) => ({
        select: () => ({ lean: () => ({ exec: () => Promise.resolve(v) }) }),
      });
      return {
        calls,
        warns,
        deps: {
          memberModel: {
            findOne: () =>
              lean(
                opts.member === undefined ? { _id: MEMBER_ID } : opts.member,
              ),
          } as never,
          chatRoomModel: {
            findOne: () =>
              lean(opts.room === undefined ? { _id: ROOM_ID } : opts.room),
          } as never,
          chatMessageModel: {
            findOneAndUpdate: (
              filter: Record<string, unknown>,
              update: unknown,
            ) => {
              calls.push({ filter, update });
              return { exec: () => Promise.resolve({ _id: 'divider-1' }) };
            },
          } as never,
          warn: (m: string) => void warns.push(m),
        },
      };
    }

    const run = (
      opts: Parameters<typeof makeDividerDeps>[0],
      reason = 'เนื่องจากไม่พบยอดจากรายการนี้ในระบบ',
    ) => {
      const h = makeDividerDeps(opts);
      return retitleLatestDivider(
        { channelUserId: 'Uline-id', hookId: HOOK_ID, reason },
        h.deps,
      ).then((ok) => ({ ...h, ok }));
    };

    it('rewrites the newest divider with the card wording', async () => {
      const { ok, calls } = await run({});

      expect(ok).toBe(true);
      const content = String(
        (calls[0]!.update as { $set?: { content?: unknown } })?.$set?.content ??
          '',
      );
      expect(content).toContain('เคสนี้สร้างโดยระบบ เนื่องจาก');
      expect(content).toContain('ไม่พบยอดจากรายการนี้');
    });

    it('scopes by room and only touches the latest row', async () => {
      const { calls } = await run({});

      expect(calls[0]!.filter['room_id']).toBe(ROOM_ID);
      expect(calls[0]!.filter['metadata.variant']).toBe('direct_ticket');
      expect(Object.keys(calls[0]!.filter)).not.toContain('hook_id');
    });

    // FALLBACKS — each leaves the existing divider exactly as it was.
    it('a blank reason changes nothing', async () => {
      const { ok, calls } = await run({}, '   ');
      expect(ok).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('no member ⇒ untouched (LINE id never used as a room key)', async () => {
      const { ok, calls } = await run({ member: null });
      expect(ok).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('no room ⇒ untouched', async () => {
      const { ok, calls } = await run({ room: null });
      expect(ok).toBe(false);
      expect(calls).toHaveLength(0);
    });
  });

  it('a failure inside is swallowed — the reply already went out', async () => {
    const { deps, warns } = makeDeps({ prevDetail: 'x' });
    (deps as { chatRoomModel?: unknown }).chatRoomModel = {
      findOne: () => {
        throw new Error('mongo down');
      },
    };

    await expect(
      retitleDirectTicket({ ticketId: TICKET_ID, reason: 'r' }, deps),
    ).resolves.toBe(false);
    expect(warns.join('\n')).toMatch(/could not retitle/i);
  });
});
