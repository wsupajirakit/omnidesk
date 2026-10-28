/**
 * [FEAT-20260905-CUSTPROV PART 7] `amount_rows` — dated rows with a signed
 * amount and an optional status.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §37 (`amount_rows` = "รอทำรายการ (ถอน/ฝาก with signed amounts)")
 *
 * ## THE SHAPE IS THE ประวัติฝาก/ถอน TABLE (`ProfilePanel.tsx:2441-2463`)
 * Three columns — date · amount · status — with the same widths, the same
 * hairline between rows and the same header strip. The formatters are the
 * panel's own: `xpDT` (which already splits epoch SECONDS from MILLISECONDS by
 * magnitude, because one provider sends both in one payload), `xpAmt`, and
 * `xpStatusTH`.
 *
 * ## 🔴 `sign` IS THE CARD'S, NOT THE DATA'S — AND IT DRIVES THE COLOUR
 * The producer sets `sign` per SECTION (`amountRows(f.depRows, '+', …)` vs
 * `(f.wdRows, '-', …)`), because the upstream sends a withdrawal as a positive
 * number in a withdrawals list. So the renderer must NOT infer the sign from the
 * value: a withdrawal of 500 would print `+500` in green, which reads as money
 * arriving. Green for `+`, red for `-`, matching the two existing tabs.
 * เครื่องหมายมาจากการ์ด ไม่ใช่จากตัวเลข — เดาเองแล้วเงินออกจะกลายเป็นเงินเข้า
 * A row that omits `sign` is treated as `+`: the producer always sends one, and
 * an amount with NO sign in a signed table is more confusing than the common
 * case. That `??` is the fallback this file's test breaks to prove the case.
 *
 * ## `xpStatusTH` RETURNS EMPTY FOR "FINISHED NORMALLY" — SO `|| 'สำเร็จ'`
 * [FIX-20260825-DEPSTATUS]: the column reads status ONLY, and falls back to the
 * single word `สำเร็จ` when the row finished cleanly — not to a channel name,
 * which is what it used to do and made one column show two kinds of thing.
 *
 * ## `rows` FIRST, THEN `amountRows`
 * `finance.deposits` is `type: 'amount_rows'` AND carries three summary rows
 * (เครดิตคงเหลือ, เงินค้างในกระเป๋า, ยอดฝากรวม). See `KvRows` in
 * `./KvSection.tsx` for why every renderer draws `section.rows`.
 *
 * ## Empty ⇒ the summary rows alone, no invented message
 * The vocabulary has an `empty` type carrying the provider's own text. Same
 * decision as `KvSection` — recorded there.
 *
 * revert: delete this file and its `amount_rows` entry in `./index.tsx`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { xpAmt, xpDT, xpStatusTH } from '../shared/formatters';
import { KvRows } from './KvSection';
import type { SectionProps } from './types';

export const AmountRowsSection: React.FC<SectionProps> = ({ section }) => {
  const { t } = useI18n();
  const rows = section.amountRows ?? [];
  return (
    <div className="space-y-2.5">
      <KvRows rows={section.rows} />
      {rows.length > 0 ? (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-400 border-b border-gray-100 pb-2 mb-1 px-1">
            <span className="w-20">{t('common.date', 'วันที่')}</span>
            <span className="flex-1 text-center">{t('ticketui.panel.amount', 'ยอดเงิน')}</span>
            <span className="w-20 text-right">{t('ticketui.panel.status', 'สถานะ')}</span>
          </div>
          {rows.map((row, i) => {
            /* See the header: the sign is the section's, never inferred. */
            const sign = row.sign ?? '+';
            return (
              <div
                key={i}
                className={`flex justify-between items-center text-sm py-2.5 px-1 ${i < rows.length - 1 ? 'border-b border-gray-50' : ''}`}
              >
                <span className="text-gray-600 w-20">{xpDT(row.at)}</span>
                <span className={`flex-1 text-center font-bold ${sign === '-' ? 'text-red-500' : 'text-green-600'}`}>
                  {sign}
                  {xpAmt(row.amount)}
                </span>
                <span className="w-20 text-right text-gray-600 text-xs">{xpStatusTH(row.status) || t('status.success', 'สำเร็จ')}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
