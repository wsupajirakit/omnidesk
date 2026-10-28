/**
 * [REFACTOR-20260905-CUSTPROV] `PanelRow` — a label/value line used inside
 * card bodies (label left, bold value right, optional bottom border).
 *
 * WHY IT LIVES HERE: needed by 2+ card files ("ข้อมูลลูกค้า" and "โปรโมชั่น"
 * both use it), so `dev-local §6` puts it in `shared/` instead of duplicating
 * it or making one card import the parent for it.
 *
 * MOVED VERBATIM from `ProfilePanel.tsx` — no class string, prop, or
 * behaviour changed, only the file it lives in.
 *
 * Props: `label`, `children` (the value), `last?` (drops the bottom border
 * for the final row in a card).
 *
 * revert: paste this component back into `ProfilePanel.tsx` (it sat right
 * before the `CopyValue` block), delete this file, and change every
 * `from '../shared/PanelRow'` / `from './shared/PanelRow'` import back to a
 * plain in-file reference.
 */
import React from 'react';

export const PanelRow: React.FC<{ label: string; children: React.ReactNode; last?: boolean }> = ({ label, children, last }) => (
  <div className={`flex justify-between items-center ${last ? '' : 'border-b border-gray-50 pb-2'} text-[13px]`}>
    <span className="text-gray-500">{label}</span>
    <span className="font-bold text-gray-800 flex items-center gap-1">{children}</span>
  </div>
);
