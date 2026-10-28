/**
 * [FEAT-20260905-CUSTPROV PART 5] The chat-room header bar.
 * ============================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 5 §24-28, **as corrected by PART 7 §38**.
 *
 * WHAT: the bar across the top of an open conversation —
 *       `0925550014 | ไอติม | bbbb` · 💎 Normal 0 · `omnidesk-dev-oa` ⓘ ·
 *       `270/300 ใช้ไปแล้ว · เหลือ 30` · AA · 🔍 · ปิดเคส / เคสนี้ปิดแล้ว.
 *
 * WHY:  it was ~254 lines of JSX inside a 1,997-line `ChatRoomView.tsx`, pulling
 *       from five unrelated places. It renders on EVERY open room, so it is the
 *       most-seen surface in the product and the most expensive one to get
 *       wrong. Its own module means the next change to it is a small diff in a
 *       small file instead of surgery inside the biggest component in the
 *       chat folder.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ 🔴 THE RULE — three things this bar may NEVER stop showing (plan §26).   ║
 * ║ Not a note, not a preference: a RULE. Any future variant, provider view  ║
 * ║ or flag that would remove one of these is rejected, and the boundary is  ║
 * ║ re-cut instead.                                                          ║
 * ║                                                                          ║
 * ║  1. THE QUOTA GAUGE. It shows a live LINE push balance and belongs to    ║
 * ║     the OA, not to any customer's data shape. Hiding it hides how many   ║
 * ║     messages the business can still send.                                ║
 * ║  2. THE CLOSE-CASE CONTROL AND THE CLOSED-CASE BRANCH. This is ticket    ║
 * ║     state. Hiding it strands an operator in a case with no way to close  ║
 * ║     it.                                                                  ║
 * ║  3. AA (FONT SCALE) AND SEARCH. Accessibility and navigation. Neither is ║
 * ║     a data shape, so no data shape gets a say in them.                   ║
 * ║                                                                          ║
 * ║ ห้ามซ่อนสามอย่างนี้เด็ดขาด — ถ้าเจ้าไหน "จำเป็นต้องซ่อน" แปลว่าตัดเส้นผิด ไปตัดใหม่ ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 THERE IS DELIBERATELY NO `providers/` FOLDER AND NO REGISTRY HERE.
 *    §25 originally sketched `room-header/providers/registry.ts` mapping a
 *    provider key to a header variant. PART 7 §38 overrules it: "No
 *    `providers/` folder on the FE at all. The FE knows `type`s, never provider
 *    names… §25's header module follows the same correction." A provider list
 *    on the front end is the exact debt this design exists to delete — it costs
 *    an FE release per provider. When the varying half arrives it arrives as a
 *    served `view`, and this file will render fields, not branch on names.
 *    Until then there is nothing to vary on, and a registry with one entry
 *    would be a decision pretending to be code. อย่าสร้างทะเบียนที่มีของอยู่ชิ้นเดียว
 *
 * WHAT IS *NOT* IN THIS FOLDER, on purpose:
 *   · `../HeaderQuotaGauge.tsx` and `../headerNameDedup.ts` stay where they
 *     are and are imported. They were already correctly placed and already
 *     tested; moving them would be churn with a diff attached (§25).
 *
 * ⚠️ NO STATE MOVED — `dev-local §6.4`. Every `useState` this bar reads stays in
 *    `ChatRoomView.tsx` and arrives here as a prop, because each one ALSO
 *    drives something outside the bar: `searchOpen` drives the search panel,
 *    `showUserDetail` the detail box, `quotaOpen` the QuotaModal, and the three
 *    quota counters are fed by effects on the room id and a window event.
 *    Extracting a `useState` into a child changes re-render and effect timing,
 *    which is a behaviour change, not a move.
 *
 * ⚠️ THE SECOND ROW'S GATE IS GONE, AS ITS OWN DECISION.
 *    It read `{(oaName || headerTier) && …}` and wrapped the OA name, the ⓘ,
 *    the gauge AND the whole control cluster, so with neither an OA name nor a
 *    tier none of them rendered. Carried verbatim through the move and flagged
 *    there, then fixed separately — see [FIX-20260906-HEADERCONTROLS] below.
 *
 * REJECTED ALTERNATIVE — keep the entire bar in this one file, no `parts/`.
 *    Fewer files, and the diff would have been a pure cut-and-paste. Rejected
 *    because the single file measured ~410 lines: over `dev-local §6.1`'s 400,
 *    which would have required adding a NEW name to the eslint waiver list, and
 *    that list may only shrink. The three parts are cut where the file was
 *    already going to be cut by that rule.
 *
 * revert: delete `components/chat/room-header/` and paste `RoomHeader`'s JSX
 *         (plus `parts/*`'s JSX at their mount sites) back into
 *         `ChatRoomView.tsx` where `<RoomHeader …/>` now stands, restoring the
 *         inline `setSearchOpen` / `setShowUserDetail` / `setQuotaOpen`
 *         closures. Nothing else changed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Info } from 'lucide-react';

import type { ChatRoom } from '../../../services/chat';
/* [FEAT-20260819-ORPHANROOM] one rule for the avatar ring, shared with the ticket page */
import { avatarRingClass } from '../../../services/chat';
/* [FEAT-20260819-LINEGLOW] the same "has real account data" rule the cards use */
import { hasRawProfile } from '../../../utils/memberSearchText';
import type { MemberTier } from '../../../utils/memberTier';
/* [FIX-20260814-CUSTOMERNAME] `customerName` skips the backend's "Unknown" placeholder */
import { LineLogoIcon, customerName } from '../../common';
import { StrikeCautionMark } from '../../common/strike/StrikeCautionMark';
import { StrikeRestrictedPopover } from '../../common/strike/StrikeRestrictedPopover';
import { StrikeStatsModal } from '../../common/strike/StrikeStatsModal';
import strikeService from '../../../services/strike/strikeService';
import { getStoredAuth } from '../../../services/authStorage';
import { permAllows } from '../../common/MegaMenu';
import { useI18n } from '../../../i18n';
/* [FEAT-20260819-INCHATTOAST] the notice centred ON this header */
import { NewMessageToast } from '../NewMessageToast';
/* [FEAT-2708-HEADERQUOTA] the always-visible quota strip + its own warning toast */
import { HeaderQuotaGauge, QuotaWarningToast } from '../HeaderQuotaGauge';

import { HeaderNameLine } from './parts/HeaderNameLine';
import { HeaderTierBadge } from './parts/HeaderTierBadge';
import { HeaderActions, type HeaderActionsProps } from './parts/HeaderActions';

export interface RoomHeaderProps extends HeaderActionsProps {
  /** The room being shown — the bar reads its avatar, identity fields and hook id. */
  activeRoom: ChatRoom;
  /** [FEAT-20260819-ORPHANROOM] a conversation that never became a case (ring only). */
  isOrphanRow?: boolean;
  /** A caller's own wording for the title segment, e.g. the ticket page's phone number. */
  headerTitle?: string;
  /** [FIX-20260801-HEADER2LINE] the LINE OA name; omitted ⇒ the OA chip is not drawn. */
  oaName?: string;
  /** [FIX-20260810-TIERSOURCE] the tier already resolved from the ticket's member. */
  headerTier: MemberTier;
  /** [FEAT-20260905-CUSTPROV PART 4] already defaulted to `true` by the caller. */
  showTierBadge: boolean;
  /** The populated member, when the caller has one — only the LINE glow reads it. */
  memberData?: unknown;
  /** Fallback hook id when the room carries none. */
  hookId?: string;
  /** [FEAT-20260819-INCHATTOAST] bumped when a message lands in the open room. */
  newMsgTick: number;
  /** [FEAT-2708-HEADERQUOTA] the three counters — see ChatRoomView, they are fed there. */
  quotaTick: number;
  quotaForceTick: number;
  quotaWarnTick: number;
  /** Crossing INTO ≥90% — bumps `quotaWarnTick` in the parent. */
  onQuotaDanger: () => void;
  /** [FEAT-20260815-LINEQUOTA] the ⓘ and the gauge both open the same dialog. */
  onOpenQuota: () => void;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  activeRoom,
  isOrphanRow,
  headerTitle,
  oaName,
  headerTier,
  showTierBadge,
  memberData,
  hookId,
  newMsgTick,
  quotaTick,
  quotaForceTick,
  quotaWarnTick,
  onQuotaDanger,
  onOpenQuota,
  ...actions
}) => {
  const { t } = useI18n();
  const [strikeLocked, setStrikeLocked] = useState(false);
  const [strikeOpen, setStrikeOpen] = useState(false);
  const [dismissedPopover, setDismissedPopover] = useState(false);

  const strikeCanClear = permAllows(
    getStoredAuth()?.permissions ?? [],
    'strike.manage',
  );
  const strikeUserId = activeRoom.user_data?.line_user_id || activeRoom.line_user_id;

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
    if (!strikeUserId) {
      setStrikeLocked(false);
      return;
    }
    void strikeService
      .current(strikeUserId)
      .then((r) => setStrikeLocked(!!r.current?.suspended_at))
      .catch(() => {
        /* silent failure on error */
      });
  }, [strikeUserId]);

  useEffect(() => {
    readStrike();
    window.addEventListener('tc:customer-profile-updated', readStrike);
    return () =>
      window.removeEventListener('tc:customer-profile-updated', readStrike);
  }, [readStrike]);

  return (
  /* Header — single line: avatar + phone/name (nickname) */
  /* [FIX-20260731-LIGHTSURFACE] เดิม bg-white/90 = ขาวจั๊วในธีม light
     เติมคลาส tc-chat-header ไว้ให้ CSS ใน index.css ทับสีได้ (เฉพาะ light)
     ยังคง bg-white/90 ไว้เป็น fallback ถ้าบล็อกใน index.css ถูกถอดออก
     revert: ลบคลาส tc-chat-header ออก */
  <div className="tc-chat-header relative px-3 py-2 border-b border-slate-200 flex items-center justify-between bg-white/90 backdrop-blur-sm z-10 shrink-0">
    {/* [FEAT-20260819-INCHATTOAST] the new-message notice is centred ON this
        header (the host must stay `relative`) — see NewMessageToast.tsx for
        why it moved off the message stream. */}
    <NewMessageToast trigger={newMsgTick} />
    {/* [FEAT-2708-HEADERQUOTA] its OWN toast instance — same spot, never
        the same counter (owner: คนละ instance) */}
    <QuotaWarningToast trigger={quotaWarnTick} />
    <div className="flex flex-1 items-center gap-2.5 min-w-0">
      <div className="relative shrink-0 flex items-center justify-center">
        <img
          src={activeRoom.user_data?.picture_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}
          alt="avatar"
          /* [FEAT-20260819-ORPHANROOM] the same ring the card and the right panel
             wear — one rule, three places (services/chat/orphanRooms). */
          className={`w-8 h-8 rounded-full object-cover shrink-0 ${avatarRingClass({ is_orphan_room: isOrphanRow })}`}
        />
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
            data-testid="strike-avatar-button-header"
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
      {/* ==== [FIX-20260801-HEADER2LINE] START — หัวแชท 2 บรรทัด
           บรรทัดบน : เบอร์ | ชื่อจริง        (คั่นด้วย | ไม่ใช้วงเล็บ **ไม่มีโลโก้ LINE**)
           บรรทัดล่าง: [โลโก้ LINE] ชื่อ LINE + ป้ายเทียร์

           ⚠️ ประวัติการสลับไปมา — อ่านก่อนแก้ จะได้ไม่วนซ้ำ:
              2 บรรทัด → (ผู้ใช้สั่ง) ยุบเหลือบรรทัดเดียว HEADER1LINE
                       → (ผู้ใช้สั่งอีกครั้ง 2026-08-01) กลับมา 2 บรรทัดตามเดิม
              เอาโครงเดิมกลับมาทั้งดุ้น ไม่ได้เขียนใหม่ เพื่อให้เหมือนของเดิมเป๊ะ

           ⚠️ ข้อมูลที่แสดงเป็นชุดเดิมทุกตัว ไม่ได้เพิ่ม/ตัดอะไร แค่จัดวางใหม่
           ⚠️ เงื่อนไขเดิมคงไว้ครบ: ชื่อจริงโชว์เมื่อมีและไม่ซ้ำกับเบอร์ ·
              ชื่อ LINE โชว์เมื่อมี nickname → ตัวคั่น | ไม่มีทางโผล่มาลอยๆ
           ⚠️ แถวล่างทั้งแถวโผล่ต่อเมื่อมีอย่างน้อยหนึ่งอย่าง (ชื่อ LINE หรือป้ายเทียร์)
              ไม่งั้นจะได้แถวเปล่าดันหัวแชทสูงขึ้นโดยไม่มีอะไรอยู่ข้างใน
           revert: เอาบล็อก HEADER1LINE (บรรทัดเดียว) กลับมา */}
      <div className="min-w-0 flex-1">
        {/* บรรทัดบน — เบอร์ | ชื่อจริง | ชื่อ LINE */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <HeaderNameLine
            headerTitle={headerTitle}
            first={headerTitle || customerName(activeRoom.user_data)}
            full_name={activeRoom.user_data?.full_name}
            nickname={activeRoom.user_data?.nickname}
          />
        </div>
        {/* บรรทัดล่าง — [โลโก้ LINE] ชื่อ OA + ป้ายเทียร์ + แถวปุ่ม

            🔴 [FIX-20260906-HEADERCONTROLS] THIS ROW USED TO BE GATED ON
            `(oaName || headerTier)`, AND THE GATE HID THE CONTROLS WITH THEM.

            Its stated purpose was to stop an EMPTY row pushing the chat header
            taller — but the row can never be empty: `<HeaderActions>` is inside
            it and its search control is UNCONDITIONAL (`ChatRoomView` owns
            `searchOpen` and always passes `onToggleSearch`). So the gate never
            prevented an empty row. What it did do was hide search, AA and
            close-case whenever there was no OA name and no tier — and the
            legacy page sends no `oaName` at all, so a customer with no tier
            left the operator with NO WAY TO CLOSE THE CASE, the exact outcome
            plan §26 names when it says those three may never be hidden.
            gate เดิมไม่ได้กันแถวเปล่า มันซ่อนแถวที่มีของอยู่แล้ว

            Removed rather than rewritten. An earlier attempt kept a gate listing
            the five possible occupants, but every one of them is reachable
            through `onToggleSearch`, which is always present — the condition was
            `true` written five ways. A case in the characterization pins that
            the search control stays unconditional, so anyone who makes it
            conditional lands back on this decision.

            ⚠️ DELIBERATE BEHAVIOUR CHANGE, not a move: with neither an OA name
            nor a tier the row now renders, carrying the controls.
            revert: wrap this block in `{(oaName || headerTier) && ( … )}` and
            accept that an operator can be stranded with no close-case button. */}
        <div className="flex items-center gap-2 mt-0.5 min-w-0">
            <HeaderTierBadge tier={headerTier} show={showTierBadge} />
            {/* ชื่อ LINE OA ที่ลูกค้าคุยอยู่ — ของใหม่ เดิมหัวแชทไม่เคยบอก
                โลโก้ LINE นำหน้าเพื่อบอกว่านี่คือช่องทาง LINE (ย้ายมาจากบรรทัดบน)
                หน้า legacy ไม่ส่ง oaName มา → ไม่แสดง ไม่กระทบของเดิม */}
            {oaName && (
              <span className="text-[13px] text-slate-600 font-medium truncate inline-flex items-center gap-1.5">
                {/* [FEAT-20260819-LINEGLOW] the open conversation's header carries
                    the same signal as its card, read from the member this view
                    already has — no extra request. */}
                <LineLogoIcon className={`w-4 h-4 shrink-0 ${hasRawProfile((memberData ?? activeRoom.user_data) as never) ? '' : 'tc-line-dim'}`} />{oaName}
              </span>
            )}
            {/* [FEAT-20260815-LINEQUOTA] ⓘ → this OA's remaining push quota,
                the same dialog the customer panel opens. Owner, 15/08:
                "มี icon info ด้วย กดแล้วแสดงโควต้าเหมือนกัน".

                The hook id follows the resolution ChatRoomView uses
                everywhere else — `activeRoom.hook_id || hookId` — so no new
                lookup. Hidden when neither resolves, rather than opening a
                dialog that can only fail. `shrink-0` keeps it visible while
                the OA name truncates: the button must never be the part that
                disappears on a narrow panel. */}
            {(activeRoom.hook_id || hookId) && (
              <button
                type="button"
                onClick={onOpenQuota}
                title={t('ticketui.header.quota_info', 'โควตาข้อความของ LINE OA นี้')}
                className="shrink-0 p-0.5 rounded-md text-slate-400 hover:text-primary hover:bg-slate-100 active:bg-slate-200 transition-colors select-none"
              >
                <Info size={13} />
              </button>
            )}
            {/* [FEAT-2708-HEADERQUOTA] the number itself, always on show —
                the ⓘ dialog stays as the detailed view. Same hook-id
                resolution as the button above. */}
            {(activeRoom.hook_id || hookId) && (
              <HeaderQuotaGauge
                hookId={activeRoom.hook_id || hookId}
                refreshTick={quotaTick}
                forceTick={quotaForceTick}
                onDanger={onQuotaDanger}
                /* [FEAT-2708-GAUGECLICK] กดเกจ = เปิด modal เดียวกับปุ่ม ⓘ */
                onOpenDetail={onOpenQuota}
              />
            )}
          <HeaderActions room={actions.room ?? activeRoom} {...actions} />
        </div>
      </div>
      {/* ==== [FIX-20260801-HEADER2LINE] END */}
    </div>

    {strikeOpen && strikeUserId && (
      <StrikeStatsModal
        lineUserId={strikeUserId}
        canClear={strikeCanClear}
        onClose={() => setStrikeOpen(false)}
        onCleared={readStrike}
      />
    )}
  </div>
  );
};

