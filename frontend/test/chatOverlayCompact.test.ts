/* [FE] [FIX-20260824-OVERLAYCOMPACT] The "nobody is chatting yet" overlays, made
 * smaller — without making them unreadable, and without touching what they do.
 *
 * WHAT THE OWNER ASKED FOR: the three overlay states that sit over the chat when
 * no admin has taken the case (held-by-someone-else, bot-is-watching, and
 * take-the-case) take up too much room. Shrink them, but the buttons and the
 * text ON the buttons must stay readable. And in the held-by-someone-else card
 * the sentence wraps so that its final word `ได้` is orphaned on its own line —
 * pull it up.
 *
 * WHY THESE ARE SOURCE PINS AND NOT A DOM TEST — said plainly rather than
 * implied: `TicketChat.tsx` is 5,400+ lines with a very large dependency
 * surface, and rendering it in jsdom is not practical here. This file follows
 * the pattern `reopenTicketCard.test.ts` already established for the same
 * component: read the source, strip comments so prose cannot satisfy or break an
 * assertion, and assert on the markup. That pins less than a render would, and
 * the limit is stated here so nobody reads more into a green run than it earns.
 *
 * WHAT IS DELIBERATELY NOT PINNED: the exact spacing values. Pinning `p-3` would
 * turn every future visual tweak into a failing test for no safety. What is
 * pinned is the OWNER'S CONSTRAINT — the button labels stay at a readable size —
 * and the behaviour, which must not move at all.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
/* [REFACTOR-20260905-CUSTPROV] the three pre-claim overlays moved out of
   TicketChat.tsx into their own file, so this spec now reads that file. The
   read got MORE precise, not less: `overlay()` used to carve the block out of a
   7,000-line page between two markers, and the block IS the file now. Every
   assertion below is unchanged. */
const OVERLAY_FILE = 'components/chat/chat-input/ComposerCaseOverlay.tsx';

const source = readFileSync(join(process.cwd(), OVERLAY_FILE), 'utf8')
  /* ⚠️ LINE COMMENTS FIRST, then block comments — the order is load-bearing.
     Stripping `/* *\/` first swallowed real code in this file: a `/*` sitting
     inside a `//` comment opens a block that runs to the next `*\/`, and the
     constants this spec reads disappeared with it. The `[^:]` guard keeps
     `https://` out of the line-comment pass. ลำดับสลับไม่ได้ ไม่งั้นกินโค้ดจริง. */
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The whole overlay: from the held-by-another branch to the composer below it. */
const overlay = (): string => {
  const start = source.indexOf('{isOtherAdminCase ? (');
  /* the old upper bound was `{...dropHandlers}` — the composer box that used to
     follow this block in the same file. The block now ends where the file does. */
  expect(start).toBeGreaterThan(-1);
  return source.slice(start);
};

describe('[OVERLAYCOMPACT] the pre-claim overlays are smaller but still legible', () => {
  it('⭐ (T1 TARGET) the held-case sentence cannot orphan its last word', () => {
    // The rendered line is `รับเคสไว้เมื่อ HH:MM • แอดมินใหม่ต้องกดรับเคสต่อก่อนพิมพ์ได้`.
    // Thai has no inter-word spaces, so the browser breaks it wherever it likes
    // and `ได้` ends up alone. Keeping `พิมพ์ได้` in one unbreakable run is what
    // stops that, and it is deterministic — unlike text-wrap:pretty, which is
    // a hint and is not in every browser this dashboard is opened in.
    const block = overlay();
    const sentence = block.slice(
      block.indexOf('แอดมินใหม่ต้องกดรับเคสต่อ'),
      block.indexOf('</p>', block.indexOf('แอดมินใหม่ต้องกดรับเคสต่อ')),
    );
    expect(sentence).toContain('whitespace-nowrap');
    expect(sentence).toContain('พิมพ์ได้');
  });

  it('⭐ (P1 PIN) no overlay control is shrunk below a readable label size', () => {
    /* The owner's constraint on the shrink, and the one thing the size change
     * must never win against.
     *
     * Stated as a FLOOR rather than a required class, because that is what the
     * markup actually is: two of these controls declare `text-sm` and one
     * declares no size at all and inherits a larger one. Demanding `text-sm`
     * everywhere would assert today's spelling, not legibility.
     *
     * ⚠️ It walks the BUTTON ELEMENTS, not the labels. An earlier version of
     * this case searched for the label text and then scanned backwards for
     * `<button` — and `รับเคสต่อ` also occurs inside the sentence ABOVE the
     * button, so that search landed in the paragraph, found no button before it,
     * and silently measured nothing. A mutation that shrank the real button to
     * `text-xs` sailed straight through it. Walking the elements is what makes
     * this assertion actually assert. หา element จริง อย่าหาจากข้อความ.
     */
    const block = overlay();
    const TOO_SMALL = /\btext-xs\b|\btext-\[(?:[0-9]|1[0-2])px\]/;

    const controls: string[] = [];
    for (let i = block.indexOf('<button'); i > -1; i = block.indexOf('<button', i + 1)) {
      controls.push(block.slice(i, block.indexOf('>', i)));
    }
    // the bot-care capsule is a <span>, not a button, but it carries a label too
    const capsule = block.indexOf('{closedNotice}');
    if (capsule > -1) {
      controls.push(block.slice(block.lastIndexOf('<span', capsule), capsule));
    }

    // the three buttons (claim / reopen / accept) plus the capsule
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const c of controls) {
      expect({ tooSmall: TOO_SMALL.test(c), control: c.slice(0, 60) }).toEqual({
        tooSmall: false,
        control: c.slice(0, 60),
      });
    }
  });

  it('⭐ (P2 PIN) the claim behaviour is untouched — this was a size change only', () => {
    const block = overlay();
    // the handler, the in-flight flag, and the branch that decides the state
    expect(block).toContain('onClick={onClaim}');
    expect(block).toContain('disabled={claiming}');
    expect(block).toContain('onClick={onAccept}');
    expect(block).toContain('disabled={accepting}');
    // reopen stays gated on the handler being passed
    expect(block).toContain('onReopen && (');
  });

  /* [FIX-20260824-CLAIMBOXWIDE] เจ้าของแจ้ง 24/08 (มีภาพประกอบ): ข้อความในกล่อง
     เหลืองตกลงไป **3 บรรทัด** สั่งว่า "ขยายกล่องเหลืองกว้าง ให้ text มันมีแค่สองบรรทัด"
     และ "ปุ่มตำแหน่งเดิมนั้นแหละ"
     ต้นเหตุ: กล่องถูกจำกัดที่ max-w-[16rem] (256px) ⇒ ประโยคที่สองตัดเป็น 2 ท่อน
     ⇒ ขยายเพดานความกว้าง · ปุ่มยังเป็น w-full ใต้ข้อความเหมือนเดิมทุกอย่าง */
  it('⭐⭐ (TARGET) กล่องเหลืองกว้างขึ้นจาก 16rem เพื่อให้ข้อความเหลือ 2 บรรทัด', () => {
    const block = overlay();
    expect(block).not.toContain('max-w-[16rem]');
    const m = block.match(/max-w-\[(\d+(?:\.\d+)?)rem\]/);
    expect(m, 'กล่องต้องยังมีเพดานความกว้าง ไม่ใช่ปล่อยเต็มจอ').not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(16);
  });

  it('⭐ (P4 PIN) ปุ่มยังอยู่ตำแหน่งเดิม — เต็มความกว้าง ใต้ข้อความ', () => {
    // เจ้าของสั่ง "ปุ่มตำแหน่งเดิมนั้นแหละ" — ขยายกล่องต้องไม่ย้าย/ย่อปุ่ม
    const block = overlay();
    /* [UI-20260826-CLAIMSAMEHEIGHT] **พลิกค่า ไม่ลบเคส** — เจ้าของสั่ง 26/08 ว่า
       "ความสูง overlay ตัวนี้ด้วยให้เท่ากันสิ" (เท่ากับกล่องบอทกำลังดูแล)
       ปุ่มเต็มความกว้างใต้ข้อความกินอีกแถว ~34px ⇒ ย้ายมาอยู่แถวเดียวกับข้อความ
       คำสั่งเดิม [FIX-20260824-CLAIMBOXWIDE] "ปุ่มตำแหน่งเดิม เต็มความกว้าง"
       ถูกแทนที่โดยคำสั่งนี้ · เคสยังทำหน้าที่เดิมคือกันไม่ให้ปุ่มย้ายโดยไม่ตั้งใจ */
    expect(block).toContain('shrink-0 bg-blue-600');
    expect(block).not.toContain('mt-1.5 w-full bg-blue-600');
    expect(block).toContain('rounded-full');
  });

  it('(P3 PIN) all three states still exist and still say what they said', () => {
    const block = overlay();
    expect(block).toContain('เคสนี้กำลังถือโดย');
    expect(block).toContain('รับเคสไว้เมื่อ');
    expect(block).toContain('{closedNotice}');
    expect(block).toContain('กดรับเคสเพื่อสนทนา');
  });
});
