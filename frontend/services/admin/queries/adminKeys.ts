/** [FEAT-20261027-TANSTACK] Query keys of the `admin` service group (groups, configs, users, audit logs). */
import { QUERY_ROOT } from '../../query';

export const adminKeys = {
  all: [QUERY_ROOT.admin] as const,
  groups: (params: Record<string, unknown>) => [QUERY_ROOT.admin, 'groups', params] as const,
  configs: (params: Record<string, unknown>) => [QUERY_ROOT.admin, 'configs', params] as const,
  users: (params: Record<string, unknown>) => [QUERY_ROOT.admin, 'users', params] as const,
  auditLogs: (params: Record<string, unknown>) => [QUERY_ROOT.admin, 'auditLogs', params] as const,
};
