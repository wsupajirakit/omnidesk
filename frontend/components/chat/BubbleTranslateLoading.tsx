import React from 'react';
import { TranslateLoadingDots } from './TranslateLoadingDots';
import { useI18n } from '../../i18n';

/**
 * [FEAT-20260918-PHASE3] BubbleTranslateLoading
 * ===========================================================================
 * Animated ball effect loading inside message bubble while in-flight translation is processing.
 * Displays purple, violet, and cyan/sky animated balls with "(กำลังแปล)" / "(Translating...)" label.
 *
 * Sits seamlessly inside the bubble without breaking width/height constraints.
 */
export const BubbleTranslateLoading: React.FC = () => {
  const { t } = useI18n();

  return (
    <div
      data-testid="bubble-translate-loading"
      className="inline-flex items-center gap-2 py-0.5 select-none"
      aria-live="polite"
      aria-busy="true"
    >
      <TranslateLoadingDots size="sm" />
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 animate-pulse">
        ({t('chat_room.translating_label', 'กำลังแปล')})
      </span>
    </div>
  );
};

export default BubbleTranslateLoading;
