/* [FEAT-20260814-CONTACTPAGE] Contact detail header — collapsible "info" card
 * ===========================================================================
 * Owner, 14/08 (final spec after three refinements):
 *   1. "รวม label แสดงให้จบในบรรทัดเดียว"  — all labels on ONE line.
 *   2. "ทำเป็น card 'info' default พับไว้ กดเปิดดูเอง" — collapsed by default.
 *   3. "ตอนพับต้องแสดงชื่อ+label ครบ ยกเว้น refresh button กับภาพ avatar
 *      ต้องกดเปิดก่อน" — collapsed shows name + phone + LINE id + copy in full;
 *      ONLY the avatar and the sync-LINE button require expanding first.
 *
 *   collapsed:  [▸] judy · 0955550010 · U02e9d…720 [copy]
 *   expanded :  [▾] (avatar) judy · 0955550010 · U02e9d…720 [copy] [⟳ sync LINE]
 *
 * The open/close state is NEW, lives here, and resets per customer via the
 * `key={selected._id}` the parent passes — no parent state was moved (§6.4
 * stays out of scope). Copy stays the parent's callback so the existing toast
 * ([FEAT-20260802-CONTACTCOPY]) keeps working unchanged.
 *
 * revert: delete this file + restore the old two-line header block in
 *         pages/chat/Contact.tsx from git history (same marker).
 */
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Copy, Info } from 'lucide-react';
import { ChatRoom } from '../../services/chat';
import { RefreshProfileButton } from './RefreshProfileButton';
// [FIX-20260814-CUSTOMERNAME] shared name resolver (see components/common)
import { customerName } from '../common';
import type { SyncedProfileData } from '../../services/chat';
import { useI18n, translateNow } from '../../i18n';

const AVATAR_FALLBACK = 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';

const phoneOf = (r: ChatRoom): string => (r.user_data as any)?.phone_number || '';
const lineIdOf = (r: ChatRoom): string =>
  String((r.user_data as any)?.line_user_id || r.line_user_id || '');

/* [FIX-20260814-CUSTOMERNAME] เดิมก็อปสูตรของหน้า Contact มาไว้ที่นี่อีกชุด
   ตอนนี้ทั้งคู่เรียก helper กลางตัวเดียวกัน (ลำดับเดิมเป๊ะผ่าน `preferFullName`)
   ⇒ แก้กติกาชื่อทีเดียวติดทุกหน้า ไม่ต้องไล่จำว่ามีสำเนาอยู่กี่ที่ */
const displayNameOf = (r: ChatRoom): string =>
  customerName({ ...(r.user_data as any), line_user_id: lineIdOf(r) }, translateNow('pageui.contact.unknown_name', '(ไม่ทราบชื่อ)'), {
    preferFullName: true,
  });

/* [FEAT-20260823-FOLLOWSTAMP] The two follow-up stamps, shown RAW next to a Thai
 * reading of the same instant.
 * ===========================================================================
 * Owner, 23/08: "เอาค่าดิบออกมาแสดงที่ front end แล้ว วงเล็บที่แปลงเวลาไทย ตรง header"
 * — raw value first, Bangkok time in brackets, `n/a` when the stamp is absent.
 *
 * WHY RAW AND NOT JUST THE PRETTY DATE — the stamps are written by the notice
 * runtime, and a stamp that a human hand wrote instead shows up as a date that
 * cannot exist. The dev database holds exactly that today: `notice_withdraw_at`
 * sits on 29 Sep while `notice_deposit_at` sits on 22 Aug, and production code
 * cannot produce a future stamp — it writes `new Date()` at send time
 * (omnidesk-api webhook.service.ts:5320 → notice-guard.helper.ts:253). Formatting
 * alone would have hidden that; the raw instant makes it obvious.
 * ค่าดิบทำให้ของแปลกโผล่ ไม่ถูกกลืนไปกับการจัดรูปแบบ
 *
 * ⚠️ THE STORED VALUE IS UTC, and that is correct — the DB must never hold
 * Bangkok wall-clock. Verified on real rows: `2026-08-22T16:30:00.000Z` reads
 * 23:30 in Bangkok, a 7-hour gap. The bracket is a rendering, never a second
 * source of truth. DB เก็บ UTC · วงเล็บคือการแปลงตอนแสดงเท่านั้น
 *
 * WHERE THE VALUE COMES FROM — no back-end change was needed. `/api/chat/contacts`
 * $lookups the whole member document with no $project (omnidesk-api
 * chat.service.ts:1423-1430), so `user_data.config.follow_up.line.*` already
 * rides along. Confirmed against a real row before this was written.
 *
 * revert: delete these two helpers and the <span> that renders them.
 */
const FOLLOW_STAMP_KEYS = {
  deposit: 'notice_deposit_at',
  withdraw: 'notice_withdraw_at',
} as const;

/** The stamp exactly as stored, or null when the customer has none. */
export const followStampRaw = (
  room: ChatRoom,
  side: keyof typeof FOLLOW_STAMP_KEYS,
): string | null => {
  const line = (room.user_data as any)?.config?.follow_up?.line;
  const v = line?.[FOLLOW_STAMP_KEYS[side]];
  if (v === undefined || v === null || v === '') return null;
  /* The API serialises Date to an ISO string; a Date survives a direct read.
     Both are accepted so this cannot depend on which path fed it. */
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** `2026-08-22T16:30:00.000Z (22/08/2026 23:30)` — or `n/a`. */
export const followStampLabel = (
  room: ChatRoom,
  side: keyof typeof FOLLOW_STAMP_KEYS,
): string => {
  const raw = followStampRaw(room, side);
  if (!raw) return 'n/a';
  const thai = new Date(raw).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${raw} (${thai})`;
};

interface Props {
  room: ChatRoom;
  onCopy: (lineUserId: string) => void;
  onSynced: (data: SyncedProfileData) => void;
}

export const ContactHeaderInfo: React.FC<Props> = ({ room, onCopy, onSynced }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false); // default พับ — เจ้าของสั่ง
  const lineId = lineIdOf(room);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="min-w-0 flex-1">
      {/* one line always: chevron → (avatar when open) → name · labels · copy → (sync when open) */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 flex items-center gap-1 p-1 -ml-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title={open ? t('pageui.contact.info_fold', 'พับ info') : t('pageui.contact.info_open', 'เปิด info')}
          aria-expanded={open}
        >
          {/* [FIX-20260814-INFOICON] Owner, 14/08: use the info icon instead of
              the word. The chevron stays — it is the only thing that says whether
              the card is open, and dropping it would leave a button that gives no
              feedback. ไอคอนแทนคำว่า info · ลูกศรบอกสถานะเปิด/พับไว้เหมือนเดิม */}
          <Info size={15} />
          <Chevron size={12} />
        </button>

        {open && (
          <img
            src={(room.user_data as any)?.picture_url || AVATAR_FALLBACK}
            onError={(e) => { (e.target as HTMLImageElement).src = AVATAR_FALLBACK; }}
            className="w-8 h-8 rounded-full object-cover shrink-0 bg-gray-100"
            alt=""
          />
        )}

        <p className="text-sm font-bold text-gray-800 truncate shrink-0 max-w-[40%]">
          {displayNameOf(room)}
        </p>
        <p className="text-[11px] text-gray-400 truncate min-w-0">
          {phoneOf(room) || t('pageui.contact.not_registered', 'ยังไม่ลงทะเบียน')} · {lineId}
        </p>
        {lineId && (
          <button
            type="button"
            onClick={() => onCopy(lineId)}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title={t('pageui.contact.copy_line_id', 'คัดลอก LINE user id')}
          ><Copy size={12} /></button>
        )}

        {/* [FEAT-20260823-FOLLOWSTAMP] right after the copy button, as asked.
            `whitespace-nowrap` + `overflow-x-auto` so a long raw instant scrolls
            inside its own box instead of pushing the copy button off the row. */}
        <span className="shrink min-w-0 overflow-x-auto whitespace-nowrap text-[10px] font-mono text-gray-400">
          {t('pageui.contact.stamp_deposit', 'ติดตามฝาก')} {followStampLabel(room, 'deposit')}
          <span className="mx-1 text-gray-300">·</span>
          {t('pageui.contact.stamp_withdraw', 'ติดตามถอน')} {followStampLabel(room, 'withdraw')}
        </span>

        {open && lineId && (
          /* [FEAT-20260814-PROFILESYNC] เปิด info ก่อนถึงเห็นปุ่ม — เจ้าของสั่ง */
          <RefreshProfileButton hookId={room.hook_id} lineUserId={lineId} onSynced={onSynced} />
        )}
      </div>
    </div>
  );
};
