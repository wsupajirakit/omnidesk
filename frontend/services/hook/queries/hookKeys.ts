/**
 * [FEAT-20261027-TANSTACK] Query keys of the `hook` service group.
 * Every key starts with QUERY_ROOT.hook, so `invalidateQueries({ queryKey: hookKeys.all })`
 * reaches this module and nothing else.
 */
import { QUERY_ROOT } from '../../query';
import type { HookListParams } from './useHookListQueries';

export const hookKeys = {
  all: [QUERY_ROOT.hook] as const,
  list: (params: HookListParams) => [QUERY_ROOT.hook, 'list', params] as const,
  tags: () => [QUERY_ROOT.hook, 'tags'] as const,
  detail: (id: string) => [QUERY_ROOT.hook, 'detail', id] as const,
  customTools: (params: Record<string, unknown>) => [QUERY_ROOT.hook, 'customTools', params] as const,
  customToolsPage: (params: Record<string, unknown>) => [QUERY_ROOT.hook, 'customToolsPage', params] as const,
  fieldOptions: (key: string) => [QUERY_ROOT.hook, 'fieldOptions', key] as const,
};
