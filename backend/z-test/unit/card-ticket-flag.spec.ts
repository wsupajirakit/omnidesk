/**
 * ==== [FEAT-20260810-CARDTICKET] the per-card "open a direct ticket" flag ====
 *
 * Owner's rule: a card bound to a reply state may carry its own flag plus the reason
 * an admin reads, and when the card is used its wording wins — without changing the
 * payment flow, because the flag is about the REPLY, not about money.
 *
 * What this file pins is the DECISION LAYER, in two halves that can be tested
 * honestly without a Nest container:
 *   · the resolver surfacing the flag (F1/F2 — read straight from the card)
 *   · `retitleDirectTicket` (F5/F7 — the append rule that keeps the amounts line)
 *
 * ⚠️ NOT covered here, stated rather than implied: the wiring inside
 * `sendPaymentReply` that calls these two. It is a private method behind LINE, Mongo
 * and a live hook, so driving it would test the harness. F3 (nothing delivered ⇒ no
 * ticket) is enforced structurally — `cardTicket()` is called only after a
 * successful send, never in a `finally` — and that placement is asserted by reading
 * the file, not by a mock. F6 is covered by the existing runner suite staying green.
 */
import { resolveStateFlex } from '@/modules/payment/payment-state-flex.resolver';
import { retitleDirectTicket } from '@/modules/payment/payment-ticket.helper';

const tagContext = {
  vData: { amount: { amount: 100 }, sender: {}, receiver: {} },
  baseUrl: 'https://x.test',
  slipCreatedAt: null,
  formatThaiDateTime: () => 'now',
};

const CARD = {
  _id: 'c1',
  name: '[PAY] review',
  flex_type: 'slip',
  content_json: { type: 'bubble', body: { text: 'ยอด {{amount}}' } },
};

const deps = (card: unknown) => ({
  findFlexById: jest.fn().mockResolvedValue(card),
  warn: jest.fn(),
});

describe('[FEAT-20260810-CARDTICKET] resolver surfaces the flag', () => {
  it('(F1) a card without the fields reads as OFF — the seamless promise', async () => {
    // Every card in the database today is this case: no flag, no text, so the
    // delivery layer must do nothing at all.
    const r = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'c1' }, tagContext },
      deps(CARD),
    );
    expect(r!.ticketOnReply).toBe(false);
    expect(r!.ticketText).toBe('');
  });

  it('(F2) flag ON with text is carried out verbatim', async () => {
    const r = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'c1' }, tagContext },
      deps({
        ...CARD,
        direct_ticket_on_reply: true,
        direct_ticket_text: '  ลูกค้าโอนผิดบัญชี  ',
      }),
    );
    expect(r!.ticketOnReply).toBe(true);
    // Trimmed, because it is pasted into "เคสนี้สร้างโดยระบบ เนื่องจาก …".
    expect(r!.ticketText).toBe('ลูกค้าโอนผิดบัญชี');
  });

  it('(F2b) a truthy-but-not-true flag is NOT treated as on', async () => {
    // Guards against a string "false" or 1 from an older write path flipping a
    // ticket on by accident.
    for (const bad of ['false', 'true', 1, 0, null]) {
      const r = await resolveStateFlex(
        { state: 'review', boundIds: { review: 'c1' }, tagContext },
        deps({ ...CARD, direct_ticket_on_reply: bad }),
      );
      expect(r!.ticketOnReply).toBe(false);
    }
  });

  it('(F5) flag ON with EMPTY text still resolves — caller supplies a fallback', async () => {
    const r = await resolveStateFlex(
      { state: 'review', boundIds: { review: 'c1' }, tagContext },
      deps({
        ...CARD,
        direct_ticket_on_reply: true,
        direct_ticket_text: '   ',
      }),
    );
    expect(r!.ticketOnReply).toBe(true);
    expect(r!.ticketText).toBe('');
  });
});

describe('[FEAT-20260810-CARDTICKET] retitleDirectTicket', () => {
  const model = (existing: unknown) => {
    const updateOne = jest.fn(() => ({ exec: () => Promise.resolve({}) }));
    return {
      updateOne,
      findById: jest.fn(() => ({
        select: () => ({
          lean: () => ({ exec: () => Promise.resolve(existing as never) }),
        }),
      })),
    };
  };
  const detailOf = (m: { updateOne: jest.Mock }) =>
    (m.updateOne.mock.calls[0][1] as { $set: { direct_ticket_detail: string } })
      .$set.direct_ticket_detail;

  it('(F7 ★) APPENDS — the amounts line survives, card reason goes first', async () => {
    // statement_not_found puts the real amounts here and they cannot be recomputed
    // at delivery time. Overwriting would delete what an admin was just shown.
    const m = model({
      direct_ticket_detail: 'ยอดในสลิป 2,094 บาท · รายการรอฝาก 400 / 100 บาท',
    });
    const ok = await retitleDirectTicket(
      { ticketId: 'T1', reason: 'ลูกค้าโอนผิดบัญชี' },
      { ticketModel: m as never, warn: jest.fn() },
    );
    expect(ok).toBe(true);
    expect(detailOf(m)).toBe(
      'ลูกค้าโอนผิดบัญชี · ยอดในสลิป 2,094 บาท · รายการรอฝาก 400 / 100 บาท',
    );
  });

  it('uses the reason alone when there is nothing to keep', async () => {
    const m = model({ direct_ticket_detail: '' });
    await retitleDirectTicket(
      { ticketId: 'T1', reason: 'ลูกค้าโอนผิดบัญชี' },
      { ticketModel: m as never, warn: jest.fn() },
    );
    expect(detailOf(m)).toBe('ลูกค้าโอนผิดบัญชี');
  });

  it('does not stack the same reason twice on a re-delivery', async () => {
    // A push retry after a failed reply token must not produce
    // "reason · reason · amounts".
    const m = model({ direct_ticket_detail: 'ลูกค้าโอนผิดบัญชี · ยอด 100' });
    await retitleDirectTicket(
      { ticketId: 'T1', reason: 'ลูกค้าโอนผิดบัญชี' },
      { ticketModel: m as never, warn: jest.fn() },
    );
    expect(detailOf(m)).toBe('ลูกค้าโอนผิดบัญชี · ยอด 100');
  });

  it('does nothing without a ticket id or without a reason', async () => {
    const m = model({ direct_ticket_detail: 'x' });
    expect(
      await retitleDirectTicket(
        { ticketId: '', reason: 'r' },
        { ticketModel: m as never, warn: jest.fn() },
      ),
    ).toBe(false);
    expect(
      await retitleDirectTicket(
        { ticketId: 'T1', reason: '   ' },
        { ticketModel: m as never, warn: jest.fn() },
      ),
    ).toBe(false);
    expect(m.updateOne).not.toHaveBeenCalled();
  });

  it('(F4) a ticket that no longer exists is skipped, not written', async () => {
    const m = model(null);
    expect(
      await retitleDirectTicket(
        { ticketId: 'GONE', reason: 'r' },
        { ticketModel: m as never, warn: jest.fn() },
      ),
    ).toBe(false);
    expect(m.updateOne).not.toHaveBeenCalled();
  });

  it('NEVER THROWS — the customer has already been answered', async () => {
    // The reply is out the door by the time this runs, so a database failure here
    // must not turn a completed run into an error.
    const warn = jest.fn();
    const boom = {
      findById: jest.fn(() => {
        throw new Error('mongo down');
      }),
      updateOne: jest.fn(),
    };
    await expect(
      retitleDirectTicket(
        { ticketId: 'T1', reason: 'r' },
        { ticketModel: boom as never, warn },
      ),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not retitle'),
    );
  });
});

describe('[FEAT-20260810-CARDTICKET] structural guarantees', () => {
  it('(F3 ★) the flag fires ONLY after a successful send, never in a finally', () => {
    // Asserted against the source because the alternative — mocking LINE, Mongo and
    // a hook to drive a private method — would test the harness instead of the rule.
    // If this ever moves into a finally/catch, a customer who received nothing would
    // still get an admin promised on their behalf.
    const src = require('node:fs').readFileSync(
      require('node:path').join(
        __dirname,
        '../../src/modules/webhook/webhook.service.ts',
      ),
      'utf8',
    ) as string;

    // Called exactly twice: once per delivery success path (reply, then push).
    const calls = src.match(/^\s*cardTicket\(\);/gm) ?? [];
    expect(calls).toHaveLength(2);

    /* Each call must sit IMMEDIATELY after a logHistory() on the same success path.
       [FEAT-20260827-PUSHCORE-B] matched by pattern rather than by an exact
       8-space literal. The rule is adjacency — `cardTicket()` on the line right
       after `logHistory()`, nothing between them — and that is unchanged. What
       changed is only the indentation: candidate B lifted these two blocks out of
       the reply/push try/catch (the ladder moved to payment-reply/
       payment-send.ladder.ts), so they now sit one level shallower. Pinning the
       whitespace instead of the rule made this red for a reason that has nothing
       to do with what it guards. `[^\n]*` still forbids anything on the line
       between them, so an inserted statement is caught exactly as before.
       ปักที่กฎ ไม่ใช่ที่ระยะเยื้อง */
    expect(src).toMatch(/logHistory\('reply'\);[^\n]*\n\s*cardTicket\(\);/);
    expect(src).toMatch(/logHistory\('push'\);[^\n]*\n\s*cardTicket\(\);/);

    // And must never appear inside a finally block.
    expect(/finally\s*\{[^}]*cardTicket\(\)/s.test(src)).toBe(false);
  });
});
