/**
 * [FEAT-20260821-QUOTEREPLY] `sendReply` carries `quote_of` to the BE — and ONLY
 * when a reply is in progress. A plain send posts the exact body it always did,
 * so every existing caller is untouched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: Array<{ url: string; body: unknown }> = [];
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
  handleApiResponse: (r: Response) => r.json(),
}));

import { chatService } from '../services/chat/chatService';

describe('chatService.sendReply + quote_of', () => {
  beforeEach(() => { calls.length = 0; });

  it('a plain send posts { text } and nothing else — byte-identical to before', async () => {
    await chatService.sendReply('room1', 'hi', 'hook1');
    expect(calls[0]?.url).toBe('https://api.test/api/chat/room1/push?hook_id=hook1');
    expect(calls[0]?.body).toEqual({ text: 'hi' });
  });

  it('with a reply target, quote_of travels as the message _id', async () => {
    await chatService.sendReply('room1', 'hi', 'hook1', 'a0d000000000000000000096');
    expect(calls[0]?.body).toEqual({ text: 'hi', quote_of: 'a0d000000000000000000096' });
  });

  it('an empty quote_of is treated as none — never posted as ""', async () => {
    await chatService.sendReply('room1', 'hi', undefined, '');
    expect(calls[0]?.body).toEqual({ text: 'hi' });
  });

  /* [FEAT-20260821-QUOTEJUMP] the around-window can anchor on LINE's id. */
  it('listMessagesAround default → no `by` param (unchanged)', async () => {
    await chatService.listMessagesAround('Uabc', 'a0d000000000000000000096', 'hook1');
    expect(calls[0]?.url).toBe('https://api.test/api/chat/Uabc/messages/around/a0d000000000000000000096?hook_id=hook1');
  });
  it("listMessagesAround by='provider' → ?by=provider", async () => {
    await chatService.listMessagesAround('Uabc', '625', 'hook1', 'provider');
    expect(new URL(calls[0]!.url).searchParams.get('by')).toBe('provider');
  });
});
