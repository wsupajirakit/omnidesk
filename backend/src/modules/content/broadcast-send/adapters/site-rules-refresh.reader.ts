/**
 * [FEAT-20260903-BCASTSRFRESH] Bring each OA's site rules up to date BEFORE the
 * run renders anything — once per OA, never per recipient.
 * ===========================================================================
 * The I/O half of the decision that `broadcast-var/checks/site-rules-freshness.ts`
 * makes. That file answers questions and touches nothing; this one performs the
 * fetch, through seams, so it stays drivable from a spec with no Mongo and no
 * customer API. ตัวโน้นตัดสิน ตัวนี้ลงมือ — คนละไฟล์ ตั้งใจ.
 *
 * 🔴 WHY THIS RUNS BEFORE `buildOaVarMap` AND NOT INSIDE IT.
 * `buildOaVarMap` is pure and synchronous; every card of the run is rendered
 * from what it returns, in the message builder's CONSTRUCTOR, before the job is
 * claimed (`card-message.builder.ts:410-419`). A fetch cannot live inside a
 * synchronous render, and a fetch after the render would update a column
 * nothing reads until the next run. So the order is: read rows → refresh here →
 * build the var map from the REFRESHED rows.
 *
 * 🔴 WHY ONE FETCH PER OA IS THE WHOLE COST.
 * A job reaches at most `maxHooks` (20) channels, and the value is identical for
 * every recipient of one channel — that is the definition of the `site_rules.*`
 * family. Refetching per recipient would be an N+1 on a path that already costs
 * one LINE request per person, which is the exact mistake
 * `recipient-vars.reader.ts` was written to avoid.
 *
 * ⚠️ NEVER THROWS. Every failure degrades to "use whatever is stored", which is
 *    precisely the behaviour this whole file did not have before it existed. A
 *    customer's API being down must cost the freshness, not the campaign.
 *    ยิงไม่ได้ = ใช้ของเก่า ไม่ใช่ล้มทั้งงาน.
 *
 * revert: set `CHECKS.siteRulesFreshness` to `false` (no call is made and every
 * OA uses its stored blob), or delete this file, its call site in
 * `new-send.service.ts` and the `blockedByOa` argument it produces.
 */
import {
  dataAgeDays,
  decideFreshness,
  verdictAfterRefresh,
} from '../../broadcast-var';
import type { OaVarRow } from './oa-vars.reader';

/**
 * The two calls this reader makes, injected.
 *
 * `fetchForHook` is deliberately `Promise<void>`: what came back is read from
 * the DATABASE afterwards, not from the return value, because the fetch path
 * (`custom-tool.service.getCombinedData`) is the thing that writes
 * `raw_site_rules_data`, and trusting its return shape here would be a second
 * copy of a contract that already has an owner.
 * อ่านผลจากฐาน ไม่ใช่จากค่าที่ฟังก์ชันคืน — สัญญามีเจ้าของอยู่แล้ว.
 */
export interface SiteRulesRefreshPorts {
  fetchForHook(hookId: string): Promise<void>;
  /** Re-read `raw_site_rules_data` + `site_rules_updated_at` for these hooks. */
  rereadSiteRules(
    hookIds: readonly string[],
  ): Promise<ReadonlyArray<Record<string, unknown>>>;
  now(): Date;
}

export interface SiteRulesRefreshResult {
  /** The same rows, in the same order, refreshed where a fetch produced one. */
  readonly rows: readonly OaVarRow[];
  /** By the SAME index as `rows` — `true` ⇒ this OA cannot send this card. */
  readonly blocked: readonly boolean[];
  /** hookId → how old its site rules are, for the history row. */
  readonly ageDaysByHook: ReadonlyMap<string, number>;
  /** hookIds a fetch was actually attempted for. For the log line only. */
  readonly fetched: readonly string[];
}

/** `_id` as a string — the same narrowing `oa-vars.reader.ts` documents. */
function idText(id: unknown): string {
  if (id === null || id === undefined) return '';
  if (typeof id === 'string') return id;
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(id);
}

/** The stamp column, as a Date or `null` — Mongo hands back a Date or a string. */
function stampOf(row: Record<string, unknown> | undefined): Date | null {
  const raw = row?.['site_rules_updated_at'];
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Refresh what needs refreshing, then say which OAs may send.
 *
 * @param cardJson the card as saved — inspected ONLY to ask whether it reads any
 *        `{{site_rules.*}}` tag, so an OA is never skipped over data its card
 *        does not use.
 */
export async function refreshOaSiteRules(
  rows: readonly OaVarRow[],
  cardJson: unknown,
  ports: SiteRulesRefreshPorts,
): Promise<SiteRulesRefreshResult> {
  const now = safeNow(ports);

  /* ── 1. who needs asking? ───────────────────────────────────────────────
     A pure decision per row, made before a single call goes out, so the whole
     upstream cost of this run is knowable from this one list. */
  const needsFetch = rows.map(
    (row) =>
      decideFreshness({
        stored: row['raw_site_rules_data'],
        fetchedAt: stampOf(row),
        now,
      }) === 'fetch',
  );

  const toFetch = rows
    .filter((_, i) => needsFetch[i])
    .map((row) => idText(row._id))
    .filter((id) => id !== '');

  /* ── 2. ask, one OA at a time ──────────────────────────────────────────
     SEQUENTIAL on purpose. These are calls to a customer's API on a path that
     is already about to spend LINE quota; fanning them out would turn a 20-OA
     job into a 20-wide burst against somebody else's server for no gain — the
     run is bounded by its LINE sends, not by this.
     ทีละตัว — ปลายทางเป็นเซิร์ฟเวอร์ของลูกค้า ไม่ใช่ของเรา. */
  const fetched: string[] = [];
  for (const hookId of toFetch) {
    try {
      await ports.fetchForHook(hookId);
      fetched.push(hookId);
    } catch {
      /* The stored blob is still the best answer we have. Failing here must
         not cost the campaign — see the header. */
    }
  }

  /* ── 3. read back what landed ──────────────────────────────────────────
     From the DATABASE, not from the fetch's return value: the fetch path owns
     the shape it writes, and re-deriving it here would be a second copy of a
     contract with an owner. One `$in`, and only when something was asked. */
  const refreshedById = new Map<string, Record<string, unknown>>();
  if (fetched.length > 0) {
    try {
      const fresh = await ports.rereadSiteRules(fetched);
      for (const row of fresh) {
        const id = idText(row['_id']);
        if (id !== '') refreshedById.set(id, row);
      }
    } catch {
      /* Same rule: nothing read back ⇒ every row keeps what it already had. */
    }
  }

  /* ── 4. merge, judge, and measure ──────────────────────────────────────
     ⚠️ The merge writes ONLY the two site-rules columns over the original row.
        Replacing the row wholesale would drop `domain_name`, `company_name`,
        `description` and the web code — every `hook_*` tag and the dictionary
        scope — because the re-read selects only what it needed.
        เขียนทับเฉพาะสองคอลัมน์ ไม่ใช่ทั้งแถว. */
  const outRows: OaVarRow[] = [];
  const blocked: boolean[] = [];
  const ageDaysByHook = new Map<string, number>();

  for (const row of rows) {
    const id = idText(row._id);
    const fresh = refreshedById.get(id);
    const merged: OaVarRow =
      fresh === undefined
        ? row
        : {
            ...row,
            raw_site_rules_data: fresh['raw_site_rules_data'],
            site_rules_updated_at: fresh['site_rules_updated_at'],
          };
    outRows.push(merged);

    const verdict = verdictAfterRefresh(
      merged['raw_site_rules_data'],
      cardJson,
    );
    blocked.push(verdict.kind === 'skip');

    /* [FEAT-20260903-BCASTSRAGE] The producer this column never had. `null`
       (never fetched, unreadable stamp) writes NO key — "never fetched" and
       "fetched today" are different facts and the reader shows them
       differently (`history-row.ts:203-204`). */
    const age = dataAgeDays(stampOf(merged), now);
    if (age !== null && id !== '') ageDaysByHook.set(id, age);
  }

  return { rows: outRows, blocked, ageDaysByHook, fetched };
}

/** A clock that throws is not a reason to fail a run. */
function safeNow(ports: SiteRulesRefreshPorts): Date {
  try {
    const now = ports.now();
    return now instanceof Date && !Number.isNaN(now.getTime())
      ? now
      : new Date();
  } catch {
    return new Date();
  }
}
