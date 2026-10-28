/**
 * [FEAT-20261027-TANSTACK] Query hooks of the `messaging` service group.
 * One read so far (the Auto Replies screen, on the shared list-page contract);
 * split into keys + hooks like services/hook/queries/ when a second read arrives.
 * Broadcasts deliberately stays on its own poller (pages/messaging/broadcastPolling.ts):
 * its rows are patched optimistically with rollback, so a query would add code, not remove it.
 * The service comes through the `services/messaging` BARREL (tests mock it).
 */
import { usePageQuery, POLL_INTERVAL_MS, QUERY_ROOT } from '../../query';
import { autoReplyService } from '..';

type AutoReplyParams = Parameters<typeof autoReplyService.listAutoReplies>[0];

export const messagingKeys = {
  all: [QUERY_ROOT.messaging] as const,
  autoReplies: (params: Record<string, unknown>) => [QUERY_ROOT.messaging, 'autoReplies', params] as const,
};

export const useAutoRepliesPageQuery = (params: AutoReplyParams, gate: { paused: boolean; onError?: (error: Error) => void }) =>
  usePageQuery({
    queryKey: messagingKeys.autoReplies(params ?? {}),
    queryFn: () => autoReplyService.listAutoReplies(params),
    poll: { everyMs: POLL_INTERVAL_MS.autoReplies, paused: gate.paused },
    onFailure: 'clear',
    onError: gate.onError,
  });
