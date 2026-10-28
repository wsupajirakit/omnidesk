import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PAYLINK_POSTBACK_PREFIX } from '../../src/common/utils/paylink-tag';

import { classifyLines } from '../lib/code-line-census';

import {
  ASSIST_BYPASS_LADDER,
  CUSTOMER_LADDER,
  FULL_LADDER,
  IMAGE_LADDER,
  IMAGE_REFUSAL_LADDER,
  MEDIA_LADDER,
  PROLOGUE_LADDER,
  INLINE_ABOVE_TAIL,
  REPLY_LADDER,
  TAIL_LADDER,
} from '../../src/modules/webhook/gates/ladder-order';
import {
  assertDataChain,
  assertLadderOrder,
  runLadder,
} from '../../src/modules/webhook/gates/ladder-runner';

import { SPINE_PROVIDED_FIELDS } from '../../src/modules/webhook/gates/ladder.types';

import type {
  InlineSpineStep,
  LadderStep,
  StepVerdict,
  TurnContext,
  TurnDeps,
} from '../../src/modules/webhook/gates/ladder.types';

/**
 * [PROG-20260905-LADDER] The ladder's own properties, pinned before anything is built on
 * it.
 *
 * WHY THIS SPEC IS THE POINT OF THE DESIGN. Moving the guards out of a 3,486-line method
 * makes the ladder EASIER TO REORDER — and most of what pins that order is invisible to
 * every tool in this repo. `gate-graph.py --pins` finds the DATA constraints (a step reads
 * what an earlier one writes). It cannot find the EFFECT ones, which are the majority and
 * the dangerous ones: strike-suspend must sit above the first `getOrCreateRoom` because
 * that call CREATES a member and a room; the rate limiter is an `INCR` and must run
 * exactly once; the admin door must REPLY before it opens the case, because opening it
 * mutes the bot.
 *
 * Today those rules are enforced by whoever happens to read a comment. Declared on the
 * step and checked here, they are enforced by a machine. **A registry without this file
 * would be a downgrade, not an improvement.**
 */

const step = (over: Partial<LadderStep> & { id: string }): LadderStep => ({
  describe: 'test step',
  enabled: true,
  run: () => 'continue',
  ...over,
});

const ctx = (over: Partial<TurnContext> = {}): TurnContext => ({
  event: {},
  hook: {},
  alias: 'a',
  userId: 'U1',
  creds: {
    channelSecret: 's',
    accessToken: 'tok',
    channelId: 'C1',
    hookAiKey: 'k',
    aiKeyForMaskOnly: 'k',
    geminiOnlyKey: 'g',
    geminiTemp: undefined,
    geminiTopK: undefined,
    geminiTopP: undefined,
    geminiThinkingBudget: undefined,
    aiVendor: null,
    aiModel: null,
    effectiveFastMode: 0,
    telegramKey: null,
    telegramChatId: null,
    docId: undefined,
    logContext: {},
  },
  logContext: {},
  body: { events: [{}] },
  meta: { signature: 'sig', rawBody: 'raw', baseUrl: 'https://example.test' },
  hookSource: 'cache',
  lineReplyEndpoint: 'https://example.test/reply',
  helperAltText: 'ALT',
  ignoreDocId: undefined,
  profileData: {},
  existingUser: null,
  profileForLog: {},
  msgContent: '',
  skipBotProcessing: false,
  inboundRoom: null,
  profileBlock: undefined,
  profileCircuitOpen: false,
  slip: {
    verifyResult: null,
    recordId: null,
    createdAt: null,
    condition: null,
    storageFilePath: null,
    noQrPhoto: false,
    /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] same starting verdict as
       `blockUnlinked`: nothing is known until a lookup says so. */
    reviewUnknownProfile: false,
    prescan: { skipSlipVerify: false, reason: 'not_run', ms: 0, mode: 'off' },
    blockUnlinked: false,
    storageId: null,
  },
  media: {
    incomingType: 'image',
    rawImageAnswer: 'ได้รับรูปแล้วค่ะ',
    mediaUrl: null,
    internalContentId: null,
    isFlexSent: false,
    flexDoc: null,
    textReplyOverride: null,
    isQrCodeSlip: false,
    violationDetected: false,
    cleanImageAnswer: '',
  },
  customerName: 'N/A',
  customerTel: 'N/A',
  contractCode: 'N/A',
  msgType: 'text',
  customerMsgId: undefined,
  userText: '',
  apiErrorTrigger: null,
  bangkokTime: '',
  relatedText: '',
  replyTextRaw: null,
  replyText: null,
  tagStatus: null,
  responseAi: null,
  aiMs: 0,
  botChatMsg: null,
  tags: {},
  flexProfileContents: null,
  flexKind: null,
  flexOut: {},
  useHelperQr: false,
  replyViaPush: false,
  categorySettled: Promise.resolve(),
  perfT0: 0,
  perfProfileMs: 0,
  replyStaleMs: 120_000,
  finalReplyForLine: '',
  replyBodyForLine: '',
  ...over,
});

/**
 * A deps object where every collaborator is inert.
 *
 * ⚠️ NOT `as unknown as TurnDeps`. Every field is written out, so adding a collaborator to
 * `TurnDeps` reddens THIS FILE rather than silently handing the steps `undefined` at the
 * moment a test exercises them — which is the failure a blanket cast produces and the
 * reason none is used here. เขียนครบทุกช่อง ไม่ใช่ cast ทิ้ง
 */
const noDeps = (over: Partial<TurnDeps> = {}): TurnDeps => ({
  log: () => {},
  warn: () => {},
  error: () => {},
  sendTextReply: () => Promise.resolve({}),
  /* [FEAT-20260907-UNKNOWNPROFILEREVIEW] inert like every sibling — `null` is
     "no such card", which is the branch that leaves a turn unchanged. */
  findFlexById: () => Promise.resolve(null),
  emitWlog: () => Promise.resolve(),
  logBotMessage: () => {},
  logMessageAwaited: () => Promise.resolve(null),
  retrieveDoc: () => Promise.resolve(''),
  assemblePrompt: (input) => Promise.resolve({ suggestion: input.suggestion }),
  generateAiReply: () =>
    Promise.resolve({ text: 'hi', noData: false, tagStatus: 'found' as const }),
  replyApiErrorRefusal: () => Promise.resolve(),
  notifyTelegramNoAnswer: () => Promise.resolve(),
  runAssist: () => Promise.resolve(),
  openAdminCase: () => Promise.resolve(true),
  tryNoticeGuard: () => Promise.resolve(false),
  runFollowUpFlow: () => Promise.resolve(false),
  handleCustomerRegister: () => Promise.resolve({ handled: false }),
  runPaymentForSlip: () =>
    Promise.resolve({ suppress: false, lockedDuplicate: false }),
  handleSlipFlex: () =>
    Promise.resolve({
      isFlexSent: false,
      flexDoc: null,
      textReplyOverride: null,
      isQrCodeSlip: false,
      violationDetected: false,
      slipCondition: null,
    }),
  handleSlipCallback: () => {},
  replyMissingProfileData: () => Promise.resolve(),
  runAssistBypass: () => Promise.resolve(),
  sendAiReply: () => Promise.resolve(),
  replyWithTaggedImages: () => Promise.resolve(false),
  validateSignature: () => true,
  ensureRoom: () => Promise.resolve(),
  buildHookHelperFlexFor: () => Promise.resolve(null),
  sendFlexReply: () => Promise.resolve({}),
  stampIfHelperCardDelivered: () => {},
  logSystemMessage: () => Promise.resolve(null),
  downloadImage: () => Promise.resolve(null),
  readImageStorage: () => Promise.resolve(null),
  shouldSkipSlipVerify: () =>
    Promise.resolve({
      skipSlipVerify: false,
      reason: 'not_run',
      ms: 0,
      mode: 'off',
    }),
  ...over,
});

describe('[PROG-20260905-LADDER] the shipped order', () => {
  it('satisfies every constraint it declares', () => {
    /* The one case that matters in production. If this reddens, the ladder as shipped
       contradicts a rule somebody wrote down after a live defect.

       ⚠️ CHECKED OVER THE CONCATENATION, and this case proved why the moment the ladder
       split in two: `helper-qr-body` sits in the first slice and declares
       `mustPrecede: ['require-something-to-send']`, which is in the SECOND. Against
       `TAIL_LADDER` alone the fence threw "names nothing" — correctly, because from that
       array's point of view the step really is absent. The two slices are one ladder
       interrupted by a patch box; the concatenation is the shipped order. */
    expect(() =>
      assertLadderOrder(FULL_LADDER, INLINE_ABOVE_TAIL),
    ).not.toThrow();
  });

  it('gives every step a unique id and a description', () => {
    const ids = FULL_LADDER.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of FULL_LADDER) expect(s.describe.length).toBeGreaterThan(10);
  });

  it('makes every constraint carry its REASON', () => {
    /* A constraint without a note is a rule nobody can evaluate: the next person can see
       THAT the order matters and not WHY, which is exactly the position the prose
       comments left us in. เขียนเหตุผลด้วย ไม่ใช่เขียนแค่ลำดับ */
    for (const s of FULL_LADDER) {
      if ((s.mustFollow?.length ?? 0) + (s.mustPrecede?.length ?? 0) > 0) {
        expect(`${s.id}:${s.orderNote ?? ''}`.length).toBeGreaterThan(
          s.id.length + 30,
        );
      }
    }
  });

  it('THE DATA CHAIN — every field a step reads has an earlier writer', () => {
    /* ⚠️⚠️ THE CHECK NOTHING ELSE PERFORMS. A step reading `ctx.skipBotProcessing` before
       the step that writes it COMPILES PERFECTLY and reads `false`: the field exists, the
       type is right, and the initial value is a legitimate one. The turn quietly answers
       as though no operator were holding the room — no type error, no exception, no
       failing assertion anywhere else in the suite.

       The remaining migration has twelve of these chains. This is what makes moving them
       safe rather than merely careful. */
    expect(() =>
      assertDataChain(TAIL_LADDER, SPINE_PROVIDED_FIELDS),
    ).not.toThrow();
  });

  it('catches a read with no writer before it', () => {
    // Red-first proof that the check above is not decorative.
    expect(() =>
      assertDataChain(
        [
          step({ id: 'reader', reads: ['replyText'] }),
          step({ id: 'writer', writes: ['replyText'] }),
        ],
        [],
      ),
    ).toThrow(/'reader' reads 'replyText' but nothing before it writes/);
  });

  it('accepts the same pair once the writer runs first', () => {
    expect(() =>
      assertDataChain(
        [
          step({ id: 'writer', writes: ['replyText'] }),
          step({ id: 'reader', reads: ['replyText'] }),
        ],
        [],
      ),
    ).not.toThrow();
  });

  it('lets a step read what the SPINE already filled', () => {
    expect(() =>
      assertDataChain([step({ id: 'a', reads: ['hook'] })], ['hook']),
    ).not.toThrow();
  });

  it('lets a step read a field it writes itself', () => {
    // `api-error-trigger` re-stamps `bangkokTime`; reading your own write is not a chain.
    expect(() =>
      assertDataChain(
        [step({ id: 'a', reads: ['bangkokTime'], writes: ['bangkokTime'] })],
        [],
      ),
    ).not.toThrow();
  });

  it('makes every step DECLARE its reads — silence must not become the norm', () => {
    /* The chain check skips a step that declares nothing, so without this case the fence
       would decay quietly: each new step could opt out by saying nothing at all. */
    const silent = TAIL_LADDER.filter((s) => !s.reads && !s.writes).map(
      (s) => s.id,
    );
    expect(silent).toEqual([]);
  });

  it('names every inline spine position a constraint refers to', () => {
    // The inline list is a to-do list that must not go stale: an entry nobody references
    // is a migration that already happened and was not recorded.
    const referenced = new Set(
      FULL_LADDER.flatMap((s) => [
        ...(s.mustFollow ?? []),
        ...(s.mustPrecede ?? []),
      ]),
    );
    for (const entry of INLINE_ABOVE_TAIL) {
      expect({ id: entry.id, referenced: referenced.has(entry.id) }).toEqual({
        id: entry.id,
        referenced: true,
      });
      expect(entry.at).toBeGreaterThan(0);
    }
  });
});

describe('[PROG-20260905-LADDER] assertLadderOrder refuses what it must', () => {
  it('refuses two steps claiming the same id', () => {
    expect(() =>
      assertLadderOrder([step({ id: 'a' }), step({ id: 'a' })]),
    ).toThrow(/two steps claim the id 'a'/);
  });

  it('refuses a constraint that names nothing — a typo must not enforce nothing', () => {
    /* This is the case that makes the whole mechanism trustworthy. Without it, renaming a
       step silently disarms every constraint pointing at its old name, and the fence keeps
       reporting green. */
    expect(() =>
      assertLadderOrder([step({ id: 'a', mustFollow: ['typpo'] })]),
    ).toThrow(/names 'typpo', which is neither a step/);
  });

  it('refuses an order that violates a declared mustFollow', () => {
    expect(() =>
      assertLadderOrder([
        step({ id: 'late', mustFollow: ['early'] }),
        step({ id: 'early' }),
      ]),
    ).toThrow(/'late' must follow 'early' but runs before it/);
  });

  it('refuses an order that violates a declared mustPrecede', () => {
    expect(() =>
      assertLadderOrder([
        step({ id: 'b' }),
        step({ id: 'a', mustPrecede: ['b'] }),
      ]),
    ).toThrow(/'a' must precede 'b' but runs after it/);
  });

  it('puts the REASON in the failure message', () => {
    // The person who broke it should not have to go and find out why it mattered.
    expect(() =>
      assertLadderOrder([
        step({
          id: 'late',
          mustFollow: ['early'],
          orderNote: 'the room is created by early',
        }),
        step({ id: 'early' }),
      ]),
    ).toThrow(/the room is created by early/);
  });

  it('accepts an inline spine position that really is above the ladder', () => {
    const inline: InlineSpineStep[] = [
      { id: 'above', relativeToLadder: 'before', at: 3549, describe: 'x' },
    ];
    expect(() =>
      assertLadderOrder([step({ id: 'a', mustFollow: ['above'] })], inline),
    ).not.toThrow();
  });

  it('REJECTS the same constraint when the inline position is below the ladder', () => {
    /* Proves the inline escape hatch is not a rubber stamp: it encodes the one fact that
       is knowable about an un-migrated position, and that fact is checked. */
    const inline: InlineSpineStep[] = [
      { id: 'below', relativeToLadder: 'after', at: 4900, describe: 'x' },
    ];
    expect(() =>
      assertLadderOrder([step({ id: 'a', mustFollow: ['below'] })], inline),
    ).toThrow(/'a' must follow 'below' but runs before it/);
  });

  it('refuses an inline entry whose id collides with a real step', () => {
    // One of the two is out of date, and guessing which would be worse than failing.
    expect(() =>
      assertLadderOrder(
        [step({ id: 'a' })],
        [{ id: 'a', relativeToLadder: 'before', at: 1, describe: 'x' }],
      ),
    ).toThrow(/one of the two is out of date/);
  });
});

describe('[PROG-20260905-LADDER] runLadder', () => {
  it('stops at the first step that ends the turn, and runs no step after it', async () => {
    const ran: string[] = [];
    const ladder = [
      step({ id: 'a', run: () => (ran.push('a'), 'continue') }),
      step({ id: 'b', run: () => (ran.push('b'), 'done') }),
      step({ id: 'c', run: () => (ran.push('c'), 'continue') }),
    ];
    await expect(runLadder(ladder, ctx(), noDeps())).resolves.toBe(true);
    expect(ran).toEqual(['a', 'b']);
  });

  it('answers false when every step falls through', async () => {
    await expect(runLadder([step({ id: 'a' })], ctx(), noDeps())).resolves.toBe(
      false,
    );
  });

  it('skips a disabled step without asking its `when`', async () => {
    let asked = false;
    const ladder = [
      step({
        id: 'off',
        enabled: false,
        when: () => ((asked = true), true),
        run: () => 'done',
      }),
    ];
    await expect(runLadder(ladder, ctx(), noDeps())).resolves.toBe(false);
    expect(asked).toBe(false);
  });

  it('skips a step whose `when` says its case is not in play', async () => {
    let ran = false;
    const ladder = [
      step({ id: 'a', when: () => false, run: () => ((ran = true), 'done') }),
    ];
    await expect(runLadder(ladder, ctx(), noDeps())).resolves.toBe(false);
    expect(ran).toBe(false);
  });

  it('runs sequentially — a slow step still finishes before the next one starts', async () => {
    /* The steps write rows, send messages and consume quota. The order IS the behaviour,
       so there is no version of this that maps in parallel. ต้องเรียงจริง ไม่ใช่ยิงพร้อมกัน */
    const ran: string[] = [];
    const ladder = [
      step({
        id: 'slow',
        run: async (): Promise<StepVerdict> => {
          await new Promise((r) => setTimeout(r, 5));
          ran.push('slow');
          return 'continue';
        },
      }),
      step({ id: 'fast', run: () => (ran.push('fast'), 'continue') }),
    ];
    await runLadder(ladder, ctx(), noDeps());
    expect(ran).toEqual(['slow', 'fast']);
  });

  it('does NOT swallow a throw — the spine catch writes the row an incident starts from', async () => {
    const ladder = [
      step({
        id: 'boom',
        run: () => {
          throw new Error('kaboom');
        },
      }),
    ];
    await expect(runLadder(ladder, ctx(), noDeps())).rejects.toThrow('kaboom');
  });
});

describe('[PROG-20260905-LADDER] the four tail steps behave as the spine did', () => {
  const byId = (id: string): LadderStep =>
    TAIL_LADDER.find((s) => s.id === id) as LadderStep;

  it('out-of-hours fires only for a hook with status 0', () => {
    const s = byId('out-of-hours');
    expect(s.when?.(ctx({ hook: { status: 0 } }))).toBe(true);
    expect(s.when?.(ctx({ hook: { status: 1 } }))).toBe(false);
    // An absent hook is not a switched-off hook.
    expect(s.when?.(ctx({ hook: undefined }))).toBe(false);
  });

  it('require-user-text ends the turn with no text, and carries the text when there is', async () => {
    const s = byId('require-user-text');
    const empty = ctx({
      event: { type: 'message', message: { type: 'image' } },
    });
    /* `await` on the value, not `.resolves` on it: `run` may be sync OR async by design —
       a step that only computes has no reason to be a promise — and `.resolves` refuses a
       plain string. Both shapes have to be exercised the same way. */
    expect(await s.run(empty, noDeps())).toBe('done');
    expect(empty.userText).toBe('');

    const said = ctx({ event: { message: { type: 'text', text: 'hello' } } });
    expect(await s.run(said, noDeps())).toBe('continue');
    /* The narrowing the spine's `const userText = event.message?.text` used to provide now
       lives here: past this step the value is the same non-empty string, which is why the
       context types it `string` and no cast is needed downstream. */
    expect(said.userText).toBe('hello');
  });

  it('api-error-trigger fires only when the profile bag carries the marker', () => {
    const s = byId('api-error-trigger');
    expect(s.when?.(ctx({ profileData: {} }))).toBe(false);
    expect(s.when?.(ctx({ profileData: { _error_trigger: 'x' } }))).toBe(true);
  });

  it('api-error-trigger records the trigger and RE-STAMPS the clock', async () => {
    /* `bangkokTime` is one of the nine values `assistTurn()` re-reads at the moment of each
       call. The step writing it, and the spine assigning it back, is what keeps the
       Telegram hand-off from reporting an empty clock — a failure whose shape would be
       right and whose value would be wrong, i.e. green tests. */
    const c = ctx({ profileData: { _error_trigger: 'profile 404' } });
    expect(await byId('api-error-trigger').run(c, noDeps())).toBe('continue');
    expect(c.apiErrorTrigger).toBe('profile 404');
    expect(c.bangkokTime).not.toBe('');
  });

  it('leaves the clock alone when the profile fetch was fine', async () => {
    const c = ctx({ bangkokTime: 'ORIGINAL' });
    const s = byId('api-error-trigger');
    if (s.when?.(c)) await s.run(c, noDeps());
    expect(c.bangkokTime).toBe('ORIGINAL');
    expect(c.apiErrorTrigger).toBeNull();
  });
});

/**
 * [PROG-20260905-LADDER] The model lane, step by step.
 *
 * These eight steps were 451 lines of the spine. Each case below is the behaviour the
 * block had at that line — not a test of the new shape, a test that the old shape still
 * holds. เทสว่าพฤติกรรมเดิมยังอยู่ ไม่ใช่เทสว่าโครงใหม่สวย
 */
describe('[PROG-20260905-LADDER] the model lane', () => {
  const byId = (id: string): LadderStep =>
    TAIL_LADDER.find((s) => s.id === id) as LadderStep;

  it('doc-retrieval SUBSTITUTES AFTER FETCHING, never before', async () => {
    /* The one ordering rule inside a single step, and the reason the fetch and the
       substitution are not two rows: retrieval caches by doc_id, so substituting first
       would make the cached body hook-specific and two hooks sharing a document could read
       each other's domain. Proven by watching what the seam is ASKED, not what it says. */
    let asked: Record<string, unknown> | null = null;
    const c = ctx({
      hook: { doc_retrieval: true },
      creds: { ...ctx().creds, docId: 'doc-1' },
      userText: 'question',
    });
    await byId('doc-retrieval').run(
      c,
      noDeps({
        retrieveDoc: (a) => {
          asked = a;
          return Promise.resolve('RAW');
        },
      }),
    );
    expect((asked as unknown as { question: string }).question).toBe(
      'question',
    );
    expect(c.relatedText).toBe('RAW');
  });

  it('doc-retrieval costs an OA with retrieval off exactly nothing', async () => {
    // The default path, which must stay free: no doc id ⇒ no seam call at all.
    let calls = 0;
    const c = ctx();
    await byId('doc-retrieval').run(
      c,
      noDeps({
        retrieveDoc: () => {
          calls += 1;
          return Promise.resolve('x');
        },
      }),
    );
    expect(calls).toBe(0);
    expect(c.relatedText).toBe('');
  });

  it('ask-model carries the answer, the verdict and the timing onto the turn', async () => {
    const c = ctx({ userText: 'hi' });
    await byId('ask-model').run(
      c,
      noDeps({
        generateAiReply: () =>
          Promise.resolve({
            text: 'ANSWER',
            noData: false,
            tagStatus: 'found' as const,
            response_data: { a: 1 },
          }),
      }),
    );
    expect(c.replyTextRaw).toBe('ANSWER');
    expect(c.tagStatus).toBe('found');
    expect(c.responseAi).toEqual({ a: 1 });
    expect(c.modelAudit?.noData).toBe(false);
    expect(typeof c.modelAudit?.startedAt).toBe('number');
  });

  it('ask-model builds LEGACY`s envelope when the provider rejects — it does not throw', async () => {
    /* The default binding REJECTS; legacy's wrapper returned an envelope. Without this the
       failure reaches the outer catch, the reply block never runs, and THE CUSTOMER GETS
       NOTHING. The pipeline must instead take the path it takes when the model has nothing
       to say. */
    const c = ctx({ userText: 'hi' });
    const verdict = await byId('ask-model').run(
      c,
      noDeps({
        generateAiReply: () => Promise.reject(new Error('provider down')),
      }),
    );
    expect(verdict).toBe('continue');
    expect(c.replyTextRaw).toBeNull();
    expect(c.tagStatus).toBeNull();
    expect(c.modelAudit?.noData).toBe(true);
    /* [FIX-20260808-AIGENERROR] a plain rejection keeps http_status NULL so it flows to
       the not-found default; only a missing key is a generative error. */
    expect(c.modelAudit?.httpStatus).toBeNull();
    expect(c.modelAudit?.errorMessage).toContain('provider down');
  });

  it('ask-model marks ONLY a missing key as a generative error (http_status 0)', async () => {
    // Matched by NAME, not `instanceof`, to keep the concrete provider out of this layer.
    const keyMissing = new Error('no key');
    keyMissing.name = 'GeminiKeyMissingError';
    const c = ctx({ userText: 'hi' });
    await byId('ask-model').run(
      c,
      noDeps({ generateAiReply: () => Promise.reject(keyMissing) }),
    );
    expect(c.modelAudit?.httpStatus).toBe(0);
  });

  it('api-error-refusal fires only when a failed fetch AND a quoted number meet', () => {
    const s = byId('api-error-refusal');
    expect(
      s.when?.(ctx({ apiErrorTrigger: null, replyTextRaw: 'ยอด 1,200' })),
    ).toBe(false);
    expect(s.when?.(ctx({ apiErrorTrigger: 'x', replyTextRaw: null }))).toBe(
      false,
    );
  });

  it('api-error-refusal ends the turn — every path through the handler does', async () => {
    let called = false;
    const verdict = await byId('api-error-refusal').run(
      ctx(),
      noDeps({
        replyApiErrorRefusal: () => {
          called = true;
          return Promise.resolve();
        },
      }),
    );
    expect(called).toBe(true);
    expect(verdict).toBe('done');
  });

  it('resolve-reply-text keeps NULL as silence, which is not the same as ""', async () => {
    /* legacy:4308 — an OA with no `default_answer_text` is choosing silence over a canned
       line, and two gates further down read that difference. */
    const c = ctx({ replyTextRaw: null, tagStatus: null });
    c.modelAudit = {
      noData: true,
      promptDocMeta: null,
      thaiNow: '',
      startedAt: 0,
    };
    await byId('resolve-reply-text').run(c, noDeps());
    expect(c.replyText).toBeNull();
  });

  it('bot-chat-row writes nothing when the OA chose silence', () => {
    expect(byId('bot-chat-row').when?.(ctx({ replyText: null }))).toBe(false);
    expect(byId('bot-chat-row').when?.(ctx({ replyText: 'hi' }))).toBe(true);
  });

  it('bot-chat-row stores the STRIPPED text, and the alt text when only a marker was set', async () => {
    /* [FIX-20260901-FALLBACKMARKERROW] the operator's own field is stored verbatim by the
       chooser, so an OA whose `default_answer_text` is nothing but `[[[menu_main_00010]]]`
       had the brackets shown on the chat page. `HELPER_ALT_TEXT` on empty, NOT the raw
       text — falling back there would restore the very brackets this removes. */
    let stored: Record<string, unknown> | null = null;
    const c = ctx({ replyText: '[[[menu_main_00010]]]', helperAltText: 'ALT' });
    await byId('bot-chat-row').run(
      c,
      noDeps({
        logMessageAwaited: (row) => {
          stored = row;
          return Promise.resolve({ _id: 'row-1' });
        },
      }),
    );
    expect((stored as unknown as { content: string }).content).toBe('ALT');
    expect(c.botChatMsg).toEqual({ _id: 'row-1' });
  });

  it('ai-audit-row does not make the customer wait for Mongo', async () => {
    /* [PERF-20260824-WLOGVOID] fire-and-forget: the reply is sent hundreds of lines below
       and the token expires at 60s. A pending write must not hold the step. */
    let resolveWrite: (() => void) | null = null;
    const pending = new Promise<void>((r) => (resolveWrite = r));
    const c = ctx();
    c.modelAudit = {
      noData: false,
      promptDocMeta: null,
      thaiNow: '',
      startedAt: 1,
    };
    const verdict = await byId('ai-audit-row').run(
      c,
      noDeps({ emitWlog: () => pending }),
    );
    expect(verdict).toBe('continue');
    (resolveWrite as unknown as () => void)();
  });

  it('telegram-no-answer needs the verdict AND both credentials', () => {
    const s = byId('telegram-no-answer');
    const withKeys = (over: Record<string, unknown>) =>
      ctx({ creds: { ...ctx().creds, ...over } });
    expect(s.when?.(ctx({ tagStatus: 'found' }))).toBe(false);
    expect(
      s.when?.({
        ...withKeys({ telegramKey: 'k', telegramChatId: 'c' }),
        tagStatus: 'not_found',
      }),
    ).toBe(true);
    expect(
      s.when?.({ ...withKeys({ telegramKey: 'k' }), tagStatus: 'not_found' }),
    ).toBe(false);
  });

  it('assist-hand-off passes the RESOLVED answer, falling back to the raw one', async () => {
    /* legacy:4429 — `rawAnswer` is `replyText || replyTextRaw` and it CARRIES THE MARKER.
       Only what is SENT is stripped; this is the value the marker test reads. */
    let args: Record<string, unknown> | null = null;
    const capture = {
      runAssist: (a: Record<string, unknown>) => {
        args = a;
        return Promise.resolve();
      },
    };
    await byId('assist-hand-off').run(
      ctx({ replyText: '[[[assist]]] ok', replyTextRaw: 'raw' }),
      noDeps(capture),
    );
    expect((args as unknown as { rawAnswer: string }).rawAnswer).toBe(
      '[[[assist]]] ok',
    );

    await byId('assist-hand-off').run(
      ctx({ replyText: null, replyTextRaw: 'raw only' }),
      noDeps(capture),
    );
    expect((args as unknown as { rawAnswer: string }).rawAnswer).toBe(
      'raw only',
    );
  });
});

/**
 * [PROG-20260905-LADDER] The reply ladder — the second slice.
 *
 * These five were 167 lines of the spine. As with the model lane, each case below is the
 * behaviour the block had at that line, not a test of the new shape.
 */
describe('[PROG-20260905-LADDER] the reply ladder', () => {
  const byId = (id: string): LadderStep =>
    REPLY_LADDER.find((s) => s.id === id) as LadderStep;

  it('BOTH SLICES together satisfy the order and the data chain', () => {
    /* Checked over the CONCATENATION, never slice by slice. The two arrays are one ladder
       interrupted by a patch box, so `send-ai-reply mustFollow bot-chat-row` is an edge
       from the reply slice back into the model lane. Validating each slice alone would
       drop every such edge and still report green — a fence that cannot fail. */
    expect(() =>
      assertLadderOrder(FULL_LADDER, INLINE_ABOVE_TAIL),
    ).not.toThrow();
    expect(() =>
      assertDataChain(FULL_LADDER, SPINE_PROVIDED_FIELDS),
    ).not.toThrow();
  });

  it('⭐ every step has its position defended by SOMETHING, from one end or the other', () => {
    /* [PROG-20260905-WHYHERE] The dive behind this case asked "which steps have no
       position rule?", got seven names back, and then found all seven were already
       constrained — from the OTHER END. `image-store` declares nothing, but `qr-prescan`
       declares `mustFollow: ['image-store']`, which pins the pair just as well.
     *
     * ⇒ MIRRORING THEM WOULD BE DOUBLE-GUARDING, which this repo already ruled against:
     *   state the rule once, at whichever end owns it. So nothing was added to those seven
     *   steps. What was missing is a check that the property STAYS true — today it holds
     *   because somebody looked, and "somebody looked" expires.
     *
     * A step named by nobody and naming nobody can be dragged anywhere in the array and
     * every existing fence stays green: `assertLadderOrder` has no edge to violate, and
     * `assertDataChain` cannot see an EFFECT rule (the biggest ones are about writes to
     * the database, not to the context). This case is the floor under both.
     *
     * ⚠️ IT IS NOT SATISFIED BY A DECORATIVE CONSTRAINT. `assertLadderOrder` already
     *   refuses a constraint naming an id that does not exist, and a separate case refuses
     *   a constraint with no `orderNote`. So the cheapest way to pass this is to write
     *   down the real reason — which is the point.
     *   กฎบอกครั้งเดียวพอ แต่ต้องมีอะไรยืนยันว่ายังมีอยู่ */
    const named = new Set<string>();
    for (const s of FULL_LADDER) {
      for (const other of [...(s.mustFollow ?? []), ...(s.mustPrecede ?? [])]) {
        named.add(other);
        named.add(s.id);
      }
    }
    const undefended = FULL_LADDER.filter((s) => !named.has(s.id)).map(
      (s) => s.id,
    );
    expect(undefended).toEqual([]);
  });

  it('⭐ FULL_LADDER spreads the slices in the order the SPINE actually calls them', () => {
    /* ⚠️⚠️ THE ONE ASSUMPTION EVERY OTHER CASE IN THIS FILE RESTS ON, and nothing checked
       it until now. Both fences above walk `FULL_LADDER` and treat its position as the
       runtime order. That is true only while the spread below matches the sequence of
       `runLadder(...)` calls in `processLockedEvent` — and those two are maintained by
       hand, in two files, a thousand lines apart.
     *
     * Get them out of step and the failure is invisible: `assertDataChain` would clear a
     * step that really does read a field before anything writes it, because in the ARRAY
     * the writer comes first. The fence would report green while guarding nothing — the
     * exact shape of every bug this program has been fixing.
     *
     * The slices are DERIVED from the spine here, not listed: the call sites are read in
     * file order, so a slice added, removed or moved in the method is picked up without
     * this case being edited. It fails only when the two orders genuinely disagree.
     * ลำดับใน array ต้องเท่ากับลำดับที่ spine เรียกจริง ไม่งั้นรั้วเฝ้าลม */
    /* 🔴 CODE ONLY, AND THIS CASE PROVED WHY ON ITS FIRST RUN. Read against the raw file
       it counted `unlinked-slip-refuse` TWICE: the notice guard's revert instruction says
       "paste it back below the `runLadder(IMAGE_REFUSAL_LADDER, …)` call", and a comment
       mentioning a call is not a call. Exactly the mistake the helper-door census made at
       SP28 when it read a doc comment as a door. คอมเมนต์ที่พูดถึงการเรียก ไม่ใช่การเรียก */
    const spineRaw = readFileSync(
      join(__dirname, '../../src/modules/webhook/webhook.service.ts'),
      'utf8',
    );
    const lines = spineRaw.split('\n');
    const kinds = classifyLines(spineRaw);
    const spine = lines.filter((_, i) => kinds[i] === 'code').join('\n');
    const calledInSpine = [
      ...spine.matchAll(/runLadder\((\w+_LADDER), ladderCtx,/g),
    ].map((m) => m[1]!);

    // vacuity guard: a regex that matched nothing would make the comparison trivial
    expect(calledInSpine.length).toBeGreaterThanOrEqual(5);

    const SLICES: Record<string, readonly LadderStep[]> = {
      PROLOGUE_LADDER,
      IMAGE_LADDER,
      IMAGE_REFUSAL_LADDER,
      ASSIST_BYPASS_LADDER,
      CUSTOMER_LADDER,
      MEDIA_LADDER,
      TAIL_LADDER,
      REPLY_LADDER,
    };
    /* Every slice the spine calls must be one this file knows about — otherwise a new
       slice could be shipped, never appear in FULL_LADDER, and be fenced by nothing. */
    for (const name of calledInSpine) expect(SLICES[name]).toBeDefined();

    const idsInCallOrder = calledInSpine.flatMap((n) =>
      SLICES[n]!.map((s) => s.id),
    );
    expect(FULL_LADDER.map((s) => s.id)).toEqual(idsInCallOrder);
  });

  it('tag-strip warns only when a card was asked for and none was built', async () => {
    /* The exact silent failure that makes "ทำไมการ์ดไม่ออก" cost hours: not in the group,
       not in the allowlist, a bad flex row. Nothing else records it. */
    const warns: string[] = [];
    const d = noDeps({ warn: (m) => warns.push(m) });
    await byId('tag-strip-probe').run(
      ctx({
        tags: { wantedFlexTag: 'flex_m00001' },
        flexProfileContents: null,
      }),
      d,
    );
    expect(warns.join()).toContain('[TAG-STRIP]');

    warns.length = 0;
    await byId('tag-strip-probe').run(
      ctx({
        tags: { wantedFlexTag: 'flex_m00001' },
        flexProfileContents: { a: 1 },
      }),
      d,
    );
    expect(warns).toEqual([]);
  });

  it('tag-strip NEVER lets a diagnostic touch the reply', () => {
    // A log-only probe that can throw is a probe that can cost the customer their answer.
    const exploding = {
      get wantsFlexProfile(): boolean {
        throw new Error('boom');
      },
    };
    expect(() =>
      byId('tag-strip-probe').run(ctx({ tags: exploding }), noDeps()),
    ).not.toThrow();
  });

  it('flex_pc blanks BOTH texts when the card could not be built', async () => {
    /* [FEAT-20260802-FLEXPCWRAP] a flex_pc answer is a whole JSON wrapper with no
       delimiter to strip. `finalReplyForLine` is what the staleness warn logs;
       `replyBodyForLine` is what would be SENT. Blanking one leaves the other carrying a
       JSON blob to a customer or to an operator's log. */
    const c = ctx({
      tags: { wantedFlexPcTag: 'flex_pc00001' },
      finalReplyForLine: '{"type":"bubble"}',
      replyBodyForLine: '{"type":"bubble"}',
      flexProfileContents: null,
    });
    expect(byId('flex-pc-safe-text').when?.(c)).toBe(true);
    await byId('flex-pc-safe-text').run(c, noDeps());
    expect(c.finalReplyForLine).toBe('ขออภัย ระบบแสดงข้อมูลไม่ได้ชั่วคราวค่ะ');
    expect(c.replyBodyForLine).toBe(c.finalReplyForLine);
  });

  it('flex_pc blanks to EMPTY when the card WAS built — the card is the answer', async () => {
    const c = ctx({
      tags: { wantedFlexPcTag: 'flex_pc00001' },
      flexProfileContents: { a: 1 },
      replyBodyForLine: 'x',
    });
    await byId('flex-pc-safe-text').run(c, noDeps());
    expect(c.replyBodyForLine).toBe('');
  });

  it('flex_pc fires on the SHAPE too, not only on the tag', () => {
    // The answer can carry the wrapper without the resolver having recognised a tag.
    expect(
      byId('flex-pc-safe-text').when?.(
        ctx({ finalReplyForLine: '  {"x":"flex_pc00042"}' }),
      ),
    ).toBe(true);
  });

  it('nothing to send ends the turn; a card with empty text still sends', async () => {
    // legacy:4714-4718 — empty text WITH a card still sends the card.
    const step = byId('require-something-to-send');
    expect(
      await step.run(
        ctx({ replyBodyForLine: '', flexProfileContents: null }),
        noDeps(),
      ),
    ).toBe('done');
    expect(
      await step.run(
        ctx({ replyBodyForLine: '', flexProfileContents: { a: 1 } }),
        noDeps(),
      ),
    ).toBe('continue');
    expect(
      await step.run(
        ctx({ replyBodyForLine: 'hi', flexProfileContents: null }),
        noDeps(),
      ),
    ).toBe('continue');
  });

  it('the staleness guard suppresses an old event and lets a fresh one through', async () => {
    /* [FIX-20260727-STALL] on 2026-07-27 a request stalled 986 seconds and then sent its
       reply with a token minted 16 minutes earlier. LINE ACCEPTED IT AND DELIVERED IT, so
       the customer got a ghost message long after an admin had closed the case. */
    const step = byId('staleness-guard');
    const old = ctx({
      event: { timestamp: Date.now() - 300_000 },
      replyStaleMs: 120_000,
    });
    expect(step.when?.(old)).toBe(true);
    expect(await step.run(old, noDeps())).toBe('done');

    const fresh = ctx({
      event: { timestamp: Date.now() - 1_000 },
      replyStaleMs: 120_000,
    });
    expect(step.when?.(fresh)).toBe(false);
  });

  it('an event with NO timestamp is never treated as stale', () => {
    // Absent is not old. Suppressing on a missing field would silence real replies.
    expect(byId('staleness-guard').when?.(ctx({ event: {} }))).toBe(false);
  });

  it('the send ends the turn and does NOT swallow a failed send', async () => {
    /* The handler rethrows so the spine's outer catch still writes its `handle_webhook`
       row — the record an incident is opened from. Trading that for a silent failure means
       a customer answered by nothing at all, with nothing to investigate. */
    expect(
      await byId('send-ai-reply').run(
        ctx({ replyBodyForLine: 'hi' }),
        noDeps(),
      ),
    ).toBe('done');

    await expect(
      byId('send-ai-reply').run(
        ctx({ replyBodyForLine: 'hi' }),
        noDeps({ sendAiReply: () => Promise.reject(new Error('LINE 400')) }),
      ),
    ).rejects.toThrow('LINE 400');
  });
});

/**
 * [PROG-20260905-LADDER] The three steps that sit between the model lane and the frozen
 * flex build: the reply tags, the carousel, and the customer-helper swap.
 */
describe('[PROG-20260905-LADDER] tags, carousel and the helper swap', () => {
  const byId = (id: string): LadderStep =>
    FULL_LADDER.find((s) => s.id === id) as LadderStep;

  it('the carousel is asked for ONLY when the resolver kept an image tag', () => {
    /* [FIX-20260815-IMGTAGSTRIPPED] `finalReplyForLine` has been through the no-marker-leak
       catch-all, which removes `[[[img_promo]]]` BY NAME. Re-scanning the finished text
       found nothing and this branch was dead for a week, silently. The tag has to come off
       the resolver, which reads it before the strip. */
    const step = byId('tagged-image-reply');
    expect(step.when?.(ctx({ tags: {} }))).toBe(false);
    expect(step.when?.(ctx({ tags: { imageTag: 'img_promo' } }))).toBe(true);
  });

  it('the carousel ends the turn only when it actually delivered', async () => {
    // A false answer falls through to the plain-text reply — what the original did by not
    // returning. Treating "asked" as "delivered" would silence a customer.
    const step = byId('tagged-image-reply');
    const c = ctx({ tags: { imageTag: 'img_promo' } });
    expect(
      await step.run(
        c,
        noDeps({ replyWithTaggedImages: () => Promise.resolve(true) }),
      ),
    ).toBe('done');
    expect(
      await step.run(
        c,
        noDeps({ replyWithTaggedImages: () => Promise.resolve(false) }),
      ),
    ).toBe('continue');
  });

  it('the helper swap replaces the body only when the answer was just its marker', async () => {
    /* [FIX-20260801-HELPEREMPTY] the model answered with nothing but
       `[[[customer-helper]]] [[[FOUND]]]`, the tags were stripped, the text was empty and
       the guard returned before the buttons were attached — the customer got SILENCE. */
    const step = byId('helper-qr-body');
    const helper = ctx({
      tags: { wantsHelperQuickReply: true },
      finalReplyForLine: '',
      hook: { customer_helper_text: 'ติดต่อแอดมินได้ที่นี่' },
    });
    await step.run(helper, noDeps());
    expect(helper.useHelperQr).toBe(true);
    expect(helper.replyBodyForLine).not.toBe('');

    const plain = ctx({ tags: {}, finalReplyForLine: 'ordinary answer' });
    await step.run(plain, noDeps());
    expect(plain.useHelperQr).toBe(false);
    expect(plain.replyBodyForLine).toBe('ordinary answer');
  });

  it('the push path keeps the plain text — it can attach no buttons', async () => {
    // Substituting there would promise a button that is not there.
    const c = ctx({
      tags: { wantsHelperQuickReply: true },
      replyViaPush: true,
      userId: 'U1',
      finalReplyForLine: 'plain',
    });
    await byId('helper-qr-body').run(c, noDeps());
    expect(c.useHelperQr).toBe(false);
    expect(c.replyBodyForLine).toBe('plain');
  });
});

/**
 * [PROG-20260905-LADDER] The prologue — identity, before anything else may run.
 */
describe('[PROG-20260905-LADDER] the prologue', () => {
  const byId = (id: string): LadderStep =>
    PROLOGUE_LADDER.find((s) => s.id === id) as LadderStep;

  it('the signature re-check stops the turn when the two checks disagree', async () => {
    /* The controller guard already validated these bytes. Reaching a failure here means
       the two checks DISAGREED — which is why the log names the secret's state rather
       than just saying "invalid". */
    const warns: string[] = [];
    const d = noDeps({
      validateSignature: () => false,
      warn: (m) => warns.push(m),
    });
    expect(await byId('verify-signature').run(ctx(), d)).toBe('done');
    expect(warns.join()).toContain('[SIGNATURE] 401 (controller re-check)');

    expect(
      await byId('verify-signature').run(
        ctx(),
        noDeps({ validateSignature: () => true }),
      ),
    ).toBe('continue');
  });

  it('the signature check hashes the RAW bytes, not a re-serialised body', async () => {
    /* A re-serialised body hashes differently from the one LINE signed — and that
       difference IS the disagreement this gate exists to report. `rawBody` may be a
       Buffer, which is why the context types it `Buffer | string`. */
    let hashed: unknown;
    await byId('verify-signature').run(
      ctx({
        meta: { signature: 's', rawBody: 'THE-EXACT-BYTES', baseUrl: 'x' },
      }),
      noDeps({
        validateSignature: (b) => {
          hashed = b;
          return true;
        },
      }),
    );
    expect(hashed).toBe('THE-EXACT-BYTES');
  });

  it('the re-read REPLACES the turn`s event and user', async () => {
    /* legacy re-reads `events[0]` rather than trusting the event the caller passed, and
       the multi-event loop is built around it: iteration 0 gets the original body,
       later ones a one-event slice. */
    const c = ctx({
      event: { type: 'stale' },
      userId: 'OLD',
      body: { events: [{ type: 'message', source: { userId: 'NEW' } }] },
    });
    expect(await byId('reread-event').run(c, noDeps())).toBe('continue');
    expect(c.event.type).toBe('message');
    expect(c.userId).toBe('NEW');
  });

  it('an empty delivery ends the turn', async () => {
    // The defensive twin — dead on today's only caller, which refuses an empty delivery
    // above the lock. Kept because it is what legacy wrote.
    expect(
      await byId('reread-event').run(ctx({ body: { events: [] } }), noDeps()),
    ).toBe('done');
    expect(await byId('reread-event').run(ctx({ body: {} }), noDeps())).toBe(
      'done',
    );
  });

  it('the room is created from the RE-READ event, not the caller`s', async () => {
    // Creating it from the stale event would put the room under the wrong customer.
    let got: Record<string, unknown> | null = null;
    const c = ctx({ event: { type: 'message' }, userId: 'U-REREAD' });
    await byId('ensure-room').run(
      c,
      noDeps({
        ensureRoom: (i) => {
          got = i;
          return Promise.resolve();
        },
      }),
    );
    expect((got as unknown as { userId: string }).userId).toBe('U-REREAD');
  });
});

/**
 * [PROG-20260905-LADDER] The customer slice — the two admin doors, the notice guard, the
 * abandon flow and the register keyword.
 */
describe('[PROG-20260905-LADDER] the customer slice', () => {
  const byId = (id: string): LadderStep =>
    CUSTOMER_LADDER.find((s) => s.id === id) as LadderStep;
  /* The REAL payload shape, taken from `PAYLINK_POSTBACK_PREFIX` rather than typed from
     memory — the first draft of these cases guessed `paylink:contact_admin` and went red,
     which is the guess this import removes. */
  const postback = (name: string) => ({
    type: 'postback' as const,
    postback: { data: `${PAYLINK_POSTBACK_PREFIX}${name}` },
  });

  it('a door fires on a PRESS and never on the same words typed', () => {
    /* 🔴 [FEAT-20260902-ADMINPOSTBACK] these used to fire on the SENTENCE, so a customer
       typing the words opened a case. `event.type === 'postback'` is part of the test, not
       decoration — `msgContent` holds the payload for a postback and the typed text for a
       message, so payload-equality alone would reopen the hole. */
    const direct = byId('admin-door-direct');
    expect(direct.when?.(ctx({ event: postback('contact_admin') }))).toBe(true);
    expect(
      direct.when?.(
        ctx({
          event: {
            type: 'message',
            message: { type: 'text', text: 'contact_admin' },
          },
          msgContent: 'contact_admin',
        }),
      ),
    ).toBe(false);
  });

  it('the two doors never both claim one press', () => {
    const d = byId('admin-door-direct');
    const w = byId('admin-door-withdraw');
    const one = ctx({ event: postback('contact_admin') });
    const two = ctx({ event: postback('contact_admin_via_withdraw') });
    expect([d.when?.(one), w.when?.(one)]).toEqual([true, false]);
    expect([d.when?.(two), w.when?.(two)]).toEqual([false, true]);
  });

  it('🔴 the withdraw door OPENS A CASE when its notice lane finds nothing', async () => {
    /* [FIX-20260902-WITHDRAWFALLTHROUGH] it used to hope to fall into the plain door, and
       could not: that door sits above and tests a different constant, and control only
       moves down. Reproduced live 02/09 — two taps, two menu cards, no case. */
    let opened: string | null = null;
    const verdict = await byId('admin-door-withdraw').run(
      ctx({ event: postback('contact_admin_via_withdraw') }),
      noDeps({
        tryNoticeGuard: () => Promise.resolve(false),
        openAdminCase: (d) => {
          opened = d;
          return Promise.resolve(true);
        },
      }),
    );
    expect(opened).not.toBeNull();
    expect(verdict).toBe('done');
  });

  it('the withdraw door does NOT open a case when a notice card answered', async () => {
    // A card was sent ⇒ that IS the answer. Opening a case too would double-answer.
    let opened = false;
    await byId('admin-door-withdraw').run(
      ctx({ event: postback('contact_admin_via_withdraw') }),
      noDeps({
        tryNoticeGuard: () => Promise.resolve(true),
        openAdminCase: () => {
          opened = true;
          return Promise.resolve(true);
        },
      }),
    );
    expect(opened).toBe(false);
  });

  it('the withdraw lane is told the SENTENCE, not the raw payload', async () => {
    /* Cases C and D short-circuit on `ctx.withdrawWord`, derived from the text passed in.
       Handing them the payload would make every withdraw case false and the door would
       always skip to the admin body — wired-looking, never firing. */
    let asked: Record<string, unknown> | null = null;
    await byId('admin-door-withdraw').run(
      ctx({ event: postback('contact_admin_via_withdraw') }),
      noDeps({
        tryNoticeGuard: (i) => {
          asked = i;
          return Promise.resolve(true);
        },
      }),
    );
    const text = (asked as unknown as { text: string }).text;
    expect(text).not.toContain('paylink:');
    expect(text.length).toBeGreaterThan(3);
  });

  it('the notice guard passes the assist flag, so an operator is not talked over', async () => {
    let asked: Record<string, unknown> | null = null;
    await byId('notice-text-guard').run(
      ctx({ skipBotProcessing: true, msgContent: 'ถอนเงินไม่ได้' }),
      noDeps({
        tryNoticeGuard: (i) => {
          asked = i;
          return Promise.resolve(false);
        },
      }),
    );
    expect((asked as unknown as { assisted: boolean }).assisted).toBe(true);
    expect((asked as unknown as { text: string }).text).toBe('ถอนเงินไม่ได้');
  });

  it('the register keyword ends the turn only when the handler HANDLED it', async () => {
    // `handled === false` falls through to the normal flow, exactly as legacy does.
    const step = byId('customer-register');
    expect(
      await step.run(
        ctx(),
        noDeps({
          handleCustomerRegister: () => Promise.resolve({ handled: true }),
        }),
      ),
    ).toBe('done');
    expect(
      await step.run(
        ctx(),
        noDeps({
          handleCustomerRegister: () => Promise.resolve({ handled: false }),
          runPaymentForSlip: () =>
            Promise.resolve({ suppress: false, lockedDuplicate: false }),
          handleSlipFlex: () =>
            Promise.resolve({
              isFlexSent: false,
              flexDoc: null,
              textReplyOverride: null,
              isQrCodeSlip: false,
              violationDetected: false,
              slipCondition: null,
            }),
          handleSlipCallback: () => {},
          replyMissingProfileData: () => Promise.resolve(),
        }),
      ),
    ).toBe('continue');
  });

  it('the abandon flow ends the turn only when it answered', async () => {
    const step = byId('follow-up');
    expect(
      await step.run(
        ctx(),
        noDeps({ runFollowUpFlow: () => Promise.resolve(true) }),
      ),
    ).toBe('done');
    expect(
      await step.run(
        ctx(),
        noDeps({ runFollowUpFlow: () => Promise.resolve(false) }),
      ),
    ).toBe('continue');
  });
});

/**
 * [PROG-20260905-LADDER] The media slice — the non-text lane, where every path ends the
 * turn.
 */
describe('[PROG-20260905-LADDER] the media slice', () => {
  const byId = (id: string): LadderStep =>
    MEDIA_LADDER.find((s) => s.id === id) as LadderStep;

  it('payment runs BEFORE the slip card, and its verdict suppresses it', async () => {
    /* The card send is what may need suppressing, so the decision has to EXIST before it.
       Both live in one step for that reason: as two rows a reorder could put the send
       first and the customer would get two answers to one slip. */
    const order: string[] = [];
    const c = ctx();
    await byId('slip-flex-send').run(
      c,
      noDeps({
        runPaymentForSlip: () => {
          order.push('payment');
          return Promise.resolve({ suppress: true, lockedDuplicate: false });
        },
        handleSlipFlex: (i) => {
          order.push('flex');
          expect((i as { suppressSlipReply: boolean }).suppressSlipReply).toBe(
            true,
          );
          return Promise.resolve({
            isFlexSent: false,
            flexDoc: null,
            textReplyOverride: null,
            isQrCodeSlip: false,
            violationDetected: false,
            slipCondition: null,
          });
        },
      }),
    );
    expect(order).toEqual(['payment', 'flex']);
  });

  it('🔴 a QR slip does NOT read the assist marker out of image_answer_text', () => {
    /* [FIX-20260817-QRNOTIMAGE] owner rule 17/08. The gate used to be
       `isNormalMedia || isSuccessfulQr`, so a slip that VERIFIED still opened a case for a
       card whose own "เปิดเคสให้แอดมินอัตโนมัติ" was unticked — and assist claiming the room
       first locked out the half that carries the card's reason into `direct_ticket_detail`.
       162 tickets on 17/08, only 11 with `direct_ticket: true`. */
    const step = byId('image-assist-hand-off');
    expect(
      step.when?.(ctx({ media: { ...ctx().media, isQrCodeSlip: true } })),
    ).toBe(false);
    expect(
      step.when?.(ctx({ media: { ...ctx().media, isQrCodeSlip: false } })),
    ).toBe(true);
  });

  it('a sent slip card ends the turn and fires the callback', async () => {
    let fired = false;
    const c = ctx({ media: { ...ctx().media, isFlexSent: true } });
    expect(byId('slip-card-sent').when?.(c)).toBe(true);
    expect(
      await byId('slip-card-sent').run(
        c,
        noDeps({
          handleSlipCallback: () => {
            fired = true;
          },
        }),
      ),
    ).toBe('done');
    expect(fired).toBe(true);
  });

  it('no card sent ⇒ the callback never fires and the lane continues', () => {
    expect(byId('slip-card-sent').when?.(ctx())).toBe(false);
  });

  /* [FEAT-20261014-CALLBACKCONTRACT] BOTH doors that fire the slip callback hand it the
     turn's contract code. Two doors on purpose: the assist bypass once kept a stale copy
     of a fix applied to the ordinary door only (`non-text/assist-bypass.ts`, the 1e45a70
     note) — one door fixed, the other silently not. ประตูสองบาน ต้องส่งครบทั้งสอง */
  it('🔴 [CALLBACKCONTRACT] the ordinary door hands the callback the contract code', async () => {
    let seen: Record<string, unknown> | undefined;
    const c = ctx({
      media: { ...ctx().media, isFlexSent: true },
      contractCode: 'CT-REAL-1',
    });
    await byId('slip-card-sent').run(
      c,
      noDeps({
        handleSlipCallback: (input: Record<string, unknown>) => {
          seen = input;
        },
      }),
    );
    expect(seen?.['contractCode']).toBe('CT-REAL-1');
  });

  it('🔴 [CALLBACKCONTRACT] the assist door hands it on too, into the callback it fires', async () => {
    let seen: Record<string, unknown> | undefined;
    const assistStep = ASSIST_BYPASS_LADDER.find(
      (st) => st.id === 'assist-bypass',
    )!;
    await assistStep.run(
      ctx({ skipBotProcessing: true, contractCode: 'CT-REAL-2' }),
      noDeps({
        runAssistBypass: (input: Record<string, unknown>) => {
          seen = input;
          return Promise.resolve();
        },
      }),
    );
    expect(seen?.['contractCode']).toBe('CT-REAL-2');
    /* …and the bypass forwards it into ITS handleSlipCallback call (code only — a
       comment naming the field is not the call passing it). */
    const raw = readFileSync(
      join(__dirname, '../../src/modules/webhook/non-text/assist-bypass.ts'),
      'utf8',
    );
    const kinds = classifyLines(raw);
    const code = raw
      .split('\n')
      .filter((_, i) => kinds[i] === 'code')
      .join('\n');
    const call = code.slice(code.indexOf('.handleSlipCallback({'));
    expect(call.slice(0, call.indexOf('})'))).toContain('contractCode');
  });

  /* [FEAT-20261019-CALLBACKLINEPROFILE] same two doors, same reason: the turn's LINE
     profile (`profileForLog`, already built by the spine) reaches the callback from both. */
  const LINE_PROFILE = {
    displayName: 'Door LINE Name',
    pictureUrl: 'https://profile.line-scdn.net/door',
    nickname: 'nick',
  };
  it('🔴 [CALLBACKLINEPROFILE] the ordinary door hands the callback the LINE profile', async () => {
    let seen: Record<string, unknown> | undefined;
    const step = byId('slip-card-sent');
    expect(step.reads).toContain('profileForLog');
    await step.run(
      ctx({
        media: { ...ctx().media, isFlexSent: true },
        profileForLog: LINE_PROFILE,
      }),
      noDeps({
        handleSlipCallback: (input: Record<string, unknown>) => {
          seen = input;
        },
      }),
    );
    expect(seen?.['lineProfile']).toBe(LINE_PROFILE);
  });

  it('🔴 [CALLBACKLINEPROFILE] the assist door hands it on too, into the callback it fires', async () => {
    let seen: Record<string, unknown> | undefined;
    const assistStep = ASSIST_BYPASS_LADDER.find(
      (st) => st.id === 'assist-bypass',
    )!;
    expect(assistStep.reads).toContain('profileForLog');
    await assistStep.run(
      ctx({ skipBotProcessing: true, profileForLog: LINE_PROFILE }),
      noDeps({
        runAssistBypass: (input: Record<string, unknown>) => {
          seen = input;
          return Promise.resolve();
        },
      }),
    );
    expect(seen?.['profileForLog']).toBe(LINE_PROFILE);
    const raw = readFileSync(
      join(__dirname, '../../src/modules/webhook/non-text/assist-bypass.ts'),
      'utf8',
    );
    const kinds = classifyLines(raw);
    const code = raw
      .split('\n')
      .filter((_, i) => kinds[i] === 'code')
      .join('\n');
    const call = code.slice(code.indexOf('.handleSlipCallback({'));
    expect(call.slice(0, call.indexOf('})'))).toContain(
      'lineProfile: profileForLog',
    );
  });

  it('🔴 a plain photo with NO QR ends at image_answer_text, not at the API-data line', () => {
    /* [FEAT-20260812-QRPRESCAN] owner 12/08. "ข้อความเมื่อไม่พบข้อมูล API" answers a
       customer whose QUESTION needed their profile; someone who simply sent a photo asked
       nothing of the kind. Seen live before the guard: an ordinary photo from an
       unregistered user answered with slip copy and stopped dead. */
    const step = byId('missing-profile-reply');
    const unregistered = { customerName: 'N/A', skipBotProcessing: false };
    expect(
      step.when?.(
        ctx({ ...unregistered, slip: { ...ctx().slip, noQrPhoto: true } }),
      ),
    ).toBe(false);
    expect(
      step.when?.(
        ctx({ ...unregistered, slip: { ...ctx().slip, noQrPhoto: false } }),
      ),
    ).toBe(true);
    // a registered customer never sees it either
    expect(step.when?.(ctx({ customerName: 'สมชาย' }))).toBe(false);
  });

  it('the override beats image_answer_text, and the marker never reaches the customer', async () => {
    /* [FIX-20260808-SLIPFLOW] legacy:3837 — the QR-fail text the flex branch sets takes
       precedence. And the `[[[assist]]]` strip is what stops an operator's marker being
       shown to a customer.
     *
     * ⚠️ AWAITED. `run` is declared to return `StepVerdict | Promise<StepVerdict>`, and
     * this case passed without the `await` only because THIS step happens to be
     * synchronous today. The moment it needs one `await` inside, the assertions below
     * would read the context before the step wrote it — and report green, because the
     * initial value of `cleanImageAnswer` is a legitimate string. เขียวเพราะบังเอิญ ไม่ใช่เพราะถูก */
    const c = ctx({
      media: {
        ...ctx().media,
        textReplyOverride: 'สลิปอ่านไม่ออก [[[assist]]]',
        rawImageAnswer: 'ได้รับรูปแล้วค่ะ',
      },
    });
    await byId('image-answer-text').run(c, noDeps());
    expect(c.media.cleanImageAnswer).toBe('สลิปอ่านไม่ออก');
    expect(c.media.cleanImageAnswer).not.toContain('assist');
  });
});
