import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import type { SuspendedEntry } from '../../../services/strike/strikeService';
import { copyText } from '../../../utils/copyText';

/**
 * [FEAT-20260826-STRIKESUSPEND] One locked-out customer in the header tray.
 * ===========================================================================
 * 📖 PLAN: `omnidesk-api/todo/task/26082026/todo10_26082026_strike-suspend.md`
 *
 * ⚠️ EVERY FIELD FALLS BACK TO `n/a`, NEVER TO A BLANK. Owner, 26/08. A blank
 * cell reads as a rendering fault and sends an admin looking for a bug that is
 * not there; `n/a` says the system looked and the customer has no value.
 *
 * ⚠️ AND A MISSING VALUE GETS NO COPY BUTTON. Copying the literal string "n/a"
 * into a search box is worse than having nothing to click — it looks like it
 * worked. ไม่มีค่า = ไม่มีปุ่มก๊อป ไม่ใช่ก๊อปคำว่า n/a
 *
 * revert: delete this folder and the one line in `App.tsx` that mounts the tray.
 */

const NA = 'n/a';

/** The four things an admin reads off a row, in the order they read them. */
const FIELDS: Array<{ key: keyof SuspendedEntry; labelKey: string }> = [
  { key: 'full_name' as keyof SuspendedEntry, labelKey: 'suspended.full_name' },
  {
    key: 'display_name' as keyof SuspendedEntry,
    labelKey: 'suspended.display_name',
  },
  {
    key: 'phone_number' as keyof SuspendedEntry,
    labelKey: 'suspended.phone',
  },
  { key: 'hook_alias' as keyof SuspendedEntry, labelKey: 'suspended.oa' },
];

interface Props {
  row: SuspendedEntry;
  t: (key: string) => string;
  /** [FEAT-2708-COPYTOAST] แจ้ง Tray ว่าเพิ่ง copy สำเร็จ — Tray เป็นคนวาด toast
   *  (แถวมีหลายใบ toast ต้องมีตัวเดียวกลางถาด ไม่ใช่เด้งรายแถว) */
  onCopied?: () => void;
}

/* [FEAT-2708-TRAYNOCLEAR] เจ้าของ 27/08: "ห้ามมีปุ่มเคลียร์ตรงนี้ ให้ไปกดเอา
   ยกเลิกข้างใน modal avatar" — แถวในถาดเป็นข้อมูลอ่าน/คัดลอกอย่างเดียว
   การยกเลิกเหลือทางเดียว: modal สถิติ strike (มี confirm+ติ๊กยินยอมครบ)
   revert: คืน props canClear/onClear + ปุ่ม suspended-clear ที่เคยอยู่หลังตัวเลข */
export const SuspendedRow: React.FC<Props> = ({ row, t, onCopied }) => {
  /* Which field was just copied — one key, not a boolean per field, so a second
     copy always moves the tick instead of lighting two at once. */
  const [copied, setCopied] = useState<string | null>(null);

  /* [FIX-20260830-TRAYCOPYHTTP] owner 30/08: "toast says copied, nothing is on
     the clipboard".

     WAS: `void navigator.clipboard?.writeText(value)` followed by an
     unconditional `setCopied` + `onCopied`. The Clipboard API exists only in a
     SECURE CONTEXT (https / localhost); this stack is served over plain http
     (console.omnidesk.test), so `navigator.clipboard` is `undefined`, the optional
     chain swallowed the whole call, and the tick + toast still fired — the UI
     claimed a copy that never happened.

     NOW: `utils/copyText` — the helper written for this exact failure back in
     [FIX-20260816-COPYHTTP]; it falls back to the legacy textarea +
     `execCommand('copy')` on http and REPORTS whether either path worked.
     🔴 The tick and the toast are gated on that result: never confirm a copy the
        browser refused. ก๊อปไม่ติด = ห้ามขึ้น toast ว่าคัดลอกแล้ว */
  const copy = async (key: string, value: string) => {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(key);
    onCopied?.();

    // the toast IS the tick: a floating popup for a two-character action is noise
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };

  return (
    <div
      data-testid="suspended-row"
      className="flex flex-col gap-1 border-b border-slate-100 p-3 last:border-b-0 dark:border-dark-700"
    >
      <div className="flex items-center justify-between gap-2">
        {/* [FEAT-20260830-STRIKEWORD] owner 30/08: "ติดไปแล้ว: 5" reads as a
            bare tally; it now says what happened and that the customer is
            blocked — "โดนลิมิตแล้ว 5 ครั้ง Blocked". The count and the unit are
            separate i18n pieces so each locale can order them its own way. */}
        {/* [FEAT-20260830-TRAYWHOBLOCKED] an ADMIN block has no rate-limit story
            to tell — "โดนลิมิตแล้ว 0 ครั้ง" is noise at best and wrong at worst.
            🔴 The switch is `suspended_by`, NOT `strike_total === 0`: a ceiling
               lock can read 0 too once its events age out of the window, and
               that customer must keep the count. Same field `StrikeStatsModal`
               uses, so the two screens cannot disagree. */}
        <span className="text-xs font-bold text-red-600 dark:text-red-400">
          {row.suspended_by ? (
            <span
              data-testid="suspended-admin-blocked"
              className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
            >
              {t('suspended.admin_blocked')}
            </span>
          ) : (
            <>
              {t('suspended.strikes')} {row.strike_total} {t('suspended.strikes_unit')}{' '}
              <span className="ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {t('suspended.strikes_blocked')}
              </span>
            </>
          )}
        </span>
      </div>

      {FIELDS.map(({ key, labelKey }) => {
        const raw = row[key];
        const value = typeof raw === 'string' && raw.trim() ? raw : null;
        return (
          <div key={String(key)} className="flex items-center gap-2 text-xs">
            <span className="w-20 shrink-0 text-slate-400">{t(labelKey)}</span>
            {/* [FEAT-2708-TRAYPOLISH] เจ้าของ 27/08: ปุ่ม copy ย้ายมา "หน้า"
                value (เดิมอยู่ท้ายแถว) — ตัวปุ่มเดิมทุกอย่าง แค่ย้ายตำแหน่ง */}
            {value && (
              <button
                type="button"
                data-testid={`copy-${String(key)}`}
                onClick={() => void copy(String(key), value)}
                aria-label={t('suspended.copy')}
                className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-dark-700"
              >
                {copied === String(key) ? (
                  <Check size={12} className="text-emerald-600" />
                ) : (
                  <Copy size={12} />
                )}
              </button>
            )}
            <span
              data-testid={`value-${String(key)}`}
              className={`min-w-0 flex-1 truncate font-medium ${
                value
                  ? 'text-slate-700 dark:text-slate-200'
                  : 'text-slate-400 italic'
              }`}
            >
              {/* n/a เปล่า ๆ อ่านไม่ออกว่าทำไม — เจ้าของสั่งต่อท้ายเหตุผล
                  (ข้อมูลพวกนี้มากับการลงทะเบียน) · ค่าจริงไม่แตะ */}
              {value ?? `${NA} ${t('suspended.na_unregistered')}`}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default SuspendedRow;
