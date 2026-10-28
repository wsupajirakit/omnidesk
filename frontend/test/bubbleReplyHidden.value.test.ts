/**
 * [FEAT-20260820-REPLYHIDDEN] the Reply chip is switched off, not deleted
 * ============================================================================
 * Owner, 20/08: "hidden ปุ่ม reply หน้า chat message ห้ามกระทบ".
 *
 * The reply UI was built ahead of its backend — `replyTarget.ts` says so itself:
 * "UI-ONLY FOR NOW ... no transport, no BE field, no message mutation". Pressing
 * it quotes the message above the composer and sends nothing, so it is a control
 * that promises something the product cannot do yet. Hidden until it can.
 *
 * ⚠️ HIDDEN, NOT REMOVED, and the difference matters. Deleting it would take the
 * preview bar, the reveal timer and the `onReplyTo` seam with it, and all of that
 * has to come back the day the real feature lands. One exported boolean turns it
 * on again — no other line changes. ปิดสวิตช์ ไม่ได้รื้อ · เปิดกลับบรรทัดเดียว.
 *
 * ⚠️ WHAT MUST NOT MOVE. Only the chip's own render is gated. The bubble, the
 * avatar, the admin signature, the timed reveal that shows it on hover, the
 * preview bar and every other message type render exactly as before — asserted
 * below by reading the surrounding source rather than by trusting the diff.
 *
 * to bring it back: set `SHOW_BUBBLE_REPLY_BUTTON = true` in
 * `components/chat/replyTarget.ts`. Nothing else. This spec then fails, which is
 * the reminder to update it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { SHOW_BUBBLE_REPLY_BUTTON } from '../components/chat/replyTarget';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const src = readFileSync(
  resolve(__dirname, '../components/chat/ChatRoomView.tsx'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* [FEAT-20260821-QUOTEREPLY] The day the header describes arrived: `sendReply`
   posts `quote_of`, the BE resolves LINE's quoteToken and quotes for real, and
   the appended bubble carries `quoted_provider_msg_id`. So the switch is ON —
   and this spec keeps every OTHER guarantee it had: the render is still gated on
   this one boolean (so it can be turned off again in one line), and the boolean
   is still read in exactly one place. เปิดแล้ว แต่ยังปิดกลับได้บรรทัดเดียว. */
describe('⭐ the chip is ON, through the same one-line switch', () => {
  it('the switch is true — the send behind it is real now', () => {
    expect(SHOW_BUBBLE_REPLY_BUTTON).toBe(true);
  });

  it('and the render is gated on it — not on something else, not deleted', () => {
    const at = src.indexOf('<BubbleReplyButton');
    expect(at).toBeGreaterThan(-1); // still there, just unreachable
    const guard = src.slice(src.lastIndexOf('{', at), at);
    expect(guard).toContain('SHOW_BUBBLE_REPLY_BUTTON');
  });

  it('⭐ the switch is read in exactly one place', () => {
    /* a second reader would mean something else started depending on it, and
       "flip one boolean" would stop being true.
       The import line is excluded — it names the switch without deciding
       anything. นับเฉพาะจุดที่เอาไปใช้ตัดสิน ไม่นับบรรทัด import. */
    const withoutImport = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('import'))
      .join('\n');
    expect(withoutImport.split('SHOW_BUBBLE_REPLY_BUTTON').length - 1).toBe(1);
  });
});

describe('⭐ nothing around it moved — "ห้ามกระทบ", measured', () => {
  it('the conditions the chip already had are still there, in order', () => {
    /* customer-only and reveal-only were the original rules; the switch is added
       IN FRONT of them, so the chip cannot become more visible than before even
       if it is turned back on. */
    const at = src.indexOf('<BubbleReplyButton');
    const guard = src.slice(src.lastIndexOf('{', at), at);
    expect(guard).toContain('onReplyTo');
    expect(guard).toContain("msg.sender_type === 'customer'");
    expect(guard).toContain('replyReveal.isShown');
    expect(guard.indexOf('SHOW_BUBBLE_REPLY_BUTTON')).toBeLessThan(
      guard.indexOf('onReplyTo'),
    );
  });

  it('the reply plumbing is untouched — it just has no way in', () => {
    for (const kept of [
      'useTimedReveal',
      'replyReveal',
      'onReplyTo',
      'BubbleReplyButton',
    ]) {
      expect(src).toContain(kept);
    }
  });

  it('the preview bar and the composer are not part of this change', () => {
    /* ReplyPreviewBar is driven by TicketChat's `replyTo` state, which nothing
       here writes any more — it simply never opens. It must still be wired. */
    const page = ticketChatSource();
    expect(page).toContain('ReplyPreviewBar');
    expect(page).toContain('onReplyTo');
  });

  it('the button component itself is untouched and still exported', () => {
    const btn = readFileSync(
      resolve(__dirname, '../components/chat/BubbleReplyButton.tsx'),
      'utf8',
    );
    expect(btn).toContain('export const BubbleReplyButton');
    expect(btn).toContain('ตอบกลับข้อความนี้');
  });
});
