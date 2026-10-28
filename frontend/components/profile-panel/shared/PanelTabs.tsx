/**
 * [REFACTOR-20260905-CUSTPROV] `PanelTabs` — the two/three-way tab switch
 * used inside a card body (renders only the active tab's content).
 *
 * WHY IT LIVES HERE: needed by 3 card files ("การเงิน", "โบนัส", "กิจกรรม"),
 * plus the "รอทำรายการ" card that stayed in the parent — well over the 2+
 * threshold `dev-local §6` sets for moving a helper into `shared/`.
 *
 * MOVED VERBATIM from `ProfilePanel.tsx` — no class string, prop, or
 * behaviour changed, only the file it lives in.
 *
 * Props: `tabs` (key/label/content triples) and optional `initialKey` (which
 * tab starts active; defaults to `tabs[0]`).
 *
 * revert: paste this component back into `ProfilePanel.tsx` (it sat right
 * after `PanelCard`, under the same "panel building blocks" comment), delete
 * this file, and change every `from '../shared/PanelTabs'` /
 * `from './shared/PanelTabs'` import back to a plain in-file reference.
 */
import React, { useState } from 'react';

// Two-tab switch used inside การเงิน / โบนัส / กิจกรรม cards.
// [FEAT-20260810-PENDINGDEP] เพิ่ม `initialKey` (optional) — การ์ด "รอทำรายการ" ต้อง
//   active แท็บที่ "มีข้อมูล" ไม่ใช่แท็บแรกเสมอ · ไม่ส่ง = tabs[0] เหมือนเดิมทุกที่
//   ที่เรียกอยู่แล้ว (การเงิน/โบนัส/กิจกรรม) ⇒ ไม่กระทบของเดิม
export const PanelTabs: React.FC<{ tabs: { key: string; label: string; content: React.ReactNode }[]; initialKey?: string }> = ({ tabs, initialKey }) => {
  const [active, setActive] = useState(initialKey ?? tabs[0]?.key);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex border-b border-gray-200 bg-gray-50 text-sm">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setActive(tb.key)}
            className={`flex-1 py-2.5 font-bold transition-colors border-b-2 ${active === tb.key ? 'text-primary border-primary bg-white' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100'}`}>
            {tb.label}
          </button>
        ))}
      </div>
      <div className="p-3 bg-white">{tabs.find(tb => tb.key === active)?.content}</div>
    </div>
  );
};
