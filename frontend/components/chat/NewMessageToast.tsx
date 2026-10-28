import React, { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * "ได้รับข้อความใหม่" — a small notice over the OPEN conversation.
 * ===========================================================================
 * WHY IT EXISTS
 *   A card that is not open announces itself with the orange number badge. The
 *   card you already have open cannot: its badge is cleared the moment you open
 *   it, so an inbound message while you are reading, typing, or scrolled up the
 *   history arrives with no signal at all. This is that signal, and only for
 *   that case. การ์ดที่เปิดอยู่ไม่มี badge — อันนี้คือสัญญาณของมัน.
 *
 * WHY IT IS A SEPARATE FILE
 *   `ChatRoomView.tsx` is 1,600 lines and already on the max-lines waiver, and
 *   the waiver list may only shrink. A self-contained overlay that reads one
 *   prop belongs in its own file from the start (FE anti-bloat rule §6.1).
 *
 * HOW IT IS DRIVEN
 *   `trigger` is a counter, not a boolean: raising it re-shows the toast and
 *   restarts the timer, so a burst of messages keeps one notice alive rather
 *   than stacking or flickering. 0 = never shown.
 *
 * revert: delete this file and the `<NewMessageToast>` line in ChatRoomView.
 */
export const NEW_MESSAGE_TOAST_MS = 2600;

/**
 * How long a freshly arrived bubble keeps its blue glow. Owner-set: 4 seconds,
 * "glow 4 วิแล้วหยุด". Longer than the toast on purpose — the toast says
 * SOMETHING arrived, the glow says WHICH bubble it was, and that answer is
 * still useful after the notice has faded. Applied by ChatRoomView via the
 * `tc-msg-glow` class (see index.css). ยาวกว่า toast ตั้งใจ.
 */
export const NEW_MESSAGE_GLOW_MS = 4000;

/**
 * LIGHT theme only. Tailwind's `shadow-xl` casts a near-black shade that reads as
 * heavy on the pale chat background, so light keeps the SAME geometry but tints it
 * slate instead of black and drops it 30% (0.10 → 0.07 alpha). Dark is left on
 * `shadow-xl` untouched — owner: "dark theme ดีแล้วไม่เปลี่ยน · เฉพาะ light".
 *
 * Written as a constant rather than inline: a comment inside the className
 * template literal would be emitted into the class attribute verbatim.
 */
const SHADOW =
  'shadow-[0_20px_25px_-5px_rgba(100,116,139,0.07),0_8px_10px_-6px_rgba(100,116,139,0.07)] dark:shadow-xl';

/**
 * Is the operator typing right now? A notice is a nudge for someone who is NOT
 * looking — if the cursor sits in the composer they are already in this
 * conversation and about to see the bubble, so the notice would only cover the
 * view they are working in. Owner: "ถ้า focus on input อยู่ (cursor ขึ้น) ต้องไม่มี toast".
 *
 * Read at the MOMENT the message lands rather than tracked as state: the
 * composer lives in a different component (`pages/chat/TicketChat.tsx`), and
 * `document.activeElement` answers for any of them without wiring focus state
 * across the tree. The sound and the card badge are unaffected — this silences
 * the in-chat notice only. กำลังพิมพ์อยู่ = ไม่ต้องเตือน.
 */
export function isTypingInInput(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable === true;
}

interface Props {
  /** Bump this on each inbound message. Same value = nothing happens. */
  trigger: number;
  label?: string;
}

export const NewMessageToast: React.FC<Props> = ({ trigger, label: labelProp }) => {
  const { t } = useI18n();
  const label = labelProp ?? t('ticketui.toast.new_message', 'ได้รับข้อความใหม่');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), NEW_MESSAGE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  /* Absolutely centred over the chat HEADER — owner moved it there on
     2026-08-19 ("ย้าย toast ไปบน header ตรงกลาง"): floating it mid-conversation
     covered the very bubbles the reader was looking at, while the header is a
     fixed strip that is always in view and carries nothing in its middle.
     The host element must be `relative`; it is the header bar in ChatRoomView.
     `pointer-events-none` so it can never swallow a click on the header buttons.
     ลอยกลางแชทแล้วบังข้อความ · ย้ายมาเกาะแถบหัวที่ว่างอยู่ตรงกลางพอดี. */
  return (
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-30 flex justify-center pointer-events-none">
      <div
        className={`flex items-center gap-[13px] px-[26px] py-4 rounded-full text-[17px] font-semibold
          bg-white/95 dark:bg-slate-800/95 text-slate-700 dark:text-slate-100
          border-2 border-sky-300 dark:border-sky-500/60 backdrop-blur-sm ${SHADOW}
          transition-all duration-300 ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      >
        <MessageCircle size={21} className="text-sky-500 shrink-0" />
        {label}
      </div>
    </div>
  );
};
