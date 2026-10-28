import React from 'react';
import { Languages } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * [FEAT-20260908-AITRANSLATE] the little "แปล" chip beside a bubble.
 * ===========================================================================
 * A deliberate TWIN of `BubbleReplyButton.tsx` — same size, same pill, same
 * colours, same `stopPropagation` — so two chips on the same row read as one
 * control set rather than two features that landed separately. Anything that
 * changes there should be considered here too.
 *
 * VISIBILITY IS NOT ITS OWN, exactly like the Reply chip: the row decides,
 * through its own `useTimedReveal` instance in `ChatRoomView`. Pointing at a
 * bubble reveals it for 10s; clicking pins it. Nothing renders until then, so an
 * untouched chat looks exactly as it did. ไม่ชี้ = ไม่มีอะไรโผล่.
 *
 * 🔴 IT SENDS NOTHING AND FETCHES NOTHING. Pressing it opens the language
 * picker; picking a language calls the `onTranslate` handler the PAGE passed in.
 * `ChatRoomView` must never call a service itself —
 * `test/contactChatTab.dom.test.tsx` proves the read-only Contact page cannot
 * act, by reading this component tree's source and by spying on the API.
 *
 * revert: delete this file and its use in ChatRoomView.
 */

/**
 * 🔴 ITS OWN SWITCH, on purpose — NOT `SHOW_BUBBLE_REPLY_BUTTON`.
 *
 * `test/bubbleReplyHidden.value.test.ts` pins the reply switch to exactly ONE
 * reader so that "flip one boolean and the Reply chip is gone" stays true.
 * Hanging a second, unrelated feature off it would quietly break that promise:
 * turning Reply off would take translation with it, and turning translation off
 * would bring Reply back. Two features, two switches.
 * คนละฟีเจอร์ = คนละสวิตช์.
 */
export const SHOW_BUBBLE_TRANSLATE_BUTTON = true;

/**
 * What the page is handed when the admin has chosen a language.
 *
 * Kept in this file rather than a `translateTarget.ts` of its own (the shape
 * `replyTarget.ts` uses) because nothing but the chip produces it and nothing
 * but the page consumes it — a third file would be one more thing to keep in
 * step for no reader's benefit.
 */
export interface TranslateTarget {
  /** OUR `_id` — the same id-space the message patch will use */
  id: string;
  /** the text as it stands on screen, so the page needs no second lookup */
  text: string;
  /** the language CODE the admin picked, straight from the server registry */
  lang: string;
  /**
   * [FEAT-20260910-SOURCEPIPE] the SOURCE language, when a caller states one.
   *
   * 🔴 NOTHING PRODUCES THIS TODAY, AND THAT IS THE DESIGN. The picker offers
   *    targets only; the source is left to the model, which reports it back in
   *    the same reply (`translate-envelope.ts` on the server). Owner, 10/09:
   *    support choosing a source, but do not show a control for it yet — so the
   *    VALUE travels and the UI does not exist.
   * ⚠️ Absent ≠ null on the wire. Omitted keeps `from` off the request body
   *    entirely, which is byte-for-byte the call this app has always made.
   */
  from?: string | null;
}

interface Props {
  onClick: () => void;
  /** Title/aria wording, so the same chip can serve other kinds later. */
  label?: string;
}

export const BubbleTranslateButton: React.FC<Props> = ({ onClick, label: labelProp }) => {
  const { t } = useI18n();
  const label = labelProp ?? t('ticketui.bubble.translate', 'แปลข้อความนี้');
  return (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="shrink-0 self-center
      inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold
      text-slate-600 dark:text-slate-200 bg-white/95 dark:bg-slate-700/95
      border border-slate-200 dark:border-slate-600 shadow-sm
      hover:text-sky-600 hover:border-sky-300 dark:hover:text-sky-300
      transition-colors duration-150"
  >
    <Languages size={13} />
    {t('ticketui.bubble.translate_short', 'แปล')}
  </button>
  );
};
