import React from 'react';
import { Megaphone, History } from 'lucide-react';
import { useI18n } from '../../i18n';

/**
 * ==== [FEAT-20260824-BCASTTABS] บรอดแคสต์ / ประวัติ, side by side ============
 *
 * Owner, 24/08: "ทำแท็บ ประวัติ ข้าง บอร์ดแคสแล้วสลับ".
 *
 * The page used to STACK the two tables: the campaign list, then the send log
 * underneath it. On a laptop the log started below the fold, so nobody scrolled
 * to it — and the log is where "did it actually send?" is answered now that one
 * job runs many times. Tabs put the second table one click away instead of one
 * scroll away, and mean only one table is on screen (and one pager in play) at
 * a time. สองตารางซ้อนกัน = ตารางล่างไม่มีใครเห็น.
 *
 * Render-only: the active tab lives in the page (FE §6.4). Extracted to its own
 * file because `pages/messaging/Broadcasts.tsx` is on the `max-lines` waiver in
 * eslint.config.mjs, and that list is shrink-only.
 *
 * ⚠️ Labels are hard-coded Thai. i18n/translations/*.json is owned by another
 * change in flight; TODO move to `broadcast.tab_*`.
 *
 * revert: delete this file + the `activeTab` state and the two panel guards in
 *         Broadcasts.tsx; the two tables render stacked again.
 */

export type BroadcastTabKey = 'broadcasts' | 'history';

const TABS: { key: BroadcastTabKey; label: string; Icon: typeof Megaphone }[] = [
  { key: 'broadcasts', label: 'บรอดแคสต์', Icon: Megaphone },
  { key: 'history', label: 'ประวัติ', Icon: History },
];

interface Props {
  active: BroadcastTabKey;
  onChange: (tab: BroadcastTabKey) => void;
}

export const BroadcastPageTabs: React.FC<Props> = ({ active, onChange }) => {
  const { t } = useI18n();
  return (
  <div
    role="tablist"
    aria-label="broadcast sections"
    data-testid="broadcast-tabs"
    className="flex items-center gap-2 bg-dark-800 border border-dark-700 rounded-xl p-1.5 shadow-lg"
  >
    {TABS.map(({ key, label, Icon }) => {
      const isActive = active === key;
      return (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={isActive}
          data-testid={`broadcast-tab-${key}`}
          onClick={() => onChange(key)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isActive
              ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
              : 'text-slate-500 hover:text-slate-900 hover:bg-dark-700'
          }`}
        >
          <Icon size={16} />
          {/* [FEAT-20261022-I18NPAGESEN] label by locale; the Thai above stays the fallback */}
          {t(`pageui.messaging.tab_${key}`, label)}
        </button>
      );
    })}
  </div>
  );
};

export default BroadcastPageTabs;
