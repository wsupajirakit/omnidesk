import { API_BASE_URL, authFetch, handleApiResponse } from '../apiClient';

/**
 * [FEAT-20260816-GROUPSCOPECLONE] Copy one group's dynamic tags + flex cards
 * onto other groups.
 *
 * Two calls, one body: `preview` counts and writes nothing, `apply` performs the
 * write. The screen always previews first — the operation touches hundreds of
 * documents and an operator who picked the wrong source deserves to see the
 * number before, not after.
 *
 * ⚠️ ADD, not replace. `mode: 'remove'` with the SAME body is the exact undo.
 * The neighbouring bulk-scope modal REPLACES a tag's scope; these two look alike
 * on screen, so the wording in the modal says which one this is.
 *
 * Custom tools are not part of this: they carry no group field at all (the
 * hook→tool link lives on the hook), so there is nothing to copy for a group.
 */

export interface ScopeCloneInclude {
  dynamic_tags: boolean;
  flex_messages: boolean;
}

export interface ScopeCloneRequest {
  source_group_id: string;
  target_group_ids: string[];
  include: ScopeCloneInclude;
  mode?: 'add' | 'remove';
}

export interface ScopeCloneTargetResult {
  group_id: string;
  dynamic_tags: number;
  flex_messages: number;
}

export interface ScopeCloneResult {
  applied: boolean;
  mode: 'add' | 'remove';
  source_group_id: string;
  source_totals: { dynamic_tags: number; flex_messages: number };
  targets: ScopeCloneTargetResult[];
}

/**
 * The request the screen sends. Pure on purpose: it is the only place that
 * decides what a selection MEANS, so it is the piece worth testing without a
 * browser (`test/groupScopeClone.value.test.ts`).
 */
export const buildScopeCloneRequest = (
  sourceGroupId: string,
  targetGroupIds: string[],
  include: ScopeCloneInclude,
  mode: 'add' | 'remove' = 'add'
): ScopeCloneRequest => ({
  source_group_id: sourceGroupId,
  // a group can never be its own target — the API refuses it, and silently
  // sending it would turn an undo into "strip the source of its own tags"
  target_group_ids: Array.from(new Set(targetGroupIds.filter(id => id && id !== sourceGroupId))),
  include,
  mode
});

/** true when the request is worth sending at all */
export const isScopeCloneReady = (req: ScopeCloneRequest): boolean =>
  Boolean(req.source_group_id) &&
  req.target_group_ids.length > 0 &&
  (req.include.dynamic_tags || req.include.flex_messages);

/** totals across every target, for the one-line summary under the table */
export const sumScopeCloneTargets = (result: ScopeCloneResult | null): { dynamic_tags: number; flex_messages: number } =>
  (result?.targets ?? []).reduce(
    (acc, target) => ({
      dynamic_tags: acc.dynamic_tags + (target.dynamic_tags || 0),
      flex_messages: acc.flex_messages + (target.flex_messages || 0)
    }),
    { dynamic_tags: 0, flex_messages: 0 }
  );

const post = async (path: string, body: ScopeCloneRequest, label: string): Promise<ScopeCloneResult> => {
  const response = await authFetch(`${API_BASE_URL}/api/groups/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return handleApiResponse<ScopeCloneResult>(response, label);
};

export const groupScopeService = {
  preview: (body: ScopeCloneRequest) => post('scope-clone/preview', body, 'preview group scope clone'),
  apply: (body: ScopeCloneRequest) => post('scope-clone', body, 'apply group scope clone'),

  /**
   * Create-time clone: one source onto the group that was just created, both
   * halves included. A SECOND call on purpose — `POST /api/groups` keeps its
   * contract, and a copy that fails still leaves a usable group the operator can
   * retry on from the row action, rather than a 500 from a create that already
   * happened.
   */
  cloneOnCreate: (sourceGroupId: string, newGroupId: string) =>
    post(
      'scope-clone',
      buildScopeCloneRequest(sourceGroupId, [newGroupId], {
        dynamic_tags: true,
        flex_messages: true
      }),
      'clone group scope on create'
    )
};
