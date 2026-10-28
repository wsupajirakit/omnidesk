/**
 * [FEAT-20260908-AITRANSLATE] CHARACTERIZATION — what an UNTRANSLATED bubble
 * looks like TODAY, captured before the translate feature was written.
 * ===========================================================================
 * Owner, 09/09: *"ส่วนการแปลไม่แปล ไม่ได้บังคับที่หน้า FE นะ optional เผื่อแอดมิน
 * ไม่อยากแปล"* — an admin who never touches the translate chip must see EXACTLY
 * today's screen. That promise is unprovable after the fact: once
 * `ChatRoomView.tsx` has been edited there is nothing left to compare against.
 *
 * 🔴 SO THIS FILE WAS COMMITTED, PASSING, BEFORE THE FIRST LINE OF THE FEATURE.
 *    It is not a test of the feature. It is the BEFORE picture, and the whole
 *    reason it can be trusted is that it predates the change.
 *    ถ่ายรูปก่อนแก้ ไม่งั้นพิสูจน์ไม่ได้ว่า "เหมือนเดิม".
 *
 * WHAT IS SNAPSHOTTED, AND WHY IN TWO PIECES
 *   1. `the bubble` — the `.tc-msg-in` element's raw `outerHTML`, byte for byte,
 *      with nothing normalised. This is the element the feature adds inside, so
 *      this is where a stray wrapper div, an extra child or a changed class
 *      string shows up. No time string lives in here, so it is stable anywhere.
 *   2. `the whole row` — the `#msg-<id>` row, which also carries the alignment
 *      classes, the avatar and the chip slot. Its timestamp is replaced with
 *      «TIME» because `formatTime` renders through `toLocaleString`, so the raw
 *      bytes there depend on the machine's timezone, not on this repo. Every
 *      other byte — every div, class and attribute — is compared exactly.
 *
 * ⚠️ IF EITHER SNAPSHOT MOVES, THE PROMISE IS BROKEN. Do not update it to make a
 *    run green: an untranslated message is supposed to render identically
 *    forever. The only legitimate reason to re-record is a deliberate, owner-
 *    approved change to the ordinary chat bubble — which this feature is not.
 *
 * ⚠️ NO `translations` FIELD is present on the fixture row, on purpose. That is
 *    the shape of every message in the database today and of every message
 *    nobody ever translates.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  /* jsdom has no layout, so ChatRoomView's scroll-to-bottom effect would throw.
     Same environment gap the shared setup file documents. */
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * Mount the REAL ChatRoomView with the props the plain /chat page passes —
 * no `onReplyTo`, no ticket props, nothing optional. This is the baseline
 * screen: the one three of the four pages actually render.
 */
const mountWith = async (messages: unknown[]) => {
  vi.doMock('../services/chat', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../services/chat');
    return {
      ...actual,
      chatService: {
        ...(actual.chatService as Record<string, unknown>),
        // the view loads through `listMessages` and reverses what it receives
        listMessages: vi.fn().mockResolvedValue({
          data: [...messages].reverse(),
          pagination: { page: 1, pages: 1, total: messages.length },
        }),
      },
      useTicketWS: () => undefined,
    };
  });
  const { render, waitFor } = await import('@testing-library/react');
  const { ChatRoomView } = await import('../components/chat/ChatRoomView');
  const room = {
    _id: 'room1',
    line_user_id: 'U1',
    hook_id: 'hook1',
    user_data: { _id: 'm1', display_name: 'bbbb' },
  } as never;
  const view = render(
    <ChatRoomView
      room={room}
      hookId="hook1"
      showDetailBox={false}
      memberId="m1"
      memberData={{ _id: 'm1' }}
    />,
  );
  /* either side — the outbound fixture never renders `.tc-msg-in`, and waiting
     on the inbound class alone made this helper time out for it */
  await waitFor(() =>
    expect(view.container.querySelector('.tc-msg-in, .tc-msg-out')).toBeTruthy(),
  );
  return view;
};

/** A perfectly ordinary customer text message. Nothing was ever translated. */
const plainText = {
  _id: 'msg-plain-1',
  message_type: 'text',
  sender_type: 'customer',
  content: 'ผมอยากถอนเงิน',
  internal_content_id: null,
  created_at: '2026-09-08T04:05:06.000Z',
};

/** The same, outbound — the other side of the transcript. */
const plainOutbound = {
  _id: 'msg-plain-2',
  message_type: 'text',
  sender_type: 'bot',
  content: 'รอสักครู่นะคะ',
  internal_content_id: null,
  created_at: '2026-09-08T04:06:07.000Z',
};

/** Blank out only the timezone-dependent bytes; keep every other byte exact. */
const stripTime = (html: string): string =>
  html.replace(
    /(<div class="text-\[10px\] text-slate-400 mb-1 px-1">)[^<]*(<\/div>)/,
    '$1«TIME»$2',
  );

describe('[AITRANSLATE · BEFORE] an untranslated bubble, exactly as it renders today', () => {
  it('⭐⭐⭐ the inbound bubble markup is byte-identical to this snapshot', async () => {
    const { container } = await mountWith([plainText]);
    const bubble = container.querySelector('.tc-msg-in');
    expect(bubble).toBeTruthy();
    expect(bubble!.outerHTML).toMatchSnapshot('inbound bubble');
  });

  it('⭐⭐⭐ the whole inbound row is byte-identical (timestamp aside)', async () => {
    const { container } = await mountWith([plainText]);
    const row = container.querySelector('#msg-msg-plain-1');
    expect(row).toBeTruthy();
    expect(stripTime(row!.outerHTML)).toMatchSnapshot('inbound row');
  });

  it('⭐⭐⭐ the outbound bubble markup is byte-identical to this snapshot', async () => {
    const { container } = await mountWith([plainOutbound]);
    const bubble = container.querySelector('.tc-msg-out');
    expect(bubble).toBeTruthy();
    expect(bubble!.outerHTML).toMatchSnapshot('outbound bubble');
  });

  it('⭐⭐ nothing wraps the text — the bubble\'s only content is the message', async () => {
    /* The sharpest single assertion, and the one that survives a snapshot being
       carelessly re-recorded: today the bubble holds the message text and
       nothing else. A translation layer added unconditionally puts a divider
       and a second text node in here, and this fails without anyone having to
       read a diff. */
    const { container } = await mountWith([plainText]);
    const bubble = container.querySelector('.tc-msg-in') as HTMLElement;
    expect(bubble.textContent).toBe('ผมอยากถอนเงิน');
    expect(bubble.querySelector('.border-t')).toBeNull();
  });
});
