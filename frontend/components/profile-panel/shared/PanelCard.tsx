/**
 * [REFACTOR-20260905-CUSTPROV] `PanelCard` — the collapsible, blue-headed card
 * shell used by every card in this panel (all six moved cards, plus the ones
 * that stayed behind: "ข้อมูล LINE", "รอทำรายการ", `SiteRulesCard`).
 *
 * WHY IT LIVES HERE, NOT IN ONE CARD FILE: it is used by 2+ card files (in
 * fact all six), so `dev-local §6` puts it in `shared/` rather than leaving a
 * duplicate definition per file or forcing every card to import the parent.
 *
 * MOVED VERBATIM from `ProfilePanel.tsx` (was defined right after the
 * formatting helpers, under the "panel building blocks" comment). No prop,
 * class string or behaviour changed — only the file it lives in.
 *
 * Props: `title`, `icon`, `badge?`, `titleBadge?`, `titleClassName?`,
 * `defaultOpen?`, `children`. See the inline history comments below for why
 * each optional prop exists.
 *
 * revert: paste this component back into `ProfilePanel.tsx` where the
 * "panel building blocks" comment is, delete this file, and change every
 * `from '../shared/PanelCard'` / `from './shared/PanelCard'` import back to
 * a plain in-file reference.
 */
import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

// ── panel building blocks (โครงจากไฟล์ต้นแบบ — ต่อกับข้อมูลจริงแล้ว) ────────
// Collapsible card with a blue header (mirrors the design reference). Defaults
// open; click header to toggle.
// [FIX-20260731-NOMOCK] เดิมชื่อ MockCard/MockRow/MockTabs ตั้งแต่ตอนยังเป็น
// โครงเปล่า — ตอนนี้ทุกใบต่อข้อมูลจริงหมดแล้ว ชื่อจึงชวนเข้าใจผิด
// ผู้ใช้สั่ง "อย่าใช้คำว่า mock" → เปลี่ยนเป็น PanelCard/PanelRow/PanelTabs
// เป็นการเปลี่ยน "ชื่อ" ล้วนๆ ไม่มี props/พฤติกรรมใดเปลี่ยน
// revert: เปลี่ยนชื่อกลับทั้ง 3 ตัว (+ class panel-badge → mock-badge)
// [FIX-20260731-PANELCOLLAPSE] เดิมเปลี่ยนค่าตั้งต้นเป็น false ("panel ขวา default = ย่อเก็บ")
// [FIX-20260801-CARDEXPAND] ผู้ใช้กลับคำสั่ง: "card ทั้งหมด default expand ไว้ไม่ใช่ย่อ"
// → ค่าตั้งต้นกลับเป็น true และการ์ดที่เคยระบุ false ไว้เองก็เปลี่ยนเป็น true ทุกใบ
// (ทั้งแท็บ "ข้อมูลส่วนตัว" และ "ดำเนินการ")
// แก้ที่ค่าตั้งต้นที่เดียว ครอบทุกการ์ด
// ที่ไม่ได้ระบุ defaultOpen เอง (การ์ดที่ระบุไว้แล้วยังทำงานตามที่ระบุเหมือนเดิม)
// ⚠️ เป็นแค่สถานะเริ่มต้นของการแสดงผล ไม่ได้แตะเงื่อนไข/ข้อมูล/การเรียก API ใดๆ
// revert: กลับเป็น defaultOpen = true
// [FIX-20260731-PENDINGHEAD] เพิ่ม props ทางเลือก 2 ตัว (ไม่ใส่ = เหมือนเดิมเป๊ะ)
//   titleClassName — ทับสีหัวข้อ เช่นการ์ด "รอทำรายการ" ที่ผู้ใช้สั่งให้เป็นสีส้ม
//                    ทั้งธีม light และ dark (การ์ดอื่นยังเป็น text-primary ตามเดิม)
//   titleBadge     — ป้ายที่ต้องอยู่ "ติดกับ label" ไม่ใช่ชิดขวาสุดแบบ `badge` เดิม
// ทั้งคู่มีค่าเริ่มต้น จึงไม่กระทบการ์ดที่มีอยู่แล้วสักใบ
// revert: ลบ 2 props นี้ แล้วเอา titleBadge กลับไปใส่ใน badge
export const PanelCard: React.FC<{ title: string; icon: React.ReactNode; badge?: React.ReactNode; titleBadge?: React.ReactNode; titleClassName?: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, icon, badge, titleBadge, titleClassName = 'text-primary', defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-border rounded-lg shadow-sm overflow-hidden">
      <div onClick={() => setOpen(o => !o)} className="bg-primary-light px-3 py-2 border-b border-border flex justify-between items-center cursor-pointer select-none gap-2 transition-colors hover:bg-blue-50/60">
        <h3 className={`text-sm font-bold ${titleClassName} tracking-wide flex items-center gap-2`}>{icon} {title}{titleBadge}</h3>
        <div className="flex items-center gap-2">{badge}<ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} /></div>
      </div>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
};
