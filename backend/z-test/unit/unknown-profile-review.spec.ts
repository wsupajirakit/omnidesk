/**
 * [FEAT-20260907-UNKNOWNPROFILEREVIEW] The third answer to the profile lookup.
 * ============================================================================
 * The lookup can say three things and only two were ever acted on. This pins the
 * third — "it ran and failed" — and, just as importantly, pins the boundaries
 * around it, because every one of them is a way to break something that works:
 *
 *   · a 404 must still take the REFUSAL path, byte for byte as before
 *   · a fetch that never ran must still change nothing
 *   · an OA with no `is_profile` endpoint must not have every slip reviewed
 *   · an OA that does not require a profile must not be touched at all
 *
 * The truth table is written out rather than generated: each row is a decision
 * somebody has to be able to disagree with by reading it.
 */
/* Relative, not `@/modules/...` — the barrel rule bans deep aliased paths, and the
   relative form is what every sibling spec that reaches a module internal uses
   (`bank-logo-code-map.spec.ts` does it into this very folder). */
import { replyUnknownProfileReview } from '../../src/modules/webhook/hook-reply/unknown-profile-review.handler';
import {
  shouldBlockUnlinkedSlip,
  shouldReviewUnknownProfile,
} from '../../src/modules/webhook/slip-flex/require-profile.gate';

/** A hook with the policy switched on — the only shape either rule looks at. */
const ON = { slip_require_profile: true } as Record<string, unknown>;
const OFF = { slip_require_profile: false } as Record<string, unknown>;

describe('[FEAT-20260907-UNKNOWNPROFILEREVIEW] shouldReviewUnknownProfile', () => {
  describe('says YES only when the lookup ran and failed', () => {
    it.each([
      ['a 500', { status: 500, data: { message: 'boom' } }],
      ['a 502 from a gateway', { status: 502 }],
      ['a refused token (401)', { status: 401 }],
      ['a forbidden token (403)', { status: 403 }],
      ['a timeout body with no status', { success: false, error: 'ETIMEDOUT' }],
      ['a numeric-string 500', { status: '500' }],
    ])('%s', (_label, block) => {
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: block,
          circuitOpen: false,
        }),
      ).toBe(true);
    });

    it('and when the circuit breaker fired, which is a failing upstream by definition', () => {
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: null,
          circuitOpen: true,
        }),
      ).toBe(true);
    });

    it('the breaker wins even if a stale block is still attached', () => {
      /* A short-circuited call can leave the previous answer behind. Reading it
         as this turn's verdict is how a customer gets a decision made from
         somebody else's data. */
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: { success: true },
          circuitOpen: true,
        }),
      ).toBe(true);
    });
  });

  describe('says NO when the answer was conclusive', () => {
    it('the customer exists', () => {
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: { success: true, data: {} },
          circuitOpen: false,
        }),
      ).toBe(false);
    });

    it.each([
      ['404 as a number', { status: 404 }],
      ['404 as a string', { status: '404' }],
    ])('%s belongs to the refusal path, not here', (_l, block) => {
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: block,
          circuitOpen: false,
        }),
      ).toBe(false);
    });
  });

  describe('says NO when no attempt was made — the two that would review everything', () => {
    it('the fetch never ran (`undefined`)', () => {
      /* `build-turn-context.ts:64-68`: undefined means "never ran", null means
         "ran and found nothing". Treating undefined as a failure would review
         every turn that never reaches the fetch. */
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: undefined,
          circuitOpen: false,
        }),
      ).toBe(false);
    });

    it('no endpoint carries the `is_profile` flag (`null`)', () => {
      /* `combined-profile.ts:144-147` sets null exactly then, and
         `:207-210` reports it as a configuration mistake. An OA in that state
         would otherwise have EVERY slip sent to a human. */
      expect(
        shouldReviewUnknownProfile(ON, {
          profileBlock: null,
          circuitOpen: false,
        }),
      ).toBe(false);
    });
  });

  describe('is gated by the same switch as its sibling', () => {
    it('an OA that does not require a profile is untouched', () => {
      expect(
        shouldReviewUnknownProfile(OFF, {
          profileBlock: { status: 500 },
          circuitOpen: false,
        }),
      ).toBe(false);
    });

    it('a missing hook decides nothing', () => {
      expect(
        shouldReviewUnknownProfile(null, {
          profileBlock: { status: 500 },
          circuitOpen: false,
        }),
      ).toBe(false);
    });

    it('the switch is read strictly — a truthy string does not turn it on', () => {
      expect(
        shouldReviewUnknownProfile(
          { slip_require_profile: 'true' },
          {
            profileBlock: { status: 500 },
            circuitOpen: false,
          },
        ),
      ).toBe(false);
    });
  });

  describe('🔴 the two rules can never both be true for one turn', () => {
    it.each([
      ['a 404', { status: 404 }],
      ['a 500', { status: 500 }],
      ['a success', { success: true }],
      ['no block', null],
    ])('%s', (_l, block) => {
      const probe = { profileBlock: block, circuitOpen: false };
      const refuse = shouldBlockUnlinkedSlip(ON, probe);
      const review = shouldReviewUnknownProfile(ON, probe);
      expect(refuse && review).toBe(false);
    });

    it('and the 404 refusal is still exactly what it was', () => {
      expect(
        shouldBlockUnlinkedSlip(ON, {
          profileBlock: { status: 404 },
          circuitOpen: false,
        }),
      ).toBe(true);
    });

    it.each([
      ['no block at all', null],
      ['the fetch never ran', undefined],
      ['a 500', { status: 500 }],
      ['an open circuit', null],
    ])('the refusal still fails open on %s', (_l, block) => {
      /* Found by a mutation that SURVIVED: flipping `shouldBlockUnlinkedSlip`'s
         "no block ⇒ false" to `true` reddened nothing, because every case that
         reached it only ever asserted the two rules were not both true — which
         stays satisfied when the wrong one is. The sibling's own fail-open
         promise had no direct assertion anywhere. It has one now.
         mutation ที่รอด = ช่องโหว่ของเทส ไม่ใช่โค้ดที่ปลอดภัย */
      expect(
        shouldBlockUnlinkedSlip(ON, {
          profileBlock: block,
          circuitOpen: _l === 'an open circuit',
        }),
      ).toBe(false);
    });
  });
});

describe('[FEAT-20260907-UNKNOWNPROFILEREVIEW] replyUnknownProfileReview', () => {
  const args = {
    hook: {
      _id: 'h1',
      channel_type: 'line',
      payment_flex_ids: { review: 'card-1' },
    } as Record<string, unknown>,
    userId: 'U1',
    channelId: 'C1',
    replyToken: 'RT',
    eventId: 'E1',
  };

  const card = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text: 'auto check ไม่ได้' }],
    },
  };

  function deps(
    over: Partial<Parameters<typeof replyUnknownProfileReview>[1]> = {},
  ) {
    const sent: unknown[] = [];
    const rows: Record<string, unknown>[] = [];
    const logs: string[] = [];
    return {
      sent,
      rows,
      logs,
      d: {
        findFlexById: () =>
          Promise.resolve({
            _id: 'card-1',
            flex_name: 'PAYreview',
            flex_type: 'slip',
            content_json: card,
          }),
        log: (m: string) => logs.push(m),
        sendFlexReply: (...a: unknown[]) => {
          sent.push(a);
          return Promise.resolve({ status: 200 });
        },
        logBotMessage: (row: Record<string, unknown>) => rows.push(row),
        ...over,
      },
    };
  }

  it('sends the card bound to `review` and reports that the turn is finished', async () => {
    const { d, sent } = deps();
    await expect(replyUnknownProfileReview(args, d)).resolves.toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('🔴 reads the card id from the hook — nothing is named in code', async () => {
    let asked = '';
    const { d } = deps({
      findFlexById: (id: string) => {
        asked = id;
        return Promise.resolve(null);
      },
    });
    await replyUnknownProfileReview(args, d);
    expect(asked).toBe('card-1');
  });

  it('🔴 no card bound ⇒ false, so the caller carries on exactly as before', async () => {
    const { d, sent } = deps();
    const bare = { ...args, hook: { _id: 'h1' } as Record<string, unknown> };
    await expect(replyUnknownProfileReview(bare, d)).resolves.toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('a bound-then-deleted card also leaves the turn unchanged', async () => {
    const { d, sent } = deps({ findFlexById: () => Promise.resolve(null) });
    await expect(replyUnknownProfileReview(args, d)).resolves.toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('mirrors the card to the room, naming WHY the slip was never checked', async () => {
    const { d, rows } = deps();
    await replyUnknownProfileReview(args, d);
    expect(rows).toHaveLength(1);
    const meta = rows[0]?.['metadata'] as Record<string, unknown>;
    expect(meta['reason']).toBe('slip_review_unknown_profile');
    expect(rows[0]?.['messageType']).toBe('flex');
  });

  it('🔴 no raw {{tag}} reaches the customer', async () => {
    /* The SHAPE IS COPIED FROM THE SHIPPED CARD, not invented: `PAYreview`
       (`a0d00000000000000000008c`) puts `{{paylink.contact_admin}}` in a
       button's `action.text`, and `mintPayLinks` mints ACTIONS. The first
       version of this case put the tag in a bare text node, watched it come out
       unminted and read that as a defect — it was a fixture that no card
       resembles. รูปของ fixture ต้องเป็นรูปของการ์ดจริง ไม่งั้นจับผิดเรื่อง
       Sending this unminted is the failure the flow bench's S9/S11f rows catch. */
    const withTag = {
      type: 'bubble',
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'message',
              label: 'ติดต่อแอดมิน',
              text: '{{paylink.contact_admin}}',
            },
          },
        ],
      },
    };
    const { d, sent } = deps({
      findFlexById: () =>
        Promise.resolve({
          _id: 'card-1',
          flex_name: 'PAYreview',
          flex_type: 'slip',
          content_json: withTag,
        } as Record<string, unknown>),
    });
    await replyUnknownProfileReview(args, d);
    expect(JSON.stringify(sent[0])).not.toContain('{{paylink');
  });
});
