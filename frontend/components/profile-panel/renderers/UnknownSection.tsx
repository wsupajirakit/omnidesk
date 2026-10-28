/**
 * [FEAT-20260905-CUSTPROV PART 7] 🔴 §40 — a section type this dashboard does
 * not know renders as a VISIBLE, LABELLED fallback. Never blank. Never a crash.
 *
 * 📖 PLAN: `omnidesk-api/todo/task/05092026/todo3_05092026_profile_panel_module.md`
 *          PART 7 §40 — *"the FE renders an unknown `type` as a visible,
 *          labelled fallback rather than a blank space"*, and §41's mutation
 *          list names *"render an unknown `type` as empty instead of a labelled
 *          fallback"* as a change that must go red.
 *
 * ## THIS IS A SAFETY NET, NOT A PLACEHOLDER
 * §40 states the honest cost of a payload-described UI: TypeScript stops
 * checking card content, so a section can be well-formed and still be something
 * this build cannot draw. The whole design's promise (§39) is that a new
 * provider ships with NO front-end release — which is only true if a type the FE
 * has never seen degrades instead of failing. That is what this file buys:
 *
 *   · a provider may ship a new `type` BEFORE the dashboard has its renderer,
 *     and the panel keeps working — the card is labelled, the operator can see
 *     that data arrived, and the missing piece names itself;
 *   · the failure is LOUD at exactly one card, not silent across the panel. A
 *     blank space is the worst outcome available here: nothing to report, and it
 *     looks like the customer simply has no data.
 * ไม่รู้จัก = ขึ้นป้ายบอกตรง ๆ ไม่ใช่หายไปเงียบ ๆ
 *
 * ## WHAT IT SAYS, AND WHY EACH LINE IS THERE
 *   1. the section's LABEL — so the operator knows WHICH card is degraded, and
 *      so a screenshot is enough to report it;
 *   2. the raw `type` token, monospaced — the one word that turns "something is
 *      broken" into a fixable ticket. Not translated: it is an identifier;
 *   3. the payload count — the honest part. The data ARRIVED; only the drawing
 *      is missing. Without it this reads like a fetch failure and someone
 *      re-checks the network for an hour;
 *   4. what fixes it, in one line: update the dashboard.
 *
 * ## COPY IS THAI, LIKE THE REST OF THE PANEL
 * The panel's own literals are Thai (`ไม่มีโปรโมชั่น`, `ยังไม่มีสินค้าที่ซื้อล่าสุด`)
 * and this box sits among them. It is NOT routed through i18n because adding a
 * key means editing `i18n/translations/*.json`, which this create-only lane does
 * not own; when this box gains a key, `t()` replaces the literals here and
 * nothing else changes. (House rule: code comments and notes are English; this
 * is on-screen copy for a Thai-language panel.)
 *
 * ## Label falls back to the id — because "never blank" outranks "never ugly"
 * The host drops sections with no label at all (`ProfilePanelView.tsx`), so in
 * the product this component always receives one. Called directly it still must
 * not render an untitled box, so the id is humanised as a last resort. A box
 * titled `Vip Desk` is worth more than an empty one.
 *
 * revert: delete this file and change `renderSection` in `./index.tsx` to return
 *         `null` for an unrecognised type — which is precisely the regression
 *         §41 lists, so revert this one only with the plan open.
 */
import React from 'react';
import { TriangleAlert } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { humanId, resolveLabel, sectionLabelSource } from './labels';
import type { SectionProps } from './types';

/** How much payload arrived — the "the data is here" evidence in line 3. */
const payloadCount = (s: SectionProps['section']): number =>
  (s.rows?.length ?? 0) + (s.items?.length ?? 0) + (s.amountRows?.length ?? 0);

export const UnknownSection: React.FC<SectionProps> = ({ section }) => {
  const { t } = useI18n();
  const label = resolveLabel(t, sectionLabelSource(section)) ?? humanId(section.id);
  const count = payloadCount(section);
  const type = String(section.type ?? '').trim() || t('ticketui.panel.unknown_type', '(ไม่ระบุชนิด)');

  return (
    <div
      data-testid={`unknown-section-${section.id}`}
      data-section-type={section.type}
      className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-3 space-y-1"
    >
      <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700">
        <TriangleAlert size={13} className="shrink-0" />
        <span className="break-words">{label}</span>
      </div>
      <p className="text-[11px] text-amber-700 leading-snug">
        {t('ticketui.panel.unknown_lead', 'ยังแสดงผลไม่ได้ — ชนิด')} <span className="font-mono font-bold">{type}</span> {t('ticketui.panel.unknown_tail', 'ไม่มีในแดชบอร์ดรุ่นนี้')}
      </p>
      <p className="text-[11px] text-amber-600 leading-snug">
        {count > 0 ? t('ticketui.panel.unknown_received', 'ได้รับข้อมูลแล้ว {count} รายการ · ').replace('{count}', String(count)) : ''}{t('ticketui.panel.unknown_update', 'อัปเดตแดชบอร์ดเพื่อให้การ์ดนี้แสดงผล')}
      </p>
    </div>
  );
};
