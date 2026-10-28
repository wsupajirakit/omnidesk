/**
 * [FEAT-20261014-PROFILEFIRST] In what order the prefetch fires a tool's data endpoints.
 *
 * Default — everything at once (`Promise.all`), exactly as before this file existed.
 *
 * Profile-first (a provider opts in: loan_v1) — the endpoint flagged `is_profile` goes alone
 * first. If it does not SUCCEED (not linked, partner down, breaker open), the per-customer
 * endpoints are not fired at all: for an unknown customer they can only fail, and each is a
 * call on the partner's system. Hook-level endpoints (`keepWithoutProfile`, i.e. site rules)
 * still go. If it succeeds, the rest go together. The old system worked this way (profile
 * first, skip the rest on a miss).
 *
 * The result keeps the tool's own endpoint order, so `combined` is built in the same key
 * order either way.
 *
 * Pure (no I/O of its own). revert: put `Promise.all(dataEndpoints.map(fetchOne))` back at
 * the one call site in `custom-tool.service.ts` and delete this file.
 */
export async function fetchInPrefetchOrder<
  E extends { is_profile?: boolean },
  R extends { r: { success?: boolean } },
>(
  endpoints: readonly E[],
  fetchOne: (ep: E) => Promise<R>,
  opts: { profileFirst: boolean; keepWithoutProfile: (ep: E) => boolean },
): Promise<R[]> {
  const profile = opts.profileFirst
    ? endpoints.find((e) => e.is_profile === true)
    : undefined;
  if (!profile) return Promise.all(endpoints.map(fetchOne));

  const first = await fetchOne(profile);
  const rest = endpoints.filter((e) => e !== profile);
  const allowed =
    first.r.success === true ? rest : rest.filter(opts.keepWithoutProfile);
  const fetched = await Promise.all(allowed.map(fetchOne));
  const byEndpoint = new Map<E, R>([[profile, first]]);
  allowed.forEach((e, i) => byEndpoint.set(e, fetched[i]!));
  return endpoints.flatMap((e) =>
    byEndpoint.has(e) ? [byEndpoint.get(e)!] : [],
  );
}
