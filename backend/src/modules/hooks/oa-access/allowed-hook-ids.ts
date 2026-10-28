/**
 * ==== [FIX-20260818-OAACCESSONE] One answer to "which OAs may this caller touch"
 * plan §7.1 = C2 + C3 = T3-2 of fix_plan_18_aug · closes root C2-A of audit_18_aug
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS. The same question was answered by five copies of the same
 * function, and three of them had drifted — each missing the middle tier:
 *
 *   authority (correct, 3 tiers) : modules/tickets/tickets.service.ts
 *   drifted (2 tiers)            : modules/chat/chat.service.ts
 *                                  modules/auth/ws-ticket.service.ts
 *                                  modules/tickets/assign-histories.service.ts (inlined)
 *
 * The missing tier is `allowed_hooks`, the PER-USER whitelist. Without it an
 * operator provisioned for one OA is silently scoped to EVERY OA in their group.
 * That was found and fixed once already — `[FIX-20260808-ACLWHITELIST]` — but only
 * in the copy the fixer happened to be reading, so the leak survived in the others.
 * `ws-ticket.service.ts` is the sharpest example: its own comment claimed it was
 * "kept byte-identical" to the HTTP path while missing this tier, so the realtime
 * stream fanned out OAs the REST API would have refused.
 *
 * THE RULE THIS ENCODES (ported from legacy `oaAccess.js:17-32`, order matters):
 *   1. super user            → `null` = every OA, no filter
 *   2. `allowed_hooks` array → exactly those ids; WINS over the group fallback
 *   3. otherwise             → every OA inside the caller's groups ( [] if none )
 *
 * `null` and `[]` are NOT interchangeable: `null` means "do not filter", `[]` means
 * "filter to nothing". A caller that treats a missing value as `null` grants
 * everything — which is why every consumer must handle both explicitly.
 *
 * PLACEMENT. It lives in the hooks module because it queries the `Hook` model, and
 * every consumer already imports `@/modules/hooks`, so this adds no module edge.
 * It stays a pure function taking `hookModel` as an argument rather than an
 * injectable service: that keeps the existing call shape, so no consumer's DI or
 * test stub changes. ตัวเดียว ใช้ร่วมกันทุกที่ — แก้ที่เดียวจบ
 *
 * revert: restore the local copies in the four consumers and delete this file plus
 *         its barrel export. The leak returns with them.
 */

import { ForbiddenException } from '@nestjs/common';
import { isValidObjectId } from 'mongoose';

import { isSuperUser } from '@/common/auth/super-role';
import type { AuthenticatedUser } from '@/common/types/authenticated-user';

/**
 * ==== [FIX-20260818-HOOKWRITESCOPE] Why this is not `Model<HookDocument>`.
 *
 * Callers hold the Hook model under two different generics — `Model<Hook>` in
 * `hooks.service.ts` and `hook-outbound.service.ts`, `Model<HookDocument>` in the
 * eight others — and demanding one of them ripples into queries that have
 * nothing to do with scoping: tightening `hooks.service.ts` broke an unrelated
 * `updateMany` filter three hundred lines away.
 *
 * So this asks for the only capability it uses — find hooks by group, read their
 * ids — and every caller satisfies it structurally with no change at all.
 * ขอเฉพาะสิ่งที่ใช้จริง แล้วไม่มีใครต้องแก้ตาม
 */
export interface HookScopeSource {
  find(filter: Record<string, unknown>): {
    select(projection: string): {
      lean(): PromiseLike<Array<{ _id: unknown }>>;
    };
  };
}

/**
 * ⚠️ "Who is super" is NOT re-implemented here. `common/auth/super-role.ts` already
 * owns that answer, and its own header records what happened the last time the
 * comparison was written inline: it spread to six files and drifted. Copying it
 * into this file — the file whose entire purpose is to end copies — would have
 * been the same mistake wearing a different name.
 */

/**
 * The OA ids this caller may act on, or `null` when they may act on all of them.
 *
 * @param user      the authenticated caller (absent = treated as unprivileged)
 * @param hookModel the Hook model of the calling module — passed in, not injected,
 *                  so this stays a pure function every existing test can stub
 */
export async function getAllowedHookIds(
  user: AuthenticatedUser | null | undefined,
  hookModel: HookScopeSource,
): Promise<string[] | null> {
  if (isSuperUser(user)) return null;

  /**
   * TIER 2 — the per-user whitelist, checked BEFORE the group fallback.
   * This is the tier the drifted copies were missing (see the header). An
   * operator with `allowed_hooks: [OA1]` is scoped to OA1 even when their group
   * contains OA2 and OA3.
   */
  if (Array.isArray(user?.allowedHooks)) {
    return user.allowedHooks
      .filter((id) => isValidObjectId(id))
      .map((id) => String(id));
  }

  const groupIds = Array.isArray(user?.groups)
    ? user.groups.filter((id) => isValidObjectId(id))
    : [];

  // No group at all ⇒ nothing, never "everything". Fail closed.
  if (groupIds.length === 0) return [];

  const hooks = await hookModel
    .find({ group: { $in: groupIds } })
    .select('_id')
    .lean();

  return hooks.map((h) => String(h._id));
}

/**
 * True when `hookId` is outside the caller's scope — the check every consumer
 * repeats today, written once so `null` (= no filter) cannot be mishandled.
 */
export function isHookOutOfScope(
  allowed: string[] | null,
  hookId: unknown,
): boolean {
  if (allowed === null) return false;
  return !allowed.includes(String(hookId));
}

/**
 * The same scope as a Mongo filter fragment, for queries that must be scoped
 * ATOMICALLY rather than checked after loading.
 *
 * Spread it into a filter: `{ _id: id, ...scopeFilter(allowed) }`. Use this
 * whenever the row is being WRITTEN — a read-then-check leaves a window where
 * the row moves out of scope between the two, and on `assist_status` (the atomic
 * hand-off claim) that window is exactly what must not exist.
 *
 * `null` → `{}` (super: no filter). `[]` → a filter that matches nothing, which
 * is the fail-closed answer and not the same thing as "no filter".
 *
 * @param fields which column(s) carry the OA. Defaults to `hook_id`, which is
 *   what chat rooms and slips use. `tickets` needs BOTH of its columns: measured
 *   on the live data, `line_oa_hook_id` is set on 141/141 rows while `hook_id` is
 *   null on one, so matching either is what keeps that row reachable by its owner
 *   instead of by everyone. Passing the field names here — rather than each caller
 *   rebuilding the filter — is what keeps the `null` vs `[]` decision in one place.
 */
export function scopeFilter(
  allowed: string[] | null,
  fields: readonly string[] = ['hook_id'],
): Record<string, unknown> {
  if (allowed === null) return {};
  const [only] = fields;
  if (fields.length === 1 && only) return { [only]: { $in: allowed } };
  return { $or: fields.map((field) => ({ [field]: { $in: allowed } })) };
}

/**
 * ==== [FIX-20260818-HOOKWRITESCOPE] The same question, asked the same way.
 *
 * `isHookOutOfScope` answers it; this throws on the answer. It lives here rather
 * than as a private method on each service because it was about to exist twice
 * within an hour — once in `hook-outbound.service.ts` and once in
 * `hooks.service.ts` — and the header of this very file records what happened the
 * last time that question was answered in more than one place: five copies, three
 * of them silently missing a tier.
 *
 * The message is deliberately the one every other scope refusal in this codebase
 * already uses, so a caller cannot tell which layer refused it.
 */
export async function assertHookInScope(
  user: AuthenticatedUser | null | undefined,
  hookModel: HookScopeSource,
  hookId: unknown,
): Promise<void> {
  const allowed = await getAllowedHookIds(user, hookModel);
  if (isHookOutOfScope(allowed, hookId)) {
    throw new ForbiddenException('insufficient OA access');
  }
}
