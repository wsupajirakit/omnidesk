/**
 * [REFACTOR-20261027-TCSPLIT] One card of the open lists (รอรับเคส / ส่วนตัว / กำลังคุย / บอทดูแล), pin button included.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * Was the card callback handed to `renderTicketStackSlot`; the key moved to the element the page renders.
 * revert: paste the body back where `<TicketCard />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
// [FEAT-20260811-CHATPIN] Pin = the card's pin button
import { AlertTriangle, Bot, Info, Pin, User as UserIcon } from 'lucide-react';
import { AVATAR_FALLBACK } from '../../../../components/chat/ticket-detail';
import { LineLogoIcon } from '../../../../components/common';
import { getDynamicTagColor, thLabel } from '../../../../components/member';
import { avatarRingClass, type CardWindow, isQuietRow, type TicketEntry, unreadFor } from '../../../../services/chat';
// [FEAT-20260819-LINEGLOW] one rule for "this customer has real account data"
import { hasRawProfile } from '../../../../utils/memberSearchText';
import { tierBadgeText, tierOfMember } from '../../../../utils/memberTier';
// [FIX-20260817-DIRECTBADGECLOSED] avatar caution = open case only (see the file)
import { shouldShowDirectTicketBadge } from '../../directTicketBadge';
import { formatIdentityCard, getTicketUserKey, isSameTicketUser } from '../../ticketIdentity';
import { formatRelative } from '../format';
import type { TFn } from '../types';

export type TicketCardProps = {
  tk: TicketEntry;
  selectedTicket: TicketEntry;
  unreadByRoom: Record<string, number>;
  openTicket: (ticket: TicketEntry, closedCases?: TicketEntry[]) => void;
  mainWindow: CardWindow<TicketEntry>;
  cardIdx: number;
  t: TFn;
  oaName: (hookId?: string | null) => string;
  pinnedRooms: string[];
  togglePinnedRoom: (key: string, tk?: TicketEntry) => void;
  categoryBadge: (cat?: string | null) => React.JSX.Element;
  setTagInfoTicket: React.Dispatch<React.SetStateAction<TicketEntry>>;
  showTierBadge: boolean;
};

export const TicketCard: React.FC<TicketCardProps> = ({
  tk,
  selectedTicket,
  unreadByRoom,
  openTicket,
  mainWindow,
  cardIdx,
  t,
  oaName,
  pinnedRooms,
  togglePinnedRoom,
  categoryBadge,
  setTagInfoTicket,
  showTierBadge,
}) => {
  const ud = tk.line_user_data;
  const selected = selectedTicket?._id === tk._id || isSameTicketUser(selectedTicket, tk);
  const admin = tk.admin_user_data?.display_name;
  const isBot = tk.chat_status === 'bot';
  // Live unread (yellow) — a new inbound message arrived while this
  // card wasn't open. Key may be chat_room_id or line_user_id.
  // [FIX-20260819-UNREADKEY] `ud?.line_user_id` is the LINE U-string and the
  // only id this row shares with a message event. The two keys before it are
  // kept so nothing that used to match stops matching.
  /* [FIX-20260819-ORPHANQUIET] no number on a conversation that never
     became a case — the orange ring is its whole signal. */
  const unread = isQuietRow(tk) ? 0 : unreadFor(unreadByRoom, tk as any);
  return (
    <div
      key={tk._id}
      data-chat-card
      onClick={() => openTicket(tk)}
        /* [FEAT-20260819-CARDWINDOW] same reveal as the closed list. */
        style={mainWindow.isFresh(cardIdx) ? { animationDelay: `${Math.min(cardIdx % 25, 8) * 25}ms` } : undefined}
      className={`${mainWindow.isFresh(cardIdx) ? 'tc-card-reveal' : ''} group/card p-3 cursor-pointer border-l-4 transition-colors relative border-b border-gray-100 dark:border-gray-800/60 ${selected ? 'tc-card-selected border-blue-600 dark:border-sky-400 bg-blue-200/80 dark:bg-blue-600/50 shadow-sm ring-1 ring-blue-500/30' : 'border-transparent hover:bg-gray-50/80 dark:hover:bg-slate-800/50'}`}
    >
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {/* [FIX-20260809-AVATARLAZY] ticket-card avatar: defer
              off-screen loads. A long ticket list requests one
              avatar per card up front, all at once, competing
              with the data the operator is actually waiting for.
              `lazy` fetches only what scrolls into view;
              `decoding="async"` keeps decode off the main thread.
              ⚠️ Browser-native attributes only — no JS, no state,
              and nothing here touches the realtime path this file
              also owns. Visible avatars still load exactly as
              before. รูปที่เห็นอยู่โหลดเหมือนเดิมทุกอย่าง.
              revert: delete the two attributes. */}
          {/* [FEAT-20260810-DIRECTTICKET] ป้ายเตือนบน avatar เมื่อเป็น
              ticket ที่ระบบเปิดให้เอง (direct_ticket) — ไม่ได้มาจากลูกค้าทัก
              ⚠️ วางทับมุมขวาล่าง ขนาด 16px: เห็นชัดแต่ไม่บังหน้าลูกค้า
              ⚠️ ring สีพื้นการ์ดคั่นไว้ ไม่งั้นไอคอนจมไปกับขอบ avatar
              ticket เก่า/ปกติไม่มี field นี้ ⇒ undefined ⇒ ไม่แสดง = seamless
              revert: เอา div ครอบออก เหลือ <img> ตัวเดิม
              [FIX-20260817-DIRECTBADGECLOSED] เงื่อนไขย้ายไป
              `shouldShowDirectTicketBadge` — ปิดเคส (job_status 2) แล้ว
              ป้ายต้องหาย (แท็บ ปิดเคส/บอทดูแล เคยติดค้างถาวร เพราะ
              `direct_ticket` ยังเป็น true ในแถวที่ปิดแล้ว) */}
          <div className="relative shrink-0">
            {/* [FEAT-20260819-ORPHANROOM] every card is ringed green;
                the rooms that never produced a ticket are ringed ORANGE so
                the new group is obvious at a glance without a legend.
                การ์ดปกติเขียว · กลุ่มที่ไม่เคยมีเคสส้ม. */}
            <img
              src={ud?.picture_url || AVATAR_FALLBACK}
              alt=""
              loading="lazy"
              decoding="async"
              /* [FIX-20260826-AVATARBLANK] same gap as the panel
                 avatar — a dead URL left an empty ring here too. */
              onError={(e) => {
                const img = e.currentTarget as HTMLImageElement;
                if (img.src === AVATAR_FALLBACK) return;
                img.onerror = null;
                img.src = AVATAR_FALLBACK;
              }}
              className={`w-9 h-9 rounded-full object-cover ${avatarRingClass(tk)}`}
            />
            {shouldShowDirectTicketBadge(tk) && (
              <span
                className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-orange-500 ring-2 ring-white dark:ring-slate-900"
                title={String((tk as any)?.direct_ticket_detail || t('ticketui.card.auto_opened', 'ระบบเปิดเคสนี้ให้อัตโนมัติ'))}
              >
                <AlertTriangle size={10} className="text-white" strokeWidth={3} />
              </span>
            )}
          </div>
          <div className="overflow-hidden min-w-0">
            {/* [FEAT-20260729-IDENTITY] position 1 — pair: "A (B)"
                [FIX-20260814-CARDNOLINE] card only: same pair without
                the "Line :" prefix (owner, 14/08). The right panel and
                the pin menu still use formatIdentityPair. */}
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight truncate"
                title={formatIdentityCard(ud, tk.line_user_id)}>
              {formatIdentityCard(ud, tk.line_user_id)}
            </h3>
            <div className="flex items-center gap-1.5 truncate mt-0.5">
              {/* [FEAT-20260819-LINEGLOW] same signal on the main list card. */}
              <LineLogoIcon className={`w-[18px] h-[18px] shrink-0 ${hasRawProfile(ud) ? '' : 'tc-line-dim'}`} />
              <span className="text-[14px] text-gray-500 dark:text-gray-400 font-medium truncate">{oaName(tk.line_oa_hook_id) || '—'}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0 ml-2">
          <span className="text-[11px] text-gray-500 flex items-center gap-1">
            {isBot ? <Bot size={11} /> : admin ? <UserIcon size={11} /> : <UserIcon size={11} />}
            {isBot ? t('ticketui.tab.bot', 'บอทดูแล') : admin || t('ticketui.card.unassigned', 'ว่าง')}
          </span>
          <span className={`text-[10px] mt-1 flex items-center gap-1 ${unread ? 'tc-unread-text font-bold' : 'text-gray-400'}`}>
            {unread > 0 && (
              <span className="tc-unread-badge inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold leading-none animate-pulse">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
            {/* [DOC-20260918-SCOPEFIELD] the card shows LAST TOUCHED
                (`updated_at`), which is the useful fact while working a
                case. ⚠️ The ⚙️ "7 วัน" window does NOT filter on this —
                it filters on `created_at`, i.e. WHEN THE CASE WAS OPENED
                (owner's decision, 18/09). The two differ on 119 of 176
                tickets in the local set, one by 188 hours, so a card can
                read today's date and still sit outside the window. That
                is expected, not a bug. Options considered and the
                reasoning live at
                omnidesk-api/src/modules/tickets/tickets.service.ts
                [DOC-20260918-SCOPEFIELD].
                การ์ดโชว์วันที่แตะล่าสุด · ตัวกรองใช้วันที่เปิดเคส คนละค่า ตั้งใจให้ต่าง */}
            {formatRelative(tk.updated_at)}
          </span>
        </div>
      </div>
      <div className="pl-11 pr-2 mt-0.5">
        <p className="text-xs text-gray-600 dark:text-gray-300 truncate font-medium">
          {tk.need_detail || (tk as any).last_message || (tk as any).message_text || ''}
        </p>
      </div>
      {/* ==== [FEAT-20260801-CARDTIER] แถวล่างของการ์ด: หมวด+ป้าย ชิดซ้าย · ป้ายเทียร์ชิดขวา
           ⚠️ เดิมลูกทั้งหมดอยู่ใน flex เดียวที่ overflow-hidden + shrink-0
              ถ้าเอาป้ายเทียร์ไปต่อท้ายเฉยๆ พอป้ายลูกค้ายาว "ตัวที่โดนตัดคือป้ายเทียร์"
              → แยกเป็น 2 ฝั่ง: ฝั่งซ้าย min-w-0 ให้หด/ตัดได้ (มีปุ่ม +N รองรับอยู่แล้ว)
                ฝั่งขวา shrink-0 ป้ายเทียร์จึงไม่มีทางหาย
           ⚠️ เนื้อในฝั่งซ้ายยกมาทั้งดุ้น ไม่แตะเงื่อนไข/คลาสเดิมสักตัว
           revert: เอา div ครอบ 2 ชั้นออก คืนเป็น flex เดียวแบบเดิม + ลบป้ายเทียร์ */}
      <div className="pr-2 mt-1 flex items-center gap-1">
        {/* [FEAT-20260811-CHATPIN] ปุ่มหมุด — **ตรงใต้ avatar เป๊ะ**
            เจ้าของสั่ง 2026-08-11 ไล่มา 4 รอบ: ขวาแถวชื่อ → overlay บนรูป →
            block ล่าง avatar หน้าป้าย → **"ย้ายออกไปให้ตรงล่างกับ avatar เลย"**
            ⚠️ ทำไมต้องออกมาไว้นอกกล่องป้าย: แถวป้ายมี `pl-11` (44px) ซึ่ง**เลย**
               ขอบขวาของ avatar ไปแล้ว (avatar = p-3 12px + w-9 36px) ⇒ วางข้างใน
               เท่าไหร่ก็ไม่ตรงกับรูป · ตอนนี้ปุ่มเป็นลูกตัวแรกของแถว (ไม่มี pl-11)
               แล้วให้กล่องป้ายถือ `pl-*` ที่เหลือเอง ⇒ หมุดตรงกับ avatar พอดี
            ⚠️ อยู่นอกกล่อง `overflow-hidden` แล้ว ⇒ ป้ายลูกค้ายาวแค่ไหนก็ไม่ตัดหมุด
            · ขนาด 22px (+25% จาก 18px ตามที่สั่ง "ใหญ่ขึ้น +25%")
            · `ml-[7px]` มาจากการวัด ไม่ใช่กะ: การ์ด `p-3`=12px · avatar `w-9`=36px
              ⇒ กลาง avatar = 12+18 = **30px** · ปุ่มกว้าง 22px ⇒ ขอบซ้าย = 30-11 = 19px
              ⇒ 19-12 = **7px** · (ก่อนหน้าใช้ `ml-3`=12px ⇒ เริ่มที่ 24px = เยื้องขวา 5px
              เจ้าของแจ้งว่า "ยังไม่กลาง avatar")
            · `mr-1.5` ถ่างจากป้ายแรก — เจ้าของแจ้งว่า "มันใกล้ป้ายเกินไป"
              (แถวนี้ `gap-1`=4px เดิมแคบเกินเมื่อหมุดโตขึ้นเป็น 22px)
            · **ปักแล้ว** = badge ฟ้า (`tc-pin-badge`) เด่นทั้ง dark/light
              ห้ามกลับเป็นส้ม — ชนกับป้าย caution บน avatar ใบเดียวกัน
            · **ยังไม่ปัก** = `opacity-80` เห็นชัดตลอด (light ใช้ slate-600 ออกดำ
              ตามที่แจ้งว่าสีอ่อนมองไม่เห็นบนธีมสว่าง) เต็มตอน hover การ์ด
            · `stopPropagation` เพราะการ์ดทั้งใบมี onClick เปิดเคส */}
        {(() => {
          const isPinned = pinnedRooms.includes(getTicketUserKey(tk));
          return (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); togglePinnedRoom(getTicketUserKey(tk), tk); }}
              title={isPinned ? t('ticketui.pin.remove', 'เอาหมุดออก') : t('ticketui.pin.add', 'ปักหมุดไว้บนสุด')}
              aria-label={isPinned ? t('ticketui.pin.remove', 'เอาหมุดออก') : t('ticketui.pin.add', 'ปักหมุดไว้บนสุด')}
              aria-pressed={isPinned}
              className={
                isPinned
                  ? 'tc-pin-badge ml-[7px] mr-1.5 shrink-0 grid place-items-center w-[22px] h-[22px] rounded-full transition-transform hover:scale-110 active:scale-95'
                  : 'tc-pin-idle ml-[7px] mr-1.5 shrink-0 grid place-items-center w-[22px] h-[22px] rounded-full opacity-80 group-hover/card:opacity-100 hover:bg-gray-100 dark:hover:bg-slate-700/60 transition-all'
              }
            >
              <Pin size={13} strokeWidth={3} className={isPinned ? 'fill-current' : ''} />
            </button>
          );
        })()}
        <div className="flex flex-nowrap gap-1 items-center overflow-hidden min-w-0">
          <span className="shrink-0">{categoryBadge(tk.category)}</span>
          {(tk.customer_tags || []).slice(0, 1).map(cg => (
            <span key={cg._id} className={`tag-item shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${getDynamicTagColor(cg.label, cg.color)}`}>
              {thLabel(cg.label)}
            </span>
          ))}
          {(tk.customer_tags?.length || 0) > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); setTagInfoTicket(tk); }}
              className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 px-1.5 py-0.5 rounded-full transition-colors cursor-pointer"
              title={t('ticketui.tags.view_all', 'ดูป้ายทั้งหมด')}
            ><Info size={10} /> +{(tk.customer_tags!.length) - 1}</button>
          )}
        </div>
        {/* ป้ายเทียร์ของลูกค้า — มาจาก Member.tier ที่ webhook เก็บไว้ตอนดึง raw profile
            ไม่มีเทียร์ (ลูกค้าที่ยังไม่ผูกบัญชี / OA ที่ไม่ได้ต่อ custom tool) = ไม่แสดงอะไรเลย
            ใช้ชุดสีเดียวกับป้ายเทียร์บนหัวแชท เพื่อให้จำได้ว่าเป็นข้อมูลตัวเดียวกัน */}
        {/* [FIX-20260810-TIERSOURCE] อ่าน tier ผ่าน helper กลาง —
            raw_profile_data (ที่ webhook เขียนไว้) ก่อน ค่อยตกไป members.tier
            header ใช้ helper ตัวเดียวกัน ⇒ 2 จุดตรงกันเสมอ
            revert: กลับไปอ่าน tk.line_user_data?.tier ตรง ๆ */}
        {/* [FEAT-20260905-CUSTPROV PART 4] `showTierBadge` governs
            BOTH badge sites or neither — this card AND the room
            header in ChatRoomView.tsx. [FIX-20260810-TIERSOURCE]
            is the regression a switch reaching only one site
            would recreate. */}
        {showTierBadge && tierOfMember(tk.line_user_data) && (
          <span
            /* [FEAT-20260801-CARDTIER] ธีม dark ใช้ตัวหนังสือสีขาว
               ธีม light ทำพื้นป้ายให้จาง + ตัวหนังสือม่วงเข้ม อ่านออกดี
               แต่ธีม dark พื้นกลายเป็นเข้ม ตัวหนังสือ purple-700 เลยจมไปกับพื้น
               → dark:text-white อย่างเดียว ไม่แตะพื้น/เส้นขอบ
               ⚠️ `dark:` ของโปรเจกต์นี้ผูกกับ .theme-dark (ดู @custom-variant
                  ใน index.css) ไม่ใช่ prefers-color-scheme ของเบราว์เซอร์
               ⚠️ ป้ายเทียร์บน "หัวแชท" เป็นคนละตัว (panel-badge-purple ที่มี
                  กฎสีของตัวเองใน index.css ซึ่งผู้ใช้เคยปรับไว้) — ไม่แตะ */
            className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:text-white border border-purple-200"
            title={t('ticketui.card.tier', 'ระดับสมาชิก: {v}', { v: tierBadgeText(tierOfMember(tk.line_user_data)) })}
          >
            💎 {tierBadgeText(tierOfMember(tk.line_user_data))}
          </span>
        )}
      </div>
    </div>
  );
};
