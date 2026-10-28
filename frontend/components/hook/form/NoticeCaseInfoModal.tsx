/**
 * [FEAT-20260824-NOTICECASEINFO] The A–F case reference — one modal, the whole
 * notice runtime explained where the operator configures it.
 *
 * Owner, 24/08: "label บอกตรง input นั้น ๆ ว่ามันคือเคสไหน ส่วน info modal ทำสวย ๆ
 * ทั้ง label + เงื่อนไข + db column name จริง".
 *
 * CASE_OF_CARD is the FE's copy of the truth that lives in the BE case files
 * (omnidesk-api notice-runtime/cases/case-*.ts — each declares its own cardField).
 * A drift test reads those files and fails the moment the two disagree, so this
 * copy cannot rot silently. Thai copy is inline by the same precedent as the
 * page-level option labels (Contact.tsx followOpts): the content carries real
 * column names that must never be "translated".
 *
 * revert: delete this file + the chip/import in HookNoticeTab (same tag).
 */
import React from 'react';
import { Info, X } from 'lucide-react';

import { useI18n } from '../../../i18n';

/** card column → its runtime case letter. MIRROR of the BE case files. */
export const CASE_OF_CARD: Readonly<Record<string, 'A' | 'B' | 'C' | 'D' | 'E' | 'F'>> = {
  notice_deposit_offtime_flex_id: 'A',
  notice_deposit_flex_id: 'B',
  notice_withdraw_offtime_flex_id: 'C',
  notice_withdraw_flex_id: 'D',
  notice_all_offtime_flex_id: 'E',
  notice_all_disable_flex_id: 'F',
};

interface CaseRow {
  id: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  name: string;
  when: string[];
  card: string;
  stamp: string;
  tone: string;
}

/** เงื่อนไขตามโค้ดจริง (cases/case-*.ts) — ลำดับตัดสิน A → C → B → D → E → F */
const CASES: readonly CaseRow[] = [
  {
    id: 'A', name: 'ฝาก · นอกเวลา', tone: 'bg-sky-500',
    when: ['ข้อความ (text)', 'เตือนระบบฝาก เปิด', 'มีคำฝั่งฝาก (ฝาก/เติม/คำร่วม)', 'อยู่ในช่วง 23:00–02:00', 'อ่านเช็คเวลา (ฝาก) เปิด'],
    card: 'notice_deposit_offtime_flex_id', stamp: 'notice_deposit_at',
  },
  {
    id: 'B', name: 'ฝาก · ระบบปิด', tone: 'bg-blue-600',
    when: ['ข้อความ (text)', 'เตือนระบบฝาก เปิด', 'มีคำฝั่งฝาก', 'site rules: ฝั่งฝากปิดทุกบัญชี (deposit ดู is_view · ใบผสมดู is_view)', 'อ่านเช็คสถานะระบบ (ฝาก) เปิด'],
    card: 'notice_deposit_flex_id', stamp: 'notice_deposit_at',
  },
  {
    id: 'C', name: 'ถอน · นอกเวลา', tone: 'bg-amber-500',
    when: ['ข้อความ (text)', 'เตือนระบบถอน เปิด', 'มีคำฝั่งถอน (ถอน/ลด/คำร่วม)', 'อยู่ในช่วง 23:00–02:00', 'อ่านเช็คเวลา (ถอน) เปิด'],
    card: 'notice_withdraw_offtime_flex_id', stamp: 'notice_withdraw_at',
  },
  {
    id: 'D', name: 'ถอน · ระบบปิด', tone: 'bg-orange-600',
    when: ['ข้อความ (text)', 'เตือนระบบถอน เปิด', 'มีคำฝั่งถอน', 'site rules: ฝั่งถอนปิดทุกบัญชี (withdraw + ใบผสม ดู status=enable)', 'อ่านเช็คสถานะระบบ (ถอน) เปิด'],
    card: 'notice_withdraw_flex_id', stamp: 'notice_withdraw_at',
  },
  {
    id: 'E', name: 'สลิป · นอกเวลา', tone: 'bg-violet-500',
    when: ['รูปภาพที่พบ QR (สลิป)', 'เตือนระบบฝาก เปิด', 'เตือนฝากมีผลกับ = Slip', 'อยู่ในช่วง 23:00–02:00', 'อ่านเช็คเวลา (ฝาก) เปิด'],
    card: 'notice_all_offtime_flex_id', stamp: 'notice_payment_at',
  },
  {
    id: 'F', name: 'สลิป · ระบบปิด', tone: 'bg-purple-600',
    when: ['รูปภาพที่พบ QR (สลิป)', 'เตือนระบบฝาก เปิด', 'เตือนฝากมีผลกับ = Slip', 'site rules: ฝั่งฝากปิด', 'อ่านเช็คสถานะระบบ (ฝาก) เปิด'],
    card: 'notice_all_disable_flex_id', stamp: 'notice_payment_at',
  },
];

/** the chip beside each card label — small, loud, unmistakable. */
export function CaseChip({ id }: { id: string }): React.ReactElement | null {
  const { t } = useI18n();
  const row = CASES.find((c) => c.id === id);
  if (!row) return null;
  return (
    <span className={`ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-black text-white ${row.tone}`}>
      {t('pageui.hookform.notice_case_chip', 'เคส {id}', { id })}
    </span>
  );
}

export function NoticeCaseInfoModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700">
        <div className="sticky top-0 flex items-center justify-between gap-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-5 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-primary-500" />
            <h3 className="font-bold text-slate-800 dark:text-slate-100">{t('pageui.hookform.notice_info_title', 'เคสแจ้งเตือนระบบ A–F — ใครยิงเมื่อไหร่')}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><X size={18} /></button>
        </div>

        <div className="px-5 py-3 text-[12px] text-slate-500 border-b border-slate-100 dark:border-slate-800">
          {t('pageui.hookform.notice_order', 'ลำดับตัดสิน')} <b>A → C → B → D → E → F</b> {t('pageui.hookform.notice_order_one_card', '· หนึ่งข้อความยิงได้ใบเดียว — การ์ดที่ยิงคือ')}<b>{t('pageui.hookform.notice_order_only_answer', 'คำตอบเดียว')}</b>{t('pageui.hookform.notice_order_rest', 'ของข้อความนั้น (ไม่เรียก AI ต่อ) · คำร่วม (เงิน/เครดิต/บัญชี/ปรับ ฯลฯ) เข้าได้ทั้งสองฝั่ง ฝั่งฝากชนะตามลำดับ')}
        </div>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {CASES.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className={`flex items-center gap-2 px-3 py-2 text-white ${c.tone}`}>
                <span className="text-lg font-black leading-none">{c.id}</span>
                <span className="text-sm font-bold">{t(`pageui.hookform.notice_case.${c.id}.name`, c.name)}</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                <p className="text-[11px] font-bold text-slate-500">{t('pageui.hookform.notice_conditions', 'เงื่อนไข (ครบทุกข้อจึงยิง)')}</p>
                <ul className="text-[12px] text-slate-700 dark:text-slate-300 space-y-0.5 list-disc pl-4">
                  {c.when.map((w, i) => (<li key={w}>{t(`pageui.hookform.notice_case.${c.id}.when_${i}`, w)}</li>))}
                </ul>
                <div className="pt-1 text-[11px] text-slate-500 space-y-0.5">
                  <p>{t('pageui.hookform.notice_card', 'การ์ด:')} <code className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 rounded px-1">{c.card}</code></p>
                  <p>{t('pageui.hookform.notice_stamp', 'ประทับเวลา:')} <code className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 rounded px-1">config.follow_up.line.{c.stamp}</code></p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 pb-4 text-[11px] text-slate-500">
          {t('pageui.hookform.notice_footer', 'สวิตช์ "อ่านเช็คเวลา / อ่านเช็คสถานะระบบ" ของแต่ละฝั่งครอบการอ่านเงื่อนไขนั้น — ปิดแล้วเคสของเช็คนั้นเงียบ (A+E / B+F / C / D) · ไม่มีเคสไหนเข้า = ตอบปกติ/AI ตามเดิม')}
        </div>
      </div>
    </div>
  );
}
