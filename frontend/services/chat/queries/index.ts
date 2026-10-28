/**
 * [FEAT-20261027-TANSTACK] Query hooks of the `chat` service group — NON-realtime reads only.
 *
 * 🔴 Owner rule (27/10): ticket realtime must not move — list, meta, no-case, WS,
 *    partial fetch, counts and notifications stay exactly as written in
 *    pages/chat/TicketChat.tsx. Nothing on that path may be added here.
 *    ท่อ realtime ของ ticket ห้ามย้ายมาที่นี่
 *
 * Two reads (handoff targets · the Assign History screen); split like services/hook/queries/ at three.
 * The service comes through the `services/chat` BARREL (tests mock it).
 */
import { useAppQuery, usePageQuery, POLL_INTERVAL_MS, QUERY_ROOT } from '../../query';
import { handoffService, assignHistoryService } from '..';

type TargetParams = Parameters<typeof handoffService.listTargets>[0];
type AssignHistoryParams = Parameters<typeof assignHistoryService.getAssignHistories>[0];

export const chatKeys = {
  all: [QUERY_ROOT.chat] as const,
  handoffTargets: (params: Record<string, unknown>) => [QUERY_ROOT.chat, 'handoffTargets', params] as const,
  assignHistories: (params: Record<string, unknown>) => [QUERY_ROOT.chat, 'assignHistories', params] as const,
};

export const useHandoffTargetsQuery = (params: TargetParams, enabled = true) =>
  useAppQuery({
    queryKey: chatKeys.handoffTargets(params ?? {}),
    queryFn: () => handoffService.listTargets(params),
    enabled,
  });

/** The Assign History screen — admin audit of who was assigned which case, not the live ticket path. */
export const useAssignHistoryPageQuery = (params: AssignHistoryParams, gate: { paused: boolean; onError?: (error: Error) => void }) =>
  usePageQuery({
    queryKey: chatKeys.assignHistories(params ?? {}),
    queryFn: () => assignHistoryService.getAssignHistories(params),
    poll: { everyMs: POLL_INTERVAL_MS.assignHistory, paused: gate.paused },
    onFailure: 'clear',
    onError: gate.onError,
  });
