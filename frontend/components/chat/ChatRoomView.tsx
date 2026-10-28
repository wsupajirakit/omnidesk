/**
 * ChatRoomView.tsx
 * Shared Chat Room & User Detail Box Component
 * 
 * Created/Updated by: Gemini 3.6 Flash (2026-07-22)
 * Purpose: Reusable chat view used by both /chat page (Chat.tsx) and Instant Chat Panel in Ticket Support (TicketSupport.tsx).
 * DB impact: NONE (Frontend UI component)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { tierOfMember } from '../../utils/memberTier';
// [FEAT-20260819-INCHATTOAST] the card that is OPEN has no unread badge (opening
// clears it), so an inbound message while you read/type would arrive unannounced.
// (The toast itself is mounted by the header module now — only the "did a message
//  arrive while I was typing" rule is still read here.)
import { isTypingInInput, NEW_MESSAGE_GLOW_MS } from './NewMessageToast';
/* [FEAT-20260905-CUSTPROV PART 5] the header bar, its own module. Barrel only —
   never a deep import into room-header/parts. */
import { RoomHeader } from './room-header';
import { dividerActorDisplay } from './dividerActorDisplay';
/* [FIX-20260820-DIVIDEROWNER] reads the stamp the backend writes — see that file. */
import { caseDividerAlreadyWritten, caseOpenedByAdmin } from './caseDividerWritten';
// [FEAT-20260819-REPLYUI] reply is UI-only for now — the chip, its reveal rule and
// the shape it hands back. Nothing here sends; see replyTarget.ts.
import { BubbleReplyButton } from './BubbleReplyButton';
import { QuotedReference } from './QuotedReference'; // [FEAT-20260821-QUOTEREPLY]
import { useTimedReveal } from './useTimedReveal';
import type { ReplyTarget } from './replyTarget';
/* [FEAT-20260820-REPLYHIDDEN] the one switch that hides the Reply chip — see that
   file for why it is off and how to turn it back on. */
import { SHOW_BUBBLE_REPLY_BUTTON } from './replyTarget';
/* [FEAT-20260908-AITRANSLATE] the translate chip, the language list and the
   two-layer body. All three are inert unless the page passes `onTranslate` —
   see the prop below. Nothing here fetches or sends; the page owns the call. */
import { BubbleTranslateButton, SHOW_BUBBLE_TRANSLATE_BUTTON } from './BubbleTranslateButton';
import type { TranslateTarget } from './BubbleTranslateButton';
import { LanguagePicker } from './LanguagePicker';
import { TranslatedBubble, activeTranslation } from './TranslatedBubble';
import { BubbleTranslateLoading } from './BubbleTranslateLoading';
import { BubbleTranslateError } from './BubbleTranslateError';
import {
  RefreshCw,
  Loader2,
  ChevronsUp,
  ChevronRight,
  X,
  Plus,
  Info,
  FileText,
  Pencil,
  Save,
  StickyNote,
  Send,
  CheckCircle2,
  Bot,
  AlertTriangle,
  UserCheck,
  UserPlus,
  Lock,
  // [FEAT-20260801-CHATSEARCH] ปุ่มค้นหา + ปุ่มกลับไปข้อความล่าสุด
  Search,
  ArrowDownToLine,
  Megaphone, // [FEAT-20260824-BCASTTRANSCRIPT] divider ของแคมเปญ multicast
} from 'lucide-react';
import { QuotaModal } from '../hook/quota'; // [FEAT-20260815-LINEQUOTA]
import { chatService, ChatRoom, ChatMessage, ChatSearchHit } from '../../services/chat';
/* [FEAT-20260919-SHOWORIGSRC] one rule, shared with the room modal and the header
   popover — see `services/chat/showOriginalText.ts`. */
import {
  normalizeShowOriginalSource,
  readShowOriginalAllRooms,
  resolveShowOriginalText,
  SHOW_ORIGINAL_ALL_ROOMS_EVENT,
} from '../../services/chat/showOriginalText';
import { API_BASE_URL } from '../../services/apiClient';
import { useI18n } from '../../i18n';
import { translateDividerLabel } from './dividerLabelI18n';
import { withVars } from './i18nVars';
import { useTicketWS } from '../../services/chat';
import { isTranslateLanguage } from '../../config/translateLanguages';
import { ChatGallery } from './ChatGallery';
import { ConfirmModal } from '../modals';
import { getStoredAuth } from '../../services/authStorage';
// [FIX-20260801-HEADER2LINE] ใช้เส้นเดิมที่ panel ขวาใช้ (มี cache 10 วิฝั่ง BE)
import { ticketService } from '../../services/chat';
import { FlexSlipCard } from './FlexSlipCard';
// [FEAT-20260729-REGCARD] preview of the register card (link intentionally inert)
// [FIX-20260814-CUSTOMERNAME] `customerName` skips the backend's "Unknown"
// placeholder; same barrel this file already imports from.
/* [FIX-20260905-LINELOGO] LineLogoIcon has ONE definition, in common — it used
   to be declared here and again in the profile panel and the two had drifted.
   The chat header's copy of it now lives in `room-header/RoomHeader.tsx`, which
   imports the same single definition. */
import { RegisterLinkCard, customerName } from '../common';

// ── System divider — a centered pill line in the chat stream (not a bubble).
// Variant → colour: accept=blue, close=grey, assign=purple, bot=green. ─────────
// Colours come from the .tc scope in index.html (light + dark, lifted verbatim
// from ai-chat_interface_final.html). accept=blue, close=grey, assign=grey, bot=green.
/* Variant → pill style. `metadata.variant` (written by the BE) is the ONLY
   discriminator between divider kinds — every kind owns a unique key, so a new
   feature adding one shows up here as a new entry (the single place a clash
   would be visible). Unknown/missing variant falls back to the grey close pill.
     accept        — an admin took the case (blue)
     claim         — an admin claimed an already-open case (blue)
     assign        — the case was handed to another admin (grey/purple)
     close         — the case was closed (grey)
     bot           — the bot resumed ownership of the room (green)
     note          — an internal note marker (grey, lock glyph)
     auto_ticket   — a case opened automatically by the re-assist timeout (blue)
     direct_ticket — the system opened a case that needs a human (orange)
     suppressed_reply — a bot answer that was DECIDED but not sent (orange) */
const DIVIDER_STYLES: Record<string, string> = {
  accept: 'tc-div-accept',
  close: 'tc-div-close',
  assign: 'tc-div-assign',
  bot: 'tc-div-bot',
  // [FEAT-20260729-AUTOTICKET] a case opened by the re-assist timeout. Blue
  // rather than the green used by `bot`, because this is a case being OPENED,
  // not the bot resuming — those are opposite events and reading as the same
  // colour made the transcript hard to scan. Reuses the accept style so no new
  // CSS is needed. The icon stays the Bot glyph: a bot did open it.
  auto_ticket: 'tc-div-accept',
  // [FEAT-20260817-REOPENBYADMIN] an admin reopened a closed case — the owner
  // ordered the SAME blue as "รับเคส", but a variant of its own so reports can
  // count reopens apart from accepts (same variant-shares-style pattern as
  // auto_ticket above).
  reopen_by_admin: 'tc-div-accept',
  /* [FEAT-20260810-DIRECTTICKET] เคสที่ระบบเปิดให้เอง (เช่น topup ตอบ
     member-not-match) — ส้มเพราะเป็น "เรื่องที่ต้องให้คนดู" ไม่ใช่เหตุการณ์ปกติ
     ใช้สีตรง ๆ ไม่ผ่าน .tc scope เพราะยังไม่มีคลาสส้มในนั้น (ไม่แตะ CSS เดิม) */
  direct_ticket:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  /* [FEAT-20260813-SUPPRESSEDCHECK] "🔎 ผลตรวจ:" — the check result the bot
     decided but did NOT send (admin holds the room; BE saves it as a divider,
     variant `suppressed_reply`). Same orange as `direct_ticket` per the owner:
     it is information an admin must look at, not a normal event.
     revert: delete this entry + its DIVIDER_ICONS entry. */
  suppressed_reply:
    'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  /* [FEAT-20260824-BCASTTRANSCRIPT] a multicast campaign landed in this chat.
     เจ้าของ 24/08: "fe ใช้ divider สีม่วง 'Multicast' จาก job ชื่อ xxxxx"
     🔴 PURPLE, and no other variant here uses purple — the colour IS the signal
        that this line was not part of the conversation. Reusing an existing
        colour would make a campaign read as a case event while scanning.
     ⚠️ Inline like `suppressed_reply` above rather than a shared `tc-div-*`
        class: those live in the global stylesheet, and this variant belongs to
        the campaign feature, which must stay removable on its own.
     revert: delete this entry + its DIVIDER_ICONS entry. An unknown variant
     renders grey, so the transcript still reads. */
  multicast:
    'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30',
};
// ==== [FEAT-20260729-ADMINSENDER] who actually sent an outgoing message
// 🔒 AUTO track — to_dev_auto branch only
//
// Outgoing messages carry sender_type "bot" whether the bot or an admin sent
// them — that field is the DIRECTION of the message, and changing it would put
// [FIX-20260731-LINENAME] โลโก้ LINE ขนาดเล็กสำหรับนำหน้าชื่อ LINE ในหัวห้องแชท
// ประกาศในไฟล์นี้เอง (ไม่ import ข้ามจาก TicketChat.tsx) เพื่อไม่ให้สองไฟล์
// พึ่งพากันไปมา — เป็น svg สั้นๆ ตัวเดียว ไม่คุ้มที่จะทำ shared module
// revert: ลบ component นี้ + ที่เรียกใช้ในหัวห้องแชท
/** [FEAT-2708-SEARCHMIN4] ขั้นต่ำตัวอักษรก่อนค้นข้อความในห้อง */
const CHAT_SEARCH_MIN_CHARS = 4;


// bubbles on the wrong side. The sender is recorded separately by the BE.
//
// Read from two shapes, because a bubble can arrive either way:
//   metadata.sender_name  — messages loaded from the database
//   sender_name           — the realtime WS payload, which has no metadata
//
// Returns null for genuine bot messages and for anything sent before this
// shipped, which is what keeps the old purple Bot badge as the fallback.
// revert: delete this helper and its three uses below.
const adminSenderName = (msg: any): string | null => {
  const name = msg?.metadata?.sender_name || msg?.sender_name;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  return trimmed || null;
};

// Icon per divider variant, mirroring the mock (fa-circle-check / fa-robot /
// fa-hand-pointer / lock). lucide equivalents.
const DIVIDER_ICONS: Record<string, React.ReactNode> = {
  accept: <UserCheck size={12} />,   // รับเคส
  claim: <UserCheck size={12} />,    // เคลมเคส
  assign: <UserPlus size={12} />,    // โอนเคส / เปลี่ยนผู้รับผิดชอบ
  close: <CheckCircle2 size={12} />, // ปิดเคส / ปิด Case #N
  bot: <Bot size={12} />,            // บอทกลับมาดูแล
  note: <Lock size={12} />,          // โน้ตในแชท
  // [FEAT-20260729-AUTOTICKET] same Bot glyph as `bot` — a bot opened this case
  auto_ticket: <Bot size={12} />,    // เปิดเคสอัตโนมัติจาก re-assist
  // [FEAT-20260817-REOPENBYADMIN] a person reopened it — person glyph, not Bot
  reopen_by_admin: <UserCheck size={12} />, // เปิดเคสอีกครั้งโดยแอดมิน
  direct_ticket: <AlertTriangle size={12} />, // [FEAT-20260810-DIRECTTICKET]
  // [FEAT-20260813-SUPPRESSEDCHECK] the magnifier matches the "🔎 ผลตรวจ" label
  suppressed_reply: <Search size={12} />,
  /* [FEAT-20260824-BCASTTRANSCRIPT] a megaphone: this went out to many people at
     once, which is what separates it from every other divider here — all of
     which are about ONE case. */
  multicast: <Megaphone size={12} />,
};
/* [FEAT-20260813-SUPPRESSEDCHECK] The check-result divider carries a whole
   bot reply, so it can wrap to several lines and shove the transcript around.
   ONLY this variant is clamped: past ~70% of the pill's usable width the text
   is cut with "…" and an info button opens the full text in a modal — the
   stored content is never shortened, only its display.
   revert: delete SUPPRESSED_CLAMP + the truncate branch + the modal state. */
const SUPPRESSED_CLAMP = 90; // ≈70% of one pill line at the current width

/* Rows written before 2026-08-13 15:20 carry an older, longer prefix
   ("🔎 ผลตรวจ (ไม่ได้ส่ง — แอดมินถือห้องอยู่): "). The BE now writes
   "🔎 ผลตรวจสลิป: ", and the modal title already states the not-sent reason,
   so strip the legacy prefix at render time — historic rows read the same as
   new ones without touching stored data. revert: delete this fn + its use. */
const stripLegacyCheckPrefix = (text: string): string =>
  text.replace(/^🔎\s*ผลตรวจ\s*\(ไม่ได้ส่ง[^)]*\)\s*:\s*/, '🔎 ผลตรวจสลิป: ');

const SystemDivider: React.FC<{ label: string; variant?: string; time?: string }> = ({ label, variant, time }) => {
  const cls = DIVIDER_STYLES[variant || ''] || 'tc-div-close';
  const icon = DIVIDER_ICONS[variant || ''];
  const [showFull, setShowFull] = useState(false);
  const { t } = useI18n();
  // [FEAT-20261022-I18NTICKETEN] stored Thai wording → the UI language, display only
  const text = translateDividerLabel(variant === 'suppressed_reply' ? stripLegacyCheckPrefix(label) : label, t);
  const clampable = variant === 'suppressed_reply' && text.length > SUPPRESSED_CLAMP;
  const shown = clampable ? `${text.slice(0, SUPPRESSED_CLAMP).trimEnd()}…` : text;
  return (
    <>
      <div className="flex justify-center my-3">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-normal px-3 py-1 rounded-full border ${cls}`}>
          {icon && <span className="shrink-0 -ml-0.5 opacity-90">{icon}</span>}
          {shown}
          {clampable && (
            <button
              type="button"
              onClick={() => setShowFull(true)}
              title={t('ticketui.room.read_full_check', 'อ่านผลตรวจเต็ม')}
              aria-label={t('ticketui.room.read_full_check', 'อ่านผลตรวจเต็ม')}
              className="shrink-0 inline-flex items-center opacity-80 hover:opacity-100"
            >
              <Info size={12} />
            </button>
          )}
          {time && <span className="opacity-60 font-normal">• {time}</span>}
        </span>
      </div>
      {showFull && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowFull(false)}
        >
          <div
            className="tc-note max-w-lg w-full rounded-2xl p-4 shadow-xl bg-white dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-2 text-orange-600 dark:text-orange-300">
              <Search size={14} />
              <span className="text-[13px] font-bold">{t('ticketui.room.slip_check_title', 'ผลตรวจสลิป (ไม่ได้ส่งให้ลูกค้า แอดมินถือห้อง ticket อยู่)')}</span>
            </div>
            <p className="text-[14px] whitespace-pre-wrap break-words">{text}</p>
            <div className="mt-3 text-right">
              <button
                type="button"
                onClick={() => setShowFull(false)}
                className="text-[12px] px-3 py-1 rounded-full border border-slate-300 dark:border-slate-600"
              >
                {t('ticketui.common.close', 'ปิด')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── Inline internal note — admin-only bubble (never sent to the customer). ────
const InlineNoteBubble: React.FC<{ content: string; author?: string; time?: string }> = ({ content, author, time }) => {
  const { t } = useI18n();
  return (
  <div className="flex justify-end my-1">
    {/* Colours come from the .tc scope (light + dark) — mirrors .internal-note-bubble */}
    <div className="tc-note max-w-[75%] rounded-2xl rounded-tr-sm px-3 py-2 shadow-sm">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="tc-note-meta text-[10px] font-bold flex items-center gap-1">🔒 {author || t('ticket.chat_status_admin', 'แอดมิน')}</span>
        <span className="tc-note-time text-[9px]">{t('ticketui.room.internal_note', 'โน๊ตภายใน')}</span>
      </div>
      <p className="text-[14px] whitespace-pre-wrap break-words">{content}</p>
      {time && <div className="tc-note-time text-[10px] text-right mt-0.5">{time}</div>}
    </div>
  </div>
  );
};

// ==== [FIX-20260728-VIDEO-PENDING] START — component นี้เพิ่มใหม่ทั้งหมด (เดิมไม่มี)
// แสดงแทนวิดีโอที่ LINE ยัง transcode ไม่เสร็จตอน webhook เข้ามา (message_type
// "video_pending", internal_content_id เป็น null เสมอ) แอดมินกดปุ่มเพื่อลองโหลด
// เอง — ไม่มี auto-retry/polling ฝั่งไหนเลยตามที่ตกลงไว้ กดพลาดได้ไม่จำกัดครั้ง
// revert: ลบ component นี้ทั้งก้อน + จุดที่เรียกใช้ใน render (if message_type ===
// 'video_pending') + handleVideoLoaded ในไฟล์นี้
const PendingVideoBubble: React.FC<{
  messageId: string;
  senderType: 'bot' | 'customer' | 'admin';
  onLoaded: (patch: { message_type: 'video'; internal_content_id: NonNullable<ChatMessage['internal_content_id']> }) => void;
}> = ({ messageId, senderType, onLoaded }) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await chatService.retryVideoDownload(messageId);
      if (res.success && res.data) {
        onLoaded({ message_type: 'video', internal_content_id: res.data.internal_content_id });
      } else {
        setError(res.message || t('ticketui.room.video_not_ready', 'วิดีโอยังไม่พร้อม ลองใหม่อีกครั้ง'));
      }
    } catch (e) {
      setError(t('ticketui.room.video_load_failed', 'โหลดวิดีโอไม่สำเร็จ ลองใหม่อีกครั้ง'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`p-3 rounded-2xl border flex flex-col gap-2 max-w-[280px] ${
      senderType === 'customer'
        ? 'bg-emerald-50/50 border-emerald-100 rounded-tl-sm'
        : 'bg-blue-50/50 border-blue-100 rounded-tr-sm items-end'
    }`}>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 size={14} className={loading ? 'animate-spin' : ''} />
        <span>{t('ticketui.room.video_processing', 'วิดีโอกำลังประมวลผลจาก LINE')}</span>
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-60 transition-colors"
      >
        {loading ? t('webhook_logs.loading', 'กำลังโหลด...') : t('ticketui.room.load_video', 'โหลดวิดีโอ')}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
};
// ==== [FIX-20260728-VIDEO-PENDING] END

interface ChatRoomViewProps {
  room: ChatRoom | null;
  /* [FEAT-20260819-REPLYUI] the page that owns a composer passes this to switch
     the Reply chip on. Omitted = no chip is rendered anywhere and this file
     behaves exactly as before — which is what the three pages without a reply
     composer (Chat, Contact, legacy ticket) get. ไม่ส่ง = ไม่มีอะไรเปลี่ยน. */
  onReplyTo?: (target: ReplyTarget) => void;
  /* [FEAT-20260908-AITRANSLATE] the page that may spend an AI call passes this
     to switch the translate chip on. Called ONLY after the admin pressed the
     chip AND chose a language — picking the language IS the confirm, so there is
     no second "apply" press on the read side.
     🔴 Omitted = no chip, no picker, no request, and this file behaves exactly
        as before — which is what `Chat.tsx`, `Contact.tsx` and
        `TicketSupport.tsx` get WITHOUT ONE LINE CHANGING IN THEM. Gated with
        `&&` exactly like `onReplyTo` above, for exactly that reason.
        ไม่ส่ง = ไม่มีอะไรเปลี่ยน ไม่มีการยิงอะไรทั้งสิ้น.
     🔴 The handler lives in the PAGE, never here: `ChatRoomView` must contain no
        action call at all (`test/contactChatTab.dom.test.tsx` reads this file's
        source to prove the read-only Contact tab cannot act). */
  /* [FIX-20260909-TRANSLATEBUSY] may be async: the modal awaits it to show
     "กำลังแปล…" and to offer a retry when it rejects. A caller that returns
     nothing keeps the old fire-and-forget behaviour. */
  onTranslate?: (target: TranslateTarget) => void | Promise<void>;
  /* [FEAT-20260830-CHATFONT] เปิด modal ปรับขนาดตัวอักษรในแชท
     ⚠️ optional และ gate ด้วย `&&` แบบเดียวกับ onReplyTo — ไฟล์นี้ใช้ร่วม 4 หน้า
     (TicketChat · Chat · Contact · TicketSupport) ⇒ หน้าที่ไม่ส่ง prop จะไม่มี
     ปุ่มโผล่ ซึ่งเป็นสิ่งที่เจ้าของสั่ง (แก้เฉพาะหน้า ticket) */
  onOpenFontScale?: () => void;
  fontScaleLabel?: string;
  /* [FEAT-20260819-ORPHANROOM] is this conversation one that never became a case?
     Only the ticket page knows, and it only affects the header avatar's ring, so
     it is an optional flag rather than a new data dependency. Omitted = the normal
     green ring, which is what the other three pages using this view get.
     ไม่ส่งมา = วงเขียวปกติ ไม่กระทบหน้าอื่น. */
  isOrphanRow?: boolean;
  hookId?: string;
  onClose?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onCollapse?: () => void;
  headerTitle?: string;
  // [FIX-20260801-HEADER2LINE] id ของสมาชิก — ใช้ดึงป้ายเทียร์จาก raw profile
  // ⚠️ ทางเลือก: ไม่ส่งมา = ไม่ยิงอะไรเลยและไม่มีป้ายเทียร์ (หน้า Chat ปกติเป็นแบบนี้)
  //    หน้า ticket เท่านั้นที่ส่งมา · เส้นที่ใช้มี cache 10 วิฝั่ง BE อยู่แล้ว
  //    และเป็นเส้นเดียวกับที่ panel ขวาใช้ จึงแทบไม่มีต้นทุนเพิ่ม
  memberId?: string;
  /** [FIX-20260810-TIERSOURCE] member ทั้งดวงจาก ticket — อ่าน tier จากตรงนี้ ไม่ต้องยิง API */
  memberData?: any;
  /* [FEAT-20260905-CUSTPROV PART 4] 📖 todo/task/05092026/todo3_05092026_
     profile_panel_module.md §18-23 — whether the 💎 tier badge below may
     render at all. Default `true` (not `false`) so the 3 callers that never
     pass this prop (Chat, Contact, TicketSupport) render byte-identically to
     today with zero changes on their side.
     🔴 [FIX-20260810-TIERSOURCE] is the reason this switch must reach BOTH the
     card badge (TicketChat.tsx, the caller of THIS component) and this room
     header — those two once disagreed for one real customer. A caller that
     gates its own card but forgets this prop recreates that exact bug in a
     new form, just with a boolean instead of a data-source mismatch.
     ไม่ส่งมา = แสดงเหมือนเดิม (หน้าที่ไม่เกี่ยวกับ tier ไม่ต้องรู้จัก prop นี้เลย) */
  showTierBadge?: boolean;
  // [FIX-20260801-HEADER2LINE] ชื่อ LINE OA ที่ลูกค้าคุยอยู่ — โชว์บรรทัดล่างของหัวแชท
  // ⚠️ ทางเลือก: ไม่ส่งมา = ไม่แสดงชื่อ OA เลย (หน้า /legacy-ticket เป็นแบบนี้)
  //    ตั้งใจให้ optional เพื่อให้ผู้เรียกเดิมทำงานเหมือนเดิมเป๊ะโดยไม่ต้องแก้อะไร
  //    ผู้เรียกเป็นคนแปลง hookId → ชื่อ อยู่แล้ว (TicketChat มี oaName() ของตัวเอง)
  //    จึงไม่ยิง API เพิ่มที่นี่
  oaName?: string;
  showDetailBox?: boolean;
  // Optional "close case" button in the header (only the ticket page passes it).
  onCloseCase?: () => void;
  canCloseCase?: boolean;
  // [FIX-20260731-CLOSEDBADGE] เคสถูกปิดแล้วหรือยัง — true = แสดงป้าย
  // "เคสนี้ปิดแล้ว" แทนปุ่มปิดเคส (ปุ่มกดไม่ได้อยู่แล้วเมื่อเคสปิด)
  // ไม่ใส่ = false = พฤติกรรมเดิมทุกประการ ผู้เรียกเดิมไม่ต้องแก้อะไร
  // revert: ลบ prop นี้ + block ที่ใช้มันในส่วน header
  caseClosed?: boolean;
  // Synthetic divider rows (e.g. "ปิด Case #N") merged into the stream by time.
  // Only set when opened via ดูแชท; empty otherwise.
  extraDividers?: any[];
  /** [FEAT-20260810-DIRECTTICKET] ticket ที่กำลังเปิดอยู่ — ใช้ดู direct_ticket */
  ticketMeta?: {
    /* [FIX-20260820-DIVIDEROWNER] the case's own id, matched against the stamp the
       backend puts on the divider row it writes. Optional: a caller that omits it
       gets the old behaviour (the line is drawn), which is the safe direction. */
    _id?: string | null;
    direct_ticket?: boolean;
    direct_ticket_detail?: string | null;
    need_detail?: string | null;
    created_at?: string | null;
  } | null;
  // [FIX-20260728-NOBLINK] ให้หน้าแม่ append ข้อความที่เพิ่งส่งสำเร็จเข้ามาได้
  // ตรง ๆ แทนการเปลี่ยน key เพื่อ remount ทั้ง component (ซึ่งทำให้กระพริบ +
  // โหลดรูปทั้งห้องใหม่) · optional → ผู้เรียกที่ไม่ส่งมาก็ทำงานเหมือนเดิม
  // revert: ลบ prop นี้
  /* [FEAT-20260908-AITRANSLATE] `patchMessage` added — PURELY ADDITIVE. One more
     function on the object this prop already hands out; `appendMessage` and
     `refetch` are untouched and every existing caller keeps working without
     knowing it exists (they receive an object with one extra key and destructure
     what they always did).
     🔴 WHY IT HAD TO EXIST: a translation arrives over HTTP, not over the
     websocket (`message:new` carries only `preview`, and there is no
     `message:updated` branch for the `translations` column), so the page must
     put the result into THIS component's `messages` state itself. The other two
     cannot: `appendMessage` no-ops on an id it already holds, by design, and
     `refetch` replaces the list with page 1 — which would scroll a message the
     operator reached by "load older" straight out of the window, right after
     they paid an AI call for it. */
  onReadyRef?: (api: {
    appendMessage: (m: ChatMessage) => void;
    refetch: () => void;
    patchMessage: (id: string, patch: Partial<ChatMessage>) => void;
  }) => void;
}

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  room,
  hookId,
  onClose,
  isExpanded = false,
  onToggleExpand,
  onCollapse,
  headerTitle,
  memberId,   // [FIX-20260801-HEADER2LINE]
  memberData, // [FIX-20260810-TIERSOURCE] member ที่ populate มากับ ticket (มี raw_profile_data)
  showTierBadge = true, // [FEAT-20260905-CUSTPROV PART 4] default = today, unset callers unaffected
  oaName,     // [FIX-20260801-HEADER2LINE] ไม่ส่งมา = ไม่แสดงชื่อ OA
  showDetailBox = true,
  onCloseCase,
  canCloseCase = false,
  caseClosed = false,   // [FIX-20260731-CLOSEDBADGE]
  extraDividers,
  ticketMeta,
  onReadyRef, // [FIX-20260728-NOBLINK]
  onReplyTo, // [FEAT-20260819-REPLYUI]
  onTranslate, // [FEAT-20260908-AITRANSLATE] ไม่ส่ง = ไม่มีชิปแปล ไม่ยิงอะไรเลย
  onOpenFontScale, fontScaleLabel, // [FEAT-20260830-CHATFONT]
  isOrphanRow, // [FEAT-20260819-ORPHANROOM]
}) => {
  const { locale, t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  // ==== [FEAT-20260801-CHATSEARCH] START — ค้นหา + กระโดดไปตำแหน่งข้อความ
  // 🔒 สาย AUTO — to_dev_auto / to_prod_auto
  //
  // anchorMode = "ตอนนี้กำลังดูหน้าต่างรอบข้อความที่กระโดดมา ไม่ใช่หน้าล่าสุด"
  // ต้องมีตัวนี้เพราะ 2 โหมดใช้กติกาโหลดคนละแบบ:
  //   โหมดปกติ  — page/skip เหมือนเดิมทุกประการ (ไม่แตะเลย)
  //   โหมด anchor — หน้าต่างที่ BE ส่งมา + ปุ่มโหลดสองทิศ
  // ⚠️ ปิดค้นหา/กลับล่างสุด ต้องล้าง anchorMode ทุกครั้ง ไม่งั้น "โหลดเพิ่ม" จะทำงานผิดโหมด
  const [searchOpen, setSearchOpen] = useState(false);
  // [FEAT-20260815-LINEQUOTA] ⓘ in the header — see the button beside the OA name
  const [quotaOpen, setQuotaOpen] = useState(false);
  /* [FEAT-2708-HEADERQUOTA] three counters, three jobs: room-click refresh
     (throttled in the gauge), push refresh (never throttled — fed by the
     `tc:quota-refresh` event TicketChat fires after a successful send), and
     the ≥90% warning toast. revert: delete this block + the mount below. */
  const [quotaTick, setQuotaTick] = useState(0);
  const [quotaForceTick, setQuotaForceTick] = useState(0);
  const [quotaWarnTick, setQuotaWarnTick] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<ChatSearchHit[]>([]);
  /* [FIX-2708-SEARCHHONEST] `scanned_from` is the date the BE ACTUALLY searched from.
     The owner got "not found" for a bubble sitting right there on screen: the room
     renders the whole history, while the search only covers the last 7 days
     (chat.service.ts `CHAT_SEARCH.DAYS_BACK`). The 7-day window stays by decision —
     what changes is that the screen stops implying the message does not exist. */
  const [searchInfo, setSearchInfo] = useState<{ truncated?: boolean; days?: number; scannedFrom?: string | null } | null>(null);
  /* A failed request used to land on the very same "not found" line as a genuinely
     empty result, so a broken search read as an empty room. Kept apart on purpose. */
  const [searchError, setSearchError] = useState(false);
  const [searching, setSearching] = useState(false);
  const [anchorMode, setAnchorMode] = useState(false);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [hasNewer, setHasNewer] = useState(false);
  // ==== [FEAT-20260801-CHATSEARCH] END
  // Merge synthetic close-case dividers into the stream, sorted ascending by time.
  // A divider only appears once the messages around its time have been loaded —
  // otherwise a Case-#1 divider (older than everything loaded) would float above
  // the "load older" button, detached from its actual messages. So while there
  // are still older messages to load (hasMore), we hide any divider that is
  // OLDER than the earliest loaded message; it surfaces as the user loads back
  // to that point. Once all messages are loaded (!hasMore), every divider shows.
  const renderMessages = useMemo(() => {
    /* [FEAT-20260810-DIRECTTICKET] ป้าย "ระบบเปิดเคสนี้ให้" — สร้างเป็นแถว divider
       สังเคราะห์แล้วปล่อยให้ตัว merge/sort ด้านล่างจัดตำแหน่งตามเวลาเอง
       ⚠️ เดิมผมปักไว้บนสุดของ stream ซึ่งผิด — มันต้องอยู่ตรงจุดเวลาที่เคสถูกเปิด
          เหมือน divider "รับเคส/ปิดเคส/บอทดูแล" (เจ้าของทักว่าผิดตำแหน่ง)
       ⚠️ ใช้ `_id` คงที่ เพื่อไม่ให้ React remount ทุกรอบ render
       ไม่ใช่ direct_ticket ⇒ ไม่เพิ่มอะไรเลย = seamless
       revert: ลบ synthetic นี้ + prop ticketMeta */
    /* [FIX-20260820-DIVIDEROWNER] stand down when THIS CASE's line is already in
       the transcript. The backend stamps the row it writes with the case it wrote
       it for, so this is a lookup, not a guess — see `caseDividerWritten.ts` for
       why `direct_ticket` was carrying two meanings and caused the double.
       ⚠️ An unstamped row means "keep drawing", which is what leaves the slip
       path and every row written before this shipped behaving exactly as before.
       ⚠️ Nothing else in this memo changes: `messages` (every real divider of
       every variant) and `extraDividers` (the synthetic `close` rows from
       TicketChat) are merged and sorted below byte-for-byte as they were. */
    const caseLineAlreadyDrawn = caseDividerAlreadyWritten(
      messages,
      ticketMeta?._id,
    );
    /* [FIX-20260825-NOSYSLINEONREOPEN] เคสที่แอดมินกดเปิดเอง ไม่ใช่ระบบสร้าง
       ⇒ ป้าย "เคสนี้สร้างโดยระบบ" ต้องไม่ขึ้น · เหตุผลเต็มอยู่ใน
       `caseDividerWritten.ts` — ย่อ: ป้ายนี้สังเคราะห์จากตั๋วใบปัจจุบัน จึงย้าย
       ไปอยู่กับเคสล่าสุดเสมอ และธง `direct_ticket` บอกที่มาของแคมเปญ ไม่ได้บอก
       ว่าใครกดเปิดเคสใบนี้ · บทสนทนาบันทึกคนเปิดไว้แล้วพร้อม `ticket_id` */
    const caseOpenedByHand = caseOpenedByAdmin(messages, ticketMeta?._id);
    const synthetic: ChatMessage[] =
      ticketMeta?.direct_ticket === true &&
      ticketMeta.created_at &&
      !caseLineAlreadyDrawn &&
      !caseOpenedByHand
        ? ([
            {
              _id: `direct-ticket-${ticketMeta.created_at}`,
              message_type: 'divider',
              content: `เคสนี้สร้างโดยระบบ เนื่องจาก ${
                String(
                  ticketMeta.direct_ticket_detail || ticketMeta.need_detail || '',
                ).trim() || '-'
              }`,
              metadata: { variant: 'direct_ticket' },
              created_at: ticketMeta.created_at,
            },
          ] as unknown as ChatMessage[])
        : [];

    const allExtra = [...(extraDividers ?? []), ...synthetic];
    if (allExtra.length === 0) return messages;
    const earliest = messages.length
      ? Math.min(...messages.map(m => new Date(m.created_at as any).getTime()))
      : Infinity;
    const visibleDividers = hasMore
      ? (allExtra as ChatMessage[]).filter(d => new Date(d.created_at as any).getTime() >= earliest)
      : (allExtra as ChatMessage[]);
    const merged = [...messages, ...visibleDividers];
    return merged.sort((a, b) => new Date(a.created_at as any).getTime() - new Date(b.created_at as any).getTime());
  }, [messages, extraDividers, hasMore, ticketMeta]);
  const [syncingProfile, setSyncingProfile] = useState(false);
  const [imageModalUrl, setImageModalUrl] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<ChatRoom | null>(room);
  // ==== [FIX-20260801-HEADER2LINE] ป้ายเทียร์บนหัวแชท
  // ดึงจาก raw profile ที่ 3rd party ส่งมา (ที่เดียวกับที่ panel ขวาอ่าน)
  // ⚠️ ไม่ส่ง memberId มา = ไม่ยิงอะไรเลย (หน้า Chat ปกติไม่กระทบสักนิด)
  // ⚠️ ล้มเหลว/ไม่มีข้อมูล = ไม่มีป้าย ไม่ขึ้น error ให้ผู้ใช้เห็น
  // revert: ลบ state + useEffect นี้ แล้วลบป้ายใน header
  /* [FIX-20260810-TIERSOURCE] อ่าน tier จาก raw_profile_data ที่ webhook เขียนไว้ใน DB
     (มากับ ticket แล้ว) — เดิมยิง getRawProfile สดตอนเปิดห้อง ซึ่งพังเมื่อ
     `memberId` ว่าง (line_user_data ไม่ populate บางเส้น) ทำให้ header ไม่ขึ้นป้าย
     ทั้งที่ panel ซ้ายขึ้น — เคสจริง: ลูกค้า 0965550015
     ⇒ ตอนนี้ทั้ง panel และ header อ่านก้อนเดียวกัน ตรงกันเสมอ ไม่ยิง API เพิ่ม
     revert: คืน useEffect เดิมที่เรียก ticketService.getRawProfile(memberId) */
  const headerTier = tierOfMember(memberData);

  // ==== [FIX-20260801-HEADER2LINE] END

  const [assistConfirmOpen, setAssistConfirmOpen] = useState(false);
  const [isUpdatingAssist, setIsUpdatingAssist] = useState(false);
  const [showUserDetail, setShowUserDetail] = useState(() => window.innerWidth >= 1280);

  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [noteConfirmOpen, setNoteConfirmOpen] = useState(false);


  // Switching rooms resets the note editor to that room's saved note and
  // closes any half-open edit — the panel must follow the selected person,
  // not carry a stale draft across rooms. Keyed on the id so it fires per
  // room, not on every activeRoom object refresh.
  useEffect(() => {
    setNoteText(activeRoom?.note || '');
    setIsEditingNote(false);
    setNoteConfirmOpen(false);
  }, [activeRoom?._id]);

  // [FEAT-2708-HEADERQUOTA] entering a room asks the gauge to refresh (it
  // throttles per hook itself); a successful admin push always refreshes.
  useEffect(() => {
    if (activeRoom?._id) setQuotaTick((t) => t + 1);
  }, [activeRoom?._id]);
  useEffect(() => {
    const onPush = () => setQuotaForceTick((t) => t + 1);
    window.addEventListener('tc:quota-refresh', onPush);
    return () => window.removeEventListener('tc:quota-refresh', onPush);
  }, []);

  const handleSaveNote = async () => {
    if (!activeRoom) return;
    setNoteConfirmOpen(false);
    try {
      setIsSavingNote(true);
      const cleanNote = noteText.trim() || null;
      await chatService.patchNote(activeRoom._id, cleanNote);
      setActiveRoom(prev => prev ? { ...prev, note: cleanNote } : null);
      setIsEditingNote(false);
    } catch (err) {
      console.error('Failed to save chat room note:', err);
    } finally {
      setIsSavingNote(false);
    }
  };

  /* [FEAT-20260918-ROOMTRANS] Room translation state & handlers */
  const [isTranslatingLatest, setIsTranslatingLatest] = useState(false);
  /* [FEAT-20260918-PHASE3] In-flight translation tracking & auto-dismissing error badges */
  const [translatingMsgIds, setTranslatingMsgIds] = useState<Set<string>>(new Set());
  const [msgTranslateErrors, setMsgTranslateErrors] = useState<Map<string, string>>(new Map());

  const executeTranslate = useCallback(
    async (target: TranslateTarget) => {
      if (!onTranslate) return;
      const msgId = String(target.id);
      setTranslatingMsgIds((prev) => new Set(prev).add(msgId));
      setMsgTranslateErrors((prev) => {
        const next = new Map(prev);
        next.delete(msgId);
        return next;
      });
      try {
        await onTranslate(target);
      } catch (err: any) {
        console.error('[CHAT] translation failed for message:', msgId, err);
        const errMsg = err?.response?.data?.message || err?.message || '';
        setMsgTranslateErrors((prev) => new Map(prev).set(msgId, typeof errMsg === 'string' ? errMsg : ''));
      } finally {
        setTranslatingMsgIds((prev) => {
          const next = new Set(prev);
          next.delete(msgId);
          return next;
        });
      }
    },
    [onTranslate],
  );

  const dismissMsgTranslateError = useCallback((msgId: string) => {
    setMsgTranslateErrors((prev) => {
      const next = new Map(prev);
      next.delete(msgId);
      return next;
    });
  }, []);

  const handleTranslateLatest = useCallback(async () => {
    if (!onTranslate || isTranslatingLatest) return;
    const targetMsg = [...messages].reverse().find(
      (m) =>
        m.sender_type === 'customer' &&
        m.message_type === 'text' &&
        typeof m.content === 'string' &&
        m.content.trim() !== '',
    );
    if (!targetMsg) return;
    const targetLang = 'th';
    setIsTranslatingLatest(true);
    try {
      await executeTranslate({
        id: String(targetMsg._id),
        text: targetMsg.content,
        lang: targetLang,
      });
    } catch (err) {
      console.error('[CHAT] translate latest message failed:', err);
    } finally {
      setIsTranslatingLatest(false);
    }
  }, [onTranslate, isTranslatingLatest, messages, executeTranslate]);

  const handleUpdateRoomTranslateSettings = useCallback(
    async (settings: {
      translate_lang?: string | null;
      show_original_text?: boolean;
      /* [FEAT-20260919-SHOWORIGSRC] must be declared at EVERY layer it passes
         through or it is dropped without an error — see the three copy sites
         below and the DTO on the backend. */
      show_original_text_source?: 'all_rooms' | 'room';
      auto_translate?: boolean | null;
      auto_send_translated?: boolean;
    }) => {
      if (!activeRoom) return;
      const roomId = String(activeRoom._id || (activeRoom as any).id);
      try {
        const res = await chatService.updateRoomTranslateSettings(roomId, settings);
        if (res?.data) {
          setActiveRoom((prev) => {
            if (!prev) return null;
            return {
              ...prev,
              ...res.data,
              translate_lang: res.data.translate_lang ?? null,
              detected_source_lang: res.data.detected_source_lang ?? null,
              show_original_text: Boolean(res.data.show_original_text),
              show_original_text_source: normalizeShowOriginalSource(
                (res.data as any).show_original_text_source,
              ),
              auto_translate: res.data.auto_translate ?? null,
              auto_send_translated: Boolean(res.data.auto_send_translated),
              hook_translate_lang: res.data.hook_translate_lang ?? null,
              hook_auto_translate: Boolean(res.data.hook_auto_translate),
              effective_translate_lang: res.data.effective_translate_lang ?? null,
              effective_auto_translate: Boolean(res.data.effective_auto_translate),
            };
          });
          window.dispatchEvent(
            new CustomEvent('tc:room-translate-settings-updated', {
              detail: { roomId, ...res.data },
            }),
          );
        }
      } catch (err) {
        console.error('[CHAT] update room translate settings failed:', err);
      }
    },
    [activeRoom],
  );

  const handleRefreshRoomTranslateSettings = useCallback(async () => {
    if (!activeRoom) return;
    const roomId = String(activeRoom._id || (activeRoom as any).id);
    try {
      const res = await chatService.getRoomTranslateSettings(roomId);
      if (res?.data) {
        setActiveRoom((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            ...res.data,
            translate_lang: res.data.translate_lang ?? null,
            detected_source_lang: res.data.detected_source_lang ?? null,
            show_original_text: Boolean(res.data.show_original_text),
            show_original_text_source: normalizeShowOriginalSource(
              (res.data as any).show_original_text_source,
            ),
            auto_translate: res.data.auto_translate ?? null,
            auto_send_translated: Boolean(res.data.auto_send_translated),
            hook_translate_lang: res.data.hook_translate_lang ?? null,
            hook_auto_translate: Boolean(res.data.hook_auto_translate),
            effective_translate_lang: res.data.effective_translate_lang ?? null,
            effective_auto_translate: Boolean(res.data.effective_auto_translate),
          };
        });
        window.dispatchEvent(
          new CustomEvent('tc:room-translate-settings-updated', {
            detail: { roomId, ...res.data },
          }),
        );
      }
    } catch (err) {
      console.error('[CHAT] refresh room translate settings failed:', err);
    }
  }, [activeRoom]);

  useEffect(() => {
    const handleOpenEvent = () => {
      handleRefreshRoomTranslateSettings();
    };
    window.addEventListener('tc:open-room-translate-modal', handleOpenEvent);
    window.addEventListener('tc:open-composer-translate-modal', handleOpenEvent);
    return () => {
      window.removeEventListener('tc:open-room-translate-modal', handleOpenEvent);
      window.removeEventListener('tc:open-composer-translate-modal', handleOpenEvent);
    };
  }, [handleRefreshRoomTranslateSettings]);

  /* [FEAT-20260919-SHOWORIGSRC] The account-wide half of "แสดงข้อความต้นฉบับ".
     It is not on the room, so no room fetch can bring it — it is read from the
     operator's preferences and refreshed when the room modal writes it. Kept in
     state (rather than read inline at render) so a change in the modal repaints
     the bubbles immediately instead of at the next unrelated re-render.
     ค่ากลางไม่ได้มากับห้อง ต้องฟังเอง */
  const [allRoomsShowOriginal, setAllRoomsShowOriginal] = useState<boolean | null>(
    () => readShowOriginalAllRooms(),
  );
  useEffect(() => {
    const onChanged = () => setAllRoomsShowOriginal(readShowOriginalAllRooms());
    window.addEventListener(SHOW_ORIGINAL_ALL_ROOMS_EVENT, onChanged);
    return () =>
      window.removeEventListener(SHOW_ORIGINAL_ALL_ROOMS_EVENT, onChanged);
  }, []);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  /* [FEAT-20260819-INCHATTOAST] bumped on each INBOUND message for the open room.
     A counter, not a flag: a burst keeps ONE notice alive instead of stacking. */
  const [newMsgTick, setNewMsgTick] = useState(0);
  /* …and WHICH bubbles are new. A Set, not one id: several messages can land
     inside the 4s window and each deserves its own glow and its own deadline.
     Timers are tracked so a room switch or unmount cannot fire into a dead
     component. เก็บเป็นชุด เพราะรัวมาได้หลายข้อความ. */
  /* [FEAT-20260819-REPLYUI] which bubble is offering its Reply chip. Point at one
     and it shows for 10s; click one and it stays pinned until you click it again,
     click empty space, or press Reply. All of that lives in the hook. */
  const replyReveal = useTimedReveal();
  /* Clicking anywhere that is not a bubble puts a pinned chip away — owner:
     "จนกว่าจะกดพื้นที่ว่าง". The rows stop their own clicks from reaching the
     document, so clicking a bubble still toggles instead of dismissing. Only
     armed while something is pinned, so no listener runs in the common case. */
  useEffect(() => {
    if (!replyReveal.pinned) return;
    const away = () => replyReveal.clear();
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, [replyReveal.pinned, replyReveal.clear]);
  /* [FEAT-20260908-AITRANSLATE] a SECOND reveal, not a share of the reply one.
     ─────────────────────────────────────────────────────────────────────────
     🔴 They cannot share an instance: `useTimedReveal` holds ONE id at a time, so
     a shared instance would make the two chips a single unit — and the reply chip
     is customer-only while the translate chip serves both sides, so a bot bubble
     would drive a reveal that only the other chip can use.
     ⚠️ A second instance ALONE would render a chip nothing ever reveals: the only
     `.show()`/`.toggle()` call sites in this file are the two bubble handlers
     below, and they used to be gated on `onReplyTo` alone. They now drive BOTH.
     Miss that and the chip exists and never appears. */
  const translateReveal = useTimedReveal();
  /* the same dismiss-on-outside-click rule, armed only while pinned. Kept as its
     own effect rather than folded into the one above so either feature can be
     deleted without disturbing the other. */
  useEffect(() => {
    if (!translateReveal.pinned) return;
    const away = () => translateReveal.clear();
    document.addEventListener('click', away);
    return () => document.removeEventListener('click', away);
  }, [translateReveal.pinned, translateReveal.clear]);
  /* [FEAT-20260908-AITRANSLATE] which bubble has the language list open, by _id.
     One at a time, and null when none — so opening a room renders no picker and
     therefore fires no registry request. `null` is the state on mount and the
     state after every pick, which is what keeps "nothing translates by itself"
     true. เปิดห้อง = ไม่มี picker = ไม่ยิงอะไร. */
  const [langPickerFor, setLangPickerFor] = useState<string | null>(null);
  const [glowIds, setGlowIds] = useState<Set<string>>(new Set());
  const glowTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const glowMessage = useCallback((id: string) => {
    if (!id) return;
    setGlowIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
    glowTimersRef.current.push(setTimeout(() => {
      setGlowIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, NEW_MESSAGE_GLOW_MS));
  }, []);
  useEffect(() => () => {
    glowTimersRef.current.forEach(clearTimeout);
    glowTimersRef.current = [];
  }, []);
  const skipScrollRef = useRef(false);
  // Scroll geometry captured right before older messages are prepended, so the
  // viewport can be re-anchored to the message the reader was looking at.
  const prevScrollRef = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    setActiveRoom(room);
  }, [room]);

  const canToggleAssist = useMemo(() => {
    const auth = getStoredAuth();
    if (!auth) return false;
    const roleName = auth.role?.name?.toLowerCase() ?? '';
    const username = auth.user?.username?.toLowerCase() ?? '';
    return roleName === 'superuser' || username === 'dev' || roleName === 'superadmin' || roleName === 'admin';
  }, []);

  const fetchMessages = useCallback(async (lineUserId: string, targetPage = 1, append = false, targetHookId?: string) => {
    try {
      setLoadingMessages(true);
      if (append) {
        skipScrollRef.current = true;
      } else {
        skipScrollRef.current = false;
      }
      const res = await chatService.listMessages(lineUserId, targetPage, 10, targetHookId || hookId);
      if (res.room) {
        setActiveRoom((prev) => {
          if (!prev) return prev;
          const nextTranslateLang = res.room.translate_lang ?? prev.translate_lang;
          /* [FIX-20260918-LANGSPLIT] this block copies the room field by field,
             so a field that is not named here is SILENTLY DROPPED on every page
             load — the room would keep the stale source language forever. */
          const nextDetectedSource =
            res.room.detected_source_lang ?? prev.detected_source_lang;
          const nextShowOriginal =
            res.room.show_original_text !== undefined
              ? res.room.show_original_text
              : prev.show_original_text;
          /* [FEAT-20260919-SHOWORIGSRC] The comment above is not decoration — it
             is the reason this line exists. Without it the source column would be
             re-read from the server on every page load and then thrown away here,
             so a room switched to "ใช้ค่าเฉพาะห้องนี้" would revert to following
             the account setting the next time the list refreshed, with nothing in
             any log to show for it. */
          const nextShowOriginalSource =
            (res.room as any).show_original_text_source !== undefined
              ? normalizeShowOriginalSource(
                  (res.room as any).show_original_text_source,
                )
              : prev.show_original_text_source;
          const nextAutoTranslate =
            res.room.auto_translate !== undefined
              ? res.room.auto_translate
              : prev.auto_translate;
          const nextAutoSend =
            res.room.auto_send_translated !== undefined
              ? res.room.auto_send_translated
              : prev.auto_send_translated;
          const nextHookLang =
            res.room.hook_translate_lang ?? prev.hook_translate_lang;
          const nextHookAuto =
            res.room.hook_auto_translate ?? prev.hook_auto_translate;
          const nextEffectiveLang =
            res.room.effective_translate_lang ?? prev.effective_translate_lang;
          const nextEffectiveAuto =
            res.room.effective_auto_translate ?? prev.effective_auto_translate;

          if (
            prev.translate_lang === nextTranslateLang &&
            prev.detected_source_lang === nextDetectedSource &&
            prev.show_original_text === nextShowOriginal &&
            prev.show_original_text_source === nextShowOriginalSource &&
            prev.auto_translate === nextAutoTranslate &&
            prev.auto_send_translated === nextAutoSend &&
            prev.hook_translate_lang === nextHookLang &&
            prev.hook_auto_translate === nextHookAuto &&
            prev.effective_translate_lang === nextEffectiveLang &&
            prev.effective_auto_translate === nextEffectiveAuto
          ) {
            return prev;
          }

          return {
            ...prev,
            translate_lang: nextTranslateLang,
            detected_source_lang: nextDetectedSource,
            show_original_text: nextShowOriginal,
            show_original_text_source: nextShowOriginalSource,
            auto_translate: nextAutoTranslate,
            auto_send_translated: nextAutoSend,
            hook_translate_lang: nextHookLang,
            hook_auto_translate: nextHookAuto,
            effective_translate_lang: nextEffectiveLang,
            effective_auto_translate: nextEffectiveAuto,
          };
        });
      }
      const reversedData = [...res.data].reverse();
      if (append) {
        setMessages(prev => [...reversedData, ...prev]);
      } else {
        setMessages(reversedData);
      }
      setHasMore(targetPage < res.pagination.pages);
      setPage(targetPage);
    } catch (error) {
      console.error('Failed to fetch messages', error);
    } finally {
      setLoadingMessages(false);
    }
  }, [hookId]);

  // ==== [FEAT-20260801-CHATSEARCH] START — ค้นหา / กระโดด / กลับล่างสุด
  // ⚠️ ทุกตัวเรียก API "ครั้งเดียวต่อการกด" ไม่มี auto-load ตอน scroll
  //    ตามที่ผู้ใช้กำชับว่าห้ามโหลดหนักจนพัง — ปุ่มคุมจังหวะได้แน่นอนกว่า scroll
  /* [FEAT-2708-SEARCHMIN4] เจ้าของ 27/08: ยกขั้นต่ำ 2 → 4 ตัวอักษร ทั้ง gate
     และปุ่ม — เซฟ request เหมือนช่อง ticket search */
  const runSearch = useCallback(async () => {
    if (!activeRoom) return;
    const q = searchQ.trim();
    if (q.length < CHAT_SEARCH_MIN_CHARS) { setSearchHits([]); setSearchInfo(null); setSearchError(false); return; }
    try {
      setSearching(true);
      setSearchError(false);
      const res = await chatService.searchMessages(activeRoom.line_user_id, q, activeRoom.hook_id || hookId);
      setSearchHits(res.data || []);
      setSearchInfo({ truncated: res.truncated, days: res.limits?.days, scannedFrom: res.scanned_from });
    } catch (err) {
      console.error('search messages failed', err);
      setSearchHits([]);
      /* Clear the window info too: keeping the previous search's boundary would
         caption a failure with a date that was never searched on this attempt. */
      setSearchInfo(null);
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  }, [activeRoom, hookId, searchQ]);

  /** กระโดดไปข้อความที่เลือก — 1 request ได้หน้าต่างรอบตัวมันมาเลย ไม่ต้องไล่โหลด
      [FEAT-20260821-QUOTEJUMP] `by: 'provider'` = the id is LINE's (from a quote
      block whose target is outside the loaded window). The scroll always targets
      `res.anchor_id`, which the BE returns as OUR _id in both modes. */
  const jumpToMessage = useCallback(async (messageId: string, by: 'id' | 'provider' = 'id') => {
    if (!activeRoom) return;
    try {
      setLoadingMessages(true);
      skipScrollRef.current = true;   // อย่าเด้งลงล่างสุด เดี๋ยวเราเลื่อนไปที่เป้าหมายเอง
      const res = await chatService.listMessagesAround(activeRoom.line_user_id, messageId, activeRoom.hook_id || hookId, by);
      setMessages([...res.data].reverse());   // BE ส่งใหม่→เก่า · จอเรียงเก่า→ใหม่
      setAnchorMode(true);
      setAnchorId(res.anchor_id);
      setHasMore(res.has_older);              // ปุ่มโหลดเก่ากว่า (ปุ่มเดิมของห้อง)
      setHasNewer(res.has_newer);             // ปุ่มโหลดใหม่กว่า (โผล่เฉพาะโหมดนี้)
      // เลื่อนไปที่ข้อความเป้าหมายหลัง DOM วาดเสร็จ
      setTimeout(() => {
        const el = document.getElementById(`msg-${res.anchor_id}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    } catch (err) {
      console.error('jump to message failed', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [activeRoom, hookId]);

  /** กลับไปข้อความล่าสุด — จำเป็นมาก ไม่งั้นกระโดดไปลึก ๆ แล้วกลับไม่ได้ (1 request) */
  const backToLatest = useCallback(() => {
    if (!activeRoom) return;
    setAnchorMode(false);
    setAnchorId(null);
    setHasNewer(false);
    fetchMessages(activeRoom.line_user_id, 1, false, activeRoom.hook_id || hookId);
  }, [activeRoom, hookId, fetchMessages]);
  // ==== [FEAT-20260801-CHATSEARCH] END

  const activeRoomKey = activeRoom?._id
    ? `${String(activeRoom._id)}_${activeRoom.line_user_id || ''}`
    : activeRoom?.line_user_id;
  const activeHookId = activeRoom?.hook_id || hookId;

  useEffect(() => {
    if (activeRoom?.line_user_id) {
      fetchMessages(activeRoom.line_user_id, 1, false, activeHookId);
    } else {
      setMessages([]);
    }
  }, [activeRoomKey, activeHookId, fetchMessages]);

  // [FIX-20260728-VIDEO-PENDING] เพิ่มใหม่ — แก้ข้อความ "video_pending" ตัวเดียว
  // ให้กลายเป็น "video" ตรงจุด โดยไม่ fetchMessages ใหม่ทั้งห้อง (ไม่งั้นห้องจะ
  // กระตุก/เลื่อน scroll กลับ) เรียกจาก PendingVideoBubble เมื่อกดโหลดสำเร็จ
  // และจาก WS handler ตอนแอดมินอีกคนกดโหลดสำเร็จ (ดู useEffect รับ message:updated
  // ด้านล่าง)
  // revert: ลบฟังก์ชันนี้ + จุดที่เรียกใช้ (onVideoLoaded prop, WS handler)
  const handleVideoLoaded = useCallback((messageId: string, patch: { message_type: 'video'; internal_content_id: NonNullable<ChatMessage['internal_content_id']> }) => {
    skipScrollRef.current = true;
    setMessages(prev => prev.map(m => (
      m._id === messageId
        ? { ...m, message_type: patch.message_type, internal_content_id: patch.internal_content_id }
        : m
    )));
  }, []);

  // [FIX-20260728-VIDEO-PENDING] เพิ่มใหม่ — รับ WS "message:updated" เพื่อให้
  // แอดมินคนอื่นที่เปิดห้องเดียวกันอยู่เห็นวิดีโอเปลี่ยนจาก pending → ใช้สิทธิ์ได้ทันที
  // โดยไม่ต้อง refresh เอง ต่างจาก "message:new" ตรงที่ patch ข้อความที่มีอยู่แล้ว
  // ตรงจุด ไม่ remount/fetch ทั้งห้อง (จะทำให้ scroll กระตุก) เช็ค room_id ตรงกับ
  // ห้องที่เปิดอยู่ก่อน เพื่อไม่ให้ event ของห้องอื่นมา patch state ผิดห้อง
  // revert: ลบ useTicketWS call นี้ทั้งก้อน (import ยังใช้ได้ ไม่กระทบที่อื่น)
  // [FEAT-20260801-FLEXPROFILELIVE] ข้อความบอทที่กลายเป็นการ์ด flex ทีหลัง
  // (webhook ตอบ [[[flex_profile]]] → เขียนประวัติเป็น flex แล้วยิง message:updated)
  // patch ตรงจุดเหมือนเคสวิดีโอ ไม่ fetch ทั้งห้อง
  // ⚠️ แยกฟังก์ชันจาก handleVideoLoaded ตั้งใจ — คนละ field คนละเงื่อนไข
  //    ถ้าไปรวมกันจะต้องทำให้ type ของ patch หลวมลง แล้วเคสวิดีโอเสียการคุ้มกันไปด้วย
  // revert: ลบ callback นี้ + สาขา flex ใน useTicketWS ด้านล่าง
  const handleFlexUpdated = useCallback((messageId: string, metadata: any) => {
    skipScrollRef.current = true;
    setMessages(prev => prev.map(m => (
      m._id === messageId
        // เก็บ metadata เดิมไว้ แล้วทับเฉพาะที่ส่งมาใหม่ — payload ของ WS ตั้งใจส่งมาไม่ครบ
        ? { ...m, message_type: 'flex', metadata: { ...(m.metadata || {}), ...(metadata || {}) } }
        : m
    )));
  }, []);

  /* [FEAT-20260918-AUTOTRANS] ที่เก็บ `patchMessage` ให้ WS handler ด้านล่างเรียกได้
     โดยไม่ต้องอ้างตัวแปรที่ยังไม่ถูกประกาศ — ดูเหตุผลในสาขา translations */
  const patchMessageRef = useRef<((id: string, patch: Partial<ChatMessage>) => void) | null>(null);

  useTicketWS(useCallback((event) => {
    if (event.type !== 'message:updated') return;
    const data = event.data as any;
    if (!activeRoom || String(data.room_id) !== String(activeRoom._id)) return;
    /* [FEAT-20260918-AUTOTRANS] สาขาใหม่ วางไว้บนสุดและ return ทันที เหมือนที่
       สาขา flex ทำกับสาขาวิดีโอ → สองเส้นเดิมไม่ถูกแตะแม้แต่เงื่อนไขเดียว
       BE แปลข้อความขาเข้าให้แล้วยิง event นี้ตามมา (บับเบิลขึ้นจอไปก่อนแล้ว
       พร้อมต้นฉบับ) · patchMessage เป็นตัวเดียวกับที่ปุ่มแปลด้วยมือใช้ ⇒ การ์ด
       สองชั้นเรนเดอร์เหมือนกันเป๊ะ ไม่มีเส้นเรนเดอร์ที่สอง
       revert: ลบบล็อกนี้ แล้ว BE จะยิง event ที่ไม่มีใครฟัง (ไม่พัง) */
    if (Array.isArray(data.translations) && data.translations.length > 0) {
      /* ⚠️ ผ่าน ref ไม่ใช่เรียกตรง — `patchMessage` ถูกประกาศ "ใต้" บล็อกนี้
         (`const` = TDZ) การใส่มันลง dependency array ตรง ๆ พังตั้งแต่ตอน tsc
         ทางเลือกอื่นคือย้าย hook ขึ้นมา ซึ่งเปลี่ยนลำดับ hook/effect ของหน้าแชท
         — หน้านี้มี frozen-reconciliation guard อยู่ ห้ามขยับ · ref อ่านตอน
         event มาถึง ซึ่งตอนนั้นค่าถูก assign ไปแล้วแน่นอน */
      patchMessageRef.current?.(String(data._id), {
        translations: data.translations,
      });
      return;
    }
    // [FEAT-20260801-FLEXPROFILELIVE] สาขาใหม่ วางก่อนสาขาวิดีโอและ return ทันที
    // → เส้นวิดีโอเดิมไม่ถูกแตะเลยแม้แต่เงื่อนไขเดียว
    if (data.message_type === 'flex' && data.metadata?.flex_json) {
      handleFlexUpdated(String(data._id), data.metadata);
      return;
    }
    if (data.message_type !== 'video' || !data.internal_content_id) return;
    handleVideoLoaded(String(data._id), {
      message_type: 'video',
      internal_content_id: data.internal_content_id,
    });
  }, [activeRoom, handleVideoLoaded, handleFlexUpdated]));

  // ==== [FIX-20260728-NOBLINK] START — บล็อกนี้เพิ่มใหม่ทั้งหมด
  // อาการ: ส่งข้อความเสร็จ (และตอนมีข้อความเข้า) ห้องแชท "กระพริบ" แล้วโหลดใหม่
  //
  // ต้นเหตุ: TicketChat.tsx ใส่ chatRefreshKey ไว้ใน React `key` ของ
  // <ChatRoomView> แล้วบวกค่าทุกครั้งที่ส่ง/มีข้อความเข้า
  // การเปลี่ยน key = React "unmount + mount ใหม่ทั้ง component" ไม่ใช่แค่ refetch
  // ผลคือทุกข้อความเดียว: fetch หน้า 1 ใหม่ + รูป/วิดีโอทุกใบในห้องถูกขอใหม่
  // + state ทั้งหมดหาย + scroll เด้ง
  //
  // เรื่อง "ต้องไม่เพิ่มภาระ" — ทางนี้ภาระ "ลดลง" ไม่ใช่เพิ่ม:
  //   เดิม 1 ข้อความ = 1 request listMessages (10 ข้อความ) + re-request media ทั้งห้อง
  //   ใหม่ 1 ข้อความ = setMessages ครั้งเดียว ไม่มี network call เลย
  // ใช้ payload ที่ WS ส่งมาอยู่แล้ว ไม่ได้ยิงถามข้อมูลเพิ่ม
  //
  // dedupe ด้วย _id: ถ้าผู้ส่งเป็นตัวเราเอง ข้อความจะถูก append จาก response
  // ของ API ไปแล้ว (ดู appendMessage ที่ export ผ่าน ref) พอ WS ส่ง event
  // ตัวเดิมตามมาจะต้องไม่ขึ้นซ้ำ
  //
  // ยึดหลักเดียวกับ [FIX-20260728-VIDEO-PENDING] ด้านบน: patch state ตรงจุด
  // ไม่ fetch ทั้งห้อง · เช็ค room_id ก่อนเสมอ กัน event ห้องอื่นมาลงผิดห้อง
  //
  // revert: ลบบล็อกนี้ทั้งก้อน + คืน key={...-${chatRefreshKey}} ใน TicketChat.tsx
  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      if (!msg?._id) return prev;
      // [FIX-20260728-NOBLINK-EMPTY] ด่านสุดท้าย: ห้าม append ข้อความที่ไม่มีเนื้อ
      // ไม่งั้นจะได้ bubble ว่างเปล่า (เคยเกิดจริงตอน append payload ของ WS
      // ที่มีแค่ `preview` ไม่มี `content`) · เคสสื่อ (รูป/วิดีโอ) ไม่มี content
      // เป็นข้อความก็จริง แต่ต้องมี internal_content_id ถึงจะเรนเดอร์ได้
      // ถ้าไม่เข้าเงื่อนไขไหนเลย = ปล่อยผ่านไปให้ fallback refetch จัดการแทน
      const hasBody =
        (typeof msg.content === 'string' && msg.content.length > 0) ||
        (msg.content !== undefined && msg.content !== null && typeof msg.content !== 'string') ||
        !!msg.internal_content_id ||
        msg.message_type === 'video_pending';
      if (!hasBody) return prev;
      if (prev.some(m => String(m._id) === String(msg._id))) return prev; // กันซ้ำ
      return [...prev, msg];
    });

    /* [FEAT-20260918-AUTOTRANS] 🔴 การแปลอัตโนมัติ "ไม่ได้อยู่ตรงนี้อีกแล้ว"
       ===================================================================
       ของเดิมบล็อกนี้ยิงแปลเองจากเบราว์เซอร์ ทุกครั้งที่ WS ส่งข้อความเข้ามา
       มันเสียสามอย่างพร้อมกัน:
         · ไม่มีใครเปิดห้องอยู่ = ไม่มีอะไรถูกแปล (แล้วก็ไม่ย้อนกลับมาแปลให้ด้วย)
         · แอดมิน N คนเปิดห้องเดียวกัน = จ่ายค่า vendor N ครั้งต่อข้อความเดียว
           (cache ฝั่ง BE ช่วยไม่ทัน เพราะทุก request มาถึงพร้อมกันก่อนแถวแรกถูกเขียน)
         · audit ลงชื่อคนที่บังเอิญเปิดจอค้างไว้ ทั้งที่เขาไม่ได้สั่งแปล
       ตอนนี้ BE แปลให้ตอนเก็บข้อความ (`translate/auto/`) แล้วยิง `message:updated`
       กลับมา — ดูสาขา translations ใน WS handler ด้านบน หน้าจอจึงได้คำแปล
       "ครั้งเดียวต่อข้อความ" ไม่ว่าจะเปิดกี่จอ และได้แม้ตอนไม่มีใครเปิดเลย

       ⚠️ ปุ่มแปลด้วยมือบนบับเบิลยังอยู่ครบ ไม่ได้ถูกแตะ — ที่ถอดออกคือ "อัตโนมัติ"
       ⚠️ ลำดับ deploy: BE ต้องขึ้นก่อนและเปิด `CHAT_AUTO_TRANSLATE=on` ไม่งั้นจะไม่มี
          ใครแปลให้เลย · ถ้าเปิดทั้งสองฝั่งพร้อมกันตอนที่บล็อกนี้ยังอยู่ = แปลซ้ำสองที่
       revert: เอาบล็อกเดิมกลับจาก tag `savepoint-langsplit-fe-18092026` */
  }, []);

  // [FEAT-20260908-AITRANSLATE] แก้ข้อความ "ที่มีอยู่แล้ว" ตรงจุด จากผลลัพธ์ HTTP
  // ที่หน้าแม่เพิ่งได้มา (คำแปล) — ไม่ต้องรอ WS (ไม่มีทางมา) และไม่ต้องโหลดห้องใหม่
  //
  // ⚠️ เขียนตามรูปแบบ `handleVideoLoaded` ด้านบนเป๊ะ — `setMessages(prev =>
  //    prev.map(...))` ตัวเดียวกัน คนละ field เท่านั้น จะได้อ่านเหมือนเพื่อนบ้าน
  //    ไม่ใช่สำนวนใหม่ · ต่างกันตรง `patch` เป็น Partial (ทั่วไปกว่า) เพราะตัวนี้
  //    เป็น API สาธารณะที่หน้าแม่เรียก ไม่ใช่ helper เฉพาะเคสวิดีโอ
  //
  // 🔴 ไม่เจอ id = ไม่ทำอะไรเลย และคืน `prev` ตัวเดิม (ไม่ใช่ array ใหม่)
  //    - ห้าม append: ข้อความนั้นไม่ได้อยู่บนจอ การยัดเข้าไปคือสร้าง bubble ผีที่
  //      ไม่มีบริบทรอบตัว
  //    - ห้าม fallback ไป refetch: นั่นคือ "โหลดหน้า 1 ใหม่" ซึ่งจะดีดข้อความเก่า
  //      ที่ผู้ใช้เพิ่งกดแปลหลุดจอ — เป็นข้อบกพร่องเดิมที่ฟังก์ชันนี้เกิดมาเพื่อแก้
  //    - คืน `prev` ตัวเดิม ⇒ React bail out ไม่ re-render ทั้งลิสต์
  //      (ถ้าใช้ `.map` เปล่า ๆ จะได้ array ใหม่ทุกครั้ง = re-render ฟรี ๆ)
  //    เงียบคือคำตอบที่ถูก: ข้อความไม่อยู่บนจอ ก็ไม่มีอะไรให้แก้
  //
  // ⚠️ เทียบ id ด้วย String() ทั้งสองฝั่งแบบเดียวกับ `appendMessage` — ฝั่งเรียก
  //    ส่ง `String(msg._id)` มา ส่วนใน state เป็นค่าที่ API ส่งมาดิบ ๆ
  // revert: ลบ callback นี้ + คีย์ `patchMessage` ใน onReadyRef + ชนิดของ prop
  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    skipScrollRef.current = true;
    setMessages(prev => (
      prev.some(m => String(m._id) === String(id))
        ? prev.map(m => (String(m._id) === String(id) ? { ...m, ...patch } : m))
        : prev
    ));
    /* [FEAT-20260918-ROOMTRANS] a translation can tell us what language the
       customer WRITES IN — worth remembering for the next screen.
       [FIX-20260918-LANGSPLIT] 🔴 it lands in `detected_source_lang`, NOT in
       `translate_lang`. `translate_lang` is the TARGET the operator picked in
       the modal; writing the detected source there meant a room set to English
       flipped to Burmese the moment a Burmese message was translated in it, and
       the next save wrote that back to the server. The BE makes the same split
       (`remember-source-lang.ts`), so the two sides agree.
       ต้นทางกับปลายทางคนละช่อง · revert ได้ด้วยการชี้กลับไปที่ translate_lang
       (ซึ่งคือการเอาบั๊กกลับมา อย่าทำ) */
    if (patch.translations && patch.translations.length > 0) {
      const detectedFrom = patch.translations[0].from;
      if (detectedFrom && isTranslateLanguage(detectedFrom)) {
        setActiveRoom(prev => (prev && prev.detected_source_lang !== detectedFrom ? { ...prev, detected_source_lang: detectedFrom } : prev));
      }
    }
  }, []);

  /* [FEAT-20260918-AUTOTRANS] hand the WS handler above its own reference. The
     handler is declared first (moving it would change this page's hook order,
     which the frozen-reconciliation guard forbids), so the link is made here,
     on every render, and read only when an event actually arrives. */
  patchMessageRef.current = patchMessage;

  // ให้ TicketChat สั่ง append ข้อความที่ "เราส่งเอง" ได้ทันทีที่ API ตอบกลับ
  // โดยไม่ต้องรอ WS และไม่ต้อง remount
  useEffect(() => {
    if (!onReadyRef) return;
    onReadyRef({ appendMessage, refetch: () => {
      if (activeRoom) fetchMessages(activeRoom.line_user_id, 1, false, activeRoom.hook_id || hookId);
    }, patchMessage });
  }, [onReadyRef, appendMessage, activeRoom, hookId, fetchMessages, patchMessage]);

  useTicketWS(useCallback((event) => {
    if (event.type !== 'message:new') return;
    const data = event.data as any;
    if (!activeRoom) return;
    // event ของห้องอื่น → ไม่เกี่ยวกับ state นี้ (TicketChat จัดการ badge unread เอง)
    const openRoomId = String(activeRoom._id || (activeRoom as any).line_user_id || '');
    if (String(data.room_id) !== openRoomId) return;
    // [FIX-20260728-NOBLINK-EMPTY] payload ของ message:new "ไม่มี field content"
    // ฝั่ง BE (chatHistoryService.logMessage) ส่งมาแค่ `preview` = content.slice(0,120)
    // และคอมเมนต์ที่นั่นเขียนไว้ตรง ๆ ว่า "The FE refetches the room for rich content"
    //
    // รอบแรกผมเช็คด้วย (data.content !== undefined || data.message_type) ซึ่ง
    // "ผ่าน" เพราะ message_type มีจริง เลย append payload ที่ไม่มี content เข้าไป
    // → bubble ขึ้นพร้อมเวลาถูกต้อง แต่ข้อความว่างเปล่า (เห็นในภาพที่ผู้ใช้ส่งมา)
    // refresh แล้วหายเพราะ listMessages ดึงตัวจริงที่มี content มาแทน
    //
    // แก้: ยอมรับเฉพาะ payload ที่มี content จริงเท่านั้น ถ้ามีแค่ preview
    // ให้เอา preview มาเป็น content (เป็นข้อความจริง แค่ตัดที่ 120 ตัวอักษร)
    // สำหรับ "ข้อความสั้น" ซึ่งเป็นเคสส่วนใหญ่ → ตรงกับของจริง 100% ไม่ต้องยิง network
    // ส่วนข้อความยาวเกิน 120 หรือสื่อ (รูป/วิดีโอ/สติกเกอร์/flex) ที่ preview
    // แทนไม่ได้ → fallback refetch เหมือนพฤติกรรมเดิม
    /* [FEAT-20260819-INCHATTOAST] a CUSTOMER message for the room on screen. The
       admin's own outbound is excluded — announcing your own message back to you is
       noise. Raised BEFORE the append/refetch branches below, so the notice shows on
       every inbound whichever branch renders the bubble.
       เฉพาะข้อความจากลูกค้า · ของแอดมินเองไม่นับ. */
    if (data.sender_type === 'customer' && !isTypingInInput()) setNewMsgTick(t => t + 1);
    /* The glow is NOT gated on typing: the notice is a nudge for someone looking
       away, but "which bubble just arrived" is worth marking even while you type.
       glow ไม่ผูกกับ focus — มันบอกว่า "อันไหนใหม่" ไม่ใช่ "มีของใหม่". */
    if (data.sender_type === 'customer') glowMessage(String(data._id ?? ''));
    const isRichKind = data.message_type && data.message_type !== 'text';
    const previewIsTruncated = typeof data.preview === 'string' && data.preview.length >= 120;
    if (data._id && data.content !== undefined) {
      appendMessage(data as ChatMessage);          // payload ครบจริง (เผื่ออนาคต BE ส่ง content มา)
      return;
    }
    if (data._id && typeof data.preview === 'string' && !isRichKind && !previewIsTruncated) {
      appendMessage({ ...data, content: data.preview } as ChatMessage);
      return;
    }
    // payload แทนข้อความจริงไม่ได้ (สื่อ / ข้อความยาวเกิน 120 / ไม่มี preview)
    // → fetch หน้าแรกเหมือนพฤติกรรมเดิม ดีกว่าโชว์ bubble ว่าง
    fetchMessages(activeRoom.line_user_id, 1, false, activeRoom.hook_id || hookId);
  }, [activeRoom, appendMessage, fetchMessages, hookId, glowMessage]));
  // ==== [FIX-20260728-NOBLINK] END

  useEffect(() => {
    if (skipScrollRef.current) {
      skipScrollRef.current = false;
      // After prepending older messages, scrollTop still points at the same
      // pixel offset — now inside the new batch. Shift it by the height that
      // was added so the reader stays on the message they were looking at.
      const container = chatContainerRef.current;
      if (container && prevScrollRef.current) {
        container.scrollTop = container.scrollHeight - prevScrollRef.current.height + prevScrollRef.current.top;
      }
      prevScrollRef.current = null;
      return;
    }

    const scrollToBottomInstant = () => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      }
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as any });
    };

    scrollToBottomInstant();
    const timer1 = setTimeout(scrollToBottomInstant, 50);
    const timer2 = setTimeout(scrollToBottomInstant, 200);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [messages]);

  const handleLoadMore = () => {
    if (activeRoom && hasMore && !loadingMessages) {
      const container = chatContainerRef.current;
      prevScrollRef.current = container
        ? { height: container.scrollHeight, top: container.scrollTop }
        : null;
      fetchMessages(activeRoom.line_user_id, page + 1, true, activeRoom.hook_id || hookId);
    }
  };

  const handleSyncProfile = async () => {
    if (!activeRoom) return;
    try {
      setSyncingProfile(true);
      const targetHookId = (messages as any[]).find(m => m.hook_id)?.hook_id || activeRoom.hook_id || hookId;
      await chatService.syncProfile(activeRoom.line_user_id, targetHookId);
    } catch (error) {
      console.error('Failed to sync profile', error);
    } finally {
      setSyncingProfile(false);
    }
  };

  const handleConfirmAssistToggle = async () => {
    if (!activeRoom) return;
    try {
      setIsUpdatingAssist(true);
      const newStatus = !activeRoom.assist_status;
      await chatService.updateAssistStatus(activeRoom._id, newStatus);
      setActiveRoom(prev => prev ? { ...prev, assist_status: newStatus } : null);
      // Notify TicketChat so the yellow bot bar updates in real-time
      window.dispatchEvent(new CustomEvent('tc:assist-changed', {
        detail: { roomId: activeRoom._id, assistStatus: newStatus },
      }));
    } catch (error) {
      console.error('Failed to update assist status', error);
    } finally {
      setIsUpdatingAssist(false);
      setAssistConfirmOpen(false);
    }
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      // Thai locale → Thai month names + Buddhist year (พ.ศ.); otherwise en-GB.
      const intlLocale = locale === 'th' ? 'th-TH' : 'en-GB';
      return date.toLocaleString(intlLocale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return '';
    }
  };

  const formatDividerTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch {
      return '';
    }
  };

  if (!activeRoom) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-300 bg-slate-50 h-full">
        <Plus size={48} className="mb-4 opacity-20" />
        <p>{t('ticketui.room.pick_chat', 'เลือกรายการแชตเพื่อดูข้อความ')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-row h-full min-h-0 overflow-hidden bg-white relative w-full">
      {/* Messages Column */}
      {/* [FEAT-20260801-CHATSEARCH] เพิ่ม relative ให้ปุ่ม "ไปข้อความล่าสุด" (absolute)
          ยึดกับกล่องนี้ ไม่หลุดไปยึดทั้งหน้าจอ · เป็นการเพิ่มคลาสเดียว ไม่กระทบ layout เดิม
          revert: เอา relative ออก */}
      <div className="relative flex-1 flex flex-col h-full min-h-0 border-r border-slate-200 overflow-hidden min-w-0">
        {/* [FEAT-20260905-CUSTPROV PART 5] The header bar is its own module now:
            `components/chat/room-header/` (barrel only — never a deep import).
            📖 plan PART 5 §24-28, as CORRECTED by PART 7 §38: no provider folder
            and no registry on the FE.
            ⚠️ The markup moved VERBATIM. Every piece of state the bar reads still
               lives in THIS file and travels down as props, because each one also
               drives something outside the bar (searchOpen → the search panel,
               showUserDetail → the detail box, quotaOpen → QuotaModal, the three
               quota counters → the effects above). Moving a useState into a child
               changes re-render and effect timing = a behaviour change, not a move
               (dev-local §6.4). ย้าย markup ได้ ย้าย state ไม่ได้
            revert: paste the bar's JSX back in place of this element and delete
                    the folder — full steps in RoomHeader.tsx's header. */}
        <RoomHeader
          activeRoom={activeRoom}
          isOrphanRow={isOrphanRow}
          headerTitle={headerTitle}
          oaName={oaName}
          headerTier={headerTier}
          showTierBadge={showTierBadge}
          memberData={memberData}
          hookId={hookId}
          newMsgTick={newMsgTick}
          quotaTick={quotaTick}
          quotaForceTick={quotaForceTick}
          quotaWarnTick={quotaWarnTick}
          onQuotaDanger={() => setQuotaWarnTick((t) => t + 1)}
          onOpenQuota={() => setQuotaOpen(true)}
          onOpenFontScale={onOpenFontScale}
          fontScaleLabel={fontScaleLabel}
          /* [FEAT-20260918-ROOMTRANS] Translate button & settings */
          onTranslateLatest={onTranslate ? handleTranslateLatest : undefined}
          isTranslatingLatest={isTranslatingLatest}
          onUpdateRoomTranslateSettings={handleUpdateRoomTranslateSettings}
          searchOpen={searchOpen}
          onToggleSearch={() => {
            setSearchOpen(o => {
              if (o) { setSearchQ(''); setSearchHits([]); setSearchInfo(null); setSearchError(false); }
              return !o;
            });
          }}
          caseClosed={caseClosed}
          onCloseCase={onCloseCase}
          canCloseCase={canCloseCase}
          showDetailBox={showDetailBox}
          showUserDetail={showUserDetail}
          onToggleUserDetail={() => setShowUserDetail(prev => !prev)}
          onCollapse={onCollapse}
          onToggleExpand={onToggleExpand}
          isExpanded={isExpanded}
          onClose={onClose}
        />

        {/* ==== [FEAT-20260801-CHATSEARCH] แผงค้นหา — โผล่เมื่อกดปุ่มแว่นขยายเท่านั้น
             ⚠️ ยิง API เฉพาะตอนกด Enter / กดปุ่มค้นหา ไม่ยิงตามการพิมพ์
                (ไม่ต้อง debounce ให้ซับซ้อน และไม่มีทางยิงรัวจนหนัก)
             ⚠️ ปิดแผง = ล้างผลลัพธ์ ไม่ให้ค้าง state ข้ามห้อง
             revert: ลบบล็อกนี้ทั้งก้อน */}
        {searchOpen && (
          <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                placeholder={t('ticketui.room.search_placeholder', 'ค้นหาข้อความในห้องนี้ (อย่างน้อย 4 ตัวอักษร)')}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={searching || searchQ.trim().length < CHAT_SEARCH_MIN_CHARS}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-40 transition-colors"
              >
                {searching ? t('ticketui.room.searching', 'กำลังค้น...') : t('ticketui.common.search', 'ค้นหา')}
              </button>
            </div>

            {searchHits.length > 0 && (
              <div className="mt-2 max-h-56 overflow-y-auto custom-scrollbar border border-slate-100 rounded-lg divide-y divide-slate-100">
                {searchHits.map(hit => (
                  <button
                    key={hit._id}
                    type="button"
                    onClick={() => jumpToMessage(String(hit._id))}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span>{hit.sender_type === 'customer' ? t('ticketui.common.customer', 'ลูกค้า') : t('ticketui.room.bot_or_admin', 'บอท/แอดมิน')}</span>
                      <span>{formatTime(hit.created_at)}</span>
                    </div>
                    <div className="text-xs text-slate-700 line-clamp-2">{hit.snippet}</div>
                  </button>
                ))}
              </div>
            )}

            {/* Empty / truncated results must be spelled out, so nobody reads them as
                "this room never contained that word".
                [FIX-2708-SEARCHHONEST] three outcomes now get three separate sentences:
                the request failed, nothing matched inside the window, and — always —
                where that window actually starts. The gate now uses CHAT_SEARCH_MIN_CHARS;
                it was still hardcoded to 2 after the minimum moved to 4, so typing 2-3
                characters claimed "not found" for a search that was never sent. */}
            {!searching && searchError && (
              <p data-testid="chat-search-error" className="mt-2 text-[11px] text-rose-500">
                {t('ticketui.room.search_failed', 'ค้นหาไม่สำเร็จ — ลองใหม่อีกครั้ง (ยังไม่ได้ค้นข้อความในห้องนี้)')}
              </p>
            )}
            {!searching && !searchError && searchQ.trim().length >= CHAT_SEARCH_MIN_CHARS && searchHits.length === 0 && (
              <p data-testid="chat-search-empty" className="mt-2 text-[11px] text-slate-400">
                {t('ticketui.room.search_empty_pre', 'ไม่พบข้อความ (ค้นเฉพาะข้อความตัวอักษร ย้อนหลัง')} {searchInfo?.days ?? 7} {t('ticketui.room.search_empty_days', 'วัน)')}
                {searchInfo?.scannedFrom && (
                  <> — {t('ticketui.room.search_from_pre', 'ค้นตั้งแต่')} {formatTime(searchInfo.scannedFrom)} {t('ticketui.room.search_from_post', 'เป็นต้นมา · ข้อความที่เก่ากว่านี้ยังอยู่ในห้อง แต่ไม่ถูกค้น')}</>
                )}
              </p>
            )}
            {searchInfo?.truncated && (
              <p className="mt-1 text-[11px] text-amber-500">
                {t('ticketui.room.search_truncated', 'แสดงผลลัพธ์ล่าสุดเท่านั้น — ยังมีมากกว่านี้ ลองพิมพ์ให้เจาะจงขึ้น')}
              </p>
            )}
          </div>
        )}

        {/* Message Stream */}
        <div ref={chatContainerRef} className="tc-chat-bg flex-1 p-4 flex flex-col gap-4 overflow-y-auto custom-scrollbar min-h-0 relative">
          {hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMessages}
              className="tc-load-older mx-auto shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-full transition-all"
            >
              {loadingMessages ? (
                <>
                  <Loader2 size={13} className="animate-spin" /> {t('webhook_logs.loading', 'กำลังโหลด...')}
                </>
              ) : (
                <>
                  <ChevronsUp size={13} className="tc-load-older-arrow" /> {t('ticketui.room.load_older', 'โหลดข้อความก่อนหน้า')}
                </>
              )}
            </button>
          )}
          {loadingMessages && page === 1 ? (
            /* skeleton — alternating chat-bubble placeholders (both themes via .tc-skel) */
            <div className="flex-1 flex flex-col gap-4 py-2">
              {[0,1,2,3,4].map(i => {
                const mine = i % 2 === 1;
                return (
                  <div key={i} className={`flex gap-2 items-start ${mine ? 'justify-end' : ''}`}>
                    {!mine && <div className="tc-skel w-8 h-8 rounded-full shrink-0" />}
                    <div className={`flex flex-col gap-1.5 ${mine ? 'items-end' : ''}`}>
                      <div className="tc-skel h-3 w-16 rounded" />
                      <div className="tc-skel rounded-2xl" style={{ width: `${140 + (i * 37) % 120}px`, height: `${38 + (i % 3) * 16}px` }} />
                    </div>
                    {mine && <div className="tc-skel w-8 h-8 rounded-full shrink-0" />}
                  </div>
                );
              })}
              <div className="flex items-center justify-center gap-2 text-xs mt-2 tc-skel-label">
                <Loader2 className="animate-spin" size={14} /> {t('ticketui.room.loading_messages', 'กำลังโหลดข้อความ...')}
              </div>
            </div>
          ) : renderMessages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-xs">{t('ticketui.room.no_messages', 'ยังไม่มีข้อความ')}</div>
          ) : (
            renderMessages.map(msg => {
              /* [FIX-20260830-STICKERAVATAR] the customer's avatar, ONE definition.
                 🔴 The bug: the sticker branch returns before the normal bubble
                    row, and only that row drew an avatar — so an incoming
                    sticker had none while every other incoming message did.
                 Declared here (not copied into the branch) so the two rows can
                 never drift apart: same size, same fallback circle, same
                 `shrink-0 mt-1` alignment. */
              const customerAvatar =
                activeRoom.user_data?.picture_url ? (
                  <img src={activeRoom.user_data.picture_url} className="w-8 h-8 rounded-full shrink-0 mt-1 object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-300 shrink-0 mt-1" />
                );
              /* [FIX-20260831-STICKERSENDER] อวตารฝั่งเรา ONE definition — ฝาแฝดของ
                 `customerAvatar` ข้างบน และเกิดจากบั๊กเดียวกันเป๊ะ
                 🔴 แถวสติกเกอร์ `return` ก่อนถึงท้ายแถวข้อความ ⇒ สติกเกอร์ที่แอดมินส่ง
                    ไม่มีทั้งชื่อและอวตาร ทั้งที่ข้อความ/รูปในห้องเดียวกันมีครบ
                 ประกาศไว้ที่นี่ (ไม่ก็อปเข้าไปในสาขา) ด้วยเหตุผลเดียวกับ
                 `customerAvatar`: สองแถวจะดริฟต์กันไม่ได้ — สีเดียวกัน ขนาดเดียวกัน
                 fallback ป้าย Bot ชุดเดียวกัน · `stickerAvatar.dom.test.tsx` เฝ้าว่า
                 markup ต้องมี **ชุดเดียว** ในไฟล์นี้
                 ⚠️ ไม่มีชื่อ = ข้อความบอทจริง/แถวเก่า ⇒ ป้าย Bot ม่วงเหมือนเดิมทุกอย่าง
                 revert: ลบ const นี้ แล้วเอา IIFE เดิมกลับไปไว้ท้ายแถวข้อความ */
              const botAvatar = (() => {
                const sender = adminSenderName(msg);
                if (!sender) {
                  return (
                    <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center shrink-0 mt-1 text-white text-[10px] font-bold">
                      Bot
                    </div>
                  );
                }
                return (
                  <div
                    className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center shrink-0 mt-1 text-white text-[13px] font-bold uppercase"
                    title={sender}
                  >
                    {sender.charAt(0)}
                  </div>
                );
              })();
              // System messages branch FIRST (keyed on message_type, so normal
              // text/image bubbles below are untouched).
              if (msg.message_type === 'divider') {
                {/* [FEAT-2708-DIVIDERDISPLAY] จอโชว์ displayName เดี่ยว — ข้อมูลเก็บคู่เดิม */}
                return <SystemDivider key={msg._id} label={dividerActorDisplay(msg.content, msg.metadata?.variant)} variant={msg.metadata?.variant} time={formatDividerTime(msg.created_at)} />;
              }
              if (msg.message_type === 'inline_note') {
                return <InlineNoteBubble key={msg._id} content={msg.content} author={msg.metadata?.author_name} time={formatTime(msg.created_at)} />;
              }
              if (msg.message_type === 'sticker') {
                // LINE sticker image from the public CDN. Prefer metadata (set on
                // both outbound sends and, since the fix, inbound webhooks); fall
                // back to raw_content for older inbound rows saved before the fix —
                // raw_content is the whole webhook envelope, so the id lives at
                // events[0].message.stickerId (not .message.stickerId).
                const rc = (msg as any).raw_content;
                const sid = msg.metadata?.stickerId
                  || rc?.events?.[0]?.message?.stickerId
                  || rc?.message?.stickerId;
                const isBot = msg.sender_type === 'bot';
                return (
                  <div key={msg._id} id={`msg-${msg._id}`} className={`flex gap-2 items-start ${isBot ? 'justify-end' : 'justify-start'} my-1 ${anchorId === String(msg._id) ? 'tc-jump-hit' : ''}`}>
                    {/* [FIX-20260830-STICKERAVATAR] same rule as the text row:
                        the avatar shows for the CUSTOMER side only. `sender_type`
                        is checked, not `!isBot` — a bot/admin/system sender must
                        not borrow the customer's picture. */}
                    {msg.sender_type === 'customer' && customerAvatar}
                    <div className="flex flex-col gap-0.5 max-w-[40%]">
                      <span className={`text-[10px] text-slate-400 px-1 ${isBot ? 'text-right' : ''}`}>{formatTime(msg.created_at)}</span>
                      {sid ? (
                        <img
                          src={`https://stickershop.line-scdn.net/stickershop/v1/sticker/${sid}/android/sticker.png`}
                          alt="sticker" className="w-24 h-24 object-contain"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className="text-xs text-slate-400 italic px-2 py-1">[sticker]</span>
                      )}
                      {/* [FIX-20260831-STICKERSENDER] เซ็นชื่อใต้สติกเกอร์เหมือนบับเบิลอื่น
                          ─────────────────────────────────────────────────────────────
                          แถวสติกเกอร์ `return` ออกไปก่อนถึงบล็อกเซ็นชื่อของ
                          [FEAT-20260729-ADMINSENDER] (อยู่ท้ายแถวข้อความปกติ) ⇒ สติกเกอร์
                          ที่แอดมินส่งจึงไม่มีชื่อคนส่ง ทั้งที่ข้อความ/รูปในห้องเดียวกันมี
                          ⇒ ห้องที่มีแอดมินหลายคนอ่านไม่ออกว่าใครส่งสติกเกอร์นั้น
                          BE บันทึกไว้ให้อยู่แล้ว (`chat.service.ts` push-sticker เขียน
                          `metadata.sender_name`) — ที่ขาดคือฝั่งแสดงผลอย่างเดียว
                          ใช้ `adminSenderName()` ตัวเดิม เงื่อนไขเดียวกับแถวข้อความเป๊ะ
                          ⇒ ข้อความบอทจริง/แถวเก่าก่อนฟีเจอร์นี้ยังไม่มีชื่อเหมือนเดิม
                          revert: ลบบล็อกนี้ */}
                      {isBot && adminSenderName(msg) && (
                        <div className="text-[10px] text-slate-400 px-1 text-right">
                          {adminSenderName(msg)}
                        </div>
                      )}
                    </div>
                    {/* [FIX-20260831-STICKERSENDER] อวตารฝั่งเรา — ตัวเดียวกับแถวข้อความ
                        วางหลังคอลัมน์ จึงไปอยู่ขวาสุดของแถว เหมือน `customerAvatar`
                        ที่อยู่หน้าคอลัมน์แล้วไปอยู่ซ้ายสุด · แถวนี้เป็น flex อยู่แล้ว
                        ไม่ต้องแตะ layout อะไรเพิ่ม */}
                    {isBot && botAvatar}
                  </div>
                );
              }
              return (
              <div key={msg._id} id={`msg-${msg._id}`}
                /* [FEAT-20260819-REPLYUI] the ROW only ever CLOSES the chip — owner:
                   "คลิก row ข้างนอก bubble = ต้องปิดได้ แต่ห้ามเปิด". Revealing is the
                   bubble's job (below), so the wide empty space beside a short message
                   is dead area for opening and live area for dismissing. */
                /* [FEAT-20260908-AITRANSLATE] the same rule now closes BOTH chips
                   and the language list. Only the GATE widened — the row still
                   never opens anything, and the className below is untouched. */
                onClick={(onReplyTo || onTranslate) ? () => {
                  if (onReplyTo) replyReveal.clear();
                  if (onTranslate) { translateReveal.clear(); setLangPickerFor(null); }
                } : undefined} className={`flex gap-2 items-start ${msg.sender_type === 'bot' ? 'justify-end' : ''} ${anchorId === String(msg._id) ? 'tc-jump-hit' : ''}`}>
                {/* [FIX-20260830-STICKERAVATAR] shared with the sticker row above */}
                {msg.sender_type === 'customer' && customerAvatar}
                {/* [FEAT-20260819-INCHATTOAST] tc-msg-glow rings the BUBBLE (the last
                    child), not this wrapper which also holds the time — see index.css. */}
                <div
                  /* [FEAT-20260819-REPLYUI] pointing HERE reveals the chip for 10s and
                     clicking pins it. `w-fit` matters: without it this block stretches to
                     the full 75% and "hovering the bubble" would mean hovering half the
                     row. stopPropagation keeps a bubble click from reaching the row's
                     dismiss handler. */
                  /* 🔴 [FEAT-20260908-AITRANSLATE] THESE TWO LINES ARE THE ONLY
                     `.show()` / `.toggle()` CALL SITES IN THIS FILE. A second
                     `useTimedReveal` beside the first is driven by nothing unless
                     they drive it too — the chip would exist and never appear.
                     So the gate is "either prop", and each reveal is fired only
                     for the prop that owns it: a page that passes only
                     `onReplyTo` gets byte-identical behaviour to before. */
                  onMouseEnter={(onReplyTo || onTranslate) ? () => {
                    if (onReplyTo) replyReveal.show(String(msg._id));
                    if (onTranslate) translateReveal.show(String(msg._id));
                  } : undefined}
                  onClick={(onReplyTo || onTranslate) ? (e) => {
                    e.stopPropagation();
                    if (onReplyTo) replyReveal.toggle(String(msg._id));
                    if (onTranslate) translateReveal.toggle(String(msg._id));
                  } : undefined}
                  /* [UI-20260826-FLEXHUGRIGHT รอบ 3] จัดชิดขวาที่ **กล่องครอบ** ไม่ใช่ที่การ์ด
                     ─────────────────────────────────────────────────────────────
                     🔴 สองรอบก่อนแก้ที่ตัวการ์ด (`ml-auto`, `w-fit`) แล้วเจ้าของยังเห็น
                        ช่องว่างอยู่ · เพราะกล่องนี้กว้างตาม **ลูกที่กว้างที่สุด** ซึ่งบางที
                        เป็นบรรทัดเวลา ไม่ใช่การ์ด ⇒ การ์ดที่แคบกว่าก็ยังจบก่อนขอบขวา
                        และ `text-right` ขยับได้เฉพาะ inline content (เวลา) ไม่ขยับ block (การ์ด)
                     ⇒ ทำกล่องเป็น flex column แล้วสั่ง `items-end` ⇒ **ลูกทุกตัว**
                       (เวลา · การ์ด · บับเบิลข้อความ · รูป) ชิดขวาพร้อมกันหมด
                       ไม่ต้องรู้เลยว่าลูกตัวไหนกว้างเท่าไหร่
                     ⚠️ เฉพาะฝั่งบอท · ฝั่งลูกค้าไม่ใส่ ⇒ ยังชิดซ้ายเหมือนเดิมทุกประการ
                     revert: ลบ `flex flex-col` + `items-end` ออกจากบรรทัดนี้ */
                  className={`max-w-[75%] w-fit flex flex-col ${msg.sender_type === 'bot' ? 'items-end text-right' : ''} ${glowIds.has(String(msg._id)) ? 'tc-msg-glow' : ''}`}>
                  <div className="text-[10px] text-slate-400 mb-1 px-1">{formatTime(msg.created_at)}</div>
                  {(() => {
                    // ==== [FIX-20260728-VIDEO-PENDING] START — บล็อกนี้เพิ่มใหม่
                    // เดิมวิดีโอที่ LINE ยัง transcode ไม่เสร็จตอน webhook เข้ามา
                    // จะมี message_type: "video" แต่ internal_content_id: null —
                    // isVideo ด้านล่างต้องมี url ด้วย เลยตกไปเรนเดอร์เป็น text
                    // bubble ว่างเปล่า (ไม่มี placeholder "[video]" จริงๆ เหมือนที่
                    // คอมเมนต์เก่าเข้าใจผิดไว้) ตอนนี้ BE แยกสถานะนี้ชัดเจนเป็น
                    // message_type: "video_pending" แล้ว จึงเช็คแยกต่างหากตรงนี้
                    // ก่อนถึง isVideo — แสดงปุ่มให้แอดมินกดโหลดเองแทน
                    // revert: ลบ if block นี้ทั้งก้อน (isVideo ด้านล่างจะกลับไป
                    // fall-through เป็น text bubble ว่างเปล่าเหมือนเดิม)
                    if (msg.message_type === 'video_pending') {
                      return (
                        <PendingVideoBubble
                          messageId={msg._id}
                          senderType={msg.sender_type}
                          onLoaded={(patch) => handleVideoLoaded(msg._id, patch)}
                        />
                      );
                    }
                    // ==== [FIX-20260728-VIDEO-PENDING] END

                    const internalMediaUrl = msg.internal_content_id?.image_url;
                    const mediaKind = msg.internal_content_id?.media_kind;
                    // Video bubble: play inline. Detected by message_type or the
                    // explicit media_kind (legacy rows have neither → fall through
                    // to the image path, which is correct for all old media).
                    const isVideo = !!internalMediaUrl && (msg.message_type === 'video' || mediaKind === 'video');
                    if (isVideo) {
                      const src = internalMediaUrl!.startsWith('http') ? internalMediaUrl! : `${API_BASE_URL}${internalMediaUrl}`;
                      return (
                        <div className={`p-1 rounded-2xl border flex flex-col ${
                          msg.sender_type === 'customer'
                            ? 'bg-emerald-50/50 border-emerald-100 rounded-tl-sm'
                            : 'bg-blue-50/50 border-blue-100 rounded-tr-sm items-end'
                        }`}>
                          <video
                            src={src}
                            controls
                            preload="metadata"
                            className="rounded-xl w-full max-w-[280px] shadow-sm"
                          />
                        </div>
                      );
                    }

                    const internalImageUrl = !isVideo ? internalMediaUrl : undefined;

                    /* [FIX-20260828-PUSHIMAGE] A pushed image (broadcast/multicast)
                       has NO `internal_content_id`, so it used to fall through to the
                       text bubble and render as a raw link on the console — the image
                       the customer sees in LINE showed here as a URL string.
                       WHY there is nothing to fix on the BE: an image that ARRIVES
                       from LINE has to be fetched with the channel token and re-hosted
                       by us, which is what `internal_content_id` records. An image we
                       SEND was never LINE's — the campaign already holds a public URL,
                       and the row is stored correctly as `message_type: 'image'` with
                       that URL in `content`. Only the console was reading it wrong.
                       WHY THIS CANNOT AFFECT ANY OTHER MESSAGE: the branch demands
                       `message_type === 'image'` AND an absolute http(s) `content`. A
                       text message that merely contains a link keeps `message_type:
                       'text'` and is untouched; a LINE-received image still takes the
                       `internal_content_id` path above, which is checked first.
                       Rendering reuses the SAME bubble below — no second copy of the
                       markup, no new component.
                       IF THE POLICY CHANGES (e.g. push images must be re-hosted too):
                       delete this constant and give the row an `internal_content_id`
                       on the BE instead; the branch below then picks it up unchanged.
                       revert: delete this constant and use `internalImageUrl` in the
                       `if` below, exactly as it read before. */
                    const pushedImageUrl =
                      !internalImageUrl &&
                      msg.message_type === 'image' &&
                      typeof msg.content === 'string' &&
                      /^https?:\/\//i.test(msg.content.trim())
                        ? msg.content.trim()
                        : undefined;

                    const renderableImageUrl = internalImageUrl ?? pushedImageUrl;

                    if (renderableImageUrl) {
                      return (
                        <div className={`p-1 rounded-2xl border flex flex-col ${
                          msg.sender_type === 'customer'
                            ? 'bg-emerald-50/50 border-emerald-100 rounded-tl-sm'
                            : 'bg-blue-50/50 border-blue-100 rounded-tr-sm items-end'
                        }`}>
                          <img
                            src={renderableImageUrl.startsWith('http')
                              ? renderableImageUrl
                              : `${API_BASE_URL}${renderableImageUrl}`}
                            alt="chat message"
                            className="rounded-xl w-full max-w-[280px] shadow-sm hover:opacity-95 transition-opacity cursor-zoom-in"
                            onClick={() => setImageModalUrl(renderableImageUrl.startsWith('http')
                              ? renderableImageUrl
                              : `${API_BASE_URL}${renderableImageUrl}`)}
                          />
                        </div>
                      );
                    }

                    if (msg.content && msg.content.includes('[[[img_')) {
                      const tag = msg.content.replace(/\[\[\[|\]\]\]/g, '').trim();
                      return (
                        <div className={`p-1 rounded-2xl border flex flex-col ${
                          msg.sender_type === 'customer'
                            ? 'bg-emerald-50/50 border-emerald-100 rounded-tl-sm'
                            : 'bg-blue-50/50 border-blue-100 rounded-tr-sm items-end'
                        }`}>
                          <ChatGallery
                            tag={tag}
                            onImageClick={(url) => setImageModalUrl(url)}
                          />
                        </div>
                      );
                    }

                    const contentStr = typeof msg.content === 'string' ? msg.content : '';

                    // ==== [FEAT-20260729-REGCARD] START — preview the register card
                    // 🔒 AUTO track — to_dev_auto branch only
                    //
                    // The bot sends a Flex card with a "ลงทะเบียน" button, but the chat
                    // history only stores the placeholder text, so admins saw
                    // "[ส่งลิงก์ลงทะเบียนสมาชิก]" and had no idea what the customer got.
                    //
                    // The card is hardcoded here on purpose rather than sent from the BE:
                    // its layout never varies, and the only dynamic part is the link —
                    // which is exactly the part admins must NOT have.
                    //
                    // ⚠️ Rendered as a preview with NO working link, deliberately:
                    //    ลิงก์นั้นเป็นของลูกค้าคนนั้นคนเดียว (token ผูก user + หมดอายุ 30 นาที)
                    //    ถ้าแอดมินกดจะเผาลิงก์ทิ้งหรือไปผูกบัญชีทับของลูกค้าได้
                    // revert: delete this block — the row falls back to plain text
                    if (contentStr === '[ส่งลิงก์ลงทะเบียนสมาชิก]') {
                      return <RegisterLinkCard />;
                    }
                    // ==== [FEAT-20260729-REGCARD] END

                    const isFlexMsg = msg.message_type === 'flex' || contentStr.startsWith('[Flex') || contentStr.startsWith('[Flex-Error]');
                    if (isFlexMsg) {
                      return <FlexSlipCard msg={msg} />;
                    }

                    return (
                      // [FIX-20260728-NEWLINE] เดิมไม่มี whitespace-pre-wrap ทำให้ข้อความ
                      // ที่มีการขึ้นบรรทัดใหม่ถูกยุบเหลือบรรทัดเดียวในแดชบอร์ด ทั้งที่ฝั่ง LINE
                      // แสดงถูกต้องอยู่แล้ว (ข้อมูลใน DB ก็มี \n ครบ ไม่ได้หาย)
                      // ใช้ pre-wrap ให้ตรงกับ InlineNoteBubble ด้านบนที่ใช้อยู่แล้ว
                      // revert: ลบ whitespace-pre-wrap ออกจาก className
                      /* [FIX-20260828-LONGWORD] `break-words` was already here and is
                         still not enough on its own: `overflow-wrap: break-word` is
                         ignored while the browser computes this box's MIN-CONTENT
                         width, and the bubble is shrink-to-fit (`inline-block`
                         inside a `w-fit` wrapper), so one unbroken 200-character
                         string — a URL, a token, a base64 blob — grows the bubble
                         past the transcript instead of wrapping inside it.
                         `overflow-wrap: anywhere` IS counted in that calculation,
                         which is the whole difference, and unlike `break-all` (what
                         the line_user_id row uses) it still breaks ordinary prose
                         only at spaces. Kept as an arbitrary value because Tailwind
                         v4's `wrap-anywhere` utility is not available on this
                         version.
                         revert: drop `[overflow-wrap:anywhere]` — long unbroken
                         strings overflow again, ordinary messages are unaffected
                         either way. */
                      <div className={`px-4 py-2.5 rounded-2xl inline-block text-[14px] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] shadow-sm ${
                        msg.sender_type === 'customer'
                          ? 'tc-msg-in rounded-tl-sm'
                          : 'tc-msg-out rounded-tr-sm'
                      }`}>
                        {/* [FEAT-20260821-QUOTEREPLY] the quoted message, when this one quoted
                            another. Renders nothing otherwise — the bubble is unchanged. */}
                        <QuotedReference
                          msg={msg}
                          messages={messages}
                          customer={activeRoom?.user_data}
                          // loaded → jump by our _id (no request if the window already holds it is
                          // still one request: the same around-window the search jump uses);
                          // not loaded → let the BE anchor on LINE's id.
                          onJump={(t) => (t.id ? jumpToMessage(t.id) : jumpToMessage(t.providerMsgId, 'provider'))}
                        />
                        {/* [FEAT-20260908-AITRANSLATE] the two-layer body — see
                            TranslatedBubble.tsx for the picture.
                            🔴 THE SHAPE OF THIS TERNARY IS THE WHOLE OPTIONALITY
                            GUARANTEE. With no translation it renders `{msg.content}`
                            and nothing else: the same text node, in the same div,
                            with the same class string — no wrapper, no extra div,
                            byte-identical to before. That is what the snapshot in
                            `test/chatBubbleCharacterization.dom.test.tsx` pins, and
                            it is why `activeTranslation` returns null for the
                            absent/empty array every row in the database carries.
                            ⚠️ It stays INSIDE this same bubble div on purpose: one
                            bubble, one border, one background. The row's alignment
                            and `max-w-[75%] w-fit` above are untouched, so a
                            translated customer message is still left/emerald and a
                            translated admin message still right/blue.
                            ⚠️ No branch on `sender_type` here or in the component —
                            `content` is always what the customer saw, so it is
                            always the top line, in BOTH directions. */}
                        {(() => {
                          const msgIdStr = String(msg._id);
                          if (translatingMsgIds.has(msgIdStr)) {
                            return <BubbleTranslateLoading />;
                          }
                          const tr = onTranslate ? activeTranslation(msg.translations) : null;
                          return tr
                            ? (
                                <TranslatedBubble
                                  original={contentStr}
                                  translation={tr}
                                  /* [FEAT-20260919-SHOWORIGSRC] the room's column
                                     and the account preference, joined by the one
                                     rule the modal and the popover also use — so
                                     the badge, the settings screen and the bubble
                                     can never tell three different stories. */
                                  showOriginalText={resolveShowOriginalText({
                                    source: (activeRoom as any)?.show_original_text_source,
                                    roomValue: activeRoom?.show_original_text,
                                    allRooms: allRoomsShowOriginal,
                                  })}
                                />
                              )
                            : msg.content;
                        })()}
                      </div>
                    );
                  })()}
                  {/* [FEAT-20260918-PHASE3] Translation error badge displayed below/beside bubble with 30s auto-dismiss */}
                  {msgTranslateErrors.has(String(msg._id)) && (
                    <BubbleTranslateError
                      errorMsg={msgTranslateErrors.get(String(msg._id))}
                      onDismiss={() => dismissMsgTranslateError(String(msg._id))}
                    />
                  )}
                  {/* [FEAT-20260729-ADMINSENDER] sign the bubble underneath, so
                      a thread with several admins reads as a conversation rather
                      than one anonymous voice. Hidden for real bot messages. */}
                  {msg.sender_type === 'bot' && adminSenderName(msg) && (
                    <div className="text-[10px] text-slate-400 mt-1 px-1">
                      {adminSenderName(msg)}
                    </div>
                  )}
                </div>
                {/* [FIX-20260918-NODOTS] the `··` trigger is gone — owner, 18/09:
                    *"เอา .. ออก ให้กดแล้วแสดง reply / แปลเลย"*. It was an extra press
                    between hovering a bubble and the only two things you can do with
                    one, and it hid the actions behind a control that named neither.
                    Reply and แปล now appear on the same reveal the `··` used to.
                    ⚠️ The braces are load-bearing: an unwrapped block comment
                    between JSX siblings is TEXT, and this one rendered into the
                    bubble row until `jsxCommentLeak.value.test.ts` caught it. */}
                {/* [FEAT-20260819-REPLYUI] the chip sits AFTER the bubble, so it lands on
                    its RIGHT — owner's placement. Customer messages only: replying to our
                    own outbound is not a thing. Rendered only while revealed, and only
                    when a page actually passes `onReplyTo`. */}
                {SHOW_BUBBLE_REPLY_BUTTON && onReplyTo && msg.sender_type === 'customer' && replyReveal.isShown(String(msg._id)) && (
                  <BubbleReplyButton
                    onClick={() => {
                      replyReveal.clear();
                      onReplyTo({
                        id: String(msg._id),
                        senderType: msg.sender_type,
                        text: msg.content,
                        messageType: msg.message_type,
                      });
                    }}
                  />
                )}
                {/* [FEAT-20260908-AITRANSLATE] the translate chip, and the language
                    list it opens.
                    🔴 RENDERED AFTER THE REPLY BLOCK ABOVE, NEVER INSIDE OR BEFORE
                    IT. `test/bubbleReplyHidden.value.test.ts` reads the source and
                    inspects the `{ … }` immediately preceding `<BubbleReplyButton`
                    to prove the reply chip is still gated on its own switch and its
                    own conditions; anything inserted in front of that tag rewrites
                    what that test reads.
                    🔴 Its OWN boolean switch too — sharing `SHOW_BUBBLE_REPLY_BUTTON`
                    would break the "read in exactly one place" guarantee that keeps
                    the reply chip revertible in one line.
                    ⚠️ `message_type === 'text'` only — the same restriction the BE
                    enforces. A chip that 400s is worse than no chip.
                    🔴 [FIX-20260909-CUSTOMERSIDEONLY] CUSTOMER SIDE ONLY — the same
                    condition Reply uses. This comment used to say "both sides,
                    unlike Reply: an admin message is translated too", and that was
                    drift: the feature was specified from the first message as
                    "แปลเฉพาะฝั่งลูกค้า", and the owner said so again on 09/09
                    seeing a chip on a bot bubble.
                    WHY it is wrong beyond the spec: the right-hand side is what the
                    ADMIN wrote (or the bot wrote for them) — already in the admin's
                    own language. A chip there offers to translate Thai into Thai,
                    and every press is a billed call against a lifetime budget.
                    🔴 [FIX-20260909-NOREPEAT] AND NOT ONCE IT IS TRANSLATED. Owner,
                    09/09: "bubble ที่มีคำแปลแล้วห้ามแปลซ้ำอีก". The bubble now offers
                    Thai only, so a second press could ONLY ask for the language it
                    already holds — the BE would answer `cached: true` and charge
                    nothing, but a control that cannot change anything is a control
                    that should not be there. `activeTranslation` is the same reader
                    the two-layer body uses, so the chip disappears exactly when the
                    translation appears. */}
                {SHOW_BUBBLE_TRANSLATE_BUTTON && onTranslate && msg.sender_type === 'customer' && msg.message_type === 'text' && !activeTranslation(msg.translations) && translateReveal.isShown(String(msg._id)) && (
                  <BubbleTranslateButton onClick={() => {
                    setLangPickerFor(String(msg._id));
                  }} />
                )}
                {/* Picking a language IS the confirm — owner, 09/09: "กดแล้ว confirm
                    แล้วแปลให้เลย". No second apply button on the read side.
                    ⚠️ The picker mounts only here, i.e. only after a press, which is
                    what keeps a room open at zero requests.
                    🔴 [FIX-20260909-PICKERMODAL] It opens OVER the room now, not
                    beside the bubble. Seven languages plus a cancel row is tall
                    enough to shove the conversation sideways, and the admin lost
                    their place in the thread to make room for a menu. */}
                {onTranslate && langPickerFor === String(msg._id) && (
                  <LanguagePicker
                    /* [FIX-20260909-BUBBLETHAIONLY] Thai and nothing else, owner
                       09/09. Reading a customer's message means reading it in the
                       admin's own language; the other six were a menu of answers
                       to a question nobody asked, and each one is a billed call.
                       The COMPOSER still offers all seven — that direction is
                       Thai -> the customer's language, which is the real choice. */
                    filter={(c) => c === 'th'}
                    onPick={async (lang) => {
                      try {
                        setLangPickerFor(null);
                        translateReveal.clear();
                        await executeTranslate({ id: String(msg._id), text: typeof msg.content === 'string' ? msg.content : '', lang });
                        glowMessage(String(msg._id));
                      } catch (err) {
                        setLangPickerFor(null);
                      }
                    }}
                    onClose={() => setLangPickerFor(null)}
                  />
                )}
                {/* [FEAT-20260729-ADMINSENDER] an admin reply is not the bot.
                    The BE now records who sent it (sender_id + metadata.sender_name);
                    when that is present the avatar shows the sender's initial in
                    the send-button blue, and the bubble is signed underneath.
                    Falls back to the purple Bot badge when nothing was recorded —
                    genuine bot messages, and every message sent before this shipped.
                    revert: restore the plain purple "Bot" div. */}
                {/* [FIX-20260831-STICKERSENDER] ย้าย markup ไปเป็น `botAvatar` ตัวเดียว
                    ข้างบน (แถวสติกเกอร์ใช้ตัวเดียวกัน) — พฤติกรรมตรงนี้เท่าเดิมทุกไบต์ */}
                {msg.sender_type === 'bot' && botAvatar}
              </div>
              );
            })
          )}
          {/* ==== [FEAT-20260801-CHATSEARCH] ปุ่มโหลด "ใหม่กว่า" — โผล่เฉพาะโหมดกระโดด
               เปิดห้องปกติจะไม่มีปุ่มนี้เลย เพราะอยู่ล่างสุดอยู่แล้ว
               หน้าตาเดียวกับปุ่มโหลดเก่ากว่าด้านบน (สมมาตร เข้าใจทันที)
               ⚠️ ตั้งใจไม่ทำ auto-load ตอน scroll — เลื่อนเร็ว ๆ จะยิงรัว ขัดกับที่สั่งว่า
                  ห้ามโหลดหนักจนพัง · ปุ่มคุมจังหวะได้แน่นอนกว่า */}
          {anchorMode && hasNewer && (
            <button
              type="button"
              onClick={() => anchorId && jumpToMessage(anchorId)}
              disabled={loadingMessages}
              className="tc-load-older mx-auto shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-1.5 rounded-full transition-all"
              title={t('ticketui.room.newer_exist', 'ยังมีข้อความใหม่กว่านี้')}
            >
              {t('ticketui.room.newer_exist_back', 'ยังมีข้อความใหม่กว่านี้ · กดเพื่อกลับไปล่าสุด')}
            </button>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ==== [FEAT-20260801-CHATSEARCH] ปุ่มกลับไปข้อความล่าสุด
             สำคัญที่สุดของโหมดกระโดด: กระโดดไปลึก 500 ข้อความแล้วต้องกลับบ้านได้ใน 1 คลิก
             (1 request · โหลดหน้าแรกใหม่ตามเส้นเดิม ไม่ใช่ไล่ scroll กลับ)
             ลอยมุมขวาล่างของสตรีม โผล่เฉพาะตอนอยู่ในโหมดกระโดด
             revert: ลบบล็อกนี้ + ปุ่มโหลดใหม่กว่าด้านบน */}
        {anchorMode && (
          <button
            type="button"
            onClick={backToLatest}
            className="absolute bottom-4 right-4 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold bg-blue-500 text-white shadow-lg hover:bg-blue-600 transition-all"
            title={t('ticketui.room.back_to_latest', 'กลับไปข้อความล่าสุด')}
          >
            <ArrowDownToLine size={14} /> {t('ticketui.room.go_latest', 'ไปข้อความล่าสุด')}
          </button>
        )}
      </div>

      {/* Right User Detail Box */}
      {showDetailBox && showUserDetail && (
        <aside className="w-full max-w-[280px] sm:max-w-[320px] xl:max-w-[340px] bg-white border-l border-slate-200 flex flex-col h-full overflow-y-auto custom-scrollbar shrink-0 z-10 animate-in fade-in duration-150">
          <div className="p-6 border-b border-slate-200 text-center">
            <div className="relative inline-block">
              <img
                src={activeRoom.user_data?.picture_url || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y'}
                alt="profile"
                className="w-20 h-20 rounded-full object-cover mx-auto shadow-md border-2 border-slate-100"
              />
              <button
                onClick={handleSyncProfile}
                disabled={syncingProfile}
                className="absolute bottom-0 right-0 p-1.5 bg-white border border-slate-200 rounded-full shadow-sm hover:bg-slate-50 transition-all disabled:opacity-50"
                title={t('ticketui.room.sync_profile', 'ซิงค์ข้อมูลโปรไฟล์')}
              >
                <RefreshCw size={14} className={`${syncingProfile ? 'animate-spin' : ''} text-primary-500`} />
              </button>
            </div>
            <div className="mt-3">
              <div className="font-bold text-slate-800 text-base">
                {/* [FIX-20260814-CUSTOMERNAME] was `display_name || 'Unknown'` —
                    which printed the placeholder verbatim when it was stored. */}
                {customerName(activeRoom.user_data)}
              </div>
              {activeRoom.user_data?.nickname && (
                <div className="text-slate-500 text-xs mt-0.5">Nickname: {activeRoom.user_data.nickname}</div>
              )}
            </div>
          </div>

          <div className="p-5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">DETAILS</div>
            <div className="space-y-3 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">LINE USER ID</span>
                <span className="font-mono text-slate-700 break-all">{activeRoom.line_user_id}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">LAST SYNCED</span>
                <span className="text-slate-700 font-medium">
                  {activeRoom.user_data?.last_synced_at ? new Date(activeRoom.user_data.last_synced_at).toLocaleString() : 'Never'}
                </span>
              </div>
              <div className="flex flex-col gap-1 items-start pt-1">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">ASSIST</span>
                <button
                  type="button"
                  onClick={() => canToggleAssist && setAssistConfirmOpen(true)}
                  disabled={!canToggleAssist}
                  className={`px-2.5 py-1 rounded text-xs font-bold transition-all shadow-sm ${
                    activeRoom.assist_status
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200'
                      : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-200'
                  } ${!canToggleAssist ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  {activeRoom.assist_status ? 'True' : 'False'}
                </button>
              </div>
            </div>

            {/* NOTE SECTION */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <FileText size={12} className="text-slate-400" />
                  <span>{t('ticketui.room.note_heading', 'NOTE / หมายเหตุ')}</span>
                </span>
                {!isEditingNote && (
                  <button
                    type="button"
                    onClick={() => {
                      setNoteText(activeRoom.note || '');
                      setIsEditingNote(true);
                    }}
                    className="px-2 py-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors text-[11px] font-bold flex items-center gap-1 cursor-pointer border border-emerald-200"
                    title={t('ticketui.room.edit_note', 'แก้ไขหมายเหตุ')}
                  >
                    <Pencil size={12} />
                    <span>{t('common.edit', 'แก้ไข')}</span>
                  </button>
                )}
              </div>

              {!isEditingNote ? (
                <div
                  onClick={() => {
                    setNoteText(activeRoom.note || '');
                    setIsEditingNote(true);
                  }}
                  className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-slate-200/80 text-xs text-slate-700 min-h-[90px] whitespace-pre-wrap font-sans cursor-pointer transition-colors"
                >
                  {activeRoom.note ? (
                    activeRoom.note
                  ) : (
                    <span className="text-slate-400 italic text-[11px]">{t('ticketui.room.note_empty_hint', '-(กดเพื่อบันทึกหมายเหตุเพิ่มเติม)-')}</span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={6}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder={t('ticketui.room.note_placeholder', 'พิมพ์หมายเหตุเพิ่มเติมสำหรับผู้ใช้คนนี้...')}
                    className="w-full p-3 bg-white border border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 focus:outline-none rounded-xl text-xs text-slate-800 font-sans custom-scrollbar resize-y min-h-[115px] shadow-inner leading-relaxed"
                    autoFocus
                  />
                  
                  {/* Large Prominent Action Buttons */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditingNote(false)}
                      disabled={isSavingNote}
                      className="flex-1 py-2 px-3 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 active:scale-95 rounded-xl transition-all text-center cursor-pointer"
                    >
                      {t('common.cancel', 'ยกเลิก')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setNoteConfirmOpen(true)}
                      disabled={isSavingNote}
                      className="flex-1 py-2 px-3 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl shadow-md hover:shadow-lg flex items-center justify-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {isSavingNote ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      <span>{t('ticketui.room.save_note', 'บันทึกหมายเหตุ')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}

      {/* Image Preview Modal */}
      {imageModalUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200">
          <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-sm" onClick={() => setImageModalUrl(null)} />
          <div className="relative max-w-5xl w-full max-h-full flex flex-col items-center z-10">
            <button
              onClick={() => setImageModalUrl(null)}
              className="absolute -top-12 right-0 md:-right-12 p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all group"
              title={t('ticketui.room.close_preview', 'ปิดพรีวิว')}
            >
              <X size={32} className="group-hover:scale-110 transition-transform" />
            </button>
            <div className="w-full h-full rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/20">
              <img
                src={imageModalUrl}
                alt="preview"
                className="w-full h-auto max-h-[85vh] object-contain bg-black/40"
              />
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={assistConfirmOpen}
        onClose={() => setAssistConfirmOpen(false)}
        onConfirm={handleConfirmAssistToggle}
        title={t('ticketui.room.assist_confirm_title', 'ยืนยันเปลี่ยนสถานะ Assist')}
        message={withVars(t('ticketui.room.assist_confirm_msg', 'ยืนยันเปลี่ยนสถานะเป็น Assist: {state} สำหรับผู้ใช้รายนี้?'), { state: activeRoom.assist_status ? 'False (OFF)' : 'True (ON)' })}
        type={activeRoom.assist_status ? 'warning' : 'info'}
      />

      <ConfirmModal
        isOpen={noteConfirmOpen}
        onClose={() => setNoteConfirmOpen(false)}
        onConfirm={handleSaveNote}
        title={t('ticketui.room.note_confirm_title', 'ยืนยันบันทึกหมายเหตุ')}
        message={t('ticketui.room.note_confirm_msg', 'คุณต้องการบันทึกหมายเหตุสำหรับผู้ใช้รายนี้ลงในระบบใช่หรือไม่?')}
        type="info"
      />
      {/* [FEAT-20260815-LINEQUOTA] renders null while closed and only calls LINE
          once opened — see components/hook/quota/useHookQuota. */}
      <QuotaModal
        isOpen={quotaOpen}
        onClose={() => setQuotaOpen(false)}
        hookId={activeRoom?.hook_id || hookId || null}
        oaName={oaName}
      />
    </div>
  );
};
