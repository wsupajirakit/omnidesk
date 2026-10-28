/**
 * ==== [FEAT-20260830-TRAYFULL] โหมดการแสดงแผงเครื่องมือในช่องแชท ====
 *
 * เจ้าของสั่ง 30/08/2026: เพิ่มปุ่ม icon ข้างปุ่ม `ตอบ | โน้ตในแชท` กดแล้วเปิด
 * modal ให้เลือกสองแบบ — **ค่าเริ่มต้น** หรือ **เปิดเต็มจอ** + toast ·
 * ถ้าเลือกเต็มจอ แผงทั้ง 3 (อิโมจิ · ข้อความตอบด่วน · สติกเกอร์) จะเปิดเต็มช่อง
 * แชทเสมอ · ถ้าค่าเริ่มต้น ทำงานเหมือนเดิมทุกอย่าง · **ทุกคนได้ค่าเริ่มต้นจนกว่า
 * จะตั้งเอง**
 *
 * ── ทำไมเก็บเป็นสตริง ไม่ใช่ boolean ────────────────────────────────────────
 * `true/false` อ่านไม่ออกว่าอะไรคืออะไรเมื่อเปิดดูค่าใน DB และถ้าวันหน้ามีโหมด
 * ที่สาม (เช่น "ครึ่งจอ") boolean จะขยายไม่ได้เลย ต้อง migrate ค่าเก่าทั้งหมด
 * สตริงที่อ่านออกทำให้เพิ่มโหมดใหม่เป็นการเติมค่าใน union เฉย ๆ
 *
 * ── ⚠️ ค่าที่เก็บไว้ไม่มีใครตรวจให้ ─────────────────────────────────────────
 * `usePreference` คืนค่าที่เก็บไว้ตรง ๆ โดยไม่ validate เลย ⇒ ค่าที่เพี้ยน
 * (พิมพ์ผิด · ชนิดผิด · ค่าเก่าจากเวอร์ชันก่อน) จะไหลเข้า UI ได้ทันที
 * `normalizeChatTrayMode` จึงเป็นด่านเดียวที่กัน และทุกทางที่ไม่รู้จัก
 * **คืนค่าเริ่มต้น** ไม่ใช่ค่าที่พังต่อไป
 *
 * revert: ลบไฟล์นี้ + จุดเรียกใน TicketChat.tsx
 */

/** path ใน preferences — ไม่ชนกับ `ui.chatMessageScale` ของงานขนาดตัวอักษร */
export const CHAT_TRAY_MODE_PATH = 'ui.chatTrayMode';

/** โหมดที่รองรับ — เพิ่มโหมดใหม่ = เติมที่นี่ที่เดียว */
export const CHAT_TRAY_MODES = ['default', 'full'] as const;

export type ChatTrayMode = (typeof CHAT_TRAY_MODES)[number];

/**
 * ค่าที่ทุกคนได้เมื่อยังไม่เคยตั้ง — เจ้าของย้ำว่า **default ต้องเป็นค่าเริ่มต้น**
 * และห้ามพังจนกว่าจะตั้งเอง
 */
export const CHAT_TRAY_MODE_DEFAULT: ChatTrayMode = 'default';

/**
 * บีบค่าที่อ่านมาให้เป็นโหมดที่ใช้ได้จริงเสมอ
 *
 * ครอบคลุมทุกทางที่ค่าเพี้ยนได้: ไม่เคยตั้ง · null · ชนิดผิด · สตริงที่ไม่รู้จัก ·
 * ตัวพิมพ์ใหญ่ · มีช่องว่างติดมา (ค่าที่เคยถูกกรอกด้วยมือใน DB)
 */
export function normalizeChatTrayMode(value: unknown): ChatTrayMode {
  if (typeof value !== 'string') return CHAT_TRAY_MODE_DEFAULT;
  const cleaned = value.trim().toLowerCase();
  return (CHAT_TRAY_MODES as readonly string[]).includes(cleaned)
    ? (cleaned as ChatTrayMode)
    : CHAT_TRAY_MODE_DEFAULT;
}

/** เปิดเต็มจอหรือไม่ — ให้ผู้เรียกไม่ต้องเทียบสตริงเองทุกที่ */
export function isChatTrayFull(value: unknown): boolean {
  return normalizeChatTrayMode(value) === 'full';
}

/**
 * [FIX-20260830-HALFTRAY] class of an OPEN tray panel — one behavior, any mode.
 *
 * The root decides how much screen the composer takes (half in default, all in
 * fullscreen); the tray simply FILLS the box it is given and scrolls inside.
 * The old per-mode caps (`max-h-40/48/[46vh]`, then `tc-tray-cap`) kept fighting
 * the fixed-scale sticker tray — every cap they chose was either inflated by the
 * scale or left the send row to overflow. Filling + `min-h-0` needs no number
 * at all: the shrink-0 rows take theirs first, the tray gets the rest.
 * (The `.tc-tray-cap` CSS rule in index.css is now unused; left for history.)
 */
export function chatTrayPanelClass(mode: unknown, base: string): string {
  void mode;
  const kept = base
    .replace(/\bmax-h-\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${kept} flex-1 min-h-0`;
}

/* [FIX-20260830-REALFULL] `CHAT_COMPOSER_FULL_MAX_H` and `chatComposerRootClass`
   were REMOVED here. The root's fullscreen sizing lives in
   `chatComposerAlwaysCappedClass` (flex-[999_1_0%] against the stream's flex-1)
   and the inner box in `chatComposerBoxClass` — a ceiling-based fullscreen
   (`max-h-full` + `flex-1`) could only ever reach a 50/50 split with the
   stream, which is the owner's "เต็มจอก็ไม่เต็ม" screenshot. Keeping the dead
   helper exported kept old tests green against code no page used. */

/**
 * class of a composer row that must stay fully visible — the textarea + send
 * row, and the character counter under it.
 *
 * `shrink-0` is the whole point: once the tray is `flex-1`, every sibling
 * without it is a candidate for being shrunk to nothing, and the owner's bug
 * was exactly that — the textarea clipped at the bottom edge.
 */
/**
 * [FIX-20260830-REALFULL] class of the INNER composer box (grip + toolbar +
 * trays + textarea + counter all live inside it — the root's only in-flow
 * child, TicketChat ~5675).
 *
 * The one truth this helper encodes: the box FILLS the root exactly when the
 * root itself is in its fullscreen state (full mode AND a tray open). Earlier
 * rounds put `flex-1` on the ROOT but left this box auto-height, so the tray's
 * own `flex-1` measured against an unbounded parent and "เต็มจอ" stopped one
 * level down — the root grew, the box inside it did not.
 *
 * Every other state returns `min-h-0` so the box can be squeezed under the
 * root's 55vh ceiling instead of overflowing it (the send row used to be what
 * fell off the bottom edge).
 */
export function chatComposerBoxClass(
  mode: unknown,
  trayOpen: boolean,
  base: string,
): string {
  /* [FIX-20260830-HALFTRAY] mode-agnostic now: default-with-tray is a half
     screen root, fullscreen a whole one — either way this box is its filler. */
  if (trayOpen) return `${base} flex-1 min-h-0`;
  return `${base} min-h-0`;
}

export function chatComposerFixedRowClass(mode: unknown, base: string): string {
  /* [FIX-20260830-TRAYCAPSCALE] `shrink-0` is no longer gated on `full` mode.
     It was added for the fullscreen tray, but the squeeze it prevents is not
     unique to fullscreen: [FIX-20260830-SCALELOCK] made the composer a bounded
     `flex flex-col` in EVERY mode, so in default mode too the toolbar, the
     textarea row and the counter are flex children competing with the tray for a
     capped height — and without `shrink-0` they are the ones that give way. That
     is the second half of the owner's "โหมดไม่เต็มจอ" screenshot: the textarea
     crushed to a sliver with its placeholder clipped.
     `tc-tray-cap` bounds how much the tray may ASK for; this makes the rows that
     must stay visible refuse to give it up. Both are needed: a cap alone still
     lets a long tray squeeze the rows, and `shrink-0` alone would push the tray's
     overflow past the composer instead of scrolling it. */
  return `${base} shrink-0`;
}

/**
 * ==== [FIX-20260830-SCALELOCK] a large font scale erased the message stream ====
 *
 * Owner report 30/08, two symptoms with one cause:
 *   1. at a LARGE chat font scale the message stream disappeared entirely;
 *   2. the sticker tray could no longer be scrolled — it ran off the bottom.
 *
 * ── the real cause ─────────────────────────────────────────────────────────
 * [FIX-20260830-TRAYBOTTOM] above capped the composer, but ONLY in `full` mode
 * (`chatComposerRootClass` returns `base` untouched for every other mode). In
 * the DEFAULT mode — which is what everyone gets until they opt in — the
 * composer root kept `shrink-0` with height:auto and no ceiling whatsoever:
 *
 *   .tc-col-center     flex flex-col, bounded by the page          ✅
 *   .tc-chat-history   `flex-1 min-h-0`  → absorbs what is LEFT    🔴 gets 0
 *   ChatInputBox root  `shrink-0`, height:auto, NO cap             🔴 unbounded
 *
 * `--tc-chat-scale` multiplies everything inside the composer (index.css:762+:
 * every `text-*` rule, `svg { width: calc(1em * var(--tc-chat-scale)) }`, and
 * the tray caps `.max-h-40` / `.max-h-48` at index.css:791-792, which grow to
 * `calc(10rem * scale)`). So at a large scale the composer's natural height
 * inflates; `shrink-0` means it refuses to give any of it back; and since it is
 * a sibling of `.tc-chat-history` in the same flex column, everything it takes
 * comes straight out of the stream — which collapses to zero and vanishes.
 * The same overflow is why the tray cannot scroll: its `overflow-y-auto` needs
 * a BOUNDED height to scroll within, and an unbounded ancestor never gives it
 * one, so the tray simply extends past the viewport instead.
 *
 * ── the fix ────────────────────────────────────────────────────────────────
 * Put the ceiling on the composer root at EVERY mode and EVERY scale, so
 * `.tc-chat-history` always keeps the remainder and the tray always resolves
 * against a real height. `vh` is deliberate: it is measured against the
 * viewport, so it does NOT participate in the `--tc-chat-scale` multiplication
 * and the ceiling therefore holds identically at scale 1 and at scale 2.
 *
 * This is additive to [FIX-20260830-TRAYBOTTOM], not a replacement: `full` mode
 * still gets its own taller ceiling, because a fullscreen tray is the one case
 * where the user has explicitly asked for the composer to dominate.
 *
 * revert: drop this constant + `chatComposerAlwaysCappedClass`, and restore the
 *         plain `chatComposerRootClass(...)` call at TicketChat.tsx:5295
 */

/**
 * Ceiling for the composer in EVERY mode, including `default`.
 *
 * Deliberately SHORTER than `CHAT_COMPOSER_FULL_MAX_H` (the whole column). That value is
 * correct for `full`, where the user opted into a tray-dominated composer and
 * accepts a small stream. As an always-on ceiling it is too generous: at a
 * large scale a default-mode composer would legitimately fill 70vh and leave
 * the stream a 30vh sliver — technically visible, but not what the owner asked
 * for. 55vh keeps the message stream the majority partner at every scale while
 * still leaving the default trays (`max-h-40` / `max-h-48`, i.e. 10-12rem
 * scaled) room to open fully at ordinary scales.
 */
export const CHAT_COMPOSER_MAX_H = 'max-h-[55vh]';

/**
 * The composer root's classes, with a ceiling that is NOT conditional on mode.
 *
 * Layered on top of `chatComposerRootClass` rather than folded into it, because
 * that helper's mode-gated contract is pinned by
 * `chatComposerTrayBottom.value.test.ts` ("default mode is byte-for-byte
 * untouched") — a contract worth keeping, since it is what guarantees the
 * fullscreen feature cannot regress anyone who never opted in.
 *
 * `flex flex-col min-h-0` comes along unconditionally too: a `max-height` on a
 * box whose children cannot shrink only clips them. The children need a flex
 * column that is allowed to shrink for the ceiling to actually bound the tray
 * instead of hiding its bottom half.
 *
 * [FIX-20260830-TRUEFULLSCREEN] the 55vh always-on ceiling must NEVER reach
 * `full` mode. Two `max-h-*` classes on one element resolve by Tailwind's own
 * emission order, which is unpredictable — and here it would decide whether
 * "เปิดเต็มจอ" means the whole column or 55% of the viewport. So `full` is
 * short-circuited to `chatComposerRootClass`, whose single ceiling
 * (`CHAT_COMPOSER_FULL_MAX_H`) is the only one emitted. Exactly one ceiling per
 * element, in every mode; `chatScaleLock.value.test.ts` pins the count.
 *
 * The 55vh ceiling keeps its original job unchanged: in DEFAULT mode it stops a
 * large `--tc-chat-scale` from inflating the composer until the stream vanishes.
 * That case is untouched by this fix — only `full` opts out, because `full` is
 * now defined as the composer taking everything.
 */
export function chatComposerAlwaysCappedClass(
  mode: unknown,
  base: string,
  trayOpen: boolean,
  /* [FIX-20260830-TRAYDRAG] true once the grip has been dragged while a
     default-mode tray is open: the root then takes a PIXEL height (the caller
     supplies it via style) instead of the half-column flex-1, so the whole
     composer — tray included — flows with the drag. Optional so every existing
     3-arg call keeps its exact behaviour. */
  dragOverride = false,
): string {
  /* [FIX-20260830-REALFULL] two corrections learned from the owner's screenshots
     (both invisible to jsdom, which computes no layout):
     1. FULLSCREEN WAS A 50/50 SPLIT, NEVER FULL. The old full branch emitted
        `flex-1` — but the message stream (`tc-chat-history`, TicketChat ~4078)
        is ALSO `flex-1 min-h-0`. Two flex-1 siblings with 0% basis divide the
        column EQUALLY, so "เปิดเต็มจอ" could only ever reach half the screen.
        `flex-[999_1_0%]` wins that race ~999:1 — the stream collapses to a few
        px, which is the owner's stated intent ("สตรีมแชทหายไปเลย") — and no
        parent outside the composer is touched.
     2. EXPANSION NOW REQUIRES AN OPEN TRAY. The mode is a stored preference;
        keying growth on the mode alone inflated the composer while NOTHING was
        open. With no tray open a full-mode user gets the same compact composer
        as everyone else. */
  if (isChatTrayFull(mode) && trayOpen) {
    return `${base} flex-[999_1_0%] flex flex-col min-h-0`;
  }
  /* [FIX-20260830-HALFTRAY] owner: default mode with a tray open shows HALF the
     screen. `flex-1` against the stream's own `flex-1` (both basis 0%) is an
     exact 50/50 by flexbox arithmetic — no vh guesswork, no cap that a font
     scale could inflate, and it degrades with the column, not the viewport. */
  if (trayOpen) {
    /* [FIX-20260830-SENDFLOOR rev2] `min-h-fit` was tried here and REVERTED:
       fit-content counts the tray's INTRINSIC height — the whole sticker grid —
       so the half-column rule inflated to full screen the moment the tray
       opened (owner: "ค่าเริ่มต้น tray ขึ้นเต็มจอ มันผิด"). `min-h-0` is
       correct; the send-button floor lives in the COMPUTED drag clamp
       (TicketChat onGripMove: chrome + live input + 24), not in CSS. */
    if (dragOverride) return `${base} shrink-0 flex flex-col min-h-0`;
    return `${base} flex-1 flex flex-col min-h-0`;
  }
  /* [FIX-20260830-FULLNOSHRINK] `shrink-0` is added HERE, on the non-full paths
     only, instead of being typed into the caller's base string.
     The old arrangement put it in the base, so it reached the element in every
     mode and `full` had to strip it back out — which meant the string that
     actually reached the DOM depended on a removal happening downstream of the
     place a reader sees the class written. Adding it on exactly the branches
     that want it makes `shrink-0` and `flex-1` mutually exclusive by
     construction: this branch emits `shrink-0` and never `flex-1`; the `full`
     branch above emits `flex-1` and never `shrink-0`. Neither outcome depends
     on Tailwind's emission order. */
  return `${base} shrink-0 flex flex-col min-h-0 ${CHAT_COMPOSER_MAX_H}`;
}
