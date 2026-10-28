/**
 * ==== [FEAT-20261027-TANSTACK] one list page read — the contract the list screens hand-wrote ====
 *
 * Every list screen moved so far did the same few things by hand; they live here once:
 *   · read on mount and whenever the key (page / filters / search) changes
 *   · `loading` is true during EVERY read (poll included) — these screens always showed it
 *     (only the Hook list was made silent, by the owner, and it does not use this hook)
 *   · the previous key's rows stay on screen while the next key loads
 *   · `onError` once per failure that happened while this screen is mounted — a failure
 *     already in the cache from an earlier visit must not re-open an alert on arrival
 *   · a failure either CLEARS the rows (`onFailure: 'clear'` — the polled admin screens)
 *     or KEEPS the last good rows (`'keep'` — Flex / Object / Custom Tools), as each did
 *   · `poll` (optional) — the [FIX-20260809-POLLVIS] rule of Users / Groups / SystemConfig /
 *     AuditLogs / AutoReplies / AssignHistory: read every `everyMs` ONLY while the tab is
 *     visible, read again the moment it shows, both paused while a modal is open. A screen
 *     without `poll` never refetched on its own and still does not.
 * Pinned by test/requests/adminPollers.requests.test.tsx (polled) and
 * test/requests/contentLists.requests.test.tsx (not polled) — both pass on old and new code.
 * แก้สัญญาของหน้า list ที่นี่ที่เดียว
 * revert: delete this file and restore the screens from tag ckpt-after-tanstack-p1-demo-27102026.
 */
import { useEffect, useRef } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { useAppQuery } from './useAppQuery';

export interface PageQueryOptions<TPage> {
  queryKey: QueryKey;
  queryFn: () => Promise<TPage>;
  onFailure: 'clear' | 'keep';
  onError?: (error: Error) => void;
  poll?: { everyMs: number; paused: boolean };
}

export function usePageQuery<TPage>(opts: PageQueryOptions<TPage>) {
  const polling = !!opts.poll && !opts.poll.paused;
  const q = useAppQuery({
    queryKey: opts.queryKey,
    queryFn: opts.queryFn,
    refetchInterval: polling ? opts.poll!.everyMs : false,
    refetchOnWindowFocus: polling,
  });

  const lastGood = useRef<TPage | undefined>(undefined);
  if (q.data !== undefined && !q.isError) lastGood.current = q.data;

  const mountedAt = useRef(Date.now());
  const onError = useRef(opts.onError);
  onError.current = opts.onError;
  useEffect(() => {
    if (q.isError && q.error && q.errorUpdatedAt >= mountedAt.current) onError.current?.(q.error);
  }, [q.isError, q.error, q.errorUpdatedAt]);

  const cleared = q.isError && opts.onFailure === 'clear';
  return {
    /** the page to render — undefined after a failed read when onFailure is 'clear' */
    page: cleared ? undefined : (q.isError ? lastGood.current : (q.data ?? lastGood.current)),
    /** the last page that did load, kept through a failure (AssignHistory keeps its pager) */
    lastGoodPage: lastGood.current,
    loading: q.isFetching,
    refetch: q.refetch,
  };
}
