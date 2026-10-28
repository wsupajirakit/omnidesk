/**
 * [FEAT-20260826-TKTFILTERPARAMS] 📖 docs/bottleneck_26_aug.md (S5 · layer 3 · 3a)
 * The customer's tier KEY — a verbatim port of the dashboard's own logic.
 * ============================================================================
 * WHY A PORT AND NOT AN AGGREGATION. The `tier` filter param must reproduce
 * the SCREEN's predicate exactly (`TicketChat.tsx:1853/:2038`):
 *
 *     tierKeyOf(tierOfMember(tk.line_user_data)) === filterTier
 *
 * and the FE pair is full of edges an aggregation re-write would drift on:
 *   · `tierOfMember` (omnidesk-console utils/memberTier.ts) chains `??` per
 *     LEVEL but gates the result with a TRUTHY check — so a raw tier of `''`
 *     falls through to `member.tier`, which `$ifNull` would NOT do;
 *   · `tierKeyOf` (TicketChat.tsx:477) skips `''` on code/name but KEEPS
 *     `level: 0` (Normal) — `||` would swallow it, `??` would keep `''`;
 *   · a primitive tier ("VIP", 3) is lowercased whole.
 * One function per side, ported line for line, with the FE refs above — when
 * the FE pair changes, THIS file must change with it (drift is caught by the
 * value tests in ticket-list-filter-params.spec.ts, which encode the FE
 * vectors). เขียนตามจอ ไม่ใช่ตามที่คิดว่าสมเหตุสมผล.
 *
 * Used by listTickets' `tier` param only: the scope's ticket-holding members
 * are fetched with a narrow projection and keyed HERE in Node — bounded by
 * the scope's customer count, never a collection scan.
 *
 * [FEAT-20260905-CUSTPROV PART 3] `tierOfMemberBE` no longer hardcodes the
 * three `raw_profile_data` paths — it walks an ordered `tierPaths` list, the
 * same shape `CustomerProvider.tierPaths` declares
 * (`customer-provider/providers/customer-provider.port.ts`). The default
 * below IS `shopapi_v1`'s three paths (today's only provider and the resolved
 * default for an unset `CUSTOMER_PROVIDER`), so a caller that passes nothing
 * — every caller today — behaves byte-identically to before this change. A
 * caller that HAS the active provider (`CustomerProviderService.resolve()`)
 * may pass `provider.tierPaths` instead, and a vendor whose tier sits
 * elsewhere is served without editing this file again. No caller does that
 * yet — this part only makes the parameter possible.
 * revert: delete this file + the `tier` branch in listTickets.
 */
import { readPath } from '@/common/utils/read-path';
import {
  DEFAULT_CUSTOMER_PROVIDER,
  type TierPath,
} from '@/modules/customer-provider';

/** Shape-loose on purpose — the upstream sends whatever it sends (FE does the same). */
export type MemberTierRef = {
  code?: unknown;
  name?: unknown;
  level?: unknown;
} | null;

/**
 * Today's three paths, read off the one provider entry that exists rather
 * than typed a second time here. `shopapi_v1` IS `DEFAULT_CUSTOMER_PROVIDER`
 * (`provider-entries.ts`), so this is `['data.profile.tier', 'profile.tier',
 * 'tier']` today — unchanged from before this file consumed the provider.
 */
const DEFAULT_TIER_PATHS: readonly TierPath[] =
  DEFAULT_CUSTOMER_PROVIDER.tierPaths;

/**
 * Port of `tierOfMember` — raw_profile first (truthy-gated), member.tier as
 * fallback.
 *
 * `tierPaths` are dot paths relative to `member.raw_profile_data`, most
 * specific first — exactly the contract `CustomerProvider.tierPaths` declares.
 *
 * 🔴 THE RULE IS `??` ACROSS THE PATHS, THEN ONE TRUTHY GATE AT THE END — and
 * that is not a detail. `omnidesk-console/utils/memberTier.ts:54-58` reads
 * `raw?.data?.profile?.tier ?? raw?.profile?.tier ?? raw?.tier` and only then
 * asks `if (fromRaw)`. So a tier of `''` at the FIRST path stops the chain and
 * falls to the `member.tier` COLUMN — it does NOT continue to the second path.
 *
 * A per-path truthy loop looks equivalent and is not: with `data.profile.tier`
 * empty and `profile.tier` populated, a loop answers the second path while the
 * dashboard answers the column. The ticket-list filter and the badge on the card
 * would then disagree about the same customer — which is the exact defect
 * `[FIX-20260810-TIERSOURCE]` exists to prevent, and why that file's header says
 * both sides must read through ONE rule. BE ต้องตอบเหมือน FE เป๊ะ ไม่ใช่ "ดีกว่า"
 *
 * Pinned by `customer-provider-tier.spec.ts`, which runs the dashboard's own
 * expression beside this one over the same vectors.
 */
export function tierOfMemberBE(
  member: unknown,
  tierPaths: readonly TierPath[] = DEFAULT_TIER_PATHS,
): unknown {
  if (!member || typeof member !== 'object') return null;
  const m = member as Record<string, unknown>;
  const raw = m['raw_profile_data'];
  /* `??` across the paths — the first NON-NULLISH value wins, even if it is
     falsy — and then a single truthy gate, exactly as the dashboard does. */
  let fromRaw: unknown = null;
  for (const path of tierPaths) {
    const value = readPath(raw, path);
    if (value !== undefined && value !== null) {
      fromRaw = value;
      break;
    }
  }
  if (fromRaw) return fromRaw;
  return m['tier'] ?? null;
}

/**
 * Same as `String()`. `code` / `name` / `level` / `tier` are typed `unknown`
 * (the upstream blob is shape-loose, per `MemberTierRef` above) but are
 * always primitives in practice, so this coercion is exactly the FE's
 * implicit `String()`. Pulling it into a plain `(value: unknown)` helper
 * clears four pre-existing `@typescript-eslint/no-base-to-string` errors on
 * this file (found 2026-09-05, unrelated to PART 3): the inline call sites
 * had narrower inferred types the rule flagged, a bare `unknown` parameter
 * does not.
 */
function tierPrimitiveToString(value: unknown): string {
  return String(value);
}

/** Port of `tierKeyOf` — '' on empty; code→name ('' skipped); level kept even at 0. */
export function tierKeyOfBE(tier: unknown): string {
  if (tier === null || tier === undefined || tier === '') return '';
  if (typeof tier === 'object') {
    const t = tier as MemberTierRef & Record<string, unknown>;
    const first = [t?.['code'], t?.['name']].find(
      (v) => v !== null && v !== undefined && tierPrimitiveToString(v) !== '',
    );
    const k = first !== undefined ? first : t?.['level'];
    return k === null || k === undefined || tierPrimitiveToString(k) === ''
      ? ''
      : tierPrimitiveToString(k).toLowerCase();
  }
  return tierPrimitiveToString(tier).toLowerCase();
}

/**
 * The one call sites use: member document → screen-identical tier key.
 *
 * `tierPaths` forwards to `tierOfMemberBE` unchanged (see there for the
 * contract) — optional so every existing caller keeps behaving exactly as
 * before.
 */
export const memberTierKey = (
  member: unknown,
  tierPaths: readonly TierPath[] = DEFAULT_TIER_PATHS,
): string => tierKeyOfBE(tierOfMemberBE(member, tierPaths));

/**
 * The ONLY member fields the two functions above read — the `tier` fetch
 * projects exactly these so the member read stays narrow.
 */
/**
 * The Mongo projection for the tier read — DERIVED from the same paths, never
 * typed a second time.
 *
 * 🔴 THIS WAS THE HOLE. The projection listed the three paths as literals, so a
 * provider whose tier sits at `meta.rank` would have had that field STRIPPED BY
 * THE QUERY before `tierOfMemberBE` ever saw it: the paths would have been
 * configurable and the answer would still have been `null`, with nothing to say
 * why. Found by the agent that did PART 3, flagged rather than left.
 * เปลี่ยน path ได้แต่ query ยังดึงของเก่า = แก้แล้วเหมือนไม่ได้แก้
 *
 * `tier: 1` is always included — it is the fallback column, not a vendor path.
 */
export function tierKeyProjection(
  tierPaths: readonly TierPath[] = DEFAULT_TIER_PATHS,
): Record<string, 1> {
  const projection: Record<string, 1> = { tier: 1 };
  for (const path of tierPaths) projection[`raw_profile_data.${path}`] = 1;
  return projection;
}

/**
 * Today's projection. Identical to the literal it replaces — `tier`,
 * `raw_profile_data.data.profile.tier`, `raw_profile_data.profile.tier`,
 * `raw_profile_data.tier` — because `DEFAULT_TIER_PATHS` is `shopapi_v1`'s chain.
 * Pinned by `customer-provider-tier.spec.ts`.
 */
export const TIER_KEY_PROJECTION = tierKeyProjection();
