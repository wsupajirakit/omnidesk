/**
 * [FEAT-20260824-RUNDETAIL] The sentence that stands in place of a blank panel.
 *
 * 🔴 THIS COMPONENT IS THE FEATURE, not decoration. Two of the three states it
 *    renders are states where the data is legitimately absent, and an empty
 *    area with no words reads as a broken screen — or, for an expired log, as
 *    the false claim "this round sent nothing".
 *    ว่างเปล่าโดยไม่บอกอะไร = คนอ่านสรุปเอง แล้วสรุปผิด.
 *
 * The three tones are deliberately different: `error` is red because something
 * IS wrong; `expired` and `missing` are muted because they are normal, healthy
 * states of an old record.
 */
import React from 'react';
import { AlertTriangle, Clock, Info } from 'lucide-react';
import type { RunNotice } from './runDetailFormat';

const TONE: Record<RunNotice['kind'], { cls: string; Icon: typeof Info }> = {
  error: { cls: 'border-red-500/40 bg-red-500/10 text-red-300', Icon: AlertTriangle },
  expired: { cls: 'border-dark-600 bg-dark-800/60 text-slate-700', Icon: Clock },
  missing: { cls: 'border-dark-600 bg-dark-800/60 text-slate-700', Icon: Info }
};

export const RunNoticeLine: React.FC<{ notice: RunNotice; testId?: string }> = ({
  notice,
  testId
}) => {
  const { cls, Icon } = TONE[notice.kind];
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${cls}`}
      data-testid={testId ?? `run-notice-${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : undefined}
    >
      <Icon size={14} className="mt-0.5 shrink-0" aria-hidden />
      <span>{notice.text}</span>
    </p>
  );
};
