/**
 * [FEAT-20260816-WALLETPAYCARD] the ⓘ modal — one WalletPay leg's raw request/response.
 *
 * Content is masked TWICE: the BE masked before answering, and `maskDeep` runs
 * again here (see walletpayMask.ts). Read-only, no action buttons — an admin looks,
 * closes, and nothing in the system changes.
 *
 * Mirrors the existing pending-raw modal in PersonalPanel (fixed overlay, click
 * backdrop or ✕ to close) rather than introducing a second dialog style.
 * revert: delete with the folder.
 */
import React from 'react';
import { X } from 'lucide-react';

import { useI18n } from '../../../i18n';

import { maskDeep } from './walletpayMask';

export const WalletpayRawModal: React.FC<{
  row: {
    id: string;
    at: string | null;
    raw: unknown;
    /* [FEAT-20260816-WALLETPAYTRACE] handles for finding this event in the handoff
       log. They arrive from the BE ALREADY blurred (~50%, middle) — this card
       renders them as-is and never un-blurs or re-blurs anything. All masking
       decisions live in the BE (`walletpay-mask.util.ts`). */
    run_id?: string;
    job_ref?: string;
    ref?: string;
    statement_id?: string;
  } | null;
  onClose: () => void;
}> = ({ row, onClose }) => {
  const { t } = useI18n();
  if (!row) return null;
  const when = row.at ? new Date(row.at).toLocaleString('th-TH') : '-';
  return (
    /* [FIX-20260816-MODALCLOSE] the backdrop no longer closes the dialog (owner's
       call): raw JSON is scrolled and text-selected, and a stray click outside
       used to wipe it. The [✕ ปิด] button is the ONLY way out. */
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="min-w-0">
            {/* [FIX-20260816-MODALTITLE] owner trimmed both the "ข้อมูลดิบ" suffix and
                the masking note — the title is the card name, the timestamp is the
                only subtitle. */}
            <p className="font-bold text-slate-800 text-sm">{t('walletpay.raw_title', 'ผลตรวจ WalletPay')}</p>
            <p className="text-[12px] text-slate-400">{when}</p>
          </div>
          {/* wider, labelled close — the only exit from this dialog */}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-[13px] hover:bg-slate-100 hover:border-slate-400 shrink-0 transition-colors"
            aria-label={t('walletpay.close')}
          >
            <X size={16} /> {t('walletpay.close')}
          </button>
        </div>
        {/* [FEAT-20260816-WALLETPAYTRACE] trace strip — copy/paste targets, above the JSON */}
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50/60 text-[11px] font-mono text-slate-600 space-y-0.5 break-all">
          {row.ref ? <div>refId: {row.ref}</div> : null}
          {row.statement_id ? <div>statement_id: {row.statement_id}</div> : null}
          {row.job_ref ? <div>job_ref: {row.job_ref}</div> : null}
          {row.run_id ? <div>run_id: {row.run_id}</div> : null}
          <div>result_id: {row.id}</div>
        </div>
        <pre className="flex-1 overflow-auto text-[12px] leading-relaxed font-mono p-4 whitespace-pre-wrap break-all text-slate-700">
          {JSON.stringify(maskDeep(row.raw ?? {}), null, 2)}
        </pre>
      </div>
    </div>
  );
};
