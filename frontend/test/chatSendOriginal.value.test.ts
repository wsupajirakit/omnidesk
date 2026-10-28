/**
 * [FEAT-20260908-AITRANSLATE] `sendReply` carries the untranslated original.
 * ===========================================================================
 * 🔴 THIS SUITE EXISTS BECAUSE THIS REPO ALREADY SHIPPED THIS BUG ONCE.
 *
 * dev-local §14, the notice-checkbox bug of 23/08: the BE DTO accepted the new
 * fields, the TypeScript signature carried them, the feature was "done" — and
 * `pickNotice()` filtered them out of the request body. The send succeeded, the
 * user saw no error, and the data was lost. **Every test stayed green**, because
 * every test asserted the signature and nobody asserted the body.
 *
 * ⇒ So these read the BODY THAT WENT ON THE WIRE and nothing else. The mock
 * captures `init.body`, parses it, and compares the whole object with `toEqual`
 * — not `toMatchObject` — so a field that is missing fails and a field that was
 * never meant to be there fails too.
 *
 * The mutation that must kill this (M18): delete
 * `...(original?.original_text ? { original_text: original.original_text } : {})`
 * from the body builder in `services/chat/chatService.ts`. The signature still
 * compiles, `tsc` is still 0, and only these cases go red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ url: string; body: any }> = [];
vi.mock('../services/apiClient', () => ({
  API_BASE_URL: 'https://api.test',
  authFetch: (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ success: true, data: { _id: 'm1' } }),
    } as unknown as Response);
  },
  handleApiResponse: (r: Response) => (r as any).json(),
}));

import { chatService } from '../services/chat/chatService';

describe('[AITRANSLATE] ⭐⭐⭐ the original rides in the REQUEST BODY, not just in the type', () => {
  beforeEach(() => { calls.length = 0; });

  it('⭐⭐⭐ M18 — original_text AND original_lang are both in the posted body', async () => {
    await chatService.sendReply('room1', 'Please wait a moment', 'hook1', null, {
      original_text: 'รอสักครู่นะคะ',
      original_lang: 'th',
    });
    /* toEqual, not toMatchObject: this must fail on an ABSENT field. */
    expect(calls[0]?.body).toEqual({
      text: 'Please wait a moment',
      original_text: 'รอสักครู่นะคะ',
      original_lang: 'th',
    });
  });

  it('⭐⭐⭐ deleting original_text from the builder must be visible HERE', async () => {
    /* the same claim stated as the single key, so the mutation report can quote
       one line rather than a whole object diff */
    await chatService.sendReply('room1', 'hello', undefined, undefined, {
      original_text: 'สวัสดี',
      original_lang: 'th',
    });
    expect(Object.keys(calls[0]!.body)).toContain('original_text');
    expect(calls[0]?.body.original_text).toBe('สวัสดี');
  });

  it('⭐⭐⭐ deleting original_lang from the builder must be visible HERE', async () => {
    await chatService.sendReply('room1', 'hello', undefined, undefined, {
      original_text: 'สวัสดี',
      original_lang: 'th',
    });
    expect(Object.keys(calls[0]!.body)).toContain('original_lang');
    expect(calls[0]?.body.original_lang).toBe('th');
  });

  it('⭐⭐⭐ a send with NO translation posts the body it has always posted', async () => {
    /* Owner's rule 4, and the reason the feature can ship without a migration:
       "Sending without ever translating is byte-identical to today." */
    await chatService.sendReply('room1', 'hi', 'hook1');
    expect(calls[0]?.url).toBe('https://api.test/api/chat/room1/push?hook_id=hook1');
    expect(calls[0]?.body).toEqual({ text: 'hi' });
  });

  it('⭐⭐ an empty original is treated as none — never posted as ""', async () => {
    /* An empty string is what an emptied composer produces. Posting it would
       store a translation whose "original" is blank, which reads on screen as a
       bubble with a missing top line. */
    await chatService.sendReply('room1', 'hi', undefined, undefined, { original_text: '', original_lang: '' });
    expect(calls[0]?.body).toEqual({ text: 'hi' });
  });

  it('⭐⭐ the original coexists with quote_of — neither drops the other', async () => {
    /* Both are optional spreads onto the same object literal; a careless edit
       that replaced one spread with an assignment would silently win. */
    await chatService.sendReply('room1', 'ok', 'hook1', 'a0d000000000000000000096', {
      original_text: 'ตกลง',
      original_lang: 'th',
    });
    expect(calls[0]?.body).toEqual({
      text: 'ok',
      quote_of: 'a0d000000000000000000096',
      original_text: 'ตกลง',
      original_lang: 'th',
    });
  });

  it('⭐⭐ original_text without a known language still travels', async () => {
    /* The FE genuinely does not know the source language (the admin never states
       one). The TEXT is what is worth keeping; the label is optional and its
       absence must not throw the text away too. */
    await chatService.sendReply('room1', 'ok', undefined, undefined, { original_text: 'ตกลง' });
    expect(calls[0]?.body).toEqual({ text: 'ok', original_text: 'ตกลง' });
  });
});
