/**
 * [FEAT-20261027-TANSTACK] Hook list page reads (pages/hook/WebhookList.tsx).
 *
 * `useHookListQuery` — one server page of OAs (`webhookService.getHooksPaged`,
 * unchanged). Keeping the previous rows on screen while a new page loads is the
 * PAGE's job (WebhookList `lastGoodPage`), because it must also survive a failed
 * load — a placeholder would not.
 * `useHookTagsQuery` — the tag filter options (`GET /hook/tags`), once per mount.
 *
 * Services are imported through the `services/hook` BARREL on purpose: tests mock
 * that barrel, and a direct file import would slip past their mocks.
 */
import { useAppQuery } from '../../query';
import { webhookService } from '..';
import { hookKeys } from './hookKeys';

export type HookListParams = Parameters<typeof webhookService.getHooksPaged>[0];

export const useHookListQuery = (
  params: HookListParams,
  options: { pollMs?: number | false } = {},
) =>
  useAppQuery({
    queryKey: hookKeys.list(params),
    queryFn: () => webhookService.getHooksPaged(params),
    refetchInterval: options.pollMs ?? false,
  });

export const useHookTagsQuery = () =>
  useAppQuery({
    queryKey: hookKeys.tags(),
    queryFn: () => webhookService.getHookTags(),
  });
