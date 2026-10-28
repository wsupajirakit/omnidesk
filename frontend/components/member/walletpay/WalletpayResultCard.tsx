/**
 * ==== [FEAT-20260816-WALLETPAYCARD] "ผลตรวจ WalletPay" — its own card, standalone ====
 *
 * WHERE: the ticket panel, directly under "รอทำรายการ" (PersonalPanel renders it
 * with two lines: an import and this tag). A separate card, NOT a third tab of
 * the pending card — owner 16/08: "แยกการ์ดใหม่เลยดีกว่า".
 *
 * WHAT IT SHOWS: every chain STEP 2 leg recorded for THIS member (today that is
 * the WalletPay slip upload), newest first, paginated. Each row opens its raw
 * request/response in a modal. No count badge — owner's call.
 *
 * ⚠️ STAND-ALONE, NEVER BREAKS THE PANEL (owner: "อย่าให้พังเด็ดขาด stand alone"):
 *   · LAZY — nothing is requested until the admin opens the card. A ticket that
 *     is never expanded costs zero requests.
 *   · the service never throws (returns an empty page on any failure), so the
 *     worst case here is an empty card, never an error boundary.
 *   · no shared state with the rest of the panel: its own loading/page/rows.
 *   · a stale response from a slow request for an OLD page is ignored (`reqId`
 *     guard) so fast clicking cannot render the wrong page.
 *
 * MASKING: the BE masks ids before answering (~70% hidden); `maskDeep` masks
 * again inside the modal. Two layers on purpose.
 *
 * TO CHANGE the page size, edit PAGE_SIZE (the BE clamps at 50).
 * revert: delete this folder + the two lines in PersonalPanel.tsx + the export
 *         line in services/chat/index.ts + the BE `walletpay-history` folder.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
// [FEAT-20260816-WALLETPAYCARD] CircleDollarSign = "money leg", distinct from the
// History clock the pending card uses (owner asked for a dollar/coin icon).
import { ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Info, RefreshCw } from 'lucide-react';

import { useI18n } from '../../../i18n';

import {
  walletpayHistoryService,
  type WalletpayHistoryRow,
} from '../../../services/chat';

import { WalletpayRawModal } from './WalletpayRawModal';

const PAGE_SIZE = 5;

/* [FIX-20260816-HTTPBADGE] The row used to carry a long Thai phrase ("ตรวจครบแล้ว
   ไม่ตรง" …) next to a grey "HTTP 200". The owner cut the phrase: the badge IS the
   http code now, and the COLOUR carries the verdict — one glance, no reading.
     amber  = answered, but not settled (no_match / exhausted / nothing to match)
     rose   = something is wrong (bad ref, txn missing, no answer at all)
     emerald= settled
   The full reason string is still one tap away in the ⓘ modal, so nothing is lost.
   ⚠️ Colour is chosen from the REASON, not from the http code — every walletpay
   business case answers 200, so colouring by status alone would paint failures
   green. ห้ามดูแค่ 200 ต้องดูเหตุผลด้วย. */
function httpBadge(row: WalletpayHistoryRow): { text: string; cls: string } {
  const reason = row.reason || row.review_reason || '';
  const text = row.http_status != null ? `HTTP ${row.http_status}` : (row.outcome || '-');
  const amber = 'text-amber-700 bg-amber-50 border-amber-200';
  const rose = 'text-rose-700 bg-rose-50 border-rose-200';
  const emerald = 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (
    reason === 'walletpay_invalid_ref' ||
    reason === 'walletpay_txn_not_found' ||
    reason === 'walletpay_bad_request' ||
    row.outcome === 'TIMEOUT'
  ) {
    return { text, cls: rose };
  }
  if (reason === 'no_match' || reason === 'walletpay_exhausted' || reason === 'no_matching_statement') {
    return { text, cls: amber };
  }
  if (row.outcome === 'TRUE') return { text, cls: emerald };
  return { text, cls: 'text-slate-600 bg-slate-50 border-slate-200' };
}

export const WalletpayResultCard: React.FC<{ lineUserId?: string | null }> = ({
  lineUserId,
}) => {
  // [FEAT-20260816-WALLETPAYI18N] every string here comes from the dictionaries
  // (th/en/zh/it) — no hardcoded Thai in this card.
  const { t } = useI18n();
  const [open, setOpen] = useState(false); // lazy: closed ⇒ no request
  const [rows, setRows] = useState<WalletpayHistoryRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [rawRow, setRawRow] = useState<WalletpayHistoryRow | null>(null);
  /** [stand-alone] ignore a late answer that belongs to an older request */
  const reqId = useRef(0);

  const load = useCallback(
    async (p: number) => {
      if (!lineUserId) return;
      const mine = ++reqId.current;
      setLoading(true);
      const res = await walletpayHistoryService.list(lineUserId, p, PAGE_SIZE);
      if (mine !== reqId.current) return; // a newer request already won
      setRows(res.rows);
      setPage(res.page);
      setTotal(res.total);
      setHasNext(res.has_next);
      setLoading(false);
      setLoadedOnce(true);
    },
    [lineUserId],
  );

  // LAZY: first fetch happens when the card is opened, never before.
  useEffect(() => {
    if (open && !loadedOnce && !loading) void load(1);
  }, [open, loadedOnce, loading, load]);

  if (!lineUserId) return null;

  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      {/* [FEAT-20260816-WALLETPAYCARD] header copied from PanelCard (PersonalPanel:216-220)
          so this card is visually indistinguishable from its neighbours: the WHOLE bar
          toggles, the chevron sits far right, no floating button. It is copied rather
          than reused because PanelCard is not exported and moving it is out of scope —
          keep the two in sync if that header ever changes.
          revert: nothing else depends on this markup. */}
      <div
        onClick={() => setOpen((o) => !o)}
        className="bg-primary-light px-3 py-2 border-b border-border flex justify-between items-center cursor-pointer select-none gap-2 transition-colors hover:bg-blue-50/60"
      >
        <h3 className="text-sm font-bold text-warning tracking-wide flex items-center gap-2">
          <CircleDollarSign size={14} /> {t('walletpay.card_title')}
          {/* [FIX-20260816-REFRESHINLINE] refresh sits right AFTER the label (owner's
              call). `stopPropagation` keeps the card from toggling when it is pressed,
              so the bar stays fully clickable everywhere else. Rendered only when the
              card is open — there is nothing to reload while collapsed (lazy). */}
          {open && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void load(page);
              }}
              disabled={loading}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-normal text-gray-500 hover:text-primary hover:bg-white/60 disabled:opacity-40"
              title={t('walletpay.reload')}
              aria-label={t('walletpay.reload')}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              {t('walletpay.reload')}
            </button>
          )}
        </h3>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </div>

      {open && (
        <div className="p-3">
          {loading && !rows.length && (
            <p className="text-[13px] text-slate-400 py-3 text-center">{t('walletpay.loading')}</p>
          )}
          {!loading && !rows.length && (
            <p className="text-[13px] text-slate-400 py-3 text-center">{t('walletpay.empty')}</p>
          )}

          <div className="space-y-2">
            {rows.map((r) => {
              const label = httpBadge(r);
              const when = r.at ? new Date(r.at).toLocaleString('th-TH') : '-';
              return (
                /* [FIX-20260816-ROWCLICK] the WHOLE row opens the modal (owner:
                   "กดตรงไหนของ record ก็ได้"). The ⓘ stays as an affordance but is
                   no longer the only target; it is not a <button> any more, so a
                   click on it is just a click on the row — no nested handler, no
                   stopPropagation needed. */
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setRawRow(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setRawRow(r);
                  }}
                  title={t('walletpay.view_raw')}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 cursor-pointer transition-colors hover:bg-white hover:border-slate-300"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* [FIX-20260816-HTTPBADGE] the badge IS the http code; the
                          reason lives in the tooltip and in the ⓘ modal. */}
                      <span
                        className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${label.cls}`}
                        title={r.reason || r.review_reason || r.outcome || ''}
                      >
                        {label.text}
                      </span>
                    </div>
                    {/* [FEAT-20260816-WALLETPAYSTMT] the deposit row this leg fired at
                        sits next to the time — the question an admin asks first
                        ("อันไหน"). refId + trace ids live in the ⓘ modal so the row
                        stays one readable line. */}
                    <p className="text-[12px] text-slate-500 mt-0.5 truncate">
                      {when}
                      {r.statement_id
                        ? ` · #${r.statement_id}${
                            r.statement_amount != null
                              ? ` (${r.statement_amount.toLocaleString()})`
                              : ''
                          }`
                        : ''}
                    </p>
                  </div>
                  {/* affordance only — the row itself carries the click */}
                  <Info size={16} className="text-slate-400 shrink-0" />
                </div>
              );
            })}
          </div>

          {(total > PAGE_SIZE || page > 1) && (
            <div className="flex items-center justify-between mt-2.5">
              <span className="text-[12px] text-slate-400">
                {t('walletpay.page_info').replace('{page}', String(page)).replace('{total}', String(total))}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void load(page - 1)}
                  disabled={loading || page <= 1}
                  className="p-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-25 hover:bg-slate-100 hover:border-slate-400 transition-colors"
                  aria-label={t('walletpay.prev')}
                >
                  <ChevronLeft size={18} strokeWidth={2.5} />
                </button>
                <button
                  type="button"
                  onClick={() => void load(page + 1)}
                  disabled={loading || !hasNext}
                  className="p-2 rounded-lg border border-slate-300 text-slate-700 disabled:opacity-25 hover:bg-slate-100 hover:border-slate-400 transition-colors"
                  aria-label={t('walletpay.next')}
                >
                  <ChevronRight size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <WalletpayRawModal row={rawRow} onClose={() => setRawRow(null)} />
    </div>
  );
};
