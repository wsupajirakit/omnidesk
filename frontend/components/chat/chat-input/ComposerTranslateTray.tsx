import React, { useEffect } from 'react';
import { Languages, X, AlertTriangle } from 'lucide-react';

import { useI18n } from '../../../i18n';
import { langName } from '../langName';
import { TranslateLoadingDots } from '../TranslateLoadingDots';

/**
 * [FEAT-20260908-AITRANSLATE] the composer's preview strip — and it NEVER sends.
 * ===========================================================================
 * Owner, 09/09: *"แปลใน input box chat ต้องไม่ส่งทันที แอดมินจะกดส่งเอง (ปุ่มเดิม)
 * แปลเสร็จแล้วแค่พรีวิวคำแปลคู่กับคำต้นฉบับ"*
 *
 *   ┌─ composer preview ──────────────────────┐
 *   │  รอสักครู่นะคะ         ← ต้นฉบับ · แก้ได้ที่นี่ │
 *   │  ─────────────────────────────────────  │
 *   │  Please wait a moment    ← คำแปล        │
 *   │  → en                             [ ➤ ] │ ← ปุ่มส่งอยู่แถวภาษาปลายทาง
 *   │  กด ➤ เพื่อส่งคำแปลนี้                    │
 *   └─────────────────────────────────────────┘
 *   (ช่องพิมพ์ล่างถูกซ่อนอยู่ — กล่องนี้คือช่องพิมพ์)
 *
 * 🔴 THIS FILE CONTAINS NO SEND PATH AND NO SERVICE CALL. Not "send after
 * translate", not "auto-send if the admin does nothing". Pressing translate and
 * closing the browser sends nothing and stores nothing.
 * แปล = พรีวิว · ส่ง = ปุ่มเดิม · คนละการกดกันคนละเรื่อง.
 *
 * ⚠️ [FIX-20260910-TRANSLATEONEBOX] THE SEND BUTTON NOW RENDERS INSIDE THIS
 *    STRIP, AND THAT DOES NOT CHANGE THE SENTENCE ABOVE. It arrives as
 *    `sendSlot` — a finished node built by `ChatInputBox` from the same
 *    `ComposerSendButton` the typing row uses. This file neither builds it nor
 *    calls it; Enter is a newline here, not a send. The button MOVED because
 *    the row it lived in is hidden while a preview is staged, so leaving it
 *    down there would have left the admin with nothing to press.
 *
 * ── WHY IT MIRRORS `TranslatedBubble` BUT DOES NOT IMPORT IT ────────────────
 * The pairing is deliberately the same shape the bubble uses, so what the admin
 * reviews looks like what will exist afterwards. It is NOT the same component:
 * `TranslatedBubble` is Agent C's finished, snapshot-pinned file whose markup is
 * asserted byte-for-byte by `chatBubbleCharacterization.dom.test.tsx`, and it
 * renders read-only text inside a chat bubble's colours. This one lives on a
 * white composer strip and its lower half must be EDITABLE. Reusing it would
 * mean widening it with an `editable` branch — reopening finished work to serve
 * a second caller, which is exactly what this round was told not to do.
 *
 * ── WHY THE TARGET LABEL HAS NO ARROW ───────────────────────────────────────
 * Owner, 09/09: the admin never states a source language, so there is no `from`
 * to put on the left of one. Printing "auto → en" or "th → en" would be
 * inventing a fact. The honest reading of a preview is "this is the English
 * version", so the target is shown alone. Same rule C's bubble already applies
 * when `from` is null. อย่าเดาภาษาต้นทาง.
 *
 * revert: delete this file, its line in ./index.ts, and the `<ComposerTranslateTray>`
 *   block plus the five `translate*` states in ./ChatInputBox.tsx.
 */

export interface ComposerTranslatePreview {
  /** the draft EXACTLY as it was when translate was pressed — not the live draft */
  source: string;
  /** the translation, which the admin may edit before sending */
  text: string;
  /** the language code the admin picked */
  to: string;
  /** what the model detected, IF the BE echoed it. Never guessed here. */
  from: string | null;
}

interface Props {
  /** null = nothing to show, and the strip does not exist at all */
  preview: ComposerTranslatePreview | null;
  /**
   * [FIX-20260910-TRANSLATEONEBOX] the composer's draft — this strip owns the
   * only typing field on screen while a preview is staged.
   */
  draft: string;
  onEditDraft: (next: string) => void;
  /** the composer's dragged height, so the box does not jump on the swap */
  sourceStyle: { height: number } | undefined;
  /**
   * The composer's OWN send button, built by `ChatInputBox` and handed over
   * whole. This file still contains no send path — it renders a node.
   */
  sendSlot: React.ReactNode;
  /**
   * [FIX-20260909-KEEPPREVIEW] true when `preview` is NO LONGER what the send
   * button will send — the draft has been edited since it was translated. The
   * strip stays, says so, and goes read-only; the send delivers the original.
   */
  stale: boolean;
  /** a press is in flight — the strip shows it rather than looking dead for ~2s */
  pending: boolean;
  /** the server's own sentence, verbatim. Never reworded on this side. */
  error: string | null;
  /** true when that error was a 429 — changes the wording, not the message */
  rateLimited: boolean;
  /** the admin edited the translation directly */
  onEditText: (next: string) => void;
  /** throw the preview away and send the original instead */
  onDiscard: () => void;
  /** acknowledge the error; also what re-enables the translate button after a 429 */
  onDismissError: () => void;
}

export const ComposerTranslateTray: React.FC<Props> = ({
  preview, draft, onEditDraft, sourceStyle, sendSlot,
  stale, pending, error, rateLimited, onEditText, onDiscard, onDismissError,
}) => {
  const { t } = useI18n();
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => {
      onDismissError();
    }, 30000);
    return () => clearTimeout(timer);
  }, [error, onDismissError]);

  /* Nothing staged, nothing pending, nothing wrong ⇒ render NOTHING. Not an
     empty strip, not a placeholder. A composer nobody translated is the
     composer that shipped, and this component must be invisible in it. */
  if (!preview && !pending && !error) return null;

  return (
    <div className="border-b border-gray-100 bg-white px-3 py-2">
      {/* ── the error line ────────────────────────────────────────────────
          🔴 `{error}` is printed RAW, on purpose. §4C: "Show that message
          as-is; do not invent a friendlier one that hides how long to wait."
          The BE's 429 says how many presses are left and when the window turns
          over; a hardcoded "ลองใหม่ภายหลัง" throws that away and the admin
          presses again immediately — the exact behaviour the limit exists to
          stop. There is no string-building here and there must not be. */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl p-3 text-xs shadow-sm border bg-rose-50 border-rose-200 text-rose-900 animate-in fade-in duration-200"
        >
          <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-rose-100 text-rose-600 shrink-0 mt-0.5">
            <AlertTriangle size={14} />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="font-semibold text-rose-800 leading-snug">
              {t(
                'chat_input.auto_send_error_msg',
                'ตรวจสอบ AI แปลภาษาอีกครั้ง หากต้องการส่งข้อความทันที (ในระหว่างแก้ไข AI) ให้ทำการปิดการแปลออโต้ และส่งข้อความด้วยวิธีการปกติ (เช่น ใช้ google translate ช่วยแปล)',
              )}
            </div>
            {error && (
              <div className="text-[11px] text-rose-600/90 font-mono break-all" data-testid="translate-error">
                {error}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss translation error"
            className="shrink-0 p-1 text-rose-400 hover:text-rose-700 rounded-md hover:bg-rose-100 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── the pending line ─────────────────────────────────────────────
          The AI call is ~2s (FE note §6).
          [FEAT-20260918-PHASE3] Ball effect loading animate (purple, cyan, deep indigo) + กำลังแปลภาษา */}
      {pending && !preview && (
        <div className="flex items-center gap-2 py-1.5 text-[11px] font-bold text-slate-600 animate-in fade-in duration-150">
          <TranslateLoadingDots size="sm" />
          <span>{t('chat_input.translating_draft', 'กำลังแปลภาษา...')}</span>
        </div>
      )}

      {preview && (
        /* [FIX-20260909-TRAYNEST] NO FRAME OF ITS OWN. This used to draw
           `rounded-lg border border-sky-200 bg-sky-50/40` — a card inside the
           composer's own white strip, so the preview read as a second box
           stacked on the first. Owner, 09/09: "มันซ้อน กล่องไม่ได้ ต้องเข้ากล่องเดิม".
           It keeps only the divider between original and translation, which is
           the part that carries meaning. */
        <div className="relative px-0.5 py-1">
          {/* [FIX-20260909-DISCARDBTN] a labelled button, not a 12px ✕ — owner,
              09/09: "ปุ่มปิดแปล ทำ border + ใส่ข้อความด้วย … ปัจจุบันมีแค่กากบาท
              เล็กเกินไป". It is the only way to send the ORIGINAL instead of the
              translation, so it has to be findable; a bare glyph in a corner is
              a guess about what it discards. */}
          <button
            type="button"
            onClick={onDiscard}
            title={t('chat.translate_discard')}
            aria-label={t('chat.translate_discard')}
            className="absolute top-1 right-1 inline-flex items-center gap-1 rounded-md
              border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-500
              transition-colors hover:border-red-300 hover:text-red-600"
          >
            <X size={12} /> {t('chat.translate_discard')}
          </button>

          {/* [FIX-20260910-TRANSLATEONEBOX] +40% (10px → 14px) — owner, 10/09.
              It names the target language, which is the one fact the admin
              cannot get from anywhere else on this strip, and it was the
              smallest text in the box. */}
          <div className="flex items-center gap-1.5 text-[14px] font-bold text-sky-700/80">
            {/* [FIX-20260909-TRAYLABEL] The heading names the LANGUAGE now, and
                drops "ยังไม่ได้ส่ง" — owner, 09/09. The line below already says
                what to press to send, so the warning was said twice while the
                one fact the admin actually needs (which language is staged) was
                not said at all. */}
            <Languages size={15} /> {t('ticketui.composer.translate_preview', 'พรีวิวคำแปล')} · {langName(preview.to, t)}
          </div>

          {/* [FIX-20260909-KEEPPREVIEW] the one line that makes keeping a stale
              preview safe. Without it the strip would still read "press ➤ to
              send this translation" while ➤ was about to send something else —
              which is the record-integrity failure the old delete-on-keystroke
              was protecting against. Said out loud, the strip is honest and the
              translation survives. */}
          {stale && (
            <div
              role="status"
              data-testid="translate-stale"
              className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1
                text-[11px] leading-relaxed text-amber-800"
            >
              <AlertTriangle size={12} className="mt-[2px] shrink-0" />
              <span>{t('chat.translate_stale')}</span>
            </div>
          )}

          {/* [FIX-20260910-TRANSLATEONEBOX] 🔴 THIS IS THE COMPOSER NOW.
              While a translation is staged the typing row below is hidden, so
              this field is not a copy of the draft — it IS the draft, the same
              `draft` state the send reads. Owner, 10/09: *"ปิดช่องล่างไปเลย
              เวลาแปลแล้ว เปิดใช้ช่องบนแทน เวลาแก้ไข งงไหม"*.
              🔴 It was briefly a read-only snapshot of `preview.source`, which
                 was the honest shape while BOTH boxes were on screen — a
                 snapshot you can edit is a lie. With one box left the question
                 changes: the admin has to be able to type somewhere, and the
                 stale rule below already says out loud when what they typed no
                 longer matches the translation.
              ⚠️ ENTER DOES NOT SEND HERE, unlike the composer's own textarea.
                 A staged translation exists to be reviewed; ➤ is a deliberate
                 press and Enter is a newline. Nothing in this file calls send —
                 the button arrives as `sendSlot`, already built.
              ⚠️ It carries the composer's dragged height (`sourceStyle`) so the
                 box does not jump when the row below disappears. */}
          <textarea
            value={draft}
            onChange={(e) => onEditDraft(e.target.value)}
            rows={2}
            style={sourceStyle}
            placeholder={t('ticketui.composer.source_ph', 'แก้ข้อความต้นฉบับ แล้วกดแปลอีกครั้ง')}
            aria-label={t('ticketui.composer.source_aria', 'ต้นฉบับ — แก้แล้วกดแปลอีกครั้ง')}
            data-testid="translate-source"
            className="mt-1 w-full resize-none rounded-md border border-gray-200 bg-white px-2 py-1.5
              text-[13px] leading-relaxed text-gray-700 outline-none custom-scrollbar
              focus:border-sky-300 focus:ring-1 focus:ring-sky-200"
          />

          <div className="border-t border-gray-200 my-1.5" />

          {/* 🔴 EDITABLE, because the owner said so: "แอดมินอาจแก้คำแปลเอง".
              This is a plain textarea over local state — it fires no request on
              change (that is what M19 pins) and it is what the send button will
              actually send, so an edit here is not decoration.
              ⚠️ …unless it is STALE, when the send is sending the original and
                 editing this would be editing something nobody will ever read.

              [FIX-20260910-TRANSLATEGRADIENT] THE GRADIENT IS THE ANSWER TO
              "WHICH OF THESE TWO IS THE MESSAGE?". Owner, 10/09, with a
              reference picture. Both boxes held plain text on a plain strip, so
              the draft and the translation read as two paragraphs of equal
              weight — and the one that reaches the customer is the lower one.
              Colour says it without a word: white on violet→cyan is the message,
              plain white box above is the working copy.
              🔴 THE SAME FOUR-COLOUR FAMILY AS THE LOADING BALLS (violet →
                 indigo → sky). One feature, one palette; a second unrelated
                 gradient would just be decoration that drifts.
              ⚠️ PALE ON PURPOSE — owner, 10/09: *"สีอ่อนกว่านี้ เข้มไป -70%
                 ทุกเฉด"*. The first cut was 600/500/400 with white text, which
                 turned a composer row into the loudest thing on the page and
                 fought the chat behind it. At 200/200/100 the text goes back to
                 near-black, so the TRANSLATION is what you read and the colour
                 is only the tag saying which of the two boxes is the message.
                 The badge stays one step darker (300) because it sits ON this
                 box — the same shade twice would erase the seam the white ring
                 exists to draw.
              ⚠️ STALE DESATURATES TO GREY. It is not "prettier when off" — the
                 whole point of the colour is "this is what goes out", and while
                 the draft has moved on that is exactly what it is NOT. The
                 wording says it, the colour must not contradict it.
              ⚠️ `rounded-md` and the same padding as the source field above, per
                 the owner: same corner radius as the original box. */}
          <div className="relative mt-3">
            {/* [FIX-20260910-LANGBADGE] the language rides ON the box it labels.
                🔴 Owner, 10/09: *"badge ติดหัวเลยว่าภาษาจีน (นี่คือภาษาที่แปล)
                   … จีนข้างล่างไม่ต้องมีแล้ว"*. The name used to sit on its own
                   line UNDER the translation, which put a label after the thing
                   it labels and left it competing with the hint lines. Pinned to
                   the box's top edge it can only mean one thing: this coloured
                   box is that language.
                ⚠️ `from → to` when the model reported a source, exactly as the
                   old line did — the badge replaced its POSITION, not its rule.
                   The FE still never invents a source language.
                ⚠️ `ring-2 ring-white` is what makes it read as "attached to" the
                   card instead of "floating over" it: the ring cuts the box's
                   own edge behind the badge. */}
            <span
              data-testid="translate-lang-badge"
              className={`absolute -top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1
                text-[13px] font-bold shadow-md ring-2 ring-white dark:ring-slate-800 bg-gradient-to-r ${
                  stale
                    ? 'from-slate-200 to-slate-200 text-slate-500 dark:from-slate-600 dark:to-slate-600 dark:text-slate-300'
                    : 'from-violet-300 to-sky-300 text-violet-950 dark:from-violet-700 dark:to-sky-700 dark:text-slate-50'
                }`}
            >
              <Languages size={14} />
              {preview.from
                ? `${langName(preview.from, t)} → ${langName(preview.to, t)}`
                : langName(preview.to, t)}
            </span>
            <textarea
              value={preview.text}
              onChange={(e) => onEditText(e.target.value)}
              readOnly={stale}
              rows={2}
              aria-label={t('ticketui.composer.preview_aria', 'คำแปลที่จะส่ง')}
              data-testid="translate-preview-text"
              className={`w-full resize-none rounded-xl px-3.5 pt-5 pb-3 text-[15px] font-semibold
                leading-relaxed outline-none shadow-md custom-scrollbar bg-gradient-to-r ${
                  stale
                    ? 'from-slate-200 via-slate-100 to-slate-100 text-slate-400 placeholder:text-slate-300 dark:from-slate-700 dark:via-slate-700 dark:to-slate-700 dark:text-slate-400'
                    : 'from-violet-200 via-indigo-200 to-sky-100 text-slate-800 placeholder:text-slate-500 dark:from-violet-900/60 dark:via-indigo-900/60 dark:to-sky-900/50 dark:text-slate-100 dark:placeholder:text-slate-400'
                }`}
            />
          </div>


          {/* said plainly, because the whole risk of this feature is an admin
              believing a preview already went out. When stale the banner above
              has already said what ➤ does, so this line would contradict it. */}
          {/* said plainly, because the whole risk of this feature is an admin
              believing a preview already went out. The wording follows the
              staleness, since ➤ does two different things in the two states.

              [FIX-20260910-HINTSPLIT] TWO LINES, TWO WEIGHTS — owner, 10/09.
              🔴 It was one grey 11px run with a `·` in the middle, so "what ➤
                 does" and "what else you may do" carried the same weight and the
                 first one — the only line that says what the blue button will
                 actually send — was the easiest to skip. The action line now
                 takes the language label's blue so the eye ties ➤ to the
                 language it is about to send; the alternatives stay grey and
                 stay small, because they are alternatives. */}
          {/* [FIX-20260910-LANGBADGE] ➤ now sits beside the line that says what it
              does, because the line it used to share (`→ จีนตัวเต็ม`) has become
              the badge on the box above. Same association, one row further down:
              read the coloured box, read what ➤ will do with it, press it. */}
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              {/* [FIX-20260910-DARKHINT] `sky-700` is a light-theme colour; on the
                  dark composer it came out as a hard saturated blue shouting from
                  a muted panel. Owner, 10/09: as pale as a panel card's title.
                  Same hue, two steps lighter — the tie to the badge survives. */}
              <div className="text-[12px] font-bold leading-relaxed text-sky-700/80 dark:text-sky-300/90">
                {stale ? t('ticketui.composer.press_send_source', 'กด ➤ เพื่อส่งข้อความต้นฉบับ') : t('ticketui.composer.press_send_translation', 'กด ➤ เพื่อส่งคำแปลนี้')}
              </div>
              <div className="text-[11px] leading-relaxed text-gray-400">
                {stale
                  ? t('ticketui.composer.stale_hint', 'แก้ข้อความแล้วกดแปลอีกครั้งได้ หรือปิดคำแปลเพื่อส่งต้นฉบับ')
                  : t('ticketui.composer.edit_hint', 'สามารถแก้ไขและแปลใหม่ หรือ ปิดเพื่อส่งต้นฉบับแทน')}
              </div>
            </div>
            {sendSlot}
          </div>
        </div>
      )}
    </div>
  );
};
