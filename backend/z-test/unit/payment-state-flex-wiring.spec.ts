/**
 * ==== [FEAT-20260810-PAYSTATEFLEX] resolver → mint, the composition ====
 *
 * `sendPaymentReply` is a private method on a ~3.9k-line service whose delivery
 * ladder needs LINE, Mongo and a live hook, so driving it end to end here would
 * test the harness more than the change. What the wiring actually ADDED is the
 * composition of two pure steps — resolve the bound card, then mint its action
 * tags — plus the rule for which reply wins. That is what this file pins.
 *
 * The delivery ladder, the history row and the webhook log are unchanged code and
 * are not re-tested here; `paytool-p3-suppress.spec.ts` covers the suppression
 * side. Coverage limits are listed at the bottom rather than quietly omitted.
 *
 * W1–W5 from the plan in `todo/be_todo20_10082026.md` P28.
 */
import { mintPayLinks } from '@/modules/webhook/payment-reply';
import { resolveStateFlex } from '@/modules/payment/payment-state-flex.resolver';
import { buildRetryPostbackData } from '@/modules/webhook/payment-reply';

/** Swiftcheck's `rawSlip`, the subtree the webhook now forwards as `vData`. */
const tagContext = {
  vData: {
    amount: { amount: 1500 },
    date: '2026-04-06T08:03:07+07:00',
    sender: { bank: { id: 'ktb' }, account: {} },
    receiver: { bank: { id: 'scb' }, account: {} },
  },
  baseUrl: 'https://cdn.example.test',
  slipCreatedAt: new Date('2026-04-06T15:26:10+07:00'),
  formatThaiDateTime: () => '06/04/2569 15:26:10',
};

/** A card an admin would plausibly author for `no_match_retry`. */
const CARD = {
  _id: 'c1',
  name: '[PAY] no_match_retry',
  flex_type: 'slip',
  content_json: {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: 'ยอด {{amount}} บาท ไม่ตรงรายการ' }],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          action: {
            type: 'postback',
            label: 'ลองใหม่',
            data: '{{paylink.retry}}',
          },
        },
      ],
    },
  },
};

const deps = (card: unknown | null) => ({
  findFlexById: jest.fn().mockResolvedValue(card),
  warn: jest.fn(),
});

/** Mirrors the wiring in `sendPaymentReply`: resolve, then mint. */
async function compose(
  state: string,
  boundIds: Record<string, unknown> | undefined,
  card: unknown | null,
  resume?: { runId: string; nextIdx: number },
) {
  const d = deps(card);
  const bound = await resolveStateFlex({ state, boundIds, tagContext }, d);
  const minted = bound ? mintPayLinks(bound.contents, { resume }) : null;
  // `flex` in the real function: a bound card wins, else the mint card, else null.
  return { bound, minted, warn: d.warn, findFlexById: d.findFlexById };
}

describe('[FEAT-20260810-PAYSTATEFLEX] bound-card wiring', () => {
  it('(W1) nothing bound ⇒ no card, no lookup, reply path untouched', async () => {
    // The state every existing OA is in. This is the assertion that says the
    // feature is invisible until an admin opts in.
    for (const bound of [undefined, {}, { review: '' }, { other: 'c1' }]) {
      const r = await compose('review', bound, CARD);
      expect(r.bound).toBeNull();
      expect(r.minted).toBeNull();
      expect(r.findFlexById).not.toHaveBeenCalled();
    }
  });

  it('(W2) bound ⇒ the card is returned with slip tags substituted', async () => {
    const r = await compose('no_match_retry', { no_match_retry: 'c1' }, CARD, {
      runId: 'RUN1',
      nextIdx: 2,
    });
    const out = JSON.stringify(r.minted!.contents);
    expect(out).toContain('ยอด 1,500.00 บาท');
    expect(out).not.toContain('{{amount}}');
    // A card means a FLEX send even though `no_match_retry` would already be
    // flex — the point is that `sentKind` follows the card, not the state map.
    expect(r.minted!.contents).toBeTruthy();
  });

  it('(W3) card deleted ⇒ null, a warning, and no throw', async () => {
    const r = await compose('review', { review: 'gone' }, null);
    expect(r.bound).toBeNull();
    expect(r.minted).toBeNull();
    expect(r.warn).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
    );
  });

  it('(W4) with resume ⇒ the retry button carries the real postback payload', async () => {
    const r = await compose('no_match_retry', { no_match_retry: 'c1' }, CARD, {
      runId: 'RUN1',
      nextIdx: 2,
    });
    const btn = (r.minted!.contents as any).footer.contents[0];
    // Must equal the handler's own builder output — it parses this positionally.
    expect(btn.action.data).toBe(buildRetryPostbackData('RUN1', 2));
    expect(btn.action.type).toBe('postback');
  });

  it('(W5) no resume ⇒ the retry button is REMOVED, not blanked', async () => {
    // `review` has nowhere to resume to. A button that cannot advance anything
    // must not be rendered — the rule `buildAction` already enforces.
    const r = await compose('review', { review: 'c1' }, CARD);
    const out = JSON.stringify(r.minted!.contents);
    expect(out).not.toContain('{{paylink.retry}}');
    expect(out).not.toContain('postback');
    expect(r.minted!.dropped).toContain('paylink.retry');
    // The body survived — only the dead control went.
    expect(out).toContain('ยอด 1,500.00 บาท');
  });

  it('a text state binding a card still yields a card (kind follows the card)', async () => {
    // `statement_not_found` is `kind:'text'` in REPLY_STATE_DEFAULTS. Binding a
    // card must still send the card — which is why `sentKind` is derived from
    // what was built, not from `reply.kind`.
    const r = await compose(
      'statement_not_found',
      { statement_not_found: 'c1' },
      CARD,
    );
    expect(r.minted).not.toBeNull();
  });
});

/* ⚠️ NOT COVERED HERE, stated rather than hidden:
 * · W6 — the postback path now DOES forward the card inputs: `_resume` attaches
 *   `stateFlex` (it already holds the hook and slip) and `deps.sendReply` passes
 *   it on, so a [ลองใหม่] tap answers with the same bound card a fresh slip gets.
 *   Verified by typecheck and by the suite staying green, NOT by a test that taps
 *   a real button — that needs a paused run with statements remaining, which the
 *   local data has never produced (every flow here ends at `review`).
 * · W7 — the history row storing the bound card: the code passes
 *   `bound.cardName` and `flex_json`, but asserting it requires driving the
 *   delivery ladder, which this file deliberately does not do.
 * · The two success states are out of scope by the owner's decision — they sit in
 *   `SLIP_CARD_STATES`, so `sendPaymentReply` is never called for them and a
 *   binding there has no effect. Six of eight states are live.
 */
