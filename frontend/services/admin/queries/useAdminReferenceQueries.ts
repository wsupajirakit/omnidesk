/**
 * [FEAT-20261027-TANSTACK] Shared admin reference data — groups and system configs.
 *
 * Same params ⇒ same key ⇒ one cache entry shared by every screen and modal that
 * asks the same question (the Hook list and the Hook form both ask
 * `listGroups({ status: true, limit: 100 })`). Freshness is unchanged: each mount
 * still refetches (QUERY_DEFAULTS.staleTimeMs = 0).
 *
 * Services come through the `services/admin` BARREL so tests that mock either the
 * barrel or the leaf file (`services/admin/configService`) still intercept them.
 */
import { useAppQuery, queryClient } from '../../query';
import { groupService, configService } from '..';
import { adminKeys } from './adminKeys';

type GroupParams = Parameters<typeof groupService.listGroups>[0];
type ConfigParams = Parameters<typeof configService.listConfigs>[0];

export const useGroupsQuery = (params: GroupParams, enabled = true) =>
  useAppQuery({
    queryKey: adminKeys.groups(params ?? {}),
    queryFn: () => groupService.listGroups(params),
    enabled,
  });

/**
 * Re-run a groups read ONLY if its last attempt failed and nothing is in flight.
 * Reads the live cache state at call time (not a render's snapshot), so an event
 * handler bound in a render that predates the failure still sees it — the old
 * "retry on next focus" latch in the hook form depends on exactly that.
 */
export const refetchGroupsIfFailed = (params: GroupParams) => {
  const queryKey = adminKeys.groups(params ?? {});
  const state = queryClient.getQueryState(queryKey);
  if (state?.status === 'error' && state.fetchStatus === 'idle') {
    void queryClient.refetchQueries({ queryKey, exact: true });
  }
};

export const useConfigsQuery = (params: ConfigParams, enabled = true) =>
  useAppQuery({
    queryKey: adminKeys.configs(params ?? {}),
    queryFn: () => configService.listConfigs(params),
    enabled,
  });

/**
 * The `acme_category` flag read by several screens out of `listConfigs({ limit: 200 })`.
 * Absent / unreadable config ⇒ false, the safe default every caller already used.
 */
export const useAcmeCategoryFlag = (): boolean => {
  const { data } = useConfigsQuery({ limit: 200 });
  const row = (data?.data || []).find((c: { key?: string }) => c.key === 'acme_category') as { value?: unknown } | undefined;
  const v = row?.value;
  return v === true || v === 1 || v === 'true';
};
