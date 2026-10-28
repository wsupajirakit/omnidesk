/**
 * [FEAT-20260824-BCASTTAGPRE] Which audience keys are answered by another
 * collection before the `members` filter is built.
 * ===========================================================================
 * 🔌 ADD A SOURCE THAT NEEDS A JOIN = ADD ONE ENTRY HERE + ONE RESOLVER FILE.
 * Nothing else changes: not `audience-filter.ts`, not `recipient.pager.ts`, not
 * `new-send.service.ts`. That is the whole point of the seam — see the ENGLISH
 * note in `index.ts` for what a ticket-type / ticket-status resolver would have
 * to provide.
 *
 * ⚠️ A KEY LISTED HERE MUST ALSO EXIST IN `audience-source.registry.ts` with
 *    `path: '_id'`. This table decides WHICH member ids; that entry decides how
 *    the ids become a clause. A key in one table and not the other is a rule
 *    that resolves and is then thrown away, or one that reaches Mongo still
 *    holding foreign ids — both silently match nobody. A spec pins both ways.
 *    สองทะเบียนต้องตรงกันเสมอ ไม่งั้นเงียบ ๆ ไม่โดนใคร.
 *
 * revert: delete this folder and its line in the audience barrel.
 */
import { customerTagPrefilter } from './customer-tag.resolver';
import type { AudiencePrefilterResolver } from './prefilter.types';

const RESOLVERS: readonly AudiencePrefilterResolver[] = [customerTagPrefilter];

export const PREFILTER_RESOLVERS = RESOLVERS;

/** Unknown key ⇒ null. The caller decides; this file never throws. */
export function getPrefilterResolver(
  key: unknown,
): AudiencePrefilterResolver | null {
  if (typeof key !== 'string') return null;
  return RESOLVERS.find((r) => r.key === key) ?? null;
}

/** Does this query name any rule that needs a pre-resolve at all? */
export function needsPrefilter(rules: readonly unknown[]): boolean {
  return rules.some(
    (r) =>
      r !== null &&
      typeof r === 'object' &&
      getPrefilterResolver((r as { key?: unknown }).key) !== null,
  );
}
