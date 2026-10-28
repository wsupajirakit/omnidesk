/**
 * [REFACTOR-20260905-CUSTPROV] Draws the "โบนัส" card — two tabs, เงินคืน
 * (cashback: pending/claimed totals + history) and แนะนำเพื่อน (referral:
 * pending/claimed totals, friend count, history).
 *
 * MOVED VERBATIM from `ProfilePanel.tsx` (was the fifth of six cards
 * rendered inside `PersonalPanelNarrow`, guarded by `{bonus && (…)}`). That
 * guard stayed in the parent — see `ProfilePanel.tsx`'s call site — because
 * `dev-local §6.3` moves markup, not the "when to render" decision. No class
 * string, element order, or condition changed; only the file this JSX lives
 * in.
 *
 * STATE STAYS IN THE PARENT (`dev-local §6.4`): this card owns no
 * `useState`/`useEffect` of its own — `PanelTabs` (imported from `../shared`)
 * owns the active-tab toggle; every value below is a plain derived value
 * already computed in `PersonalPanelNarrow` and threaded down as a prop.
 * Nothing here is coupled.
 *
 * ==== [FEAT-20260905-CUSTPROV] THE HISTORY ROWS ARE NORMALISED =============
 * Both tabs draw a dated, signed amount with an optional status, and both used
 * to read `h.at ?? h.date` per row because the demo mock sends an ISO `at` and
 * the real Shop-API sends an epoch `date`. That pair is resolved once now
 * (`row-paths.ts` → `bonus`), so each row arrives as `{ at, amount, sign,
 * status }` and the JSX reads `h.at`. Nothing else in this file changed —
 * `xpDT` still decides how a timestamp LOOKS, which is display, not lookup.
 *
 * Props: `cbPending` / `cbClaimed` / `cbHistory` (cashback tab),
 * `rfPending` / `rfClaimed` / `rfHistory` / `rfFriends` (referral tab) — all
 * read BY KEY from `view.sections` in `ProfilePanel.tsx`.
 *
 * revert: paste the `<PanelCard title="โบนัส">…</PanelCard>` JSX below back
 * into `PersonalPanelNarrow` inside its existing `{bonus && (…)}` guard,
 * delete this file, and drop the `<BonusCard …/>` call site. To revert only
 * the provider wiring, put `?? h.date` back on the two `xpDT(h.at)` calls.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { CircleCheck } from 'lucide-react';
import { PanelCard } from '../shared/PanelCard';
import { PanelTabs } from '../shared/PanelTabs';
import { xpAmt, xpDT, xpStatusTH } from '../shared/formatters';
import type { AmountRow } from '../renderers/types';

export const BonusCard: React.FC<{
  cbPending: any;
  cbClaimed: any;
  cbHistory: AmountRow[];
  rfPending: any;
  rfClaimed: any;
  rfHistory: AmountRow[];
  rfFriends: any;
}> = ({ cbPending, cbClaimed, cbHistory, rfPending, rfClaimed, rfHistory, rfFriends }) => {
  const { t } = useI18n();
  return (
      <PanelCard title={t('ticketui.panel.bonus', 'โบนัส')} icon={<CircleCheck size={14} />} defaultOpen={false}>
        <PanelTabs tabs={[
          { key: 'cashback', label: t('ticketui.panel.cashback', 'เงินคืน'), content: (
            <div className="space-y-1">
              <div className="flex rounded-lg border border-gray-200 mb-3 overflow-hidden">
                <div className="flex-1 p-2 bg-orange-50 border-r border-gray-200 flex flex-col items-center"><span className="text-xs font-bold text-orange-700">{t('ticketui.panel.pending_claim', 'ยอดรอให้กดรับ')}</span><span className="font-bold text-orange-600 text-base">{xpAmt(cbPending)}</span></div>
                <div className="flex-1 p-2 bg-green-50 flex flex-col items-center"><span className="text-xs font-bold text-green-800">{t('ticketui.panel.claimed_total', 'รับไปแล้วทั้งหมด')}</span><span className="font-bold text-green-700 text-base">{xpAmt(cbClaimed)}</span></div>
              </div>
              {cbHistory.length > 0 ? (<>
                <div className="flex justify-between text-xs text-gray-400 border-b border-gray-100 pb-2 mb-1 px-1"><span>{t('common.date', 'วันที่')}</span><span>{t('ticketui.panel.credit_received', 'เครดิตที่ได้รับ')}</span></div>
                {/* [FEAT-20260801-SHOPAPIV1FIELDS] แถวของจริงมี status (pending/cancel)
                    ถ้าโชว์แต่ "+0.00" เขียวล้วนจะเข้าใจผิดว่าได้รับแล้วทุกแถว
                    → ต่อท้ายสถานะเฉพาะแถวที่ยังไม่จบปกติ (mock ไม่มี status = เหมือนเดิม) */}
                {cbHistory.map((h: any, i: number, arr: any[]) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-2.5 px-1 ${i<arr.length-1?'border-b border-gray-50':''}`}><span className="text-gray-600">{xpDT(h.at)}</span><span className="font-bold text-green-600">+{xpAmt(h.amount)}{xpStatusTH(h.status) ? <span className="ml-1.5 text-[10px] font-medium text-gray-400">{xpStatusTH(h.status)}</span> : null}</span></div>
                ))}
              </>) : <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_cashback', 'ยังไม่มีประวัติเงินคืน')}</div>}
            </div>
          ) },
          { key: 'referral', label: t('ticketui.panel.referral', 'แนะนำเพื่อน'), content: (
            <div className="space-y-1">
              <div className="flex rounded-lg border border-gray-200 mb-3 overflow-hidden">
                <div className="flex-1 p-2 bg-orange-50 border-r border-gray-200 flex flex-col items-center"><span className="text-xs font-bold text-orange-700">{t('ticketui.panel.pending_claim', 'ยอดรอให้กดรับ')}</span><span className="font-bold text-orange-600 text-base">{xpAmt(rfPending)}</span></div>
                <div className="flex-1 p-2 bg-green-50 flex flex-col items-center"><span className="text-xs font-bold text-green-800">{t('ticketui.panel.claimed_total', 'รับไปแล้วทั้งหมด')}</span><span className="font-bold text-green-700 text-base">{xpAmt(rfClaimed)}</span></div>
              </div>
              <div className="text-[11px] text-gray-500 text-center mb-2">{t('ticketui.panel.friends_referred', 'แนะนำเพื่อนแล้ว {n} คน').replace('{n}', String(rfFriends ?? 0))}</div>
              {rfHistory.length > 0 ? (<>
                <div className="flex justify-between text-xs text-gray-400 border-b border-gray-100 pb-2 mb-1 px-1"><span>{t('common.date', 'วันที่')}</span><span>{t('ticketui.panel.credit_received', 'เครดิตที่ได้รับ')}</span></div>
                {rfHistory.map((h: any, i: number, arr: any[]) => (
                  <div key={i} className={`flex justify-between items-center text-sm py-2.5 px-1 ${i<arr.length-1?'border-b border-gray-50':''}`}><span className="text-gray-600">{xpDT(h.at)}</span><span className="font-bold text-green-600">+{xpAmt(h.amount)}{xpStatusTH(h.status) ? <span className="ml-1.5 text-[10px] font-medium text-gray-400">{xpStatusTH(h.status)}</span> : null}</span></div>
                ))}
              </>) : <div className="text-xs text-gray-400 italic py-4 text-center">{t('ticketui.panel.no_referral', 'ยังไม่มีประวัติแนะนำเพื่อน')}</div>}
            </div>
          ) },
        ]} />
      </PanelCard>
  );
};
