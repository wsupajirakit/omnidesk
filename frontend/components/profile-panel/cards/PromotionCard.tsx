/**
 * [REFACTOR-20260905-CUSTPROV] Draws the "โปรโมชั่น" card — the current
 * promotion name badge, the Turn-over table (per-product breakdown when the
 * upstream sends one, else a single summary row), and the Outstanding table
 * (same per-product / single-row split).
 *
 * MOVED VERBATIM from `ProfilePanel.tsx` (was the second of six cards
 * rendered inside `PersonalPanelNarrow`, guarded by `{promotion && (…)}`).
 * That guard stayed in the parent — see `ProfilePanel.tsx`'s call site —
 * because `dev-local §6.3` moves markup, not the "when to render" decision.
 * No class string, element order, or condition changed; only the file this
 * JSX lives in.
 *
 * STATE STAYS IN THE PARENT (`dev-local §6.4`): this card owns no
 * `useState`/`useEffect` — every value below is a plain derived value already
 * computed in `PersonalPanelNarrow` and threaded down as a prop. Nothing
 * here is coupled.
 *
 * ==== [FEAT-20260905-CUSTPROV] THE RAW `promotion` PROP IS GONE ==============
 * It was taken for exactly two reads — the activity-volume `unit` (to compose the summary
 * row's `Activity volume (…)` label) and its `percent` (the trailing `(87%)`) —
 * and those two reads were the last vendor field names in this card. Both now
 * arrive resolved, inside the `promoActivityVolume` row: the label is composed by
 * `build-view.ts` (`Activity volume (${unit || 'activity volume'})`, the same expression this
 * card used to hold) and the percentage arrives pre-formatted as `suffix`, or
 * not at all when the upstream sends no number — which is precisely when this
 * card used to draw nothing.
 *
 * 🔴 THE PROP WAS DROPPED RATHER THAN KEPT-AND-IGNORED. A component that still
 * accepts the raw blob is a doorway: the next value someone needs in a hurry
 * gets read straight out of it, and the coupling is back with no diff to argue
 * about. `promotion` is still what decides WHETHER this card renders, and that
 * decision correctly stayed in the parent. ปิดประตูดีกว่าปล่อยแง้ม
 * REJECTED: keeping `promotion` optional "for later". There is no later — a
 * value this card needs is a value the provider must describe.
 *
 * Props: `promoName`, `promoToBreakdown` / `promoToDone` / `promoToReq` /
 * `promoToLabel` / `promoToSuffix` (activity volume — the per-product table when the
 * provider sent one, else the single summary row with its own label and
 * percentage), `promoOsBreakdown` / `promoOutstanding` (outstanding, same
 * split). Every one is read BY KEY from `view.sections` in
 * `ProfilePanel.tsx` — see `renderers/sectionValues.ts`.
 *
 * revert: paste the `<PanelCard title="โปรโมชั่น">…</PanelCard>` JSX below
 * back into `PersonalPanelNarrow` inside its existing `{promotion && (…)}`
 * guard, delete this file, and drop the `<PromotionCard …/>` call site. To
 * revert only the provider wiring, restore the `promotion: any` prop and the
 * two `promotion.activity_volume?.…` reads from `git show ce8fcaa:…/PromotionCard.tsx`.
 */
import React from 'react';
import { useI18n } from '../../../i18n';
import { Tags } from 'lucide-react';
import { PanelCard } from '../shared/PanelCard';
import { PanelRow } from '../shared/PanelRow';
import { xpAmt } from '../shared/formatters';
import { xpProductLabel, xpActivityTone } from '../ProfilePanel';

export const PromotionCard: React.FC<{
  promoName: any;
  promoToBreakdown: { key: string; done: any; required: any }[];
  promoToDone: any;
  promoToReq: any;
  promoToLabel: string;
  promoToSuffix: string;
  promoOsBreakdown: { key: string; amount: any }[];
  promoOutstanding: any;
}> = ({ promoName, promoToBreakdown, promoToDone, promoToReq, promoToLabel, promoToSuffix, promoOsBreakdown, promoOutstanding }) => {
  const { t } = useI18n();
  return (
      <PanelCard title={t('ticketui.panel.promotion', 'โปรโมชั่น')} icon={<Tags size={14} />} defaultOpen={false}
        badge={promoName
          /* [FIX-20260731-PROMOBADGE] text-blue-700 เป็นน้ำเงินเข้ม อ่านยากบนพื้น
             กรมท่าของธีม dark — ผู้ใช้สั่ง "dark ใช้ font สีฟ้าอ่อน"
             ใส่คลาสไว้เกาะ แล้วทับสีเฉพาะธีม dark ใน index.css (ธีม light เหมือนเดิม) */
          ? <span className="panel-badge-promo inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 whitespace-nowrap">🎟 {promoName}</span>
          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">{t('ticketui.panel.no_promotion', 'ไม่มีโปรโมชั่น')}</span>}>
        <div className="space-y-2.5">
          {/* [FEAT-20260801-SHOPAPIV1FIELDS] ผู้ใช้สั่ง "แสดงตามจริง แต่ถ้า null/false
              ให้แสดง -" · ของจริงส่ง current_promotion_info: null + has_active_promotion:
              false มาเมื่อไม่มีโปร → แถวนี้ขึ้น "-" ตรงๆ (ป้ายมุมขวายังเหมือนเดิม) */}
          <PanelRow label={t('ticketui.panel.active_promo', 'โปรที่ใช้อยู่')} last>{promoName || <span className="text-gray-400">-</span>}</PanelRow>
          {/* ==== [FIX-20260801-PROMOROWS] จัดการ์ดโปรโมชั่นตามที่ผู้ใช้สั่ง
               1. ตัดแถว "Activity volume" แบบบรรทัดเดียวทิ้ง — ซ้ำกับตารางแยกสินค้าด้านล่าง
                  (ตัวเลขรวมคือผลบวกของทุกแถวอยู่แล้ว จึงไม่มีข้อมูลไหนหาย)
               2. Outstanding แสดงแยกสินค้าด้วย (ของจริงส่งเป็น object คีย์ชุดเดียวกับ activity volume)
               3. หัวตารางยอดกิจกรรมเปลี่ยนจาก "ประเภทสินค้า" → "Activity volume" · ฝั่งขวาคงเดิม
               ⚠️ ถ้าปลายทางส่งค่าเป็นตัวเลขตัวเดียว (เช่น demo mock) จะไม่มีตารางแยก
                  → ตกไปใช้แถวสรุปบรรทัดเดียวแทน จอ mock จึงไม่เปลี่ยน
               revert: เอาบล็อกเดิม (Activity volume + Outstanding บรรทัดเดียว) กลับมา */}
          {promoToBreakdown.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex justify-between text-[11px] text-gray-400 bg-gray-50 px-2 py-1.5 border-b border-gray-200">
                {/* [FEAT-20260801-TURNTONE] "ทำได้" → "ทำไปแล้ว" ตามที่ผู้ใช้สั่ง */}
                <span>Activity volume</span><span>{t('ticketui.panel.activity_done_required', 'ทำไปแล้ว / ต้องทำ')}</span>
              </div>
              {promoToBreakdown.map((g, i, arr) => (
                <div key={g.key} className={`flex justify-between items-center text-xs px-2 py-1.5 ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-gray-600">{xpProductLabel(g.key)}</span>
                  {/* [FEAT-20260801-TURNTONE] สีของยอด "ทำไปแล้ว" ตามสถานะ (ดู xpActivityTone)
                      + ตัวเลข "ต้องทำ" เอา text-[10px] ออก → สืบทอด text-xs = ใหญ่เท่ากัน
                        (คงสีเทา/น้ำหนักปกติไว้ เพื่อให้ยังแยกออกว่าตัวไหนคือเป้า) */}
                  <span className={`font-bold ${xpActivityTone(g.done, g.required)}`}>{xpAmt(g.done)}
                    <span className="text-gray-400 font-normal">/{xpAmt(g.required)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            /* ปลายทางส่งยอดกิจกรรมเป็นตัวเลขตัวเดียว → แถวสรุปแบบเดิม */
            <PanelRow label={promoToLabel} last>
              {/* [FEAT-20260801-TURNTONE] ข้อมูลชุดเดียวกับตารางแยกสินค้า จึงใช้กติกาสี
                  และขนาดตัวเลขชุดเดียวกัน ไม่งั้นสองมุมมองของเรื่องเดียวกันหน้าตาไม่ตรง */}
              <span className={xpActivityTone(promoToDone, promoToReq)}>{xpAmt(promoToDone)}<span className="text-gray-400 font-normal">/{xpAmt(promoToReq)}</span>
                {/* [FEAT-20260905-CUSTPROV] `(87%)` arrives already formatted, and
                    ONLY when the upstream really sent a number — the producer's
                    `typeof … === 'number'` test is the same one that used to be
                    written here, so `(NaN%)` still cannot reach a card. */}
                {promoToSuffix && <span className="ml-1 text-[10px] font-bold text-blue-600">{promoToSuffix}</span>}
              </span>
            </PanelRow>
          )}
          {promoOsBreakdown.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="flex justify-between text-[11px] text-gray-400 bg-gray-50 px-2 py-1.5 border-b border-gray-200">
                <span>Outstanding</span><span>{t('ticketui.panel.outstanding', 'ค้างอยู่')}</span>
              </div>
              {promoOsBreakdown.map((g, i, arr) => (
                <div key={g.key} className={`flex justify-between items-center text-xs px-2 py-1.5 ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <span className="text-gray-600">{xpProductLabel(g.key)}</span>
                  <span className="font-bold text-gray-800">{xpAmt(g.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <PanelRow label="Outstanding" last>{xpAmt(promoOutstanding)}</PanelRow>
          )}
          {/* ==== [FIX-20260801-PROMOROWS] END */}
        </div>
      </PanelCard>
  );
};
