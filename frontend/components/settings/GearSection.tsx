/* [FEAT-20260815-GEARFOLD] ⚙️ settings menu — every group is its own folded card
 * ===========================================================================
 * Owner, 15/08: "wrap ทุกเมนูเข้าการ์ดตัวเอง พับไว้ เริ่มจากขนาดตัวอักษร"
 *               "default พับ มี arrow ชัดเจน"
 *
 * The gear dropdown had grown to five stacked groups (font size, main menu,
 * font, group display, other settings) rendered open all at once — roughly
 * 1,400px of content inside a 320px-wide popover, so everything below the fold
 * needed scrolling and nothing was scannable.
 *
 * This wraps each group in ONE reusable card:
 *
 *   folded  :  [▸] ขนาดตัวอักษร
 *   expanded:  [▾] ขนาดตัวอักษร
 *              └─ (the group's own controls, untouched)
 *
 * ⚠️ PRESENTATION ONLY. No control, handler, value or option order inside any
 *    group changes — each caller passes its existing markup verbatim as
 *    `children`. Folding is a wrapper, never a rewrite of what it wraps.
 *
 * ⚠️ Lives in its own file because `App.tsx` (1,311 lines) is on the eslint
 *    max-lines waiver and MAY NOT GROW (skill dev-local §6.1). The waiver list
 *    is allowed to shrink, never to gain a line.
 *
 * State is local and per-card: opening one leaves the others alone, which is
 * what "พับไว้" asks for — a folded menu that stays folded until touched.
 * Nothing is persisted; every open of the gear starts folded again, so the
 * menu always presents the same short list.
 *
 * revert: delete this file and inline the children back into their callers
 *         (App.tsx settings dropdown, TicketChat.tsx #tc-gear-slot portal).
 */
import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n';

interface Props {
  /** Group heading, e.g. "ขนาดตัวอักษร" — already translated by the caller. */
  title: string;
  /**
   * Short read-only summary of the current choice, shown on the folded row so
   * the setting is legible WITHOUT expanding (e.g. "ปกติ", "Gemini").
   * Optional: groups that are a single action button have nothing to summarise.
   */
  value?: string;
  /** Optional leading icon, matching whatever the group already displayed. */
  icon?: React.ReactNode;
  /** The group's existing controls, passed through untouched. */
  children: React.ReactNode;
}

export const GearSection: React.FC<Props> = ({ title, value, icon, children }) => {
  // เจ้าของสั่ง: default พับ — every card starts closed, every time.
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border-t border-slate-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
        title={open ? t('pageui.common.gear_fold', 'พับ {title}', { title }) : t('pageui.common.gear_open', 'เปิด {title}', { title })}
      >
        {/* arrow ชัดเจน — เจ้าของสั่ง: bigger than the 12-14px used elsewhere,
            in slate-500 rather than a faint grey, and it carries a tinted round
            plate so it reads as the control that opens the card. */}
        <span
          className={`shrink-0 w-6 h-6 grid place-items-center rounded-lg transition-colors ${
            open ? 'bg-primary-50 text-primary-600' : 'bg-slate-100 text-slate-500'
          }`}
        >
          <Chevron size={16} strokeWidth={2.5} />
        </span>
        {icon && <span className="shrink-0 inline-flex items-center">{icon}</span>}
        <span
          className={`flex-1 min-w-0 text-xs font-bold uppercase tracking-wide truncate ${
            open ? 'text-primary-600' : 'text-slate-500'
          }`}
        >
          {title}
        </span>
        {/* current choice stays visible while folded, so the menu is readable
            without opening anything — folding must not hide what is selected */}
        {value && !open && (
          <span className="shrink-0 max-w-[45%] truncate text-[11px] font-semibold text-slate-400">
            {value}
          </span>
        )}
      </button>
      {open && <div className="px-1 pb-2">{children}</div>}
    </div>
  );
};

/**
 * Which font-size label matches the current scale — the summary the font-size
 * card shows while folded.
 *
 * Lives here rather than in `App.tsx` because that file is on the max-lines
 * waiver and may not grow (skill dev-local §6.1). The caller passes its own
 * translator so this stays free of the i18n hook.
 *
 * Scales are compared with a tolerance, matching how the buttons themselves
 * decide which one is active (`Math.abs(fontScale - opt.v) < 0.001`) — the
 * stored value is a float and `===` would miss it.
 */
export const fontScaleLabel = (
  scale: number | null | undefined,
  t: (key: string) => string,
): string => {
  const s = scale || 1;
  if (Math.abs(s - 0.9) < 0.001) return t('app.font_small');
  if (Math.abs(s - 1.1) < 0.001) return t('app.font_large');
  if (Math.abs(s - 1.2) < 0.001) return t('app.font_xlarge');
  return t('app.font_normal');
};

/**
 * Which font-mode label is active — the summary on the folded "ฟอนต์" card.
 * Same reason as above for living here rather than in `App.tsx`.
 * 'default' is the fallback for an unset/unknown value, matching the option
 * list's own first entry.
 */
export const fontModeLabel = (
  mode: string | null | undefined,
  t: (key: string) => string,
): string =>
  mode === 'chat'
    ? t('app.font_chat')
    : mode === 'all'
      ? t('app.font_all')
      : t('app.font_default');
