import { Mail, Send, Languages } from 'lucide-react';

import { useI18n } from '../../i18n';
import { langName } from './langName';

/**
 * [FEAT-20260908-AITRANSLATE] the two-layer body: one bubble, two languages.
 * ===========================================================================
 * Owner's picture, and the whole of the design:
 *
 *   ┌─────────────────────────────────────┐
 *   │  I want to withdraw money           │ ← original · smaller · muted
 *   │  ─────────────────────────────────  │ ← a thin divider INSIDE the bubble
 *   │  ฉันต้องการถอนเงิน                    │ ← translation · larger · full contrast
 *   │                          en → th    │ ← the pair, read straight off the row
 *   └─────────────────────────────────────┘
 *
 * 🔴 ONE bubble, ONE border, ONE background — never two cards with a gap. The
 * border and the background belong to the bubble div in `ChatRoomView.tsx`;
 * this renders only what goes INSIDE it, so a translated message keeps the
 * exact same shape, colour and side as an untranslated one. การแปลเปลี่ยน
 * "เนื้อใน" ของบับเบิล ไม่เคยเปลี่ยนฝั่งหรือสีของมัน.
 *
 * 🔴 PRESENTATIONAL ONLY. It fetches nothing, imports no service and holds no
 * state, which is what makes it snapshot-testable with no mocks — and what keeps
 * `ChatRoomView` free of any network call (`test/contactChatTab.dom.test.tsx`
 * asserts that the read-only Contact page can never send).
 *
 * WHICH TEXT IS ON TOP — one rule, still no branch on `sender_type`:
 *   **the bottom line is always the one the reader needs**, because it is the
 *   larger, full-contrast one.
 *
 *     customer's message  top = what they wrote · bottom = the translation
 *                               the admin can read
 *     admin's message     top = what the admin typed · bottom = what the
 *                               customer actually received
 *
 * [FIX-20260910-WIREICON] and the line that CROSSED THE WIRE carries a mark:
 *   ✉ before a customer's message (it arrived) · ➤ after an admin's (it was
 *   sent). Both are the same field — `content` — so the mark is one rule, not
 *   two decorations.
 *
 * 🔴 [FIX-20260910-OUTBOUNDORDER] the admin side used to be the other way up —
 *    `content` on top in every case — so an outbound bubble led with the
 *    language the admin cannot read and buried the sentence they wrote
 *    (owner, 10/09: *"ฝั่งแอดมินให้สลับตำแหน่งกัน บนลงมาล่าง"*). Inbound is
 *    untouched, to the byte.
 *
 * ⚠️ THE DIRECTION IS DERIVED, NOT PASSED. `to` is null on an outbound entry and
 *    never null on an inbound one — the BE says so in its own words
 *    (`translation-store.ts`: *"`to` is null ALWAYS"* for the admin builder,
 *    while the pushable inbound type makes the target a compile-time
 *    requirement). Taking a `sender_type` prop would put a second answer to a
 *    question the data already answers, and this file would then have two ways
 *    to be wrong instead of one.
 *   บนคือสิ่งที่คนอ่านรู้อยู่แล้ว · ล่างคือสิ่งที่ต้องอ่านจริง ๆ.
 *
 * revert: delete this file and the `activeTranslation(...)` branch that renders
 * it in `ChatRoomView.tsx`. The bubble falls back to bare `{msg.content}`.
 */

/**
 * One entry of `ChatMessage.translations` — the same shape the BE stores, and
 * deliberately no more than the bubble renders.
 *
 * ⚠️ There is no `direction` field and there must not be one: it is derivable
 * (`lang === to` ⇒ translated after the fact, `lang === from` ⇒ translated
 * before sending) and carrying it would be a second source of truth for
 * something `from`/`to` already say.
 */
export interface MessageTranslation {
  /** the language of `text` */
  lang: string;
  /** the translation itself */
  text: string;
  /** ┐ what the model was asked to do — rendered verbatim as "th → en" */
  from: string | null;
  /** ┘ */
  to: string;
}

/**
 * Which of a message's translations the bubble shows: **the last one**.
 *
 * WHY THE LAST, and not a lookup against a "currently selected language": the
 * admin presses the chip and picks a language, the BE appends the result, and
 * the thing they just asked for is the thing they expect to see. Keeping a
 * per-message "active language" in `ChatRoomView` would be new state that says
 * exactly what the array's own order already says. เลือกอันล่าสุด = อันที่เพิ่งกดขอ.
 *
 * ⚠️ Returns null for an empty/absent array AND for an entry with no text, so a
 * legacy row — every row in the database today — takes the untranslated path
 * and renders byte-identically. That is the guarantee
 * `test/chatBubbleCharacterization.dom.test.tsx` pins.
 */
export const activeTranslation = (
  translations?: MessageTranslation[] | null,
): MessageTranslation | null => {
  if (!Array.isArray(translations) || translations.length === 0) return null;
  const last = translations[translations.length - 1];
  if (!last || typeof last.text !== 'string' || last.text.trim() === '') return null;
  return last;
};

interface Props {
  /** what the customer saw — `msg.content`, verbatim */
  original: string;
  /** the entry to show, already chosen by `activeTranslation` */
  translation: MessageTranslation;
  /**
   * [FEAT-20260918-ROOMTRANS] Show the original text alongside the translation.
   *
   * 🔴 DEFAULTS TO FALSE, and the doc used to claim `true` while the code said
   * `false` — a contradiction that hid a real behaviour change: before 18/09 the
   * bubble ALWAYS carried both halves, and a ⭐⭐⭐ case pinned that. It is now the
   * room's `show_original_text`, which the schema defaults to `false`
   * ("seamless"), so an unconfigured room shows the translation alone.
   *
   * `ChatRoomView` always passes the room's real value; this default only
   * decides what a caller that says nothing gets, and "nothing" should mean the
   * same as a fresh room. ค่าเริ่มต้น = ตามห้องใหม่ คือโชว์คำแปลอย่างเดียว
   */
  showOriginalText?: boolean;
}

export const TranslatedBubble: React.FC<Props> = ({
  original,
  translation,
  showOriginalText = false,
}) => {
  const { t } = useI18n();
  /* [FIX-20260910-OUTBOUNDORDER] which half is the original — see the header for
     why this is read off the entry instead of taken as a prop.
     🔴 [FEAT-20260910-OUTBOUNDTARGET] IT IS NO LONGER `to == null`. An admin send
        may now carry the language it was translated INTO, so a null `to` stopped
        being the outbound marker. What still separates the two, and always did,
        is WHICH LANGUAGE THE STORED TEXT IS IN: an inbound entry holds the
        translation, so `lang === to`; an outbound entry holds the original, so
        it does not.
     ⚠️ LEGACY ROWS FALL OUT CORRECTLY, and that is checked, not hoped: an old
        outbound entry is `{lang: null, to: null}` — `to == null` sends it down
        the outbound branch before the comparison is reached, so `null === null`
        can never read as inbound. Nothing is backfilled (owner, 10/09). */
  const outbound = translation.to == null || translation.lang !== translation.to;
  const top = outbound ? translation.text : original;
  const bottom = outbound ? original : translation.text;
  return (
  <>
    {/* the context line, de-emphasised: the words the reader already knows —
        the customer's own message, or the admin's own draft.
        [FIX-20260910-WIREICON] 🔴 ONE RULE, TWO POSITIONS: the icon marks the
        line that ACTUALLY CROSSED THE WIRE — `content` — and that line is the
        top one inbound and the bottom one outbound. ✉ in FRONT of a customer's
        message reads "this arrived"; ➤ AFTER an admin's reads "this went out".
        The other line of the pair is ours alone and carries no icon, which is
        what makes the pair readable at a glance: icon = the customer's side of
        the conversation, in the language they actually saw. */}
    {showOriginalText && (
      <>
        <div className="text-[13px] leading-relaxed opacity-60">
          {!outbound && (
            <Mail size={13} className="inline-block mr-1.5 -mt-0.5 align-middle shrink-0" aria-hidden />
          )}
          {top}
        </div>
        {/* 🔴 a `border-t` INSIDE the bubble — never a gap between two cards.
            Neutral on both themes: the bubble's own colour is set by `tc-msg-in` /
            `tc-msg-out` under the `.tc` scope and dark theme leaves those
            transparent, so a fixed divider colour would clash on one of them. */}
        <div className="border-t border-black/10 dark:border-white/20 my-2" />
      </>
    )}
    {/* the translation — larger and heavier, because this is what the eye
        should land on. It is the reason the admin pressed the chip. */}
    <div className="text-[15px] font-semibold leading-relaxed">
      {bottom}
      {outbound && showOriginalText && (
        <Send size={14} className="inline-block ml-1.5 -mt-0.5 align-middle shrink-0" aria-hidden />
      )}
    </div>
    {/* The pair, read straight off the row: no lookup, no audit call, no branch
        on who sent the message. `from` is nullable on the wire (the model was
        not told a source language), and printing "null → th" would be worse
        than printing the target alone. */}
    {/* [FEAT-20260910-DETECTSOURCE] BOTH ENDS WHEN BOTH ARE KNOWN, and never a
        blank row when neither is.
        🔴 Four shapes reach this line and every one of them exists in the
           database right now:
             from + to → `ไทย → จีนตัวเต็ม`   both known (from today on)
             to only   → `จีนตัวเต็ม`         inbound before detection shipped
             from only → `ไทย`               outbound before the target shipped
             neither   → nothing rendered    the oldest outbound rows
        ⚠️ The last one is why this is a `&&` and not just a ternary: printing an
           empty div left a 10px gap under the translation on every legacy admin
           bubble, and a gap that appears only on old rows is the kind of thing
           nobody can explain a month later. ไม่รู้ = ไม่พูด. */}
    {(translation.from || translation.to) && (
      <div className="mt-1 text-[10px] opacity-60 text-right font-normal">
        {showOriginalText ? (
          translation.from && translation.to
            ? `${langName(translation.from, t)} → ${langName(translation.to, t)}`
            : langName(translation.from || translation.to, t)
        ) : (
          <span
            className="inline-flex items-center"
            title={
              translation.from && translation.to
                ? `${langName(translation.from, t)} → ${langName(translation.to, t)}`
                : langName(translation.from || translation.to, t)
            }
          >
            <Languages
              size={12}
              className="inline-block opacity-75"
              aria-label="translated"
            />
          </span>
        )}
      </div>
    )}
  </>
  );
};
