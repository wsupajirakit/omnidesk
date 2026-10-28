/**
 * [FEAT-20260824-STRIKESESSION] In-memory stand-ins for the two strike models.
 *
 * WHY A HAND-WRITTEN FAKE AND NOT `mongodb-memory-server`: this repo has no such
 * dependency and the precedent for model fakes is `chat-history-fakes.ts` next
 * to this file. The trade is stated openly — a fake proves the SERVICE's logic,
 * never Mongo's. Anything that depends on the database itself (does `$min` skip
 * a stored null, does the partial index really reject a second open row) has to
 * be observed against a real mongod, and `strike-service.spec.ts` says which
 * assertions are in that category.
 *
 * WHAT IS FAITHFULLY MODELLED, because the service's correctness rests on it:
 *   · `$inc` / `$min` / `$max` with the exact MongoDB semantics the service uses
 *     — including `$min` SETTING a missing field, the behaviour the schema's
 *     "no default on first_strike_at" note depends on.
 *   · the partial unique index on `{ line_user_id, status: 'open' }`, which
 *     throws `code: 11000` exactly like the server, so the first-strike race in
 *     `record()` is genuinely exercised rather than assumed.
 */
type Doc = Record<string, unknown>;

let seq = 0;
/** Stable, ordered, unique — enough to stand in for an ObjectId in a fake. */
function oid(): string {
  seq += 1;
  return String(seq).padStart(24, '0');
}

class DuplicateKeyError extends Error {
  public readonly code = 11000;
  constructor() {
    super('E11000 duplicate key error');
  }
}

function getPath(doc: Doc, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Doc | undefined)?.[k], doc as unknown);
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur: Doc = doc;
  for (const key of parts.slice(0, -1)) {
    if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {};
    cur = cur[key] as Doc;
  }
  cur[parts[parts.length - 1] as string] = value;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const actual = getPath(doc, k);
    if (v && typeof v === 'object' && '$gte' in (v as Doc)) {
      const range = v as { $gte?: Date; $lte?: Date };
      const at = actual as Date;
      if (range.$gte && at < range.$gte) return false;
      if (range.$lte && at > range.$lte) return false;
      return true;
    }
    /* [FEAT-20260826-STRIKESUSPEND] real Mongo treats `{field: null}` as
       "missing OR null", and the suspend latch relies on it: the guard
       `{_id, suspended_at: null}` is what makes a concurrent arm a no-op instead
       of a second write. Without this branch the fake said "no match" for a
       document that simply had not grown the field yet, which is the opposite of
       what the server does. โมเดลให้ตรงกับของจริง ไม่ใช่ดัดโค้ดให้เข้ากับ fake */
    /* [FEAT-20260826-STRIKESUSPEND] `{field: {$exists: true}}` — how the tray
       asks for "everyone currently locked out". Widening only: no filter in the
       suite used this operator before, so nothing that failed can start passing. */
    if (v && typeof v === 'object' && '$exists' in (v as Doc)) {
      const want = (v as { $exists?: boolean }).$exists === true;
      return (actual !== undefined && actual !== null) === want;
    }
    if (v === null) return actual === null || actual === undefined;
    return String(actual) === String(v);
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  const inc = update['$inc'] as Record<string, number> | undefined;
  for (const [path, by] of Object.entries(inc ?? {})) {
    setPath(doc, path, ((getPath(doc, path) as number) ?? 0) + by);
  }
  // $min sets a MISSING field and otherwise keeps the smaller value — the exact
  // semantics `first_strike_at` relies on, so a regression there fails here.
  const min = update['$min'] as Record<string, Date> | undefined;
  for (const [path, value] of Object.entries(min ?? {})) {
    const cur = getPath(doc, path) as Date | undefined;
    if (cur === undefined || value < cur) setPath(doc, path, value);
  }
  const max = update['$max'] as Record<string, Date> | undefined;
  for (const [path, value] of Object.entries(max ?? {})) {
    const cur = getPath(doc, path) as Date | undefined;
    if (cur === undefined || value > cur) setPath(doc, path, value);
  }
  const set = update['$set'] as Doc | undefined;
  for (const [path, value] of Object.entries(set ?? {})) {
    setPath(doc, path, value);
  }
}

/** A chainable stand-in for the query builder the service actually uses. */
function query<T>(resolve: () => T) {
  const chain = {
    sort: () => chain,
    select: () => chain,
    limit: (n?: number) => {
      chain.__limit = n;
      return chain;
    },
    lean: () => chain,
    exec: () => Promise.resolve(chain.__apply()),
    then: (fn: (v: T) => unknown) => Promise.resolve(chain.__apply()).then(fn),
    __limit: undefined as number | undefined,
    __apply(): T {
      const value = resolve();
      if (Array.isArray(value) && chain.__limit !== undefined) {
        return value.slice(0, chain.__limit) as unknown as T;
      }
      return value;
    },
  };
  return chain;
}

export interface FakeModel {
  rows: Doc[];
  findOne: (filter: Doc) => ReturnType<typeof query>;
  find: (filter: Doc) => ReturnType<typeof query>;
  findOneAndUpdate: (
    filter: Doc,
    update: Doc,
    options?: { new?: boolean },
  ) => ReturnType<typeof query>;
  create: (doc: Doc) => Promise<Doc>;
  updateOne: (filter: Doc, update: Doc) => Promise<{ modifiedCount: number }>;
  countDocuments: (filter: Doc) => Promise<number>;
  aggregate: (pipeline: Doc[]) => { exec: () => Promise<Doc[]> };
}

/**
 * [FEAT-20260826-STRIKESUSPEND] The pipeline stages this fake can honestly run.
 *
 * WHY THIS GREW, AND HOW FAR IT IS ALLOWED TO. Before 26/08 the only aggregate
 * in the module was `$match` + `$group`, and this served exactly that. The
 * header tray's read (`buildSuspendedPipeline`) needs `$sort`, `$limit` and
 * `$project` as well, and two `$lookup`s.
 *
 * The line is drawn at the JOINS, on purpose. `$match`/`$sort`/`$limit`/
 * `$group`/`$project` are a few lines each with no room to lie — the fake either
 * filters the row or it does not. A `$lookup` is a different animal: `let` +
 * `$expr` + a sub-pipeline is a query engine, and a hand-rolled one would go
 * subtly wrong and then be BELIEVED, which is worse than having no test at all.
 * So the joins are refused loudly here, their SHAPE is proven without a database
 * in `strike-suspend-decision.spec.ts`, and their EXECUTION is proven against a
 * real mongod. Three cheap true things beat one expensive fictional one.
 * fake ต้องเล็กและซื่อ — ท่าไหนโกหกได้ ห้ามใส่ ให้มันโยนดัง ๆ แทน
 *
 * ⚠️ Do NOT teach this `$lookup`. If a new read needs one, prove its shape in a
 * unit test and its result against a server, exactly as the tray does.
 */
function runPipeline(rows: Doc[], pipeline: Doc[]): Doc[] {
  let out = [...rows];
  for (const stage of pipeline) {
    const name = Object.keys(stage)[0] as string;
    switch (name) {
      case '$match':
        out = out.filter((r) => matches(r, stage['$match'] as Doc));
        break;
      case '$sort': {
        // one key, as every real sort in this module uses
        const spec = stage['$sort'] as Record<string, number>;
        const [key, dir] = Object.entries(spec)[0] as [string, number];
        out = [...out].sort((a, b) => {
          const av = getPath(a, key) as number | Date;
          const bv = getPath(b, key) as number | Date;
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (dir < 0 ? -1 : 1);
        });
        break;
      }
      case '$limit':
        out = out.slice(0, stage['$limit'] as number);
        break;
      case '$project': {
        /* Inclusion only, and only plain `1`s. `$arrayElemAt` over a joined
           array is left alone rather than faked — the key is simply absent,
           which is exactly what a real row with no member match returns, and is
           the case the tray already renders as `n/a`. */
        const spec = stage['$project'] as Record<string, unknown>;
        out = out.map((r) => {
          const picked: Doc = {};
          for (const [k, v] of Object.entries(spec)) {
            if (v === 1 && getPath(r, k) !== undefined)
              picked[k] = getPath(r, k);
          }
          return picked;
        });
        break;
      }
      case '$group': {
        const rawGroupId = (stage['$group'] as Doc)['_id'];
        // The service always groups by a `'$field'` string; anything else would
        // be a pipeline this fake was never meant to serve, so say so loudly
        // rather than stringifying an object into a nonsense path.
        if (typeof rawGroupId !== 'string') {
          throw new Error(
            'strike-fakes: aggregate $group._id must be a string',
          );
        }
        const groupBy = rawGroupId.slice(1);
        const counted = new Map<unknown, number>();
        for (const r of out) {
          const key = getPath(r, groupBy);
          counted.set(key, (counted.get(key) ?? 0) + 1);
        }
        out = [...counted].map(([_id, n]) => ({ _id, n }));
        break;
      }
      default:
        // $lookup lands here, deliberately. See the header.
        throw new Error(
          `strike-fakes: aggregate stage ${name} is not modelled`,
        );
    }
  }
  return out;
}

/**
 * @param sortKey  the field `.sort()` is expected to order by, descending —
 *                 the fake cannot read the caller's sort spec, so the suite
 *                 states it. Both real sorts in the service are `seq: -1` and
 *                 `occurred_at: -1`.
 * @param uniqueOpenBy  when set, inserting a second row with the same value of
 *                 this field AND `status: 'open'` throws E11000, mirroring the
 *                 partial unique index.
 */
export function fakeModel(sortKey: string, uniqueOpenBy?: string): FakeModel {
  const rows: Doc[] = [];
  const sorted = () =>
    [...rows].sort((a, b) => {
      const av = getPath(a, sortKey) as number | Date;
      const bv = getPath(b, sortKey) as number | Date;
      return av > bv ? -1 : av < bv ? 1 : 0;
    });

  return {
    rows,
    findOne: (filter: Doc) =>
      query(() => sorted().find((r) => matches(r, filter)) ?? null),
    find: (filter: Doc) =>
      query(() => sorted().filter((r) => matches(r, filter))),
    findOneAndUpdate: (filter: Doc, update: Doc) =>
      query(() => {
        const hit = rows.find((r) => matches(r, filter));
        if (!hit) return null;
        applyUpdate(hit, update);
        return { ...hit };
      }),
    create: (doc: Doc) => {
      if (
        uniqueOpenBy &&
        doc['status'] === 'open' &&
        rows.some(
          (r) =>
            r['status'] === 'open' &&
            String(r[uniqueOpenBy]) === String(doc[uniqueOpenBy]),
        )
      ) {
        return Promise.reject(new DuplicateKeyError());
      }
      const row = { _id: oid(), ...doc };
      rows.push(row);
      return Promise.resolve(row);
    },
    /* [FEAT-20260826-STRIKESUSPEND] the gate counts rows in a window rather than
       fetching them. Widening only — no existing filter reaches this door, so no
       assertion that failed before can start passing because of it. */
    /* [FEAT-20260826-STRIKESUSPEND] the latch arms with a guarded `updateOne`.
       Widening only: nothing in the suite reached this door before. */
    updateOne: (filter: Doc, update: Doc) => {
      const row = rows.find((r) => matches(r, filter));
      if (row) applyUpdate(row, update);
      return Promise.resolve({ modifiedCount: row ? 1 : 0 });
    },
    countDocuments: (filter: Doc) =>
      Promise.resolve(rows.filter((row) => matches(row, filter)).length),
    aggregate: (pipeline: Doc[]) => ({
      exec: () => Promise.resolve(runPipeline(rows, pipeline)),
    }),
  };
}
