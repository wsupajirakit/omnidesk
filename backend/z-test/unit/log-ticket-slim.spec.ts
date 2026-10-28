/**
 * [PERF-20260816-LOGTICKETSLIM] Two read paths stop hauling data nobody reads.
 *
 * 1. `GET /webhook/logs` (the LIST) excludes the four heavy fields —
 *    `raw_request`, `raw_response`, `payload_summary`, `response_summary`.
 *    Measured before the change: they are 83% of the page (65.7KB → 11.1KB for
 *    20 rows) and neither consumer (`WebhookLogs.tsx`, `Broadcasts.tsx`) reads
 *    any of them. The detail modal fetches by id through `getLogById`, which
 *    deliberately stays FULL — that is pinned here too.
 *
 *    EXCLUSION, not a whitelist, on purpose: a whitelist of "what the table
 *    shows today" silently drops every scalar added later — the exact
 *    field-drop trap this repo keeps rediscovering. Excluding the four known
 *    heavies keeps every present and future scalar flowing.
 *
 * 2. The ticket `populate('hook_id')` carries a field list. `formatTicket` is
 *    the only consumer of the populated hook document and reads exactly
 *    `_id`, `display_name`, `line_oa_name` — everything else of a 10-106KB
 *    hook document (including its credentials) was fetched to be discarded.
 *
 * Realtime is out of the blast radius by construction and PINNED below: every
 * `publishScopedTicketEvent` call passes a hand-built object of scalar keys,
 * never a populated document.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { WebhookLogService } from '@/modules/system';

const HEAVY = [
  'raw_request',
  'raw_response',
  'payload_summary',
  'response_summary',
];

/** chainable query double that records every select() it sees */
function makeLogModel(rows: unknown[]) {
  const selects: unknown[] = [];
  // [FIX-20260824-LOGSORTWL] the double now also records what it was asked to
  // sort by. Additive — every existing case reads `selects` and is unaffected.
  const sorts: unknown[] = [];
  const chain = (val: unknown): Record<string, unknown> => ({
    sort: (arg: unknown) => {
      sorts.push(arg);
      return chain(val);
    },
    skip: () => chain(val),
    limit: () => chain(val),
    select: (arg: unknown) => {
      selects.push(arg);
      return chain(val);
    },
    lean: () => chain(val),
    exec: () => Promise.resolve(val),
  });
  return {
    selects,
    sorts,
    find: () => chain(rows),
    findById: () => chain(rows[0] ?? null),
    countDocuments: () => ({ exec: () => Promise.resolve(rows.length) }),
  };
}

function makeService(rows: unknown[]) {
  const logModel = makeLogModel(rows);
  const hookModel = {
    findById: () => ({
      select: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }),
    }),
  };
  // [FEAT-20260827-WLOGONEDOOR] third dep = the write door. This file only
  // exercises the READ side, so a door that would throw if used is the honest
  // stub: it proves listLogs never writes.
  const service = new WebhookLogService(
    logModel as never,
    hookModel as never,
    {
      persist: () => {
        throw new Error('listLogs must not write');
      },
    } as never,
  );
  return { service, logModel };
}

const row = {
  _id: 'log-1',
  action_type: 'x',
  channel: 'line_api',
  status: 'success',
};

describe('[LOGTICKETSLIM] the log LIST excludes the heavy fields', () => {
  it('(T1 TARGET) listLogs projects the four heavy fields OUT', async () => {
    const { service, logModel } = makeService([row]);

    await service.listLogs({ roleName: 'superadmin', groupIds: [] });

    expect(logModel.selects).toHaveLength(1);
    const projection = String(logModel.selects[0]);
    for (const field of HEAVY) {
      expect(projection).toContain(`-${field}`);
    }
  });

  it('(T2 TARGET) the projection is exclusion-only — no field is whitelisted in', async () => {
    const { service, logModel } = makeService([row]);

    await service.listLogs({ roleName: 'superadmin', groupIds: [] });

    // a single inclusion in a projection flips Mongo into whitelist mode and
    // every unlisted scalar vanishes — the trap this spec exists to prevent
    const terms = String(logModel.selects[0]).trim().split(/\s+/);
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(term.startsWith('-')).toBe(true);
    }
  });

  it('(P1 PIN) getLogById stays FULL — the detail modal needs the raw fields', async () => {
    const { service, logModel } = makeService([
      { ...row, _id: 'a0d000000000000000000069' },
    ]);

    await service.getLogById('a0d000000000000000000069');

    expect(logModel.selects).toHaveLength(0);
  });
});

/**
 * [FIX-20260824-LOGSORTWL] The sort FIELD reaching Mongo is whitelisted.
 *
 * WHY THIS SPEC EXISTS: `sort` arrives raw from the query string
 * (`@Query('sort')` in webhook-log.controller.ts) and is NOT declared in
 * `dto/webhook-log.dto.ts`, so nothing validated it. It was split on ':' and
 * handed to `.sort()` verbatim — any field name at all.
 *
 * That is not a slow page, it is an outage class: sorting the highest-write
 * collection in the system by an unindexed field makes Mongo materialise the
 * whole filtered set for a blocking SORT, and that stage ABORTS at 32MB rather
 * than degrading. Only the 3-day date cap keeps the set small enough today.
 *
 * The four allowed names are the ones an index can serve — `created_at` (the
 * TTL index and the trailing key of every compound) and `status` /
 * `log_source` / `action_type`, each of which LEADS one compound.
 *
 * Nothing real changes: `services/hook/webhookLogService.ts` hard-codes
 * `sort=created_at:desc` at both of its call sites and sends nothing else.
 */
describe('[LOGSORTWL] the sort field is whitelisted before it reaches Mongo', () => {
  const sortOf = (logModel: { sorts: unknown[] }) =>
    logModel.sorts[0] as Record<string, number>;

  it('(T1 TARGET) an UNINDEXED field is refused and falls back to created_at:-1', async () => {
    const { service, logModel } = makeService([row]);

    // `duration_ms` is a real column with no index — the exact shape that
    // produces the 32MB blocking-sort abort.
    await service.listLogs({
      roleName: 'superadmin',
      groupIds: [],
      sort: 'duration_ms:desc',
    });

    expect(sortOf(logModel)).toEqual({ created_at: -1 });
    expect(sortOf(logModel)['duration_ms']).toBeUndefined();
  });

  it('(T2 TARGET) a made-up field name is refused too — the guard is a whitelist, not a blacklist', async () => {
    const { service, logModel } = makeService([row]);

    await service.listLogs({
      roleName: 'superadmin',
      groupIds: [],
      sort: 'not_a_column_at_all:asc',
    });

    expect(sortOf(logModel)).toEqual({ created_at: -1 });
  });

  it('(T3 TARGET) the three index-LEADING fields are still honoured', async () => {
    for (const field of ['status', 'log_source', 'action_type']) {
      const { service, logModel } = makeService([row]);

      await service.listLogs({
        roleName: 'superadmin',
        groupIds: [],
        sort: `${field}:asc`,
      });

      expect(sortOf(logModel)).toEqual({ [field]: 1 });
    }
  });

  it('(P1 PIN) the value the dashboard actually sends is untouched', async () => {
    const { service, logModel } = makeService([row]);

    // Both call sites in services/hook/webhookLogService.ts send exactly this.
    await service.listLogs({
      roleName: 'superadmin',
      groupIds: [],
      sort: 'created_at:desc',
    });

    expect(sortOf(logModel)).toEqual({ created_at: -1 });
  });

  it('(P2 PIN) no sort param at all still defaults to created_at:-1', async () => {
    const { service, logModel } = makeService([row]);

    await service.listLogs({ roleName: 'superadmin', groupIds: [] });

    expect(sortOf(logModel)).toEqual({ created_at: -1 });
  });

  it('(P3 PIN) asc/desc direction still works on an allowed field', async () => {
    const { service, logModel } = makeService([row]);

    await service.listLogs({
      roleName: 'superadmin',
      groupIds: [],
      sort: 'created_at:asc',
    });

    expect(sortOf(logModel)).toEqual({ created_at: 1 });
  });
});

const ticketsSource = () =>
  readFileSync(
    join(process.cwd(), 'src/modules/tickets/tickets.service.ts'),
    'utf8',
  )
    // strip comments so prose naming the forbidden pattern cannot satisfy or
    // break the assertions below
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('[LOGTICKETSLIM] ticket populate carries a field list', () => {
  it('(T3 TARGET) every hook_id populate names its fields; a bare one no longer exists', () => {
    const src = ticketsSource();
    const bare = src.match(/\.populate\('hook_id'\)/g) ?? [];
    const listed =
      src.match(/\.populate\('hook_id',\s*'display_name line_oa_name'\)/g) ??
      [];

    expect(bare).toHaveLength(0);
    // the three read sites: hook list, getTicketById, updateTicket
    expect(listed.length).toBeGreaterThanOrEqual(3);
  });

  it('(P2 PIN, flipped 26/08) chat_user_id: DETAIL paths stay bare, the LIST carries the trim deny-list', () => {
    /* HISTORY OF THIS PIN. It used to assert "bare at all three sites" with
       the note "adding a field list here CHANGES the response — owner said
       not yet". That was written BEFORE [PERF-20260822-LISTMEMBERTRIM]: since
       then the LIST response has NOT shipped the member whole (eight columns
       are deleted in JS on every row), so what the pin guarded no longer
       exists on the list path. [PERF-20260826-TKTPOPTRIM] (📖
       docs/bottleneck_26_aug.md S2) pushes that same deny-list into the LIST
       populate — proven response-identical on every live member row
       (z-test/manual/prove-list-populate-trim.mjs, 13/13 identical) and
       exclusion-only so nothing can whitelist-vanish. Flipped red-first, not
       deleted: the pin now guards the NEW truth. */
    const src = ticketsSource();
    // detail paths (getTicketById, updateTicket) still ship the member WHOLE
    const bare = src.match(/\.populate\('chat_user_id'\)/g) ?? [];
    expect(bare.length).toBeGreaterThanOrEqual(2);
    // the LIST site carries the single-source exclusion — never a literal,
    // so the projection cannot drift from UNREAD_MEMBER_KEYS
    const listed =
      src.match(
        /\.populate\('chat_user_id',\s*LIST_MEMBER_POPULATE_EXCLUSION\)/g,
      ) ?? [];
    expect(listed).toHaveLength(1);
  });

  it('(P3 PIN) formatTicket reads only _id/display_name/line_oa_name off the hook', () => {
    // proven behaviourally: a hook trimmed to the populate field list must
    // produce the exact output a full hook produces
    const src = ticketsSource();
    const body = src.slice(
      src.indexOf('private formatTicket'),
      src.indexOf('private async populateAttachedFiles'),
    );
    const reads = [...body.matchAll(/hookRef as \{ ([^}]+) \}/g)]
      .flatMap((m) => (m[1] ?? '').match(/[a-z_]+\??:/g) ?? [])
      .map((f) => f.replace(/[?:]/g, ''));
    for (const field of reads) {
      expect(['display_name', 'line_oa_name']).toContain(field);
    }
  });
});

describe('[LOGTICKETSLIM] realtime is outside the blast radius', () => {
  it('(P4 PIN) no publish call ever spreads a document — scalar keys only', () => {
    const src = ticketsSource();
    const calls = [
      ...src.matchAll(
        /publishScopedTicketEvent\((?:'[^']+'|type),\s*\{([\s\S]*?)\}\s*\)/g,
      ),
    ].map((m) => m[1] ?? '');

    // the definition site plus every call site
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const args of calls) {
      expect(args).not.toContain('...populated');
      expect(args).not.toContain('...ticket');
    }
  });
});
