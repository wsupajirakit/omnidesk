import {
  isCustomerRegisterKeyword,
  isReplyStale,
  LEGACY_OFF_TEXT,
  REPLY_STALE_MS,
  resolveStatusOffReply,
  routeEvent,
  type RoutingEvent,
  type RoutingHook,
  type RoutingInput,
} from '@/modules/webhook/webhook-routing';

/**
 * The branch inventory, executable.
 *
 * Every case names the legacy line it pins and asserts `reachesAi`, because the
 * question this whole port has to answer safely is "which inbound events can
 * cost money". Exactly one outcome may say true.
 */

const msg = (
  type: string,
  extra: Partial<RoutingEvent> = {},
): RoutingEvent => ({
  type: 'message',
  replyToken: 'rt',
  timestamp: Date.now(),
  source: { userId: 'U1' },
  message: { type, text: type === 'text' ? 'สวัสดี' : undefined },
  ...extra,
});

const route = (input: Partial<RoutingInput> & Pick<RoutingInput, 'event'>) =>
  routeEvent({ hook: { status: 1 }, ...input });

describe('routeEvent — reception and routing', () => {
  it('no events → no_event (legacy:2321)', () => {
    expect(route({ event: undefined })).toEqual({
      kind: 'no_event',
      reachesAi: false,
    });
  });

  it('unknown alias → unknown_alias, before anything else (legacy:2358)', () => {
    const out = route({ event: msg('text'), unknownAlias: true });
    expect(out.kind).toBe('unknown_alias');
  });

  it('chain-handled postback → chain_postback (legacy:2487)', () => {
    const out = route({
      event: {
        type: 'postback',
        source: { userId: 'U1' },
        postback: { data: 'hoc:1' },
      },
      chainHandledPostback: true,
    });
    expect(out.kind).toBe('chain_postback');
  });

  it('a postback the chain did NOT claim falls through to no_text', () => {
    const out = route({
      event: {
        type: 'postback',
        source: { userId: 'U1' },
        postback: { data: 'other' },
      },
      chainHandledPostback: false,
    });
    // postback.data is NOT read as user text — this is the property that keeps
    // rich-menu taps out of the model.
    expect(out).toEqual({
      kind: 'no_text',
      eventType: 'postback',
      reachesAi: false,
    });
  });

  describe.each(['sticker', 'file', 'video', 'audio'])(
    'silent type: %s',
    (type) => {
      it('is stored and answered with silence (legacy:3010)', () => {
        const out = route({ event: msg(type) });
        expect(out).toEqual({
          kind: 'silent_type',
          messageType: type,
          reachesAi: false,
        });
      });

      it('is NOT counted against quota — the gate sits above the limiter', () => {
        // Passing rateLimited: true must change nothing, because legacy returns
        // before the limiter runs. If this ever reports rate_limited, someone
        // moved the limiter up and stickers started burning quota.
        const out = route({ event: msg(type), rateLimited: true });
        expect(out.kind).toBe('silent_type');
      });
    },
  );

  it('an image IS eligible for the limiter (legacy [FIX-20260728-RATELIMIT])', () => {
    // The point of moving the limiter: images used to sail past it entirely.
    const out = route({ event: msg('image'), rateLimited: true });
    expect(out.kind).toBe('rate_limited');
  });

  it('assist mode → assist_skip (legacy:3015)', () => {
    const out = route({ event: msg('text'), skipBotProcessing: true });
    expect(out).toEqual({ kind: 'assist_skip', reachesAi: false });
  });

  it('the register keyword still answers DURING assist (legacy [FIX-20260729-CUSTREGASSIST])', () => {
    const out = route({
      event: msg('text', {
        message: { type: 'text', text: 'customer-register' },
      }),
      hook: { status: 1, customer_link_enabled: true },
      skipBotProcessing: true,
      customerRegisterHandled: true,
    });
    expect(out.kind).toBe('customer_register_keyword');
  });

  it('the register keyword on the normal path (legacy:3369)', () => {
    const out = route({
      event: msg('text', {
        message: { type: 'text', text: 'Customer-Register ' },
      }),
      hook: { status: 1, customer_link_enabled: true },
      customerRegisterHandled: true,
    });
    // Case-insensitive and trimmed, per legacy's `.trim().toLowerCase()`.
    expect(out.kind).toBe('customer_register_keyword');
  });

  it('the keyword does nothing when the OA has the feature off', () => {
    const out = route({
      event: msg('text', {
        message: { type: 'text', text: 'customer-register' },
      }),
      hook: { status: 1, customer_link_enabled: false },
      customerRegisterHandled: true,
    });
    expect(out.kind).toBe('ai_reply');
  });

  it('rate limited text → rate_limited (legacy:3301)', () => {
    expect(route({ event: msg('text'), rateLimited: true }).kind).toBe(
      'rate_limited',
    );
  });

  it('a follow event is NOT rate limited — the gate is message-only', () => {
    const out = route({
      event: { type: 'follow', replyToken: 'rt', source: { userId: 'U1' } },
      rateLimited: true,
    });
    expect(out.kind).toBe('no_text');
  });

  it('image with image_answer_text → image_answer (legacy:3392)', () => {
    const out = route({
      event: msg('image'),
      hook: { status: 1, image_answer_text: 'ได้รับรูปแล้วค่ะ' },
    });
    expect(out).toEqual({
      kind: 'image_answer',
      messageType: 'image',
      reachesAi: false,
    });
  });

  it('image with NO image_answer_text → non_text_no_answer (legacy:3855)', () => {
    const out = route({ event: msg('image'), hook: { status: 1 } });
    expect(out.kind).toBe('non_text_no_answer');
  });

  it('a location message is non-text but not auto-reply eligible', () => {
    const out = route({
      event: msg('location'),
      hook: { status: 1, image_answer_text: 'x' },
    });
    // 'location' is absent from NON_TEXT_AUTO_REPLY_TYPES, so image_answer_text
    // does not apply even though it is set.
    expect(out.kind).toBe('non_text_no_answer');
  });

  describe('OA switched off (hook.status === 0) — legacy:3859', () => {
    it('replies with the legacy wording when nothing is configured', () => {
      const out = route({ event: msg('text'), hook: { status: 0 } });
      expect(out).toEqual({
        kind: 'out_of_hours',
        silent: false,
        text: LEGACY_OFF_TEXT,
        reachesAi: false,
      });
    });

    it('replies with the operator text when set', () => {
      const out = route({
        event: msg('text'),
        hook: {
          status: 0,
          status_off_action: 'reply',
          status_off_text: '  ปิดปรับปรุง  ',
        },
      });
      expect(out).toMatchObject({
        kind: 'out_of_hours',
        silent: false,
        text: 'ปิดปรับปรุง',
      });
    });

    it('stays silent when the operator chose silent', () => {
      const out = route({
        event: msg('text'),
        hook: { status: 0, status_off_action: 'silent' },
      });
      expect(out).toMatchObject({
        kind: 'out_of_hours',
        silent: true,
        text: '',
      });
    });

    it('an unfollow has no reply token — nothing to reply to (legacy [FIX-20260728-REPLYTOKEN])', () => {
      const out = route({
        event: { type: 'unfollow', source: { userId: 'U1' } },
        hook: { status: 0 },
      });
      expect(out.kind).toBe('out_of_hours_no_reply_token');
    });

    it('a disabled OA still answers an image with image_answer_text', () => {
      // The ordering property: the non-text branch sits ABOVE the status gate.
      const out = route({
        event: msg('image'),
        hook: { status: 0, image_answer_text: 'ได้รับรูปแล้วค่ะ' },
      });
      expect(out.kind).toBe('image_answer');
    });
  });

  describe.each([
    'follow',
    'unfollow',
    'join',
    'leave',
    'memberJoined',
    'memberLeft',
    'videoPlayComplete',
    'beacon',
    'accountLink',
    'things',
    'somethingLineAddsIn2027',
  ])('event type %s', (type) => {
    it('carries no text and comes to rest at no_text (legacy:3917)', () => {
      const out = route({
        event: { type, replyToken: 'rt', source: { userId: 'U1' } },
      });
      expect(out).toEqual({
        kind: 'no_text',
        eventType: type,
        reachesAi: false,
      });
    });
  });

  it('an event with no source.userId skips the whole user block', () => {
    // Legacy wraps gates 4-8 in `if (userId)`. A sticker with no userId
    // therefore does NOT hit the silent-type gate; it falls to no_text.
    const out = route({
      event: {
        type: 'message',
        replyToken: 'rt',
        message: { type: 'sticker' },
      },
    });
    expect(out.kind).toBe('no_text');
  });

  it('a text message on a live hook is the ONLY route to the model', () => {
    const out = route({ event: msg('text') });
    expect(out).toEqual({
      kind: 'ai_reply',
      userText: 'สวัสดี',
      reachesAi: true,
    });
  });

  it('exactly one outcome in the whole matrix reaches the model', () => {
    const events: RoutingEvent[] = [
      msg('text'),
      msg('image'),
      msg('sticker'),
      msg('file'),
      msg('video'),
      msg('audio'),
      msg('location'),
      { type: 'follow', replyToken: 'rt', source: { userId: 'U1' } },
      { type: 'unfollow', source: { userId: 'U1' } },
      { type: 'postback', source: { userId: 'U1' }, postback: { data: 'x' } },
      { type: 'join', replyToken: 'rt' },
    ];
    const hooks: RoutingHook[] = [
      { status: 1 },
      { status: 0 },
      { status: 1, image_answer_text: 'x' },
      { status: 1, customer_link_enabled: true },
    ];
    const flags: Partial<RoutingInput>[] = [
      {},
      { skipBotProcessing: true },
      { rateLimited: true },
      { unknownAlias: true },
    ];

    let total = 0;
    let ai = 0;
    for (const event of events) {
      for (const hook of hooks) {
        for (const flag of flags) {
          const out = routeEvent({ event, hook, ...flag });
          total += 1;
          if (out.reachesAi) ai += 1;
        }
      }
    }
    expect(total).toBe(events.length * hooks.length * flags.length);
    // Only the plain text message, on a live hook, with no blocking flag.
    // 1 event × 4 hooks... minus the two hooks that divert it: status 0
    // (out_of_hours) leaves 3, and each of the 4 flag sets except {} diverts it.
    expect(ai).toBe(3);
  });
});

describe('resolveStatusOffReply', () => {
  it.each([
    [undefined, false, LEGACY_OFF_TEXT],
    [{}, false, LEGACY_OFF_TEXT],
    [{ status_off_action: '' }, false, LEGACY_OFF_TEXT],
    [{ status_off_action: 'reply' }, false, LEGACY_OFF_TEXT],
    [
      { status_off_action: 'reply', status_off_text: '   ' },
      false,
      LEGACY_OFF_TEXT,
    ],
    [{ status_off_action: 'silent' }, true, ''],
    [{ status_off_action: 'silent', status_off_text: 'ignored' }, true, ''],
  ])('%j → silent=%s', (hook, silent, text) => {
    expect(resolveStatusOffReply(hook as RoutingHook)).toEqual({
      silent,
      text,
    });
  });
});

describe('isCustomerRegisterKeyword', () => {
  const hook = { customer_link_enabled: true };
  it.each([
    ['customer-register', true],
    ['  customer-register  ', true],
    ['CUSTOMER-REGISTER', true],
    ['customer-register please', false],
    ['register', false],
    ['', false],
  ])('%j → %s', (text, want) => {
    expect(
      isCustomerRegisterKeyword(
        { type: 'message', message: { type: 'text', text } },
        hook,
      ),
    ).toBe(want);
  });
});

describe('isReplyStale — legacy [FIX-20260727-STALL]', () => {
  const now = 1_800_000_000_000;
  it('a fresh event is not stale', () => {
    expect(isReplyStale(now - 1000, now)).toBe(false);
  });
  it('the boundary is exclusive', () => {
    expect(isReplyStale(now - REPLY_STALE_MS, now)).toBe(false);
    expect(isReplyStale(now - REPLY_STALE_MS - 1, now)).toBe(true);
  });
  it('the 986-second stall that caused the fix is suppressed', () => {
    expect(isReplyStale(now - 986_000, now)).toBe(true);
  });
  it('an event with no timestamp is never suppressed', () => {
    expect(isReplyStale(undefined, now)).toBe(false);
  });
});
