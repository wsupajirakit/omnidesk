/**
 * [FEAT-20260824-FOLLOWUP] การ์ด "การติดตาม" — แท็บ "ดำเนินการ" ของ panel ขวา
 * ===========================================================================
 * WHAT: การ์ดพับได้ใบใหม่ แสดงว่าระบบเคยส่งการ์ดติดตาม (ฝาก/ถอน/สลิป/ชวนลงทะเบียน)
 *       ให้ลูกค้ารายนี้ครั้งล่าสุดเมื่อไหร่ · **พับไว้เป็นค่าเริ่มต้น**
 *
 * WHY: เจ้าของสั่ง 24/08 — 'เพิ่ม card ใหม่ แท็บพับไว้ ใน "ดำเนินการ" ของ member
 *      panel ขวา ชื่อ "การติดตาม"'
 *
 * ⚠️ ทำไมใบนี้ "พับ" ทั้งที่พี่น้อง (โน๊ตภายใน/ป้ายกำกับ) "กาง":
 *      [FIX-20260801-CARDEXPAND] เจ้าของเคยสั่งให้การ์ดเดิมกางเป็นค่าเริ่มต้น
 *      แต่คำสั่งรอบนี้ระบุ "แท็บพับไว้" มาเฉพาะใบนี้ ⇒ จงใจต่างจากพี่น้อง
 *      ไม่ใช่ความพลาด · ห้ามไป "แก้ให้เหมือนกัน" โดยไม่ถามเจ้าของก่อน
 *
 * IDIOM: หัวการ์ดคลิกได้ทั้งแถบ + ChevronDown หมุน 180° ตอนกาง — ลอกจาก
 *      CustomerNotes/CustomerTags ใน ../CustomerCards.tsx ([FIX-20260731-CARDHEADER])
 *      ไม่ได้คิดท่าใหม่ · ต่างจากพี่น้องแค่ค่าเริ่มต้นของ `open` กับสีหัวการ์ด
 *
 * ⚠️ ชื่อการ์ดเป็นข้อความไทยตรง ๆ ไม่ผ่าน t() — ตรงกับพี่น้องทั้งสองใบ
 *      ("โน๊ตภายใน" / "ป้ายกำกับลูกค้า" ก็ hardcode เหมือนกัน) ยังไม่มี i18n key
 *      สำหรับหัวการ์ดในกลุ่มนี้ · จะทำ i18n ต้องทำยกกลุ่มพร้อมกัน ไม่ใช่ใบเดียว
 *
 * ข้อมูล: มากับ room อยู่แล้ว ไม่ยิง API เพิ่ม ไม่มี service method ใหม่
 *      (รายละเอียดที่ ./followStamps.ts)
 *
 * revert: ลบโฟลเดอร์ components/member/follow-up/ ทั้งอัน + ลบบล็อก
 *         [FEAT-20260824-FOLLOWUP] (import + <FollowUpCard/>) ใน ../CustomerCards.tsx
 *         + ลบ test/followUpCard.dom.test.tsx
 */
import React, { useState } from 'react';
import { ChevronDown, History, Eye, Clock } from 'lucide-react';
import type { ChatRoom } from '../../../services/chat';
import { FOLLOW_ROWS, followStampThai, followStampCount, NO_STAMP, alertRowsFor, columnPath } from './followStamps';
/* [FEAT-20260829-MANUALFOLLOWSTAMP] press an `n/a` follow-up row to record the
   time. revert: delete these three imports, the block marked with the same tag
   below, and `services/chat/followStampService.ts`. */
import { followStampService, stampKindForRow, type FollowStampKind } from '../../../services/chat/followStampService';
import { ConfirmModal } from '../../modals/ConfirmModal';
import { useI18n } from '../../../i18n';

export const FollowUpCard: React.FC<{ room: ChatRoom | null }> = ({ room }) => {
  /* [FEAT-20260824-FOLLOWUP] พับไว้ — เจ้าของสั่งมาเฉพาะใบนี้ (ดูหมายเหตุหัวไฟล์)
     revert: เปลี่ยนเป็น useState(true) ให้เหมือนการ์ดพี่น้อง */
  const [open, setOpen] = useState(false);
  /* [FEAT-20260825-ABANDONSTAT] แถวเตือนนับรวมในหัวการ์ดด้วย — แอดมินต้องเห็นว่า
     "มีของ" ตั้งแต่ยังพับอยู่ ไม่ต้องกางก่อนถึงจะรู้ */
  const alerts = alertRowsFor(room);
  const count = followStampCount(room) + alerts.length;

  /* [UI-20260825-COLPEEK] ปุ่มรูปตา — กดแล้วโชว์ชื่อคอลัมน์จริงใต้ทุกป้าย
     เจ้าของขอไว้ *"เผื่องง"*: ป้ายเป็นภาษาไทย แต่เวลาไปตั้งเงื่อนไข broadcast
     หรือคิวรี่ฐานต้องใช้ชื่อคอลัมน์ ⇒ ให้ดูได้จากที่เดียวกันเลย ไม่ต้องเดา
     ⚠️ ปิดไว้เป็นค่าเริ่มต้น — แอดมินทั่วไปไม่ต้องเห็น path ยาว ๆ ทุกครั้งที่เปิดการ์ด
     revert: ลบ state นี้ + ปุ่มในหัวการ์ด + <ColName/> ทั้งสองจุด */
  const [showCols, setShowCols] = useState(false);

  /* ═══ [FEAT-20260829-MANUALFOLLOWSTAMP] ═══════════════════════════════════
     Owner 29/08: while a follow-up row reads `n/a` it is pressable, and pressing
     it records the follow-up time for this member. Deposit and withdraw are
     pressed separately and each press is confirmed.

     🔴 ONLY the two rows named in `stampKindForRow` are pressable. `FOLLOW_ROWS`
        and `ALERT_ROWS` can grow — `notice_payment_at` and `request_reg_at` are
        one uncommented line away — and those mean different things and have
        their own writers. The gate is the row → kind map, not the loop.
     🔴 ONLY while empty. A row that already carries a time is plain text again;
        the back end refuses an overwrite as well, so a stale panel cannot move a
        record that other screens report on.
     ⚠️ The value is written OPTIMISTICALLY into local state after the server
        confirms, so the row updates without waiting for the panel to refetch —
        the same in-place idiom `IgnoreAbandonShield` uses. On failure nothing is
        written and the row stays `n/a`.
     ═══════════════════════════════════════════════════════════════════════ */
  const { t } = useI18n();
  const memberId =
    (room?.user_data as { _id?: string } | null | undefined)?._id ?? null;
  /** rowKey → the ISO we just wrote, so the row can show it immediately. */
  const [justStamped, setJustStamped] = useState<Record<string, string>>({});
  const [askRow, setAskRow] = useState<{ key: string; kind: FollowStampKind } | null>(null);
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [stampError, setStampError] = useState<string | null>(null);

  const stampLabelFor = (kind: FollowStampKind): string =>
    kind === 'deposit'
      ? t('ticket.follow_stamp_deposit')
      : t('ticket.follow_stamp_withdraw');

  const confirmStamp = async () => {
    if (!askRow || !memberId) return;
    const { key, kind } = askRow;
    setAskRow(null);
    setSavingRow(key);
    setStampError(null);
    try {
      const res = await followStampService.setFollowStamp(memberId, kind);
      const at = res?.data?.at;
      // only claim it when the server said what it wrote
      if (at) setJustStamped((prev) => ({ ...prev, [key]: at }));
    } catch (err) {
      setStampError(
        (err as Error)?.message || t('ticket.follow_stamp_failed'),
      );
    } finally {
      setSavingRow(null);
    }
  };
  const ColName: React.FC<{ k: string }> = ({ k }) =>
    showCols ? (
      <span className="block font-mono text-[10px] text-gray-400 break-all">
        {columnPath(k as never)}
      </span>
    ) : null;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm flex flex-col">
      {/* หัวการ์ด — คลิกได้ทั้งแถบเหมือนการ์ดพี่น้อง ([FIX-20260731-CARDHEADER])
          ใช้ <button> เต็มแถบเพื่อให้ aria-expanded บอกสถานะพับ/กางได้จริง
          (ผู้ใช้คีย์บอร์ด/สกรีนรีดเดอร์ต้องรู้ว่าเนื้อในถูกซ่อนอยู่) */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full p-3 border-b border-gray-100 flex justify-between items-center bg-sky-50/50 rounded-t-lg cursor-pointer select-none bg-transparent text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-gray-700 min-w-0">
          <History size={16} className="text-sky-600 shrink-0" /> {t('ticketui.member.follow_title', 'การติดตาม')}
          <ChevronDown size={15} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
        {/* ตัวนับใบที่ลูกค้าถืออยู่ — ป้ายเฉย ๆ เหมือน "N โน๊ต" ของการ์ดโน๊ต */}
        <span className="flex items-center gap-1.5 shrink-0">
          {/* [UI-20260825-COLPEEK] ⚠️ ต้อง stopPropagation — ปุ่มนี้ซ้อนอยู่ในแถบ
              หัวการ์ดซึ่งทั้งแถบเป็นปุ่มพับ/กาง ถ้าไม่หยุด event กดดูชื่อคอลัมน์
              ทีเดียวจะพับการ์ดปิดไปด้วย แล้วดูอะไรไม่ทันเลย */}
          <span
            role="button"
            tabIndex={0}
            aria-pressed={showCols}
            aria-label={t('ticketui.member.show_columns', 'แสดงชื่อคอลัมน์ในฐานข้อมูล')}
            title={t('ticketui.member.show_columns', 'แสดงชื่อคอลัมน์ในฐานข้อมูล')}
            onClick={(e) => { e.stopPropagation(); setShowCols((v) => !v); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); e.stopPropagation(); setShowCols((v) => !v);
              }
            }}
            className={`cursor-pointer rounded p-1 transition-colors ${showCols ? 'text-sky-600 bg-sky-100' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <Eye size={14} />
          </span>
          <span className="text-[11px] font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {count} {t('ticketui.member.items_unit', 'รายการ')}
          </span>
        </span>
      </button>

      {open && (
        <div className="p-3 space-y-1.5">
          {FOLLOW_ROWS.map((r) => {
            /* [FEAT-20260829-MANUALFOLLOWSTAMP] a time written in this session
               wins over the room prop, which is only refreshed on a refetch. */
            const fresh = justStamped[r.key];
            const value = fresh
              ? followStampThai(
                  { user_data: { config: { follow_up: { line: { [r.key]: fresh } } } } } as never,
                  r.key,
                )
              : followStampThai(room, r.key);
            const none = value === NO_STAMP;
            const kind = stampKindForRow(r.key);
            /* Pressable only while empty, only for the two allowed rows, and
               only when we know which member to write to. */
            const canStamp = none && kind !== null && Boolean(memberId);
            const saving = savingRow === r.key;
            return (
              <div key={r.key} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-gray-500 min-w-0">
                  {t(`ticketui.member.follow.${r.key}`, r.label)}
                  <ColName k={r.key} />
                </span>
                {/* เวลาแบบกรุงเทพ (UTC+7) — ยาวแล้วเลื่อนในกล่องตัวเอง
                    ไม่ดันป้ายซ้ายหลุดแถว */}
                {canStamp ? (
                  <button
                    type="button"
                    data-testid={`follow-stamp-${r.key}`}
                    disabled={saving}
                    title={t('ticket.follow_stamp_hint')}
                    aria-label={`${stampLabelFor(kind)} — ${t('ticket.follow_stamp_hint')}`}
                    onClick={() => setAskRow({ key: r.key, kind })}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-sky-600 transition-colors hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Clock size={11} className="shrink-0" />
                    {value}
                  </button>
                ) : (
                  <span
                    className={`font-mono overflow-x-auto whitespace-nowrap min-w-0 ${none ? 'text-gray-300 italic' : 'text-gray-600'}`}
                  >
                    {value}
                  </span>
                )}
              </div>
            );
          })}
          {stampError && (
            <p className="text-[11px] font-medium text-red-600 break-words" role="alert">
              {stampError}
            </p>
          )}
          {/* [FEAT-20260825-ABANDONSTAT] แถวเตือน — วางท้ายสุดและเน้นสีส้ม
              เพราะเป็น "สิ่งที่ยังค้างอยู่" ไม่ใช่ประวัติเหมือนสองแถวบน
              [UI-20260825-REGROWS] วนจาก alertRowsFor ⇒ เพิ่มใบใหม่ = เติมใน
              ALERT_ROWS ที่เดียว ไม่ต้องแตะ jsx และลืมใส่เงื่อนไขไม่ได้
              revert: ลบบล็อกนี้ + alerts + import สองชื่อ */}
          {alerts.map((r) => (
            <div
              key={r.key}
              className="flex items-start justify-between gap-2 text-[11px] pt-1 border-t border-amber-100"
            >
              <span className="text-amber-700 font-medium min-w-0">
                {t(`ticketui.member.follow.${r.key}`, r.label)}
                <ColName k={r.key} />
              </span>
              <span className="font-mono overflow-x-auto whitespace-nowrap min-w-0 text-amber-800">
                {followStampThai(room, r.key)}
              </span>
            </div>
          ))}
          {/* ลูกค้าที่ยังไม่เคยถูกติดตามเลย — บอกให้ชัด ไม่ปล่อยให้เห็น n/a สี่แถวแล้วงง */}
          {count === 0 && (
            <p className="text-[11px] text-gray-400 italic text-center pt-1">{t('ticketui.member.never_followed', 'ยังไม่เคยถูกติดตาม')}</p>
          )}
        </div>
      )}
      {/* [FEAT-20260829-MANUALFOLLOWSTAMP] one confirm per press — the owner asked
          for it, and the write cannot be undone from this screen. */}
      {askRow && (
        <ConfirmModal
          isOpen
          type="warning"
          onClose={() => setAskRow(null)}
          onConfirm={() => void confirmStamp()}
          title={t('ticket.follow_stamp_confirm_title')}
          confirmLabel={t('ticket.follow_stamp_confirm_ok')}
          message={t('ticket.follow_stamp_confirm_message').replace(
            '{label}',
            stampLabelFor(askRow.kind),
          )}
        />
      )}
    </div>
  );
};
