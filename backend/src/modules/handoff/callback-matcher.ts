import { pickByPath } from '@/common/utils/result-rules';

import { coerceString } from './coerce-string';

/**
 * Pairs an inbound callback with the job that owns it.
 *
 * LIFTED from legacy-api/src/services/handoff/callbackMatcher.js.
 *
 * Strategies are tried in a fixed order and the search NEVER guesses: if a
 * strategy finds more than one candidate the answer is `ambiguous` and a human
 * attaches it by hand. Finding nothing is `unmatched`, which parks the row in
 * the inbox for a later re-match. Guessing here would attach a payment result
 * to the wrong job.
 *
 * Order (from `target.match_strategy`, default `[job_ref, path, external_ref]`):
 *   job_ref      — the id we embedded in the callback URL or body (strongest)
 *   path         — job_ref taken from the URL path segment
 *   external_ref — an id the target gave us earlier, stored on the job
 *   match_keys   — last resort: equality on configured snapshot keys
 */

/**
 * `matchCallback` itself only ever returns the first three. `pending` is set by
 * the caller when the matcher THROWS: the row is parked for a re-match rather
 * than recorded as genuinely unmatched, because the two mean different things
 * to an operator triaging the inbox. It is in this union so that caller does
 * not have to cast.
 */
export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous' | 'pending';

export interface MatchResult<TJob> {
  status: MatchStatus;
  job: TJob | null;
  matched_by: string;
}

export interface MatchCallbackInput<TJob> {
  target: { key?: string; match_strategy?: string[]; match_keys?: string[] };
  parsed?: Record<string, unknown>;
  jobRefFromPath?: string;
  /** Injected so this stays database-agnostic and directly testable. */
  findJobs: (query: Record<string, unknown>) => Promise<TJob[]>;
}

export async function matchCallback<TJob>({
  target,
  parsed = {},
  jobRefFromPath = '',
  findJobs,
}: MatchCallbackInput<TJob>): Promise<MatchResult<TJob>> {
  const strategies =
    Array.isArray(target?.match_strategy) && target.match_strategy.length
      ? target.match_strategy
      : ['job_ref', 'path', 'external_ref'];

  for (const strategy of strategies) {
    let query: Record<string, unknown> | null = null;

    if (strategy === 'job_ref') {
      const ref = coerceString(
        pickByPath(parsed, 'job_ref') ?? parsed['job_ref'],
      );
      if (ref) query = { job_ref: ref };
    } else if (strategy === 'path') {
      if (jobRefFromPath) query = { job_ref: jobRefFromPath };
    } else if (strategy === 'external_ref') {
      const external = coerceString(
        pickByPath(parsed, 'external_ref') ??
          parsed['external_ref'] ??
          parsed['id'],
      );
      if (external) query = { external_ref: external };
    } else if (strategy === 'match_keys') {
      const keys = Array.isArray(target.match_keys) ? target.match_keys : [];
      const clauses = keys
        .map((key) => {
          const value = pickByPath(parsed, key);
          return value == null
            ? null
            : { [`snapshot.${key}`]: coerceString(value) };
        })
        .filter((clause): clause is Record<string, string> => clause !== null);
      if (clauses.length) query = { $and: clauses };
    }

    if (!query) continue;

    // Always scoped to this target, so two targets can never cross-match.
    query['target_key'] = target.key;

    const jobs = await findJobs(query);
    if (jobs.length === 1) {
      return { status: 'matched', job: jobs[0] ?? null, matched_by: strategy };
    }
    if (jobs.length > 1) {
      return { status: 'ambiguous', job: null, matched_by: strategy };
    }
    // Zero hits falls through to the next strategy.
  }

  return { status: 'unmatched', job: null, matched_by: '' };
}
