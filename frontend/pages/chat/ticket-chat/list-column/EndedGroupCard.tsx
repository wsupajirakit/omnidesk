/**
 * [REFACTOR-20261027-TCSPLIT] One card of the ปิดเคส list: a customer's closed cases on one OA, with the history and bot-bar entries.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * Was the body of `endedWindow.visible.map(...)`; the key moved to the element the page renders.
 * revert: paste the body back where `<EndedGroupCard />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { History, Info, Layers, Zap } from 'lucide-react';
import { formatShortTime } from '../../../../components/chat/chat-input';
// [FIX-20260815-CLOSEDTABUNKNOWN] `realName` = the shared placeholder filter (contact + chat)
import { LineLogoIcon, realName } from '../../../../components/common';
import { getDynamicTagColor, thLabel } from '../../../../components/member';
import type { CardWindow, TicketEntry } from '../../../../services/chat';
// [FEAT-20260819-LINEGLOW] one rule for "this customer has real account data"
import { hasRawProfile } from '../../../../utils/memberSearchText';
import { StackToggle, type StackExpand } from '../../ticket-stack';
// [FIX-20260815-CLOSEDTABUNKNOWN] getCustomerDisplayName moved out of the page so the closed-tab
// cards get the same placeholder rule the bot-tab cards already had
import { getCustomerDisplayName, isSameTicketUser } from '../../ticketIdentity';
import type { StatusTab } from '../constants';
import type { EndedTicketGroup, TFn } from '../types';

export type EndedGroupCardProps = {
  group: EndedTicketGroup;
  expandedGroupCardId: string;
  selectedTicket: TicketEntry;
  endedWindow: CardWindow<EndedTicketGroup>;
  cardIdx: number;
  t: TFn;
  setTagInfoTicket: React.Dispatch<React.SetStateAction<TicketEntry>>;
  oaName: (hookId?: string | null) => string;
  ticketStackOn: boolean;
  stackExpand: StackExpand;
  categoryBadge: (cat?: string | null) => React.JSX.Element;
  setStatusTab: React.Dispatch<React.SetStateAction<StatusTab>>;
  openTicket: (ticket: TicketEntry, closedCases?: TicketEntry[]) => void;
  openHistoryModal: (subTk: TicketEntry) => Promise<void>;
  roomAssistMap: Record<string, boolean>;
  activeTickets: TicketEntry[];
  completedTickets: TicketEntry[];
};

export const EndedGroupCard: React.FC<EndedGroupCardProps> = ({
  group,
  expandedGroupCardId,
  selectedTicket,
  endedWindow,
  cardIdx,
  t,
  setTagInfoTicket,
  oaName,
  ticketStackOn,
  stackExpand,
  categoryBadge,
  setStatusTab,
  openTicket,
  openHistoryModal,
  roomAssistMap,
  activeTickets,
  completedTickets,
}) => {
  const { key, tickets: groupTickets, latest } = group;
  const isGroupExpanded = expandedGroupCardId === key || expandedGroupCardId === null;
  const ud = latest.line_user_data;
  const selected = selectedTicket?._id === latest._id || groupTickets.some(t => t._id === selectedTicket?._id);

  return (
    <div
      key={key}
      data-chat-card
        /* [FEAT-20260819-CARDWINDOW] only the batch that just appeared
           animates — see `isFresh`. Stagger capped so 25 cards never
           become a slow cascade. */
        style={endedWindow.isFresh(cardIdx) ? { animationDelay: `${Math.min(cardIdx % 25, 8) * 25}ms` } : undefined}
      className={`${endedWindow.isFresh(cardIdx) ? 'tc-card-reveal' : ''} p-3.5 border-l-4 transition-colors relative border-b border-gray-100 dark:border-gray-800/60 ${selected ? 'tc-card-selected border-blue-600 dark:border-sky-400 bg-blue-200/80 dark:bg-blue-600/50 shadow-sm ring-1 ring-blue-500/30' : 'border-transparent hover:bg-gray-50/80 dark:hover:bg-slate-800/50'}`}
    >
      {/* Header Row */}
      <div className="flex items-start gap-2 mb-2">
        <div className="p-1.5 rounded-lg bg-slate-100 text-slate-600 shrink-0 mt-0.5">
          <Layers size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80">
              {t('ticketui.ended.closed_rounds', 'ปิดเคส {n} รอบ', { n: groupTickets.length })}
            </span>
            {(latest.customer_tags || []).slice(0, 1).map(cg => (
              <span key={cg._id} className={`tag-item text-[10px] font-bold px-2 py-0.5 rounded-full border ${getDynamicTagColor(cg.label, cg.color)}`}>
                {thLabel(cg.label)}
              </span>
            ))}
            {(latest.customer_tags?.length || 0) > 1 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setTagInfoTicket(latest); }}
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 border border-purple-200 dark:border-purple-800 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                title={t('ticketui.tags.view_all_click', 'กดเพื่อดูป้ายกำกับทั้งหมด')}
              >
                <Info size={10} /> +{(latest.customer_tags!.length) - 1}
              </button>
            )}
          </div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 leading-tight truncate">
            {getCustomerDisplayName(ud, latest.line_user_id)}
          </h3>
          <p className="text-[14px] text-gray-500 dark:text-gray-400 truncate mt-0.5 flex items-center gap-1.5">
              {/* [FEAT-20260819-LINEGLOW] washed out when the site does NOT
                  know this customer — see .tc-line-dim in index.css. */}
            <LineLogoIcon className={`w-[18px] h-[18px] shrink-0 ${hasRawProfile(ud) ? '' : 'tc-line-dim'}`} />
            {/* [FIX-20260815-CLOSEDTABUNKNOWN] the sub-line showed
                "OA: demo-shop • Unknown" for the same reason the
                title did: it picked the first non-empty name
                without asking whether it was the backend
                placeholder. `realName` is the shared filter used
                across the contact and chat screens; an all-
                placeholder customer now drops the suffix rather
                than printing a name nobody chose. */}
            <span>OA: {oaName(latest.line_oa_hook_id) || '—'}{(() => {
              const n = realName(ud?.full_name) || realName(ud?.nickname) || realName(ud?.display_name);
              return n ? ` • ${n}` : '';
            })()}</span>
          </p>
        </div>
      </div>

      {/* Outer Case Summary Card */}
      <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-200/80 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-gray-800">{t('ticketui.ended.latest_case', 'ล่าสุด Case #{n}', { n: groupTickets.length })}</span>
          <span className="text-[10px] text-gray-500">
            {t('ticketui.ended.closed_at', 'ปิด {time}', { time: formatShortTime(latest.resolved_at || latest.updated_at) })}
          </span>
        </div>
        <p className="text-xs text-gray-700 font-medium leading-relaxed">
          {latest.need_detail || latest.category || t('ticketui.ended.default_detail', 'สอบถามข้อมูลเพิ่มเติม')}
        </p>

        {/* Sub-Cases List (Case #N down to Case #1) */}
        <div className={`space-y-2 pt-1 ${groupTickets.length > 3 ? 'max-h-[320px] overflow-y-auto custom-scrollbar pr-1' : ''}`}>
          {/* [FEAT-20261020-TICKETSTACK] flag on ⇒ folded shows the latest case only;
              idx 0 stays idx 0, so "Case #N" numbering is unchanged */}
          {(ticketStackOn && groupTickets.length > 1 && !stackExpand.isOpen(key)
            ? groupTickets.slice(0, 1)
            : groupTickets
          ).map((subTk, idx) => {
            const caseNum = groupTickets.length - idx;
            const subAdmin = subTk.admin_user_data?.display_name || subTk.admin_user_data?.username || t('ticketui.bot', 'บอท');
            const isSubSelected = selectedTicket?._id === subTk._id;

            return (
              <div
                key={subTk._id}
                className={`p-3 rounded-lg border text-xs transition-colors leading-normal ${
                  isSubSelected
                    ? 'bg-blue-500/15 border-blue-400/50 font-bold shadow-sm'
                    : 'bg-white/70 dark:bg-slate-800/70 border-slate-200/80 dark:border-slate-700/80 hover:bg-blue-50/50 text-gray-800 dark:text-gray-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-1.5 text-[11px] font-bold py-0.5 truncate ${isSubSelected ? 'text-blue-700 dark:text-sky-300' : 'text-gray-800 dark:text-gray-200'}`}>
                      <span className="shrink-0 inline-flex items-center my-0.5">{categoryBadge(subTk.category)}</span>
                      <span>Case #{caseNum}</span>
                      <span>•</span>
                      <span>{formatShortTime(subTk.created_at)}</span>
                      <span>→</span>
                      <span>{formatShortTime(subTk.resolved_at || subTk.updated_at)}</span>
                    </div>
                    <div className={`text-[11px] truncate mt-1 ${isSubSelected ? 'text-blue-600 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                      <span>{subAdmin}</span>
                      <span>•</span>
                      <span>{subTk.need_detail || t('ticketui.ended.closed_done', 'ปิดเคสเรียบร้อย')}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    // Open the chat AND switch the left list to the บอทดูแล tab so the
                    // selected case's card is visible + highlighted (openTicket sets
                    // selectedTicket; the bot-list gift cards by _id or same-user).
                    onClick={(e) => {
                      e.stopPropagation();
                      if (subTk.job_status === 2) {
                        setStatusTab('ended');
                      }
                      openTicket(subTk, groupTickets);
                    }}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors shrink-0 ${
                      isSubSelected
                        ? 'bg-blue-600 text-white border border-blue-600 shadow-xs'
                        : 'text-primary bg-blue-50 hover:bg-blue-100 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                    }`}
                  >
                    {t('ticketui.ended.view_chat', 'ดูแชท')}
                  </button>
                </div>

                {/* Direct 1-Click History Modal Button */}
                <div className="mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/50 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openHistoryModal(subTk);
                    }}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-700 dark:text-sky-300 dark:hover:text-sky-200 flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/60 border border-blue-200/80 dark:border-blue-800/80 cursor-pointer transition-colors"
                    title={t('ticketui.history.open_hint', 'กดเพื่อดูประวัติการดำเนินงานใน Modal')}
                  >
                    <History size={11} className="text-blue-500" />
                    <span>{t('ticketui.history.title', 'ประวัติการดำเนินงาน')}</span>
                    <Info size={11} className="text-blue-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {ticketStackOn && groupTickets.length > 1 && (
          <StackToggle
            groupKey={key}
            size={groupTickets.length}
            expanded={stackExpand.isOpen(key)}
            onToggle={stackExpand.toggle}
            variant="inline"
          />
        )}
      </div>

      {/* Bot-handled ticket bar: shown ONLY when the chatroom's assist_status is false (bot-mode).
          Uses roomAssistMap for real-time updates (patched by tc:assist-changed event from ChatRoomView),
          falling back to the static chat_room_data from the last ticket fetch. */}
      {(() => {
        // Helper: resolve current assist_status for a ticket using live roomAssistMap first
        const getRoomAssist = (tk: TicketEntry): boolean | undefined => {
          const rid = (tk as any).chat_room_id || tk.chat_room_data?._id;
          if (rid && rid in roomAssistMap) return roomAssistMap[rid];
          return tk.assist_status ?? tk.chat_room_data?.assist_status;
        };
        // Active tab has an admin-mode ticket for this user → hide bar
        const hasActiveAdminTicket = activeTickets.some(t =>
          isSameTicketUser(latest, t) &&
          (getRoomAssist(t) === true || t.chat_status === 'admin')
        );
        // Find a completed ticket for this user where chatroom assist is currently false
        const botTk = completedTickets.find(tk =>
          isSameTicketUser(latest, tk) && getRoomAssist(tk) === false
        );
        const showBotBar = !hasActiveAdminTicket && Boolean(botTk);
        if (!showBotBar) return null;
        return (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setStatusTab('bot');
              if (botTk) openTicket(botTk);
            }}
            className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 dark:bg-amber-950/40 border border-amber-500/40 flex items-center justify-between cursor-pointer hover:bg-amber-500/20 transition-colors shadow-2xs"
          >
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-yellow-200">
              <Zap size={14} className="text-amber-500 fill-amber-500 animate-pulse shrink-0" />
              <span>{t('ticketui.ended.current_chat_in_bot', 'มีแชทปัจจุบันที่ บอทดูแล')}</span>
            </div>
            <span className="text-xs font-bold underline text-amber-800 dark:text-yellow-200 hover:text-amber-900 dark:hover:text-yellow-100">
              {t('ticketui.ended.go_see', 'ไปดู')}
            </span>
          </div>
        );
      })()}
    </div>
  );
};
