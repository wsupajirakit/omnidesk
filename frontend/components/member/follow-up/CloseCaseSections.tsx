import React from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../../../i18n';

import type { ChatRoom } from '../../../services/chat/chatService';
import type { ScreenSection } from '../../../services/chat/providerFeatures';
import {
  ABANDON_ROW,
  REQUEST_REG_ROW,
  CUSTOMER_HELPER_ROW,
  followStampRaw,
  hasRawProfile,
} from './followStamps';

/**
 * [FEAT-20260827-PATCHAFTERCLOSE] กล่องยืนยันปิดเคส — แบ่งเป็น section
 * ===========================================================================
 * เจ้าของสั่ง 27/08/2026: เอาตัวเลือกเดิม (`CloseCaseFollowUpChoice`) มาจัดใหม่เป็น
 * **section** เพื่อให้เพิ่มหัวข้ออื่นได้โดยไม่ต้องรื้อ และเพิ่ม section ฝากถอนเข้ามา
 *
 *   section "การติดตามลงทะเบียน" — ขึ้นเมื่อ member มี stamp **ใบใดใบหนึ่ง** ใน
 *       สาม (`abandon_trigger_at` / `request_reg_at` / `customer_helper_trigger_at`)
 *       **และยังไม่มี `raw_profile_data`** ([FEAT-20260904-REGANYSTAMP] · 04/09)
 *   section "การติดตามฝากถอน"    — สองคู่ **อิสระจากกัน**
 *       คู่ฝาก  ขึ้นเมื่อมี `notice_deposit_at`
 *       คู่ถอน  ขึ้นเมื่อมี `notice_withdraw_at`
 *
 * 🔴 **กฎที่อยู่เหนือทุกบรรทัดในไฟล์นี้** (เจ้าของย้ำสองรอบ 27/08):
 *    *section ไหนไม่ขึ้น = ปิดเคสปกติ ไม่ต้องทำอะไรเลย*
 *    ⇒ ไม่มี section ไหนขึ้นเลย ⇒ คอมโพเนนต์นี้เรนเดอร์ `null` ⇒ DOM ของกล่อง
 *      ยืนยันเท่าเดิมทุกไบต์ · ปุ่มยืนยันไม่ถูกล็อก · payload ไม่มี field ใหม่
 *    ⇒ บังคับติ๊กเฉพาะ section ที่ **ขึ้นจริง** เท่านั้น — `missingTopics()` เป็นตัว
 *      ตัดสินตัวเดียวกับที่ตัดสินว่าจะแสดงอะไร ไม่มีทางล็อกปุ่มของหัวข้อที่ไม่ได้โชว์
 *
 * 🔴 ทำไมเป็น radiogroup ไม่ใช่ checkbox สองใบ (ยกเหตุผลเดิมจาก
 *    `CloseCaseFollowUpChoice.tsx` มาทั้งดุ้น เพราะยังจริงอยู่): checkbox สองใบ
 *    ติ๊กพร้อมกันได้ ซึ่งเป็นสถานะที่ไม่มีความหมาย ("ตามต่อ" และ "ไม่ตามต่อ" พร้อมกัน?)
 *    นี่คือทางเลือกที่แยกกันขาด ⇒ ARIA ต้องบอกความจริงข้อนี้ให้ screen reader ด้วย
 *
 * 🔴 ผลของแต่ละตัวเลือกไม่ใช่แค่เรื่อง UI:
 *    ลงทะเบียน "หยุดตาม" ⇒ BE ตั้ง `members.ignore_abandon_assist = true`
 *      **และลบ stamp ทั้งสามใบ** (`[FIX-20260831-STOPCLEARSSTAMPS]`)
 *      🔴 บรรทัดนี้เคยเขียนว่า "ไม่ลบ stamp" ซึ่งเป็นกฎ 27/08 และ **ค้างผิดมาตั้งแต่
 *         31/08** ที่เจ้าของกลับคำอีกรอบ · คนอ่านคอมเมนต์นี้จะได้คำตอบตรงข้ามกับ
 *         สิ่งที่โค้ดทำจริง (เกิดขึ้นแล้ว 04/09) ⇒ พฤติกรรมเปลี่ยนเมื่อไหร่ แก้บรรทัดนี้ด้วย
 *    ฝาก/ถอน "ไม่ติดตาม" ⇒ BE ล้าง stamp ใบนั้นใบเดียว
 *    เหตุผลเต็ม: `omnidesk-api/src/modules/tickets/patch-after-close.helper.ts`
 *    และบัญชีกลางของคีย์ `chat/config/member-config.registry.ts`
 *    — อ่านก่อนแก้ข้อความในนี้ เพราะข้อความคือสิ่งเดียวที่บอกแอดมินว่ากำลังทำอะไรลงไป
 *
 * revert: ลบไฟล์นี้ + การเรียกใน `pages/chat/TicketChat.tsx` แล้วเรียก
 *         `CloseCaseFollowUpChoice` กลับ — ไฟล์นั้นยังอยู่ครบและยังทำงานได้
 */

/** คำตอบของแต่ละ section — ไม่มี key = section นั้นไม่ได้ขึ้น (ไม่ใช่ "ยังไม่เลือก") */
export interface CloseCaseAnswers {
  registration?: 'stop' | 'keep';
  deposit?: 'follow' | 'unfollow';
  withdraw?: 'follow' | 'unfollow';
}

/** หัวข้อที่ระบบรู้จัก — เพิ่มหัวข้อใหม่ = เติมที่นี่ + ใน TOPIC_UI ข้างล่าง */
export type CloseCaseTopic = keyof CloseCaseAnswers;

/** stamp มีค่าจริงหรือไม่ — `null`/ว่าง นับว่าไม่มี (กติกาเดียวกับฝั่ง BE) */
const hasStamp = (room: ChatRoom | null, key: string): boolean =>
  followStampRaw(room, key as never) !== null;

/**
 * หัวข้อไหนต้องขึ้นบ้างสำหรับ member คนนี้
 *
 * ⚠️ `targetStatus` ต้องเป็น 2 เสมอ — กล่องยืนยันใบนี้ใช้ร่วมกันระหว่าง "รับเคส" (1)
 *    กับ "ปิดเคส" (2) โดยสลับแค่หัวเรื่อง ถ้าเช็คแต่ stamp ช่องเลือกจะไปโผล่ตอนกด
 *    รับเคสด้วย ซึ่งไม่มีใครสั่ง และ BE ก็ไม่ทำอะไรกับมัน (บั๊กนี้เคยเจอมาแล้วรุ่นก่อน)
 */
export const closeCaseTopicsFor = (
  room: ChatRoom | null,
  targetStatus: number,
): CloseCaseTopic[] => {
  if (targetStatus !== 2) return [];
  const topics: CloseCaseTopic[] = [];
  /* [FEAT-20260904-REGANYSTAMP] ANY ONE stamp qualifies — and a registered
     member is never offered this at all.
     ─────────────────────────────────────────────────────────────────────────
     🔴 THE OLD AND-PAIR HID THE SECTION FROM THE PEOPLE IT IS FOR.
     `request_reg_at` is written only when the customer actually sent a phone
     AND an account, so someone chased who never replied carries
     `abandon_trigger_at` alone — and the section never appeared for them.
     `customer_helper_trigger_at` was not consulted at all.

     🔴 `!hasRawProfile` IS MANDATORY AND IS THE HARD LINE: a member who HAS a
     profile must NOT see this option, ever. All three keys survive
     registration (two of them are records nothing used to remove), so without
     this gate a long-registered customer would be offered "stop chasing" —
     and answering it now DELETES those records. มีโปรไฟล์ = ห้ามมีตัวเลือกนี้เด็ดขาด

     ⚠️ The BE re-checks both halves independently
     (`tickets/patch-after-close.helper.ts`); this side only decides what to
     SHOW. A stale tab that posts the answer anyway is dropped there. */
  if (
    !hasRawProfile(room) &&
    (hasStamp(room, ABANDON_ROW.key) ||
      hasStamp(room, REQUEST_REG_ROW.key) ||
      hasStamp(room, CUSTOMER_HELPER_ROW.key))
  ) {
    topics.push('registration');
  }
  if (hasStamp(room, 'notice_deposit_at')) topics.push('deposit');
  if (hasStamp(room, 'notice_withdraw_at')) topics.push('withdraw');
  return topics;
};

/**
 * [FEAT-20261018-CLOSEFOLLOW] each topic's id in the provider's hidden-section table
 * (BE `customer-provider/features/screen-sections.ts`). loan hides all three (worlds `followUp`
 * + `notice` off) · shop-api none. A hidden topic is simply not offered — the same rule as a topic
 * whose stamp is absent: plain close, no answer required, none sent.
 */
const CLOSE_TOPIC_SECTION: Record<CloseCaseTopic, ScreenSection> = {
  registration: 'ticket-close.follow-registration',
  deposit: 'ticket-close.follow-deposit',
  withdraw: 'ticket-close.follow-withdraw',
};

/** Drop the topics the provider hides. `null` / [] (shop-api, not answered yet) ⇒ unchanged. */
export const withoutHiddenTopics = (
  topics: CloseCaseTopic[],
  hidden: readonly string[] | null,
): CloseCaseTopic[] =>
  hidden && hidden.length ? topics.filter((t) => !hidden.includes(CLOSE_TOPIC_SECTION[t])) : topics;

/** หัวข้อที่ขึ้นแล้วแต่ยังไม่ได้ตอบ — ว่าง = กดยืนยันได้ */
export const missingTopics = (
  topics: CloseCaseTopic[],
  answers: CloseCaseAnswers,
): CloseCaseTopic[] => topics.filter((t) => answers[t] === undefined);

/* ── ข้อความของแต่ละหัวข้อ ─────────────────────────────────────────────────
   เพิ่มหัวข้อใหม่ = เติมหนึ่ง entry ที่นี่ ไม่ต้องแตะ jsx เลย
   `danger` = ตัวเลือกที่ "หยุด/ไม่ตาม" ซึ่งเป็นฝั่งที่เปลี่ยนข้อมูลจริง */
const TOPIC_UI: Record<
  CloseCaseTopic,
  {
    section: string;
    title: string;
    options: [
      { value: string; label: string; hint: string; danger: boolean },
      { value: string; label: string; hint: string; danger: boolean },
    ];
  }
> = {
  registration: {
    section: 'การติดตามลงทะเบียน',
    title: 'ลูกค้าคนนี้ยังถูกติดตามให้สมัครอยู่',
    options: [
      {
        value: 'stop',
        label: 'ไม่ต้องติดตามการสมัครลูกค้านี้อีก',
        /* [UI-20260901-STOPHINTTRIM] Dropped the trailing promise that the
           chase "starts over on the next card" — it does not. "stop" sets
           `ignore_abandon_assist`, which the webhook reads before either
           follow-up level, so only an operator clearing it resumes the chase. */
        /* [FEAT-20260904-REGANYSTAMP] The hint now says the second half out
           loud. "stop" has removed the three registration stamps since
           31/08 (`[FIX-20260831-STOPCLEARSSTAMPS]`) while this line still
           promised only that no further case would be sent — so an admin
           pressing it could not know the follow-up history goes with it.
           บอกให้ครบว่าประวัติหายด้วย ไม่ใช่แค่หยุดส่ง */
        hint: 'ไม่ส่งเคสการสมัครอีก และล้างประวัติการติดตามของลูกค้าคนนี้',
        danger: true,
      },
      {
        value: 'keep',
        label: 'ติดตามการสมัครลูกค้านี้ต่อ',
        hint: 'ส่งเคสสมัครมาปกติ ของลูกค้าคนนี้',
        danger: false,
      },
    ],
  },
  deposit: {
    section: 'การติดตามฝากถอน',
    title: 'การติดตามการฝาก',
    options: [
      {
        value: 'follow',
        label: 'ติดตาม',
        hint: 'เก็บสถานะติดตามการฝากของลูกค้าคนนี้ไว้เหมือนเดิม',
        danger: false,
      },
      {
        value: 'unfollow',
        label: 'ไม่ติดตาม',
        hint: 'ล้างสถานะติดตามการฝากของลูกค้าคนนี้',
        danger: true,
      },
    ],
  },
  withdraw: {
    section: 'การติดตามฝากถอน',
    title: 'การติดตามการถอน',
    options: [
      {
        value: 'follow',
        label: 'ติดตาม',
        hint: 'เก็บสถานะติดตามการถอนของลูกค้าคนนี้ไว้เหมือนเดิม',
        danger: false,
      },
      {
        value: 'unfollow',
        label: 'ไม่ติดตาม',
        hint: 'ล้างสถานะติดตามการถอนของลูกค้าคนนี้',
        danger: true,
      },
    ],
  },
};

const Option: React.FC<{
  testId: string;
  checked: boolean;
  danger: boolean;
  missing: boolean;
  label: string;
  hint: string;
  onPick: () => void;
  /* [FIX-20260830-CLOSEFOCUS] the caller focuses the FIRST unanswered option
     after a blocked confirm, so the keyboard lands where the work is. */
  innerRef?: React.Ref<HTMLDivElement>;
}> = ({ testId, checked, danger, missing, label, hint, onPick, innerRef }) => (
  <div
    ref={innerRef}
    data-testid={testId}
    role="radio"
    aria-checked={checked}
    aria-invalid={missing || undefined}
    tabIndex={0}
    onClick={onPick}
    onKeyDown={(e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        onPick();
      }
    }}
    className={`flex cursor-pointer select-none items-start gap-3 rounded-xl border-2 p-4 transition-colors ${
      missing && !checked ? 'tc-close-missing ' : ''
    }${
      checked
        ? danger
          ? 'border-red-500 bg-red-50 dark:bg-red-950/30'
          : 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
        : missing
          ? 'border-red-500 bg-slate-50 dark:bg-dark-900/40'
          : 'border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-dark-700 dark:bg-dark-900/40'
    }`}
  >
    <span
      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors ${
        checked
          ? danger
            ? 'border-red-600 bg-red-600 text-white'
            : 'border-emerald-600 bg-emerald-600 text-white'
          : 'border-slate-300 bg-white dark:bg-dark-800'
      }`}
      aria-hidden
    >
      {checked && <Check size={16} strokeWidth={3} />}
    </span>
    {/* [UI-20260829-CONFIRMOVERFLOW] `min-w-0` is what makes wrapping possible here.
        🔴 A flex item defaults to `min-width: auto`, i.e. it MUST NOT shrink below its
           content — so long text widens the box instead of moving to a new line.
        🔴 Thai has no spaces between words, so the browser reads a whole hint as a
           single "word" and still refuses to break it even once shrinking is allowed.
           Both are required; either one alone still overflows. */}
    <span className="flex min-w-0 flex-col gap-1">
      <span className="break-words text-sm font-bold text-slate-700 dark:text-slate-200">
        {label}
      </span>
      {/* เหตุผลอยู่ใต้หัวข้อเสมอ — แอดมินกำลังตัดสินใจแทนลูกค้า จึงต้องเห็นว่าผลของ
          แต่ละทางคืออะไร ไม่ใช่เดาจากชื่อ */}
      <span className="break-words text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
        {hint}
      </span>
    </span>
  </div>
);

interface Props {
  topics: CloseCaseTopic[];
  answers: CloseCaseAnswers;
  onChange: (topic: CloseCaseTopic, value: string) => void;
  /** จริงเมื่อผู้เรียกบอกว่ามีการพยายามกดยืนยันทั้งที่ยังตอบไม่ครบ */
  showMissing?: boolean;
  /* [FIX-20260830-SHAKEEVERYTIME] increments on every blocked confirm. Drives
     BOTH the animation restart (through `key`) and the re-focus, so pressing
     ยืนยัน again always answers, even when nothing else changed. */
  missingAttempt?: number;
  /* [FEAT-20260830-CLOSEWIZARD] which topic is on screen. The PARENT owns it,
     because the parent owns the modal's footer button — that button is the
     "ถัดไป / ยืนยัน" control, and a step index split across two components
     would let the label and the content disagree.
     Out of range (or no topics) renders nothing, same as before. */
  stepIndex?: number;
  /** shows the back control; omitted on the first step */
  onStepBack?: () => void;
}

export const CloseCaseSections: React.FC<Props> = ({
  topics,
  answers,
  onChange,
  showMissing = false,
  missingAttempt = 0,
  stepIndex = 0,
  onStepBack,
}) => {
  /* [FIX-20260830-CLOSEFOCUS] owner 30/08: a blocked confirm must not just turn
     things red — it has to TAKE the admin to what is missing.
     The first unanswered option is focused and scrolled into view; every
     unanswered one shakes (see index.css). Focus goes to the FIRST only:
     focus is singular by definition, and moving it to the last would scroll
     past the earlier ones the admin still has to answer.
     ⚠️ Re-runs whenever the set of missing topics changes, so answering one and
        pressing confirm again lands on the NEXT one rather than staying put. */
  const firstMissingRef = React.useRef<HTMLDivElement | null>(null);
  /* [FEAT-20261022-I18NTICKETEN] TOPIC_UI stays the Thai source (grouping reads it);
     the words on screen go through t() keyed by topic / option value. */
  const { t } = useI18n();
  /* [FEAT-20260830-CLOSEWIZARD] one topic is on screen, so "what is missing"
     is about THAT topic — not the whole list. */
  const activeTopic: CloseCaseTopic | undefined = topics[stepIndex];
  const missingKey =
    activeTopic && answers[activeTopic] === undefined ? activeTopic : '';
  React.useEffect(() => {
    /* [FIX-20260830-SHAKEEVERYTIME] `missingAttempt` is in the deps on purpose:
       pressing ยืนยัน again with the SAME answers must scroll and focus again.
       Without it the effect is inert from the second press onward. */
    if (!showMissing || !missingKey) return;
    const el = firstMissingRef.current;
    if (!el) return;
    /* ⚠️ `scrollIntoView` is guarded, not assumed: jsdom has no layout and does
       not implement it, and losing FOCUS because a scroll helper is missing
       would be a real regression for keyboard users, not just a test problem.
       Focus is the part that must never be skipped. */
    if (typeof el.scrollIntoView === 'function') {
        /* `center`, not `nearest`: an option below the fold is exactly the case
         the owner hit — `nearest` does the least possible scrolling and can
         leave it hugging the bottom edge, half under the footer. */
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    el.focus({ preventScroll: true });
  }, [showMissing, missingKey, missingAttempt]);
  // ⭐ ไม่มีหัวข้อไหนขึ้น = ไม่เรนเดอร์อะไรเลย ⇒ กล่องยืนยันเหมือนเดิมทุกไบต์
  if (topics.length === 0) return null;


  /* จัดกลุ่มตามชื่อ section โดยคงลำดับของ `topics` ไว้ — หัวข้อที่อยู่ section
     เดียวกันจะถูกวางต่อกันใต้หัวเดียว (ฝาก/ถอน อยู่ใต้ "การติดตามฝากถอน") */
  const sections: { name: string; topics: CloseCaseTopic[] }[] = [];
  for (const topic of topics) {
    const name = TOPIC_UI[topic].section;
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.topics.push(topic);
    else sections.push({ name, topics: [topic] });
  }

  /* [FEAT-20260830-CLOSEWIZARD] one topic per step. The all-at-once list was
     three sections and six radios in one scroll — the owner asked for a
     walkthrough because it is easier to follow, and because it makes the
     unanswered thing the only thing on screen.
     ⚠️ ไม่มีหัวข้อไหนขึ้น = ไม่เรนเดอร์อะไรเลย — unchanged, so a case with no
        options still gets a byte-identical confirm dialog. */
  if (!activeTopic) return null;

  const ui = TOPIC_UI[activeTopic];
  const picked = answers[activeTopic];
  const missing = showMissing && picked === undefined;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="break-words text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t(`ticketui.member.close.${activeTopic}.section`, ui.section)}
        </p>
        <span
          data-testid="close-case-step"
          className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-dark-700 dark:text-slate-400"
        >
          {stepIndex + 1}/{topics.length}
        </span>
      </div>

      {/* the progress rail — one segment per topic, filled up to here */}
      <div className="flex gap-1" aria-hidden>
        {topics.map((tp, i) => (
          <span
            key={tp}
            className={`h-1 flex-1 rounded-full ${
              i <= stepIndex
                ? 'bg-primary-500'
                : 'bg-slate-200 dark:bg-dark-700'
            }`}
          />
        ))}
      </div>

      <div
        role="radiogroup"
        aria-label={t(`ticketui.member.close.${activeTopic}.title`, ui.title)}
        data-testid={`close-case-topic-${activeTopic}`}
        className="flex flex-col gap-2"
      >
        <p className="break-words text-xs font-bold text-slate-600 dark:text-slate-300">
          {t(`ticketui.member.close.${activeTopic}.title`, ui.title)}
        </p>
        {[...ui.options]
          .sort((a, b) => Number(a.danger) - Number(b.danger))
          .map((opt, optIndex) => (
            <Option
              /* [FIX-20260830-SHAKEEVERYTIME] the attempt is part of the key
                 ONLY while missing, so a new press remounts it and the CSS
                 animation plays again. */
              key={missing ? `${opt.value}-${missingAttempt}` : opt.value}
              testId={`close-case-${activeTopic}-${opt.value}`}
              checked={picked === opt.value}
              danger={opt.danger}
              missing={missing}
              label={t(`ticketui.member.close.${activeTopic}.${opt.value}.label`, opt.label)}
              hint={t(`ticketui.member.close.${activeTopic}.${opt.value}.hint`, opt.hint)}
              onPick={() => onChange(activeTopic, opt.value)}
              innerRef={optIndex === 0 && missing ? firstMissingRef : undefined}
            />
          ))}
        {missing && (
          <p className="text-xs font-bold text-red-600 dark:text-red-400">
            {t('ticketui.member.close.pick_one', 'กรุณาเลือกหนึ่งตัวเลือก')}
          </p>
        )}
      </div>

      {onStepBack && (
        <button
          type="button"
          data-testid="close-case-back"
          onClick={onStepBack}
          className="self-start text-xs font-bold text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400"
        >
          ← {t('ticketui.member.close.back', 'ย้อนกลับ')}
        </button>
      )}
    </div>
  );
};

export default CloseCaseSections;
