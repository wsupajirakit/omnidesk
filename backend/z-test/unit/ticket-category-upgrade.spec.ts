/* [FEAT-20260815-CATUPGRADE] Other → Payment, once, and only when it should
 * ===========================================================================
 * THE RULE, owner-stated 15/08/2026. An assist ticket opens as `Other` because
 * nobody yet knows what the customer wants. If a slip arrives while the room is
 * still waiting for an admin, the case IS about payment and the admin queue is
 * showing the wrong label. All four must hold together:
 *
 *   1. tickets.category === 'Other'
 *   2. chat_rooms.assist_status === true
 *   3. tickets.job_status === 0        (no admin has claimed it)
 *   4. a slip actually arrived         (the caller's job — past the QR pre-scan)
 *   + the latch: category_upgraded_at === null
 *
 * WHAT THESE PIN
 *   · every one of the five conditions is in the atomic FILTER, not read first
 *     and checked in JS — that is what makes "once" hold under concurrency
 *   · the room gate is honoured
 *   · the newest ticket is chosen when a room has several
 *   · nothing throws: the caller is on the slip path
 *
 * ⚠️ THE ID TRAP THIS GUARDS. `tickets.chat_user_id` holds the MEMBER `_id`,
 * never the LINE id the webhook is holding. A filter built on the LINE id
 * matches nothing and fails SILENTLY — the label would simply never change and
 * no error would ever appear. Case "resolves the member first" pins the hop.
 */
import {
  upgradeTicketCategoryOnSlip,
  type TicketCategoryUpgradeDeps,
} from '@/modules/tickets/ticket-category-upgrade.helper';

const LINE_ID = 'Uline-abc';
const MEMBER_ID = 'member-mongo-id';
const HOOK_ID = 'hook-mongo-id';
const TICKET_ID = 'ticket-mongo-id';

function makeDeps(opts: {
  member?: { _id: string } | null;
  room?: { assist_status?: boolean } | null;
  upgraded?: { _id: string } | null;
  throwOn?: 'member' | 'room' | 'ticket';
}) {
  const calls: Array<{
    filter: Record<string, unknown>;
    update: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];
  const logs: string[] = [];
  const warns: string[] = [];

  const leanExec = (v: unknown) => ({
    select: () => ({ lean: () => ({ exec: () => Promise.resolve(v) }) }),
  });

  const deps: TicketCategoryUpgradeDeps = {
    memberModel: {
      findOne: () => {
        if (opts.throwOn === 'member') throw new Error('member boom');
        return leanExec(
          opts.member === undefined ? { _id: MEMBER_ID } : opts.member,
        );
      },
    } as never,
    chatRoomModel: {
      findOne: () => {
        if (opts.throwOn === 'room') throw new Error('room boom');
        return leanExec(
          opts.room === undefined ? { assist_status: true } : opts.room,
        );
      },
    } as never,
    ticketModel: {
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options: Record<string, unknown>,
      ) => {
        if (opts.throwOn === 'ticket') throw new Error('ticket boom');
        calls.push({ filter, update, options });
        return leanExec(
          opts.upgraded === undefined ? { _id: TICKET_ID } : opts.upgraded,
        );
      },
    } as never,
    log: (m: string) => void logs.push(m),
    warn: (m: string) => void warns.push(m),
  };
  return { deps, calls, logs, warns };
}

const run = (opts: Parameters<typeof makeDeps>[0] = {}) => {
  const h = makeDeps(opts);
  return upgradeTicketCategoryOnSlip(
    { channelUserId: LINE_ID, hookId: HOOK_ID },
    h.deps,
  ).then((res) => ({ ...h, res }));
};

describe('[CATUPGRADE] a slip upgrades an unclaimed Other ticket to Payment', () => {
  it('upgrades and reports the ticket id', async () => {
    const { res, calls, logs } = await run();

    expect(res).toBe(TICKET_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.update['$set']).toMatchObject({ category: 'Payment' });
    expect(logs.join('\n')).toContain('[CATUPGRADE]');
  });

  it('stamps category_upgraded_at with a real date', async () => {
    const { calls } = await run();

    const set = calls[0]!.update['$set'] as Record<string, unknown>;
    expect(set['category_upgraded_at']).toBeInstanceOf(Date);
  });

  /* ── THE FIVE CONDITIONS MUST BE IN THE FILTER ──────────────────────────
     Not read-then-check in JS: only a filter makes the check and the write one
     atomic operation, which is what stops two concurrent slips from both
     "winning". Delete any one of these lines from the helper and the matching
     assertion below goes red. */
  it('puts category:Other in the filter — never touches a hand-set category', async () => {
    const { calls } = await run();
    expect(calls[0]!.filter['category']).toBe('Other');
  });

  it('puts job_status:0 in the filter — never touches a claimed or closed ticket', async () => {
    const { calls } = await run();
    expect(calls[0]!.filter['job_status']).toBe(0);
  });

  it('puts the latch in the filter — this is what makes it run only once', async () => {
    const { calls } = await run();
    expect(calls[0]!.filter['category_upgraded_at']).toBeNull();
  });

  it('scopes the filter to this member and this hook', async () => {
    const { calls } = await run();
    expect(calls[0]!.filter['chat_user_id']).toBe(MEMBER_ID);
    expect(calls[0]!.filter['hook_id']).toBe(HOOK_ID);
  });

  it('picks the NEWEST ticket when a room has several', async () => {
    const { calls } = await run();
    expect(calls[0]!.options['sort']).toEqual({ created_at: -1 });
  });

  /* ── THE ROOM GATE ─────────────────────────────────────────────────────── */
  it('does nothing when the room is not waiting for an admin', async () => {
    const { res, calls } = await run({ room: { assist_status: false } });

    expect(res).toBeNull();
    expect(calls).toHaveLength(0); // never even reaches the ticket write
  });

  it('does nothing when there is no room at all', async () => {
    const { res, calls } = await run({ room: null });
    expect(res).toBeNull();
    expect(calls).toHaveLength(0);
  });

  /* ── THE ID HOP ────────────────────────────────────────────────────────── */
  it('resolves the member first — the LINE id is never used as a ticket key', async () => {
    const { calls } = await run();

    expect(calls[0]!.filter['chat_user_id']).toBe(MEMBER_ID);
    expect(calls[0]!.filter['chat_user_id']).not.toBe(LINE_ID);
  });

  it('does nothing when the member cannot be resolved', async () => {
    const { res, calls } = await run({ member: null });
    expect(res).toBeNull();
    expect(calls).toHaveLength(0);
  });

  /* ── ORDINARY NO-OPS — not errors ──────────────────────────────────────── */
  it('returns null when no ticket matched, without warning', async () => {
    const { res, warns } = await run({ upgraded: null });

    expect(res).toBeNull();
    expect(warns).toHaveLength(0); // a miss is the common case, not a fault
  });

  it.each([
    ['', HOOK_ID],
    [LINE_ID, null],
    ['', null],
  ])('does nothing with missing ids (%p, %p)', async (uid, hid) => {
    const { deps, calls } = makeDeps({});
    const res = await upgradeTicketCategoryOnSlip(
      { channelUserId: uid, hookId: hid },
      deps,
    );
    expect(res).toBeNull();
    expect(calls).toHaveLength(0);
  });

  /* ── THE SAFETY PROPERTY — a label must never fail a slip ───────────────── */
  it.each(['member', 'room', 'ticket'] as const)(
    'swallows a failure at the %s step and warns instead of throwing',
    async (stage) => {
      const h = makeDeps({ throwOn: stage });

      await expect(
        upgradeTicketCategoryOnSlip(
          { channelUserId: LINE_ID, hookId: HOOK_ID },
          h.deps,
        ),
      ).resolves.toBeNull();
      expect(h.warns.join('\n')).toMatch(/CATUPGRADE/);
    },
  );

  /* ── [FEAT-20260815-CATUPGRADELOG] the durable audit row ────────────────
     The console line is gone on restart, and `category_upgraded_at` says WHEN
     but not WHY or FROM WHAT. This is code that edits a ticket an admin is
     looking at, so the change must be answerable after the fact. */
  describe('webhook_logs audit row', () => {
    const withLog = async (opts: Parameters<typeof makeDeps>[0] = {}) => {
      const entries: Array<Record<string, unknown>> = [];
      const h = makeDeps(opts);
      const res = await upgradeTicketCategoryOnSlip(
        {
          channelUserId: LINE_ID,
          hookId: HOOK_ID,
          logContext: { hook_alias: 'omnideskdevoa', group_id: 'grp-1' },
          slipRecordId: 'slip-1',
        },
        {
          ...h.deps,
          persistWebhookLog: (e) => {
            entries.push(e);
            return Promise.resolve();
          },
        },
      );
      return { ...h, entries, res };
    };

    it('writes one row naming the ticket and the transition', async () => {
      const { entries } = await withLog();

      expect(entries).toHaveLength(1);
      expect(entries[0]!['action_type']).toBe('ticket_category_upgrade');
      const p = entries[0]!['payload_summary'] as Record<string, unknown>;
      expect(p['ticket_id']).toBe(TICKET_ID);
      expect(p['from']).toBe('Other');
      expect(p['to']).toBe('Payment');
      expect(String(p['reason'])).toContain('slip');
      expect(p['slip_record_id']).toBe('slip-1');
    });

    it('carries the caller logContext so the row is filterable', async () => {
      const { entries } = await withLog();

      expect(entries[0]!['hook_alias']).toBe('omnideskdevoa');
      expect(entries[0]!['group_id']).toBe('grp-1');
    });

    /* No row when nothing changed — a no-op is not an event. */
    it.each([
      ['no ticket matched', { upgraded: null }],
      ['room not waiting', { room: { assist_status: false } }],
      ['member unresolved', { member: null }],
    ])('writes NO row when %s', async (_label, opts) => {
      const { entries } = await withLog(opts);
      expect(entries).toHaveLength(0);
    });

    /* THE SAFETY PROPERTY: the upgrade already happened; a failing log write
       must not turn a completed change into an error. */
    it('still reports success when the log write throws', async () => {
      const h = makeDeps({});
      const res = await upgradeTicketCategoryOnSlip(
        { channelUserId: LINE_ID, hookId: HOOK_ID },
        {
          ...h.deps,
          persistWebhookLog: () => Promise.reject(new Error('log boom')),
        },
      );

      expect(res).toBeNull(); // swallowed by the outer catch
      expect(h.warns.join('\n')).toMatch(/CATUPGRADE/);
      // the DB write still went out before the log attempt
      expect(h.calls).toHaveLength(1);
    });

    /* Backwards compatible: a caller that does not pass the pipe still works. */
    it('works without persistWebhookLog at all', async () => {
      const { res, calls } = await run();
      expect(res).toBe(TICKET_ID);
      expect(calls).toHaveLength(1);
    });
  });

  /* ── [FEAT-20260815-CATUPGRADEWS] the card relabels without a refresh ────
     The FE has handled `ticket:updated` since [FIX-20260728-REALTIME-SCALE];
     only the emitter was missing. These pin the contract BOTH ends enforce. */
  describe('ticket:updated realtime event', () => {
    const withWs = async (opts: Parameters<typeof makeDeps>[0] = {}) => {
      const events: Array<Record<string, unknown>> = [];
      const h = makeDeps(opts);
      const res = await upgradeTicketCategoryOnSlip(
        { channelUserId: LINE_ID, hookId: HOOK_ID },
        { ...h.deps, publishTicketUpdated: (d) => void events.push(d) },
      );
      return { ...h, events, res };
    };

    it('emits once with the new category', async () => {
      const { events } = await withWs();

      expect(events).toHaveLength(1);
      expect(events[0]!['_id']).toBe(TICKET_ID);
      expect(events[0]!['category']).toBe('Payment');
    });

    /* BOTH ends drop a payload without a string hook_id — the publisher at
       realtime-publisher.service.ts:73 and the page at TicketSupport.tsx:818.
       A non-string would vanish with no error anywhere.
       ⚠️ The hookId here is an OBJECT on purpose: a plain string would pass this
       test even if the helper stopped coercing, which is what mutation M1
       exposed on the first version of this case. */
    it('coerces hook_id to a STRING, or the event is dropped silently', async () => {
      const objectIdLike = {
        toString: () => 'hook-oid-as-string',
      };
      const events: Array<Record<string, unknown>> = [];
      const h = makeDeps({});

      await upgradeTicketCategoryOnSlip(
        { channelUserId: LINE_ID, hookId: objectIdLike },
        { ...h.deps, publishTicketUpdated: (d) => void events.push(d) },
      );

      expect(typeof events[0]!['hook_id']).toBe('string');
      expect(events[0]!['hook_id']).toBe('hook-oid-as-string');
    });

    it.each([
      ['no ticket matched', { upgraded: null }],
      ['room not waiting', { room: { assist_status: false } }],
      ['member unresolved', { member: null }],
    ])('emits NOTHING when %s', async (_label, opts) => {
      const { events } = await withWs(opts);
      expect(events).toHaveLength(0);
    });

    /* A broken publisher must not undo an upgrade that already landed. */
    it('survives a throwing publisher and still reports the upgrade', async () => {
      const h = makeDeps({});
      const res = await upgradeTicketCategoryOnSlip(
        { channelUserId: LINE_ID, hookId: HOOK_ID },
        {
          ...h.deps,
          publishTicketUpdated: () => {
            throw new Error('ws boom');
          },
        },
      );

      expect(res).toBe(TICKET_ID); // the ticket WAS upgraded
      expect(h.warns.join('\n')).toMatch(/realtime publish failed/i);
    });

    it('works without the publisher at all', async () => {
      const { res } = await run();
      expect(res).toBe(TICKET_ID);
    });
  });

  /* ── ONE DIRECTION ONLY ────────────────────────────────────────────────── */
  it('never writes anything other than Payment + the timestamp', async () => {
    const { calls } = await run();

    const set = calls[0]!.update['$set'] as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual([
      'category',
      'category_upgraded_at',
    ]);
    expect(set['category']).toBe('Payment');
  });
});
