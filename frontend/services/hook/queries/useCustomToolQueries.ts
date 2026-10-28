/**
 * [FEAT-20261027-TANSTACK] Custom tool reads (services/hook/customToolService.ts, unchanged).
 *
 * `useCustomToolsQuery` — the tool dropdown in the hook form (enabled tools only).
 *   The service already turns a 403 into `[]`, so a user without custom_tools.manage
 *   sees an empty dropdown, never an error — unchanged.
 * `useCustomToolsPageQuery` — one page of the Custom Tools screen PLUS the OA usage
 *   count of each tool (one getUsage per row, exactly the old load()). getUsage never
 *   throws (it answers count 0 on failure), so the page and its counts land together.
 */
import { useAppQuery } from '../../query';
import { customToolService } from '..';
import { hookKeys } from './hookKeys';

type CustomToolParams = Parameters<typeof customToolService.listCustomTools>[0];

export const useCustomToolsQuery = (params: CustomToolParams, enabled = true) =>
  useAppQuery({
    queryKey: hookKeys.customTools(params ?? {}),
    queryFn: () => customToolService.listCustomTools(params),
    enabled,
  });

export const useCustomToolsPageQuery = (params: { page: number; limit: number; search: string }) =>
  useAppQuery({
    queryKey: hookKeys.customToolsPage(params),
    queryFn: async () => {
      const res = await customToolService.listCustomTools(params);
      const entries = await Promise.all(
        res.data.map(async (t) => [t.id, (await customToolService.getUsage(t.id)).count] as const),
      );
      return { items: res.data, total: Number(res.pagination?.total) || res.data.length, usage: Object.fromEntries(entries) };
    },
  });
