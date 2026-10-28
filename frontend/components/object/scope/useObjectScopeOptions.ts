/**
 * [FEAT-20260901-OBJSCOPE] Groups and OAs for the Object scope pickers.
 *
 * The load rules are `BroadcastFormModal.tsx:287-298` and `:322-371`, extracted
 * once instead of copied into the category modal and the album modal. What that
 * form learned the hard way and this keeps:
 *
 *  · groups come from `fetchVisibleGroups()` — super sees all active groups,
 *    everyone else sees active ∩ their own. One shared helper, no per-form rule
 *    to drift.
 *  · the OA list is the union over EVERY ticked group, deduped by `_id`: one OA
 *    reachable through two ticked groups must appear once.
 *  · one group failing to load is skipped, not fatal — an operator with one bad
 *    group can still pick from the rest.
 *  · no group ticked ⇒ no OA list. There is nothing to choose from yet, and
 *    showing every OA in the system would invite picking one the scope cannot
 *    express.
 *  · every async result is dropped when the modal closed or the picks changed
 *    underneath, so a slow response cannot overwrite a newer one.
 *
 * revert: delete this folder and the `<ObjectScopePicker>` usages.
 */
import { useEffect, useMemo, useState } from 'react';

import { fetchVisibleGroups, type VisibleGroup } from '../../../services/admin';
import { webhookService } from '../../../services/hook';
import type { HookData } from '../../../types';

export interface ObjectScopeOptions {
  groups: VisibleGroup[];
  groupsLoading: boolean;
  hooks: HookData[];
  hooksLoading: boolean;
}

export function useObjectScopeOptions(
  isOpen: boolean,
  pickedGroupIds: readonly string[],
): ObjectScopeOptions {
  const [groups, setGroups] = useState<VisibleGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [hooks, setHooks] = useState<HookData[]>([]);
  const [hooksLoading, setHooksLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    setGroupsLoading(true);
    fetchVisibleGroups()
      .then((list) => {
        if (isActive) setGroups(list);
      })
      .catch((err) => {
        console.error('Failed to load groups', err);
        if (isActive) setGroups([]);
      })
      .finally(() => {
        if (isActive) setGroupsLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen]);

  /* A stable string, so re-ticking the same groups in a different order does
     not refetch. Same trick as `groupPickKey` in the broadcast form. */
  const groupPickKey = useMemo(
    () => [...pickedGroupIds].map(String).filter(Boolean).sort().join(','),
    [pickedGroupIds],
  );

  useEffect(() => {
    if (!isOpen) return;
    let isActive = true;
    const groupIds = groupPickKey ? groupPickKey.split(',') : [];

    if (groupIds.length === 0) {
      setHooks([]);
      setHooksLoading(false);
      return () => {
        isActive = false;
      };
    }

    setHooksLoading(true);
    Promise.all(
      groupIds.map((id) =>
        webhookService.getHooksByGroup(id).catch((err) => {
          console.error('Failed to load hooks for group', id, err);
          return [] as HookData[];
        }),
      ),
    )
      .then((lists) => {
        if (!isActive) return;
        const seen = new Map<string, HookData>();
        for (const list of lists) {
          for (const hook of list || []) seen.set(String(hook._id), hook);
        }
        setHooks([...seen.values()]);
      })
      .finally(() => {
        if (isActive) setHooksLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [isOpen, groupPickKey]);

  return { groups, groupsLoading, hooks, hooksLoading };
}

export default useObjectScopeOptions;
