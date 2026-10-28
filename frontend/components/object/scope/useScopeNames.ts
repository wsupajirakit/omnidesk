/**
 * [FEAT-20260901-OBJSCOPECELL] id → display name, for the scope column.
 *
 * Both list pages render a scope cell per row, and a row holds ids. Looking a
 * name up per row would be one request per row; this loads each catalogue ONCE
 * per page and hands back two plain maps.
 *
 * The OA catalogue is the whole visible set, not per-group: a row can name an
 * OA whose group is not in the same row, and a name that resolves to a raw id
 * is worse than useless in a list.
 *
 * Failure is not fatal. An unresolved id falls back to printing the id, which
 * is ugly but honest; blocking the list because a name lookup failed would be
 * worse.
 */
import { useEffect, useState } from 'react';

import { fetchVisibleGroups } from '../../../services/admin';
import { webhookService } from '../../../services/hook';

export interface ScopeNames {
  groupNames: Record<string, string>;
  hookNames: Record<string, string>;
}

export function useScopeNames(enabled = true): ScopeNames {
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [hookNames, setHookNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!enabled) return;
    let isActive = true;

    fetchVisibleGroups()
      .then((list) => {
        if (!isActive) return;
        const map: Record<string, string> = {};
        for (const g of list) map[String(g._id)] = g.group_name || String(g._id);
        setGroupNames(map);
      })
      .catch((err) => console.error('Failed to load group names', err));

    /* Positional args — `getHooks(page, limit, search)`. */
    webhookService
      .getHooks(1, 200, '')
      .then((res: unknown) => {
        if (!isActive) return;
        const rows = (
          Array.isArray(res)
            ? res
            : ((res as { data?: unknown[] })?.data ?? [])
        ) as Array<{ _id: string; line_oa_name?: string; alias?: string }>;
        const map: Record<string, string> = {};
        for (const h of rows) {
          map[String(h._id)] = h.line_oa_name || h.alias || String(h._id);
        }
        setHookNames(map);
      })
      .catch((err) => console.error('Failed to load OA names', err));

    return () => {
      isActive = false;
    };
  }, [enabled]);

  return { groupNames, hookNames };
}

export default useScopeNames;
