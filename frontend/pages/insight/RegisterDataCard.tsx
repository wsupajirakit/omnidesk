/* [FEAT-20260820-REGINSIGHT] Insight report — "Register data" card
 * ===========================================================================
 * Replaces the old "AI Category Breakdown" card. Two horizontal bars:
 * member-registered first, admin-registered second — the order the owner
 * listed them ("อันแรก = สมัครโดย member อันสอง = สมัครโดย admin").
 *
 * WHY ITS OWN FILE — FE anti-bloat rule §6.1: self-contained new UI starts in
 * its own file; InsightReport.tsx is waived at ~1900 lines and must only
 * shrink. Same reasoning (and same folder) as HookTabsOverflow.tsx.
 *
 * Date filter: two native date inputs styled EXACTLY like the page's own
 * Filters panel (same class strings, same showPicker affordance, same
 * cross-clamping). Deliberately NOT LogDateRangeFilter: that component hard-
 * caps ranges at 3 days for the log pages, and the owner's rule here is
 * "ไม่ล็อควัน เลือกกี่วันก็ได้" — reusing it unmodified would cap the card, and
 * modifying it is forbidden. Its exported bangkokToday() helper IS reused.
 *
 * The numbers also render as textual legend rows (data-testid reg-row-*):
 * that is what the dom test asserts — jsdom gives recharts a 0×0 container,
 * so SVG bars are untestable there — and it doubles as the accessible fallback.
 *
 * revert: delete this file + its <RegisterDataCard/> usage, the service
 * function, the i18n keys and the dom test; restore the old card from git.
 */
import React, { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  defaultFreeRange,
  FreeDateRangeFilter,
  type FreeDateRange,
} from '../../components/common/FreeDateRangeFilter';
import { useI18n } from '../../i18n';
import {
  insightReportService,
  type RegistrationInsights,
} from '../../services/insight';

/* member = emerald, admin = indigo — the same pairing the Response Proportion
 * legend already uses on this page, so the two cards read as one system. */
const MEMBER_COLOR = '#10b981';
const ADMIN_COLOR = '#6366f1';
/* [FEAT-20260821-REGBOTASSIST] amber — ตั้งใจให้ต่างจากสองสีเดิมชัด ๆ
   สามแท่งที่สีใกล้กันสองอันจะอ่านไม่ออกว่าอันไหนเป็นอันไหน */
const ADMIN_BOT_COLOR = '#f59e0b';

export const RegisterDataCard: React.FC<{ hookId: string | null }> = ({
  hookId,
}) => {
  const { t } = useI18n();
  const [range, setRange] = useState<FreeDateRange>(defaultFreeRange);
  const [counts, setCounts] = useState<RegistrationInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const { from, to } = range;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    insightReportService
      .getRegistrationInsights({ from, to, line_oa_hook_id: hookId })
      .then((res) => {
        if (!cancelled) setCounts(res.data);
      })
      .catch(() => {
        // an error renders as the empty state; the page toast layer is not
        // wired into this card on purpose (a count card must never block UX)
        if (!cancelled) setCounts(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hookId, from, to]);

  // member FIRST — owner-dictated bar order; pinned by the dom test.
  const rows = counts
    ? [
        {
          key: 'member',
          label: t('insight.reg_by_member'),
          axisLabel: t('insight.reg_axis_member'),
          count: counts.member,
          color: MEMBER_COLOR,
        },
        {
          key: 'admin',
          label: t('insight.reg_by_admin'),
          axisLabel: t('insight.reg_axis_admin'),
          count: counts.admin,
          color: ADMIN_COLOR,
        },
        /* [FEAT-20260821-REGBOTASSIST] แท่งที่สาม — **ต่อท้าย** เสมอ
           เจ้าของกำหนดลำดับ member → admin ไว้ตั้งแต่แรกและ dom test ปักไว้
           ⇒ แท่งใหม่ห้ามแทรกกลาง
           ความหมาย: แอดมินเป็นคนปิดจ๊อบ แต่บอทเป็นคนไล่ตามมาก่อน
           (`config.follow_up.line.request_reg_at` ถูกประทับไว้แล้ว) */
        {
          key: 'admin_bot_assisted',
          label: t('insight.reg_by_admin_bot'),
          axisLabel: t('insight.reg_axis_admin_bot'),
          count: counts.admin_bot_assisted,
          color: ADMIN_BOT_COLOR,
        },
      ]
    : [];

  return (
    <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-2xl p-5 shadow-md flex flex-col gap-3 flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <BarChart2 size={16} className="text-primary-500" />
          {t('insight.register_data_title')}
        </h3>
        {/* date range — the shared UNCAPPED picker (owner: "ไม่ล็อควัน");
            the capped LogDateRangeFilter stays on its log pages, untouched */}
        <FreeDateRangeFilter
          value={range}
          onChange={setRange}
          testIdPrefix="reg"
        />
      </div>

      {!counts ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-xs min-h-[120px]">
          {loading ? '…' : t('insight.no_data_short')}
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ left: 4, right: 40, top: 4, bottom: 4 }}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  horizontal={false}
                  vertical={true}
                  stroke="#cbd5e1"
                  opacity={0.4}
                />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  stroke="#cbd5e1"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: '#94a3b8' }}
                />
                <YAxis
                  dataKey="axisLabel"
                  type="category"
                  stroke="none"
                  fontSize={11}
                  /* [FIX-20260821-REGAXISWIDTH] แกนใช้ **ป้ายสั้น** คนละคีย์กับรายการข้างล่าง
                     ===============================================================
                     `สมัครโดย Bot ช่วย Admin` ยาวเกินกรอบเดิม 140px ⇒ recharts ตัดขึ้น
                     บรรทัดใหม่แล้วป้ายไปชนตัวเลข — เจ้าของแจ้ง "label ตกบรรทัดไม่สวย"

                     ⚠️ ไม่แก้ด้วยการขยายกรอบไล่ตามป้าย และไม่แก้ด้วยการตัดป้ายแกนทิ้ง
                     · ขยายกรอบ = แก้อาการ · ป้ายยาวขึ้นอีกก็ต้องขยายอีก
                     · ตัดป้ายทิ้ง = ผิด — หัวไฟล์เขียนไว้ว่ารายการข้างล่างมีไว้ให้เทสอ่าน
                       และเป็น a11y fallback (jsdom ให้ recharts เป็น 0×0)
                       **ป้ายบนแกนคือตัวแสดงผลหลัก** และการ์ดแท่งนอนตัวพี่ในหน้าเดียวกัน
                       (`InsightReport.tsx:1430`) ใช้แกนถือชื่อที่ width=100 โดยไม่มี
                       รายการข้างล่างเลย ⇒ ตัดทิ้งจะทำให้คนตาดีต้องไล่จับคู่สีเอง

                     ⇒ แกนกับรายการ **ทำคนละหน้าที่** — แกนมีที่จำกัดใช้คำสั้น
                       รายการมีที่เหลือเฟือใช้คำเต็ม · ใช้คำเดียวกันสองที่คือการบังคับ
                       ให้ที่แคบรับภาระของที่กว้าง แล้วก็ตกบรรทัด

                     width=100 = ค่าเดียวกับการ์ดตัวพี่
                     ⚠️ `insightRegisterData.dom.test.tsx` คำนวณเองว่าป้ายแกนที่ยาวที่สุด
                        ของทั้งสองภาษาใส่กรอบได้ไหม (เผื่อขอบ 15%) ⇒ เพิ่มป้ายยาวขึ้น
                        วันหน้า เทสแดงเองโดยไม่ต้องมีใครจำ */
                  width={100}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontWeight: 500 }}
                />
                <RechartsTooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="bg-white border border-slate-200 shadow-xl p-2.5 rounded-xl text-xs">
                        <p className="font-bold text-slate-800 mb-1">{label}</p>
                        <p className="text-emerald-600 font-semibold">
                          {t('insight.reg_count_label')}: {payload[0].value}
                        </p>
                      </div>
                    ) : null
                  }
                  cursor={{ fill: 'rgba(99,102,241,0.04)' }}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 6, 6, 0]}
                  barSize={22}
                  label={({ x, y, width, height, value }: any) => (
                    <text
                      x={x + width + 7}
                      y={y + height / 2}
                      fill="#64748b"
                      fontSize={11}
                      fontWeight="700"
                      dominantBaseline="central"
                    >
                      {value}
                    </text>
                  )}
                >
                  {rows.map((row) => (
                    <Cell key={row.key} fill={row.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* textual legend — the testable (and accessible) source of truth */}
          <div className="flex flex-col gap-1 border-t border-slate-100 pt-2">
            {rows.map((row) => (
              <div
                key={row.key}
                data-testid={`reg-row-${row.key}`}
                className="flex items-center gap-2 px-3 py-1"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-xs text-slate-400 flex-1">
                  {row.label}
                </span>
                <span className="text-sm font-extrabold text-slate-700 flex-shrink-0">
                  {row.count}
                </span>
              </div>
            ))}
            <div
              data-testid="reg-total"
              className="flex items-center gap-2 px-3 py-1 border-t border-slate-100"
            >
              <span className="text-xs text-slate-400 flex-1">
                {t('insight.reg_total')}
              </span>
              <span className="text-sm font-extrabold text-slate-700 flex-shrink-0">
                {counts.total}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
