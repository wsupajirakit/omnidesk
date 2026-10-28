/**
 * [FEAT-20260908-AITRANSLATE] the two translate calls — the wire, exactly.
 * ===========================================================================
 * The contract is PINNED in
 * `omnidesk-api/todo/task/08092026/WORK-SPLIT_chattrans.md` §8. Agent D is
 * building the BE half in parallel, so these cases are the FE's half of that
 * contract written down as executable text: if D's routes disagree, this suite
 * is what makes the disagreement visible instead of a 404 in a browser.
 *
 * 🔴 THE MOST IMPORTANT CASES HERE ARE ABOUT AN ABSENT KEY. Owner, 09/09:
 * *"เราไม่จำเป็นต้องเลือก src lang เพราะว่าเรารู้อยู่แล้ว และ ai ก็คิดได้อยู่แล้ว"* —
 * the admin picks the TARGET and nothing else. `from` stays optional on the wire
 * for a future non-UI caller, but nothing in this app may ever populate it.
 * They assert `Object.keys(body)` rather than `body.from === undefined`, because
 * `toEqual` ignores explicit-undefined and `JSON.stringify` drops it — both
 * would let a source selector reappear and still pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { url: string; init?: RequestInit; body: any };
const calls: Call[] = [];
/** what the next authFetch resolves to — set per test */
let nextResponse: () => Promise<any> = async () => ({
  ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: {} }),
});

vi.mock('../services/apiClient', async () => {
  /* the REAL handleApiResponse/buildApiError are used on purpose: the claim
     "a 429 arrives carrying the server's own sentence" is a claim about that
     pipe, and a stubbed one would prove nothing. Only authFetch is replaced. */
  const actual = await vi.importActual<any>('../services/apiClient');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test',
    authFetch: (url: string, init?: RequestInit) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : null });
      return nextResponse();
    },
  };
});

import {
  aiTranslateService,
  isRateLimited,
  translateErrorText,
} from '../services/chat/aiTranslateService';

const ok = (data: unknown) => async () => ({
  ok: true, status: 200, statusText: 'OK',
  text: async () => JSON.stringify({ success: true, data }),
});
const fail = (status: number, body: unknown) => async () => ({
  ok: false, status, statusText: 'Err',
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  calls.length = 0;
  nextResponse = ok({});
});

describe('[AITRANSLATE] ⭐⭐⭐ translating a message that exists', () => {
  it('⭐⭐⭐ POSTs to /api/chat/messages/:id/translate with body { to } and NOTHING else', async () => {
    nextResponse = ok({ lang: 'en', text: 'hello', from: null, to: 'en', cached: false });
    await aiTranslateService.translateMessage('a0d000000000000000000096', 'en');
    expect(calls[0]?.url).toBe('https://api.test/api/chat/messages/a0d000000000000000000096/translate');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ to: 'en' });
  });

  it('⭐⭐⭐ the body has NO `from` key at all — there is no source selector in this app', async () => {
    nextResponse = ok({ lang: 'en', text: 'hello', from: null, to: 'en', cached: false });
    await aiTranslateService.translateMessage('m1', 'en');
    expect(Object.keys(calls[0]!.body)).toEqual(['to']);
    expect(Object.keys(calls[0]!.body)).not.toContain('from');
  });

  it('⭐⭐ it never posts the on-screen text — the BE reads the message it holds', async () => {
    /* sending the rendered text would let a stale render decide what gets
       translated AND stored on a message it may no longer match */
    nextResponse = ok({ lang: 'en', text: 'hello', from: null, to: 'en', cached: false });
    await aiTranslateService.translateMessage('m1', 'en');
    expect(Object.keys(calls[0]!.body)).not.toContain('text');
  });

  it('⭐⭐ the response comes back whole, `cached` included', async () => {
    nextResponse = ok({ lang: 'th', text: 'สวัสดี', from: null, to: 'th', cached: true });
    const r = await aiTranslateService.translateMessage('m1', 'th');
    expect(r.data).toEqual({ lang: 'th', text: 'สวัสดี', from: null, to: 'th', cached: true });
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ the composer preview stores nothing', () => {
  it('⭐⭐⭐ POSTs to /api/chat/:id/translate-preview with body { text, to } only', async () => {
    nextResponse = ok({ text: 'Please wait a moment' });
    await aiTranslateService.previewTranslate('room1', 'รอสักครู่นะคะ', 'en');
    expect(calls[0]?.url).toBe('https://api.test/api/chat/room1/translate-preview');
    expect(calls[0]?.body).toEqual({ text: 'รอสักครู่นะคะ', to: 'en' });
  });

  it('⭐⭐⭐ and no `from` key here either', async () => {
    nextResponse = ok({ text: 'x' });
    await aiTranslateService.previewTranslate('room1', 'ก', 'en');
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['text', 'to']);
  });

  it('⭐⭐⭐ it is a DIFFERENT route from the storing one — never the message endpoint', async () => {
    /* routing the composer through /messages/:id/translate would store a
       translation of a message nobody has sent */
    nextResponse = ok({ text: 'x' });
    await aiTranslateService.previewTranslate('room1', 'ก', 'en');
    expect(calls[0]?.url).not.toContain('/messages/');
    expect(calls[0]?.url).toContain('/translate-preview');
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ a 429 is the server talking, and it is never retried here', () => {
  it("⭐⭐⭐ the server's own sentence survives to the caller, word for word", async () => {
    const sentence = 'แปลได้ 6 ครั้งต่อนาที ลองใหม่ในอีก 41 วินาที';
    nextResponse = fail(429, { success: false, error: sentence });
    const err = await aiTranslateService.previewTranslate('room1', 'ก', 'en').catch((e) => e);
    expect(translateErrorText(err)).toBe(sentence);
    /* §4C: "Show that message as-is; do not invent a friendlier one that hides
       how long to wait." The "41 วินาที" is the part a substitute destroys. */
    expect(translateErrorText(err)).toContain('41');
  });

  it('⭐⭐⭐ M20 — ONE press produces EXACTLY ONE request, even when it is refused', async () => {
    /* An auto-retry spends a seventh call inside a window that already refused
       six, and it is refused too — cost with no chance of success. */
    nextResponse = fail(429, { success: false, error: 'too many' });
    await aiTranslateService.previewTranslate('room1', 'ก', 'en').catch(() => {});
    expect(calls.length).toBe(1);
  });

  it('⭐⭐⭐ the service module contains no retry machinery at all', async () => {
    /* 🔴 [FIX-20260909-TRANSLATETIMEOUT] `setTimeout` LEFT THIS LIST, and the
       distinction is worth the paragraph: a DEADLINE is not a RETRY.
       The ban exists because a service that quietly re-sends turns one press
       into several billed calls and makes a 429 worse by answering it with more
       traffic. An `AbortController` armed by `setTimeout` does the opposite —
       it gives up. It sends nothing, it costs nothing, and it is what turns a
       hung translate into a sentence the admin can act on.
       Everything that actually re-sends is still forbidden, and one more is
       added: nothing here may call itself. The retry the owner asked for is a
       BUTTON, in the modal, pressed by a person. */
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '..', 'services/chat/aiTranslateService.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['setInterval', 'retry', 'attempt', 'while (']) {
      expect(code).not.toContain(banned);
    }
    /* the deadline is allowed — and pinned, so it cannot drift into a loop */
    expect(code).toContain('AbortController');
    expect(code).toContain('TRANSLATE_TIMEOUT_MS');
    expect(code.match(/setTimeout/g)?.length).toBe(1);
  });

  it('⭐⭐⭐ isRateLimited keys on the STATUS, never on the wording', () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
    expect(isRateLimited({ status: 502 })).toBe(false);
    /* the BE is required to be free to reword its sentence; the FE must not
       have an opinion about the text it is required to print verbatim */
    expect(isRateLimited({ message: 'Too Many Requests' })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });

  it('⭐⭐ a 502 (the OA has no usable key) is NOT treated as a rate limit', async () => {
    nextResponse = fail(502, { success: false, error: 'no usable key for this OA' });
    const err = await aiTranslateService.translateMessage('m1', 'en').catch((e) => e);
    expect(isRateLimited(err)).toBe(false);
    expect(translateErrorText(err)).toBe('no usable key for this OA');
  });

  it('⭐⭐ a blank/broken envelope still yields something readable', () => {
    /* §0c decision 7: the three cap defects are NOT fixed this round, so a cap
       hit can still reach the browser as an empty message. The chip must fail
       gracefully on it rather than render "undefined". */
    expect(translateErrorText({ message: '' })).toBe('แปลข้อความไม่สำเร็จ');
    expect(translateErrorText(null)).toBe('แปลข้อความไม่สำเร็จ');
  });
});
