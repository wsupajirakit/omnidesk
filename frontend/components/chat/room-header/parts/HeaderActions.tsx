/**
 * [FEAT-20260905-CUSTPROV PART 5] The chat-room header's right-hand control cluster.
 * ============================================================================
 * WHAT: the `ml-auto` row at the end of the header's second line — AA (font
 *       scale) · search · close-case / "เคสนี้ปิดแล้ว" · detail box · collapse ·
 *       expand · close. Markup lifted byte-identical from `ChatRoomView.tsx`
 *       (`:1174-1287` before the move).
 *
 * WHY THIS FILE EXISTS AT ALL — it is not shape-chasing. Two reasons, in order:
 *   1. `dev-local §6.1`: no file over 400 lines, and the eslint waiver list may
 *      only shrink. The whole bar in one `RoomHeader.tsx` measured ~410 lines,
 *      which would have meant adding a NEW name to that list — forbidden.
 *   2. This cluster is genuinely self-contained: one element subtree, zero
 *      state of its own, zero effects, props and callbacks only. It is the
 *      cheapest honest cut on the bar.
 *
 * 🔴 EVERY CONTROL IN THIS FILE IS IN PLAN §26's "MAY NEVER VARY" SET. Search
 *    and AA are navigation and accessibility; the close-case control and its
 *    closed-case branch are TICKET state. No customer-provider view, present or
 *    future, may hide any of them — a provider that "needs to" is a signal the
 *    boundary was cut wrong, and the answer is to re-cut it, never to add a
 *    switch here. ห้ามซ่อนสามอย่างนี้เด็ดขาด — ซ่อนแล้วแอดมินปิดเคสไม่ได้
 *
 * ⚠️ NO STATE MOVED. `searchOpen`, `showUserDetail` and the quota dialog all
 *    still live in `ChatRoomView.tsx`, because each of them ALSO drives
 *    something outside the header (the search panel, the detail box, the quota
 *    modal). Moving a `useState` into a child changes re-render and effect
 *    timing, which is a behaviour change, not a move — `dev-local §6.4`.
 *
 * revert: delete this file and paste its `<div className="ml-auto …">` back
 *         into `RoomHeader.tsx` at the `<HeaderActions …/>` mount site.
 */
import { isAutoTranslateOn, type RoomAutoTranslateFields } from '../../../../services/chat/roomAutoTranslate';
import React from 'react';
import { useI18n } from '../../../../i18n';
import {
  X,
  User,
  Search,
  ALargeSmall,
  CheckCircle2,
  PanelRightClose,
  Maximize2,
  Minimize2,
  Languages,
} from 'lucide-react';
import type { ChatRoom } from '../../../../services/chat';
import { RoomTranslateModal } from './room-translate/RoomTranslateModal';

export interface HeaderActionsProps {
  /** [FEAT-20260830-CHATFONT] omitted ⇒ the AA button never renders (3 of 4 pages). */
  onOpenFontScale?: () => void;
  fontScaleLabel?: string;
  /* [FEAT-20260918-ROOMTRANS] Room translation button and modal settings */
  room?: ChatRoom | null;
  onTranslateLatest?: () => void;
  isTranslatingLatest?: boolean;
  onUpdateRoomTranslateSettings?: (settings: {
    translate_lang?: string | null;
    show_original_text?: boolean;
    /* [FEAT-20260919-SHOWORIGSRC] TypeScript's bivariant parameter checking lets
       this pass through untyped without an error, so its absence here would not
       have been caught by `tsc` — it is declared because the next reader of this
       file needs to know the field exists, not because the compiler asked. */
    show_original_text_source?: 'all_rooms' | 'room';
    auto_translate?: boolean | null;
    auto_send_translated?: boolean;
  }) => Promise<void> | void;
  searchOpen: boolean;
  /** Toggles the search panel AND clears its results — the closure stays in ChatRoomView. */
  onToggleSearch: () => void;
  /** [FIX-20260731-CLOSEDBADGE] true ⇒ the badge replaces the button. */
  caseClosed: boolean;
  onCloseCase?: () => void;
  canCloseCase: boolean;
  showDetailBox: boolean;
  showUserDetail: boolean;
  onToggleUserDetail: () => void;
  onCollapse?: () => void;
  onToggleExpand?: () => void;
  isExpanded: boolean;
  onClose?: () => void;
}

export const HeaderActions: React.FC<HeaderActionsProps> = ({
  onOpenFontScale,
  fontScaleLabel,
  room,
  onTranslateLatest,
  isTranslatingLatest,
  onUpdateRoomTranslateSettings,
  searchOpen,
  onToggleSearch,
  caseClosed,
  onCloseCase,
  canCloseCase,
  showDetailBox,
  showUserDetail,
  onToggleUserDetail,
  onCollapse,
  onToggleExpand,
  isExpanded,
  onClose,
}) => {
  const { t } = useI18n();
  const [isTranslateModalOpen, setIsTranslateModalOpen] = React.useState(false);

  React.useEffect(() => {
    const handleOpenModal = () => setIsTranslateModalOpen(true);
    const handleCloseModal = () => setIsTranslateModalOpen(false);
    window.addEventListener('tc:open-room-translate-modal', handleOpenModal);
    window.addEventListener('tc:close-room-translate-modal', handleCloseModal);
    return () => {
      window.removeEventListener('tc:open-room-translate-modal', handleOpenModal);
      window.removeEventListener('tc:close-room-translate-modal', handleCloseModal);
    };
  }, []);

  /* [FIX-20260918-AUTOTRANSOR] the same shared rule the modal uses, so the
     header badge and the modal's switch can never disagree about one room. */
  const isAutoTranslate = isAutoTranslateOn(room as RoomAutoTranslateFields);

  return (
    <div className="ml-auto flex items-center gap-1.5 shrink-0">
    {/* ==== [FEAT-20260801-CHATSEARCH] ปุ่มค้นหา วางข้างปุ่มปิดเคสตามที่ผู้ใช้กำหนด
        กดแล้วเปิด/ปิดแผงค้นหาใต้หัวแชท · ปิดแล้วล้างผลลัพธ์ทิ้ง (ไม่ค้าง state)
        ⚠️ ไม่แตะปุ่มปิดเคส/ปุ่มรายละเอียด — แค่เพิ่มปุ่มใหม่ไว้ข้างหน้า
        revert: ลบปุ่มนี้ + แผงค้นหา + state/ฟังก์ชัน marker เดียวกัน */}
    {/* [FEAT-20260830-CHATFONT] ปุ่มปรับขนาดตัวอักษร วางข้างแว่นขยาย
        ตามที่เจ้าของสั่ง ("ย้ายปุ่ม font. Aa ลงไปแถวเดียวกับแว่นขยายเหมือนเดิม") */}
    {onOpenFontScale && (
      <button
        type="button"
        onClick={onOpenFontScale}
        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        title={fontScaleLabel}
        aria-label={fontScaleLabel}
      >
        <ALargeSmall size={14} />
      </button>
    )}
    <button
      type="button"
      onClick={onToggleSearch}
      /* [FIX-20260810-SEARCHCLOSE] เจ้าของสั่ง: เปิดค้นหาแล้วปุ่มเดิมต้องกลายเป็น
         "ปิด" สีส้ม border ชัด — ตอนเปิดอยู่ ปุ่มนี้ทำหน้าที่ปิดอย่างเดียว
         การมีไอคอนแว่นขยายค้างไว้ทำให้ดูเหมือนกดเพื่อ "ค้นหา" ทั้งที่กดแล้วปิด
         ⇒ เปลี่ยนทั้งไอคอน ข้อความ และสี ให้ตรงกับสิ่งที่มันทำจริง */
      className={`flex items-center gap-1.5 rounded-lg text-xs font-bold transition-all ${
        searchOpen
          ? 'px-2 py-1 border-2 border-orange-500 bg-orange-50 text-orange-600 hover:bg-orange-100'
          : 'p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
      }`}
      title={searchOpen ? t('ticketui.header.close_search', 'ปิดการค้นหา') : t('ticketui.header.search', 'ค้นหาข้อความในห้องนี้')}
    >
      {searchOpen ? (<><X size={13} /> {t('ticketui.common.close', 'ปิด')}</>) : <Search size={14} />}
    </button>
    {/* ==== [FIX-20260731-CLOSEDBADGE] START
        เคสปิดแล้ว → แสดงป้าย "เคสนี้ปิดแล้ว" ตรงตำแหน่งปุ่มปิดเคส
        เดิมป้ายนี้เป็นแถบเต็มความกว้างคาดอยู่เหนือห้องแชท ซึ่งซ้ำกับแถบ
        ล่าง (footer) ที่บอกเรื่องเดียวกัน และกินพื้นที่แนวตั้งไปเปล่าๆ
        ตำแหน่งนี้เดิมเป็นปุ่มที่ถูก disable + เบลอทิ้งไว้เฉยๆ อยู่แล้ว
        เอาป้ายมาแทนจึงสื่อสารตรงจุดกว่าและได้พื้นที่คืน
        revert: ลบ block นี้ เหลือแค่ `{onCloseCase && (<button ...`
    ==== */}
    {caseClosed ? (
      <span
        className="flex items-center justify-center gap-1.5 w-[100px] h-[27px] border border-gray-200 bg-gray-50 rounded-lg text-xs font-bold text-gray-400 select-none"
        title={t('ticketui.header.case_closed', 'เคสนี้ปิดแล้ว')}
      >
        <CheckCircle2 size={13} /> {t('ticketui.header.case_closed', 'เคสนี้ปิดแล้ว')}
      </span>
    ) : onCloseCase && (
      <button
        type="button"
        onClick={() => canCloseCase && onCloseCase()}
        disabled={!canCloseCase}
        className={`flex items-center justify-center gap-1.5 w-[100px] h-[27px] border rounded-lg text-xs font-bold transition-all ${
          canCloseCase
            ? 'border-red-200 bg-red-50 hover:bg-red-100 text-red-600 shadow-xs cursor-pointer'
            : 'border-red-200/50 bg-red-50/40 text-red-400/60 blur-[1.5px] opacity-50 cursor-not-allowed pointer-events-none select-none'
        }`}
        title={canCloseCase ? t('ticketui.common.close_case', 'ปิดเคส') : t('ticketui.common.own_case_only', 'กดได้เฉพาะเคสตนเอง')}
      >
        <CheckCircle2 size={13} /> {t('ticketui.common.close_case', 'ปิดเคส')}
      </button>
    )}
    {showDetailBox && (
      <button
        type="button"
        onClick={onToggleUserDetail}
        className={`p-1 rounded-lg transition-all flex items-center gap-1 text-xs font-semibold ${
          showUserDetail
            ? 'text-emerald-600 bg-emerald-50 border border-emerald-200 shadow-sm'
            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
        }`}
        title={showUserDetail ? t('ticketui.header.hide_detail', 'ซ่อนข้อมูลลูกค้า') : t('ticketui.header.show_detail', 'แสดงข้อมูลลูกค้า (Detail Box)')}
      >
        <User size={14} />
      </button>
    )}
    {onCollapse && (
      <button
        onClick={onCollapse}
        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1"
        title={t('ticketui.header.collapse', 'ซ่อนหน้าจอแชต (Collapse)')}
      >
        <PanelRightClose size={14} />
      </button>
    )}
    {onToggleExpand && (
      <button
        onClick={onToggleExpand}
        className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
        title={isExpanded ? t('ticketui.header.shrink', 'ย่อเป็น 80%') : t('ticketui.header.expand', 'ขยายเต็มหน้าจอ (100%)')}
      >
        {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    )}
    {onClose && (
      <button
        onClick={onClose}
        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
        title={t('ticketui.header.close_chat', 'ปิดหน้าจอแชต')}
      >
        <X size={16} />
      </button>
    )}
    {onUpdateRoomTranslateSettings && (
      <RoomTranslateModal
        isOpen={isTranslateModalOpen}
        onClose={() => setIsTranslateModalOpen(false)}
        room={room ?? null}
        onUpdateSettings={onUpdateRoomTranslateSettings}
      />
    )}
  </div>
  );
};
