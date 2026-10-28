import React, { useEffect, useState } from 'react';
import { categoryOptionsFor } from '../ticket-category';
import { X, FolderPlus } from 'lucide-react';
import { useI18n } from '../../i18n';
import { categoryLabelI18n } from './ticket-detail/categoryLabelI18n';

/**
 * "เปิดเคส" for a conversation that never had one.
 * ===========================================================================
 * Two things the admin decides and nothing else: the CATEGORY and the NEED.
 *
 * The category values are the ones the collection actually holds — checked
 * against live data, not guessed: `Other` (147 rows) and `Payment` (40). The
 * labels are the page's own: อื่นๆ and แจ้งฝาก. Sending anything else would pass
 * validation nowhere and would quietly break the category filters, so the BE
 * refuses it too. ค่าจริงใน DB มีสองค่านี้เท่านั้น.
 * [FEAT-20261014-TICKETCATS] that is the shop-api list. A site whose customer provider
 * declares its own (loan_v1: Collection · IT · Payment · Other) passes `categories`,
 * and the BE accepts that site's list.
 *
 * The need is free text and MAY be left blank — the BE then stores a stated
 * default rather than an empty row, so a case is never unexplained.
 *
 * revert: delete this file and its use in TicketChat.
 */
export const OPEN_CASE_CATEGORIES = [
  { value: 'Other', label: 'อื่นๆ' },
  { value: 'Payment', label: 'แจ้งฝาก' },
] as const;

/** Shown as the input's placeholder AND stored by the BE when left blank. */
export const OPEN_CASE_DEFAULT_NEED = 'เปิดเคสโดยแอดมิน';

interface Props {
  open: boolean;
  customerName?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choices: { category: string; need_detail: string }) => void;
  /* [FEAT-20261014-TICKETCATS] the site's categories from the customer provider. null/absent = the two above,
     exactly as before (shop-api). The default stays the first of the old list (Other). */
  categories?: readonly string[] | null;
}

export const OpenCaseModal: React.FC<Props> = ({
  open, customerName, busy = false, onCancel, onConfirm, categories,
}) => {
  const { t } = useI18n();
  const options = categories
    ? categoryOptionsFor(categories).map((o) => ({ value: o.value, label: o.label }))
    : OPEN_CASE_CATEGORIES;
  const [category, setCategory] = useState<string>(OPEN_CASE_CATEGORIES[0].value);
  const [need, setNeed] = useState('');

  // Reopening the dialog must not inherit the last attempt's answers.
  useEffect(() => {
    if (open) { setCategory(OPEN_CASE_CATEGORIES[0].value); setNeed(''); }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[34rem] rounded-2xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <FolderPlus size={22} className="text-blue-700 dark:text-blue-300 shrink-0" />
          <h3 className="text-[17px] font-bold text-slate-800 dark:text-slate-100 flex-1">{t('ticketui.opencase.title', 'เปิดเคสให้ลูกค้ารายนี้')}</h3>
          <button
            type="button" onClick={onCancel} aria-label={t('ticketui.common.close', 'ปิด')}
            className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {customerName && (
            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{t('ticketui.opencase.customer', 'ลูกค้า:')} <span className="font-semibold text-slate-700 dark:text-slate-200">{customerName}</span></p>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{t('ticketui.opencase.category', 'ประเภท')}</label>
            <div className="flex gap-2">
              {options.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value)}
                  /* [FEAT-20260819-OPENFROMROOM] THE COLOUR TRAP, twice over.
                     `primary` in this app is LINE GREEN (--color-primary-500 #06c755),
                     and the ticket scope overrides only `.tc .text-primary` to the
                     theme blue #1d4ed8 (index.css:211) — `bg-primary` is defined
                     NOWHERE, so a filled button rendered almost white and its white
                     label vanished (owner's screenshot). Before that, a 10% tint read
                     as "nothing selected" at all.
                     So this uses the theme's blue explicitly: blue-700 is the same
                     #1d4ed8 the scope already paints text with, blue-50 the same
                     #eff6ff it uses for `bg-primary-light`. Owner: "light ใช้สีฟ้า +
                     font ฟ้า ของธีมน้ำเงิน".
                     ห้ามใช้ bg-primary ในขอบเขตนี้ — ไม่มีนิยาม จะได้ปุ่มขาว. */
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold border-2 transition-colors ${
                    category === opt.value
                      ? 'border-blue-700 bg-blue-50 text-blue-700 shadow-sm ring-2 ring-blue-300 dark:bg-blue-600 dark:text-white dark:border-blue-400'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {categoryLabelI18n(opt.label, t)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
              {t('ticketui.opencase.detail', 'รายละเอียด (ไม่กรอกก็ได้)')}
            </label>
            <input
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              maxLength={500}
              placeholder={OPEN_CASE_DEFAULT_NEED}
              className="w-full px-4 py-3 rounded-lg text-[15px] border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-700"
            />
            <p className="mt-1.5 text-[13px] text-slate-400">{t('ticketui.opencase.default_hint', 'เว้นว่างไว้ ระบบจะบันทึกว่า')} “{OPEN_CASE_DEFAULT_NEED}”</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-5 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button" onClick={onCancel} disabled={busy}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-slate-600 dark:text-slate-300 border-2 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {t('common.cancel', 'ยกเลิก')}
          </button>
          <button
            type="button" disabled={busy}
            onClick={() => onConfirm({ category, need_detail: need })}
            /* Same trap as the category buttons above: `bg-primary` has no
               definition in this scope, so the fill came out white and the white
               label disappeared. Painted with the theme blue directly — solid
               blue-700 (#1d4ed8, the same blue `.tc .text-primary` uses) with white
               text is the loudest thing in the dialog, which is what the primary
               action should be. ปุ่มตกลงต้องเด่นที่สุด. */
            className="px-6 py-2.5 rounded-lg text-[15px] font-bold text-white bg-blue-700 hover:bg-blue-800 shadow-md ring-2 ring-blue-300 active:scale-95 transition disabled:opacity-50"
          >
            {busy ? t('ticketui.opencase.opening', 'กำลังเปิด…') : t('ticketui.opencase.open', 'เปิดเคส')}
          </button>
        </div>
      </div>
    </div>
  );
};
