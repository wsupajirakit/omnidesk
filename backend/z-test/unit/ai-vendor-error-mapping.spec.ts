/**
 * [FEAT-20260908-AIVENDORERR] One failure mapping, six lanes, both vendors.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 6
 * ============================================================================
 * `dig` was declared EIGHT times in this repo and the thrown-error → result
 * mapping SIX times, once per AI lane. All six produced the same value. This
 * proves the shared version still produces it — driven through the real
 * transports, not by calling the helper and agreeing with myself.
 *
 * 🔴 THE FAILURE PATH IS WHERE COPIES ROT. It is the branch nobody exercises by
 *    hand, so a divergence between two pasted copies can sit there for months.
 *    That is exactly what happened here and is pinned below: one lane's LOG line
 *    omits a fallback its result carries.
 *
 * ⚠️ NO NETWORK — `axios.post` is replaced per case.
 *
 * revert: delete this file with `vendor-error.ts`.
 */
import axios from 'axios';
import { Logger } from '@nestjs/common';

import {
  dig,
  vendorErrorMessage,
  vendorFailure,
  vendorSuccess,
} from '../../src/modules/ai-vendor';
import { GeminiReplyTransport } from '../../src/modules/webhook/ai-vendors/gemini/gemini-reply.transport';
import { DeepSeekReplyTransport } from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import { GeminiSummaryTransport } from '../../src/modules/webhook/ai-vendors/gemini/gemini-summary.transport';
import { DeepSeekSummaryTransport } from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-summary.transport';
import { GeminiTranslateTransport } from '../../src/modules/ai-translate/vendors/gemini-translate.transport';
import { DeepSeekTranslateTransport } from '../../src/modules/ai-translate/vendors/deepseek-translate.transport';

const replyCall = {
  instruction: 'I',
  blocks: [{ kind: 'question', text: 'Q' }],
  knobs: { temperature: 0.1, topP: 0.1, topK: 1 },
  thinkingBudget: null,
  apiKey: 'K',
  modelId: null,
} as never;
const summaryCall = {
  history: 'H',
  currentQuestion: 'Q',
  currentAnswer: 'A',
  apiKey: 'K',
  modelId: null,
} as never;
const translateCall = {
  text: 'x',
  targetLang: 'en',
  sourceLang: null,
  apiKey: 'K',
  modelId: null,
} as never;

/** Every lane, both vendors — the mapping must be identical across all of them. */
const LANES = [
  { id: 'gemini/reply', run: () => new GeminiReplyTransport().send(replyCall) },
  {
    id: 'gemini/summary',
    run: () => new GeminiSummaryTransport().send(summaryCall),
  },
  {
    id: 'gemini/translate',
    run: () => new GeminiTranslateTransport().send(translateCall),
  },
  {
    id: 'deepseek/reply',
    run: () => new DeepSeekReplyTransport().send(replyCall),
  },
  {
    id: 'deepseek/summary',
    run: () => new DeepSeekSummaryTransport().send(summaryCall),
  },
  {
    id: 'deepseek/translate',
    run: () => new DeepSeekTranslateTransport().send(translateCall),
  },
] as const;

/** Drive a lane with axios rejecting, and return what the transport produced. */
async function failWith(
  err: unknown,
  run: () => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const spy = jest.spyOn(axios, 'post').mockImplementation(() =>
    /* eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors --
       DELIBERATE: axios rejects with a plain object carrying `response`, not with
       an Error, and half the cases below reject with `{}` or `{response:{…}}` on
       purpose. Wrapping them in an Error to satisfy the rule would test a shape
       the vendor never produces, which is the opposite of what this file is for. */
    Promise.reject(err),
  );
  try {
    return (await run()) as Record<string, unknown>;
  } finally {
    spy.mockRestore();
  }
}

describe('[FEAT-20260908-AIVENDORERR] all six lanes map a failure identically', () => {
  it('🔴 a vendor 429 with a JSON body — same result shape in every lane', async () => {
    const err = {
      response: { status: 429, data: { error: { message: 'rate limited' } } },
    };
    const expected = {
      rawText: undefined,
      httpStatus: 429,
      raw: { error: { message: 'rate limited' } },
      errorMessage: JSON.stringify({ error: { message: 'rate limited' } }),
    };
    for (const lane of LANES) {
      /* Asserted per lane rather than in a loop-free blob so a failure names
         WHICH lane diverged. */
      expect({ lane: lane.id, ...(await failWith(err, lane.run)) }).toEqual({
        lane: lane.id,
        ...expected,
      });
    }
  });

  it('🔴 a STRING body is passed through verbatim, not re-stringified', async () => {
    /* `JSON.stringify('boom')` would be `"\"boom\""` — quotes baked into the
       stored message. Every original copy checked for a string first. */
    const err = { response: { status: 500, data: 'boom' } };
    for (const lane of LANES) {
      const out = await failWith(err, lane.run);
      expect({
        lane: lane.id,
        msg: out['errorMessage'],
        raw: out['raw'],
      }).toEqual({ lane: lane.id, msg: 'boom', raw: 'boom' });
    }
  });

  it('🔴 no response at all ⇒ httpStatus 0 and raw null, never undefined', async () => {
    /* 0 is the agreed "never reached a response" value callers branch on, and
       `raw` must be null because it is written into audit rows — `undefined`
       vanishes from JSON while null survives as evidence the call failed. */
    const err = new Error('socket hang up');
    for (const lane of LANES) {
      const out = await failWith(err, lane.run);
      expect({
        lane: lane.id,
        status: out['httpStatus'],
        raw: out['raw'],
        msg: out['errorMessage'],
      }).toEqual({
        lane: lane.id,
        status: 0,
        raw: null,
        msg: JSON.stringify('socket hang up'),
      });
    }
  });

  it("🔴 an error with NOTHING on it still yields the string 'error'", async () => {
    /* The final `?? 'error'` matters: `JSON.stringify(undefined)` returns the
       VALUE undefined, not a string, which would put a non-string into a field
       every caller treats as text. */
    for (const lane of LANES) {
      const out = await failWith({}, lane.run);
      expect({ lane: lane.id, msg: out['errorMessage'] }).toEqual({
        lane: lane.id,
        msg: JSON.stringify('error'),
      });
      expect(typeof out['errorMessage']).toBe('string');
    }
  });
});

describe('[FEAT-20260908-AIVENDORERR] the divergence that was found and PRESERVED', () => {
  it("🔴 deepseek/translate's LOG omits the `?? 'error'` its result carries", async () => {
    /* Found while moving the mapping. On an error with no body and no message
       this lane logs the literal "undefined" while the stored errorMessage reads
       "error". Routing the log through the shared helper would have silently
       changed what the line prints — so the mapping is shared and the log line
       was left byte-identical. Pinned so the difference stays deliberate. */
    const logged: string[] = [];
    const errSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((m: unknown) => {
        logged.push(String(m));
      });

    try {
      const out = await failWith({}, () =>
        new DeepSeekTranslateTransport().send(translateCall),
      );
      // the RESULT carries the fallback …
      expect(out['errorMessage']).toBe(JSON.stringify('error'));
      // … the LOG does not.
      expect(logged.join('\n')).toContain('translate error: undefined');
      expect(logged.join('\n')).not.toContain('translate error: "error"');
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('[FEAT-20260908-AIVENDORERR] the helpers themselves', () => {
  it('dig walks safely and stops at the first non-object', () => {
    expect(dig({ a: { b: { c: 1 } } }, 'a', 'b', 'c')).toBe(1);
    expect(dig({ a: null }, 'a', 'b')).toBeUndefined();
    expect(dig(undefined, 'a')).toBeUndefined();
    expect(dig('str', 'length')).toBeUndefined(); // not an object ⇒ undefined
  });

  it('vendorErrorMessage and vendorFailure agree on the message', () => {
    const err = { response: { status: 400, data: { m: 1 } } };
    expect(vendorFailure(err).errorMessage).toBe(vendorErrorMessage(err));
  });
});

describe('[FEAT-20260908-AIVENDORERR] the SUCCESS envelope, shared by all six', () => {
  /** Drive a lane with axios resolving, and return what the transport produced. */
  async function okWith(
    res: unknown,
    run: () => Promise<unknown>,
  ): Promise<Record<string, unknown>> {
    const spy = jest
      .spyOn(axios, 'post')
      .mockImplementation(() => Promise.resolve(res));
    try {
      return (await run()) as Record<string, unknown>;
    } finally {
      spy.mockRestore();
    }
  }

  const answered = {
    status: 200,
    data: {
      candidates: [{ content: { parts: [{ text: 'HI' }] } }],
      choices: [{ message: { content: 'HI' }, finish_reason: 'stop' }],
    },
  };

  it('🔴 every lane returns errorMessage NULL on success, never undefined', async () => {
    /* Every interpreter gates on `rawText === undefined && errorMessage !== null`.
       An `undefined` here would make a successful EMPTY answer look like a
       failure — the two states must stay distinguishable. */
    for (const lane of LANES) {
      const out = await okWith(answered, lane.run);
      expect({
        lane: lane.id,
        msg: out['errorMessage'],
        text: out['rawText'],
      }).toEqual({ lane: lane.id, msg: null, text: 'HI' });
    }
  });

  it('🔴 a non-numeric status falls back to 200, not 0', async () => {
    /* The asymmetry with vendorFailure is deliberate: reaching the success path
       means the vendor ANSWERED, so an unreported status is "answered, status
       unknown". `vendorFailure` uses 0 because it never reached a response. */
    for (const lane of LANES) {
      const out = await okWith({ ...answered, status: undefined }, lane.run);
      expect({ lane: lane.id, status: out['httpStatus'] }).toEqual({
        lane: lane.id,
        status: 200,
      });
    }
  });

  it('🔴 raw carries the vendor body through untouched', async () => {
    for (const lane of LANES) {
      const out = await okWith(answered, lane.run);
      expect(out['raw']).toBe(answered.data);
    }
  });

  it('the helper alone behaves the same as the lanes do', () => {
    expect(vendorSuccess({ status: 429, data: { a: 1 } }, 'T')).toEqual({
      rawText: 'T',
      httpStatus: 429,
      raw: { a: 1 },
      errorMessage: null,
    });
    expect(vendorSuccess({ data: null }, undefined)).toEqual({
      rawText: undefined,
      httpStatus: 200,
      raw: null,
      errorMessage: null,
    });
  });
});
