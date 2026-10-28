/**
 * [FEAT-20261016-TAGBIND] What the "ผูก tag" button WILL do to one tool's template tags —
 * decided before anything is written. Pure (no I/O): the service reads, this decides, the
 * service writes exactly what this returned.
 * ===========================================================================
 * Owner 16/10/2026: a dynamic tag only answers on an OA it is bound to
 * (`buildDynamicTagQuery`, `ai/rag-engine.service.ts:698`) — an unbound `[[ins_x_*]]` is a
 * silent N/A. So the Custom Tools page gets a button that binds the template's tags to every
 * OA using that tool, in its own module so the rule is easy to change.
 *
 * THE RULES, per template tag (in template order):
 *   · its `sub_type` is not an endpoint of THIS tool       → skip `endpoint_absent`
 *     (DYNAMIC: what binds follows the tool's real endpoints — a tool without
 *      CUSTOMER_PROFILE never gets the profile tags; nothing is listed by name)
 *   · no row with that name                                 → insert (bound to the OAs)
 *   · a row, soft-deleted                                   → skip `deleted`
 *     (the name stays reserved by the unique index; someone deleted it on purpose)
 *   · a row WITHOUT the template marker in `detail`         → skip `not_template`
 *     (an admin's own tag that happens to share the name — never touched)
 *   · a template row in single-OA mode (`hook_id` set)      → skip `single_oa`
 *     (the form forbids mixing modes; switching it would be a decision, not a bind)
 *   · a template row missing some of the OAs                → bind (ADD only — `$addToSet`)
 *   · a template row that already has every OA              → already
 * Never removes an OA, never rewrites a value / sub_type / detail.
 *
 * The insert row is the seed CLI's own row (`planTags`), so the mint, the button and
 * `seed-custom-tool` write tags of one shape.
 *
 * revert: delete `src/modules/hooks/tool-tag-bind/` and its two lines in `hooks.module.ts`.
 */
import { planTags } from '@/cli/custom-tool-seed/seed-plan';
import type { SeedBundle } from '@/cli/custom-tool-seed/seed-bundle.types';

import { toIdString } from '../coerce';

/** The fields the plan needs from an existing `dynamic_tags` row (any deletion state). */
export interface ExistingTagRow {
  _id: unknown;
  tag: string;
  detail?: unknown;
  hook_id?: unknown;
  hook_ids?: unknown[];
  deleted_at?: unknown;
}

export type TagBindSkipReason =
  'endpoint_absent' | 'deleted' | 'not_template' | 'single_oa';

export type TagBindAction =
  | { kind: 'insert'; tag: string; doc: Record<string, unknown> }
  | {
      kind: 'bind';
      tag: string;
      id: unknown;
      add: unknown[];
      before: unknown[];
    }
  | { kind: 'already'; tag: string }
  | { kind: 'skip'; tag: string; reason: TagBindSkipReason };

/* an ObjectId and its hex string compare equal */
const idStr = (v: unknown): string => toIdString(v);

export function planTagBind(input: {
  template: SeedBundle;
  /** the endpoint keys of the tool being bound (as stored — upper-case) */
  toolEndpointKeys: readonly string[];
  /** every row holding one of the template's names, deleted ones included */
  existing: readonly ExistingTagRow[];
  /** the OAs using the tool (`hooks.custom_tool_id`) */
  hookIds: readonly unknown[];
  now: Date;
}): TagBindAction[] {
  const keys = new Set(input.toolEndpointKeys.map((k) => k.toUpperCase()));
  const byName = new Map(input.existing.map((e) => [e.tag, e]));
  /* the seed's row for every template tag, bound to nobody yet — one definition of a tag row */
  const seedRows = new Map(
    planTags(input.template, [], null, input.now).flatMap((a) =>
      a.kind === 'insert' ? [[a.tag, a.doc] as const] : [],
    ),
  );

  return input.template.tags.map((t): TagBindAction => {
    if (!keys.has(t.sub_type.toUpperCase())) {
      return { kind: 'skip', tag: t.tag, reason: 'endpoint_absent' };
    }
    const row = byName.get(t.tag);
    if (!row) {
      return {
        kind: 'insert',
        tag: t.tag,
        doc: { ...seedRows.get(t.tag), hook_ids: [...input.hookIds] },
      };
    }
    if (row.deleted_at) return { kind: 'skip', tag: t.tag, reason: 'deleted' };
    const detail = typeof row.detail === 'string' ? row.detail : '';
    if (!detail.includes(input.template.tagMarker)) {
      return { kind: 'skip', tag: t.tag, reason: 'not_template' };
    }
    if (row.hook_id) return { kind: 'skip', tag: t.tag, reason: 'single_oa' };
    const before = Array.isArray(row.hook_ids) ? row.hook_ids : [];
    const have = new Set(before.map(idStr));
    const add = input.hookIds.filter((h) => !have.has(idStr(h)));
    return add.length > 0
      ? { kind: 'bind', tag: t.tag, id: row._id, add, before }
      : { kind: 'already', tag: t.tag };
  });
}
