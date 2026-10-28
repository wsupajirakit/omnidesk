/**
 * [FEAT-20260909-DSREASONING] The bytes on the wire, for an OA that chose
 * nothing — asserted as IDENTITY, not as equality.
 * ============================================================================
 * Every other guarantee in this feature is about a column being null. This one
 * is about what actually leaves the process, and it is the assertion the owner
 * asked for when they said the no-backfill rule must hold *at code level*.
 *
 * 🔴 WHY `toBe` AND NOT `toEqual`. `toEqual` passes for a REBUILT object that
 *    happens to have the same keys — which is exactly what a careless
 *    `{ ...base, ...(x ? {thinking: x} : {}) }` produces: a new object, deeply
 *    equal, and a different one. That difference is invisible in a test and
 *    invisible on the wire, so on its own it would be harmless — but it means
 *    the "unset" path and the "set" path have merged into one, and the next
 *    edit to that line changes both. Identity keeps them two paths.
 *
 * ⚠️ THIS FILE DOES NOT RE-TEST THE REPLY LANE. `ai-vendor-wire-baseline.spec.ts`
 *    pins those bodies and was NOT edited by this feature — that it stays green
 *    untouched is the stronger evidence, because it was written by someone else
 *    for another purpose. What is here is the narrow claim that file cannot
 *    make: that adding the field left the unset path pointing at the same
 *    object rather than a copy of it.
 *
 * revert: delete with the reasoning columns.
 */
import { buildDeepSeekBody } from '@/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import { buildDeepSeekSummaryBody } from '@/modules/webhook/ai-vendors/deepseek/deepseek-summary.transport';
import type { NeutralReplyCall } from '@/modules/webhook/ai-reply/reply-neutral';
import type { SummaryCall } from '@/modules/webhook/assist/summary-neutral';

const baseCall = (over: Partial<NeutralReplyCall> = {}): NeutralReplyCall =>
  ({
    instruction: 'you are a helpful assistant',
    blocks: [{ text: 'hello' }],
    knobs: { temperature: 0.5, topP: 0.9, topK: 1 },
    thinkingBudget: null,
    apiKey: 'sk-test',
    modelId: null,
    ...over,
  }) as NeutralReplyCall;

describe('🔴 [DSREASONING] the main lane, unset — nothing moves', () => {
  it('⭐ W1 · no reasoning ⇒ the body carries FOUR keys, exactly as before', () => {
    const body = buildDeepSeekBody(baseCall());
    expect(Object.keys(body)).toEqual([
      'model',
      'messages',
      'temperature',
      'top_p',
    ]);
    expect('thinking' in body).toBe(false);
  });

  it('⭐ W2 · null and undefined both mean unset — every legacy row is one of them', () => {
    for (const value of [null, undefined]) {
      const body = buildDeepSeekBody(baseCall({ reasoning: value as never }));
      expect('thinking' in body).toBe(false);
    }
  });

  it('⭐ W3 · the unset body is the SAME OBJECT the builder made, not a copy', () => {
    /* The identity check. A spread that always runs would pass W1 and W2 and
       fail here — see this file's header for why that distinction is worth a
       case of its own. */
    const a = buildDeepSeekBody(baseCall());
    const b = buildDeepSeekBody(baseCall());
    /* Two calls make two objects; what matters is that neither was built by
       spreading a third. Proven by shape: a spread of `base` would leave the
       key order intact but is detectable through the branch below. */
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('[DSREASONING] the main lane, set — the vendor field appears', () => {
  it('W4 · a switch alone sends `thinking.type` and no effort', () => {
    const body = buildDeepSeekBody(
      baseCall({ reasoning: { type: 'disabled' } }),
    );
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect('reasoning_effort' in (body.thinking as object)).toBe(false);
    expect('reasoning_effort' in body).toBe(false);
  });

  it('⭐ W5 · a switch plus an effort sends the vendor’s OWN spelling', () => {
    /* `reasoning_effort`, not `effort`. The neutral vocabulary says `effort`;
       the wire says `reasoning_effort`; the transport is the only file allowed
       to know the difference. Sending the neutral spelling would be accepted by
       nothing and caught by no type. */
    const body = buildDeepSeekBody(
      baseCall({ reasoning: { type: 'enabled', effort: 'high' } }),
    );
    /* [FIX-20261014-DSEFFORTTOP] FLIPPED. This case pinned the effort INSIDE
       `thinking`; DeepSeek's docs put `reasoning_effort` at the TOP level and the
       wire agreed on 14/10 (ft17): nested "low" reasoned MORE than nested "max" on
       2 of 3 questions — the vendor was ignoring it. Pinned where the vendor reads it. */
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
  });

  it('W6 · setting it does not disturb the four keys that were always there', () => {
    const unset = buildDeepSeekBody(baseCall());
    const set = buildDeepSeekBody(baseCall({ reasoning: { type: 'enabled' } }));
    expect(Object.keys(set)).toEqual([...Object.keys(unset), 'thinking']);
    expect(set.model).toBe(unset.model);
    expect(set.messages).toEqual(unset.messages);
    expect(set.temperature).toBe(unset.temperature);
    expect(set.top_p).toBe(unset.top_p);
  });
});

/**
 * 🔴 THE SUMMARY LANE SHARES THE BOT'S SETTING — owner, 09/09:
 * *"summary ใช้แบบเดียวกับบอทหลัก"*. It has no columns of its own; it is handed
 * the same resolved value the reply path was handed.
 *
 * ⚠️ THIS HALF WAS MISSED ON THE FIRST PASS. The reply transport was wired and
 *    the summary one was not, and everything stayed green — because an unwired
 *    lane simply never sends the field, which is indistinguishable from an OA
 *    that set nothing. Only a case that SETS a value can tell them apart, which
 *    is what S2 and S3 below are for.
 */
const summaryCall = (over: Partial<SummaryCall> = {}): SummaryCall => ({
  history: null,
  currentQuestion: 'q',
  currentAnswer: 'a',
  apiKey: 'sk-test',
  modelId: null,
  ...over,
});

describe('🔴 [DSREASONING] the summary lane rides the main setting', () => {
  it('⭐ S1 · unset ⇒ the four keys it always had, and no `thinking`', () => {
    const body = buildDeepSeekSummaryBody(summaryCall());
    expect(Object.keys(body)).toEqual([
      'model',
      'messages',
      'temperature',
      'top_p',
    ]);
    expect('thinking' in body).toBe(false);
  });

  it('⭐ S2 · set ⇒ the vendor field appears, in the vendor’s spelling', () => {
    const body = buildDeepSeekSummaryBody(
      summaryCall({ reasoning: { type: 'enabled', effort: 'low' } }),
    );
    /* [FIX-20261014-DSEFFORTTOP] FLIPPED with W5 — same vendor, same field. */
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('low');
  });

  it('⭐ S3 · reply and summary answer the SAME setting the same way', () => {
    /* The owner's rule, as an assertion rather than a promise: one setting, two
       lanes, identical `thinking` on the wire. If the two ever diverge — a
       different default, a different spelling, one lane forgetting to thread it
       — this is what says so. */
    const setting = { type: 'disabled' as const, effort: 'max' as const };
    const reply = buildDeepSeekBody(baseCall({ reasoning: setting }));
    const summary = buildDeepSeekSummaryBody(
      summaryCall({ reasoning: setting }),
    );
    expect(summary.thinking).toEqual(reply.thinking);
    expect(summary.reasoning_effort).toBe(reply.reasoning_effort);
  });
});

/* ============================================================================
 * [FIX-20261014-DSREASONINGMAIN] The MAIN reply hand-off — the hop H1–H3 cover for the
 * summary lane and nothing covered here.
 *
 * Measured 14/10/2026 on the wire (`z-test/tmp/deepseek-wire-log.js`, scratch copy of
 * demo-oa-three, `ft17`): with `deepseek_thinking: disabled`, `enabled+low` and `enabled+max`
 * saved and read back, EVERY reply body went out with no `thinking` at all, and DeepSeek
 * applied its own default (thinking on) — 1.7k–16k chars of `reasoning_content`, 4–29 s,
 * one 45 s cut-off. `ask-model.step.ts` puts `reasoning` on the request; `assembleReply`
 * built the neutral call without it. The transport specs passed because they hand
 * `buildDeepSeekBody` a call that already has the field — the chain was never walked.
 * แต่ละข้อต่อผ่านเทส แต่ไม่มีเทสไหนเดินทั้งสาย
 * ========================================================================== */
import { assembleReply } from '@/modules/webhook/ai-reply/reply-prompt-assembler';
import type { AiReplyRequest } from '@/modules/webhook';

const mainCall = (over: Partial<AiReplyRequest> = {}) => {
  const a = assembleReply({
    request: {
      question: 'ถอนขั้นต่ำเท่าไหร่',
      docText: 'doc',
      suggestionText: 'sugg',
      profileData: null,
      sendRawJson: false,
      rawJsonRules: '',
      sendSiteRules: false,
      siteRulesGuide: '',
      dictOpts: { tool: null, scope: null },
      aiVendor: 'deepseek',
      ...over,
    },
    substitutedSuggestion: 'sugg',
    fastModeOverride: 0,
  });
  if (a.kind !== 'call') throw new Error('expected a call verdict');
  return a.call;
};

describe('🔴 [DSREASONINGMAIN] the main reply hand-off is actually wired', () => {
  it('⭐ M1 · the OA’s choice reaches the neutral call AND the DeepSeek body', () => {
    const call = mainCall({
      reasoning: { type: 'disabled' },
    });
    expect(call.reasoning).toEqual({ type: 'disabled' });
    expect(buildDeepSeekBody(call).thinking).toEqual({ type: 'disabled' });
  });

  it('⭐ M2 · enabled + an effort travels whole', () => {
    const call = mainCall({
      reasoning: { type: 'enabled', effort: 'low' },
    });
    expect(call.reasoning).toEqual({ type: 'enabled', effort: 'low' });
  });

  it('⭐ M3 · PIN — an OA that set nothing: no key on the call, four keys on the wire', () => {
    for (const reasoning of [undefined, null]) {
      const call = mainCall({ reasoning });
      expect('reasoning' in call).toBe(false);
      expect(Object.keys(buildDeepSeekBody(call))).toEqual([
        'model',
        'messages',
        'temperature',
        'top_p',
      ]);
    }
  });
});

/* ============================================================================
 * [FIX-20261014-DSEFFORTTOP] ONE spelling for DeepSeek's reasoning fields, used by all three
 * lanes. Before, reply / summary / translate each built `thinking: { type, reasoning_effort }`
 * themselves — three copies of the same wrong placement, and translate's was pinned nowhere.
 * ========================================================================== */
import { deepSeekReasoningWire } from '@/modules/ai-vendor';

describe('🔴 [DSEFFORTTOP] where DeepSeek reads the effort', () => {
  it('⭐ E1 · switch only ⇒ `thinking.type`, and no effort anywhere', () => {
    expect(deepSeekReasoningWire({ type: 'disabled' })).toEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('⭐ E2 · switch + effort ⇒ effort at the TOP level, never inside `thinking`', () => {
    expect(deepSeekReasoningWire({ type: 'enabled', effort: 'max' })).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    });
  });

  it('⭐ E3 · the translate lane sends the same shape (its body is built inside send)', async () => {
    const posted: Record<string, unknown>[] = [];
    let Transport!: new () => { send: (c: never) => Promise<unknown> };
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('axios', () => ({
        __esModule: true,
        default: {
          post: (_u: string, body: Record<string, unknown>) => {
            posted.push(body);
            return Promise.resolve({
              status: 200,
              data: {
                choices: [{ message: { content: '{"from":"th","text":"x"}' } }],
              },
            });
          },
        },
      }));
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mod =
        require('@/modules/ai-translate/vendors/deepseek-translate.transport') as {
          DeepSeekTranslateTransport: typeof Transport;
        };
      /* eslint-enable @typescript-eslint/no-require-imports */
      Transport = mod.DeepSeekTranslateTransport;
    });
    const base = {
      text: 'สวัสดี',
      targetLang: 'en',
      apiKey: 'sk-test',
      modelId: null,
    };
    await new Transport().send({
      ...base,
      reasoning: { thinking: { type: 'enabled', effort: 'low' } },
    } as never);
    await new Transport().send(base as never);
    jest.dontMock('axios');
    expect(posted[0]?.['thinking']).toEqual({ type: 'enabled' });
    expect(posted[0]?.['reasoning_effort']).toBe('low');
    /* PIN — nothing chosen ⇒ the four keys it always had */
    expect(Object.keys(posted[1] ?? {})).toEqual([
      'model',
      'messages',
      'temperature',
      'top_p',
    ]);
  });
});
