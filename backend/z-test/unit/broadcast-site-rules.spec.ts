/**
 * [FEAT-20260903-BCASTSRFRESH] A broadcast fills its card from SITE RULES, and
 * needs no member profile to do it.
 * ===========================================================================
 * Four separate failures, each with its own switch, proved separately — plus
 * the one rule that must NOT move.
 *
 * S1 an OA with nobody selected could not broadcast, although the request it
 *    makes names nobody (`oa-executor.ts:250-273` sends `to: []`)
 * S2 `site_rules.*` never translated on a broadcast: the dictionary scope was
 *    read from a profile that a broadcast does not have
 * S3 the send round used whatever was cached, however old — including nothing
 * S4 `site_rules_age_days` had a schema, a reader and an FE, and NO producer
 *
 * 🔴 AND THE FIFTH: broadcast still refuses per-person cards. Owner, 03/09:
 *    *"broadcast ไม่รองรับ profile person รองรับแค่ site rule"*. The last block
 *    pins that, because everything above widens what a broadcast can do and a
 *    widening is exactly when a neighbouring rule gets loosened by accident.
 */
import {
  CHECKS,
  HOOK_WEB_CODE_COLUMN,
  SITE_RULES_MAX_AGE_MS,
  buildBroadcastVars,
  decideFreshness,
  hasSiteRules,
  siteRulesScopeOf,
  usesSiteRules,
  verdictAfterRefresh,
} from '@/modules/content';
import {
  OA_VAR_COLUMNS,
  SEND_MATRIX,
  buildOaVarMap,
  planRun,
  refreshOaSiteRules,
  skipsEmptyAudience,
  type OaVarRow,
  type SiteRulesRefreshPorts,
} from '@/modules/content';
import { buildHistoryRow } from '@/modules/content';
import { skipDetail } from '@/modules/content';

const BROADCAST_PLAIN = SEND_MATRIX['broadcast:plain'];
const MULTICAST_PLAIN = SEND_MATRIX['multicast:plain'];

const NOW = new Date('2026-09-03T12:00:00Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60 * 1000);

/**
 * A stored blob in the shape Mongo really holds (`raw-blob.reader.ts:16`).
 *
 * ⚠️ `deposit_amount_mode` is in here ON PURPOSE and the test is worthless
 *    without it: `applyFormat` calls the dictionary ONLY for a field whose
 *    FORMAT_RULES entry declares a `dict`, and that path
 *    (`format-rules.ts:75-78` → `deposit_mode`) is one of the few site-rules
 *    fields that does. A blob of plain names never reaches `translate`, so a
 *    scope assertion on one would pass whatever the code did.
 *    ค่าที่ไม่มี dict ไม่เคยเรียกตัวแปล — เทสจะเขียวโดยไม่ได้วัดอะไรเลย.
 */
const BLOB = {
  data: {
    shop: {
      name: 'ร้านตัวอย่าง',
      wallet: { wallet_setting: { deposit_amount_mode: 'auto' } },
    },
  },
  success: true,
};

// ───────────────────────────────────────────────────────────────────────────
// S1 — an empty audience is only a reason to skip when recipients are NAMED
// ───────────────────────────────────────────────────────────────────────────
describe('S1 · zero recipients does not skip a broadcast', () => {
  it('lets a broadcast OA with nobody selected run, and still costs one request', () => {
    const plan = planRun({ cell: BROADCAST_PLAIN, recipientsByOa: [0] });

    expect(plan.perOa[0]?.sendable).toBe(true);
    expect(plan.perOa[0]?.skipReason).toBeUndefined();
    /* One request per OA regardless of headcount — the broadcast pipe's shape,
       not a number this test chose (`requestsPerOaFor`, matrix line 144). */
    expect(plan.perOa[0]?.requests).toBe(1);
    expect(plan.verdict.kind).toBe('ok');
  });

  it('still skips a MULTICAST OA with nobody selected — a request addressed to no one', () => {
    const plan = planRun({ cell: MULTICAST_PLAIN, recipientsByOa: [0] });

    expect(plan.perOa[0]?.sendable).toBe(false);
    expect(plan.perOa[0]?.skipReason).toBe('empty');
    expect(plan.verdict.kind).toBe('nothing-to-send');
  });

  it('the switch is what decides, and it decides per cell', () => {
    expect(skipsEmptyAudience(BROADCAST_PLAIN)).toBe(false);
    expect(skipsEmptyAudience(MULTICAST_PLAIN)).toBe(true);
  });

  it('one empty OA does not cost the others their campaign', () => {
    const plan = planRun({ cell: BROADCAST_PLAIN, recipientsByOa: [0, 40] });
    expect(plan.sendableOaCount).toBe(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S2 — the dictionary scope for a path that has no profile to read one from
// ───────────────────────────────────────────────────────────────────────────
describe('S2 · site-rules scope comes from the hook on a broadcast', () => {
  it('reads the hook web code, and refuses anything that is not one', () => {
    expect(siteRulesScopeOf({ customer_link_web_code: 'demo-omnidesk' })).toBe(
      'demo-omnidesk',
    );
    /* An empty column is NOT a scope: passing `''` would look set and resolve
       nothing — the same silent miss the fix removes. */
    expect(siteRulesScopeOf({ customer_link_web_code: '   ' })).toBeUndefined();
    expect(siteRulesScopeOf({ customer_link_web_code: 42 })).toBeUndefined();
    expect(siteRulesScopeOf({})).toBeUndefined();
    expect(siteRulesScopeOf(null)).toBeUndefined();
  });

  /**
   * 🔴 ADDED AFTER A MUTATION SURVIVED. Deleting `customer_link_web_code` from
   * `OA_VAR_COLUMNS` left every test above GREEN, because they all hand
   * `buildOaVarMap` a row they built themselves and never walk the projection.
   *
   * That is the exact failure this repo has shipped before with a field list: a
   * column missing from the `.select()` arrives `undefined`, the scope goes
   * back to null, and NOTHING errors — the card renders, the values appear, and
   * only the per-site wording is quietly gone again.
   * คอลัมน์ที่ไม่ได้ select = undefined เงียบ ๆ ไม่มี error ให้ตาม.
   */
  it('🔴 the columns are actually SELECTED — a projection is a field list', () => {
    expect(OA_VAR_COLUMNS).toHaveProperty(HOOK_WEB_CODE_COLUMN, 1);
    expect(OA_VAR_COLUMNS).toHaveProperty('site_rules_updated_at', 1);
    /* The families that were already read must not be lost while adding to it. */
    expect(OA_VAR_COLUMNS).toHaveProperty('raw_site_rules_data', 1);
    expect(OA_VAR_COLUMNS).toHaveProperty('company_name', 1);
  });

  it('the OA path now HAS a scope where it used to have null', () => {
    const seen: Array<string | undefined> = [];
    const translate = (
      _dict: string,
      key: unknown,
      opts?: { scope?: string },
    ): string | null => {
      seen.push(opts?.scope);
      return typeof key === 'string' ? key : null;
    };

    buildOaVarMap(
      [
        {
          _id: 'hook-1',
          raw_site_rules_data: BLOB,
          customer_link_web_code: 'sim_beta',
        },
      ],
      translate,
    );

    /* The bug: EVERY lookup on this path used to arrive with no scope at all. */
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toContain('sim_beta');
    expect(seen.every((s) => s === 'sim_beta')).toBe(true);
  });

  it("a real recipient's own web code still wins — multicast is untouched", () => {
    const seen: Array<string | undefined> = [];
    const translate = (
      _d: string,
      _k: unknown,
      opts?: { scope?: string },
    ): string | null => {
      seen.push(opts?.scope);
      return null;
    };

    buildBroadcastVars({
      /* `status` carries a dict (`format-rules.ts:41` → `acc_status`), so this
         profile really does reach `translate`. */
      storedProfile: {
        data: { profile: { web_code: 'the-persons-site', status: 'active' } },
      },
      storedSiteRules: BLOB,
      member: null,
      hook: null,
      translate,
      scope: 'the-oas-site',
    });

    expect(seen).toContain('the-persons-site');
    expect(seen).not.toContain('the-oas-site');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S3 — fresh at send time: the six rows of the rule, one case each
// ───────────────────────────────────────────────────────────────────────────
describe('S3 · freshness decision', () => {
  it('fetches when nothing is stored at all — the common case on real rows', () => {
    expect(hasSiteRules(undefined)).toBe(false);
    expect(hasSiteRules({})).toBe(false);
    expect(hasSiteRules(BLOB)).toBe(true);
    expect(
      decideFreshness({ stored: undefined, fetchedAt: NOW, now: NOW }),
    ).toBe('fetch');
  });

  it('fetches when the stored copy is older than ten minutes', () => {
    expect(
      decideFreshness({ stored: BLOB, fetchedAt: minutesAgo(11), now: NOW }),
    ).toBe('fetch');
    expect(
      decideFreshness({ stored: BLOB, fetchedAt: minutesAgo(9), now: NOW }),
    ).toBe('use-stored');
    /* The boundary is the threshold itself, stated rather than implied. */
    expect(
      decideFreshness({
        stored: BLOB,
        fetchedAt: new Date(NOW.getTime() - SITE_RULES_MAX_AGE_MS),
        now: NOW,
      }),
    ).toBe('use-stored');
  });

  it('treats an unknown age as stale, and a FUTURE stamp as fresh', () => {
    expect(decideFreshness({ stored: BLOB, fetchedAt: null, now: NOW })).toBe(
      'fetch',
    );
    /* Clock skew must not refetch every OA of every run, forever. */
    expect(
      decideFreshness({ stored: BLOB, fetchedAt: minutesAgo(-30), now: NOW }),
    ).toBe('use-stored');
  });

  it('the switch turns the whole thing off, and off means "as before"', () => {
    const original = CHECKS.siteRulesFreshness;
    try {
      (CHECKS as { siteRulesFreshness: boolean }).siteRulesFreshness = false;
      expect(
        decideFreshness({ stored: undefined, fetchedAt: null, now: NOW }),
      ).toBe('use-stored');
    } finally {
      (CHECKS as { siteRulesFreshness: boolean }).siteRulesFreshness = original;
    }
  });
});

describe('S3 · what happens after the fetch was tried', () => {
  const CARD_WITH = { text: 'ยินดีต้อนรับสู่ {{site_rules.name}}' };
  const CARD_WITHOUT = { text: 'สวัสดีครับ' };

  it('knows which cards actually read a site rule', () => {
    expect(usesSiteRules(CARD_WITH)).toBe(true);
    expect(usesSiteRules(CARD_WITHOUT)).toBe(false);
    /* `{{profile.*}}` is NOT a site rule — the two families must not blur. */
    expect(usesSiteRules({ text: '{{profile.balance}}' })).toBe(false);
  });

  it('sends with the stored copy when the fetch failed but something is stored', () => {
    expect(verdictAfterRefresh(BLOB, CARD_WITH).kind).toBe('send');
  });

  it('skips only when there is nothing AND the card needs it', () => {
    const skip = verdictAfterRefresh(undefined, CARD_WITH);
    expect(skip.kind).toBe('skip');
    expect(skip.kind === 'skip' && skip.reason).toContain('site_rules');
  });

  it('🔴 never skips an OA over data the card does not read', () => {
    expect(verdictAfterRefresh(undefined, CARD_WITHOUT).kind).toBe('send');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// S3/S4 — the reader that performs the fetch and measures the age
// ───────────────────────────────────────────────────────────────────────────
describe('S3/S4 · refreshOaSiteRules', () => {
  const rows: OaVarRow[] = [
    /* stale: has a blob, stamped a month ago (a real shape — `2omnideskdevoa2`) */
    {
      _id: 'stale',
      raw_site_rules_data: BLOB,
      site_rules_updated_at: minutesAgo(60 * 24 * 3),
      company_name: 'OA STALE',
      customer_link_web_code: 'wc-stale',
    },
    /* fresh: nothing to do */
    {
      _id: 'fresh',
      raw_site_rules_data: BLOB,
      site_rules_updated_at: minutesAgo(2),
      company_name: 'OA FRESH',
    },
    /* empty: never fetched — four of five real rows look like this */
    { _id: 'empty', company_name: 'OA EMPTY' },
  ];

  const portsThatWork = (
    calls: string[],
  ): SiteRulesRefreshPorts & { calls: string[] } => ({
    calls,
    fetchForHook: async (hookId) => {
      calls.push(hookId);
      await Promise.resolve();
    },
    rereadSiteRules: async (ids) =>
      await Promise.resolve(
        ids.map((id) => ({
          _id: id,
          raw_site_rules_data: BLOB,
          site_rules_updated_at: NOW,
        })),
      ),
    now: () => NOW,
  });

  it('asks only for the OAs that need asking', async () => {
    const calls: string[] = [];
    const out = await refreshOaSiteRules(
      rows,
      { text: '{{site_rules.name}}' },
      portsThatWork(calls),
    );

    expect(calls.sort()).toEqual(['empty', 'stale']);
    expect(out.blocked).toEqual([false, false, false]);
  });

  it('🔴 merges ONLY the two site-rules columns — hook_* and the scope survive', async () => {
    const calls: string[] = [];
    const out = await refreshOaSiteRules(rows, {}, portsThatWork(calls));

    /* The re-read selects three fields. Replacing the row wholesale would drop
       `company_name` (every `hook_*` tag) and `customer_link_web_code` (the
       dictionary scope) — silently, and only for the OAs that were refreshed. */
    expect(out.rows[0]?.['company_name']).toBe('OA STALE');
    expect(out.rows[0]?.['customer_link_web_code']).toBe('wc-stale');
    expect(out.rows[0]?.['raw_site_rules_data']).toEqual(BLOB);
  });

  it('writes an age per OA, and no age at all where there is no stamp', async () => {
    const failing: SiteRulesRefreshPorts = {
      fetchForHook: async () => {
        await Promise.resolve();
        throw new Error('customer API down');
      },
      rereadSiteRules: async () => await Promise.resolve([]),
      now: () => NOW,
    };
    const out = await refreshOaSiteRules(rows, {}, failing);

    expect(out.ageDaysByHook.get('stale')).toBe(3);
    expect(out.ageDaysByHook.get('fresh')).toBe(0);
    /* Never fetched ⇒ no entry, so the row writes NO key: "never" and "today"
       are different facts and must read differently. */
    expect(out.ageDaysByHook.has('empty')).toBe(false);
  });

  it('a failing customer API costs the freshness, not the campaign', async () => {
    const failing: SiteRulesRefreshPorts = {
      fetchForHook: async () => {
        await Promise.resolve();
        throw new Error('customer API down');
      },
      rereadSiteRules: async () => await Promise.resolve([]),
      now: () => NOW,
    };
    const out = await refreshOaSiteRules(
      rows,
      { text: '{{site_rules.name}}' },
      failing,
    );

    /* stale + fresh still have their blob ⇒ they send. Only the OA that has
       nothing, on a card that needs it, is blocked. */
    expect(out.blocked).toEqual([false, false, true]);
    expect(out.rows[0]?.['raw_site_rules_data']).toEqual(BLOB);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The plan carries the block, and the history row says why
// ───────────────────────────────────────────────────────────────────────────
describe('a blocked OA is skipped by the ONE mechanism that already skips OAs', () => {
  it('marks it no-site-rules and lets the rest of the run go', () => {
    const plan = planRun({
      cell: BROADCAST_PLAIN,
      recipientsByOa: [10, 10],
      blockedByOa: [true, false],
    });

    expect(plan.perOa[0]?.skipReason).toBe('no-site-rules');
    expect(plan.perOa[0]?.sendable).toBe(false);
    expect(plan.perOa[1]?.sendable).toBe(true);
    expect(plan.sendableOaCount).toBe(1);
  });

  it('absent blockedByOa plans exactly what it always planned', () => {
    const before = planRun({ cell: BROADCAST_PLAIN, recipientsByOa: [10, 10] });
    const after = planRun({
      cell: BROADCAST_PLAIN,
      recipientsByOa: [10, 10],
      blockedByOa: [false, false],
    });
    expect(after).toEqual(before);
  });

  it('the history row explains the skip in words an operator can act on', () => {
    const detail = skipDetail(
      {
        index: 0,
        recipients: 10,
        requests: 0,
        sendable: false,
        skipReason: 'no-site-rules',
      },
      BROADCAST_PLAIN,
    );
    expect(detail).toContain('site_rules');
    expect(detail).toContain('fetch was attempted');
  });
});

describe('S4 · site_rules_age_days finally has a producer', () => {
  const base = {
    jobId: 'job-1',
    runId: 'run-1',
    cell: BROADCAST_PLAIN,
    triggeredBy: 'manual' as const,
    startedAt: NOW,
    finishedAt: NOW,
    recipientsCaptured: {},
    matched: 0,
    targeted: 0,
  };
  const oa = {
    index: 0,
    hookId: 'hook-A',
    counters: {
      requests: 1,
      recipientsAttempted: 0,
      delivered: 0,
      failed: 0,
      imagesReplaced: 0,
    },
    unknownTags: [],
    imagesMeasured: false,
    resume: { hookId: 'hook-A', afterId: null, nextChunkIndex: 0 },
  };

  it('writes the age of THIS OA, not the run-level one', () => {
    const row = buildHistoryRow(
      {
        ...base,
        siteRulesAgeDays: 99,
        siteRulesAgeDaysByHook: { 'hook-A': 3 },
      } as unknown as Parameters<typeof buildHistoryRow>[0],
      oa as unknown as Parameters<typeof buildHistoryRow>[1],
    );
    expect((row as Record<string, unknown>)['site_rules_age_days']).toBe(3);
  });

  it('writes NO key when nothing measured it', () => {
    const row = buildHistoryRow(
      base as unknown as Parameters<typeof buildHistoryRow>[0],
      oa as unknown as Parameters<typeof buildHistoryRow>[1],
    );
    expect('site_rules_age_days' in (row as Record<string, unknown>)).toBe(
      false,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 🔴 THE RULE THAT MUST NOT MOVE
// ───────────────────────────────────────────────────────────────────────────
describe('broadcast supports site rules and NOT per-person values', () => {
  it('a plain card may carry site rules and hook context, and nothing per person', () => {
    expect(BROADCAST_PLAIN.allowsTags).toContain('site_rules.*');
    expect(BROADCAST_PLAIN.allowsTags).toContain('hook_*');
    expect(BROADCAST_PLAIN.allowsTags).not.toContain('profile.*');
    expect(BROADCAST_PLAIN.allowsTags).not.toContain('member.*');
  });

  it('broadcast + a per-person card remains impossible, not merely expensive', () => {
    expect(SEND_MATRIX['broadcast:personal'].allowed).toBe(false);
    const plan = planRun({
      cell: SEND_MATRIX['broadcast:personal'],
      recipientsByOa: [0],
    });
    expect(plan.verdict.kind).toBe('not-allowed');
  });

  it('🔴 multicast + personal gets BOTH families — site rules included', () => {
    const personal = SEND_MATRIX['multicast:personal'].allowsTags;
    expect(personal).toContain('site_rules.*');
    expect(personal).toContain('profile.*');
    expect(personal).toContain('member.*');
  });
});
