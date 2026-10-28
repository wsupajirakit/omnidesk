/**
 * ==== [FEAT-20260814-SITERULESCACHE] Which endpoint may be cached, and for how long ====
 *
 * WHAT: one pure decision — "is this the site-rules endpoint, and if so what TTL
 * does it get?" No Redis, no I/O, no service dependency, so it is testable on its
 * own and cannot fail at runtime.
 *
 * WHY IT EXISTS (owner order 2026-08-13 evening): site rules are the same block
 * for every member of an OA, yet they were re-fetched on EVERY inbound event.
 * Measured on the live log: 9 webhooks produced 9 SITE_RULES calls, 1:1, six of
 * them inside 47 seconds. Caching them per hook removes that entirely.
 * ยิงทุก event ทั้งที่ข้อมูลเหมือนกันทั้ง OA — cache ต่อ hook จบเลย.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ SCOPE — SITE RULES ONLY. Every other endpoint keeps firing live.
 * ═══════════════════════════════════════════════════════════════════════════
 * profile / link / topup / walletpay MUST stay live: a cached balance or account
 * state is worse than any number of upstream calls. This file is the only place
 * that decides membership, so widening the blast radius means editing here — it
 * cannot happen by accident somewhere else. เส้นอื่นห้ามแตะ ต้องสดเสมอ.
 *
 * ⚠️ WHY TWO WAYS TO IDENTIFY THE ENDPOINT (both are required)
 * The production tool `Shop-API v1` carries key `SITE_RULES` with an EMPTY role —
 * verified in the live DB on 2026-08-13. A `role === 'site_rules'` check alone
 * would therefore match nothing and this whole feature would be silent dead
 * code. The key regex is what actually fires today; the role check is what will
 * fire once tools are authored with roles. Same pair of tests
 * `custom-tool.service.ts:1357-1358` already uses to find the block — kept
 * identical on purpose rather than invented here.
 * ⚠️ ห้ามตัด key regex ทิ้ง — ของจริง role ว่าง ถ้าเช็คแต่ role = ไม่ทำงานเลย
 *
 * ⚠️ WHY THE FALLBACK TTL IS LOAD-BEARING, NOT A CONVENIENCE
 * `cache_ttl_sec` exists on the schema, but `custom-tool-normalize.ts:16-21`
 * deliberately DROPS it from its write whitelist (a legacy-parity decision).
 * So a value seeded into the database disappears the first time an admin saves
 * that tool, and every endpoint in the live DB reads `null` today. Relying on
 * the stored value alone would mean the cache silently switches itself off.
 * The fallback is the path that actually runs. ค่าใน DB หายตอน save — fallback คือตัวจริง
 *
 * revert: delete this folder, and restore `custom-tool.service.ts`'s
 *         `const useCache = Number(ep.cache_ttl_sec) > 0;`
 */

/**
 * Fallback lifetime when the endpoint carries no usable `cache_ttl_sec`.
 *
 * ==== [FIX-20260821-SITERULESTTL] 1800 → 30 seconds (owner order 21/08) ====
 *
 * WHY THE CHANGE: site rules now DRIVE A CUSTOMER-FACING DECISION, not just
 * reference text. `suggestion_text` reads `bank_account.accounts` to decide
 * whether deposit/withdraw is open and which maintenance card to send. With a
 * 30-minute TTL an admin could close a bank account and the bot would keep
 * telling customers the opposite for up to half an hour — and the reverse,
 * announcing a shutdown that had already been lifted. Measured on 21/08: a
 * snapshot cached at 16:08 was still being served at 16:26.
 * ⇒ The value that made sense for "same block for every member" no longer
 *   holds once that block decides what the customer is told.
 * แคช 30 นาที ใช้ไม่ได้แล้ว เพราะข้อมูลนี้ตัดสินคำตอบที่ลูกค้าได้รับจริง
 *
 * WHY 30s AND NOT 0: the original reason for caching still stands — 9 webhooks
 * produced 9 upstream calls, six inside 47 seconds. 30s keeps that burst
 * protection (a customer typing several messages in a row still costs one
 * call) while bounding staleness to something a human cannot notice.
 *
 * HOW TO CHANGE IT: edit this constant only. Every read goes through
 * `resolveCacheTtlSec` below, so there is no second place to keep in sync.
 * A per-endpoint `cache_ttl_sec` in the DB still outranks it (rule 1 below),
 * but note the normalize whitelist drops that field on save.
 *
 * revert: set this back to `1800`, and restore the `toBe(1800)` assertion in
 *         `z-test/unit/site-rules-cache.spec.ts:92` plus its describe title.
 *         Nothing else reads the number.
 */
export const SITE_RULES_DEFAULT_TTL_SEC = 30; // seconds, owner-set 21/08

/** Endpoint role that marks site rules explicitly (tools authored with roles). */
const SITE_RULES_ROLE = 'site_rules';

/**
 * Key shape that marks site rules when the role is absent.
 * Matches `SITE_RULES`, `siteRules`, `site-rule`, … — the same test the service
 * already applies when it looks for the block to store.
 */
const SITE_RULES_KEY_PATTERN = /site.?rule/i;

/** The two fields this decision reads. Kept structural so tests need no model. */
export interface SiteRulesEndpointLike {
  key?: string | null;
  role?: string | null;
  cache_ttl_sec?: number | null;
}

/**
 * Is this the site-rules endpoint?
 *
 * Deliberately tolerant of a missing/odd endpoint object: an unreadable input
 * answers `false`, which means "not site rules" — i.e. today's live-fetch
 * behaviour. This function must never throw (§ never-throw contract).
 */
export function isSiteRulesEndpoint(
  ep: SiteRulesEndpointLike | null | undefined,
): boolean {
  if (!ep) return false;
  if (typeof ep.role === 'string' && ep.role.trim() === SITE_RULES_ROLE) {
    return true;
  }
  return typeof ep.key === 'string' && SITE_RULES_KEY_PATTERN.test(ep.key);
}

/**
 * TTL in seconds for this endpoint, or `0` meaning "do not cache".
 *
 * Order, and why:
 *   1. a positive `cache_ttl_sec` wins — an explicitly configured value is an
 *      operator decision and outranks our default, for ANY endpoint;
 *   2. otherwise site rules take {@link SITE_RULES_DEFAULT_TTL_SEC};
 *   3. otherwise `0` — every other endpoint keeps firing live, exactly as today.
 *
 * Rule 1 sits above rule 2 on purpose: it preserves the pre-existing meaning of
 * the field for every endpoint that already had one, so this change adds a
 * fallback without redefining anything that was already working.
 */
export function resolveCacheTtlSec(
  ep: SiteRulesEndpointLike | null | undefined,
): number {
  const configured = Number(ep?.cache_ttl_sec);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isSiteRulesEndpoint(ep) ? SITE_RULES_DEFAULT_TTL_SEC : 0;
}

/**
 * The single call site's question: should `_fetchWithCache` be used at all?
 *
 * Replaces the bare `Number(ep.cache_ttl_sec) > 0` so that a site-rules endpoint
 * with no configured TTL now caches, while every other endpoint answers exactly
 * what it answered before.
 */
export function shouldUseCache(
  ep: SiteRulesEndpointLike | null | undefined,
): boolean {
  return resolveCacheTtlSec(ep) > 0;
}
