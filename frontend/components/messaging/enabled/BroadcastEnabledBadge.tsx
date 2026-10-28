import React from 'react';
import { useI18n } from '../../../i18n';
import {
  BROADCAST_ENABLE_HINT,
  BROADCAST_ENABLE_LABEL,
  resolveBroadcastEnableState,
  type ScheduleEnabledLike,
} from './broadcastEnableState';

/* [FEAT-20260824-BCASTENABLED] The สถานะ pill: on / off / one-off.
 * Colour carries the same three-way split as the label — green armed, red off,
 * neutral slate for a one-off — so the state reads without stopping to parse. */
const STYLE = {
  on: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  off: 'bg-red-500/10 text-red-400 border-red-500/20',
  one_off: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
} as const;

interface Props {
  schedule?: ScheduleEnabledLike | null;
  testId?: string;
}

export const BroadcastEnabledBadge: React.FC<Props> = ({ schedule, testId }) => {
  const { t } = useI18n();
  const state = resolveBroadcastEnableState(schedule);
  /* [FEAT-20261022-I18NPAGESEN] the Thai tables stay the fallback (a test pins them) */
  return (
    <span
      data-testid={testId}
      data-enable-state={state}
      title={t(`pageui.messaging.enable_hint_${state}`, BROADCAST_ENABLE_HINT[state])}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STYLE[state]}`}
    >
      {t(`pageui.messaging.enable_label_${state}`, BROADCAST_ENABLE_LABEL[state])}
    </span>
  );
};

export default BroadcastEnabledBadge;
