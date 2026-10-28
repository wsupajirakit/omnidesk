/**
 * ProfileHeader.tsx — the customer strip above both right-pane tabs: avatar
 * (with its shield and strike mark), identity line, copy-phone, and the
 * "last updated + refresh" pair.
 *
 * WHAT: moved verbatim from `pages/chat/TicketChat.tsx` (module scope, below
 * `ChatInputBox`), with the `[FEAT-20260731-REFRESHINFO]` block comment that
 * introduced it.
 *
 * WHY: 189 code lines whose every input is the single `ticket` prop plus its
 * own local state (`lastUpdated`, `refreshing`, `copied`, `strikeLocked`,
 * `strikeOpen`, and the `lastFetchRef` cooldown). It touches nothing on the
 * page — the refresh talks to the rest of the app through the
 * `tc:customer-profile-updated` window event, exactly as it did before.
 *
 * ⚠️ ALL state stayed INSIDE this component. Nothing was lifted to the page and
 * nothing was pushed into a child, so the hook order, the mount effect that
 * doubles as the room-open hook, and the 10s refresh cooldown all behave
 * identically (`dev-local` §6.4).
 *
 * ⚠️ The `<span role="button">` over the avatar is NOT a style choice — a real
 * `<button>` there is painted over by an `!important` rule in index.html and
 * blanks the picture. The full explanation travelled with the element.
 *
 * revert: paste the component back into the page below `ChatInputBox`, drop the
 *   line from `./index.ts`, drop the page's import, delete this file.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import { TicketEntry } from '../../../services/chat';
import { avatarRingClass } from '../../../services/chat';
import { getStoredAuth } from '../../../services/authStorage';
import { permAllows } from '../../common/MegaMenu';
import strikeService from '../../../services/strike/strikeService';
import { StrikeCautionMark } from '../../common/strike/StrikeCautionMark';
import { StrikeStatsModal } from '../../common/strike/StrikeStatsModal';
import { StrikeRestrictedPopover } from '../../common/strike/StrikeRestrictedPopover';
import { IgnoreAbandonShield } from '../IgnoreAbandonShield';
import { getCustomerPhone } from '../../common';
import { formatIdentityPanelHeader } from '../../../pages/chat/ticketIdentity';
import { copyText } from '../../../utils/copyText';
import { useI18n } from '../../../i18n';
import { AVATAR_FALLBACK } from './ticketPresentation';

// ── Shared profile header (above both right-pane tabs, matches the mockup) ──
// ==== [FEAT-20260731-REFRESHINFO] START — ปุ่มรีเฟรชข้อมูลลูกค้า + เวลาล่าสุด
// 🔒 งานสาย AUTO — to_dev_auto / to_prod_auto · งาน UI ตามไฟล์ต้นแบบ
//
// ผู้ใช้: "เวลาคือเวลาที่กดปุ่ม refresh + ครั้งแรกที่เข้ามาคือเวลาปัจจุบัน
//          (ไม่ต้องวิ่ง)"
// → เก็บเวลาไว้ใน state ตั้งค่าครั้งเดียวตอน mount แล้วอัปเดตเฉพาะตอนกดปุ่ม
//   **ไม่มี setInterval** นาฬิกาจึงไม่เดิน ตรงตามที่สั่ง
//
// การรีเฟรชใช้ event ที่ระบบมีอยู่แล้ว (`tc:customer-profile-updated`) ซึ่ง
// PersonalPanelNarrow ฟังอยู่และจะไป reloadRawProfile() ให้เอง
// → **ไม่ได้เขียน logic ดึงข้อมูลใหม่** ไม่แตะเงื่อนไข/กฎใดๆ ตามที่ผู้ใช้กำหนด
// revert: ลบ block นี้ + ส่วน JSX ที่มี marker เดียวกันใน ProfileHeader
export const ProfileHeader: React.FC<{
  ticket: TicketEntry;
  /* [FEAT-20260907-PROVCONDS] follow-up world switch (see OperationsPanel) —
     gates the ignore-abandon shield here. Optional, default ON = today. */
  showFollowUps?: boolean;
}> = ({ ticket, showFollowUps = true }) => {
  const ud = ticket.line_user_data;
  const fmtClock = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  // ครั้งแรกที่เข้ามา = เวลาปัจจุบัน · หลังจากนั้นเปลี่ยนเฉพาะตอนกดรีเฟรช
  const [lastUpdated, setLastUpdated] = useState<string>(() => fmtClock(new Date()));
  const [refreshing, setRefreshing] = useState(false);
  // ==== [FIX-20260731-REFRESHTHROTTLE] เบรกกดรัว — 10 วิ ยิงได้ครั้งเดียว
  // ผู้ใช้สั่ง: "กดรัวๆไม่ได้ 10 วิ ได้ 1 ครั้ง (ไม่ได้เตือนหรือแดง แต่จะไม่ดึง
  //             ถ้าดึงมากกว่า 1 ครั้งใน 10 วิ) หน้าบ้านจะต้องไม่รู้ว่าเราหยุดดึง
  //             จะเห็นเหมือนปกติ"
  // → **เงียบสนิท**: ทุกครั้งที่กด ไอคอนยังหมุน + เวลายังอัปเดตเหมือนเดิมเป๊ะ
  //   สิ่งเดียวที่ถูกข้ามคือ "การยิง event ไปดึง API" เท่านั้น
  //   ไม่มี toast · ไม่มีปุ่มแดง · ไม่ disable · ผู้ใช้แยกไม่ออกตามที่สั่ง
  // ใช้ useRef เก็บเวลาที่ยิงจริงครั้งล่าสุด (ไม่ใช้ state — ไม่ต้อง re-render
  // และไม่ทำให้ค่าถูกรีเซ็ตกลางคัน)
  // revert: ลบ lastFetchRef + เงื่อนไข canFetch แล้วให้ dispatch ทุกครั้ง
  const REFRESH_COOLDOWN_MS = 10_000;
  const lastFetchRef = useRef<number>(0);
  const doRefresh = () => {
    if (refreshing) return;              // กันกดซ้อนระหว่างไอคอนยังหมุนอยู่
    setRefreshing(true);
    // หน้าตาอัปเดตเสมอ ไม่ว่าจะยิงจริงหรือไม่ — ผู้ใช้ต้องเห็นเหมือนเดิมทุกครั้ง
    setLastUpdated(fmtClock(new Date()));
    const now = Date.now();
    if (now - lastFetchRef.current >= REFRESH_COOLDOWN_MS) {
      lastFetchRef.current = now;
      // ใช้ช่องทางเดิมของระบบ — panel ฝั่งขวาฟัง event นี้อยู่แล้ว
      window.dispatchEvent(new CustomEvent('tc:customer-profile-updated', {
        detail: { channel_user_id: ud?.line_user_id, action: 'manual_refresh' },
      }));
    }
    // อยู่ในช่วง cooldown → ข้ามการยิงแบบเงียบๆ (ไม่มีสัญญาณใดบอกผู้ใช้)
    setTimeout(() => setRefreshing(false), 600);   // แค่หน่วงให้ไอคอนหมุนพอเห็น
  };
  // ==== [FEAT-20260731-REFRESHINFO] END (ส่วน state · JSX อยู่ด้านล่าง)
  // [FEAT-20260729-IDENTITY] copy used to be silent here — every copy button in
  // the app must confirm, otherwise there is no way to tell it worked.
  const { t } = useI18n();
  // [FIX-20260816-COPYHTTP] was navigator.clipboard?.writeText — a silent no-op on
  // http (API only exists in secure contexts). copyText falls back to execCommand;
  // `'fail'` shows the red toast so a genuine failure is never silent again.
  const [copied, setCopied] = useState<null | 'ok' | 'fail'>(null);

  /* ════ [FEAT-20260826-STRIKESUSPEND] the avatar's strike mark + stats modal ══
     📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`

     WHAT THIS IS FOR: an admin looking at a quiet conversation needs to be able
     to tell "the customer stopped writing" apart from "the bot stopped
     answering them". Those look identical on screen and mean opposite things.

     ⚠️ NO POLLING, NO WEBSOCKET, NO NEW LOOP. Owner, 26/08: hang it on the
     events that already exist — *"เกาะไปกับ ทุกครั้งที่คลิกเปิดห้อง กับ ทุกครั้งที่กดปุ่ม
     refresh"*. This component REMOUNTS per room (it is keyed by the ticket) so
     the mount effect below IS the room-open hook, and it also listens to
     `tc:customer-profile-updated`, which the existing refresh button already
     dispatches a few lines above. One customer, one document, only when an
     admin does something. โตแล้วไม่หนักเพราะไม่มีอะไรวิ่งเอง

     ⚠️ FAILURE IS SILENT ON PURPOSE. If this read fails the mark simply does not
     appear — it must never break the profile header it is borrowing space in.

     revert: delete this block, the two JSX blocks with this tag, and the four
     imports at the top of the file. */
  const [strikeLocked, setStrikeLocked] = useState(false);
  const [strikeOpen, setStrikeOpen] = useState(false);
  const [dismissedPopover, setDismissedPopover] = useState(false);
  /* [FIX-2708-STRIKESUPERADMIN] กติกาเดียวกับ PermissionsGuard ฝั่ง BE:
     system.manage / '*' คือ master key — superadmin จึงเห็นปุ่ม Block/เคลียร์
     ทันทีโดยไม่ต้องติ๊ก strike.manage (เจ้าของสั่ง 27/08) */
  const strikeCanClear = permAllows(
    getStoredAuth()?.permissions ?? [],
    'strike.manage',
  );
  const strikeUserId = ud?.line_user_id;

  const handleDismissPopover = () => {
    setDismissedPopover(true);
    window.dispatchEvent(new CustomEvent('tc:strike-popover-dismissed', {
      detail: { user_id: strikeUserId }
    }));
  };

  const handleOpenStrikeModal = () => {
    setDismissedPopover(true);
    setStrikeOpen(true);
    window.dispatchEvent(new CustomEvent('tc:strike-popover-dismissed', {
      detail: { user_id: strikeUserId }
    }));
    window.dispatchEvent(new CustomEvent('tc:strike-modal-open', {
      detail: { user_id: strikeUserId }
    }));
  };

  useEffect(() => {
    const onDismissed = (e: Event) => {
      const customEvent = e as CustomEvent<{ user_id?: string }>;
      if (!customEvent.detail?.user_id || customEvent.detail.user_id === strikeUserId) {
        setDismissedPopover(true);
      }
    };
    const onModalOpen = (e: Event) => {
      const customEvent = e as CustomEvent<{ user_id?: string }>;
      if (!customEvent.detail?.user_id || customEvent.detail.user_id === strikeUserId) {
        setDismissedPopover(true);
        setStrikeOpen(true);
      }
    };
    window.addEventListener('tc:strike-popover-dismissed', onDismissed);
    window.addEventListener('tc:strike-modal-open', onModalOpen);
    return () => {
      window.removeEventListener('tc:strike-popover-dismissed', onDismissed);
      window.removeEventListener('tc:strike-modal-open', onModalOpen);
    };
  }, [strikeUserId]);

  const readStrike = useCallback(() => {
    if (!strikeUserId) return;
    void strikeService
      .current(strikeUserId)
      .then((r) => setStrikeLocked(!!r.current?.suspended_at))
      .catch(() => {
        /* the header must survive a strike endpoint that is off or broken */
      });
  }, [strikeUserId]);
  useEffect(() => {
    readStrike();
    window.addEventListener('tc:customer-profile-updated', readStrike);
    return () =>
      window.removeEventListener('tc:customer-profile-updated', readStrike);
  }, [readStrike]);
  /* ════ [FEAT-20260826-STRIKESUSPEND] end of state ═══════════════════════ */

  const copy = (v?: string | null) => {
    if (!v) return;
    void copyText(v).then((ok) => {
      setCopied(ok ? 'ok' : 'fail');
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div className="relative p-4 border-b border-border flex items-center justify-between shrink-0 bg-white">
      {copied && (
        <div className={`absolute top-1 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-lg text-white text-[11px] font-bold shadow-lg animate-in fade-in slide-in-from-top-1 duration-150 ${copied === 'ok' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          {copied === 'ok' ? t('ticket.copied') : t('ticketui.profile.copy_failed', 'คัดลอกไม่สำเร็จ')}
        </div>
      )}
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative shrink-0">
          {/* avatar ring by registration (legacy): has full_name → green, else red */}
          <img
            src={ud?.picture_url || AVATAR_FALLBACK}
            alt=""
            /* [FIX-20260826-AVATARBLANK] a broken picture used to leave an EMPTY
               ring. Owner, 26/08, with a screenshot: *"รูปหาย"* — a white circle
               with a green ring and nothing inside, which reads as "this customer
               has no picture" when the truth is "the picture failed to load".
               LINE's CDN URLs are signed and do expire, and the row can also
               arrive without one, so this is not a rare case.
               ⚠️ `onError` clears itself first (`onerror = null`) — without that,
                  a fallback that also failed would loop for ever on the same img.
               ⚠️ NOT a className change: `avatarRingClass` is asserted
                  byte-for-byte by `test/orphanRooms.value.test.ts`. Only two new
                  attributes are added; the class string is untouched.
               รูปพังต้องมีรูปแทน ไม่ใช่วงกลมว่าง ๆ ที่อ่านผิดความหมาย */
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement;
              if (img.src === AVATAR_FALLBACK) return;
              img.onerror = null;
              img.src = AVATAR_FALLBACK;
            }}
            /* [FIX-20260819-AVATARRING] the red/green ring is gone from this panel —
               owner: "กรอบ แดงเขียว ของ panel ฝั่งขวาไม่มีอีกต่อไป". It encoded
               "has a full name / does not", which the panel already states in words
               right beside it, so the ring only added noise. The list cards keep
               their own ring, which encodes something else entirely. */
            /* [FEAT-20260819-ORPHANROOM] same ring as the card and the chat header —
               owner: "กรอบสี avatar เหมือนกันทั้งสามจุด · เงื่อนไขเดียวกัน". */
            className={`w-12 h-12 rounded-full object-cover shadow-sm ${avatarRingClass(ticket)}`} 
          />
          {/* ==== [FEAT-20260821-ABANDONSHIELD] โล่ปิด/เปิดระบบช่วยเหลือลงทะเบียน
              เจ้าของสั่ง: "โล่สีเงินขอบสีเขียวทุกคน ขวาล่าง มีเฉพาะ avatar ฝั่งขวาของ panel"
              ⚠️ วางใน div.relative ที่มีอยู่แล้ว ไม่แตะบรรทัด <img> ข้างบนสักตัวอักษร
                 เพราะ avatarRingClass เข้ารหัส orphan-room และ
                 test/orphanRooms.value.test.ts:200-207 assert สตริงนั้นแบบเป๊ะ
              ⚠️ อัปเดตเฉพาะหน้าจอตัวเอง (เจ้าของยืนยัน 21/08 "realtime ในหน้าตัวเองนั่นแหละ")
                 ⇒ ไม่มี WebSocket event ใหม่ ไม่แตะ useTicketWS
              revert: ลบบล็อกนี้ + import + IgnoreAbandonShield.tsx + ignoreAbandonService.ts + 6 คีย์ i18n */}
          {showFollowUps && (
          <IgnoreAbandonShield
            userData={ud}
            memberId={(ud as { _id?: string } | null | undefined)?._id ?? null}
            t={t}
            onChanged={(next) => {
              if (ud) (ud as { ignore_abandon_assist?: boolean }).ignore_abandon_assist = next;
              setLastUpdated(fmtClock(new Date()));
            }}
          />
          )}
          {/* [FEAT-20260826-STRIKESUSPEND] the click target, and the red mark.
              ⚠️ BOTH ARE SIBLINGS OF THE <img>, exactly like the shield above —
                 not one character of the avatar's own line is touched, because
                 `avatarRingClass` encodes orphan-room and
                 `test/orphanRooms.value.test.ts` asserts that string byte-for-byte.
              ⚠️ The BUTTON is always here, at every strike count: owner, 26/08 —
                 *"avatar panel ขวากดดูสถิติ strike ได้ตลอดนะไม่ต้องรอแดง แต่ปุ่มเคลียร์
                 ต้องรอแดงก่อน"*. Only the MARK waits for red, and only the CLEAR
                 button inside the modal waits for it too. เปิดดูได้เสมอ เคลียร์ต้องรอแดง */}
          {strikeUserId && (
            <span
              role="button"
              tabIndex={0}
              onClick={() => setStrikeOpen(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setStrikeOpen(true);
                }
              }}
              title={t('strike.open_stats')}
              aria-label={t('strike.open_stats')}
              data-testid="strike-avatar-button"
              /* 🔴 A <span role="button">, NOT a <button>. This is not a style
                 preference — a real <button> here BLANKS THE AVATAR.
                 ===================================================================
                 Owner, 26/08, with three screenshots: the same customer's picture
                 drew fine in the list card and the chat header but the right panel
                 showed an empty ring. Same URL (HTTP 200, 39,645 B), same
                 `line_user_data` — so it was never the data or the image.

                 `index.html:495` forces a fill on every button in this column:
                     html:not(.theme-dark) .tc-col-right button:not(.text-primary)
                       { background-color:#E2E8F0 !important }
                 This overlay covers the avatar by design (`inset-0` + `z-10`), so
                 that rule painted a solid grey disc straight over the photo. The
                 element was invisible everywhere else because only THIS column
                 carries `tc-col-right` (TicketChat.tsx:4058).

                 ⚠️ Do NOT "fix" this by adding `bg-transparent`. The rule is
                 `!important` AND more specific (0,3,2) than any single utility
                 class, so it wins regardless. The selector matches the TAG, so the
                 only reliable answer is not to be that tag.
                 กฎยิงที่ตัว tag `button` ⇒ แก้ด้วยคลาสไม่ชนะ ต้องไม่เป็น tag นั้น

                 Keyboard support is kept by hand (`role` + `tabIndex` + Enter/Space)
                 precisely because a span does not bring it for free.
                 revert: turn it back into a <button> — and the avatar goes blank. */
              className="absolute inset-0 z-10 cursor-pointer rounded-full"
            />
          )}
          <StrikeCautionMark
            suspended={strikeLocked}
            label={t('strike.suspended_mark')}
          />
          <StrikeRestrictedPopover
            show={strikeLocked && !dismissedPopover}
            text={t('strike.restricted_popover')}
            manageText={t('strike.restricted_manage')}
            closeText={t('strike.restricted_close')}
            onDismiss={handleDismissPopover}
            onManage={handleOpenStrikeModal}
          />
        </div>
        <div className="min-w-0">
          {/* [FEAT-20260729-IDENTITY] position 2 — pair: "A (B)"
              The copy button copies the PHONE (the useful value to paste
              elsewhere), not the whole formatted string.
              [FEAT-20260729-NOTRIPLE] was the triple, which put the full name
              here too — but the customer card directly below already lists it,
              so the header only repeated what was a few pixels away and pushed
              itself into an ellipsis.
              revert: swap both calls back to formatIdentityTriple. */}
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-lg font-bold text-gray-800 tracking-wide truncate"
                title={formatIdentityPanelHeader(ud, '-')}>
              {formatIdentityPanelHeader(ud, '-')}
            </h2>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> {t('ticket.status_normal')}
            </span>
            {/* [FEAT-20260821-IGNOREABANDON] this customer is not being chased.
                Shown ONLY when the switch is on — an absent badge is the normal
                state and needs no ink.
                ⚠️ `=== true` and not truthy: the column is absent on every member
                   row that predates it, and the API ships the row as it is, so a
                   truthy test would light this up for everyone. เหมือนฝั่ง BE เป๊ะ.
                ⚠️ A SEPARATE element on purpose — it does NOT touch the avatar
                   ring above, which already encodes orphan-room and is asserted
                   byte-for-byte by `test/orphanRooms.value.test.ts`.
                revert: delete this block and its two i18n keys. */}
            {/* [FEAT-20260821-ABANDONSHIELD] badge เดิม **ซ่อน ไม่ลบ** — เจ้าของสั่ง "ซ่อนไว้"
                ทำไว้ก่อนหน้าและผิดโจทย์: แสดงเฉพาะตอน true ทั้งที่คำสั่งเดิมคือโล่ที่แสดง
                ทุกคนและกดได้ · โล่บน avatar แทนที่แล้วและบอกข้อมูลเดียวกันครบกว่า
                ⚠️ ตอนซ่อน badge นี้ยังไม่เคยแสดงบนจอเลยสักครั้ง (DB ไม่มีแถวที่ true)
                ⚠️ ใช้ `false &&` ไม่ใช่คอมเมนต์ครอบ เพราะ tsc/eslint ยังตรวจโค้ดข้างในให้
                   ⇒ ถ้าคีย์ i18n หรือ prop ถูกลบ จะรู้ทันที ไม่ใช่เจอวันที่เอากลับมา
                revert: ลบ `false &&` ออกบรรทัดเดียว */}
            {false && (ud as { ignore_abandon_assist?: unknown } | null | undefined)
              ?.ignore_abandon_assist === true && (
              <span
                data-testid="ignore-abandon-badge"
                title={t('ticket.ignore_abandon_hint')}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-50 text-slate-600 border border-slate-200 shrink-0"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />{' '}
                {t('ticket.ignore_abandon_badge')}
              </span>
            )}
            {/* Copy phone — sits next to the status badge, as requested. Hidden
                when there is no phone, so it can never copy an empty string.
                [FEAT-20260729-COPYICON] icon only: the number is already shown
                in the heading to the left, so printing it on the button too was
                the same value twice. What it copies is unchanged; the number
                stays reachable via the tooltip.
                revert: put `{getCustomerPhone(ud)}` back after the icon. */}
            {getCustomerPhone(ud) && (
              <button
                onClick={() => copy(getCustomerPhone(ud))}
                // [FIX-20260816-COPYHTTP] p-1→p-1.5 + icon 11→13: owner asked all copy
                // buttons ~20% bigger (second round 16/08).
                className="inline-flex items-center justify-center p-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 shrink-0"
                title={`${t('ticket.copy_phone')} : ${getCustomerPhone(ud)}`}
                aria-label={t('ticket.copy_phone')}
              >
                <Copy size={13} />
              </button>
            )}
          </div>
          {/* [FEAT-20260729-NOTRIPLE] second line is the LINE display name ONLY.
              It used to fall back to the nickname, which made this line mean two
              different things depending on the data — and the nickname can also
              be what the line above is showing.
              revert: restore the `: (ud?.nickname || '')` fallback. */}
          <p className="text-xs text-gray-500 font-medium truncate">{ud?.display_name ? `Line : ${ud.display_name}` : ''}</p>
        </div>
      </div>

      {/* ==== [FEAT-20260731-REFRESHINFO] เวลาล่าสุด + ปุ่มรีเฟรช
           วางชิดขวาเป็นคอลัมน์ ตามไฟล์ต้นแบบ (เวลาอยู่บน ปุ่มอยู่ล่าง)
           เวลาไม่วิ่ง — เปลี่ยนเฉพาะตอนกดปุ่ม ตามที่ผู้ใช้กำหนด */}
      <div className="flex flex-col items-end shrink-0 ml-2">
        <span className="text-[10px] text-gray-400 mb-1" title={t('ticketui.profile.last_updated', 'เวลาที่อัปเดตข้อมูลล่าสุด')}>
          {lastUpdated}
        </span>
        <button
          type="button"
          onClick={doRefresh}
          disabled={refreshing}
          className="text-gray-400 hover:text-blue-600 transition-colors p-1.5 rounded-full hover:bg-blue-50 border border-transparent hover:border-blue-100 disabled:opacity-50"
          title={t('ticketui.profile.refresh', 'รีเฟรชข้อมูล')}
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
      {/* [FEAT-20260826-STRIKESUSPEND] the stats modal, mounted only while open.
          It is INSIDE this header's root rather than portalled because it is
          `position: fixed` and so is laid out against the viewport either way,
          and keeping it here means it unmounts with the header when the admin
          switches rooms — no stale modal showing the previous customer.
          ⚠️ `strikeOpen &&` is what makes it cost nothing when nobody opened it:
             the component fetches on mount, so mounting it hidden would fetch
             for every room an admin merely clicked through. ปิดอยู่ = ไม่ยิงเลย */}
      {strikeOpen && strikeUserId && (
        <StrikeStatsModal
          lineUserId={strikeUserId}
          canClear={strikeCanClear}
          onClose={() => setStrikeOpen(false)}
          onCleared={() => {
            /* the mark and the header tray both key off this — re-read through
               the same door the refresh button uses, so there is one path. */
            window.dispatchEvent(
              new CustomEvent('tc:customer-profile-updated', {
                detail: {
                  channel_user_id: strikeUserId,
                  action: 'strike_cleared',
                },
              }),
            );
          }}
        />
      )}
    </div>
  );
};
