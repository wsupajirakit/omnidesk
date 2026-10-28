/**
 * [FEAT-20260908-AITRANSLATE] `patchMessage` — the ready-ref function that puts
 * an HTTP result onto ONE message, and stays silent about everything else.
 * ===========================================================================
 * WHY IT EXISTS: a translation arrives over HTTP and never over the websocket
 * (`message:new` carries only `preview`, and there is no `message:updated`
 * branch for the `translations` column), so the page has to write the result
 * into `ChatRoomView`'s own state. Neither of the two functions that were
 * already on `onReadyRef` can: `appendMessage` no-ops on an id it already holds
 * and `refetch` replaces the list with page 1.
 *
 * 🔴 M22 — THE MUTATION THIS FILE EXISTS TO KILL: making `patchMessage` fall
 * back to `refetch()` (or to `appendMessage`) when the id is not in the list.
 * That looks like helpfulness and is the exact defect the function was added to
 * remove: page 1 replaces the list, so a message the operator reached by "load
 * older" or a quote-jump is scrolled out of the window immediately after they
 * paid an AI call for it. ไม่เจอ = เงียบ ไม่ใช่โหลดใหม่.
 *
 * ⚠️ Rendered, not source-read. The claim is about state and about a request
 * NOT being made, and both are observable: the bubble either shows the new text
 * or it does not, and the fetch spy either moved or it did not.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const listMessages = vi.hoisted(() => vi.fn());

vi.mock('../services/chat/chatService', async () => {
  const actual = await vi.importActual<any>('../services/chat/chatService');
  return { ...actual, chatService: { ...actual.chatService, listMessages } };
});
/* the room view subscribes to the live-chat socket on mount; there is no server
   here and the transport is not what these cases are about */
vi.mock('../services/chat/useTicketWS', () => ({ useTicketWS: () => {} }));

import { ChatRoomView } from '../components/chat/ChatRoomView';
import { I18nProvider } from '../i18n';

const room = { _id: 'room1', line_user_id: 'Uabc', unread_count: 0, hook_id: 'h1' } as any;

const msg = (id: string, content: string) => ({
  _id: id, sender_type: 'customer', message_type: 'text', content,
  created_at: '2026-09-09T09:00:00Z',
});

/** the handle `ChatRoomView` hands the page */
type Api = {
  appendMessage: (m: any) => void;
  refetch: () => void;
  patchMessage: (id: string, patch: Record<string, any>) => void;
};

const mountRoom = async () => {
  let api: Api | null = null;
  render(
    <I18nProvider>
      <ChatRoomView
        room={room}
        hookId="h1"
        onReadyRef={(a) => { api = a as Api; }}
        /* the feature is behind this prop; without it the two-layer bubble
           never renders and the patch would be invisible for the wrong reason */
        onTranslate={() => {}}
      />
    </I18nProvider>,
  );
  await screen.findByText('ฉันอยากถอนเงิน');
  return api!;
};

beforeEach(() => {
  vi.clearAllMocks();
  listMessages.mockResolvedValue({
    success: true,
    room: { id: 'room1', line_user_id: 'Uabc', user_data: {} },
    /* the BE returns newest→oldest and the view reverses it */
    data: [msg('m2', 'สวัสดีครับ'), msg('m1', 'ฉันอยากถอนเงิน')],
    pagination: { total: 2, page: 1, limit: 10, pages: 1 },
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ patchMessage writes to exactly one message', () => {
  it('⭐⭐⭐ a known id gets the translation, and the bubble shows both texts', async () => {
    const api = await mountRoom();
    const before = listMessages.mock.calls.length;

    await act(async () => {
      api.patchMessage('m1', {
        translations: [{ lang: 'en', text: 'I want to withdraw money', from: null, to: 'en' }],
      });
    });

    /* the translation lands on the bubble that was already there.
       [FIX-20260918-SHOWORIGINAL] the ORIGINAL is no longer asserted here: since
       18/09 the second half is gated on the room's `show_original_text`, which
       defaults to false ("seamless"), so an unconfigured room shows the
       translation alone. The both-halves rendering is pinned by
       `chatTranslateBubble.dom.test.tsx`, which drives the flag on purpose.
       This case is about patchMessage writing to ONE message without a refetch —
       that part is unchanged. ห้องที่ไม่ได้ตั้งค่า = เห็นคำแปลอย่างเดียว */
    await waitFor(() => expect(screen.getByText('I want to withdraw money')).toBeInTheDocument());
    /* 🔴 and it did NOT reload the room to do it */
    expect(listMessages.mock.calls.length).toBe(before);
  });

  it('⭐⭐⭐ the OTHER messages are untouched', async () => {
    const api = await mountRoom();
    await act(async () => {
      api.patchMessage('m1', {
        translations: [{ lang: 'en', text: 'I want to withdraw money', from: null, to: 'en' }],
      });
    });
    expect(screen.getByText('สวัสดีครับ')).toBeInTheDocument();
    /* the untranslated neighbour did not grow a translation of its own */
    expect(screen.queryAllByText('I want to withdraw money')).toHaveLength(1);
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ M22 — an unknown id is answered with SILENCE', () => {
  it('⭐⭐⭐ patching an id that is not on screen changes nothing and fetches nothing', async () => {
    /* 🔴 The mutation: `else refetch()`. It would reload page 1 and throw the
       operator's scroll position — and any older message they had loaded —
       away, which is precisely the defect `patchMessage` was added to fix.
       Appending instead would be worse still: a bubble with no context around
       it, in the wrong place in the timeline. */
    const api = await mountRoom();
    const before = listMessages.mock.calls.length;

    await act(async () => {
      api.patchMessage('does-not-exist', {
        translations: [{ lang: 'en', text: 'GHOST TEXT', from: null, to: 'en' }],
      });
    });

    /* nothing was fetched … */
    expect(listMessages.mock.calls.length).toBe(before);
    /* … nothing was appended … */
    expect(screen.queryByText('GHOST TEXT')).toBeNull();
    /* … and the two real messages are exactly as they were */
    expect(screen.getByText('ฉันอยากถอนเงิน')).toBeInTheDocument();
    expect(screen.getByText('สวัสดีครับ')).toBeInTheDocument();
  });

  it('⭐⭐⭐ and the room is not reloaded even after several unknown ids', async () => {
    /* a burst is where a "helpful" fallback does the most damage: one refetch
       per miss, each one replacing the list */
    const api = await mountRoom();
    const before = listMessages.mock.calls.length;
    await act(async () => {
      for (const id of ['a', 'b', 'c', 'd']) api.patchMessage(id, { content: 'x' });
    });
    expect(listMessages.mock.calls.length).toBe(before);
  });
});
