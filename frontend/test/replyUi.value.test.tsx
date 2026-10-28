/**
 * Reply-to-a-message — UI only, built to be extended.
 * ===========================================================================
 * The owner asked for the interface now and the sending later ("อนาคตจะมี reply
 * · ทำเผื่อไว้แต่ห้ามยัด · reply จะถูกใช้อีก อย่า tech debt"). So the rules live
 * in one hook and one pure module, and these tests pin the RULES rather than the
 * markup — the parts a future send() will lean on.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  replySnippet,
  replyAuthorLabel,
  replyBlockedBy,
  replyBlockedMessage,
  replyBlockedTitle,
} from '../components/chat/replyTarget';
import { useReplyDraft } from '../components/chat/useReplyDraft';
import { useTimedReveal, REPLY_REVEAL_MS } from '../components/chat/useTimedReveal';
import { ReplyPreviewBar } from '../components/chat/ReplyPreviewBar';
/* [REFACTOR-20260905-CUSTPROV] this reads the page PLUS the files it was split
   into. The composer and the right-hand panels moved out of TicketChat.tsx to
   components/chat/{chat-input,ticket-detail}; the code this spec pins moved
   with them, so the read follows the code. Every assertion below is unchanged
   — see test/ticketChatSource.ts for the file list and the one caveat. */
import { ticketChatSource } from './ticketChatSource';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('what the quote says', () => {
  it('uses the text when there is text', () => {
    expect(replySnippet({ id: '1', text: '  สวัสดีครับ ' })).toBe('สวัสดีครับ');
  });

  it('names the kind when a message has no text of its own', () => {
    expect(replySnippet({ id: '1', messageType: 'image' })).toBe('รูปภาพ');
    expect(replySnippet({ id: '1', messageType: 'sticker' })).toBe('สติกเกอร์');
    expect(replySnippet({ id: '1', messageType: 'video_pending' })).toBe('วิดีโอ');
    expect(replySnippet({ id: '1', messageType: 'flex' })).toBe('การ์ดข้อความ');
    expect(replySnippet({ id: '1' })).toBe('ข้อความ');
  });

  it('says whose message is quoted', () => {
    expect(replyAuthorLabel({ id: '1', senderType: 'customer' })).toBe('ลูกค้า');
    expect(replyAuthorLabel({ id: '1', senderType: 'bot' })).toBe('บอท');
    expect(replyAuthorLabel({ id: '1', senderType: 'admin' })).toBe('แอดมิน');
    expect(replyAuthorLabel(null)).toBe('');
  });
});

describe('a reply and an attachment can never coexist', () => {
  it('names what is in the way', () => {
    expect(replyBlockedBy({ hasImages: true })).toBe('image');
    expect(replyBlockedBy({ hasSticker: true })).toBe('sticker');
    expect(replyBlockedBy({})).toBeNull();
  });

  it('the image is reported first when both are pending', () => {
    expect(replyBlockedBy({ hasImages: true, hasSticker: true })).toBe('image');
  });

  it('says it in the owner own words, both halves', () => {
    expect(replyBlockedTitle('image')).toBe('ไม่สามารถตอบกลับพร้อมกับรูปภาพได้');
    expect(replyBlockedMessage('image')).toBe(
      'ไม่สามารถตอบกลับข้อความพร้อมกับรูปภาพได้ / หากต้องการตอบกลับ reply สามารถส่งแยกข้อความ กับ รูปภาพได้',
    );
  });

  it('the sticker case is worded the same way, not left generic', () => {
    expect(replyBlockedTitle('sticker')).toBe('ไม่สามารถตอบกลับพร้อมกับสติกเกอร์ได้');
    expect(replyBlockedMessage('sticker')).toContain('ส่งแยกข้อความ กับ สติกเกอร์');
  });

  it('nothing is said when nothing is blocked', () => {
    expect(replyBlockedTitle(null)).toBe('');
    expect(replyBlockedMessage(null)).toBe('');
  });
});

/** A probe that drives the hook the way the composer does. */
const DraftProbe: React.FC<{ attach: { hasImages?: boolean; hasSticker?: boolean }; api: any }> = ({ attach, api }) => {
  const draft = useReplyDraft(attach);
  api.current = draft;
  return <div data-testid="target">{draft.target?.id ?? 'none'}|{draft.blockedBy ?? 'ok'}</div>;
};

describe('the reply draft', () => {
  it('accepts a target when nothing is attached', () => {
    const api: any = { current: null };
    render(<DraftProbe attach={{}} api={api} />);
    act(() => { expect(api.current.requestReply({ id: 'm1' })).toBe(true); });
    expect(screen.getByTestId('target').textContent).toBe('m1|ok');
  });

  it('REFUSES and reports when an image is waiting', () => {
    const api: any = { current: null };
    render(<DraftProbe attach={{ hasImages: true }} api={api} />);
    act(() => { expect(api.current.requestReply({ id: 'm1' })).toBe(false); });
    expect(screen.getByTestId('target').textContent).toBe('none|image');
  });

  it('CANCELS itself when an attachment appears afterwards', () => {
    const api: any = { current: null };
    const { rerender } = render(<DraftProbe attach={{}} api={api} />);
    act(() => { api.current.requestReply({ id: 'm1' }); });
    expect(screen.getByTestId('target').textContent).toBe('m1|ok');
    rerender(<DraftProbe attach={{ hasSticker: true }} api={api} />);
    expect(screen.getByTestId('target').textContent).toBe('none|ok');
  });

  it('cancel and reset clear it', () => {
    const api: any = { current: null };
    render(<DraftProbe attach={{}} api={api} />);
    act(() => { api.current.requestReply({ id: 'm1' }); });
    act(() => { api.current.cancel(); });
    expect(screen.getByTestId('target').textContent).toBe('none|ok');
  });
});

const RevealProbe: React.FC<{ api: any }> = ({ api }) => {
  const r = useTimedReveal();
  api.current = r;
  return <div data-testid="shown">{r.shownId ?? 'none'}|{r.pinned ? 'pinned' : 'timed'}</div>;
};

describe('how the Reply chip is revealed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pointing reveals it for 10 seconds, then it goes away by itself', () => {
    expect(REPLY_REVEAL_MS).toBe(10000);
    const api: any = { current: null };
    render(<RevealProbe api={api} />);
    act(() => { api.current.show('m1'); });
    expect(screen.getByTestId('shown').textContent).toBe('m1|timed');
    act(() => { vi.advanceTimersByTime(REPLY_REVEAL_MS + 10); });
    expect(screen.getByTestId('shown').textContent).toBe('none|timed');
  });

  it('clicking pins it open with no countdown', () => {
    const api: any = { current: null };
    render(<RevealProbe api={api} />);
    act(() => { api.current.toggle('m1'); });
    act(() => { vi.advanceTimersByTime(REPLY_REVEAL_MS * 3); });
    expect(screen.getByTestId('shown').textContent).toBe('m1|pinned');
  });

  it('clicking the same bubble again puts it away', () => {
    const api: any = { current: null };
    render(<RevealProbe api={api} />);
    act(() => { api.current.toggle('m1'); });
    act(() => { api.current.toggle('m1'); });
    expect(screen.getByTestId('shown').textContent).toBe('none|timed');
  });

  it('a pinned chip is not stolen by the pointer wandering elsewhere', () => {
    const api: any = { current: null };
    render(<RevealProbe api={api} />);
    act(() => { api.current.toggle('m1'); });
    act(() => { api.current.show('m2'); });
    expect(screen.getByTestId('shown').textContent).toBe('m1|pinned');
  });

  it('clear() puts everything away — clicking empty space, or pressing Reply', () => {
    const api: any = { current: null };
    render(<RevealProbe api={api} />);
    act(() => { api.current.toggle('m1'); });
    act(() => { api.current.clear(); });
    expect(screen.getByTestId('shown').textContent).toBe('none|timed');
  });
});

describe('the preview bar', () => {
  it('renders nothing at all when no reply is in progress', () => {
    const { container } = render(<ReplyPreviewBar target={null} onCancel={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('quotes the message and offers a cancel', () => {
    render(<ReplyPreviewBar target={{ id: 'm1', senderType: 'customer', text: 'เติมเงินยังไง' }} onCancel={() => {}} />);
    expect(screen.getByText('เติมเงินยังไง')).toBeTruthy();
    expect(screen.getByText('ตอบกลับลูกค้า')).toBeTruthy();
    expect(screen.getByLabelText('ยกเลิกการตอบกลับ')).toBeTruthy();
  });
});

describe('wired into the pages', () => {
  const view = src('components/chat/ChatRoomView.tsx');
  const page = ticketChatSource();

  it('the chip only exists for pages that asked for it, and only on customer bubbles', () => {
    /* [FEAT-20260820-REPLYHIDDEN] `SHOW_BUBBLE_REPLY_BUTTON &&` was added IN FRONT
       of the three conditions this test has always pinned — the chip is switched
       off until the send path exists, not removed. The three original rules are
       still asserted here, unchanged and in the same order, so turning the switch
       back on restores exactly the behaviour this file describes.
       ปิดสวิตช์ไว้ · กฎเดิมสามข้อยังอยู่ครบตามลำดับเดิม */
    expect(view).toContain("{SHOW_BUBBLE_REPLY_BUTTON && onReplyTo && msg.sender_type === 'customer' && replyReveal.isShown(String(msg._id)) && (");
  });

  /* [FEAT-20260908-AITRANSLATE] RE-PINNED 09/09/2026 — ตรึงพฤติกรรม ไม่ใช่ตรึงการสะกด
   * ==========================================================================
   * เดิมเทสนี้ตรึง literal ของ handler ทั้งบรรทัด · 09/09 มี reveal ตัวที่สอง
   * (`translateReveal`) เข้ามา และ `.show()`/`.toggle()` ในไฟล์นั้นมีอยู่แค่ 2 จุด
   * ซึ่ง gate ด้วย `onReplyTo` อย่างเดียว ⇒ ถ้าไม่แก้ handler ชิปแปลจะไม่มีวันโผล่เลย
   * gate จึงกว้างขึ้นเป็น `(onReplyTo || onTranslate)` และ **แต่ละ reveal ยิงเฉพาะ
   * prop ที่เป็นเจ้าของมัน** ⇒ หน้าที่ส่งแค่ `onReplyTo` ยังทำงานเหมือนเดิมเป๊ะ
   *
   * 🔴 พฤติกรรมที่เทสนี้ปกป้อง **ไม่เปลี่ยนแม้แต่ข้อเดียว** — ที่เปลี่ยนคือรูปประโยค
   *    เจ้าของสั่ง: "คลิก row ข้างนอก bubble = ต้องปิดได้ แต่ห้ามเปิด" · ยังจริงทั้งหมด
   *    ⇒ ตรึงใหม่ที่ "row มีแต่ clear() และไม่มี .show(/.toggle( เลย" ซึ่งแข็งกว่าเดิม
   *      เพราะเดิมพิสูจน์ด้วยการสะกดตรง ๆ ตัวเดียว ไม่ได้ยืนยันว่า "ไม่มีอะไรเปิด"
   *
   * ⚠️ ทำตามแบบเดียวกับ [FIX-20260824-REPLYGATE] ที่ `:227-236` ของไฟล์นี้เอง ซึ่ง
   *    เจอสถานการณ์เดียวกันเป๊ะ (handler ตัวเดิมถูกคร่อมด้วยเงื่อนไข) และสรุปไว้ว่า
   *    *"เทสจึงตรึง 'handler เดิม + ถูก gate' แทนที่จะตรึงรูปประโยคเดิม — ซึ่งเป็นการ
   *    ตรึงการสะกด ไม่ใช่ตรึงพฤติกรรม"* · นี่คือกรณีที่สองของกฎข้อเดียวกัน
   *
   * ⚠️ ตัด slice จากตัว handler ตรง ๆ ไม่ต้อง strip คอมเมนต์ — คอมเมนต์อธิบายอยู่
   *    "เหนือ" attribute ทุกตัว ตัวเนื้อใน handler จึงเป็นโค้ดล้วน · การ assert ว่า
   *    "ไม่มี .show(" จะพังทันทีถ้าเผลอไปนับคอมเมนต์ที่พูดถึง .show() ด้วย
   */
  it('only the BUBBLE opens the chip — the row can only close it', () => {
    /* Owner: "คลิก row ข้างนอก bubble = ต้องปิดได้ แต่ห้ามเปิด". The reveal handlers
       must sit on the bubble block, and the row must carry nothing but clear().
       A single misplaced handler puts the chip back on half the row. */
    const bodyAfter = (from: number) => view.slice(from, view.indexOf('} : undefined}', from));

    // ── the ROW: closes, and can do nothing else ────────────────────────────
    const row = view.indexOf('onClick={(onReplyTo || onTranslate) ? () => {');
    expect(row).toBeGreaterThan(-1);
    const rowBody = bodyAfter(row);
    expect(rowBody).toContain('replyReveal.clear()');
    /* 🔴 THE HALF MOST EASILY LOST, and the reason this is stronger than the
       literal it replaced: the row must contain NO way to open anything. One
       misplaced `show` here and the chip comes back on half the row — the exact
       thing the owner rejected. */
    expect(rowBody).not.toContain('.show(');
    expect(rowBody).not.toContain('.toggle(');

    // ── the BUBBLE: the only place that opens ───────────────────────────────
    const bubble = view.indexOf('onMouseEnter={(onReplyTo || onTranslate) ? () => {');
    expect(bubble).toBeGreaterThan(row);            // reveal is BELOW the row, on the bubble
    const pointBody = bodyAfter(bubble);            // onMouseEnter — reveal on point
    const clickBody = bodyAfter(                    // onClick — pin on click
      view.indexOf('onClick={(onReplyTo || onTranslate) ? (e) => {', bubble),
    );
    expect(pointBody).toContain('replyReveal.show(');
    expect(clickBody).toContain('replyReveal.toggle(');
    // a bubble click must not reach the row's dismiss handler
    expect(clickBody).toContain('e.stopPropagation();');

    /* [FEAT-20260908-AITRANSLATE] what the old assertion could not know: the
       second reveal obeys the SAME rule. The row clears it and never opens it;
       only the bubble opens it. A translate chip that could be opened from the
       row would break the owner's rule just as badly as a reply chip that could. */
    expect(rowBody).toContain('translateReveal.clear()');
    expect(pointBody).toContain('translateReveal.show(');
    expect(clickBody).toContain('translateReveal.toggle(');

    // the bubble box must hug its content, or "hovering the bubble" means the whole row
    expect(view).toContain('className={`max-w-[75%] w-fit');
    expect(view).toContain("document.addEventListener('click', away);");
  });

  it('pressing Reply hands the target over and puts the chip away', () => {
    expect(view).toContain('replyReveal.clear();');
    expect(view).toContain('onReplyTo({');
  });

  it('the composer owns the draft and publishes a handle to it', () => {
    expect(page).toContain('const reply = useReplyDraft({');
    expect(page).toContain('onReplyReadyRef?.({ requestReply: reply.requestReply });');
    /* [FIX-20260824-REPLYGATE] FLIPPED, ไม่ได้ลบ
     *
     * เดิมตรึง literal ทั้งบรรทัด `onReplyTo={(t) => …}` · เจตนาของมันคือ
     * "หน้านี้เดินสาย handle ของ composer ไปให้ ChatRoomView" ซึ่ง**ยังจริงอยู่**
     * ตัว handler ตัวเดิมเป๊ะทุกตัวอักษร แค่ถูกคร่อมด้วยเงื่อนไข
     *
     * เจ้าของสั่ง 24/08: ปุ่ม reply ต้องไม่โผล่จนกว่าจะรับเคส ⇒ ส่ง `undefined`
     * เมื่อยังไม่ใช่เคสของเรา · เทสจึงตรึง "handler เดิม + ถูก gate" แทนที่จะตรึง
     * รูปประโยคเดิม — ซึ่งเป็นการตรึงการสะกด ไม่ใช่ตรึงพฤติกรรม
     */
    expect(page).toContain('(t) => replyApiRef.current?.requestReply(t) ?? false');
    expect(page).toContain('selectedJobStatus === 1 && isMyCase');
  });

  it('the bar sits above the input and the refusal is a dialog', () => {
    const bar = page.indexOf('<ReplyPreviewBar target={reply.target}');
    const textarea = page.indexOf('{/* textarea + send */}');
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(textarea);
    expect(page).toContain('isOpen={!!reply.blockedBy}');
    // the wording comes from the shared module, never retyped in the page
    expect(page).toContain('title={replyBlockedTitle(reply.blockedBy)}');
    expect(page).toContain('message={replyBlockedMessage(reply.blockedBy)}');
  });

  it('nothing about the draft is sent — this is UI only for now', () => {
    // the send path must not mention the reply draft yet
    const send = page.indexOf('const send = ');
    const sendBody = page.slice(send, send + 2500);
    expect(sendBody).not.toContain('reply.target');
  });
});

/* [FIX-20260824-REPLYGATE] ปุ่ม reply ต้องไม่มีอยู่เลยจนกว่าจะรับเคส
 * ============================================================================
 * เจ้าของสั่ง 24/08/2026: "ปุ่ม reply ต้องไม่ขึ้นมาเลย ถ้ายังไม่รับเคสนั้น ๆ" และ
 * "ต้องแสดงและใช้ได้ตอนที่รับเคสอยู่เท่านั้น — **state เดียวกับกล่องพิมพ์แชท**"
 *
 * state ตัวนั้นคืออะไร — ไล่จนจบแล้ว ไม่ได้เดา:
 *   ChatInputBox เปิดใช้งานเมื่อ `accepted && !isOtherAdminCase`
 *   ที่จุดเรียกจริง (TicketChat) ส่ง `accepted={isAccepted}` และ
 *   `isOtherAdminCase={isOtherAdminCase}` โดย
 *     isAccepted        = js === 1 || js === 2
 *     isOtherAdminCase  = js === 1 && !isMyCase
 *   ⚠️ เคสปิด (js===2) ไม่เคยมาถึงจุดนั้น — มันแยกไปสาขา `selectedJobStatus === 2`
 *      ที่ส่ง `accepted={false}` ⇒ ที่จุดนี้ js เป็น 0 หรือ 1 เท่านั้น
 *   ⇒ ยุบทั้งหมดแล้วเหลือ **`selectedJobStatus === 1 && isMyCase`**
 *
 * ⚠️ **ห้ามใช้ `isAccepted` ตรง ๆ** — มันเป็น true กับเคสที่ปิดแล้วด้วย
 *    ถ้าเอามาคุมปุ่ม reply เคสที่ปิดไปแล้วจะมีปุ่มโผล่ ซึ่งตรงข้ามกับที่สั่ง
 *
 * ทำไม gate ที่ "หน้า" ไม่ใช่ใน ChatRoomView: `ChatRoomView` ถูกใช้ 4 หน้า และ
 * อีก 3 หน้า **ไม่ส่ง `onReplyTo` มาอยู่แล้ว** · ตัวคอมโพเนนต์ก็ gate ด้วย
 * `onReplyTo &&` อยู่แล้ว (เทสข้างบนตรึงไว้) ⇒ ไม่ส่ง = ปุ่มไม่ render เลย
 * ตรงตามคำว่า "ไม่ขึ้นมาเลย" · และไม่ต้องแตะคอมโพเนนต์ที่หน้าอื่นใช้ร่วม
 */
describe('[REPLYGATE] ปุ่ม reply ผูกกับ state เดียวกับกล่องพิมพ์', () => {
  /* ⚠️ ตัดคอมเมนต์ก่อน match — บล็อกอธิบายข้างบนนี้เอ่ยถึงทั้ง `isAccepted` และ
     ตัวเงื่อนไขจริง ถ้าไม่ตัด คอมเมนต์จะไปทำให้เทสผ่านเองโดยที่โค้ดยังไม่แก้
     ⚠️ ตัด `//` ก่อน `/* *\/` เสมอ — สลับลำดับแล้วมันกินโค้ดจริง เพราะมี `/*`
        อยู่ใน `//` comment ของไฟล์นี้ (`[^:]` กัน `https://`) */
  const strip = (t: string) =>
    t.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
  const chat = strip(ticketChatSource());

  it('⭐ (T1 TARGET) หน้า TicketChat ส่ง onReplyTo แบบมีเงื่อนไข ไม่ใช่ส่งตลอด', () => {
    expect(chat).toContain('selectedJobStatus === 1 && isMyCase');
    // ส่ง undefined เมื่อยังไม่ใช่เคสของเรา ⇒ ChatRoomView ไม่ render ปุ่ม
    expect(chat).toMatch(
      /onReplyTo=\{\s*selectedJobStatus === 1 && isMyCase\s*\?/,
    );
  });

  it('⭐ (P1 PIN) ไม่ได้ใช้ isAccepted — ตัวนั้น true กับเคสที่ปิดแล้วด้วย', () => {
    const at = chat.indexOf('onReplyTo={');
    expect(at).toBeGreaterThan(-1);
    // ทั้งนิพจน์ ไม่ใช่แค่บรรทัดแรก — เงื่อนไขกินหลายบรรทัด
    const expr = chat.slice(at, at + 260);
    expect(expr).not.toContain('isAccepted');
    expect(expr).toContain('isMyCase');
  });

  it('(P2 PIN) นิยามของ state ยังเป็นตัวเดิม — ถ้าเปลี่ยน ปุ่มกับกล่องพิมพ์จะหลุดจากกัน', () => {
    expect(chat).toContain('const isAccepted = selectedJobStatus === 1 || selectedJobStatus === 2;');
    expect(chat).toContain('const isOtherAdminCase = selectedJobStatus === 1 && !isMyCase;');
  });

  it('(P3 PIN) ChatRoomView ยัง gate ตัวเองด้วย onReplyTo — สองชั้น ไม่ใช่ชั้นเดียว', () => {
    const view = strip(src('components/chat/ChatRoomView.tsx'));
    expect(view).toContain('SHOW_BUBBLE_REPLY_BUTTON && onReplyTo &&');
  });
});
