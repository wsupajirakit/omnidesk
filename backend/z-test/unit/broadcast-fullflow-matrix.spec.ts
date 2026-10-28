/**
 * [SENDPATHMATRIX] The whole send path, one matrix cell at a time.
 * ===========================================================================
 * `BroadcastNewSendService.send()` is the single door every campaign goes
 * through — send-now and scheduler alike — and it fans out across a matrix
 * nothing else in the suite drives end to end:
 *
 *   send kind × card type   broadcast/multicast × plain/personal (4 cells)
 *   message type            text · image · flex
 *   variables               site_rules.* / hook_* / profile.* / member.*
 *   conditions              the three `has_value` follow-up keys, and/or,
 *                           guard_window_hours
 *   failure                 LINE 429, abuse guard, quota, dead token, refusals
 *
 * ⚠️ NOT THE SAME FILE AS `broadcast-full-flow-matrix.spec.ts`. That one owns
 *    the label `[FULLFLOWMATRIX]` and covers a DTO/schedule matrix — it never
 *    builds a service and never dispatches. This one drives the real object.
 *
 * ⚠️ NO CEILING, ENDPOINT, REASON OR LIMIT IS TYPED BY HAND. Every one is read
 *    from the module that owns it (`SEND_MATRIX`, `@/infra/line`,
 *    `abuse-guard`, `global-quota`, the audience registry), so tuning a cell
 *    moves these cases with it instead of turning them red for a wrong reason.
 *
 * The harness mirrors `broadcast-new-send-service.spec.ts` and
 * `broadcast-personal-copy.spec.ts`: plain-object fakes, ONE declared cast, and
 * chainable query doubles that answer the REAL query shapes told apart by their
 * FILTERS (never by call order) — read from `mongo-ports.factory.ts`,
 * `recipient.pager.ts` and `oa-scope.ts`.
 */
import {
  BroadcastNewSendService,
  SEND_MATRIX,
  BROADCAST_FALLBACK_IMAGE_URL,
  BROADCAST_TITLE_DEFAULT,
  BROADCAST_VAR_EMPTY,
  GLOBAL_QUOTA,
  GUARD_WINDOW_MAX_HOURS,
  GUARD_WINDOW_MIN_HOURS,
  MAX_CONCURRENT_RUNS_GLOBAL,
  MIN_SECONDS_BETWEEN_RUNS,
  getAudienceSource,
  usesNewSendPath,
  type LegacySendResult,
} from '@/modules/content';
import {
  LINE_BROADCAST_URL,
  LINE_MULTICAST_URL,
  type LineSendResult,
} from '@/infra/line';

/* ────────────────────────────────────────────────────────────────────────────
 * The fixture boundary, and the ONLY place a cast lives in this file.
 * ──────────────────────────────────────────────────────────────────────────── */
const model = (fake: Record<string, unknown>): never => fake as never;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;

/** The chain every read that does NOT page goes through. Copied verbatim from
 *  the two reference specs so a shape drift shows up in all three at once. */
const chain = (rows: unknown[]): Rec => ({
  select: () => chain(rows),
  sort: () => chain(rows),
  limit: () => chain(rows),
  lean: () => chain(rows),
  exec: () => Promise.resolve(rows),
});

/** `findOne` — no `limit` in its chain (mongo-ports.factory.ts:225-232 uses
 *  `.sort({finished_at:-1}).select().lean().exec()`). */
const one = (row: unknown): Rec => ({
  select: () => one(row),
  sort: () => one(row),
  lean: () => one(row),
  exec: () => Promise.resolve(row),
});

/**
 * The MEMBERS chain, which is the one that has to honour `sort` and `limit`.
 *
 * 🔴 The pager reads `.find(f).select({_id:1}).sort({_id:1}).limit(limit)`
 *    (mongo-ports.factory.ts:135-142) and then walks a keyset cursor. A chain
 *    that ignores those two verbs cannot model paging at all, so a fixture
 *    built on the plain `chain()` above proves nothing about the cursor —
 *    which is exactly the seam `[FIX-20260831-PERSONALCOPY]` had to trust.
 */
const pageChain = (rows: Rec[]): Rec => {
  let out = rows;
  const self: Rec = {
    select: () => self,
    sort: () => {
      out = [...out].sort((a, b) =>
        String(a['_id']).localeCompare(String(b['_id'])),
      );
      return self;
    },
    limit: (n: number) => {
      out = out.slice(0, n);
      return self;
    },
    lean: () => self,
    exec: () => Promise.resolve(out),
  };
  return self;
};

/* ────────────────────────────────────────────────────────────────────────────
 * A filter evaluator, so the audience rules REALLY select and exclude.
 * ────────────────────────────────────────────────────────────────────────────
 * A fake that answers "here are all five members" whatever it is handed can
 * only ever prove that a query was made. These cases have to prove that the
 * conditions PICK PEOPLE — a `has_value` rule on `notice_deposit_at` must leave
 * the un-stamped members behind — so the members fake evaluates the very filter
 * `buildAudienceFilter` produced against the fixtures.
 */
const UNMODELLED: string[] = [];

const at = (doc: Rec, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (isRec(o) ? o[k] : undefined), doc);

/** Mongo's `{path: null}` matches MISSING **or** explicitly null — the whole
 *  reason `no_value` needs no `$exists` (audience-filter.ts:351-354). */
const same = (actual: unknown, want: unknown): boolean => {
  if (want === null) return actual === null || actual === undefined;
  if (want instanceof Date && actual instanceof Date) {
    return actual.getTime() === want.getTime();
  }
  return actual === want;
};

const matches = (doc: Rec, filter: Rec): boolean =>
  Object.entries(filter).every(([key, cond]) => {
    if (key === '$and') return (cond as Rec[]).every((f) => matches(doc, f));
    if (key === '$or') return (cond as Rec[]).some((f) => matches(doc, f));
    const actual = at(doc, key);
    if (isRec(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
      return Object.entries(cond).every(([op, want]) => {
        switch (op) {
          case '$ne':
            return !same(actual, want);
          case '$gte':
            return (
              actual instanceof Date &&
              want instanceof Date &&
              actual.getTime() >= want.getTime()
            );
          case '$lte':
            return (
              actual instanceof Date &&
              want instanceof Date &&
              actual.getTime() <= want.getTime()
            );
          /* the keyset cursor. Production hands an ObjectId
             (new-send.service.ts:603); hex sorts the same as the bytes do. */
          case '$gt':
            return String(actual) > String(want);
          case '$in':
            return (want as unknown[]).some((w) => same(actual, w));
          case '$nin':
            return !(want as unknown[]).some((w) => same(actual, w));
          case '$exists':
            return (actual !== undefined) === want;
          default:
            /* An operator the fixture cannot evaluate would silently select
               NOBODY, and the run would report `empty` — a refusal that blames
               the audience for the fixture's gap. Recorded and asserted on. */
            UNMODELLED.push(op);
            return false;
        }
      });
    }
    return same(actual, cond);
  });

afterEach(() => {
  const unmodelled = [...UNMODELLED];
  UNMODELLED.length = 0;
  expect(unmodelled).toEqual([]);
});

/* ────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 REAL 24-HEX IDS. The pager cursor is hard-wired to
 * `new Types.ObjectId(id)` (new-send.service.ts:603) and `safeCursor` SWALLOWS
 * the throw (recipient.pager.ts:92-98) — so a fake id like `'m1'` does not
 * fail here, it quietly re-reads page 1 and ends the OA with `stalled-pager`.
 */
const M1 = 'a0d000000000000000000033';
const M2 = 'a0d000000000000000000034';
const M3 = 'a0d000000000000000000035';
const M4 = 'a0d000000000000000000036';
const M5 = 'a0d000000000000000000037';

const HOUR = 3_600_000;
const NOW = Date.now();
const ago = (h: number): Date => new Date(NOW - h * HOUR);

/** The three stamps this matrix drives, as `member-config.registry` stores
 *  them: `config.` + the config key (member-config.helper.ts:37-39) — and the
 *  same strings the audience registry uses as its `path`s. */
const stamps = (v: {
  deposit?: Date;
  withdraw?: Date;
  helper?: Date;
}): Rec => ({
  config: {
    follow_up: {
      line: {
        ...(v.deposit ? { notice_deposit_at: v.deposit } : {}),
        ...(v.withdraw ? { notice_withdraw_at: v.withdraw } : {}),
        ...(v.helper ? { customer_helper_trigger_at: v.helper } : {}),
      },
    },
  },
});

/**
 * ⚠️ `raw_profile_data` MUST carry the `{data:{profile:{…}}}` envelope.
 * `readProfileObject` (raw-blob.reader.ts:55-72) accepts only four shapes, and
 * a BARE `{promotion:…}` matches none of them — every `{{profile.*}}` tag then
 * renders `N/A` with nothing reporting it. The site-rules reader is the
 * opposite: `pickShop` never returns null and takes a bare shop object too
 * (spec/pick-shop.ts:11-23), so ONE rule for both envelopes is wrong.
 */
const profileBlob = (fashion: number): Rec => ({
  data: {
    profile: {
      web_code: 'w1',
      promotion: { activity_volume_done: { fashion } },
    },
  },
});

const MEMBERS: Rec[] = [
  /* linked profile + a FRESH deposit stamp */
  {
    _id: M1,
    line_user_id: 'U1',
    display_name: 'ดิสเพลย์หนึ่ง',
    full_name: 'Member One',
    raw_profile_data: profileBlob(111),
    ...stamps({ deposit: ago(1) }),
  },
  /* a FRESH withdraw stamp only, and no profile blob at all */
  {
    _id: M2,
    line_user_id: 'U2',
    display_name: 'ดิสเพลย์สอง',
    full_name: 'Member Two',
    raw_profile_data: profileBlob(222),
    ...stamps({ withdraw: ago(2) }),
  },
  /* a STALE deposit stamp — inside `has_value`, outside a 6-hour guard */
  { _id: M3, line_user_id: 'U3', ...stamps({ deposit: ago(48) }) },
  /* BOTH fresh — the only member an `and` of deposit+withdraw can reach */
  {
    _id: M4,
    line_user_id: 'U4',
    ...stamps({ deposit: ago(3), withdraw: ago(3) }),
  },
  /* the register-card leg: helper stamped, NOT linked, never chased before —
     the three conditions `force-no-profile` + `force-no-follow-up` add. */
  { _id: M5, line_user_id: 'U5', ...stamps({ helper: ago(2) }) },
];

/**
 * ⚠️ THE HOOK COLUMNS ARE RENAMED, NOT PASSED THROUGH:
 * `{{hook_domain}}` reads `domain_name`, `{{hook_name}}` reads `company_name`,
 * `{{hook_detail}}` reads `description` (build-broadcast-vars.ts:45-49). A row
 * keyed on the TAG name makes every hook tag render N/A with no error at all.
 * `alias` / `group` feed the webhook-log row, never the vars.
 */
const HOOKS: Record<string, Rec> = {
  h1: {
    _id: 'h1',
    alias: 'OA-ONE',
    group: 'g1',
    access_token: 'tok-1',
    domain_name: 'alpha.example',
    company_name: 'Alpha Co',
    description: 'the first OA',
    raw_site_rules_data: {
      data: {
        shop: { wallet: { wallet_setting: { deposit_amount_min: 100 } } },
      },
    },
  },
  h2: {
    _id: 'h2',
    alias: 'OA-TWO',
    group: 'g2',
    access_token: 'tok-2',
    domain_name: 'beta.example',
    company_name: 'Beta Co',
    description: 'the second OA',
    raw_site_rules_data: {
      data: {
        shop: { wallet: { wallet_setting: { deposit_amount_min: 200 } } },
      },
    },
  },
  h3: { _id: 'h3', alias: 'OA-THREE', group: 'g3', access_token: 'tok-3' },
  /* no `access_token`, no `line_key` — the dead-token case */
  hNoTok: { _id: 'hNoTok', alias: 'OA-NOTOKEN', group: 'g9' },
  /* a dot is outside `SAFE_PART` (retry-key.ts:30) — the OA stops rather
     than having its id sanitised into somebody else's key */
  'h.1': { _id: 'h.1', alias: 'OA-DOTTED', group: 'g8', access_token: 'tok-8' },
};

/** hookId → the member `_id`s that have a chat room on that OA. This is what
 *  makes `countRecipients` two steps (mongo-ports.factory.ts:186-207) real. */
const ROOMS: Record<string, string[]> = {
  h1: [M1, M2, M3, M4, M5],
  h2: [M1, M2],
  h3: [M1],
  hNoTok: [M1, M2],
  'h.1': [M1, M2],
};

const OK: LineSendResult = {
  ok: true,
  status: 200,
  attempts: 1,
  durationMs: 1,
};
/** LINE's real monthly-quota answer, in the shape `line-push-error.ts:102`
 *  builds: `HTTP <status> - <message> [reqId: <id>]`. */
const QUOTA_REASON =
  'HTTP 429 - You have reached your monthly limit. [reqId: abc-123]';
const RATE_LIMITED: LineSendResult = {
  ok: false,
  status: 429,
  attempts: 1,
  durationMs: 1,
  reason: QUOTA_REASON,
};

/* ────────────────────────────────────────────────────────────────────────────
 * The service, wired to fakes that answer the real query shapes
 * ──────────────────────────────────────────────────────────────────────────── */
interface Seen {
  readonly dispatched: Rec[];
  readonly logs: Rec[];
  readonly history: Rec[];
  /** every `broadcasts.findOneAndUpdate` — claim first, release last */
  readonly claims: Rec[];
  readonly chatRows: Rec[];
  /** every filter `members.find` was handed, in order */
  readonly memberFinds: Rec[];
  /** `updateMany` / `updateOne` on members (notice clear, abandon stamp) */
  readonly memberWrites: Rec[];
  /** every filter `broadcasts_histories.countDocuments` was handed */
  readonly historyCounts: Rec[];
}

interface Options {
  /** What LINE answers, per dispatch call (1-based, across the whole run). */
  readonly answer?: (n: number) => LineSendResult;
  readonly actor?: { readonly id?: unknown; readonly name?: string };
  /** abuse-guard inputs (mongo-ports.factory.ts:218-287) */
  readonly jobIsRunning?: number;
  readonly runsInFlight?: number;
  readonly runsOfJob?: number;
  readonly runsOfUser?: number;
  readonly lastFinishedAt?: Date;
  /** a counter read that throws ⇒ `safeCount` → NaN → `unreadable-state` */
  readonly countsThrow?: boolean;
  /** rows `readQuotaUsage` sums `sent` + `requests_made` from */
  readonly quotaRows?: Rec[];
  /** `null` ⇒ somebody else holds the job (run-broadcast.ts:123-133) */
  readonly claimReturns?: unknown;
}

const ACTOR = { id: 'u1', name: 'admin one' };
/** scheduler.driver.ts:68 — `id: undefined` is what keeps
 *  `runsByThisUserLastHour` at 0 instead of NaN. */
const SCHEDULER_ACTOR = { id: undefined, name: 'scheduler' };

function build(opts: Options = {}): {
  service: BroadcastNewSendService;
  seen: Seen;
} {
  const seen: Seen = {
    dispatched: [],
    logs: [],
    history: [],
    claims: [],
    chatRows: [],
    memberFinds: [],
    memberWrites: [],
    historyCounts: [],
  };
  const answer = opts.answer ?? (() => OK);
  const count = (n: number): Promise<number> =>
    opts.countsThrow
      ? Promise.reject(new Error('the counter collection is unreachable'))
      : Promise.resolve(n);

  /**
   * FIVE query shapes reach `members`, and they are told apart by their
   * FILTERS, never by call order:
   *   `{line_user_id:{$in}}`  the PERSONAL prefetch  → full rows
   *   `{_id:{$gt}}`           pager page 2+          → whatever sorts after
   *   anything else           pager page 1 / count   → the audience match
   * The audience filter is EVALUATED, so a condition really does exclude.
   */
  const memberModel = {
    find: (q: unknown) => {
      const f = isRec(q) ? q : {};
      seen.memberFinds.push(f);
      return pageChain(MEMBERS.filter((m) => matches(m, f)));
    },
    /* `clearNoticeForReached` → `clearMemberConfigMany`
       (member-config.helper.ts:178-181). Absent, its failure is swallowed into
       a WARN and a test asserting on notice-clearing proves nothing. */
    updateMany: (filter: Rec, update: Rec) => {
      seen.memberWrites.push({ op: 'updateMany', filter, update });
      return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
    },
    /* `stampAbandonForReached` → `writeMemberConfigOnce` — ONE call per
       reached line id (member-config.helper.ts:120-129). */
    updateOne: (filter: Rec, update: Rec) => {
      seen.memberWrites.push({ op: 'updateOne', filter, update });
      return { exec: () => Promise.resolve({ modifiedCount: 1 }) };
    },
  };

  const idsOnHook = (hookId: unknown): string[] => ROOMS[String(hookId)] ?? [];

  /** Two `find` shapes and a `countDocuments`, all on `chat_rooms`:
   *   `{user_id:{$in}, hook_id}`      the OA scope (oa-scope.ts:97-101)
   *   `{hook_id, line_user_id:{$in}}` the transcript rooms
   *   `countDocuments`                step 2 of `countRecipients` */
  const chatRoomModel = {
    countDocuments: (q: unknown) => {
      const f = isRec(q) ? q : {};
      const want = isRec(f['user_id'])
        ? (f['user_id']['$in'] as unknown[]).map(String)
        : [];
      const here = idsOnHook(f['hook_id']);
      return count(want.filter((id) => here.includes(id)).length);
    },
    find: (q: unknown) => {
      const f = isRec(q) ? q : {};
      const uid = f['user_id'];
      if (isRec(uid) && Array.isArray(uid['$in'])) {
        const want = (uid['$in'] as unknown[]).map(String);
        const here = idsOnHook(f['hook_id']);
        return chain(
          MEMBERS.filter(
            (m) =>
              want.includes(String(m['_id'])) &&
              here.includes(String(m['_id'])),
          ).map((m) => ({ line_user_id: m['line_user_id'] })),
        );
      }
      const lid = f['line_user_id'];
      if (isRec(lid) && Array.isArray(lid['$in'])) {
        const want = lid['$in'] as unknown[];
        return chain(
          MEMBERS.filter((m) => want.includes(m['line_user_id'])).map((m) => ({
            _id: `room-${String(f['hook_id'])}-${String(m['line_user_id'])}`,
            hook_id: f['hook_id'],
            line_user_id: m['line_user_id'],
          })),
        );
      }
      /* skip-assist and anything else this matrix does not drive */
      return chain([]);
    },
  };

  const broadcastModel = {
    /* TWO different filters (mongo-ports.factory.ts:241-285): `jobIsRunning`
       carries `status:'sending'`; the in-flight one does not. A fake answering
       one constant > 0 trips `already-running` before anything else runs. */
    countDocuments: (q: unknown) => {
      const f = isRec(q) ? q : {};
      return f['status'] === 'sending'
        ? count(opts.jobIsRunning ?? 0)
        : count(opts.runsInFlight ?? 0);
    },
    findOneAndUpdate: (filter: Rec, update: Rec) => {
      seen.claims.push({ filter, update });
      const claiming = isRec(filter['status']);
      const doc = claiming
        ? opts.claimReturns === undefined
          ? { _id: 'b1' }
          : opts.claimReturns
        : { _id: 'b1' };
      return { lean: () => ({ exec: () => Promise.resolve(doc) }) };
    },
  };

  const hookModel = {
    findById: (id: unknown) => one(HOOKS[String(id)] ?? null),
    find: (q: unknown) => {
      const f = isRec(q) ? q : {};
      const want = isRec(f['_id']) ? (f['_id']['$in'] as unknown[]) : [];
      return chain(want.map((id) => HOOKS[String(id)]).filter(Boolean));
    },
  };

  const historyModel = {
    countDocuments: (q: unknown) => {
      const f = isRec(q) ? q : {};
      seen.historyCounts.push(f);
      return count(
        'broadcast_id' in f ? (opts.runsOfJob ?? 0) : (opts.runsOfUser ?? 0),
      );
    },
    findOne: () =>
      one(opts.lastFinishedAt ? { finished_at: opts.lastFinishedAt } : null),
    find: () => chain(opts.quotaRows ?? []),
    insertMany: (rows: Rec[]) => {
      seen.history.push(...rows);
      return Promise.resolve(rows);
    },
  };

  const chatMessageModel = {
    insertMany: (rows: Rec[]) => {
      seen.chatRows.push(...rows);
      return Promise.resolve(rows);
    },
  };

  const service = new BroadcastNewSendService(
    model(broadcastModel),
    model(hookModel),
    /* [FEAT-20260824-BCASTFLEXID] every job here carries its card inline, so
       the library must never be reached — `null` is the answer that FAILS a
       case which starts depending on a fetched body (saved-card.ts:180-193).
       ⚠️ `.lean()` returns the promise directly; there is NO `.exec()`. */
    model({ findById: () => ({ lean: () => Promise.resolve(null) }) }),
    /* `Member` / `ChatRoom` / `ChatMessage` (+ `Ticket` / `AssignHistory`)
       arrive through the CONNECTION by string name, not through DI — importing
       the chat barrel from `content/` closes a boot cycle
       (new-send.service.ts:130-145). `modelOf` THROWS for a name with no
       answer, and `send()` turns that into per-hook errors. */
    model({
      model: (name: string) =>
        name === 'Member'
          ? memberModel
          : name === 'ChatMessage'
            ? chatMessageModel
            : chatRoomModel,
    }),
    model(historyModel),
    model({
      persist: (doc: Rec) => {
        seen.logs.push(doc);
        return Promise.resolve(doc);
      },
    }),
    model({ safeDecrypt: (v: string) => v }),
    model({
      dispatch: (req: Rec) => {
        seen.dispatched.push(req);
        return Promise.resolve(answer(seen.dispatched.length));
      },
    }),
    /* `null` = "no dictionary entry", which is what the real service answers
       for an unknown key — so plain columns and numbers pass through. */
    model({ translate: () => null }),
  );
  return { service, seen };
}

const send = async (
  job: Rec,
  opts: Options = {},
): Promise<{
  out: { results: LegacySendResult[]; status: string };
  seen: Seen;
}> => {
  const built = build(opts);
  const out = await built.service.send(job, opts.actor ?? ACTOR);
  return { out, seen: built.seen };
};

/* ── job builders ────────────────────────────────────────────────────────── */
const TEXT = { type: 'text', text: 'hello everyone' };

const job = (over: Rec = {}): Rec => ({
  _id: 'b1',
  name: 'august promo',
  hook_ids: ['h1'],
  send_kind: 'multicast',
  card_type: 'plain',
  target: { mode: 'all', rules: [] },
  message: TEXT,
  ...over,
});

const statuses = (out: { results: LegacySendResult[] }): string[] =>
  out.results.map((r) => r.status);
const errorOf = (out: { results: LegacySendResult[] }, i = 0): string =>
  String(out.results[i]?.['error'] ?? '');
const toOf = (req: Rec): string[] => (req['to'] as string[] | undefined) ?? [];
const firstMessage = (req: Rec): Rec =>
  (req['messages'] as Rec[] | undefined)?.[0] ?? {};

/** The filters the PAGER and `countRecipients` were handed — the prefetch and
 *  the cursor pages excluded. Both must be the SAME audience, which is the
 *  invariant `mongo-ports.factory.ts:186-192` exists to keep. */
const audienceFiltersOf = (seen: Seen): Rec[] => {
  const found = seen.memberFinds.filter(
    (f) => !isRec(f['line_user_id']) && !(isRec(f['_id']) && '$gt' in f['_id']),
  );
  /* 🔴 A `for (const f of [])` loop passes vacuously, so every case that
     asserts on the filter would go green on a run that never read `members`
     at all. Proven here once, for all of them. */
  expect(found.length).toBeGreaterThan(0);
  return found;
};

const historyRows = (seen: Seen): Rec[] => seen.history;

/* ═══════════════════════════════════════════════════════════════════════════
 * §1 — the four cells of send_kind × card_type
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('[SENDPATHMATRIX] §1 send kind × card type', () => {
  it('⭐ broadcast:plain — ONE request per OA, and NO `to` on the wire', async () => {
    const cell = SEND_MATRIX['broadcast:plain'];
    const { out, seen } = await send(
      job({ send_kind: 'broadcast', hook_ids: ['h1', 'h2'] }),
    );

    expect(out.status).toBe('sent');
    expect(seen.dispatched).toHaveLength(2);
    expect(cell.recipientsPerRequest).toBe(0);
    for (const req of seen.dispatched) {
      expect(req['kind']).toBe(cell.sendKind);
      /* `expect(req.to).toBeUndefined()` passes either way — the KEY must be
         absent (inline.sink.ts:163-165), not present-and-empty. */
      expect(Object.prototype.hasOwnProperty.call(req, 'to')).toBe(false);
    }
    expect(seen.logs).toHaveLength(2);
    for (const row of seen.logs)
      expect(row['endpoint']).toBe(LINE_BROADCAST_URL);
  });

  it('⭐⭐ broadcast:plain writes NO chat transcript — that pipe never learns who it reached', async () => {
    const { out, seen } = await send(job({ send_kind: 'broadcast' }));

    /* `collector.delivered` fires only when `recipientsPerRequest > 0`
       (inline.sink.ts:183-189), so `reachedByHook` stays empty and the whole
       post-run block (new-send.service.ts:753) is skipped: no transcript, no
       notice clear, no abandon stamp. The easiest wrong assertion in the
       matrix is expecting chat rows here. */
    expect(out.status).toBe('sent');
    expect(seen.chatRows).toEqual([]);
    expect(seen.memberWrites).toEqual([]);
  });

  it('⭐⭐ 🔴 broadcast:personal is REFUSED with the cell`s own reason, and sends nothing', async () => {
    const cell = SEND_MATRIX['broadcast:personal'];
    const { out, seen } = await send(
      job({ send_kind: 'broadcast', card_type: 'personal' }),
    );

    /* `cellFor` deliberately RETURNS the impossible cell rather than correcting
       it (new-send.helpers.ts:44-53); `planRun` refuses on `!cell.allowed`
       BEFORE the `maxHooks: 0` branch (run-plan.ts:129-134). The sentence is
       imported, never retyped. */
    expect(cell.allowed).toBe(false);
    expect(seen.dispatched).toEqual([]);
    expect(statuses(out)).toEqual(['error']);
    expect(errorOf(out)).toBe(cell.reason);
    expect(out.status).toBe('failed');
    /* a refused PLAN still writes its history row and its log row — a silent
       refusal is invisible to the admin */
    expect(historyRows(seen)).toHaveLength(1);
    expect(seen.logs).toHaveLength(1);
  });

  it('⭐ multicast:plain — ONE chunk of 500 carries every recipient', async () => {
    const cell = SEND_MATRIX['multicast:plain'];
    const { out, seen } = await send(job());

    expect(cell.recipientsPerRequest).toBe(500);
    expect(out.status).toBe('sent');
    expect(seen.dispatched).toHaveLength(1);
    expect(toOf(seen.dispatched[0] as Rec).sort()).toEqual([
      'U1',
      'U2',
      'U3',
      'U4',
      'U5',
    ]);
    expect(seen.logs).toHaveLength(1);
    for (const row of seen.logs)
      expect(row['endpoint']).toBe(LINE_MULTICAST_URL);
  });

  it('⭐⭐ multicast:personal — ONE request per person, each `to` a single id', async () => {
    const cell = SEND_MATRIX['multicast:personal'];
    const { out, seen } = await send(job({ card_type: 'personal' }));

    /* `recipientsPerRequest: 1` (send-matrix.registry.ts:101), and
       `PersonalCardMessageBuilder` REFUSES any chunk of a different size
       (card-message.builder.ts:503). */
    expect(cell.recipientsPerRequest).toBe(1);
    expect(out.status).toBe('sent');
    expect(seen.dispatched).toHaveLength(MEMBERS.length);
    for (const req of seen.dispatched) expect(toOf(req)).toHaveLength(1);
    expect(seen.dispatched.flatMap(toOf).sort()).toEqual([
      'U1',
      'U2',
      'U3',
      'U4',
      'U5',
    ]);
  });

  it('⭐⭐ 🔴 THREE OAs on a personal multicast is FATAL, not a trim', async () => {
    const cell = SEND_MATRIX['multicast:personal'];
    const { out, seen } = await send(
      job({ card_type: 'personal', hook_ids: ['h1', 'h2', 'h3'] }),
    );

    /* `maxHooks: 2` is arithmetic (300 requests × ceil(3/2) waves > the 300
       budget), and `run-plan.ts:192-203` refuses the WHOLE run rather than
       dropping the third OA — dropping an OA the admin ticked changes who
       receives the campaign without saying so. */
    expect(cell.maxHooks).toBe(2);
    expect(seen.dispatched).toEqual([]);
    expect(out.status).toBe('failed');
    expect(statuses(out)).toEqual(['error', 'error', 'error']);
    expect(errorOf(out)).toBe(
      `3 OAs, and this combination allows ${cell.maxHooks}`,
    );
  });

  it('🔴 `cellFor` coerces silently — only the exact strings pick a cell', async () => {
    /* `card_type: 'PERSONAL'` is NOT personal (new-send.helpers.ts:45-46): it
       falls to plain, so five people ride ONE request instead of five. A
       matrix row meaning `personal` must spell it exactly. */
    const { seen } = await send(job({ card_type: 'PERSONAL' }));
    expect(seen.dispatched).toHaveLength(1);
    expect(toOf(seen.dispatched[0] as Rec)).toHaveLength(5);

    /* and `send_kind: 'Multicast'` is NOT multicast — it becomes broadcast,
       whose pipe carries no `to` at all */
    const b = await send(job({ send_kind: 'Multicast' }));
    expect(b.seen.dispatched).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(b.seen.dispatched[0] as Rec, 'to'),
    ).toBe(false);
  });

  it('🔴 two OAs in one run get DIFFERENT retry keys, and every key is a UUID v5', async () => {
    const { seen } = await send(job({ hook_ids: ['h1', 'h2'] }));
    const keys = seen.dispatched.map((d) => String(d['retryKey']));

    /* LINE refuses a non-UUID `X-Line-Retry-Key`; and a SHARED key marks the
       second chunk delivered without sending it (retry-key.ts:110-124). */
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(keys).toHaveLength(2);
    for (const k of keys) expect(k).toMatch(UUID);
    expect(new Set(keys).size).toBe(2);
  });

  it('OAs run SEQUENTIALLY despite `maxParallelOa: 2` — the order is deterministic', async () => {
    /* `run-executor.ts:188` is a plain `for … await`; the cell number is a
       POLICY input to the wave arithmetic, not a scheduler. */
    expect(SEND_MATRIX['multicast:plain'].maxParallelOa).toBe(2);
    const { seen } = await send(job({ hook_ids: ['h1', 'h2'] }));
    expect(seen.history.map((r) => r['hook_id'])).toEqual(['h1', 'h2']);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2 — message types on the wire
 * ═══════════════════════════════════════════════════════════════════════════ */
describe('[SENDPATHMATRIX] §2 message types', () => {
  it('⭐ text ships exactly two keys', async () => {
    const { seen } = await send(job());
    expect(firstMessage(seen.dispatched[0] as Rec)).toEqual({
      type: 'text',
      text: 'hello everyone',
    });
  });

  it('⭐ image ships the SAME url twice, and no `image_url` key at all', async () => {
    const url = 'https://cdn.example.com/promo.jpg';
    const { seen } = await send(
      job({ message: { type: 'image', image_url: url } }),
    );
    const msg = firstMessage(seen.dispatched[0] as Rec);

    /* `image_url` exists only on the INPUT; the wire object is
       `originalContentUrl` + `previewImageUrl` (build-payload.broadcast.ts:29-34) */
    expect(msg).toEqual({
      type: 'image',
      originalContentUrl: url,
      previewImageUrl: url,
    });
    expect(Object.prototype.hasOwnProperty.call(msg, 'image_url')).toBe(false);
    expect(historyRows(seen)[0]?.['images_replaced']).toBe(0);
  });

  it('⭐⭐ 🔴 an unusable image url is SWAPPED for the fallback, and counted', async () => {
    /* `isUsableImageUrl` wants https AND a dot in the host
       (image-url.shape.ts:27-42): `http://` never passes, and neither does
       `https://x/a.jpg`. The fallback is imported, never retyped. */
    const { seen } = await send(
      job({
        message: { type: 'image', image_url: 'http://cdn.example.com/a.jpg' },
      }),
    );
    const msg = firstMessage(seen.dispatched[0] as Rec);

    expect(msg['originalContentUrl']).toBe(BROADCAST_FALLBACK_IMAGE_URL);
    expect(msg['previewImageUrl']).toBe(BROADCAST_FALLBACK_IMAGE_URL);
    expect(historyRows(seen)[0]?.['images_replaced']).toBe(1);
  });

  it('🔴 a blank image url is a REPLACEMENT, not a zero', async () => {
    /* `asText` turns an absent value into `N/A` (BROADCAST_VAR_EMPTY), which
       fails the shape check — so the count is 1 and the url is the fallback. */
    const { seen } = await send(job({ message: { type: 'image' } }));
    expect(firstMessage(seen.dispatched[0] as Rec)['originalContentUrl']).toBe(
      BROADCAST_FALLBACK_IMAGE_URL,
    );
    expect(historyRows(seen)[0]?.['images_replaced']).toBe(1);
  });

  it('⭐ flex ships `altText` from the JOB`s title_detail, not `Broadcast message`', async () => {
    const flex = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'hi' }],
      },
    };
    const { seen } = await send(
      job({
        message: { type: 'flex', flex_json: flex },
        title_detail: 'โปรเดือนสิงหา',
      }),
    );
    const msg = firstMessage(seen.dispatched[0] as Rec);

    /* core hardcodes `Broadcast message` and the card builder OVERWRITES it
       (card-message.builder.ts:356-360). Asserting core's string here fails. */
    expect(msg['type']).toBe('flex');
    expect(msg['altText']).toBe('โปรเดือนสิงหา');
    expect(msg['altText']).not.toBe('Broadcast message');
    expect(msg['contents']).toEqual(flex);
  });

  it('a flex card with no title_detail falls back to the default title', async () => {
    const flex = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text: 'hi' }],
      },
    };
    const { seen } = await send(
      job({ message: { type: 'flex', flex_json: flex } }),
    );
    expect(firstMessage(seen.dispatched[0] as Rec)['altText']).toBe(
      BROADCAST_TITLE_DEFAULT,
    );
  });

  it('⭐⭐ 🔴 an UNKNOWN card type falls into the flex branch and renders NOTHING', async () => {
    /* `savedCardOf` keeps any string `type` (saved-card.ts:20-30) and
       `buildCardMessage` routes anything that is not text/image to flex — with
       no `flex_json` that is zero messages, which the sink reports as a failed
       chunk (inline.sink.ts:152-155). It is NOT a refusal and NOT a send. */
    const { out, seen } = await send(
      job({ message: { type: 'sticker', text: 'x' } }),
    );

    expect(seen.dispatched).toEqual([]);
    expect(out.status).toBe('failed');
    expect(errorOf(out)).toBe('run status: error — no message to send');
  });

  it('🔴 a message with no `type` refuses the whole job before any model is read', async () => {
    const { out, seen } = await send(
      job({ message: { text: 'no type here' } }),
    );

    expect(out.status).toBe('failed');
    expect(errorOf(out)).toBe('this broadcast has no message to send');
    expect(seen.dispatched).toEqual([]);
    expect(seen.claims).toEqual([]);
  });

  it('the webhook_logs payload snapshot names the type and the kind that ran', async () => {
    const { seen } = await send(job());
    expect(seen.logs[0]?.['payload_summary']).toEqual({
      broadcast_id: 'b1',
      send_kind: 'multicast',
      message_type: 'text',
      text: 'hello everyone',
      image_url: undefined,
      flex_json: undefined,
    });
    /* ⚠️ deliberately NO `http_status` (new-send.service.ts:1021-1024) */
    expect(
      Object.prototype.hasOwnProperty.call(seen.logs[0] as Rec, 'http_status'),
    ).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3 — variables: which families resolve on which pipe
 * ═══════════════════════════════════════════════════════════════════════════ */
const MIXED_CARD =
  'A {{profile.act_done_fashion}}' +
  ' B {{site_rules.dep_min}}' +
  ' C {{hook_domain}}' +
  ' D {{member.display_name}}' +
  ' E {{act_done_fashion}}' + // the BARE profile alias — profile has both
  ' F {{dep_min}}' + //        the bare site_rules alias — which does NOT exist
  ' G {{nope_tag}}'; //        outside the spec entirely

const textSentTo = (seen: Seen, id: string): string =>
  String(
    firstMessage(seen.dispatched.find((d) => toOf(d).includes(id)) ?? {})[
      'text'
    ],
  );

describe('[SENDPATHMATRIX] §3 variables', () => {
  it('⭐⭐ multicast:plain — site_rules and hook_* resolve; profile and member are N/A', async () => {
    const { seen } = await send(
      job({ message: { type: 'text', text: MIXED_CARD } }),
    );

    /* `buildOaVarMap` passes `storedProfile: undefined` and `member: null` ON
       PURPOSE (oa-vars.reader.ts:134-142) — one card per OA cannot know a
       person. So half the families are `N/A`, by design, not by accident. */
    expect(firstMessage(seen.dispatched[0] as Rec)['text']).toBe(
      `A ${BROADCAST_VAR_EMPTY}` +
        ' B 100' +
        ' C alpha.example' +
        ` D ${BROADCAST_VAR_EMPTY}` +
        ` E ${BROADCAST_VAR_EMPTY}` +
        ` F ${BROADCAST_VAR_EMPTY}` +
        ` G ${BROADCAST_VAR_EMPTY}`,
    );
  });

  it('⭐⭐ 🔴 THE N/A PRE-FILL TRAP — an unfilled spec tag is NOT an unknown tag', async () => {
    const { seen } = await send(
      job({ message: { type: 'text', text: MIXED_CARD } }),
    );

    /* `buildBroadcastVars` writes EVERY spec tag as a key whatever the data is,
       and `normalizeEmpties` guarantees none is `''` — so `substitute.ts:118-126`
       never calls them unknown. Only a tag OUTSIDE the spec lands here, plus
       the site-rules family's missing BARE alias.
       ⚠️ `oa-vars.reader.ts:15-19` claims the opposite in prose. The CODE is
          the contract; a matrix built on that docblock would be red here. */
    expect(historyRows(seen)[0]?.['unknown_tags']).toEqual([
      'dep_min',
      'nope_tag',
    ]);
  });

  it('⭐⭐ multicast:personal — all four families resolve, per person', async () => {
    const { seen } = await send(
      job({
        card_type: 'personal',
        message: { type: 'text', text: MIXED_CARD },
      }),
    );

    /* `PagedRecipientVarSource` hands the member's OWN `raw_profile_data` and
       the member row itself, plus the same hook row (recipient-vars.reader.ts:108-117) */
    expect(textSentTo(seen, 'U1')).toBe(
      'A 111 B 100 C alpha.example D ดิสเพลย์หนึ่ง E 111' +
        ` F ${BROADCAST_VAR_EMPTY} G ${BROADCAST_VAR_EMPTY}`,
    );
    /* and NEVER each other's numbers */
    expect(textSentTo(seen, 'U2')).toContain('A 222');
    expect(textSentTo(seen, 'U2')).not.toContain('111');
    /* a member with no profile blob and no name columns still renders */
    expect(textSentTo(seen, 'U3')).toBe(
      `A ${BROADCAST_VAR_EMPTY} B 100 C alpha.example D ${BROADCAST_VAR_EMPTY}` +
        ` E ${BROADCAST_VAR_EMPTY} F ${BROADCAST_VAR_EMPTY} G ${BROADCAST_VAR_EMPTY}`,
    );
  });

  it('🔴 `{{member.name}}` never renders N/A — its floor is the word `member`', async () => {
    const { seen } = await send(
      job({
        card_type: 'personal',
        message: { type: 'text', text: '[{{member.name}}]' },
      }),
    );

    /* full_name → phone_number → display_name → `member`
       (build-broadcast-vars.ts:146-154). M1 has a full name; M3 has nothing. */
    expect(textSentTo(seen, 'U1')).toBe('[Member One]');
    expect(textSentTo(seen, 'U3')).toBe('[member]');
  });

  it('🔴 the hook tags read RENAMED columns — a row keyed on the tag renders N/A', async () => {
    const { seen } = await send(
      job({
        message: {
          type: 'text',
          text: '{{hook_domain}}|{{hook_name}}|{{hook_detail}}',
        },
      }),
    );

    /* `domain_name` → `hook_domain`, `company_name` → `hook_name`,
       `description` → `hook_detail` (build-broadcast-vars.ts:45-49) */
    expect(firstMessage(seen.dispatched[0] as Rec)['text']).toBe(
      'alpha.example|Alpha Co|the first OA',
    );
  });

  it('⭐ each OA gets its OWN card — the values are per hook, not per run', async () => {
    const { seen } = await send(
      job({
        hook_ids: ['h1', 'h2'],
        message: {
          type: 'text',
          text: '{{hook_domain}}/{{site_rules.dep_min}}',
        },
      }),
    );

    expect(seen.dispatched).toHaveLength(2);
    expect(firstMessage(seen.dispatched[0] as Rec)['text']).toBe(
      'alpha.example/100',
    );
    expect(firstMessage(seen.dispatched[1] as Rec)['text']).toBe(
      'beta.example/200',
    );
  });

  it('🔴 a PLAIN card carrying {{profile.*}} still SENDS — the mismatch gate is save-time only', async () => {
    /* `checkProfileMatch` has exactly one caller and it is
       `broadcasts.service.ts:213` (a 400 on create/update). Nothing on the send
       path consults it, so this is a successful send full of N/A — expecting a
       refusal here would be a test of a rule that does not exist. */
    const { out, seen } = await send(
      job({
        card_type: 'plain',
        message: { type: 'text', text: '{{profile.act_done_fashion}}' },
      }),
    );

    expect(out.status).toBe('sent');
    expect(firstMessage(seen.dispatched[0] as Rec)['text']).toBe(
      BROADCAST_VAR_EMPTY,
    );
  });

  it('🔴 a personal run stores each room ITS OWN rendered card, never the template', async () => {
    const { seen } = await send(
      job({
        card_type: 'personal',
        message: {
          type: 'text',
          text: 'ทำแล้ว {{profile.act_done_fashion}}',
        },
      }),
    );
    const byRoom = new Map(
      seen.chatRows
        .filter((r) => r['message_type'] === 'text')
        .map((r) => [String(r['room_id']), String(r['content'])]),
    );

    expect(byRoom.get('room-h1-U1')).toBe('ทำแล้ว 111');
    expect(byRoom.get('room-h1-U2')).toBe('ทำแล้ว 222');
    expect(byRoom.get('room-h1-U1')).not.toContain('{{profile.');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4 — timing: send-now vs scheduled
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE SERVICE IS IDENTICAL FOR BOTH. Inside `BroadcastNewSendService` there
 *    is exactly ONE status-shaped decision (`repeating`, from the schedule
 *    RULE) and one actor-shaped one (`actor.id`, which the run counters match
 *    against). Everything else — claim, plan, quota, send, history, release —
 *    is the same code path, so the cases below drive the two things that
 *    really differ, and the upstream fork is asserted where it lives.
 */
describe('[SENDPATHMATRIX] §4 send-now vs scheduled', () => {
  it('⭐ the fork itself lives UPSTREAM, in `usesNewSendPath`', async () => {
    /* `broadcasts.service.ts:857` and `scheduler.driver.ts:279` are the only
       gates; the scheduler REFUSES a job with no `send_kind` outright, because
       the legacy sender has no claim and a second cron tick would send twice.
       Driving either caller needs a Nest world, so the gate is pinned here and
       the two ACTORS are driven through `send()` below. */
    expect(usesNewSendPath('broadcast')).toBe(true);
    expect(usesNewSendPath('multicast')).toBe(true);
    expect(usesNewSendPath(undefined)).toBe(false);
    expect(usesNewSendPath('narrowcast')).toBe(false);

    /* …and calling `send()` directly bypasses that gate: a job with no
       send_kind defaults to `broadcast:plain` rather than being refused. */
    const { out, seen } = await send(job({ send_kind: undefined }));
    expect(out.status).toBe('sent');
    expect(
      Object.prototype.hasOwnProperty.call(seen.dispatched[0] as Rec, 'to'),
    ).toBe(false);
  });

  it('⭐⭐ 🔴 the SCHEDULER actor counts 0 runs, not NaN — and the run goes', async () => {
    /* [FIX-20260823-BCASTCRONACTOR]: feeding NaN for "no user" refused EVERY
       scheduled run in production. `actor.id === undefined` skips the per-user
       count entirely (mongo-ports.factory.ts:275-282), so the fake sees ONE
       history count instead of two. */
    const manual = await send(job(), { actor: ACTOR });
    const cron = await send(job(), { actor: SCHEDULER_ACTOR });

    expect(manual.seen.historyCounts).toHaveLength(2);
    expect(cron.seen.historyCounts).toHaveLength(1);
    expect(cron.seen.historyCounts[0]).toHaveProperty('broadcast_id');
    expect(cron.out.status).toBe('sent');
    expect(cron.seen.dispatched).toHaveLength(1);
  });

  it('the manual actor rides onto the history row; the scheduler leaves no user', async () => {
    const manual = await send(job(), { actor: ACTOR });
    const cron = await send(job(), { actor: SCHEDULER_ACTOR });

    expect(historyRows(manual.seen)[0]?.['triggered_by_user']).toBe('u1');
    expect(
      Object.prototype.hasOwnProperty.call(
        historyRows(cron.seen)[0] as Rec,
        'triggered_by_user',
      ),
    ).toBe(false);
  });

  it('⭐⭐ 🔴 a REPEAT schedule releases the job as `scheduled`; a one-off as `sent`', async () => {
    /* `isRepeatRule` reads `mode === 'repeat'` and nothing else
       (schedule-shape.ts:228-230). Without this link a successful round retired
       as `sent`, the due-scan filters on `scheduled`, and the job went
       invisible with a perfectly armed `next_run_at`. */
    const once = await send(job({ schedule: { mode: 'once' } }));
    const repeat = await send(
      job({ schedule: { mode: 'repeat', enabled: true } }),
    );

    const releaseOf = (seen: Seen): unknown => {
      const last = seen.claims[seen.claims.length - 1] ?? {};
      return ((last['update'] as Rec)?.['$set'] as Rec)?.['status'];
    };
    expect(releaseOf(once.seen)).toBe('sent');
    expect(releaseOf(repeat.seen)).toBe('scheduled');
    /* both DELIVERED — the difference is the release, never the send */
    expect(once.out.status).toBe('sent');
    expect(repeat.out.status).toBe('sent');
  });

  it('the claim only ever tries to take a `scheduled` job', async () => {
    const { seen } = await send(job());
    const filter = (seen.claims[0]?.['filter'] ?? {}) as Rec;

    /* `CLAIMABLE_FROM = ['scheduled']` (claim.ts:29). ⚠️ The job fixture's own
       `status` field is DEAD WEIGHT — `send()` never reads it; the state check
       lives only inside this filter. */
    expect(filter['_id']).toBe('b1');
    expect(filter['status']).toEqual({ $in: ['scheduled'] });
    expect(filter['deleted_at']).toEqual({ $exists: false });
  });

  it('🔴 the schedule and the target are frozen onto the history row', async () => {
    const schedule = { mode: 'repeat', enabled: true };
    const target = { mode: 'all', rules: [] };
    const { seen } = await send(job({ schedule, target }));

    expect(historyRows(seen)[0]?.['settings_snapshot']).toEqual({
      target,
      schedule,
      message_flex_id: undefined,
      hook_ids: ['h1'],
    });
    /* `send_kind` / `card_type` are deliberately NOT in the snapshot — they
       have their own columns and two answers to one question is a trap. */
    expect(historyRows(seen)[0]?.['send_kind']).toBe('multicast');
    expect(historyRows(seen)[0]?.['card_type']).toBe('plain');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5 — audience conditions, asserted on the FILTER the pager is handed
 * ═══════════════════════════════════════════════════════════════════════════ */
const pathOf = (key: string): string => {
  const source = getAudienceSource(key);
  if (source === null) throw new Error(`no audience source "${key}"`);
  return source.path;
};
/* Read from the registry, never retyped: `tier.code`'s path is not `tier.code`
   and a hand-copied path is the class of mistake that selects nobody. */
const DEPOSIT = pathOf('follow_up.notice_deposit_at');
const WITHDRAW = pathOf('follow_up.notice_withdraw_at');
const HELPER = pathOf('follow_up.customer_helper_at');
const ABANDON = pathOf('follow_up.abandon_at');
const REQUEST_REG = pathOf('follow_up.request_reg_at');

const rule = (key: string, op: string): Rec => ({ key, op });
const targeting = (match: string, ...rules: Rec[]): Rec => ({
  mode: 'all',
  match,
  rules,
});
const reached = (seen: Seen): string[] => seen.dispatched.flatMap(toOf).sort();

describe('[SENDPATHMATRIX] §5 conditions', () => {
  it('⭐⭐ ONE rule builds a FLAT filter — no `$and` wrapper — and it really excludes', async () => {
    const { out, seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.notice_deposit_at', 'has_value'),
        ),
      }),
    );

    /* `clauses.length === 1 ? clauses[0] : …` (audience-filter.ts:272-277).
       A one-rule test expecting `{$and:[…]}` fails, and rightly. */
    for (const f of audienceFiltersOf(seen)) {
      expect(f).toEqual({ [DEPOSIT]: { $ne: null } });
    }

    /* M1 / M3 / M4 carry a deposit stamp; M2 and M5 do not. `has_value` builds
       `{$ne: null}` and NEVER `$exists` (audience-filter.ts:351-354). */
    expect(out.status).toBe('sent');
    expect(reached(seen)).toEqual(['U1', 'U3', 'U4']);
  });

  it('⭐⭐ 🔴 `no_value` on a notice key is REFUSED — those three are locked to `has_value`', async () => {
    const { out, seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.notice_deposit_at', 'no_value'),
        ),
      }),
    );

    /* [UI-20260825-LOCKHASVALUE] — `ops: ['has_value']` (registry:238). The
       rule is refused, never coerced: a dropped condition makes the audience
       WIDER than the admin asked for. */
    expect(getAudienceSource('follow_up.notice_deposit_at')?.ops).toEqual([
      'has_value',
    ]);
    expect(out.status).toBe('failed');
    expect(errorOf(out)).toBe(
      '"no_value" is not allowed on "follow_up.notice_deposit_at"',
    );
    expect(seen.dispatched).toEqual([]);
  });

  it('🔴 and the mirror: `has_value` on a DATE key is refused just as hard', async () => {
    const { out } = await send(
      job({
        target: targeting('and', rule('follow_up.abandon_at', 'has_value')),
      }),
    );
    expect(errorOf(out)).toBe(
      '"has_value" is not allowed on "follow_up.abandon_at"',
    );
  });

  it('⭐⭐ match `or` — either stamp qualifies', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'or',
          rule('follow_up.notice_deposit_at', 'has_value'),
          rule('follow_up.notice_withdraw_at', 'has_value'),
        ),
      }),
    );

    for (const f of audienceFiltersOf(seen)) {
      expect(f).toEqual({
        $or: [{ [DEPOSIT]: { $ne: null } }, { [WITHDRAW]: { $ne: null } }],
      });
    }
    /* M1+M3+M4 by deposit, M2+M4 by withdraw — M5 has neither */
    expect(reached(seen)).toEqual(['U1', 'U2', 'U3', 'U4']);
  });

  it('⭐⭐ match `and` — BOTH stamps required', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.notice_deposit_at', 'has_value'),
          rule('follow_up.notice_withdraw_at', 'has_value'),
        ),
      }),
    );

    for (const f of audienceFiltersOf(seen)) {
      expect(f).toEqual({
        $and: [{ [DEPOSIT]: { $ne: null } }, { [WITHDRAW]: { $ne: null } }],
      });
    }
    expect(reached(seen)).toEqual(['U4']);
  });

  it('⭐⭐ 🔴 the register-card leg carries its FORCED conditions, merged into ITS OWN clause', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.customer_helper_at', 'has_value'),
        ),
      }),
    );

    /* `force-no-profile` adds `raw_profile_data: null`; `force-no-follow-up`
       adds the two chase stamps. Merged into the triggering leg
       (audience-filter.ts:236-260), which for a single rule is the whole
       filter. M5 is the only member that satisfies all four. */
    for (const f of audienceFiltersOf(seen)) {
      expect(f).toEqual({
        [HELPER]: { $ne: null },
        raw_profile_data: null,
        [ABANDON]: null,
        [REQUEST_REG]: null,
      });
    }
    expect(reached(seen)).toEqual(['U5']);
  });

  it('⭐⭐ 🔴 [FORCEPERLEG] the deposit leg of an `or` gets NOTHING added', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'or',
          rule('follow_up.customer_helper_at', 'has_value'),
          rule('follow_up.notice_deposit_at', 'has_value'),
        ),
      }),
    );

    /* Owner, 28/08: the forced `raw_profile_data: null` used to sit at the
       OUTERMOST level and silenced the deposit leg too — every member who had
       linked their profile was dropped from a campaign that was never about
       registration. M1 IS linked and must still qualify through deposit. */
    for (const f of audienceFiltersOf(seen)) {
      expect(f).toEqual({
        $or: [
          {
            [HELPER]: { $ne: null },
            raw_profile_data: null,
            [ABANDON]: null,
            [REQUEST_REG]: null,
          },
          { [DEPOSIT]: { $ne: null } },
        ],
      });
    }
    expect(reached(seen)).toEqual(['U1', 'U3', 'U4', 'U5']);
  });

  it('⭐⭐ 🔴 guard_window puts `$gte` INSIDE the rule`s own clause, and drops the stale stamp', async () => {
    const { seen } = await send(
      job({
        guard_window_hours: 6,
        target: targeting(
          'and',
          rule('follow_up.notice_deposit_at', 'has_value'),
        ),
      }),
    );

    const clause = (audienceFiltersOf(seen)[0]?.[DEPOSIT] ?? {}) as Rec;
    /* Asserting an outer `{$and:[base,{path:{$gte}}]}` would break the real
       deposit+withdraw `or` jobs (guard-window.policy.ts:133-136 +
       audience-filter.ts:174-191). Both keys, one object. */
    expect(Object.keys(clause).sort()).toEqual(['$gte', '$ne']);
    expect(clause['$ne']).toBeNull();
    const gte = clause['$gte'];
    expect(gte).toBeInstanceOf(Date);
    expect(
      Math.abs((gte as Date).getTime() - (Date.now() - 6 * HOUR)),
    ).toBeLessThan(10_000);

    /* M1 (1h) and M4 (3h) are inside the window; M3 (48h) is not — even though
       it passes the bare `has_value`. */
    expect(reached(seen)).toEqual(['U1', 'U4']);
  });

  it('⭐⭐ a guarded `or` keeps OR semantics — each leg guarded on its own', async () => {
    const { seen } = await send(
      job({
        guard_window_hours: 6,
        target: targeting(
          'or',
          rule('follow_up.notice_deposit_at', 'has_value'),
          rule('follow_up.notice_withdraw_at', 'has_value'),
        ),
      }),
    );

    const legs = (audienceFiltersOf(seen)[0]?.['$or'] ?? []) as Rec[];
    expect(legs).toHaveLength(2);
    for (const leg of legs) {
      const only = Object.values(leg)[0] as Rec;
      expect(Object.keys(only).sort()).toEqual(['$gte', '$ne']);
    }
    /* fresh deposit U1/U4, fresh withdraw U2/U4 — stale U3 is gone */
    expect(reached(seen)).toEqual(['U1', 'U2', 'U4']);
  });

  it('⭐⭐ 🔴 an out-of-range guard window FAILS CLOSED — the whole job is refused', async () => {
    const expected =
      'guard_window_hours must be a whole number of hours between ' +
      `${GUARD_WINDOW_MIN_HOURS} and ${GUARD_WINDOW_MAX_HOURS} — refusing ` +
      'rather than sending without the ' +
      'freshness the admin ordered';

    /* whole numbers inside [1,72] only (guard-window.policy.ts:69-73): the
       STRING '6' refuses too, and so do 0, 73 and 1.5 */
    for (const hours of [0, GUARD_WINDOW_MAX_HOURS + 1, 1.5, '6']) {
      const { out, seen } = await send(
        job({
          guard_window_hours: hours,
          target: targeting(
            'and',
            rule('follow_up.notice_deposit_at', 'has_value'),
          ),
        }),
      );
      expect(errorOf(out)).toBe(expected);
      expect(out.status).toBe('failed');
      expect(seen.dispatched).toEqual([]);
    }
  });

  it('⭐⭐ 🔴 THE NO-OP TRAP: guard_window on a rules-less job changes NOTHING', async () => {
    /* `buildAudienceFilter` returns `{ok:true, filter:{}}` at
       audience-filter.ts:131-133, BEFORE the guard block at :174 is reached.
       So an hours value that WOULD refuse a ruled job sails straight through
       here — a case that sets it on an empty audience and expects either a
       narrowed filter or a refusal passes/fails for the wrong reason. */
    const { out, seen } = await send(
      job({ guard_window_hours: 9_999, target: { mode: 'all', rules: [] } }),
    );

    expect(out.status).toBe('sent');
    for (const f of audienceFiltersOf(seen)) expect(f).toEqual({});
    expect(reached(seen)).toEqual(['U1', 'U2', 'U3', 'U4', 'U5']);
  });

  it('🔴 an unknown audience key refuses rather than widening the list', async () => {
    const { out, seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.nothing_like_this', 'has_value'),
        ),
      }),
    );
    expect(errorOf(out)).toBe(
      'unknown audience key — refusing rather than sending to a wider list than intended',
    );
    expect(seen.dispatched).toEqual([]);
  });

  it('🔴 an unknown target MODE refuses; `group` and `all` both send', async () => {
    const bad = await send(job({ target: { mode: 'nobody-wrote-this' } }));
    expect(bad.out.status).toBe('failed');
    expect(bad.seen.dispatched).toEqual([]);

    /* a group selects OAs, never people, and the OA list is already resolved
       and authorised at SAVE time (new-send.helpers.ts:120-155) */
    const group = await send(job({ target: { mode: 'group' } }));
    expect(group.out.status).toBe('sent');
  });

  it('⭐⭐ an OA nobody matches is SKIPPED, and `skipped` is not `error` in the log', async () => {
    const { out, seen } = await send(
      job({
        hook_ids: ['h1', 'h3'],
        target: targeting(
          'and',
          rule('follow_up.notice_withdraw_at', 'has_value'),
        ),
      }),
    );

    /* h1 holds M2+M4 (both stamped); h3 holds only M1, who is not — so
       `countRecipients` is 0 there and the plan marks it `empty`
       (run-plan.ts:154-162). The other OA keeps its campaign. */
    expect(reached(seen)).toEqual(['U2', 'U4']);
    expect(statuses(out)).toEqual(['success', 'error']);
    expect(errorOf(out, 1)).toBe('this OA was skipped: empty');
    /* [FIX-20260828-SKIPSTATUS] the LOG says `skipped`… */
    expect(seen.logs.map((r) => r['status'])).toEqual(['success', 'skipped']);
    /* …while the job status is untouched: nobody received anything on h3 */
    expect(out.status).toBe('failed');
  });

  it('⭐ the abandon stamp arms only the register-chasing campaign, once per reached person', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.customer_helper_at', 'has_value'),
        ),
      }),
    );

    /* `clearNoticeForReached` always issues TWO `updateMany` ($unset deposit,
       then withdraw — payment is deliberately never cleared), and
       `stampAbandonForReached` ONE `updateOne` per reached id, and only when
       the rules name `follow_up.customer_helper_at` with no direct ticket. */
    const many = seen.memberWrites.filter((w) => w['op'] === 'updateMany');
    const once = seen.memberWrites.filter((w) => w['op'] === 'updateOne');
    expect(many).toHaveLength(2);
    expect(once).toHaveLength(1);
    expect((once[0]?.['filter'] as Rec)['line_user_id']).toBe('U5');
    /* ⚠️ `toHaveProperty` would read the dots as a PATH; the stamped key is
       ONE key with four dots in it (member-config.helper.ts:37-39). */
    expect(Object.keys((once[0]?.['update'] as Rec)['$set'] as Rec)).toEqual([
      ABANDON,
    ]);
  });

  /**
   * ⚠️⚠️ ข้อควรระวังตอนตั้งแคมเปญ — ไม่ใช่บั๊ก (เจ้าของตัดสิน 31/08/2026)
   * ===========================================================================
   * The abandon stamp is decided PER JOB and applied PER PERSON, and that is
   * the behaviour this case PINS:
   *
   *   `shouldStamp` asks only whether the JOB's rule list mentions
   *   `follow_up.customer_helper_at` (stamp-abandon-on-multicast.ts:135-139),
   *   and the caller then hands it EVERYONE the run reached
   *   (new-send.service.ts:957 `[...reachedByHook.values()].flat()`).
   *
   * On a `match: 'or'` job that MIXES the register leg with the deposit or
   * withdraw legs, the two disagree: people selected by the deposit leg are
   * armed as well, and arming is not a note — its presence IS level 2 of the
   * webhook follow-up gate, so their next inbound message (a sticker included)
   * opens a case and the bot stops answering that room
   * (stamp-abandon-on-multicast.ts:13-30).
   *
   * 🔴 THE ANSWER IS THE CAMPAIGN, NOT THE CODE. Owner, 31/08, asked and
   *    answered: keep the two audiences in SEPARATE campaigns.
   *      · แคมเปญ 1 — ฝาก `or` ถอน       ⇒ no trigger key at all ⇒ arms NOBODY
   *      · แคมเปญ 2 — ตามการ์ดลงทะเบียน  ⇒ everyone reached IS the trigger leg
   *    Split that way the mismatch cannot arise, at the cost of one duplicate
   *    message to anyone who matches both audiences.
   *    ⇒ ห้ามผสมขาลงทะเบียนกับขาฝาก/ถอนใน `or` งานเดียว — นั่นคือกฎ ไม่ใช่ให้แก้โค้ด
   *
   * WHY THIS CASE STILL EXISTS, pinning behaviour nobody wants to rely on:
   * the rule above lives in people's heads — nothing in the form or the API
   * refuses the mixed shape today. This case is the written record of what
   * that mistake COSTS, so the next person to read it learns the rule instead
   * of discovering it from a silent room. If someone later decides to enforce
   * or change the split, this case is the one that must be revisited first.
   * 📖 todo/task/30082026/be_todo102_31082026.md
   */
  it('⚠️ a MIXED `or` job arms everyone it reached — the reason campaigns must be split', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'or',
          rule('follow_up.customer_helper_at', 'has_value'),
          rule('follow_up.notice_deposit_at', 'has_value'),
        ),
      }),
    );

    const armed = seen.memberWrites
      .filter((w) => w['op'] === 'updateOne')
      .map((w) => String((w['filter'] as Rec)['line_user_id']))
      .sort();

    /* U5 came through the register-chasing leg; U1/U3/U4 through the deposit
       leg. ALL FOUR are armed — that is today's behaviour, and it is exactly
       why this campaign shape must not be built. Split into two campaigns and
       the deposit audience is armed by nobody. */
    expect(reached(seen)).toEqual(['U1', 'U3', 'U4', 'U5']);
    expect(armed).toEqual(['U1', 'U3', 'U4', 'U5']);
  });

  it('🔴 a campaign with no such rule arms NOBODY, though it still clears the notices', async () => {
    const { seen } = await send(
      job({
        target: targeting(
          'and',
          rule('follow_up.notice_deposit_at', 'has_value'),
        ),
      }),
    );
    expect(seen.memberWrites.filter((w) => w['op'] === 'updateOne')).toEqual(
      [],
    );
    expect(
      seen.memberWrites.filter((w) => w['op'] === 'updateMany'),
    ).toHaveLength(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §6 — the negative half: LINE said no, or the run never started
 * ═══════════════════════════════════════════════════════════════════════════ */
const failWith = (over: Partial<LineSendResult>): LineSendResult => ({
  ok: false,
  status: 400,
  attempts: 1,
  durationMs: 1,
  ...over,
});

describe('[SENDPATHMATRIX] §6 LINE quota exhausted (HTTP 429)', () => {
  const quotaJob = job({ card_type: 'personal' }); // 5 people ⇒ 5 chunks

  it('⭐⭐ 🔴 the 429 chunk goes, then the OA STOPS — it does not keep spending', async () => {
    const { out, seen } = await send(quotaJob, {
      answer: (n) => (n === 1 ? RATE_LIMITED : OK),
    });

    /* `sawRateLimit` is set from `ChunkResult.status` AFTER the chunk returns,
       and the guard is asked BEFORE the next one (oa-executor.ts:403, :427) —
       so exactly ONE request leaves and the other four never do. */
    expect(seen.dispatched).toHaveLength(1);
    expect(out.status).toBe('failed');
    expect(errorOf(out)).toBe(`stopped: rate-limited — ${QUOTA_REASON}`);
  });

  it('⭐⭐ the history row records the stop, the counters and LINE`s own sentence', async () => {
    const { seen } = await send(quotaJob, {
      answer: (n) => (n === 1 ? RATE_LIMITED : OK),
    });
    const row = historyRows(seen)[0] ?? {};

    expect(row['status']).toBe('stopped');
    expect(row['stop_reason']).toBe('rate-limited');
    expect(row['targeted']).toBe(5);
    expect(row['sent']).toBe(0);
    expect(row['failed']).toBe(1);
    /* `unsent` is decremented by every ATTEMPTED chunk (run-counters.ts:155) —
       5 targeted minus the one that was tried, not 5. */
    expect(row['unsent']).toBe(4);
    expect(row['requests_made']).toBe(1);
    expect(row['chunks_done']).toBe(1);
    expect(row['error_message']).toBe(
      `stopped: rate-limited — ${QUOTA_REASON}`,
    );
  });

  it('⭐⭐ 🔴 a failed chunk leaves NO transcript row, and no notice is cleared', async () => {
    const { seen } = await send(quotaJob, { answer: () => RATE_LIMITED });

    /* `collector.delivered` fires only on `result.ok` (inline.sink.ts:183-189).
       Writing a chat row for a chunk LINE refused would put a message in a
       customer's history that never arrived. */
    expect(seen.chatRows).toEqual([]);
    expect(seen.memberWrites).toEqual([]);
  });

  it('⭐⭐ the webhook_logs row carries the failure — and still no `http_status`', async () => {
    const { seen } = await send(quotaJob, {
      answer: (n) => (n === 1 ? RATE_LIMITED : OK),
    });
    const row = seen.logs[0] ?? {};

    expect(seen.logs).toHaveLength(1);
    expect(row['status']).toBe('error');
    expect(row['hook_alias']).toBe('OA-ONE');
    expect(row['error_message']).toBe(
      `stopped: rate-limited — ${QUOTA_REASON}`,
    );
    expect(Object.prototype.hasOwnProperty.call(row, 'http_status')).toBe(
      false,
    );
    /* the run's own numbers stand in for LINE's body, which is gone */
    expect(row['response_summary']).toMatchObject({
      outcome: 'ran',
      run_status: 'stopped',
      sent: 0,
      failed: 1,
    });
  });

  it('⭐⭐ 🔴 a stopped run is handed BACK as `scheduled`, so the next round can carry on', async () => {
    const { seen } = await send(quotaJob, {
      answer: (n) => (n === 1 ? RATE_LIMITED : OK),
    });
    const last = seen.claims[seen.claims.length - 1] ?? {};

    /* `releaseStatusFor('stopped')` → `scheduled` (release-status.ts:57).
       ⚠️ That is a DIFFERENT answer from `NewSendOutcome.status`, which is
          `failed`. Do not derive one from the other. */
    expect(((last['update'] as Rec)['$set'] as Rec)['status']).toBe(
      'scheduled',
    );
  });

  it('⭐⭐ 🔴 one OA rate-limited does NOT end the run — the next OA still sends', async () => {
    const { out, seen } = await send(
      job({ card_type: 'personal', hook_ids: ['h1', 'h2'] }),
      { answer: (n) => (n === 1 ? RATE_LIMITED : OK) },
    );

    /* `rate-limited` is not in `RUN_WIDE_STOPS` (run-executor.ts:136-140):
       h1 stops after its first chunk, h2 sends both of its people. */
    expect(seen.dispatched).toHaveLength(3);
    expect(statuses(out)).toEqual(['error', 'success']);
    expect(out.status).toBe('failed');
    /* and only h2's rooms hold a copy */
    const rooms = seen.chatRows.map((r) => String(r['room_id']));
    expect(rooms.some((r) => r.startsWith('room-h2-'))).toBe(true);
    expect(rooms.some((r) => r.startsWith('room-h1-'))).toBe(false);
  });

  it('⭐ 🔴 a 429 on the LAST chunk leaves NO stop reason — the guard is never asked again', async () => {
    /* The guard runs BEFORE a chunk (oa-executor.ts:403), so when the 429 lands
       on the final one the loop exits at `ready.shift() === undefined` with no
       reason at all. The row reads `partial`, not `stopped`. Documented here
       because a matrix that expects `rate-limited` from every 429 is wrong. */
    const { out, seen } = await send(job({ card_type: 'personal' }), {
      answer: (n) => (n === 5 ? RATE_LIMITED : OK),
    });
    const row = historyRows(seen)[0] ?? {};

    expect(seen.dispatched).toHaveLength(5);
    expect(row['status']).toBe('partial');
    expect(Object.prototype.hasOwnProperty.call(row, 'stop_reason')).toBe(
      false,
    );
    expect(row['error_message']).toBe(`send failed — ${QUOTA_REASON}`);
    /* `partial` flattens to ERROR in the legacy shape, deliberately */
    expect(statuses(out)).toEqual(['error']);
    expect(out.status).toBe('failed');
  });

  it('⭐ 🔴 the FIRST failure is the one reported, never the last', async () => {
    const { out, seen } = await send(job({ card_type: 'personal' }), {
      answer: (n) =>
        n === 1
          ? failWith({ status: 400, reason: 'HTTP 400 - first refusal' })
          : n === 2
            ? failWith({ status: 500, reason: 'HTTP 500 - second refusal' })
            : OK,
    });

    /* `firstFailure ??= …` (oa-executor.ts:216-222) — a later chunk cannot
       overwrite it, and the executor NEVER retries a chunk (the sink passes no
       `retry` option at all, inline.sink.ts:157-168). */
    expect(seen.dispatched).toHaveLength(5);
    expect(errorOf(out)).toBe('run status: partial — HTTP 400 - first refusal');
    expect(errorOf(out)).not.toContain('second refusal');
    expect(historyRows(seen)[0]?.['error_message']).toBe(
      'send failed — HTTP 400 - first refusal',
    );
  });

  it('🔴 a 409 counts as DELIVERED — an earlier attempt with this key won', async () => {
    const { out, seen } = await send(job({ card_type: 'personal' }), {
      answer: (n) => (n === 1 ? failWith({ status: 409 }) : OK),
    });

    /* `accepted(r) = r.ok || r.status === 409` (send-loop.helpers.ts:241-243).
       ⚠️ but the transcript hangs off `result.ok`, so that person's room gets
          NO copy — counters and chat rows legitimately disagree here. */
    expect(out.status).toBe('sent');
    expect(historyRows(seen)[0]?.['failed']).toBe(0);
    expect(
      seen.chatRows.filter((r) => r['message_type'] === 'text'),
    ).toHaveLength(4);
  });

  it('🔴 `status: 0` survives — the transport failure that never reached LINE', async () => {
    /* `describeChunkFailure` keeps a NUMERIC zero (chunk-failure.ts:93); the
       falsy trap `status && {status}` would drop it and the row would say only
       "run status: error". With no reason, the sentence names the status. */
    const { out } = await send(job(), {
      answer: () => failWith({ status: 0, attempts: 0 }),
    });
    expect(errorOf(out)).toBe('run status: error — LINE HTTP 0');
  });
});

describe('[SENDPATHMATRIX] §6b refusals, with their exact words', () => {
  it('⭐⭐ cooldown — and a refused-ABUSE run writes NO history row at all', async () => {
    const { out, seen } = await send(job(), { lastFinishedAt: new Date() });

    expect(errorOf(out)).toBe(
      `last run finished 0s ago (minimum ${MIN_SECONDS_BETWEEN_RUNS}s)`,
    );
    expect(seen.dispatched).toEqual([]);
    /* `untouched(...)` returns before the claim, so nothing is claimed,
       released or written (run-broadcast.ts:106-110, :330-343)… */
    expect(seen.claims).toEqual([]);
    expect(historyRows(seen)).toEqual([]);
    /* …but the admin still hears about it */
    expect(seen.logs).toHaveLength(1);
    expect(seen.logs[0]?.['response_summary']).toEqual({
      run_id: expect.any(String),
      outcome: 'refused-abuse',
      why: `last run finished 0s ago (minimum ${MIN_SECONDS_BETWEEN_RUNS}s)`,
    });
  });

  it('⭐ already-running — starting it again would deliver twice', async () => {
    const { out, seen } = await send(job(), { jobIsRunning: 1 });
    expect(errorOf(out)).toBe(
      'this job is sending right now — starting it again would deliver twice',
    );
    expect(seen.dispatched).toEqual([]);
  });

  it('⭐⭐ 🔴 a counter that THROWS refuses the run — it does not read as a quiet hour', async () => {
    /* `safeCount` turns every throw into NaN (mongo-ports.factory.ts:57-65) and
       `checkAbuse` fails closed on NaN. A fake missing `countDocuments` fails
       here too — which is why every count in this harness returns a real
       number and a test author must not "simplify" one away. */
    const { out, seen } = await send(job(), { countsThrow: true });
    expect(errorOf(out)).toBe(
      'a run counter could not be read — refusing rather than sending blind',
    );
    expect(seen.dispatched).toEqual([]);
  });

  it('⭐ system-busy — the last line of defence', async () => {
    const { out } = await send(job(), {
      runsInFlight: MAX_CONCURRENT_RUNS_GLOBAL,
    });
    expect(errorOf(out)).toBe(
      `${MAX_CONCURRENT_RUNS_GLOBAL} runs already in flight (max ${MAX_CONCURRENT_RUNS_GLOBAL})`,
    );
  });

  it('⭐⭐ the hour quota — and a refused-QUOTA run DOES write its history row', async () => {
    const { out, seen } = await send(job(), {
      quotaRows: [{ sent: GLOBAL_QUOTA.hour.recipients, requests_made: 0 }],
    });

    /* usage is summed from the rows' `sent` + `requests_made`
       (mongo-ports.factory.ts:296-309) — a row spelled `requests` instead
       changes the answer silently. */
    expect(errorOf(out)).toBe(
      `this hour has used ${GLOBAL_QUOTA.hour.recipients} recipients and this ` +
        `run wants 5 more — the limit is ${GLOBAL_QUOTA.hour.recipients}`,
    );
    expect(seen.dispatched).toEqual([]);
    expect(historyRows(seen)).toHaveLength(1);
    expect(historyRows(seen)[0]?.['status']).toBe('refused');
  });

  it('⭐⭐ a hook with NO token still dispatches — with an EMPTY string', async () => {
    const { seen } = await send(job({ hook_ids: ['hNoTok'] }));

    /* `MongoHookTokenReader` answers `''` for a missing/undecryptable token and
       CACHES it for the run (hook-token.reader.ts:65-79). The request is still
       made; LINE is the one that says 401. อ่านไม่ได้ = ไม่มี token ไม่ใช่ crash. */
    expect(seen.dispatched).toHaveLength(1);
    expect(seen.dispatched[0]?.['token']).toBe('');
  });

  it('⭐ not-claimed — somebody else already holds the job', async () => {
    const { out, seen } = await send(job(), { claimReturns: null });

    expect(errorOf(out)).toBe('another process is already running this job');
    expect(seen.dispatched).toEqual([]);
    expect(historyRows(seen)).toEqual([]);
    /* the claim was ATTEMPTED (unlike the abuse refusals above) and nothing
       was released, because nothing was taken */
    expect(seen.claims).toHaveLength(1);
  });

  it('⭐ a hook id the key rules refuse stops that OA before its first request', async () => {
    const { out, seen } = await send(
      job({ send_kind: 'broadcast', hook_ids: ['h.1'] }),
    );

    /* `retry-key.ts:30` rejects, never sanitises — two ids on one key is a
       chunk marked delivered without being sent. */
    expect(seen.dispatched).toEqual([]);
    expect(errorOf(out)).toBe('stopped: no-retry-key');
    expect(out.status).toBe('failed');
  });

  it('🔴 an empty hook list is `failed`, never `sent`, and writes no row anywhere', async () => {
    const { out, seen } = await send(job({ hook_ids: [] }));
    expect(out.results).toEqual([]);
    expect(out.status).toBe('failed');
    expect(seen.logs).toEqual([]);
    expect(seen.dispatched).toEqual([]);
  });

  it('🔴 one unreadable hook id refuses ALL of them — a partly-read list is not a shorter list', async () => {
    const { out, seen } = await send(job({ hook_ids: ['h1', 7] }));
    expect(statuses(out)).toEqual(['error', 'error']);
    expect(errorOf(out)).toBe('a hook id on this broadcast cannot be read');
    expect(seen.dispatched).toEqual([]);
  });

  it('🔴 nothing rejects out of send() — even a document whose getter explodes', async () => {
    const exploding: Rec = {
      _id: 'b1',
      hook_ids: ['h1', 'h2'],
      target: { mode: 'all', rules: [] },
      get message(): unknown {
        throw new Error('lean getter blew up');
      },
    };
    const { out, seen } = await send(exploding);

    /* the hooks were known by the time it blew up, so the caller learns WHICH
       OAs were not sent to — an empty `results[]` would say "nothing was asked
       for", a different and wrong story */
    expect(out.results.map((r) => r.hook_id)).toEqual(['h1', 'h2']);
    expect(statuses(out)).toEqual(['error', 'error']);
    expect(out.status).toBe('failed');
    expect(seen.logs).toHaveLength(2);
  });
});
