/**
 * [REFACTOR-20261027-TCSPLIT] The assign-history detail modal of a closed case.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * revert: paste the body back where `<AssignHistoryModal />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { CheckCircle2, ChevronDown, Copy, History, Info, Tags, User as UserIcon, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { parseCustomerDetail } from '../../../../components/common';
import { getDynamicTagColor, thLabel } from '../../../../components/member';
import { registrationText, type TicketEntry } from '../../../../services/chat';
// [FIX-20260816-COPYHTTP] clipboard helper with the http fallback — see the util header
import { copyText } from '../../../../utils/copyText';
import { ROW_LABEL_KEY } from '../constants';
import { formatRelative } from '../format';
import type { TFn } from '../types';

export type AssignHistoryModalProps = {
  historyModalTicket: { ticket: TicketEntry; list: any[]; };
  t: TFn;
  categoryBadge: (cat?: string | null) => React.JSX.Element;
  setShowCustomerInfoInModal: React.Dispatch<React.SetStateAction<boolean>>;
  showCustomerInfoInModal: boolean;
  setShowMongoId: React.Dispatch<React.SetStateAction<boolean>>;
  showMongoId: boolean;
  acmeCategory: boolean;
  oaName: (hookId?: string | null) => string;
  setCopiedLabelInModal: React.Dispatch<React.SetStateAction<string>>;
  copiedLabelInModal: string;
  setCopiedMongoId: React.Dispatch<React.SetStateAction<boolean>>;
  copiedMongoId: boolean;
  setHistoryModalTicket: React.Dispatch<React.SetStateAction<{ ticket: TicketEntry; list: any[]; }>>;
  isEnglish: boolean;
};

export const AssignHistoryModal: React.FC<AssignHistoryModalProps> = ({
  historyModalTicket,
  t,
  categoryBadge,
  setShowCustomerInfoInModal,
  showCustomerInfoInModal,
  setShowMongoId,
  showMongoId,
  acmeCategory,
  oaName,
  setCopiedLabelInModal,
  copiedLabelInModal,
  setCopiedMongoId,
  copiedMongoId,
  setHistoryModalTicket,
  isEnglish,
}) => (
  <>
    {/* Assign History Detail Modal — NOT allowed to close on backdrop click */}
    {historyModalTicket && createPortal(
      <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-[690px] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="p-3 rounded-xl bg-[#27CFF5]/10 text-[#27CFF5] border border-[#27CFF5]/30 shrink-0">
                <History size={24} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                    {t('ticketui.history.title', 'ประวัติการดำเนินงาน')}
                  </h3>
                  <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#27CFF5]/10 text-[#27CFF5] border border-[#27CFF5]/30">
                    {t('ticketui.history.count', '{n} รายการ', { n: historyModalTicket.list.length })}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300 mt-1 flex-wrap font-medium">
                  <span className="font-bold text-gray-900 dark:text-white">
                    👤 {t('ticketui.history.customer_label', 'ลูกค้า:')} {historyModalTicket.ticket.line_user_data?.full_name || historyModalTicket.ticket.line_user_data?.phone_number || historyModalTicket.ticket.line_user_data?.display_name || historyModalTicket.ticket.line_user_data?.nickname || t('ticketui.history.customer', 'ลูกค้า')}
                  </span>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1.5 font-bold text-[#27CFF5]">
                    <span>📂 {t('ticketui.history.category_label', 'หมวด:')}</span>
                    {categoryBadge(historyModalTicket.ticket.category)}
                  </span>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => setShowCustomerInfoInModal(prev => !prev)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                      showCustomerInfoInModal
                        ? 'bg-[#27CFF5] text-slate-950 border-[#27CFF5] shadow-xs font-bold'
                        : 'bg-[#27CFF5]/10 text-[#27CFF5] hover:bg-[#27CFF5]/20 border-[#27CFF5]/30 font-bold'
                    }`}
                    title={t('ticketui.history.toggle_customer', 'กดเพื่อเปิด/ปิดแสดงข้อมูลลูกค้าและป้ายกำกับ')}
                  >
                    <UserIcon size={14} className={showCustomerInfoInModal ? 'text-slate-950' : 'text-[#27CFF5]'} />
                    <span>{t('ticketui.history.customer_info', 'ข้อมูลลูกค้า')}</span>
                    <ChevronDown size={13} className={`transition-transform ${showCustomerInfoInModal ? 'rotate-180 text-slate-950' : 'text-[#27CFF5]'}`} />
                  </button>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => setShowMongoId(prev => !prev)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                      showMongoId
                        ? 'bg-[#27CFF5] text-slate-950 border-[#27CFF5] shadow-xs font-bold'
                        : 'bg-[#27CFF5]/10 text-[#27CFF5] hover:bg-[#27CFF5]/20 border-[#27CFF5]/30 font-bold'
                    }`}
                    title={t('ticketui.history.toggle_id', 'กดเพื่อเปิด/ปิดแสดง MongoDB Ticket Record ID')}
                  >
                    <Info size={14} className={showMongoId ? 'text-slate-950' : 'text-[#27CFF5]'} />
                    <span>Ticket ID</span>
                  </button>
                </div>
                {showCustomerInfoInModal && (() => {
                  const modalUd = historyModalTicket.ticket.line_user_data;
                  const pDetail = parseCustomerDetail(modalUd?.detail);
                  const lineUserId = modalUd?.line_user_id || historyModalTicket.ticket.line_user_id || '';
                  const rowLabel = (label: string) => (ROW_LABEL_KEY[label] ? t(ROW_LABEL_KEY[label], label) : label);
                  const modalRows: { label: string; value?: string | null; mono?: boolean }[] = acmeCategory
                    ? [
                        { label: 'เบอร์โทร', value: modalUd?.phone_number || pDetail.phone },
                        { label: 'ชื่อ LINE', value: modalUd?.display_name },
                        { label: 'ชื่อเล่น', value: modalUd?.nickname },
                        { label: 'ชื่อ-สกุล', value: modalUd?.full_name || pDetail.name },
                        { label: 'รหัสสัญญา', value: modalUd?.contract_code || pDetail.contract },
                        /* [FEAT-20260819-REGSOURCE] who created this account link — an admin
                           on the customer's behalf, or the customer themselves via LIFF.
                           "-" for everyone registered before the BE recorded it. */
                        { label: 'ลงทะเบียนโดย', value: registrationText(modalUd?.link_registered_by, modalUd?.link_registered_at, formatRelative) },
                        { label: 'LINE User ID', value: lineUserId, mono: true },
                        { label: 'LINE OA', value: oaName(historyModalTicket.ticket.line_oa_hook_id) || historyModalTicket.ticket.line_oa_hook_id || '-' },
                      ]
                    : [
                        { label: 'โดเมน', value: modalUd?.domain || pDetail.name || null },
                        { label: 'สายงาน', value: modalUd?.agent_code || modalUd?.agent || null },
                        { label: 'ธนาคาร', value: modalUd?.bank_name || null },
                        { label: 'เลขบัญชี', value: modalUd?.bank_account || modalUd?.phone_number || null },
                        { label: 'ชื่อบัญชี', value: modalUd?.account_name || modalUd?.full_name || modalUd?.display_name || null },
                        { label: 'ทรูวอเล็ต', value: modalUd?.true_wallet || null },
                        /* [FEAT-20260819-REGSOURCE] who created this account link — an admin
                           on the customer's behalf, or the customer themselves via LIFF.
                           "-" for everyone registered before the BE recorded it. */
                        { label: 'ลงทะเบียนโดย', value: registrationText(modalUd?.link_registered_by, modalUd?.link_registered_at, formatRelative) },
                        { label: 'LINE User ID', value: lineUserId, mono: true },
                        { label: 'LINE OA', value: oaName(historyModalTicket.ticket.line_oa_hook_id) || historyModalTicket.ticket.line_oa_hook_id || '-' },
                      ];

                  return (
                    <div className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200/90 dark:border-slate-800 space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-150 select-none">
                      {/* ข้อมูลลูกค้า */}
                      <div>
                        <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-slate-200/80 dark:border-slate-800">
                          <span className="text-xs font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                            <UserIcon size={15} className="text-blue-500 dark:text-sky-400" />
                            {t('ticketui.history.customer_info', 'ข้อมูลลูกค้า')}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                          {modalRows.map(r => (
                            <div key={r.label} className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-900/60 gap-2">
                              <span className="text-gray-500 dark:text-gray-400 shrink-0 text-xs">{rowLabel(r.label)}</span>
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`font-bold text-gray-800 dark:text-gray-200 truncate ${r.mono ? 'font-mono text-xs' : ''}`}>
                                  {r.value || <span className="text-gray-400 dark:text-gray-600 font-normal">-</span>}
                                </span>
                                {r.value && (
                                  <button
                                    type="button"
                                    // [FIX-20260816-COPYHTTP] checkmark only on a REAL copy
                                    onClick={() => {
                                      void copyText(r.value).then((ok) => {
                                        if (!ok) return;
                                        setCopiedLabelInModal(r.label);
                                        setTimeout(() => setCopiedLabelInModal(null), 2000);
                                      });
                                    }}
                                    className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-sky-300 transition-colors cursor-pointer"
                                    title={t('ticketui.history.copy_row', 'คัดลอก{label}', { label: rowLabel(r.label) })}
                                  >
                                    {copiedLabelInModal === r.label ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Copy size={16} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ป้ายกำกับลูกค้า */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-2.5 pb-1.5 border-b border-slate-200/80 dark:border-slate-800">
                          <Tags size={15} className="text-purple-500 dark:text-purple-400" />
                          <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{t('ticketui.history.customer_tags', 'ป้ายกำกับลูกค้า')}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(historyModalTicket.ticket.customer_tags || []).length === 0 ? (
                            <span className="text-xs text-gray-400 italic">{t('ticketui.history.no_tags', 'ยังไม่มีป้ายกำกับ')}</span>
                          ) : (
                            (historyModalTicket.ticket.customer_tags || []).map(cg => (
                              <span
                                key={cg._id}
                                className={`tag-item text-xs font-bold px-3 py-1 rounded-full border ${getDynamicTagColor(cg.label, cg.color)}`}
                              >
                                {thLabel(cg.label)}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {showMongoId && (
                  <div
                    onClick={() => setShowMongoId(false)}
                    className="mt-2.5 p-2.5 rounded-xl bg-blue-50/80 dark:bg-sky-950/80 border border-blue-200 dark:border-sky-700/60 flex items-center justify-between gap-2 text-xs font-mono cursor-pointer hover:bg-blue-100/60 dark:hover:bg-sky-900/60 transition-colors group select-all"
                    title={t('ticketui.history.click_bar_close', 'กดที่แถบนี้เพื่อปิด')}
                  >
                    <div className="flex items-center gap-2 min-w-0 text-sm">
                      <Info size={15} className="text-blue-500 dark:text-sky-400 shrink-0" />
                      <span className="text-gray-700 dark:text-gray-300 truncate font-mono text-xs">
                        Ticket ID: <span className="font-bold text-blue-700 dark:text-sky-300">{historyModalTicket.ticket._id}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        // [FIX-20260816-COPYHTTP] real copy on http + "copied" only when true
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyText(historyModalTicket.ticket._id).then((ok) => {
                            if (!ok) return;
                            setCopiedMongoId(true);
                            setTimeout(() => setCopiedMongoId(false), 2000);
                          });
                        }}
                        className="px-3.5 py-1.5 text-xs font-sans font-bold text-white bg-blue-600 hover:bg-blue-700 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 rounded-lg transition-colors cursor-pointer"
                      >
                        {copiedMongoId ? t('ticketui.common.copied', 'คัดลอกแล้ว!') : t('ticketui.common.copy', 'คัดลอก')}
                      </button>
                      <span className="text-xs font-sans text-gray-400 group-hover:text-red-500 font-bold ml-1">{t('ticketui.history.click_close', '(กดเพื่อปิด)')}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setHistoryModalTicket(null)}
              className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white flex items-center justify-center transition-all cursor-pointer shrink-0 ml-2 hover:scale-105 active:scale-95 shadow-sm border border-slate-200/60 dark:border-slate-700/60"
              title={t('ticketui.common.close_window', 'ปิดหน้าต่าง')}
            >
              <X size={22} className="stroke-[2.5]" />
            </button>
          </div>

          {/* Modal Body — full untruncated history list */}
          <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
            {historyModalTicket.list.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm font-medium">{t('ticketui.history.empty', 'ยังไม่มีประวัติการดำเนินงาน')}</div>
            ) : (
              historyModalTicket.list.map((h, idx) => {
                const actorName = h.changed_by_data?.display_name || h.changed_by_data?.username || h.changed_by_id?.display_name || h.changed_by_id?.username || t('ticketui.history.actor_fallback', 'ระบบ/แอดมิน');
                const assigneeName = h.assign_to_data?.display_name || h.assign_to_data?.username || h.assign_to?.display_name || h.assign_to?.username || t('ticketui.history.assignee_fallback', 'ว่าง/บอท');

                let actionText = '';
                let dotColor = 'bg-slate-400';
                let badgeText = '';
                let badgeClass = '';

                if (h.action === 'accept') {
                  actionText = t('ticketui.history.accept_text', 'รับเคสครั้งแรกโดย: {actor}', { actor: actorName });
                  dotColor = 'bg-emerald-500';
                  badgeText = t('ticketui.history.accept_badge', 'รับเคสครั้งแรก');
                  badgeClass = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40';
                } else if (h.action === 'close') {
                  actionText = t('ticketui.history.close_text', 'จบงาน (ปิดเคส) โดย: {actor}', { actor: actorName });
                  dotColor = 'bg-slate-500';
                  badgeText = t('ticketui.history.close_badge', 'จบงาน(ปิดเคส)');
                  badgeClass = 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/40';
                } else if (h.action === 'claim') {
                  actionText = t('ticketui.history.claim_text', 'เคลมงาน (รับเคสต่อ) โดย: {actor}', { actor: actorName });
                  dotColor = 'bg-purple-500';
                  badgeText = t('ticketui.history.claim_badge', 'เคลมงาน (รับเคสต่อ)');
                  badgeClass = 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/40';
                } else if (h.action === 'reopen_by_admin') {
                  // [FEAT-20260817-REOPENBYADMIN] without this branch the row
                  // falls into the catch-all and lies "โอนงาน"
                  actionText = t('ticketui.history.reopen_text', 'เปิดเคส โดย: {actor}', { actor: actorName });
                  dotColor = 'bg-sky-500';
                  badgeText = t('ticketui.history.reopen_badge', 'เปิดเคส');
                  badgeClass = 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40';
                } else {
                  actionText = t('ticketui.history.transfer_text', 'เปลี่ยนผู้รับผิดชอบเป็น: {assignee} (โดย {actor})', { assignee: assigneeName, actor: actorName });
                  dotColor = 'bg-blue-500 dark:bg-sky-400';
                  badgeText = t('ticketui.history.transfer_badge', 'โอนงาน');
                  badgeClass = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-sky-950/80 dark:text-sky-200 dark:border-sky-600/60';
                }

                const formatFullDateTime = (dateStr?: string | null) => {
                  if (!dateStr) return '-';
                  const d = new Date(dateStr);
                  if (isNaN(d.getTime())) return dateStr;
                  const day = d.getDate();
                  const monthNames = isEnglish
                    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                    : ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
                  const month = monthNames[d.getMonth()];
                  const hours = String(d.getHours()).padStart(2, '0');
                  const mins = String(d.getMinutes()).padStart(2, '0');
                  return isEnglish ? `${day} ${month} ${hours}:${mins}` : `${day} ${month} ${hours}:${mins}น.`;
                };

                return (
                  <div key={h._id || idx} className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-start justify-between gap-4 text-sm leading-relaxed">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className={`w-3 h-3 rounded-full shrink-0 mt-1 ${dotColor}`} />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full border ${badgeClass}`}>
                            {badgeText}
                          </span>
                        </div>
                        <p className="font-semibold text-gray-900 dark:text-gray-100 break-words leading-relaxed text-sm">
                          {actionText}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-medium shrink-0">
                      {formatFullDateTime(h.created_at)}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-end">
            <button
              type="button"
              onClick={() => setHistoryModalTicket(null)}
              className="w-full sm:w-auto px-8 py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-md transition-all cursor-pointer hover:scale-105 active:scale-95 text-center flex items-center justify-center gap-2"
            >
              <X size={18} />
              <span>{t('ticketui.common.close_window', 'ปิดหน้าต่าง')}</span>
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
  </>
);
