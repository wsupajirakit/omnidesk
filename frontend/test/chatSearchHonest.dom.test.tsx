/**
 * [FIX-2708-SEARCHHONEST] In-room chat search — the screen must say HOW FAR BACK it
 * actually searched.
 * ===========================================================================
 * Owner, 27/08, with a screenshot: typing "ฝากขั้นต่ำ" returned "not found" while a
 * bubble with that very word sat on screen. That message is dated 10 Aug; the BE only
 * searches the last 7 days (`chat.service.ts` `CHAT_SEARCH.DAYS_BACK`). The 7-day
 * window stays as decided — what is fixed is the screen pretending the message is not
 * there.
 *
 * Three outcomes had collapsed into ONE sentence, which is the actual defect:
 *   · the request failed   -> rendered "not found" (a broken search read as an empty
 *                             room, and the stale window date stayed on screen)
 *   · nothing matched      -> said "last 7 days" but never WHICH 7 days
 *   · 2-3 characters typed -> the gate was still `>= 2` after the minimum moved to 4,
 *                             so it claimed "not found" for a search never sent
 *
 * Real mount (same harness as chatHeaderControlsRow.dom.test.tsx) — asserted from the
 * DOM, not by reading the source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchMessages = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

const mountRoom = async () => {
  vi.doMock('../services/chat', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        getMessages: vi.fn().mockResolvedValue({ success: true, data: [] }),
        searchMessages: (...a: unknown[]) => searchMessages(...a),
      },
      useTicketWS: () => undefined,
    };
  });
  const { render } = await import('@testing-library/react');
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: { _id: 'm1', display_name: 'judy' },
  } as never;
  return render(
    <ChatRoomView room={room} hookId="hook1" oaName="omnidesk-dev-oa" showDetailBox={false} memberId="m1" memberData={{ _id: 'm1' }} />,
  );
};

/** Open the search panel, type, then press the search button. */
const runSearch = async (container: HTMLElement, q: string) => {
  const { fireEvent, act } = await import('@testing-library/react');
  const openBtn = Array.from(container.querySelectorAll('button')).find((b) =>
    (b.getAttribute('title') || '').includes('ค้นหาข้อความในห้องนี้'),
  )!;
  fireEvent.click(openBtn);
  const input = container.querySelector('input[placeholder*="ค้นหาข้อความในห้องนี้"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: q } });
  const goBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'ค้นหา');
  if (goBtn && !(goBtn as HTMLButtonElement).disabled) {
    await act(async () => {
      fireEvent.click(goBtn);
    });
  }
  return { input, goBtn: goBtn as HTMLButtonElement };
};

describe('[SEARCHHONEST] an empty result must state the date it searched from', () => {
  it('no match -> shows the real boundary from scanned_from, not just "last 7 days"', async () => {
    searchMessages.mockResolvedValue({
      data: [],
      scanned_from: '2026-08-20T00:00:00.000Z',
      truncated: false,
      limits: { days: 7, max_scan: 1000 },
    });
    const { container } = await mountRoom();
    await runSearch(container, 'ฝากขั้นต่ำ');

    const empty = container.querySelector('[data-testid="chat-search-empty"]');
    expect(empty, 'the empty-result line must render').not.toBeNull();
    const txt = empty!.textContent || '';
    expect(txt).toContain('ไม่พบข้อความ');
    /* The heart of this fix: the real date the BE searched from. */
    expect(txt, 'must name the date the search actually started from').toMatch(/2569|2026/);
    expect(txt, 'must say older messages are still in the room but were not searched').toContain('ไม่ถูกค้น');
  });

  it('a failed request must NOT say "not found" — they are different outcomes', async () => {
    searchMessages.mockRejectedValue(new Error('boom'));
    const { container } = await mountRoom();
    await runSearch(container, 'ฝากขั้นต่ำ');

    expect(container.querySelector('[data-testid="chat-search-error"]'), 'the failure line must render').not.toBeNull();
    expect(
      container.querySelector('[data-testid="chat-search-empty"]'),
      'must not show "not found" when no search ever succeeded',
    ).toBeNull();
  });

  it('below the minimum (3 chars) stays silent instead of claiming "not found"', async () => {
    const { container } = await mountRoom();
    const { goBtn } = await runSearch(container, 'ฝาก');
    expect(goBtn.disabled, 'the button must stay disabled').toBe(true);
    expect(searchMessages).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="chat-search-empty"]')).toBeNull();
    expect(container.querySelector('[data-testid="chat-search-error"]')).toBeNull();
  });
});
