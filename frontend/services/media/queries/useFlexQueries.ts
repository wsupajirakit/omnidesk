/**
 * [FEAT-20261027-TANSTACK] Flex message reads (services/media/flexMessageService.ts, unchanged).
 * `useFlexMessagesQuery` — the template list the hook form picks from (fetched while the form is open).
 * `useFlexListPageQuery` — the Flex Message screen's page: no poll, loading on every read,
 *   a failed read keeps the rows (onFailure 'keep') — see services/query/usePageQuery.ts.
 * The service comes through the `services/media` BARREL (tests mock it).
 */
import { useAppQuery, usePageQuery } from '../../query';
import { flexMessageService } from '..';
import { mediaKeys } from './mediaKeys';

type FlexListParams = Parameters<typeof flexMessageService.listFlexMessages>[0];

export const useFlexMessagesQuery = (params: FlexListParams, enabled = true) =>
  useAppQuery({
    queryKey: mediaKeys.flexList(params ?? {}),
    queryFn: () => flexMessageService.listFlexMessages(params),
    enabled,
  });

export const useFlexListPageQuery = (params: FlexListParams, onError?: (error: Error) => void) =>
  usePageQuery({
    queryKey: mediaKeys.flexList(params ?? {}),
    queryFn: () => flexMessageService.listFlexMessages(params),
    onFailure: 'keep',
    onError,
  });
