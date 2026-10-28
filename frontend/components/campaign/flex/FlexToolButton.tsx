/**
 * [FEAT-20260907-FLEXTOOLROW] The one button style the flex field's tools share.
 * ===========================================================================
 * Owner, 07/09: the three controls around the flex picker — "refresh รายการ",
 * "จัดการ flex message" and "ดูตัวอย่าง / refresh การ์ด" — must be **one theme and
 * one size**, sitting together on the label's row. They used to be three
 * different buttons at three different scales, in two different places on the
 * step: a small bordered chip beside the label, and two large bordered buttons
 * further down.
 *
 * 🔴 A COMPONENT, NOT A COPIED CLASS STRING. Pasting the same `className` into
 *    three files is the version of this that looks finished and drifts within a
 *    week — the owner called this out by name on the flex list buttons the same
 *    afternoon ("reuse it, do not duplicate — that breaks the rule"). One file
 *    means "same size and theme" stays true without anyone maintaining it.
 *    ปุ่มเดียวใช้ร่วม ไม่ใช่ก๊อปคลาสไปแปะสามที่.
 *
 * 🔴 IT DOES NOT POSITION ITSELF. No margin, no `ml-auto`. The row that holds
 *    these buttons decides the spacing, because the same button appears in a
 *    left-hand cluster today and could sit anywhere tomorrow. Same rule as
 *    `components/flex/FlexCloneTemplateButton.tsx`, for the same reason.
 *
 * ⚠️ `type="button"`. This lives inside the broadcast form; a default-type
 *    button submits the whole campaign.
 *
 * revert: delete this file and give each of the three callers back its own
 * className — they are listed in `[FEAT-20260907-FLEXTOOLROW]` comments.
 */
import React from 'react';

/**
 * The shared geometry. Exported so a test can prove the three callers really do
 * render the same thing rather than three lookalikes.
 *
 * Deliberately quiet: these sit next to a required field label, and three loud
 * buttons there compete with the field itself. The previous large green
 * `border-2 … px-4 py-2 text-sm` pair is what the owner asked to shrink.
 */
export const FLEX_TOOL_BUTTON_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-dark-600 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-dark-700 disabled:cursor-not-allowed disabled:opacity-50';

export interface FlexToolButtonProps {
  readonly onClick: () => void;
  readonly label: string;
  /** Rendered before the label — the caller owns its size, they are all 13px. */
  readonly icon?: React.ReactNode;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** Spacing only. Never a colour or a size — that is the point of this file. */
  readonly className?: string;
}

export const FlexToolButton: React.FC<FlexToolButtonProps> = ({
  onClick,
  label,
  icon,
  disabled = false,
  testId,
  className = '',
}) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    title={label}
    aria-label={label}
    className={`${FLEX_TOOL_BUTTON_CLASS} ${className}`}
  >
    {icon}
    {label}
  </button>
);

export default FlexToolButton;
