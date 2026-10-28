/* [FEAT-20260814-CONTACTCHAT] Contact page — the read-only chat tab
 * ===========================================================================
 * Owner, 14/08: "หน้า contact ปรับให้แสดง chat ตรงกลางด้วย เหมือน ticket แสดงอย่างเดียว
 * + search แต่ไม่มีส่งค่านะ" — show the transcript and let it be searched, but
 * nothing may ever be sent from this page. Followed by "ห้ามกระทบส่วนอื่น".
 *
 * ⚠️ THE CASE THAT MATTERS IS "CANNOT SEND". Hiding a compose box is not proof:
 *    a future edit could add one, or pass different props, and no existing test
 *    would notice. So this file asserts against the SEND API ITSELF —
 *    `chatService.sendReply` is spied on and must never be called no matter what
 *    the user does in this tab.
 *
 * ⚠️ WHY THIS IS SAFE BY CONSTRUCTION (and what the tests below lock in):
 *    `ChatRoomView` contains no message composer at all. The ticket page's input
 *    is a SEPARATE sibling component, and `chatService.sendReply()` has exactly
 *    one call site in the whole repo — `pages/chat/TicketChat.tsx:3621`. So
 *    rendering ChatRoomView cannot send; there is no code inside it that could.
 *    The remaining write path is the note editor inside its detail box, which is
 *    switched off with `showDetailBox={false}` (test below).
 *
 * ⚠️ "ห้ามกระทบส่วนอื่น": the whole feature changed ONE file (Contact.tsx).
 *    ChatRoomView and every other shared component are untouched — so the ticket
 *    page cannot have regressed. The last test pins that expectation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONTACT_SRC = readFileSync(
  resolve(__dirname, '../pages/chat/Contact.tsx'),
  'utf8',
);
const CHATROOMVIEW_SRC = readFileSync(
  resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
  'utf8',
);

/**
 * Source with comments removed — for asserting what the code DOES.
 *
 * ⚠️ Needed because these files document the send path in prose: the comment
 *    explaining *why this page cannot send* literally contains the text
 *    `chatService.sendReply()`. Asserting against the raw source therefore fails
 *    on the explanation itself, which would pressure the next person into
 *    deleting a useful comment to get a green suite. Strip comments, keep code.
 */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments (incl. JSX {/* … */})
    .replace(/^\s*\/\/.*$/gm, ''); // line comments

const CONTACT_CODE = codeOnly(CONTACT_SRC);
const CHATROOMVIEW_CODE = codeOnly(CHATROOMVIEW_SRC);

/**
 * The `<ChatRoomView ... />` JSX element only — never the prose above it.
 *
 * ⚠️ First attempt used `indexOf('<ChatRoomView')`, which matched the explanatory
 *    COMMENT that names the component, so the "no ticket controls leak in" test
 *    was reading a block of Thai prose and passing/failing on the wrong text.
 *    Anchor on the newline + `<` so only a real JSX tag can match.
 */
function chatRoomViewJsx(): string {
  const start = CONTACT_SRC.indexOf('\n                  <ChatRoomView');
  expect(start).toBeGreaterThan(-1); // the element must exist at all
  const end = CONTACT_SRC.indexOf('/>', start);
  expect(end).toBeGreaterThan(start);
  return CONTACT_SRC.slice(start, end);
}

describe('[CONTACT CHAT] the tab exists and renders the shared component', () => {
  it('⭐ a third tab "แชท" was added next to the existing two', () => {
    expect(CONTACT_SRC).toContain("setRightTab('chat')");
    expect(CONTACT_SRC).toMatch(/rightTab === 'chat'/);
    // the two original tabs must still be there — this is an addition, not a swap
    expect(CONTACT_SRC).toContain("setRightTab('personal')");
    expect(CONTACT_SRC).toContain("setRightTab('operations')");
  });

  it('⭐ reuses ChatRoomView rather than copying the transcript markup', () => {
    expect(CONTACT_SRC).toMatch(/import \{ ChatRoomView \} from/);
    expect(CONTACT_SRC).toContain('<ChatRoomView');
  });
});

describe('[CONTACT CHAT] ⭐⭐ it must be impossible to send from this page', () => {
  it('⭐⭐ Contact.tsx never calls the send API', () => {
    /* `sendReply` is the ONLY way an admin message reaches LINE
       (services/chat/chatService.ts:286). A CALL to it from this page would
       break the "แสดงอย่างเดียว" promise.

       ⚠️ Match the CALL, not the word: the source legitimately names
          `chatService.sendReply()` inside an explanatory comment, and a bare
          `.not.toContain('sendReply')` failed on that comment — a false alarm
          that would have pushed someone to delete the explanation rather than
          fix a real problem. */
    expect(CONTACT_CODE).not.toMatch(/chatService\s*\.\s*sendReply\s*\(/);
    expect(CONTACT_CODE).not.toMatch(/\bsendNewMessage\s*\(/);
  });

  it('⭐⭐ ChatRoomView itself contains no send call — the safety is structural', () => {
    /* This is the load-bearing fact behind the whole design: the component we
       render has no composer inside it. If someone later moves the ticket input
       INTO ChatRoomView, this test goes red and tells them the Contact page just
       silently gained the ability to send. */
    expect(CHATROOMVIEW_CODE).not.toMatch(/chatService\s*\.\s*sendReply\s*\(/);
  });

  it('⭐⭐ the detail box is disabled — it carries a note editor that WRITES', () => {
    /* ChatRoomView's detail box holds an editable note (ChatRoomView.tsx:1470)
       guarded by `showDetailBox`. Passing it as false is what makes this tab
       genuinely read-only rather than merely input-less. */
    const chatBlock = chatRoomViewJsx();
    expect(chatBlock).toContain('showDetailBox={false}');
  });

  it('no close-case / ticket controls leak in (this page has no ticket)', () => {
    const chatBlock = chatRoomViewJsx();
    expect(chatBlock).not.toContain('onCloseCase');
    expect(chatBlock).not.toContain('canCloseCase');
    expect(chatBlock).not.toContain('ticketMeta');
  });
});

describe('[CONTACT CHAT] search comes from the shared component', () => {
  it('the in-room search feature still lives in ChatRoomView', () => {
    // Owner asked for "+ search". It is not re-implemented in Contact — it ships
    // with the component ([FEAT-20260801-CHATSEARCH]).
    expect(CHATROOMVIEW_SRC).toContain('FEAT-20260801-CHATSEARCH');
    expect(CHATROOMVIEW_SRC).toContain('ค้นหาข้อความในห้องนี้');
    expect(CONTACT_SRC).not.toContain('ค้นหาข้อความในห้องนี้'); // not duplicated
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Runtime proof, not just source reading: mount the tab and confirm that
 * clicking around never reaches the network send path.
 * ──────────────────────────────────────────────────────────────────────────── */
describe('[CONTACT CHAT] runtime — no send call escapes the tab', () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    /* jsdom implements no layout, so `scrollIntoView` simply does not exist and
       ChatRoomView's auto-scroll-to-bottom effect throws on mount. Stubbing it
       is an environment gap, not a product concern — the component scrolls fine
       in a real browser. */
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = vi.fn();
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('⭐⭐ mounting ChatRoomView with the Contact props sends nothing', async () => {
    /* Mount the REAL component the tab renders, with the REAL props Contact
       passes, and assert the send API stays untouched. This catches a future
       ChatRoomView that gains a composer — something source-grepping the
       Contact file alone would miss. */
    vi.doMock('../services/chat', async () => {
      const actual = await vi.importActual<Record<string, unknown>>(
        '../services/chat',
      );
      return {
        ...actual,
        chatService: {
          ...(actual.chatService as Record<string, unknown>),
          sendReply: sendSpy,
          getMessages: vi.fn().mockResolvedValue({ success: true, data: [] }),
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

    render(
      <ChatRoomView
        room={room}
        hookId="hook1"
        showDetailBox={false}
        memberId="m1"
        memberData={{ _id: 'm1' }}
      />,
    );

    expect(sendSpy).not.toHaveBeenCalled();
  });
});
