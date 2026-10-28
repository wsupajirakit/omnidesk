/**
 * ==== [UI-20260814-INSIGHTHOOKTABS] Insight report — OA (hook) tab strip ====
 *
 * Owner, 14/08: "if the hook (oa) tabs run past 60% of the width, cut the tail
 * into a searchable select box · remove the 'All' option entirely · default to
 * the first hook alphabetically, and if there is none, don't break — just null."
 * Same day, follow-up: "exceed — make it 75%" (see INLINE_WIDTH_RATIO).
 *
 * WHAT IT DOES
 *   Renders hook tabs inline while they fit inside INLINE_WIDTH_RATIO of the width;
 *   everything past that point collapses into one "+N" trigger that opens a
 *   searchable dropdown. Picking from the dropdown selects that hook.
 *
 * WHY MEASURED, NOT COUNTED
 *   OA names have no length limit (`alias || line_oa_name`), so a fixed "show 3
 *   tabs" rule would overflow on long names and waste space on short ones. The
 *   threshold the owner asked for is a WIDTH, so it is measured as one.
 *
 * WHY ITS OWN FILE
 *   FE anti-bloat rule §6.1 — self-contained new UI starts in its own file, and
 *   InsightReport.tsx is already 1960 lines (over the 400-line ratchet).
 *
 * ⚠️ NO "ALL" TAB. The owner removed it deliberately. A hook is always selected,
 *    so `line_oa_hook_id` is never sent as undefined from this strip any more.
 *    The only empty case left is "this account has zero active hooks", which
 *    renders nothing at all rather than falling back to an all-channels view.
 *
 * revert: restore the inline `{/* OA Tabs *\/}` block in InsightReport.tsx from
 *         git history (it carried the All button + an updated_at sort), drop this
 *         file, and revert the default-hook pick in `fetchMetadata`.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { HookData } from '../../types';
import { useI18n } from '../../i18n';

/** Portion of the strip width the inline tabs may occupy before collapsing.
 *  Owner tuned this live on 14/08: 60% → 75% → 80%. Raising it lets more tabs
 *  stay inline before anything is pushed into the dropdown. */
const INLINE_WIDTH_RATIO = 0.8;

/** The label a hook shows on its tab — same expression the old inline JSX used. */
export const hookTabLabel = (h: HookData): string =>
  (h as unknown as { alias?: string }).alias || h.line_oa_name || '';

/**
 * Alphabetical by visible label, so the tab order matches what the eye reads.
 * `localeCompare` with 'th' keeps Thai names in dictionary order rather than
 * code-point order (which would scatter them).
 */
export const sortHooksAlphabetically = (hooks: HookData[]): HookData[] =>
  [...hooks].sort((a, b) =>
    hookTabLabel(a).localeCompare(hookTabLabel(b), 'th', { sensitivity: 'base' }),
  );

/**
 * The hook selected when the page opens: first alphabetically, or `null` when
 * there is none.
 *
 * ⚠️ Returns null — NOT '' — on an empty list. '' used to mean "All channels",
 *    and with the All tab gone that meaning is dead; keeping '' would silently
 *    re-enable an all-channels query the owner asked us to remove.
 */
export const pickDefaultHookId = (hooks: HookData[]): string | null => {
  const sorted = sortHooksAlphabetically(hooks || []);
  return sorted.length > 0 ? sorted[0]!._id : null;
};

interface Props {
  hooks: HookData[];
  value: string | null;
  onChange: (hookId: string) => void;
  /** Placeholder text for the dropdown's search box (locale-aware from parent). */
  searchPlaceholder?: string;
}

export const HookTabsOverflow: React.FC<Props> = ({
  hooks,
  value,
  onChange,
  searchPlaceholder = 'ค้นหา OA...',
}) => {
  const { t } = useI18n();
  const sorted = useMemo(() => sortHooksAlphabetically(hooks), [hooks]);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [inlineCount, setInlineCount] = useState(sorted.length);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  /* Measure off-screen copies of every tab, then take as many as fit the budget.
     useLayoutEffect so the first paint already shows the settled split — with
     useEffect the user sees every tab flash before the tail collapses. */
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const measure = measureRef.current;
    if (!strip || !measure) return;

    const recompute = () => {
      const budget = strip.clientWidth * INLINE_WIDTH_RATIO;
      if (budget <= 0) return; // hidden/unmounted — keep the previous split
      let used = 0;
      let n = 0;
      for (const el of Array.from(measure.children) as HTMLElement[]) {
        used += el.offsetWidth;
        if (used > budget) break;
        n += 1;
      }
      /* At least one tab always stays inline. With a very narrow strip or one
         very long name the loop can yield 0, which would leave the row looking
         empty next to a lone "+N" button. */
      setInlineCount(Math.max(1, Math.min(n, sorted.length)));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [sorted]);

  // Close the dropdown on an outside click — same pattern as SearchableSelect.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (sorted.length === 0) return null; // no active hooks — render nothing, never crash

  const inline = sorted.slice(0, inlineCount);
  const overflow = sorted.slice(inlineCount);
  const overflowSelected = overflow.find(h => h._id === value) || null;
  const filtered = q.trim()
    ? overflow.filter(h => hookTabLabel(h).toLowerCase().includes(q.trim().toLowerCase()))
    : overflow;

  const tabClass = (on: boolean) =>
    `px-6 py-3 font-bold text-sm transition-all focus:outline-none whitespace-nowrap ${
      on
        ? 'bg-white text-emerald-600 border-t-4 border-emerald-500 shadow-sm'
        : 'text-slate-500 hover:bg-slate-50'
    }`;

  return (
    <div
      ref={stripRef}
      className="relative flex bg-slate-100 border-b border-slate-200 rounded-t-xl shadow-sm"
    >
      {/* Hidden measuring row: same font/padding as a real tab so offsetWidth is
          the true rendered width. aria-hidden so it is invisible to a screen
          reader, and pointer-events-none so it can never take a click. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute -top-[9999px] left-0 flex pointer-events-none invisible"
      >
        {sorted.map(h => (
          <span key={h._id} className={tabClass(false)}>
            {hookTabLabel(h)}
          </span>
        ))}
      </div>

      {inline.map(h => (
        <button
          key={h._id}
          type="button"
          onClick={() => onChange(h._id)}
          className={tabClass(value === h._id)}
        >
          {hookTabLabel(h)}
        </button>
      ))}

      {overflow.length > 0 && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            /* Highlighted when the CURRENT selection lives inside the overflow —
               otherwise a hook could be selected with nothing on screen showing it. */
            className={`${tabClass(!!overflowSelected)} flex items-center gap-1.5`}
            title={overflowSelected ? hookTabLabel(overflowSelected) : undefined}
          >
            <span className="truncate max-w-[160px]">
              {overflowSelected ? hookTabLabel(overflowSelected) : `+${overflow.length}`}
            </span>
            <ChevronDown
              size={14}
              className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <div className="absolute z-50 right-0 mt-1 w-[240px] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden flex flex-col max-h-[min(360px,60vh)]">
              <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-200 shrink-0">
                <Search size={13} className="shrink-0 opacity-60" />
                <input
                  autoFocus
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full bg-transparent border-none outline-none text-sm placeholder:opacity-50"
                />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto py-1">
                {filtered.length ? (
                  filtered.map(h => (
                    <button
                      key={h._id}
                      type="button"
                      onClick={() => {
                        onChange(h._id);
                        setOpen(false);
                        setQ('');
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-slate-50 ${
                        h._id === value ? 'text-emerald-600 font-bold' : 'text-slate-700'
                      }`}
                    >
                      <Check
                        size={13}
                        className={`shrink-0 ${h._id === value ? 'opacity-100' : 'opacity-0'}`}
                      />
                      <span className="truncate flex-1">{hookTabLabel(h)}</span>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-2 text-sm opacity-50">{t('pageui.insight.no_match', 'ไม่พบรายการ')}</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HookTabsOverflow;
