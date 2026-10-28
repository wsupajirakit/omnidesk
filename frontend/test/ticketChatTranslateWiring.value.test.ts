/**
 * [FEAT-20260908-AITRANSLATE] the read side is wired to exactly one page, on
 * exactly one gate, and it fires from exactly one place.
 * ===========================================================================
 * Agent C left `ChatRoomView` inert: the chip, the picker and the two-layer
 * bubble all render only when a page passes `onTranslate`, and no page passed
 * it. This is the file that connects it — and these are the properties that
 * make connecting it safe.
 *
 * ⚠️ SOURCE-READING, like `chatTranslateOptional.value.test.ts` beside it, and
 * for the same stated reason: the guarantees here are about things NOT being
 * there (no second caller, no effect, no retry, no auto-fire) and about a page
 * of 5,300 lines whose full mount pulls a dozen services. A render test proves
 * what one screen did once; it cannot prove that no future edit added a call.
 * The BEHAVIOUR of the call itself is pinned for real, against a stubbed
 * transport, in `chatTranslateRequest.value.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ticketChatPageWithPieces } from './ticketChatSource';

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
/** comments stripped — the prose legitimately names what the code must not do */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// [REFACTOR-20261027-TCSPLIT] the page's markup moved into pages/chat/ticket-chat/ — read the
// page with those pieces (test/ticketChatSource.ts); assertions unchanged
const PAGE = codeOnly(ticketChatPageWithPieces());

describe('[AITRANSLATE] ⭐⭐⭐ only the ticket page can spend an AI call', () => {
  it('⭐⭐⭐ TicketChat is the ONLY page that passes onTranslate', () => {
    /* the counterpart of `chatTranslateOptional`, which proves the other three
       never mention it. Together they say: exactly one screen, no more. */
    expect(PAGE).toContain('onTranslate={');
    for (const other of ['pages/chat/Chat.tsx', 'pages/chat/Contact.tsx', 'pages/chat/TicketSupport.tsx']) {
      expect(codeOnly(src(other))).not.toContain('onTranslate');
    }
  });

  it('⭐⭐⭐ and only while THIS admin holds an OPEN case', () => {
    /* 🔴 Stricter than a UI nicety: every press is a billed call against a
       LIFETIME budget. An admin reading someone else's case, or a case nobody
       accepted, must not be able to spend one.
       ⚠️ `isAccepted` would be WRONG here — it is also true for a closed case
       (js===2). The reply gate documents that trap; this must not re-introduce
       it. Pinned as the same expression the reply chip uses. */
    expect(PAGE).toMatch(/onTranslate=\{\s*selectedJobStatus === 1 && isMyCase \?/);
    expect(PAGE).not.toMatch(/onTranslate=\{\s*isAccepted/);
  });

  it('⭐⭐⭐ passing `undefined` is how it is switched off — never CSS', () => {
    /* `ChatRoomView` gates on the prop with `&&`, so `undefined` means the chip
       is never RENDERED. Hiding a live control with a class leaves it in the
       tree, reachable, and still able to spend money. */
    expect(PAGE).toMatch(/onTranslate=\{[\s\S]{0,120}: undefined\s*\n?\s*\}/);
  });
});

describe('[AITRANSLATE] ⭐⭐⭐ nothing translates by itself, on this page either', () => {
  const HANDLER = (() => {
    const at = PAGE.indexOf('const handleBubbleTranslate');
    expect(at).toBeGreaterThan(-1);
    return PAGE.slice(at, PAGE.indexOf('// ====', at) >= 0 ? PAGE.indexOf('const ', at + 10) : at + 1200);
  })();

  it('⭐⭐⭐ the service is called from the handler and from NOWHERE else', () => {
    /* one call site. A second one inside a `useEffect` is how "opt-in" silently
       becomes "on every message the room happens to load". */
    expect(PAGE.split('aiTranslateService.translateMessage(').length - 1).toBe(1);
    expect(HANDLER).toContain('aiTranslateService.translateMessage(');
  });

  it('⭐⭐⭐ the handler is never invoked by this page — only handed over as a prop', () => {
    /* it must appear exactly twice: its declaration, and the prop. A third
       occurrence means somebody called it. */
    expect(PAGE.split('handleBubbleTranslate').length - 1).toBe(2);
    expect(PAGE).not.toMatch(/handleBubbleTranslate\s*\(/);
  });

  it('⭐⭐⭐ it sends the id, the target language, and only a source someone STATED', () => {
    /* Owner, 09/09: "เราไม่จำเป็นต้องเลือก src lang เพราะว่าเรารู้อยู่แล้ว
       และ ai ก็คิดได้อยู่แล้ว" — and 10/09: support choosing one, without showing
       a control for it yet.
       🔴 WHAT THIS STILL PROTECTS IS UNCHANGED: this page may not INVENT a
          source language. It hands on `target.from`, which nothing in the UI
          produces today, so every press the app can make still sends exactly
          `{to}` — undefined keeps the key off the body (`aiTranslateService`).
          What it must never contain is a literal, a locale, or a default. */
    expect(HANDLER).toContain('target.id');
    expect(HANDLER).toContain('target.lang');
    expect(HANDLER).toContain('target.from');
    /* no invented source: no quoted code, no `navigator.language`, no `'th'` */
    expect(HANDLER).not.toMatch(/from:\s*['"`]/);
    expect(HANDLER).not.toContain('navigator.language');
  });

  it("⭐⭐⭐ [SOURCEPIPE] the service keeps `from` off the wire unless it was given", () => {
    /* The pipe is only honest if absent really means absent — a `from: null` on
       the body would be this side stating "no language", which is a different
       claim from saying nothing. */
    const SVC = src('services/chat/aiTranslateService.ts');
    expect(SVC).toContain('JSON.stringify(from ? { to, from } : { to })');
    expect(SVC).toContain('JSON.stringify(from ? { text, to, from } : { text, to })');
  });

  it('⭐⭐⭐ the handler contains no retry and no timer', () => {
    for (const banned of ['setTimeout', 'setInterval', 'retry', 'while (']) {
      expect(HANDLER).not.toContain(banned);
    }
  });
});

describe('[AITRANSLATE] ⭐⭐ a failure is the server talking', () => {
  const HANDLER = PAGE.slice(PAGE.indexOf('const handleBubbleTranslate'), PAGE.indexOf('const handleBubbleTranslate') + 1400);
  const MODAL = /* [FIX-20260909-ONEPICKER] the wrapper is gone — one component now, and
       the wording lives in it. */
    src('components/chat/LanguagePicker.tsx');
  it("⭐⭐⭐ the server's own message is shown — no in-house substitute", () => {
    /* a 429 says how long to wait, a 502 says the OA has no usable key. Both
       are actionable; a generic "ลองใหม่อีกครั้ง" is not.
       🔴 [FIX-20260909-TRANSLATEBUSY] WHERE it is shown moved, and the rule did
       not. The handler used to catch and set a page-level alert; the picker is
       a modal now and it owns the wait, so it owns the failure too — it can
       name the language, say the timeout sentence and offer "ลองใหม่" on the
       same choice. A second alert behind the modal would report one failure
       twice, with one copy hidden under the other.
       So the assertion becomes: the handler RETHROWS, and the words still come
       from `translateErrorText` rather than from anything invented here. */
    expect(HANDLER).toContain('throw err;');
    expect(HANDLER).toContain('setTranslateAlert(translateErrorText(err))');
    expect(MODAL).toContain('translateErrorText(err)');
  });

  it('⭐⭐ it uses the page\'s AlertModal, never a raw alert()', () => {
    /* this page has a comment on record about why `alert()` was replaced; the
       new feature must not walk it back.
       ⚠️ Scoped to the translate handler, NOT to the whole file: there is ONE
       surviving raw `alert()` on this page (the "close someone else's case"
       guard) which predates this work by months. Asserting the file-wide
       property would fail on code this feature never touched, and "fixing" an
       unrelated line to make a new test green is how a small change grows a
       blast radius. Recorded as a pre-existing finding instead. */
    const at = PAGE.indexOf('isOpen={!!translateAlert}');
    expect(at).toBeGreaterThan(-1);
    expect(PAGE.slice(Math.max(0, at - 200), at)).toContain('<AlertModal');
    expect(HANDLER).not.toMatch(/\balert\(/);
  });

  it('⭐⭐ the alert has no retry affordance — closing it re-issues nothing', () => {
    const at = PAGE.indexOf('isOpen={!!translateAlert}');
    const block = PAGE.slice(at, PAGE.indexOf('/>', at));
    expect(block).toContain('onClose={() => setTranslateAlert(null)}');
    expect(block).not.toContain('translateMessage');
  });
});
