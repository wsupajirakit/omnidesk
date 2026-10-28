/**
 * [REFACTOR-20261027-TCSPLIT] The list column's search box, ⚙️ date-scope popover and the OA / category / tag / tier filters.
 * Moved out of `pages/chat/TicketChat.tsx` verbatim. Markup only: every value and setter
 * arrives as a prop, the state stays in the page, and nothing here touches the realtime
 * path (WS handler, list fetches, counts, notices, case actions).
 * The filter VALUES and what they do to the list (fetch params, predicates, counts) stay in the page.
 * revert: paste the body back where `<ListFilters />` is rendered in TicketChat.tsx, delete this file.
 */
import React from 'react';
import { Check, Search, Settings } from 'lucide-react';
import { SearchableSelect } from '../../../../components/member';
import type { HookData } from '../../../../types';
// [FEAT-20260816-TAGSHOW] options for the 🏷 filter dropdown — see the helper's header
import { buildTagFilterOptions } from '../../ticketTagFilterOptions';
import { CATEGORY_LABEL_KEY, type CategoryOption, DATE_SCOPE_OPTIONS, SHOW_DATE_SCOPE } from '../constants';
import type { TFn, TLocale } from '../types';

export type ListFiltersProps = {
  dateScopeRef: React.RefObject<HTMLDivElement>;
  setDateScopeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  t: TFn;
  dateScopeLabel: string;
  isDateScopeActive: boolean;
  dateScopeOpen: boolean;
  setFilterWithinDays: React.Dispatch<React.SetStateAction<string>>;
  filterWithinDays: string;
  searchPhone: string;
  setSearchPhone: React.Dispatch<React.SetStateAction<string>>;
  locale: TLocale;
  activeSearchLimited: boolean;
  completedSearchLimited: boolean;
  serverSearch: string;
  filterOa: string;
  setFilterOa: React.Dispatch<React.SetStateAction<string>>;
  hooks: HookData[];
  activeGroupHookIds: Set<string>;
  providerCats: string[];
  filterCategory: string;
  setFilterCategory: React.Dispatch<React.SetStateAction<string>>;
  categoryOptions: CategoryOption[];
  filterTag: string;
  setFilterTag: React.Dispatch<React.SetStateAction<string>>;
  filterPopularTags: { _id: string; label: string; color: string | null; }[];
  showTierFilter: boolean;
  filterTier: string;
  setFilterTier: React.Dispatch<React.SetStateAction<string>>;
  tierFilterOptions: { value: string; label: string; }[];
};

export const ListFilters: React.FC<ListFiltersProps> = ({
  dateScopeRef,
  setDateScopeOpen,
  t,
  dateScopeLabel,
  isDateScopeActive,
  dateScopeOpen,
  setFilterWithinDays,
  filterWithinDays,
  searchPhone,
  setSearchPhone,
  locale,
  activeSearchLimited,
  completedSearchLimited,
  serverSearch,
  filterOa,
  setFilterOa,
  hooks,
  activeGroupHookIds,
  providerCats,
  filterCategory,
  setFilterCategory,
  categoryOptions,
  filterTag,
  setFilterTag,
  filterPopularTags,
  showTierFilter,
  filterTier,
  setFilterTier,
  tierFilterOptions,
}) => (
  <>
    {/* search + filters */}
    <div className="p-3 border-b border-gray-100 bg-white space-y-2 shrink-0">
      {/* [FEAT-20260808-DATESCOPE] search + ⚙️ date-scope filter on one row.
          Collapsed = gear ICON only (right in front of the search box); click
          opens a small popover that reveals the label + options. The scope
          filters BOTH the ticket list AND the tab-count badges to the last N
          days; "ทั้งหมด" = today's behavior (no bound, param omitted).
          Popover reuses the tc-select-* styling so it matches the toolbar. */}
      <div className="flex items-center gap-1.5">
        {/* [FEAT-20260819-SHOWALL] HIDDEN, not deleted — owner: "ซ่อนปุ่มนี้เลย
            เราแสดงทั้งหมดแล้ว (hide ไว้นะเผื่อใช้)". Everything below still
            compiles and still works; flip SHOW_DATE_SCOPE to true and the
            picker comes back exactly as it was, with its state, its popover
            and its outside-click handler untouched.
            เปิดใช้ใหม่ = แก้ค่าเดียว.
            [FIX-20260902-DATESCOPEDEFAULT] It IS back, and the default moved
            with it: the picker opens on 7 วัน and shows that row ticked. */}
        {SHOW_DATE_SCOPE && (
        <div ref={dateScopeRef} className="tc-select relative shrink-0">
          <button
            type="button"
            onClick={() => setDateScopeOpen(o => !o)}
            title={t('ticketui.datescope.title_value', 'ช่วงเวลา: {v}', { v: dateScopeLabel })}
            aria-label={t('ticketui.datescope.title_value', 'ช่วงเวลา: {v}', { v: dateScopeLabel })}
            className={`tc-select-trigger relative flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${isDateScopeActive ? 'text-primary border-primary' : ''}`}
          >
            <Settings size={16} />
            {/* subtle active dot when a non-default (non-ทั้งหมด? no — non-'2') scope is applied */}
            {isDateScopeActive && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" aria-hidden="true" />
            )}
          </button>
          {dateScopeOpen && (
            <div className="tc-select-menu absolute z-50 mt-1 left-0 w-[168px] rounded-xl border shadow-lg overflow-hidden flex flex-col">
              {/* [FEAT-20260810-DATESCOPE] ขยายฟอนต์ +30% ตามที่เจ้าของสั่ง
                  หัวข้อ 11px → 14px · ตัวเลือก 12px → 16px
                  revert: กลับเป็น text-[11px] และ text-xs */}
              <div className="tc-select-search px-3 py-2 border-b shrink-0 text-[14px] font-bold opacity-70">{t('ticketui.datescope.title', 'ช่วงเวลา')}</div>
              <div className="py-1">
                {DATE_SCOPE_OPTIONS.map(o => (
                  <button
                    key={o.value || 'all'}
                    type="button"
                    onClick={() => { setFilterWithinDays(o.value); setDateScopeOpen(false); }}
                    className={`tc-select-opt w-full flex items-center gap-2 px-3 py-2 text-[16px] text-left transition-colors ${o.value === filterWithinDays ? 'tc-select-opt-active font-bold' : ''}`}
                  >
                    <Check size={13} className={`shrink-0 ${o.value === filterWithinDays ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="truncate flex-1">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        )}
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
            <Search size={14} />
          </span>
          <input
            value={searchPhone}
            onChange={e => setSearchPhone(e.target.value)}
            placeholder={locale === 'en' ? 'Search name / phone / account no. (min 4 chars)' : 'ค้นหาด้วย ชื่อ เบอร์ เลขที่บช (ขั้นต่ำ 4 ตัวอักษร)'}
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      {/* [FEAT-20260826-SEARCHLIMITNOTE] only a capped server search mode
          can set these — invisible while the legacy mode ships */}
      {(activeSearchLimited || completedSearchLimited) && serverSearch && (
        <div className="text-[10px] text-amber-600 mt-1 pl-1">
          {t('ticketui.search.limited', 'ผลค้นหาแสดงบางส่วน (ชนเพดานฝั่งเซิร์ฟเวอร์) — พิมพ์คำค้นให้เจาะจงขึ้น')}
        </div>
      )}
      {/* [FIX-20260731-FILTERROW] เดิม grid-cols-2 = ตัวกรอง 4 ตัวเรียง 2 แถว
          ผู้ใช้สั่งให้ตัด Tier ออกแล้วยก 3 ตัวที่เหลือมาอยู่แถวเดียวกัน
          revert: กลับเป็น grid-cols-2 แล้วเอา hidden ออกจากตัวกรอง Tier */}
      <div className="grid grid-cols-3 gap-1.5">
        <SearchableSelect
          value={filterOa}
          onChange={setFilterOa}
          placeholder={t('ticketui.filter.all_oa', 'OA ทั้งหมด')}
          searchPlaceholder={t('ticketui.filter.search_oa', 'ค้นหา OA...')}
          /* [UI-20260814-FILTERMENUFONT] Owner, 14/08: "these three ticket-page
             filters — make the font inside the open dropdown +20% bigger".
             text-xs 12px → 14.4px (exact +20%; text-sm would be 14px, not 20%).
             Affects the open menu only — the closed trigger keeps its size.
             revert: remove this prop from all 3 call sites (OA / tag / Tier). */
          menuTextClass="text-[14.4px]"
          options={[
            { value: '', label: t('ticketui.filter.all_oa', 'OA ทั้งหมด') },
            ...hooks
              .filter(h => !activeGroupHookIds || activeGroupHookIds.has(h._id))
              .map(h => ({ value: h._id, label: h.line_oa_name })),
          ]}
        />
        {/* category filter — หมวดล้วน ไม่ปนกับ tag
            [FIX-20260801-FILTERSWAP] ผู้ใช้สั่ง "panel ซ้ายเอา filter tier กลับมา
            ซ่อนหมวดไป" — สลับกับตัวกรอง Tier ด้านล่าง
            ⚠️ ซ่อนด้วย `hidden` ไม่ใช่ลบทิ้ง (วิธีเดียวกับที่เคยทำกับ tier)
               state `filterCategory` ยังอยู่ครบและยังเป็น '' ตามค่าเริ่มต้น
               → เงื่อนไขกรองที่อ่านค่านี้ (2 จุด) ไม่ทำงานเหมือนตอนไม่ได้เลือก
               ไม่มี logic ไหนต้องแก้ตาม และเปิดกลับมาได้ทันที
            revert: ย้าย `<div className="hidden">` ไปครอบตัวกรอง Tier แทน
            [FEAT-20261019-CATFILTER] owner 19/10/2026: back on screen — but ONLY where the
            customer provider declares ticket categories (loan: 4 · shop-api: none ⇒ still
            `hidden`, markup identical). The one source of truth is that declaration (BE
            `providerTicketCategories` → `useProviderTicketCategories`); no site name is
            checked here. A future provider gets the filter by declaring its categories.
            revert: put back `className="hidden"`. */}
        <div className={providerCats ? '' : 'hidden'}>
        <SearchableSelect
          value={filterCategory}
          onChange={setFilterCategory}
          placeholder={t('ticketui.filter.all_category', 'หมวดทั้งหมด')}
          searchPlaceholder={t('ticketui.filter.search_category', 'ค้นหาหมวด...')}
          align="right"
          options={[
            { value: '', label: t('ticketui.filter.all_category', 'หมวดทั้งหมด') },
            ...categoryOptions.map(o => ({ value: o.label, label: CATEGORY_LABEL_KEY[o.label] ? t(CATEGORY_LABEL_KEY[o.label], o.label) : o.label })),
          ]}
        />
        </div>
        {/* tag filter — แยกต่างหาก (customer tags) ทำงาน AND กับ category */}
        <SearchableSelect
          value={filterTag}
          onChange={setFilterTag}
          placeholder={t('ticketui.filter.all_tags', '🏷 ป้ายทั้งหมด')}
          searchPlaceholder={t('ticketui.filter.search_tags', 'ค้นหาป้าย...')}
          align="right"
          /* [UI-20260814-FILTERMENUFONT] see the rationale on the OA filter above */
          menuTextClass="text-[14.4px]"
          /* [FEAT-20260816-TAGSHOW] Real tags are back in this dropdown —
             supersedes [FIX-20260814-TAGLISTHIDE] (which reduced it to the
             clear-filter option only). Options come from the sibling
             helper `ticketTagFilterOptions.ts` (value = tag id, label via
             thLabel — same rendering the chips use). The BE now truly
             scopes the list by the caller's OA permission
             ([FEAT-20260816-TAGSCOPE] chat.service.ts): superadmin sees
             every in-use tag, other admins only tags in use on their own
             OAs. A page refresh reloads the real list (plus the existing
             `tc:tags-changed` listener). The `filterTag` predicates are
             untouched, as before. */
          options={buildTagFilterOptions(filterPopularTags)}
        />
        {/* tier filter.

            [FIX-20260731-FILTERROW] เคยถูกซ่อนไว้ ("tier ซ่อนไว้พอ")
            [FIX-20260801-FILTERSWAP] ผู้ใช้สั่งเอากลับมา แล้วซ่อน "หมวด" แทน

            🔴 [FIX-20260905-TIERFILTERSTUCK] THIS COMMENT SAID "UI STUB —
            SELECTING A VALUE DOES NOT FILTER THE LIST". THAT IS NO LONGER
            TRUE, and it had become dangerous: `filterTier` now drives the
            ACTIVE row predicate, the COMPLETED row predicate, the
            `hasFilter` count and the server query's `tier:` parameter.
            Anyone trusting the old wording would have concluded that
            hiding this control was free. It is not — see the
            `applyTierSwitches` helper where the state is declared, which
            clears the value when the control is hidden.
            คอมเมนต์เก่าบอกว่ายังไม่กรอง — ตอนนี้กรองจริงแล้ว ห้ามเชื่อของเก่า */}
        {/* [FEAT-20260905-CUSTPROV PART 4] `showTierFilter` hides the
            CONTROL, and `applyTierSwitches` clears the VALUE with it.
            `tierFilterOptions` keeps being derived from the rows already
            loaded (§19: it must stay client-side, it cannot move to
            field-options), and no fetch/sort/count reads this flag —
            they read `filterTier`, which is why clearing it is the part
            that actually restores the byte-identical "no filter" path.
            An earlier revision reasoned that a hidden control simply
            never gets set; that holds for a page loaded with the switch
            already off, and NOT for a page that was open with a tier
            chosen when the switch flipped. */}
        {showTierFilter && (
          <SearchableSelect
            value={filterTier}
            onChange={setFilterTier}
            placeholder={t('ticketui.filter.all_tier', '💎 Tier ทั้งหมด')}
            searchPlaceholder={t('ticketui.filter.search_tier', 'ค้นหา Tier...')}
            align="right"
            /* [UI-20260814-FILTERMENUFONT] see the rationale on the OA filter above */
            menuTextClass="text-[14.4px]"
            options={[
              { value: '', label: t('ticketui.filter.all_tier', '💎 Tier ทั้งหมด') },
              /* [FEAT-20260801-MEMBERTIER] ตัวเลือกมาจาก tier ที่มีอยู่จริงในรายการ
                 ไม่ hardcode ชื่อ tier ของเจ้าไหน (ดูเหตุผลที่ tierKeyOf)
                 เรียงตาม level ก่อน แล้วค่อยตามชื่อ เพื่อให้ลำดับคงที่ */
              ...tierFilterOptions,
            ]}
          />
        )}
        {/* [FIX-20260801-FILTERSWAP] เดิมมี </div> ปิดตัวครอบที่ซ่อน Tier ตรงนี้
            ย้ายไปปิดตัวครอบของ "หมวด" ด้านบนแล้ว */}
      </div>
    </div>
  </>
);
