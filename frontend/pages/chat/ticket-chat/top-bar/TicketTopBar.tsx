/**
 * [REFACTOR-20261027-TCSPLIT] The top bar contents: gear-slot portal, group switcher (slider tabs with counts, stars and glow, or the select) and back-to-chat.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * The counts and glow flags it draws are computed by the page (realtime) and only READ here.
 * revert: paste the body back where `<TicketTopBar />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { Check, ChevronRight, MessageSquare, Star, Zap } from 'lucide-react';
import { createPortal } from 'react-dom';
import { SearchableSelect } from '../../../../components/member';
import { GearSection } from '../../../../components/settings'; // [FEAT-20260815-GEARFOLD]
import type { TicketEntry } from '../../../../services/chat';
import { showsNewGlow } from '../../../../utils/groupTabGlow';
import { showsNameGlow } from '../../../../utils/groupTabNameGlow';
import type { TFn } from '../types';

export type TicketTopBarProps = {
  ticketOnly: boolean;
  gearSlot: HTMLElement;
  t: TFn;
  groupMode: "slider" | "select";
  setGroupMode: (value: "slider" | "select" | ((prev: "slider" | "select") => "slider" | "select")) => void;
  setQuickReplyModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeGroupId: string;
  selectGroup: (id: string) => void;
  visibleGroups: { _id: string; group_name: string; }[];
  sliderWrapRef: React.RefObject<HTMLDivElement>;
  inlineGroups: { _id: string; group_name: string; }[];
  activeTickets: TicketEntry[];
  groupCounts: Record<string, number>;
  isFaved: (id: string) => boolean;
  groupHasNew: Record<string, boolean>;
  requestFavToggle: (id: string, name: string) => void;
  overflowGroups: { _id: string; group_name: string; }[];
  setPromotedId: React.Dispatch<React.SetStateAction<string>>;
  measureRef: React.RefObject<HTMLDivElement>;
  orderedGroups: { _id: string; group_name: string; }[];
  statusInner: React.JSX.Element;
  selectedTicket: TicketEntry;
  leftOpen: boolean;
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export const TicketTopBar: React.FC<TicketTopBarProps> = ({
  ticketOnly,
  gearSlot,
  t,
  groupMode,
  setGroupMode,
  setQuickReplyModalOpen,
  activeGroupId,
  selectGroup,
  visibleGroups,
  sliderWrapRef,
  inlineGroups,
  activeTickets,
  groupCounts,
  isFaved,
  groupHasNew,
  requestFavToggle,
  overflowGroups,
  setPromotedId,
  measureRef,
  orderedGroups,
  statusInner,
  selectedTicket,
  leftOpen,
  setLeftOpen,
}) => (
    <>
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* "Ticket" label only when NOT ticket-only (their whole app is this bar) */}
        {!ticketOnly && <span className="font-bold text-sm shrink-0">Ticket</span>}

        {/* settings — pick how the group switcher is shown */}
        {/* Group-display + Quick Reply controls now live in the app's ⚙️ gear
            (next to the theme switch). We portal them into #tc-gear-slot so
            there's a single settings gear. The old in-page gear button is gone. */}
        {/* [FEAT-20260815-GEARFOLD] both portalled groups fold like the ones
            App.tsx owns — the gear is one list of folded cards, no matter
            which file renders each card. */}
        {gearSlot && createPortal(
          <>
          <GearSection
            title={t('ticketui.gear.group_display', 'การแสดงกลุ่ม')}
            value={groupMode === 'select' ? t('ticketui.gear.mode_select', 'เลือกจากรายการ') : t('ticketui.gear.mode_slider', 'แถบเลื่อน')}
          >
            {([
              { key: 'slider', label: t('ticketui.gear.slider_label', 'แถบเลื่อน (Slider)'), desc: t('ticketui.gear.slider_desc', 'แสดงทุกกลุ่มเป็นแถบเลื่อน') },
              { key: 'select', label: t('ticketui.gear.select_label', 'เลือกจากรายการ (Select)'), desc: t('ticketui.gear.select_desc', 'ดรอปดาวน์เลือกกลุ่ม') },
            ] as const).map(opt => (
              <button
                key={opt.key}
                onClick={() => { setGroupMode(opt.key); }}
                className={`w-full flex items-start gap-2 px-2 py-2 rounded-lg text-left transition-colors ${groupMode === opt.key ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              >
                <span className={`mt-0.5 shrink-0 ${groupMode === opt.key ? 'text-primary' : 'text-transparent'}`}><Check size={14} /></span>
                <span className="min-w-0">
                  <span className={`block text-xs font-bold ${groupMode === opt.key ? 'text-primary' : 'text-gray-700'}`}>{opt.label}</span>
                  <span className="block text-[10px] text-gray-400">{opt.desc}</span>
                </span>
              </button>
            ))}
          </GearSection>
          {/* no `value` — a single action button has no state to summarise */}
          <GearSection title={t('ticketui.gear.other_settings', 'ตั้งค่าอื่นๆ')}>
            <button
              onClick={() => { setQuickReplyModalOpen(true); }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors"
            >
              <Zap size={14} className="text-yellow-500 shrink-0" />
              <span className="text-xs font-bold text-gray-700">{t('ticketui.gear.manage_quick_reply', 'จัดการ Quick Reply')}</span>
            </button>
          </GearSection>
          </>,
          gearSlot
        )}

        {/* group switcher — slider strip or select dropdown */}
        {groupMode === 'select' ? (
          <SearchableSelect
            value={activeGroupId || ''}
            onChange={selectGroup}
            placeholder={t('ticketui.group.select', 'เลือกกลุ่ม')}
            searchPlaceholder={t('ticketui.group.search', 'ค้นหากลุ่ม...')}
            className="ml-1 w-[220px]"
            options={visibleGroups.map(g => ({ value: g._id, label: g.group_name }))}
          />
        ) : (
          <>
          {/* responsive fallback: slider is hidden below md, so force a
              searchable selector there — group tabs must never just vanish */}
          <SearchableSelect
            value={activeGroupId || ''}
            onChange={selectGroup}
            placeholder={t('ticketui.group.select', 'เลือกกลุ่ม')}
            searchPlaceholder={t('ticketui.group.search', 'ค้นหากลุ่ม...')}
            className="md:hidden ml-1 w-[220px]"
            options={visibleGroups.map(g => ({ value: g._id, label: g.group_name }))}
          />
          {/* [FIX-20260731-OATABS] เดิม gap-1.5 = แท็บลอยแยกกันเป็นเม็ดๆ
              ผู้ใช้สั่งให้ "เอาแท็บติดกัน" ตามไฟล์ต้นแบบ (gap-1 · เต็มความสูง)
              ⚠️ งานหน้าตาล้วน — count / realtime / ดาว fav / ตัวไหน active
              ใช้ตัวแปรและเงื่อนไขเดิมทุกตัว ไม่ได้แตะ logic สักบรรทัด
              revert: กลับเป็น gap-1.5 (และคืน class ปุ่มด้านล่าง) */}
          <div ref={sliderWrapRef} className="hidden md:flex items-stretch ml-1 min-w-0 flex-1 self-stretch">
            {/* visible tabs — only those that fit in 70% of the strip */}
            {inlineGroups.map(g => {
              const on = activeGroupId === g._id;
              // Active group uses the precise LIVE count (activeTickets); other
              // tabs use the fetched per-group total so they're never a stale 0.
              // Every tab shows "รอรับ" (job_status 0). Active tab counts from the
              // live activeTickets so it stays realtime; others use groupCounts
              // (which now holds the waiting count from meta).
              const c = on ? activeTickets.filter(tk => Number(tk.job_status) === 0).length : (groupCounts[g._id] ?? 0);
              const faved = isFaved(g._id);
              // [FIX-20260808-ACTIVETAB-NOTIFY] show the yellow "new" badge even on the ACTIVE
              // group tab (was `&& !on`, which suppressed it for the very tab you are on).
              // Clears when the admin (re)clicks the group tab — selectGroup() resets the flag.
              // [FIX-20260829-ORANGENEEDSCOUNT] the flag alone used to decide, so a group
              // whose count had fallen to 0 kept pulsing. `c` is the very number
              // drawn in the badge, so the ring and the digit can no longer disagree.
              const hasNew = showsNewGlow(!!groupHasNew[g._id], c);
              // [FEAT-20260903-TABNAMEGLOW] a message landing in this group's
              // กำลังคุย lit nothing here: `c` counts รอรับเคส (job_status 0)
              // only, so `hasNew` above stays false while the queue is empty.
              // The NAME carries that signal instead.
              // ⚠️ READ-ONLY over the badge — `c` and the badge span below are
              //    untouched; this line only adds a second answer.
              const nameGlow = showsNameGlow(!!groupHasNew[g._id], c);
              return (
                <button
                  key={g._id}
                  onClick={() => selectGroup(g._id)}
                  // [FIX-20260731-OATABS] แท็บติดกันแบบต้นแบบ: เต็มความสูง +
                  // ขีดใต้ตัวที่เลือก แทนเม็ดกลมลอยๆ · หน้าตาล้วน ไม่แตะเงื่อนไข
                  //
                  // สีต้องแยกตามพื้นหลังของแถบที่มันไปเกาะ:
                  //   ticketOnly → portal เข้า header สีเข้ม  = ชุดสีต้นแบบ
                  //   ปกติ       → แถบของหน้านี้เองพื้นขาว    = ชุดสีเข้ม
                  // (ต้นแบบมีแต่แบบแถบเข้ม ถ้าใช้ text-slate-300 บนพื้นขาวจะอ่านไม่ออก)
                  // ==== [FIX-20260801-OATABMATCH] ยกชุด class ของแท็บ panel ขวา
                  // ("ข้อมูลส่วนตัว / ดำเนินการ") มาทั้งดุ้นตามที่ผู้ใช้สั่งให้เหมือนเป๊ะ:
                  //   border-b-2 · active = text-primary + border-primary + bg-white
                  //   idle = text-gray-500 + border-transparent + hover เทาอ่อน
                  // และตัด gap ที่ตัวครอบออก → แท็บชิดกัน ขีดใต้ไปเกาะขอบล่าง
                  // ไม่ลอยเป็นเม็ดๆ อีก (เดิมเป็น bg-blue-50 + gap-1)
                  //
                  // ⚠️ ticketOnly ยัง portal ไปเกาะ header **พื้นเข้ม** — ใช้ชุดสี
                  //    ของ panel ตรงๆ จะอ่านไม่ออก จึงคงชุดสีสว่างไว้เฉพาะโหมดนั้น
                  //    (รูปทรง/ระยะ/ขีดใต้ ใช้ชุดเดียวกันหมดแล้ว)
                  // ⚠️ หน้าตาล้วน — count / realtime / ดาว fav / ตัวไหน active
                  //    ใช้ตัวแปรและเงื่อนไขเดิมทุกตัว ไม่ได้แตะ logic สักบรรทัด
                  // revert: เอาบล็อก class เดิม (gap-1 + bg-blue-50) กลับมา
                  className={`group shrink-0 flex items-center gap-1.5 self-stretch ${(on || faved) ? 'pl-2' : 'pl-3'} pr-3 py-3 border-b-2 text-sm font-bold transition-colors ${
                    ticketOnly
                      // ⚠️ ผู้ใช้สั่ง "ยกเว้นสี เอาเหมือนเดิม" — คืนชุดสีเดิมของโหมดนี้
                      // เปลี่ยนแค่รูปทรง/ระยะ/ตำแหน่งขีดใต้เท่านั้น
                      ? (on
                          ? 'border-blue-400 text-white bg-white/10'
                          : 'border-transparent text-slate-300 hover:text-white hover:bg-white/5')
                      : (on
                          ? 'text-primary border-primary bg-white'
                          : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100')
                  }`}
                  title={g.group_name}
                >
                  {/* [FEAT-20260729-FAVGATE] ติดดาวได้เฉพาะ tab ที่ active อยู่
                      (star to ADD shows on the active tab only) — but a star
                      already given can be REMOVED from any tab, any time.
                      unfaved+inactive → no star at all. revert: render span เสมอ */}
                  {(on || faved) && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); requestFavToggle(g._id, g.group_name); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); requestFavToggle(g._id, g.group_name); } }}
                    title={faved ? t('ticket.fav.unfav') : t('ticket.fav.fav')}
                    className="shrink-0 -my-1 p-0.5 rounded-full hover:bg-black/10 transition-colors"
                  >
                    {/* [FIX-20260731-OATABS] ดาวที่ "ยังไม่ติด" เดิมเป็น text-white/70
                        ซึ่งจมหายบนแถบขาวของโหมดปกติ — แยกสีตามพื้นหลังเหมือนตัวปุ่ม
                        เงื่อนไข faved / การกดติดดาว ไม่ได้แก้ */}
                    <Star size={13} className={faved ? 'fill-yellow-400 text-yellow-400' : (ticketOnly ? 'text-white/70' : 'text-gray-400')} />
                  </span>
                  )}
                  {/* [FEAT-20260903-TABNAMEGLOW] `tc-unread-text` is the TEXT
                      half of the same colour pair the badge uses
                      (`index.html:776,779` — amber-700 light / #fde047 dark),
                      so the name speaks in the badge's colour without
                      borrowing the badge's pill. No new CSS was added.
                      ⚠️ The span exists only to carry the colour; when there is
                         nothing new it renders no class at all, so the tab is
                         byte-identical to before in the common case. */}
                  <span className={nameGlow ? 'tc-unread-text' : undefined}>{g.group_name}</span>
                  {/* [FIX-20260731-OATABS] สีป้ายนับให้เข้ากับแท็บบนแถบเข้ม
                      ค่า `c` และเงื่อนไข hasNew เหมือนเดิมเป๊ะ (realtime คงเดิม) */}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none ${
                    hasNew
                      ? 'tc-unread-badge'
                      : on
                        ? 'bg-blue-500 text-white'
                        // [FIX-20260731-OATABDARK] ป้ายนับของแท็บที่ไม่ active
                        // ในโหมดปกติ + ธีม dark ก็ต้องอ่านออกด้วย
                        : (ticketOnly ? 'bg-slate-700 text-slate-200' : 'bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-slate-200')
                  }`}>{c}</span>
                </button>
              );
            })}
            {/* overflow (>70%) — the rest drop into a searchable dropdown; picking
                one promotes it to the front (and active). The trailing number is
                the SUM of active tickets across the hidden groups (0 → hidden),
                not the group count. Yellow ring if any hidden group has new. */}
            {overflowGroups.length > 0 && (() => {
              const overflowTotal = overflowGroups.reduce((sum, g) => sum + (groupCounts[g._id] ?? 0), 0);
              // [FIX-20260829-ORANGENEEDSCOUNT] a hidden group only lights the trigger while
              // it still has something to show — same rule as the visible tabs.
              const overflowHasNew = overflowGroups.some(g => showsNewGlow(!!groupHasNew[g._id] && g._id !== activeGroupId, groupCounts[g._id]));
              /* [FEAT-20260903-TABNAMEGLOW] same question for the NAME. A
                 collapsed group whose queue is empty never lights the ring
                 above (that rule needs a count), so without this the operator
                 sees nothing at all when one of them receives a message. */
              const overflowNameGlow = overflowGroups.some(g => showsNameGlow(!!groupHasNew[g._id] && g._id !== activeGroupId, groupCounts[g._id]));
              return (
                <SearchableSelect
                  value=""
                  onChange={(id) => { setPromotedId(id); selectGroup(id); }}
                  placeholder={overflowTotal > 0 ? t('ticketui.group.more_count', 'อื่นๆ ({n})', { n: overflowTotal }) : t('ticketui.group.more', 'อื่นๆ')}
                  searchPlaceholder={t('ticketui.group.search', 'ค้นหากลุ่ม...')}
                  // [FIX-20260801-OATABMATCH] ตัวครอบแท็บเป็น items-stretch (ทำไว้ให้
                  // ขีดใต้ของแท็บชนขอบล่าง) → กล่องนี้เลยถูกยืดเต็มความสูงแล้วปุ่ม
                  // ไปเกาะขอบบน ดูลอยไม่เข้าพวก · self-center ดึงกลับมากลางแนวตั้ง
                  className={`shrink-0 self-center w-[150px] ${overflowHasNew ? 'tc-select-new' : ''}`}
                  triggerNameGlow={overflowNameGlow}
                  options={overflowGroups.map(g => ({ value: g._id, label: g.group_name, count: groupCounts[g._id] ?? 0, isNew: showsNewGlow(!!groupHasNew[g._id] && g._id !== activeGroupId, groupCounts[g._id]), isNameGlow: showsNameGlow(!!groupHasNew[g._id] && g._id !== activeGroupId, groupCounts[g._id]) }))}
                  isFav={isFaved}
                  onToggleFav={requestFavToggle}
                />
              );
            })()}
            {/* hidden measurement copy — full list, used to decide how many fit */}
            {/* [FIX-20260731-OATABS] สำเนาไว้วัดความกว้างต้องใช้ gap/padding ชุด
                เดียวกับปุ่มจริง ไม่งั้นจำนวนแท็บที่ "พอดี" จะคลาดเคลื่อน
                (ตัวเลขเกณฑ์ 70% และวิธีคำนวณไม่ได้แก้) */}
            {/* [FIX-20260801-OATABMATCH] ⚠️ ตัววัดต้องมีขนาด/ระยะ **เท่าปุ่มจริงเป๊ะ**
                ไม่งั้นการคำนวณว่า "กี่แท็บถึงจะพอดีแถบ" จะเพี้ยนแล้วแท็บล้น/หายผิดตัว
                ต้องแก้คู่กับ class ของปุ่มเสมอ (ตอนนี้: ไม่มี gap · text-sm · py-3) */}
            <div ref={measureRef} className="absolute -left-[9999px] top-0 flex items-center pointer-events-none" aria-hidden="true">
              {orderedGroups.map(g => (
                <span key={g._id} className="shrink-0 pl-2 pr-3 py-3 text-sm font-bold border-b-2 inline-flex items-center gap-1.5">
                  <span className="shrink-0 p-0.5"><Star size={13} /></span>
                  {g.group_name}
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">00</span>
                </span>
              ))}
            </div>
          </div>
          </>
        )}
      </div>
      {/* status: rendered inline (non-ticket-only) here; for ticket-only it's
          portaled separately into #tc-header-status-slot (see below) so it never
          eats the OA switcher's width. */}
      {!ticketOnly && statusInner}
      {/* Back-to-chat — mobile only (<lg), pinned to the far right of the bar.
          Shown when a chat is already open underneath but the list is on top
          (leftOpen). Returns to that chat. lg+ has the chat always visible.
          Applies to both normal and ticketOnly. */}
      {selectedTicket && leftOpen && (
        <button
          type="button"
          onClick={() => setLeftOpen(false)}
          className="lg:hidden ml-auto shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-200 bg-white/80 text-gray-600 text-xs font-bold shadow-sm hover:bg-white hover:text-primary active:scale-95 transition-all"
          title={t('ticket.backToChat')}
          aria-label={t('ticket.backToChat')}
        >
          <MessageSquare size={15} />
          <ChevronRight size={16} />
        </button>
      )}
    </>
);
