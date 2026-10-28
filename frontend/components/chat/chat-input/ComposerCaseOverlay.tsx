/**
 * ComposerCaseOverlay.tsx — the three states that sit OVER the composer while
 * nobody is typing in this room: "another admin holds this case", "the bot is
 * looking after it" (with the reopen button), and "press to take the case".
 *
 * WHAT: moved verbatim from `ChatInputBox` in `pages/chat/TicketChat.tsx` — the
 * whole `isOtherAdminCase ? … : !accepted ? … : null` expression and every
 * comment around it.
 *
 * WHY this is a real seam and not a number-chasing split: the block reads
 * ELEVEN of `ChatInputBox`'s PROPS and not one item of its local state, and the
 * repo already treats it as one unit — `test/chatOverlayCompact.test.ts` is a
 * spec written about these three states together.
 *
 * ⚠️ NO STATE MOVED. Everything here arrives as a prop, exactly as it arrived
 * at `ChatInputBox`; the values are simply forwarded one level. The rendered
 * element tree, class strings and order are byte-identical, so the screen is
 * unchanged (`dev-local` §6.4).
 *
 * ⚠️ UI ONLY, as the original comments insist: `onClaim`, `claiming`,
 * `onAccept`, `accepting`, `isOtherAdminCase`, `onReopen` are passed through
 * untouched. ห้ามแตะ logic การถือเคส.
 *
 * revert: paste the JSX back where `<ComposerCaseOverlay …/>` is rendered in
 *   `./ChatInputBox.tsx`, drop this file and its line in `./index.ts`.
 */
import React from 'react';
import { Bot, Loader2, Lock, User as UserIcon, UserCheck } from 'lucide-react';
import { formatShortTime } from './formatShortTime';
import { useI18n } from '../../../i18n';

export const ComposerCaseOverlay: React.FC<{
  isOtherAdminCase?: boolean;
  otherAdminName?: string;
  claimedAt?: string | null;
  claiming?: boolean;
  onClaim?: () => void;
  accepted: boolean;
  accepting: boolean;
  onAccept?: () => void;
  closedNotice?: string;
  onReopen?: () => void;
  reopening?: boolean;
}> = ({ isOtherAdminCase, otherAdminName, claimedAt, claiming, onClaim, accepted, accepting, onAccept, closedNotice, onReopen, reopening }) => {
  const { t } = useI18n(); // [FEAT-20261022-I18NTICKETEN] en labels; th text unchanged
  return (
  <>
      {/* claim overlay — shown when viewing an in-progress case belonging to another admin */}
      {/* ==== [FIX-20260731-CLAIMBOX] START — หน้าตาปุ่มรับเคสต่อ ตามไฟล์ต้นแบบ
           เดิม: ข้อความลอยๆ + ปุ่มกลมสีม่วง "เคลมงาน" บนพื้นเบลอขาว
           ใหม่: กล่องพื้นเหลืองอ่อน + ไอคอนกุญแจในวงกลม + ปุ่มน้ำเงิน "รับเคสต่อ"
                 พร้อมเวลาที่รับเคสไว้ — ตรงกับต้นแบบทั้งธีม light และ dark
           ⚠️ งาน UI ล้วน — `onClaim` / `claiming` / เงื่อนไข `isOtherAdminCase`
           ไม่ถูกแตะเลยสักบรรทัด การทำงานเหมือนเดิมทุกประการ
           revert: คืน block เดิม (ข้อความ + ปุ่มม่วง) ตาม git history */}
      {/* ==== [FIX-20260824-OVERLAYCOMPACT] the pre-claim overlays, made smaller
           ====
           The three states below sit over the chat while nobody has taken the
           case, and they were eating room that belongs to the conversation. The
           owner asked for ~70% of the previous size, with one condition: the
           buttons and the text ON the buttons must stay readable.

           So the reduction is spent entirely on SPACE — padding, gaps, the icon
           bezel, the button's vertical padding, the card's max width — and never
           on the label. Every button keeps `text-sm` or its inherited size;
           `chatOverlayCompact.test.ts` pins that floor, expressed as "nothing
           below text-sm" rather than as a required class, because one of the
           three declares no size at all and inherits a larger one.

           ⚠️ UI ONLY. `onClaim`, `claiming`, `onAccept`, `accepting`,
           `isOtherAdminCase`, `onReopen` — none of them are touched, and the
           same spec pins that too. ห้ามแตะ logic การถือเคส เจ้าของสั่งชัด.
           revert: restore the previous spacing values from git history; no
                   behaviour depends on any of them. */}
      {isOtherAdminCase ? (
        <div className="absolute inset-0 bg-white/75 dark:bg-slate-900/75 backdrop-blur-[3px] z-20 flex items-center justify-center p-2 transition-opacity duration-300">
          {/* [FIX-20260824-CLAIMBOXWIDE] เจ้าของแจ้ง 24/08: ข้อความตกลงไป 3 บรรทัด
                 สั่ง "ขยายกล่องเหลืองกว้าง ให้ text มันมีแค่สองบรรทัด" + "ปุ่มตำแหน่งเดิมนั้นแหละ"
                 16rem (256px) แคบเกินไปสำหรับประโยค "รับเคสไว้เมื่อ … ก่อนพิมพ์ได้"
                 ⇒ ขยายเพดานเป็น 22rem · **ยังมีเพดานอยู่** ไม่ปล่อยเต็มจอ (กล่องจะกว้างเกินในจอใหญ่)
                 ปุ่มยังเป็น w-full ใต้ข้อความ ตำแหน่งเดิมทุกประการ
                 revert: max-w-[22rem] กลับเป็น max-w-[16rem] */}
            {/* [UI-20260826-CLAIMSAMEHEIGHT] เจ้าของสั่ง: "ความสูง overlay ตัวนี้ด้วยให้เท่ากันสิ"
                ─────────────────────────────────────────────────────────────────
                🔴 ที่ทำให้กล่องนี้สูงกว่ากล่อง "บอทกำลังดูแล" คือ **ปุ่มอยู่คนละแถว**
                   (`mt-1.5 w-full` ใต้ข้อความ) ⇒ กินเพิ่มอีก ~34px ทั้งที่ข้อความ
                   ด้านซ้ายยังมีที่ว่างทางขวาเหลือเฟือ
                ⇒ ย้ายปุ่มมาอยู่ **แถวเดียวกับข้อความ** ⇒ ความสูงเหลือเท่าแถวเดียว
                  ใกล้เคียงกับป้าย+ปุ่มของกล่องบอทดูแล
                ⚠️ กว้างขึ้นจาก `22rem` → `34rem` เพราะต้องใส่ข้อความสองบรรทัด + ปุ่ม
                   ในแถวเดียว · **ยังมีเพดาน** ไม่ปล่อยเต็มจอ
                ⚠️ ตรงนี้ **แทนที่** คำสั่งเดิม [FIX-20260824-CLAIMBOXWIDE] ที่ปักไว้ว่า
                   "ปุ่มเต็มความกว้าง ใต้ข้อความ" — เคส P4 ใน chatOverlayCompact.test.ts
                   ถูก **พลิก ไม่ลบ** พร้อมบันทึกว่าใครสั่งและเมื่อไหร่
                revert: คืนปุ่มกลับไปเป็น `mt-1.5 w-full` ใต้ `</div>` ของข้อความ
                        แล้วเปลี่ยน max-w กลับเป็น 22rem */}
            <div className="w-full max-w-[34rem] rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-950/40 shadow-md p-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/60 grid place-items-center shrink-0">
                <Lock size={12} className="text-amber-600 dark:text-amber-400" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-800 dark:text-slate-100">
                  {t('ticketui.composer.held_by', 'เคสนี้กำลังถือโดย {name}', { name: otherAdminName })}
                </p>
                <p className="text-[11px] text-gray-600 dark:text-slate-400 mt-0.5 leading-snug">
                  {claimedAt && <>{t('ticketui.composer.claimed_at', 'รับเคสไว้เมื่อ {time}', { time: formatShortTime(claimedAt) })} • </>}
                  {/* [FIX-20260824-OVERLAYCOMPACT] `พิมพ์ได้` is kept in one
                      unbreakable run. Thai has no inter-word spaces, so the
                      browser breaks this sentence wherever it likes and `ได้`
                      was landing alone on its own line. A nowrap span is
                      deterministic in every browser; `text-wrap: pretty` is a
                      hint and is not one. คำว่า "ได้" ห้ามตกบรรทัดเดียวโดด ๆ. */}
                  {t('ticketui.composer.claim_first', 'แอดมินใหม่ต้องกดรับเคสต่อก่อน')}
                  <span className="whitespace-nowrap">{t('ticketui.composer.claim_first_tail', 'พิมพ์ได้')}</span>
                </p>
              </div>
              <button
                type="button"
                disabled={claiming}
                onClick={onClaim}
                className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-full shadow-sm active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer transition-all text-sm whitespace-nowrap"
              >
                {claiming ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                <span>{t('ticketui.composer.claim_button', 'รับเคสต่อ')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : !accepted ? (
        <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center transition-opacity duration-300">
          {/* [FIX-20260731-CLOSEDBOX] เคสปิดแล้ว = ป้ายแคปซูลเทา (ไม่ใช่ปุ่ม กดไม่ได้)
              ใช้ overlay ตัวเดียวกับตอนรอรับเคส ความสูงจึงเท่ากันโดยอัตโนมัติ
              ตามที่ผู้ใช้สั่ง "box บอทดูแล ความสูงเท่า blur รับเคสนะ" */}
          {/* [FIX-20260731-CLOSEDBOX] ผู้ใช้สั่ง "ใช้คำว่า icon bot บอทกำลังดูแล"
              → ป้ายใช้ไอคอนหุ่นยนต์ + ข้อความ "บอทกำลังดูแล"
              (เคสปิดแล้ว = บอทรับช่วงต่อ ข้อความจึงสื่อสถานะจริงมากกว่า)
              ⚠️ คอมเมนต์ต้องอยู่นอก `? (` เสมอ ไม่งั้น JSX พัง */}
          {closedNotice ? (
            /* [UI-20260826-REOPENWIDE] เจ้าของสั่ง: "ปุ่มเปิดเคสใหญ่ขึ้น + กว้างเท่าคำว่าบอทดูแล"
               ⇒ ห่อสองอันด้วย `inline-flex flex-col` ซึ่ง **หดพอดีลูกที่กว้างที่สุด**
                 (คือป้ายบอทกำลังดูแล) แล้วปุ่มข้างในเป็น `w-full` ⇒ กว้างเท่ากันเป๊ะ
                 โดยไม่ต้องเดาความกว้างเป็นตัวเลข ซึ่งจะเพี้ยนทันทีที่ข้อความเปลี่ยน
               ⚠️ ปุ่มสูงกว่าป้ายได้ (`py-1.5` เทียบกับ `py-0.5`) — เจ้าของขอให้ปุ่ม
                 "ใหญ่ขึ้น" ส่วนป้ายเป็นแค่สถานะ อ่านอย่างเดียว กดไม่ได้ */
            <div className="inline-flex flex-col items-stretch">
              {/* [UI-20260826-LOCKEDCOMPACT] `leading-none` + `py-0.5` ทำให้ป้ายสูง 18px
                  (เดิม 28px) · ขนาดตัวอักษรยังเป็น `text-sm` ตามที่ spec OVERLAYCOMPACT
                  ปักไว้ว่า "ห้ามเล็กกว่า text-sm" — ที่ลดคือช่องว่าง ไม่ใช่ตัวหนังสือ */}
              <span className="bg-slate-600/90 text-white font-bold py-0.5 px-3 rounded-full shadow-md flex items-center justify-center gap-1.5 text-sm leading-none whitespace-nowrap">
                <Bot size={14} />
                {closedNotice}
              </span>
              {/* [FEAT-20260817-REOPENBYADMIN] under the capsule — the overlay is
                  already flex-col, so this slots in without layout surgery. Only
                  rendered when the parent passed the handler (bot-care set). */}
              {onReopen && (
                <button
                  disabled={reopening}
                  onClick={onReopen}
                  className="mt-1 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-3 rounded-full shadow-md active:scale-95 flex items-center justify-center gap-1.5 disabled:opacity-60 text-sm leading-none"
                >
                  {reopening ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                  {t('ticketui.composer.reopen', 'เปิดเคส')}
                </button>
              )}
            </div>
          ) : (
          <button
            disabled={accepting}
            onClick={onAccept}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded-full shadow-md active:scale-95 flex items-center gap-1.5 disabled:opacity-60 text-sm"
          >
            {accepting ? <Loader2 size={14} className="animate-spin" /> : <UserIcon size={14} />}
            {t('ticketui.composer.accept', 'กดรับเคสเพื่อสนทนา')}
          </button>
          )}
        </div>
      ) : null}
  </>
  );
};
