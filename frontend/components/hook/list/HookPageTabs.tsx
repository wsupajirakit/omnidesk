import React from 'react';
import { Sliders, Gauge } from 'lucide-react';
import { useI18n } from '../../../i18n';

/**
 * ==== [FEAT-20260917-HOOKTABS] Manage Hooks / Quota tabs ==================
 *
 * Tab bar switcher between:
 * - 'manage': Standard hook management list (default)
 * - 'quota': LINE OA message quota datatable
 */

export type HookTabKey = 'manage' | 'quota';

interface Props {
  active: HookTabKey;
  onChange: (tab: HookTabKey) => void;
}

export const HookPageTabs: React.FC<Props> = ({ active, onChange }) => {
  const { t } = useI18n();

  const tabs: { key: HookTabKey; label: string; Icon: typeof Sliders }[] = [
    { key: 'manage', label: t('webhook_tabs.manage', 'จัดการ Hook'), Icon: Sliders },
    { key: 'quota', label: t('webhook_tabs.quota', 'โควต้า'), Icon: Gauge },
  ];

  return (
    <div
      role="tablist"
      aria-label="hook sections"
      data-testid="hook-tabs"
      className="flex items-center gap-2 bg-dark-800 border border-dark-700 rounded-xl p-1.5 shadow-lg w-fit"
    >
      {tabs.map(({ key, label, Icon }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`hook-tab-${key}`}
            onClick={() => onChange(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
              isActive
                ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/20'
                : 'text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-slate-100 dark:hover:bg-dark-700/60'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default HookPageTabs;
