/** [FEAT-20260811-HOOKFORMSPLIT] AI-tab constants — moved verbatim from HookFormModal
 * so the extracted HookAiTab and the parent share one definition. */
import { FileJson, Settings, Cog, Bot } from 'lucide-react';

export const AI_SUB_TABS = [
  { key: 'training' as const, i18n: 'hook_form.ai_tab_training', icon: FileJson },
  { key: 'advanced' as const, i18n: 'hook_form.ai_tab_advanced', icon: Settings },
];

export const DOC_STEPS = [
  { key: 'general' as const,     i18n: 'hook_form.general_group',      icon: Cog },
  { key: 'flexTag' as const,     i18n: 'hook_form.flex_tag_group',     icon: Bot },
  { key: 'trainingDoc' as const, i18n: 'hook_form.training_doc_group', icon: FileJson },
];
