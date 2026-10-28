/**
 * [WRAP-AI W2-0] BEFORE pack for the ASSIST-SUMMARY path — the summary analogue of
 * the W0 reply pack.
 *
 * It drives the REAL `RealAssistSummaryProvider.summarise` (which today calls
 * `RagEngineService.analyzeConversationForAdmin` inline) over a scenario matrix,
 * spies `axios.post`, and freezes:
 *   · B-W2S1 the request WIRE BODY per scenario (url key-masked + JSON body) — the
 *     part the parity spec never captured; it only asserts URL + return value.
 *   · B-W2S2 the RESPONSE fixtures (clean json / fenced / no-braces / malformed /
 *     missing-fields / empty / http-error) → the `{summary, category}` the live
 *     path produced.
 *
 * After the W2c switch the provider will drive the wrapped funnel instead; these
 * SAME frozen snapshots must still match to the byte, proving the funnel is
 * request/response-equal to analyzeConversationForAdmin — the same trick W0 plays
 * for the reply path.
 *
 * ⚠️ NO NETWORK, NO KEY, NO REAL AI — axios.post is spied and REFUSES by default
 *    (a scenario arms its own canned response), plus the `no-ai-outbound` global
 *    guard. Nothing is ever sent. ห้ามยิง AI จริง — ทุก post ถูก spy.
 */
import axios from 'axios';
import { Logger } from '@nestjs/common';

import { RealAssistSummaryProvider } from '@/modules/webhook/ai-vendors/gemini/assist-summary.provider';
import type { AssistSummaryRequest } from '@/modules/webhook/ai-vendors/gemini/assist-summary.provider';

// ── HTTP capture — refuses by default; a scenario arms one canned response ──────
type HttpArgs = unknown[];
const posts: Array<{ url: string; body: unknown }> = [];

const httpPost = jest.fn(
  (...args: HttpArgs): Promise<{ status: number; data: unknown }> => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
    });
    return Promise.reject(
      new Error(
        `[W2-0] axios.post reached with no canned response armed -> ${String(args[0])}`,
      ),
    );
  },
);

jest
  .spyOn(axios, 'post')
  .mockImplementation((...a: HttpArgs) => httpPost(...a));
jest
  .spyOn(axios, 'get')
  .mockImplementation(() =>
    Promise.reject(
      new Error('[W2-0] axios.get is not used by the summary path'),
    ),
  );
globalThis.fetch = () => Promise.reject(new Error('[W2-0] fetch is blocked'));

/** Arm one canned Gemini HTTP response (status 200) for the next post. */
let armed: unknown = null;
function armResponse(data: unknown) {
  armed = data;
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
    });
    return Promise.resolve({ status: 200, data: armed });
  });
}
/** Arm an HTTP error for the next post (the outer-catch path). */
function armError(status: number, data: unknown) {
  httpPost.mockImplementationOnce((...args: HttpArgs) => {
    posts.push({
      url: String(args[0]),
      body: JSON.parse(JSON.stringify(args[1])),
    });
    return Promise.reject({ response: { status, data } });
  });
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

// ── the provider under test (drives the funnel; axios is spied) ────────────────
function buildProvider(): RealAssistSummaryProvider {
  // [FEAT-20260813-WRAPAI-W2] The provider no longer takes RagEngineService — it
  // drives the summary funnel (transport + interpreter). The transport is the
  // only thing that reaches ai/ (for MODEL_ID/GEMINI_HTTP_OPTS, at import), and
  // axios is spied, so no service instance is needed to exercise the wire path.
  return new RealAssistSummaryProvider();
}

// deterministic env so URL/model resolution is fixed across machines
const ENV_KEYS = ['MODEL_ID', 'GEMINI_API_KEY', 'GEMINI_TEST_KEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env['MODEL_ID'] = 'gemini-3.5-flash';
  delete process.env['GEMINI_API_KEY'];
  delete process.env['GEMINI_TEST_KEY'];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k]!;
  }
});

beforeEach(() => {
  posts.length = 0;
  armed = null;
  httpPost.mockClear();
});

/**
 * Mask the key so snapshots never carry a secret.
 *
 * [FEAT-20260908-GEMINIKEYHEADER] The key is no longer in the URL — it rides the
 * `x-goog-api-key` header. The query-string branch is KEPT so this recorder still
 * masks correctly if it is ever pointed at an older build or the legacy file;
 * a masker that silently stopped matching would put a live key in a snapshot.
 */
function maskUrl(url: string): string {
  return url.replace(/([?&]key=)[^&]*/i, '$1***');
}

/** A minimal request; each scenario overrides just what it exercises. */
function baseRequest(
  over: Partial<AssistSummaryRequest> = {},
): AssistSummaryRequest {
  return {
    history: 'ลูกค้า: สวัสดี\nบอท: สวัสดีครับ',
    currentQuestion: 'ยอดค้างเท่าไหร่',
    currentAnswer: 'ยอดค้างของคุณคือ 1000 บาท',
    geminiApiKey: 'unit-test-key-not-real',
    ...over,
  };
}

/** A normal summary success payload — one candidate, JSON in the text. */
const OK_JSON =
  '{"summary":"ลูกค้าต้องการทราบยอดค้าง","category":"Collection"}';
function geminiPayload(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

/** Capture one scenario's masked wire record (arms an OK response first). */
async function capture(
  over: Partial<AssistSummaryRequest>,
): Promise<{ url: string; body: string }> {
  armResponse(geminiPayload(OK_JSON));
  await buildProvider().summarise(baseRequest(over));
  expect(posts).toHaveLength(1);
  return { url: maskUrl(posts[0]!.url), body: JSON.stringify(posts[0]!.body) };
}

// ═══════════════════════════════════════════════════════════════════════════
// recorder self-check — the instrument must be able to go red
// ═══════════════════════════════════════════════════════════════════════════
describe('[WRAP-AI W2-0] recorder self-check', () => {
  it('the summary request is captured (recorder is not blind)', async () => {
    const rec = await capture({});
    expect(rec.body.length).toBeGreaterThan(0);
    /* [FEAT-20260907-AIVENDORCORE] was `/v1/models/` with the note "v1, NOT
       v1beta". That was never a requirement — it was inherited: this transport
       was transcribed from `findRelevantText`, which used `/v1`, while the reply
       lane was transcribed from `askGemini`, which used `/v1beta`. Both bases
       were fired against the live API on the same model with the same key on
       07/09/2026 and answered identically — 200/200 plain, 400/400 for a raw
       `thinkingBudget: 0`, 200/200 for `thinkingLevel: minimal`. One base now.
       🔴 THE BODY DID NOT MOVE. The frozen snapshots below changed by exactly one
          line — this URL — and nothing else, which is the whole claim of that
          extraction stated as a diff.
       ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
    expect(rec.url).toContain('/v1beta/models/');
  });

  it('the key never appears in the recorded url', async () => {
    const rec = await capture({ geminiApiKey: 'SUPER-SECRET-SUM-KEY' });
    expect(rec.url).not.toContain('SUPER-SECRET-SUM-KEY');
    /* [FEAT-20260908-GEMINIKEYHEADER] the recorded URL now carries NO key at all,
       masked or otherwise — it moved to the x-goog-api-key header. This used to
       assert `key=***`, i.e. that the masker had fired. The stronger property is
       that the URL has no query string to mask. */
    expect(rec.url).not.toContain('key=');
    expect(rec.url).not.toContain('?');
  });

  it('tampering the recorded body is visible', async () => {
    const rec = await capture({ currentQuestion: 'AAA' });
    expect(rec.body.replace('AAA', 'BBB')).not.toBe(rec.body);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B-W2S1 — the frozen WIRE snapshots
// ═══════════════════════════════════════════════════════════════════════════
describe('[WRAP-AI W2-0] summary wire snapshots (frozen — B-W2S1)', () => {
  it('a normal hand-off', async () => {
    expect(await capture({})).toMatchSnapshot();
  });

  it('no history → the ไม่มีประวัติ default in the prompt', async () => {
    expect(await capture({ history: '' })).toMatchSnapshot();
  });

  it('null history → same ไม่มีประวัติ default', async () => {
    expect(await capture({ history: null as never })).toMatchSnapshot();
  });

  it('quotes/newlines in the strings are interpolated verbatim', async () => {
    expect(
      await capture({
        currentQuestion: 'มี "เครื่องหมาย" และ\nขึ้นบรรทัด',
        currentAnswer: 'ตอบ: "ได้ครับ"',
      }),
    ).toMatchSnapshot();
  });

  it('the generationConfig is hardcoded 0.1/0.1/1 (no thinkingConfig)', async () => {
    const rec = await capture({});
    expect(rec.body).toContain('"temperature":0.1');
    expect(rec.body).toContain('"topP":0.1');
    expect(rec.body).toContain('"topK":1');
    expect(rec.body).not.toContain('thinkingConfig');
    expect(rec.body).not.toContain('system_instruction');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B-W2S2 — response fixtures: the {summary, category} the LIVE path produces
// ═══════════════════════════════════════════════════════════════════════════
describe('[WRAP-AI W2-0] summary response fixtures (frozen — B-W2S2)', () => {
  const RESPONSES: Record<string, string> = {
    'clean json': '{"summary":"ปิดบัญชี","category":"Collection"}',
    'fenced json': '```json\n{"summary":"ไอที","category":"IT"}\n```',
    'no braces': 'สรุปแบบไม่มี json เลย',
    'malformed json': '{"summary":"x", broken',
    'missing summary field': '{"category":"IT"}',
    'missing category field': '{"summary":"only summary"}',
    empty: '',
  };

  it.each(Object.keys(RESPONSES))(
    'response %s → recorded {summary, category}',
    async (name) => {
      armResponse(geminiPayload(RESPONSES[name]!));
      const out = await buildProvider().summarise(baseRequest());
      expect(out).toMatchSnapshot();
    },
  );

  it('an http error → the DISTINCT outage string (outer catch)', async () => {
    armError(500, { error: { message: 'boom' } });
    const out = await buildProvider().summarise(baseRequest());
    expect(out).toEqual({
      summary: 'เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา',
      category: 'Other',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// diagnostic-log side-effects (divergences D1/D2 — were dropped by the switch)
// ═══════════════════════════════════════════════════════════════════════════
describe('[WRAP-AI W2-0] the two legacy logger.error lines still fire', () => {
  // ⚠️ analyzeConversationForAdmin logs on a malformed reply (:1855) and on a
  //    request failure (:1866). The first W2 cut dropped both. These drive the
  //    REAL provider path and assert the log fires, matching legacy — the log is
  //    the behaviour under test, so it is asserted (not snapshotted).
  let errSpy: jest.SpyInstance;
  beforeEach(() => {
    errSpy = jest.spyOn(Logger.prototype, 'error');
    errSpy.mockClear();
  });

  it('D1: a malformed-JSON reply logs "AI Analysis JSON parse error"', async () => {
    // braces present (both { and }) but invalid JSON inside → JSON.parse throws,
    // so the interpreter's parse catch fires (a missing } would skip the block).
    armResponse(geminiPayload('{"summary":"x", broken }'));
    const out = await buildProvider().summarise(baseRequest());
    // return value: parse threw → fallback is `rawText || string`; rawText is
    // non-empty here, so legacy returns the raw text passthrough (category Other).
    expect(out.summary).toBe('{"summary":"x", broken }');
    expect(out.category).toBe('Other');
    // …and the diagnostic line fired, with the raw text included
    const logged = errSpy.mock.calls.map((c) => String(c[0]));
    expect(logged.some((m) => m.includes('AI Analysis JSON parse error'))).toBe(
      true,
    );
  });

  it('D2: a request failure logs "AI Analysis error"', async () => {
    armError(500, { error: { message: 'boom' } });
    await buildProvider().summarise(baseRequest());
    const logged = errSpy.mock.calls.map((c) => String(c[0]));
    expect(logged.some((m) => m.includes('AI Analysis error'))).toBe(true);
  });
});
