/**
 * [FEAT-20260830-AIRETRY] one retry when the model call TIMES OUT,
 * [FEAT-20260830-REPLYPUSH] and reply → push when the send itself fails.
 *
 * WHY
 *   `rag-engine.service.ts:66-69` records why the ceiling is 30s: it was
 *   "7.6x the worst generate_response ever measured (max 3953ms)". Today the
 *   worst measured is 23,022ms, so the margin is 1.3x — the tail grew 5.8x
 *   while the ceiling stayed put, and calls now fall off the edge. Measured on
 *   the real rows: a timeout on 27/08 18:56:29 was followed 3 seconds later by
 *   the same question answering in 2,217ms. One retry is worth having.
 *   It is NOT a cure — 3 of the 5 observed timeouts arrived inside one
 *   55-second burst, where a retry fails too. That limit is accepted.
 *
 * SCOPE — deliberately narrow
 *   · TIMEOUTS ONLY. A 4xx/5xx is a known outcome and is never repeated, which
 *     is also what keeps wrap-ai-w1b-transport.spec.ts green.
 *   · The reply seam only. assist-summary, ticket-translate, doc-retrieval and
 *     the two room-classification calls share `GEMINI_HTTP_OPTS`, so that
 *     object is never touched — it is also byte-pinned against the legacy
 *     checkout by rag-engine-parity.spec.ts:389-391.
 *   · Attempt ONE keeps the 30s it has today, so no OA gets slower behaviour.
 *
 * The timeout test itself follows the idiom this repo already uses in two
 * places verbatim — `custom-tool.service.ts:953-955` and
 * `external-api.service.ts:602-606`.
 */
import axios from 'axios';
import { Logger } from '@nestjs/common';

import { GeminiReplyTransport } from '@/modules/webhook/ai-vendors/gemini/gemini-reply.transport';
import { GEMINI_HTTP_OPTS } from '@/modules/ai/rag-engine.service';
import {
  replyViaCore,
  replyThenPush,
  textReply,
} from '@/modules/webhook/hook-reply/reply-via-core';
import type { NeutralReplyCall } from '@/modules/webhook/ai-reply/reply-neutral';
import type {
  LineMessage,
  LineSendRequest,
} from '@/infra/line/push/line-push.types';

// ── HTTP capture: url + body + CONFIG (the config is the point here) ───────
type HttpArgs = unknown[];
const posts: Array<{ url: string; body: unknown; config: unknown }> = [];
const httpPost = jest.fn((...args: HttpArgs): Promise<unknown> => {
  posts.push({
    url: String(args[0]),
    body: JSON.parse(JSON.stringify(args[1])),
    config: args[2],
  });
  return Promise.reject(new Error('[AIRETRY] no response armed'));
});
jest
  .spyOn(axios, 'post')
  .mockImplementation((...a: HttpArgs) => httpPost(...a));
globalThis.fetch = () => Promise.reject(new Error('[AIRETRY] fetch blocked'));

/* [FIX-20260901-AIRETRYLOG] Kept, not discarded: the retry's own warning is the
   ONLY record the first attempt leaves, so it is worth asserting on rather than
   silencing blindly. */
let warnSpy: jest.SpyInstance;

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

/** Everything warned during one test, joined — order does not matter here. */
const warnedText = (): string =>
  warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
/* mockReset, not mockClear: a test that arms two responses but only consumes
   one would otherwise leak the leftover `…Once` into the next test — which is
   exactly what happens while the retry does not exist yet, and would make the
   red-first run lie about which case failed. The base implementation is
   re-installed here so every test starts from "nothing armed". */
beforeEach(() => {
  warnSpy?.mockClear();
  posts.length = 0;
  httpPost.mockReset();
  httpPost.mockImplementation((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return Promise.reject(new Error('[AIRETRY] no response armed'));
  });
});

const OK = { candidates: [{ content: { parts: [{ text: 'คำตอบจริง' }] } }] };

/** What axios actually throws on a timeout — code AND message, like the real one. */
const timeoutErr = () =>
  Object.assign(new Error('timeout of 30000ms exceeded'), {
    code: 'ECONNABORTED',
  });

const armOnce = (fn: () => Promise<unknown>) =>
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
      config: args[2],
    });
    return fn();
  });
const armOk = (data: unknown = OK) =>
  armOnce(() => Promise.resolve({ status: 200, data }));
const armTimeout = () => armOnce(() => Promise.reject(timeoutErr()));
/* axios throws an Error carrying `.response`, and the transport reads it with
   `dig(err,'response','status')` — so the double has to be an Error too, not a
   bare object, or the shape under test is not the shape that ships. */
const armStatus = (status: number, data: unknown) =>
  armOnce(() =>
    Promise.reject(
      Object.assign(new Error(`HTTP ${status}`), {
        response: { status, data },
      }),
    ),
  );

const callFor = (over: Partial<NeutralReplyCall> = {}): NeutralReplyCall => ({
  instruction: 'sys',
  blocks: [{ kind: 'question', text: 'Question:\nสวัสดี' }],
  knobs: { temperature: 0, topP: 0.1, topK: 1 },
  modelId: 'gemini-3.5-flash',
  apiKey: 'K',
  thinkingBudget: 0,
  ...over,
});

describe('[FEAT-20260830-AIRETRY] retry — TIMEOUT only', () => {
  it('TARGET 1: first attempt times out, second succeeds → the real answer', async () => {
    armTimeout();
    armOk();
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(2);
    expect(res.rawText).toContain('คำตอบจริง');
    expect(res.httpStatus).toBe(200);
    expect(res.errorMessage).toBeNull();
  });

  it('TARGET 2: the second attempt sends the SAME body — a retry, not a new request', async () => {
    armTimeout();
    armOk();
    await new GeminiReplyTransport().send(callFor());
    expect(JSON.stringify(posts[1]!.body)).toBe(JSON.stringify(posts[0]!.body));
    expect(posts[1]!.url).toBe(posts[0]!.url);
  });

  it('TARGET 3: ⭐⭐ attempt 1 keeps the full ceiling; attempt 2 gets its OWN shorter budget', async () => {
    /* [FEAT-20260908-AITIMEOUT] 45 + 30 = 75s, still inside REPLY_STALE_MS
       (120s) — it was 30 + 20 = 50s until the owner raised both on 08/09/2026.
       What this case defends is the SHAPE, not the numbers: attempt 1 gets the
       shared ceiling so no OA becomes slower than it already is, and attempt 2
       is strictly shorter because it exists to catch a transient stall rather
       than to double the customer's wait. The second config must NOT be the
       shared object — see the PIN below. */
    armTimeout();
    armOk();
    await new GeminiReplyTransport().send(callFor());
    /* [FEAT-20260908-GEMINIKEYHEADER] both attempts also carry the key header —
       a retry that dropped it would answer 401 and read as the model refusing. */
    const first = posts[0]!.config as { timeout: number; headers: unknown };
    const second = posts[1]!.config as { timeout: number; headers: unknown };
    expect(first.timeout).toBe(GEMINI_HTTP_OPTS.timeout);
    expect(first.timeout).toBe(45000);
    expect(second.timeout).toBe(30000);
    /* the ordering rule, asserted rather than implied by two literals */
    expect(second.timeout).toBeLessThan(first.timeout);
    expect(first.timeout + second.timeout).toBeLessThan(120000);
    /* both carry the key — a retry that dropped it would answer 401 and read as
       the model refusing */
    expect(first.headers).toEqual({ 'x-goog-api-key': 'K' });
    expect(second.headers).toEqual({ 'x-goog-api-key': 'K' });
  });

  it('TARGET 4: both attempts time out → the error contract is unchanged', async () => {
    armTimeout();
    armTimeout();
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(2);
    expect(res.rawText).toBeUndefined();
    expect(res.httpStatus).toBe(0);
    expect(String(res.errorMessage)).toContain('timeout');
  });

  it('TARGET 5: a timeout WITHOUT err.code is still a timeout (message match)', async () => {
    // axios does not always set ECONNABORTED; the repo's idiom checks both.
    armOnce(() => Promise.reject(new Error('timeout of 30000ms exceeded')));
    armOk();
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(2);
    expect(res.httpStatus).toBe(200);
  });

  it('PIN 1: ⭐⭐⭐ a 500 is a KNOWN outcome — one attempt, never repeated', async () => {
    armStatus(500, 'boom');
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(1);
    expect(res.httpStatus).toBe(500);
  });

  it('PIN 2: a 429 is not repeated either — retrying a rate limit makes it worse', async () => {
    armStatus(429, { error: { message: 'quota' } });
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(1);
    expect(res.httpStatus).toBe(429);
  });

  it('PIN 3: a plain network error is NOT a timeout — one attempt', async () => {
    armOnce(() => Promise.reject(new Error('socket hang up')));
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(1);
    expect(res.httpStatus).toBe(0);
  });

  it('PIN 4: the 400/think re-fire still fires ONCE, not twice', async () => {
    armStatus(400, { error: { message: 'thinkingConfig not supported' } });
    armOk();
    const res = await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(2);
    expect(JSON.stringify(posts[1]!.body)).not.toContain('thinkingConfig');
    expect(res.httpStatus).toBe(200);
  });

  it('PIN 5: ⭐⭐⭐ the SHARED GEMINI_HTTP_OPTS is never mutated or re-keyed', async () => {
    /* It is byte-pinned against the legacy checkout
       (rag-engine-parity.spec.ts:389-391) and shared by nine call sites across
       six subsystems — assist summary, ticket translate, doc retrieval and the
       two room-classification calls all read this exact object.
     *
     * 🔴 [FEAT-20260908-GEMINIKEYHEADER] THE PROPERTY IS UNCHANGED; ONE PROXY FOR
     *    IT HAD TO GO. This case used to assert `posts[0].config` was the shared
     *    object BY IDENTITY (`toBe`). That was a stand-in for "nobody writes to
     *    the shared object", and it stops being available the moment a request
     *    carries a per-request header: a key belongs to ONE hook, so putting it
     *    on an object nine call sites share would leak that hook's credential
     *    into every other caller's config — precisely the failure this pin
     *    exists to prevent.
     *
     *    So the transports now SPREAD the shared value and never write to it, and
     *    the assertions below check the property directly instead of through
     *    identity: the shared object still has exactly one key and the same
     *    value AFTER a send, the config that actually went out is NOT that
     *    object, and it carries the shared timeout rather than a re-typed copy. */
    armTimeout();
    armOk();
    await new GeminiReplyTransport().send(callFor());
    expect(GEMINI_HTTP_OPTS).toEqual({ timeout: 45000 });
    expect(Object.keys(GEMINI_HTTP_OPTS)).toEqual(['timeout']);
    /* never handed out, so it can never be mutated by a callee */
    expect(posts[0]!.config).not.toBe(GEMINI_HTTP_OPTS);
    expect(posts[1]!.config).not.toBe(GEMINI_HTTP_OPTS);
    /* but its VALUE is what attempt 1 uses — not a second literal that could drift */
    expect((posts[0]!.config as { timeout: number }).timeout).toBe(
      GEMINI_HTTP_OPTS.timeout,
    );
  });

  it('PIN 6: exactly ONE retry — a third attempt never happens', async () => {
    armTimeout();
    armTimeout();
    armOk(); // would be attempt 3; must never be reached
    await new GeminiReplyTransport().send(callFor());
    expect(posts).toHaveLength(2);
  });
});

// ── the send ladder ────────────────────────────────────────────────────────
const okRes = { ok: true as const, status: 200, data: { sent: 1 } };
const failRes = (status = 400, reason = 'Invalid reply token') => ({
  ok: false,
  status,
  reason,
  raw: new Error(reason),
});

const recorder = (results: unknown[]) => {
  const seen: LineSendRequest[] = [];
  let i = 0;
  const send = (req: LineSendRequest) => {
    seen.push(req);
    return Promise.resolve(
      (results[i++] ?? failRes(500, 'no result armed')) as never,
    );
  };
  return { send, seen };
};

describe('[FEAT-20260830-REPLYPUSH] send ladder — reply first, push only if it fails', () => {
  const MSGS = [{ type: 'text', text: 'ข้อความ' }] as unknown as LineMessage[];

  it('TARGET 6: reply succeeds → push is never attempted', async () => {
    const { send, seen } = recorder([okRes]);
    const res = await replyThenPush(send, 'TOK', 'RT', 'U1', MSGS);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe('reply');
    expect(res.via).toBe('reply');
    expect(res.status).toBe(200);
  });

  it('TARGET 7: ⭐⭐ reply fails → the SAME messages go out as a push', async () => {
    const { send, seen } = recorder([failRes(), okRes]);
    const res = await replyThenPush(send, 'TOK', 'RT', 'U1', MSGS);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.kind).toBe('reply');
    expect(seen[1]!.kind).toBe('push');
    expect(seen[1]!.to).toBe('U1');
    expect(seen[1]!.messages).toEqual(seen[0]!.messages);
    expect(res.via).toBe('push');
    expect(res.status).toBe(200);
  });

  it('TARGET 8: reply is ALWAYS tried first — push is never the first move', async () => {
    const { send, seen } = recorder([failRes(), okRes]);
    await replyThenPush(send, 'TOK', 'RT', 'U1', MSGS);
    expect(seen[0]!.kind).toBe('reply');
  });

  it('PIN 7: no userId → the old contract, it throws', async () => {
    const { send, seen } = recorder([failRes()]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', null, MSGS),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });

  it('PIN 8: both legs fail → it throws, never silently swallows', async () => {
    const { send } = recorder([failRes(), failRes(500, 'push died')]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', 'U1', MSGS),
    ).rejects.toThrow();
  });

  /* [FEAT-20260830-REPLYPUSH] the NARROW rule, owner's decision 30/08.
     A push reuses the same channel token, so it can only rescue a refusal that
     is about the REPLY TOKEN. Anything else would fail again and burn a call. */
  it('PIN 11: ⭐⭐⭐ a 401 takes NO push — the channel token is the problem', async () => {
    const { send, seen } = recorder([
      failRes(401, 'HTTP 401 - Authentication failed'),
    ]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', 'U1', MSGS),
    ).rejects.toThrow();
    expect(seen.map((s) => s.kind)).toEqual(['reply']);
  });

  it('PIN 12: ⭐⭐ a 429 takes NO push — pushing a spent quota makes it worse', async () => {
    const { send, seen } = recorder([
      failRes(429, 'HTTP 429 - Too Many Requests'),
    ]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', 'U1', MSGS),
    ).rejects.toThrow();
    expect(seen.map((s) => s.kind)).toEqual(['reply']);
  });

  it('PIN 13: a 400 that is NOT a token problem takes no push either', async () => {
    const { send, seen } = recorder([
      failRes(
        400,
        'HTTP 400 - A message (messages[0]) in the request body is invalid',
      ),
    ]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', 'U1', MSGS),
    ).rejects.toThrow();
    expect(seen.map((s) => s.kind)).toEqual(['reply']);
  });

  it('PIN 14: a 5xx / transport failure takes no push', async () => {
    const { send, seen } = recorder([failRes(500, 'HTTP 500')]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', 'U1', MSGS),
    ).rejects.toThrow();
    expect(seen.map((s) => s.kind)).toEqual(['reply']);
  });

  it('PIN 15: the token refusal is recognised from LINE\u2019s own body too', async () => {
    // `data` carries LINE's body verbatim; `reason` is the normalized string.
    // Either one is enough, so a sender that fills only one still works.
    const { send, seen } = recorder([
      {
        ok: false,
        status: 400,
        data: { message: 'Invalid reply token' },
        raw: new Error('Request failed with status code 400'),
      },
      okRes,
    ]);
    const res = await replyThenPush(send, 'TOK', 'RT', 'U1', MSGS);
    expect(seen.map((s) => s.kind)).toEqual(['reply', 'push']);
    expect(res.via).toBe('push');
  });

  it('PIN 16: ⭐⭐⭐ a failed push is NOT pushed again — exactly one, never a loop', async () => {
    const { send, seen } = recorder([failRes(), failRes(429, 'quota gone')]);
    await expect(
      replyThenPush(send, 'TOK', 'RT', 'U1', MSGS),
    ).rejects.toThrow();
    expect(seen.map((s) => s.kind)).toEqual(['reply', 'push']);
  });

  it('PIN 9: ⭐⭐⭐ replyViaCore itself is UNCHANGED — 14 call sites depend on it', async () => {
    const { send, seen } = recorder([failRes()]);
    await expect(replyViaCore(send, 'TOK', 'RT', MSGS)).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe('reply');
  });

  it('PIN 10: textReply without a userId behaves exactly as today', async () => {
    const { send, seen } = recorder([failRes()]);
    await expect(textReply(send, 'TOK', 'RT', 'สวัสดี')).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.kind).toBe('reply');
  });

  it('TARGET 9: textReply WITH a userId falls back to push', async () => {
    const { send, seen } = recorder([failRes(), okRes]);
    const res = await textReply(send, 'TOK', 'RT', 'สวัสดี', null, 'U1');
    expect(seen.map((s) => s.kind)).toEqual(['reply', 'push']);
    expect(res.via).toBe('push');
  });
});

/**
 * [FIX-20260901-AIRETRYLOG] The FIRST attempt has to leave a trace.
 *
 * It used to be swallowed whole: `thinkErr` was neither rethrown nor logged,
 * and the row that reaches `webhook_logs` is built from what `send` RETURNS —
 * the SECOND attempt's error. An operator read "timeout of 20000ms exceeded"
 * and had no way to tell one failure from two.
 *
 * Measured on production over 24h before this change: 7 timeout rows, every one
 * of them the 20s retry, none the 30s first try. The first attempt had never
 * been recorded anywhere.
 */
describe('[FIX-20260901-AIRETRYLOG] the first timeout is named in the log', () => {
  it('carries the budget that expired, so the reader knows WHICH attempt died', async () => {
    armTimeout();
    armOk();

    await new GeminiReplyTransport().send(callFor());

    /* "30000ms" is the first attempt's budget. Without it the line could be
       describing the retry, which is exactly the ambiguity being closed. */
    expect(warnedText()).toContain('30000ms');
  });

  it('reports how long that attempt actually burned', async () => {
    armTimeout();
    armOk();

    await new GeminiReplyTransport().send(callFor());

    expect(warnedText()).toMatch(/timed out after \d+ms/);
  });

  /* The case that produced the production rows: both attempts die. The log must
     still name the first, and the RETURNED error must still be the second — the
     contract the interpreter reads is not allowed to move. */
  it('logs the first even when both time out, and does not change what is returned', async () => {
    /* The shared `armTimeout` always says 30000ms, which is right for attempt
       one. Attempt two runs on the shorter budget, so its message differs — and
       distinguishing them is the whole point of this case. */
    armTimeout();
    armOnce(() =>
      Promise.reject(
        Object.assign(new Error('timeout of 20000ms exceeded'), {
          code: 'ECONNABORTED',
        }),
      ),
    );

    const out = await new GeminiReplyTransport().send(callFor());

    expect(warnedText()).toContain('30000ms');
    expect(String(out.errorMessage)).toContain('20000ms');
  });

  it('a first-attempt success warns nothing — the quiet path stays quiet', async () => {
    armOk();

    await new GeminiReplyTransport().send(callFor());

    expect(warnedText()).not.toMatch(/timed out after/);
  });
});
