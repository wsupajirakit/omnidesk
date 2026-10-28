/**
 * [FEAT-20261027-TANSTACK] The polled admin list screens (Users · Groups · SystemConfig · AuditLogs).
 * Each one is `usePageQuery` with `poll` + `onFailure: 'clear'` (services/query/usePageQuery.ts)
 * with that screen's own service call, key and interval. Services come through the
 * `services/admin` barrel so tests that mock it still intercept them.
 */
import { usePageQuery, POLL_INTERVAL_MS } from '../../query';
import { userService, groupService, configService, auditService } from '..';
import { adminKeys } from './adminKeys';

type Gate = { paused: boolean; onError?: (error: Error) => void };
const polled = (everyMs: number, gate: Gate) => ({ poll: { everyMs, paused: gate.paused }, onFailure: 'clear' as const, onError: gate.onError });
type UserParams = Parameters<typeof userService.listUsers>[0];
type GroupParams = Parameters<typeof groupService.listGroups>[0];
type ConfigParams = Parameters<typeof configService.listConfigs>[0];
type AuditParams = Parameters<typeof auditService.listHookAuditLogs>[0];

export const useUsersPageQuery = (params: UserParams, gate: Gate) =>
  usePageQuery({ queryKey: adminKeys.users(params ?? {}), queryFn: () => userService.listUsers(params), ...polled(POLL_INTERVAL_MS.users, gate) });

export const useGroupsPageQuery = (params: GroupParams, gate: Gate) =>
  usePageQuery({ queryKey: adminKeys.groups(params ?? {}), queryFn: () => groupService.listGroups(params), ...polled(POLL_INTERVAL_MS.groups, gate) });

export const useConfigsPageQuery = (params: ConfigParams, gate: Gate) =>
  usePageQuery({ queryKey: adminKeys.configs(params ?? {}), queryFn: () => configService.listConfigs(params), ...polled(POLL_INTERVAL_MS.systemConfig, gate) });

export const useAuditLogsPageQuery = (params: AuditParams, gate: Gate) =>
  usePageQuery({ queryKey: adminKeys.auditLogs(params ?? {}), queryFn: () => auditService.listHookAuditLogs(params), ...polled(POLL_INTERVAL_MS.auditLogs, gate) });
