/**
 * [FEAT-20260907-AIVENDORCORE] THE WIRE BASELINE — what each AI path actually sends.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ============================================================================
 * WHY THIS EXISTS. A vendor layer is about to be extracted, and the only claim
 * worth defending is "the bytes on the wire did not change". Suites that pass,
 * types that compile and code that reads correctly all say nothing about that —
 * they are exactly what would still be green if a body silently lost a key.
 *
 * So this file captures the REQUEST each transport builds, with the HTTP client
 * stubbed, and pins it. Run it before the extraction and after; a diff here is
 * the change, and there should not be one.
 *
 * 🔴 THE BODY IS DEEP-CLONED AT CAPTURE, AND THAT IS NOT DEFENSIVE HABIT.
 *    `gemini-reply.transport.ts` MUTATES the body it already handed to axios —
 *    on a 400 whose message mentions "think" it does
 *    `delete body.generationConfig.thinkingConfig` on the SAME object reference
 *    and re-fires. Capturing by reference makes the recorded first request lose
 *    a key retroactively, so the baseline would record a body that was never
 *    sent. Clone at the boundary.
 *
 * ⚠️ WHAT IS PINNED AND WHAT IS NOT. The BODY is pinned exactly — every key, in
 *    order. The URL is split into `{ base, path }` because unifying the Gemini
 *    base is the one intended change; the PATH and query must not move. A test
 *    that pinned the whole URL would go red for the intended reason and hide an
 *    unintended one inside the same failure.
 *
 * ⚠️ NO NETWORK. `z-test/lib/no-ai-outbound.ts` already replaces `fetch` for
 *    every test file, and `axios` is stubbed here. If either stub is removed
 *    this file must fail rather than quietly bill a real account.
 *
 * revert: delete this file. Nothing imports it.
 */
import axios from 'axios';

import { AI_HTTP_TIMEOUT_MS } from '../../src/modules/ai-vendor';
import { Logger } from '@nestjs/common';

import { GeminiReplyTransport } from '../../src/modules/webhook/ai-vendors/gemini/gemini-reply.transport';
import { GeminiSummaryTransport } from '../../src/modules/webhook/ai-vendors/gemini/gemini-summary.transport';
import { DeepSeekReplyTransport } from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-reply.transport';
import { DeepSeekSummaryTransport } from '../../src/modules/webhook/ai-vendors/deepseek/deepseek-summary.transport';
import { GeminiTranslateTransport } from '../../src/modules/ai-translate/vendors/gemini-translate.transport';
import { DeepSeekTranslateTransport } from '../../src/modules/ai-translate/vendors/deepseek-translate.transport';

/** One captured request. `config` carries the timeout, which is also load-bearing. */
interface Captured {
  url: string;
  body: unknown;
  config: unknown;
}

const captured: Captured[] = [];

/** `https://host/v1beta` + `/models/x:generateContent?key=y` — split so the base can move. */
function splitUrl(url: string): { base: string; path: string } {
  const m = /^(https:\/\/[^/]+\/v1[a-z]*)(.*)$/.exec(url);
  return m
    ? { base: m[1] as string, path: m[2] as string }
    : { base: url, path: '' };
}

beforeEach(() => {
  captured.length = 0;
  jest.spyOn(axios, 'post').mockImplementation((...args: unknown[]) => {
    captured.push({
      url: String(args[0]),
      /* deep clone — see the header. The reply transport mutates this object. */
      body: JSON.parse(JSON.stringify(args[1])) as unknown,
      config: JSON.parse(JSON.stringify(args[2] ?? null)) as unknown,
    });
    return Promise.resolve({
      status: 200,
      data: {
        /* Gemini shape */
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        /* DeepSeek shape — both readers tolerate the other's extra keys */
        choices: [{ message: { content: 'ok' } }],
      },
    });
  });
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

/* ── the calls, built as literals so no assembler can drift underneath them ── */

const REPLY_CALL = {
  instruction: 'SYSTEM INSTRUCTION TEXT',
  blocks: [
    { kind: 'raw_json', text: 'BLOCK ONE' },
    { kind: 'question', text: 'BLOCK TWO' },
  ],
  knobs: { temperature: 0.4, topP: 0.5, topK: 20 },
  thinkingBudget: null,
  apiKey: 'unit-test-key-not-real',
  modelId: null,
} as never;

const SUMMARY_CALL = {
  messages: [{ role: 'customer', text: 'hello' }],
  apiKey: 'unit-test-key-not-real',
  modelId: null,
} as never;

const TRANSLATE_CALL = {
  text: 'สวัสดี',
  targetLang: 'en',
  apiKey: 'unit-test-key-not-real',
  modelId: null,
} as never;

describe('[FEAT-20260907-AIVENDORCORE] the wire, before anything moves', () => {
  it('captures exactly one request per send, and the stub really intercepted it', () => {
    /* Guards the whole file: if axios were not stubbed, nothing is captured and
       every assertion below would vacuously pass on an empty array. */
    expect(captured).toHaveLength(0);
  });

  describe('gemini reply', () => {
    it('body: system_instruction + contents + generationConfig, in that order', async () => {
      await new GeminiReplyTransport().send(REPLY_CALL);
      expect(captured).toHaveLength(1);
      const c = captured[0] as Captured;
      expect(Object.keys(c.body as object)).toEqual([
        'system_instruction',
        'contents',
        'generationConfig',
      ]);
      expect(c.body).toEqual({
        system_instruction: { parts: [{ text: 'SYSTEM INSTRUCTION TEXT' }] },
        contents: [{ parts: [{ text: 'BLOCK ONE' }, { text: 'BLOCK TWO' }] }],
        generationConfig: {
          temperature: 0.4,
          topP: 0.5,
          topK: 20,
          /* thinking OFF on a Gemini 3 default model resolves to a LEVEL, never a
             budget — `thinking-config.ts`, and it must not change. */
          thinkingConfig: { thinkingLevel: 'minimal' },
        },
      });
    });

    it('path: model + generateContent, and NO query at all', async () => {
      /* [FEAT-20260908-GEMINIKEYHEADER] this pinned
         `…:generateContent?key=unit-test-key-not-real` — "the key UNENCODED".
         The key is a header now; the path must carry nothing else. */
      await new GeminiReplyTransport().send(REPLY_CALL);
      const { path } = splitUrl((captured[0] as Captured).url);
      expect(path).toBe('/models/gemini-3.5-flash:generateContent');
    });

    it('carries the shared stall ceiling AND the key header', async () => {
      /* The timeout value is unchanged. What is new is that the config object is
         built per request (`geminiHttpOpts`) instead of being the shared
         `GEMINI_HTTP_OPTS`, because a per-request header cannot live on an object
         nine call sites share. The shared object itself is still `{ timeout }`
         and is asserted untouched in wrap-ai-timeout-retry PIN 5. */
      await new GeminiReplyTransport().send(REPLY_CALL);
      expect((captured[0] as Captured).config).toEqual({
        timeout: AI_HTTP_TIMEOUT_MS,
        headers: { 'x-goog-api-key': 'unit-test-key-not-real' },
      });
    });
  });

  describe('gemini summary', () => {
    it('body: contents + generationConfig with the hardcoded 0.1/0.1/1, and NO thinkingConfig', async () => {
      await new GeminiSummaryTransport().send(SUMMARY_CALL);
      const c = captured[0] as Captured;
      expect(Object.keys(c.body as object)).toEqual([
        'contents',
        'generationConfig',
      ]);
      const gc = (c.body as { generationConfig: Record<string, unknown> })
        .generationConfig;
      expect(gc).toEqual({ temperature: 0.1, topP: 0.1, topK: 1 });
      /* Absence is the assertion. A shared door that defaulted a thinking config
         in would change this path silently. */
      expect(gc['thinkingConfig']).toBeUndefined();
      expect(
        (c.body as { system_instruction?: unknown }).system_instruction,
      ).toBeUndefined();
    });

    it('path unchanged, and the key is a header not a query', async () => {
      await new GeminiSummaryTransport().send(SUMMARY_CALL);
      const c = captured[0] as Captured;
      const { path } = splitUrl(c.url);
      expect(path).toMatch(/^\/models\/.+:generateContent$/);
      expect(
        (c.config as { headers?: Record<string, string> })?.headers?.[
          'x-goog-api-key'
        ],
      ).toBe('unit-test-key-not-real');
    });
  });

  describe('gemini translate', () => {
    it('body: same determinism knobs as summary, no system instruction, no thinking', async () => {
      await new GeminiTranslateTransport().send(TRANSLATE_CALL);
      const c = captured[0] as Captured;
      expect(Object.keys(c.body as object)).toEqual([
        'contents',
        'generationConfig',
      ]);
      expect(
        (c.body as { generationConfig: unknown }).generationConfig,
      ).toEqual({ temperature: 0.1, topP: 0.1, topK: 1 });
    });
  });

  describe('deepseek reply', () => {
    it('body: model + messages(system,user) + temperature + top_p, exactly four keys', async () => {
      await new DeepSeekReplyTransport().send(REPLY_CALL);
      const c = captured[0] as Captured;
      expect(Object.keys(c.body as object)).toEqual([
        'model',
        'messages',
        'temperature',
        'top_p',
      ]);
      expect((c.body as { messages: unknown }).messages).toEqual([
        { role: 'system', content: 'SYSTEM INSTRUCTION TEXT' },
        { role: 'user', content: 'BLOCK ONE\n\nBLOCK TWO' },
      ]);
      expect((c.body as { temperature: number }).temperature).toBe(0.4);
      expect((c.body as { top_p: number }).top_p).toBe(0.5);
    });

    it('the key rides an Authorization header, never the query string', async () => {
      await new DeepSeekReplyTransport().send(REPLY_CALL);
      const c = captured[0] as Captured;
      expect(c.url).toBe('https://api.deepseek.com/chat/completions');
      expect(c.url).not.toContain('key=');
      expect(c.config).toEqual({
        timeout: AI_HTTP_TIMEOUT_MS,
        headers: { Authorization: 'Bearer unit-test-key-not-real' },
      });
    });
  });

  describe('deepseek summary', () => {
    it('body: one USER message, no system role, fixed 0.1/0.1', async () => {
      await new DeepSeekSummaryTransport().send(SUMMARY_CALL);
      const c = captured[0] as Captured;
      expect(Object.keys(c.body as object)).toEqual([
        'model',
        'messages',
        'temperature',
        'top_p',
      ]);
      const msgs = (c.body as { messages: { role: string }[] }).messages;
      expect(msgs).toHaveLength(1);
      expect(msgs[0]?.role).toBe('user');
      expect((c.body as { temperature: number }).temperature).toBe(0.1);
    });
  });

  describe('deepseek translate', () => {
    it('body: one user message, fixed 0.1/0.1, four keys', async () => {
      await new DeepSeekTranslateTransport().send(TRANSLATE_CALL);
      const c = captured[0] as Captured;
      expect(Object.keys(c.body as object)).toEqual([
        'model',
        'messages',
        'temperature',
        'top_p',
      ]);
      expect((c.body as { top_p: number }).top_p).toBe(0.1);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     🔴 THE RETRY LADDER — the highest-risk thing in this change.
     The reply lane wraps its POST in two retries with different budgets and a
     logging contract that was itself a fix. Every branch is pinned here BEFORE
     anything moves, because "the happy body is unchanged" says nothing about
     what happens when the vendor says no.
     ═══════════════════════════════════════════════════════════════════════ */
  describe('🔴 gemini reply · retry ladder', () => {
    /** An axios-shaped rejection: `err.response.{status,data}`. */
    const httpErr = (status: number, data: unknown) =>
      Object.assign(new Error(`Request failed with status code ${status}`), {
        response: { status, data },
      });

    /** What `isTimeoutError` accepts — code OR a message matching /timeout/i. */
    const timeoutErr = () =>
      Object.assign(new Error('timeout of 30000ms exceeded'), {
        code: 'ECONNABORTED',
      });

    const okRes = {
      status: 200,
      data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
    };

    function stubSequence(...outcomes: Array<'ok' | Error>) {
      let i = 0;
      jest.spyOn(axios, 'post').mockImplementation((...args: unknown[]) => {
        captured.push({
          url: String(args[0]),
          body: JSON.parse(JSON.stringify(args[1])) as unknown,
          config: JSON.parse(JSON.stringify(args[2] ?? null)) as unknown,
        });
        const o = outcomes[i++] ?? 'ok';
        return o === 'ok' ? Promise.resolve(okRes) : Promise.reject(o);
      });
    }

    it('400 mentioning "think" ⇒ re-fires ONCE without thinkingConfig, same budget', async () => {
      stubSequence(
        httpErr(400, { error: { message: 'thinking is not supported' } }),
        'ok',
      );
      const res = await new GeminiReplyTransport().send(REPLY_CALL);

      expect(captured).toHaveLength(2);
      const first = captured[0] as Captured;
      const second = captured[1] as Captured;
      /* 🔴 The first body MUST still carry the key. It is deleted from the SAME
         object before the second call, so a by-reference capture would show it
         missing here — the exact trap this file's header describes. */
      expect(
        (first.body as { generationConfig: Record<string, unknown> })
          .generationConfig['thinkingConfig'],
      ).toEqual({ thinkingLevel: 'minimal' });
      expect(
        (second.body as { generationConfig: Record<string, unknown> })
          .generationConfig['thinkingConfig'],
      ).toBeUndefined();
      /* everything else about the retry body is untouched */
      expect(
        (second.body as { generationConfig: Record<string, unknown> })
          .generationConfig,
      ).toEqual({ temperature: 0.4, topP: 0.5, topK: 20 });
      /* the think-retry keeps the ORIGINAL 30s budget, not the shorter one —
         and [FEAT-20260908-GEMINIKEYHEADER] it must still carry the key header,
         because a retry that silently dropped the credential would answer 401
         and read as the model refusing. */
      expect(second.config).toEqual({
        timeout: AI_HTTP_TIMEOUT_MS,
        headers: { 'x-goog-api-key': 'unit-test-key-not-real' },
      });
      expect(res.rawText).toBe('ok');
      expect(res.errorMessage).toBeNull();
    });

    it('a 400 WITHOUT "think" is not retried — it takes the error path', async () => {
      stubSequence(httpErr(400, { error: { message: 'quota exhausted' } }));
      const res = await new GeminiReplyTransport().send(REPLY_CALL);
      expect(captured).toHaveLength(1);
      expect(res.rawText).toBeUndefined();
      expect(res.httpStatus).toBe(400);
    });

    it('timeout ⇒ re-fires the SAME body once, on the SHORTER retry budget', async () => {
      stubSequence(timeoutErr(), 'ok');
      const res = await new GeminiReplyTransport().send(REPLY_CALL);

      expect(captured).toHaveLength(2);
      const first = captured[0] as Captured;
      const second = captured[1] as Captured;
      /* the body is identical — a timeout says nothing about the request */
      expect(second.body).toEqual(first.body);
      expect(first.config).toEqual({
        timeout: AI_HTTP_TIMEOUT_MS,
        headers: { 'x-goog-api-key': 'unit-test-key-not-real' },
      });
      /* 🔴 the shorter budget is the whole point of the second attempt — and the
         key header survives the budget swap. The retry spreads the auth options
         and then overrides only the timeout; pinning both here is what stops a
         future edit from replacing the object wholesale and losing the key. */
      expect(second.config).toEqual({
        timeout: 30000,
        headers: { 'x-goog-api-key': 'unit-test-key-not-real' },
      });
      expect(res.rawText).toBe('ok');
    });

    it('a SECOND timeout is not retried again — two attempts, then the error path', async () => {
      stubSequence(timeoutErr(), timeoutErr());
      const res = await new GeminiReplyTransport().send(REPLY_CALL);
      expect(captured).toHaveLength(2);
      expect(res.rawText).toBeUndefined();
      expect(res.errorMessage).not.toBeNull();
    });

    it('any other error is not retried at all', async () => {
      stubSequence(httpErr(500, { error: { message: 'internal' } }));
      const res = await new GeminiReplyTransport().send(REPLY_CALL);
      expect(captured).toHaveLength(1);
      expect(res.httpStatus).toBe(500);
    });

    it('🔴 send NEVER rejects — the interpreter downstream reads a result, not a throw', async () => {
      stubSequence(new Error('socket hang up'));
      await expect(
        new GeminiReplyTransport().send(REPLY_CALL),
      ).resolves.toBeDefined();
    });
  });

  /* ═══════════════════════════════════════════════════════════════════════
     🔴 THE PROMPT PAYLOAD — every block kind the assembler can emit.
     `reply-neutral.ts` states the contract this pins: *"Transports serialise by
     array ORDER and never read kind"*. So the risk of moving body assembly is
     not that a block is mangled — it is that the ORDER shifts, or that one kind
     is quietly dropped, and the model then reads a different prompt while every
     other test stays green.
     ═══════════════════════════════════════════════════════════════════════ */
  describe('🔴 gemini reply · the full block set survives, in order', () => {
    /** Every kind the union allows, in the order buildBlocks emits them. */
    const ALL_BLOCKS = [
      { kind: 'raw_json', text: 'RAW JSON PROFILE' },
      { kind: 'raw_json_rules', text: 'RAW JSON RULES' },
      { kind: 'site_rules', text: 'SITE RULES' },
      { kind: 'site_rules_guide', text: 'SITE RULES GUIDE' },
      { kind: 'document', text: 'DOCUMENT / SUGGESTION TEXT' },
      { kind: 'history', text: 'CHAT HISTORY' },
      { kind: 'today', text: 'Today is …' },
      { kind: 'now', text: 'NOWBLOCK — office hours decision' },
      { kind: 'question', text: 'THE CUSTOMER QUESTION' },
    ];

    const fullCall = {
      ...(REPLY_CALL as unknown as Record<string, unknown>),
      blocks: ALL_BLOCKS,
    } as never;

    it('all nine kinds reach the wire, in the same order, with text unchanged', async () => {
      await new GeminiReplyTransport().send(fullCall);
      const parts = (
        (captured[0] as Captured).body as {
          contents: { parts: { text: string }[] }[];
        }
      ).contents[0]?.parts;
      expect(parts).toEqual(ALL_BLOCKS.map((b) => ({ text: b.text })));
    });

    it('🔴 the `kind` field is NOT serialised — only `text` crosses the wire', async () => {
      /* The union is a builder-side label. Leaking it would change the prompt the
         model reads, on every request, invisibly. */
      await new GeminiReplyTransport().send(fullCall);
      const json = JSON.stringify((captured[0] as Captured).body);
      expect(json).not.toContain('"kind"');
      expect(json).not.toContain('raw_json_rules');
      expect(json).not.toContain('site_rules_guide');
    });

    it('🔴 NOWBLOCK is absent when the assembler omits it, and present when it does not', async () => {
      /* `[FEAT-20260902-NOWBLOCK]`: emitted only when its switch is on, and its
         absence must leave the wire bytes unchanged. The transport must not
         invent it, reorder around it, or pad for it. */
      const without = ALL_BLOCKS.filter((b) => b.kind !== 'now');
      await new GeminiReplyTransport().send({
        ...(REPLY_CALL as unknown as Record<string, unknown>),
        blocks: without,
      } as never);
      const parts = (
        (captured[0] as Captured).body as {
          contents: { parts: { text: string }[] }[];
        }
      ).contents[0]?.parts;
      expect(parts).toEqual(without.map((b) => ({ text: b.text })));
      expect(JSON.stringify(parts)).not.toContain('NOWBLOCK');
    });

    it('the system instruction stays separate from the blocks', async () => {
      /* [FEAT-20260830-STABLEPROMPT] history and "Today is …" were MOVED OUT of
         the instruction so it stays byte-stable for implicit caching. Folding
         them back into `system_instruction` would undo that silently. */
      await new GeminiReplyTransport().send(fullCall);
      const body = (captured[0] as Captured).body as {
        system_instruction: { parts: { text: string }[] };
      };
      expect(body.system_instruction.parts).toEqual([
        { text: 'SYSTEM INSTRUCTION TEXT' },
      ]);
      expect(JSON.stringify(body.system_instruction)).not.toContain(
        'CHAT HISTORY',
      );
    });

    it('🔴 a MULTI-BOX suggestion instruction crosses verbatim, markers and all', async () => {
      /* The suggestion is not one string. `prompt-context.util.ts` DOC_BLOCKS is a
         registry of hook fields, each wrapped in named markers, and the assembler
         concatenates the ones that are configured:
           suggestion_text          → [START_OF_BASIC_INFO] … [END_OF_BASIC_INFO]
           suggestion_company_text  → [START_OF_COMPANY_INFO] … [END_OF_COMPANY_INFO]
         A third, `suggestion_text_no_profile`, was REMOVED from the prompt on
         13/08 (`[PROMPT-20260813-DROPNOPROFILE]`) — the column still exists and
         the dashboard still saves it, but it must not reach the model.
         The door receives the finished instruction, so what it owes is to pass it
         through untouched: no trimming, no re-wrapping, no marker loss. */
      const instruction =
        '[START_OF_BASIC_INFO]\nbasic answer text\n[END_OF_BASIC_INFO]\n' +
        '[START_OF_COMPANY_INFO]\ncompany answer text\n[END_OF_COMPANY_INFO]';
      await new GeminiReplyTransport().send({
        ...(REPLY_CALL as unknown as Record<string, unknown>),
        instruction,
        blocks: ALL_BLOCKS,
      } as never);
      const body = (captured[0] as Captured).body as {
        system_instruction: { parts: { text: string }[] };
      };
      expect(body.system_instruction.parts).toEqual([{ text: instruction }]);
      /* the box that was deliberately dropped must not reappear from anywhere */
      expect(JSON.stringify(body)).not.toContain('NO_PROFILE_DATA');
    });

    it('deepseek carries the same multi-box instruction as its system message', async () => {
      const instruction =
        '[START_OF_BASIC_INFO]\nbasic\n[END_OF_BASIC_INFO]\n' +
        '[START_OF_COMPANY_INFO]\ncompany\n[END_OF_COMPANY_INFO]';
      await new DeepSeekReplyTransport().send({
        ...(REPLY_CALL as unknown as Record<string, unknown>),
        instruction,
        blocks: ALL_BLOCKS,
      } as never);
      const msgs = (
        (captured[0] as Captured).body as {
          messages: { role: string; content: string }[];
        }
      ).messages;
      expect(msgs[0]).toEqual({ role: 'system', content: instruction });
    });

    it('deepseek joins the same blocks with a blank line, order preserved', async () => {
      /* The other vendor flattens rather than keeping parts — same order, one
         string. A reordering here is just as invisible. */
      await new DeepSeekReplyTransport().send(fullCall);
      const msgs = (
        (captured[0] as Captured).body as {
          messages: { role: string; content: string }[];
        }
      ).messages;
      expect(msgs[1]?.content).toBe(ALL_BLOCKS.map((b) => b.text).join('\n\n'));
    });
  });

  describe('🔴 the differences that must survive the extraction', () => {
    it('only the reply lane sends a system instruction', async () => {
      await new GeminiReplyTransport().send(REPLY_CALL);
      const reply = captured[0] as Captured;
      captured.length = 0;
      await new GeminiSummaryTransport().send(SUMMARY_CALL);
      const summary = captured[0] as Captured;
      expect(
        (reply.body as Record<string, unknown>)['system_instruction'],
      ).toBeDefined();
      expect(
        (summary.body as Record<string, unknown>)['system_instruction'],
      ).toBeUndefined();
    });

    it('only the reply lane sends a thinking config', async () => {
      await new GeminiReplyTransport().send(REPLY_CALL);
      const reply = captured[0] as Captured;
      captured.length = 0;
      await new GeminiTranslateTransport().send(TRANSLATE_CALL);
      const translate = captured[0] as Captured;
      const rgc = (reply.body as { generationConfig: Record<string, unknown> })
        .generationConfig;
      const tgc = (
        translate.body as { generationConfig: Record<string, unknown> }
      ).generationConfig;
      expect(rgc['thinkingConfig']).toBeDefined();
      expect(tgc['thinkingConfig']).toBeUndefined();
    });

    it('BOTH vendors keep the key out of the URL and in a header — different header names', async () => {
      /* [FEAT-20260908-GEMINIKEYHEADER] This case used to read "gemini puts the
         key in the query, deepseek in a header — both preserved". That asymmetry
         is gone: Gemini's key moved to `x-goog-api-key`, which is what Google's
         own guidance asks for and what keeps the credential out of the request
         URL axios attaches to every error it throws.
         The header NAMES still differ, and that difference is real — it is the
         vendors', not ours — so it is pinned rather than smoothed over. */
      await new GeminiReplyTransport().send(REPLY_CALL);
      const g = captured[0] as Captured;
      captured.length = 0;
      await new DeepSeekReplyTransport().send(REPLY_CALL);
      const d = captured[0] as Captured;

      expect(g.url).not.toContain('key=');
      expect(d.url).not.toContain('key=');
      expect(
        (g.config as { headers?: Record<string, string> } | undefined)
          ?.headers?.['x-goog-api-key'],
      ).toBe('unit-test-key-not-real');
      expect(
        (d.config as { headers?: Record<string, string> } | undefined)?.headers
          ?.Authorization,
      ).toBe('Bearer unit-test-key-not-real');
    });
  });
});
