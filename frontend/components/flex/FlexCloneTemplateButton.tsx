/**
 * [FEAT-20260907-CLONETEMPLATEBTN] "copy แม่แบบ" — ONE button, used by both views.
 * ===========================================================================
 * Owner, 07/09: the table's ⧉ icon must show its label, and the carousel needs
 * the same action, and — said in as many words — *the button behaves the same on
 * carousel and table, reuse it, do not duplicate*. So this file exists rather
 * than two look-alike `<button>` blocks that drift apart the first time one of
 * them is touched.
 *
 * WHAT IT DOES: opens the flex form in CLONE mode
 * (`pages/content/FlexMessageList.tsx#openClone`), where saving calls
 * `createFlexMessage` — a NEW card, the original untouched. The label says
 * "แม่แบบ" (template) for exactly that reason: you are copying a template, not
 * editing the card you clicked.
 *
 * 🔴 IT DOES NOT POSITION ITSELF. No `ml-auto`, no `justify-*`, no margin. In the
 *    table it is one of four icon buttons in a right-aligned cluster; in the
 *    carousel footer it is pushed to the far right AWAY from the tag's Copy
 *    button. Those are different jobs and they belong to the two parents. A
 *    component that aligned itself would be wrong in one of the two places, and
 *    the owner flagged this specifically. ตำแหน่งเป็นหน้าที่ของพ่อ ไม่ใช่ของปุ่ม.
 *
 * 🔴 SCALE IS A PROP, NOT A COPY OF THE FILE. The table row is a strip of 16px
 *    icon buttons; the carousel footer sits next to a 12px Copy chip. Same
 *    component, two sizes — also flagged by the owner as a thing that is NOT the
 *    same between the two views. ขนาดต่างกันจริง เลยเป็น prop ไม่ใช่ก๊อปไฟล์.
 *
 * ⚠️ `type="button"`. The flex page renders its filter bar as a real <form>; a
 *    default-type button inside it submits and reloads the list.
 *
 * revert: delete this file and put the bare icon <button> back at
 * `FlexMessageList.tsx` (clone column) and drop the carousel's `onCloneCard`.
 */
import React from 'react';
import { Copy } from 'lucide-react';

import { useI18n } from '../../i18n';

export type FlexCloneButtonSize = 'sm' | 'md';

/**
 * The two scales, side by side so the difference is readable in one place.
 * `md` reproduces the table's existing icon-button geometry exactly — it was an
 * icon-only button before today and only gained a label, so nothing else about
 * that row may shift.
 */
const SIZES: Record<FlexCloneButtonSize, { icon: number; cls: string }> = {
  sm: {
    icon: 12,
    cls: 'gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-emerald-600 shadow-sm hover:bg-emerald-50',
  },
  md: {
    icon: 16,
    cls: 'gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:bg-emerald-500/20 hover:text-emerald-500',
  },
};

export interface FlexCloneTemplateButtonProps {
  readonly onClick: () => void;
  readonly size?: FlexCloneButtonSize;
  /** Positioning belongs to the PARENT — see the note above. */
  readonly className?: string;
}

export const FlexCloneTemplateButton: React.FC<FlexCloneTemplateButtonProps> = ({
  onClick,
  size = 'md',
  className = '',
}) => {
  const { t } = useI18n();
  const s = SIZES[size];

  return (
    <button
      type="button"
      data-testid="flex-clone-template"
      onClick={onClick}
      title={t('flex.clone_template')}
      aria-label={t('flex.clone_template')}
      className={`inline-flex shrink-0 items-center whitespace-nowrap transition-colors ${s.cls} ${className}`}
    >
      <Copy size={s.icon} />
      {t('flex.clone_template')}
    </button>
  );
};

export default FlexCloneTemplateButton;
