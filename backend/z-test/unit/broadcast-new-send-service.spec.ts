/**
 * [FEAT-20260822-BCASTNEWSEND] The glue, driven end to end with fake models.
 * ===========================================================================
 * `BroadcastNewSendService` is the only file in the feature that touches both
 * Mongo and LINE, so the cases that matter are the ones where something on
 * either side misbehaves and the ANSWER still has to be right:
 *   · the admin's history tab keeps receiving its rows (channel + action_type)
 *   · a log that cannot be written never costs a send that already happened
 *   · a half-delivered campaign is reported as `failed`, not as `sent`
 *   · nothing — nothing — rejects out of `send()`
 *
 * ⚠️ NOT ONE ENDPOINT, KIND OR CEILING IS TYPED BY HAND. They are read from the
 *    modules that own them (`SEND_MATRIX`, `@/infra/line`), so tuning a cell
 *    moves these tests with it instead of turning them red for a wrong reason.
 */
import {
  BroadcastNewSendService,
  SEND_MATRIX,
  type LegacySendResult,
} from '@/modules/content';
/* Loaded AFTER the content barrel on purpose: `chat.module` imports
   `@/modules/content`, and this spec is what proves the service may not. */
import { ChatRoom, Member } from '@/modules/chat';
import { LINE_BROADCAST_URL, type LineSendResult } from '@/infra/line';

/** The cell the service defaults to — asked, never assumed. */
const CELL = SEND_MATRIX['broadcast:plain'];

const OK: LineSendResult = {
  ok: true,
  status: 200,
  attempts: 1,
  durationMs: 1,
};
const REJECTED: LineSendResult = {
  ok: false,
  status: 400,
  attempts: 1,
  durationMs: 1,
  reason: 'HTTP 400 - the OA refused it',
};

interface Seen {
  readonly logs: Record<string, unknown>[];
  readonly dispatched: Record<string, unknown>[];
  readonly claims: Record<string, unknown>[];
  readonly history: unknown[][];
  /** [FIX-20260828-TRANSCRIPTVARS] แถวสำเนาที่ถูกเขียนเข้าห้องแชท */
  readonly chatRows: Record<string, unknown>[];
}

/**
 * The fixture boundary, and the ONLY place a cast lives in this file.
 *
 * A real `Model` carries a hundred methods; the service and `buildRunPorts`
 * touch five of them, and spelling out the rest would be a hundred lines of
 * fiction. Everything the code actually calls is present below, so a method
 * that is missing fails loudly rather than being typed into existence.
 */
const model = (fake: Record<string, unknown>): never => fake as never;

const chain = (rows: unknown[]): Record<string, unknown> => ({
  select: () => chain(rows),
  sort: () => chain(rows),
  limit: () => chain(rows),
  lean: () => chain(rows),
  exec: () => Promise.resolve(rows),
});

const one = (row: unknown): Record<string, unknown> => ({
  select: () => one(row),
  sort: () => one(row),
  lean: () => one(row),
  exec: () => Promise.resolve(row),
});

/* [FEAT-20260823-BCASTOAVARS] `domain_name` / `company_name` / `description`
   are the REAL column names (`HOOK_CONTEXT_COLUMNS`), read from the source
   rather than invented — a fake keyed on a guessed name would make every
   `hook_*` tag render N/A and the OA-variable tests would prove nothing. */
const HOOKS: Record<string, Record<string, unknown>> = {
  h1: {
    _id: 'h1',
    alias: 'OA-ONE',
    group: 'g1',
    access_token: 'tok-1',
    domain_name: 'one.example',
    company_name: 'OA One Co',
    description: 'the first OA',
  },
  h2: {
    _id: 'h2',
    alias: 'OA-TWO',
    group: 'g2',
    access_token: 'tok-2',
    domain_name: 'two.example',
    company_name: 'OA Two Co',
    description: 'the second OA',
  },
};

const JOB = {
  _id: 'b1',
  name: 'august promo',
  hook_ids: ['h1', 'h2'],
  target: { mode: 'all', group_ids: [] },
  message: { type: 'text', text: 'hello' },
};

interface Options {
  /** What LINE answers, per dispatch call (1-based). */
  readonly answer?: (n: number) => LineSendResult;
  /** Replaces the webhook_logs writer — for the "logging is broken" cases. */
  readonly createLog?: (doc: Record<string, unknown>) => Promise<unknown>;
}

function build(opts: Options = {}): {
  service: BroadcastNewSendService;
  seen: Seen;
} {
  const seen: Seen = {
    logs: [],
    dispatched: [],
    claims: [],
    history: [],
    chatRows: [],
  };
  const answer = opts.answer ?? (() => OK);

  const broadcastModel = {
    countDocuments: () => Promise.resolve(0),
    findOneAndUpdate: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => {
      seen.claims.push({ filter, update });
      return { lean: () => ({ exec: () => Promise.resolve({ _id: 'b1' }) }) };
    },
  };

  const hookModel = {
    findById: (id: unknown) => one(HOOKS[String(id)] ?? null),
    /* The OA-variable read: one `$in` for the whole job, before it is claimed. */
    find: () => chain(Object.values(HOOKS)),
  };

  const memberModel = { find: () => chain([{ _id: 'm1' }, { _id: 'm2' }]) };

  /* [FIX-20260828-TRANSCRIPTVARS] แถวที่ถูกเขียนเข้า `chat_messages` จริง */
  const chatMessageModel = {
    insertMany: (rows: Record<string, unknown>[]) => {
      seen.chatRows.push(...rows);
      return Promise.resolve(rows);
    },
  };

  const chatRoomModel = {
    countDocuments: () => Promise.resolve(2),
    find: () => chain([]),
  };

  const historyModel = {
    countDocuments: () => Promise.resolve(0),
    findOne: () => one(null),
    find: () => chain([]),
    insertMany: (rows: unknown[]) => {
      seen.history.push(rows);
      return Promise.resolve([]);
    },
  };

  /* [FEAT-20260827-WLOGONEDOOR] the service takes the webhook_logs DOOR, not the
     raw model. The captured rows below are unchanged — that is the point: the
     door forwards verbatim, so every expectation in this file still holds. */
  const webhookLogDoor = {
    persist: (doc: Record<string, unknown>) => {
      seen.logs.push(doc);
      return opts.createLog ? opts.createLog(doc) : Promise.resolve(doc);
    },
  };

  const crypto = { safeDecrypt: (v: string) => v };
  const dispatcher = {
    dispatch: (req: Record<string, unknown>) => {
      seen.dispatched.push(req);
      return Promise.resolve(answer(seen.dispatched.length));
    },
  };

  const service = new BroadcastNewSendService(
    model(broadcastModel),
    model(hookModel),
    /* [FEAT-20260824-BCASTFLEXID] The card library. Every job in this file
       carries its card inline (`flex_json`, no `flex_id`), so the loader must
       never be reached — `null` is the answer that proves it, and a case that
       starts depending on a fetched body fails here instead of passing
       quietly. ไม่มีเคสไหนควรต้องดึงการ์ด ⇒ ตอบ null ไว้ให้ฟ้อง. */
    model({ findById: () => ({ lean: () => Promise.resolve(null) }) }),
    /* ⚠️ `members` and `chat_rooms` now arrive through the CONNECTION, not DI —
       registering their schemas here would close a module cycle with
       `chat.module.ts`, whose failure mode is an `undefined` schema at boot
       rather than a readable error. The fake answers the same two models by
       name. ขอผ่าน connection ตอนใช้ ไม่ใช่ผูกไว้ตอน boot. */
    model({
      /* [FIX-20260828-TRANSCRIPTVARS] จับแถวที่ถูกเขียนเข้าห้องแชทด้วย
         ⚠️ additive — เดิมชื่ออื่นทุกชื่อตกมาที่ `chatRoomModel` · ตอนนี้แยก
            `ChatMessage` ออกไปที่ double ของตัวเอง เคสเดิมไม่มีใครอ่านมัน
            จึงไม่มีเคสไหนเปลี่ยนพฤติกรรม */
      model: (name: string) =>
        name === 'Member'
          ? memberModel
          : name === 'ChatMessage'
            ? chatMessageModel
            : chatRoomModel,
    }),
    model(historyModel),
    model(webhookLogDoor),
    model(crypto),
    model(dispatcher),
    /* The dictionary. `null` = "no translation for this key", which is what the
       real service answers for anything it does not hold, so `hook_*` (plain
       columns, never translated) come through unchanged. */
    model({ translate: () => null }),
  );
  return { service, seen };
}

const ACTOR = { id: 'u1', name: 'admin one' };
const send = (opts: Options = {}, job: Record<string, unknown> = JOB) => {
  const built = build(opts);
  return built.service
    .send(job, ACTOR)
    .then((out) => ({ out, seen: built.seen }));
};

const idsOf = (results: readonly LegacySendResult[]): unknown[] =>
  results.map((r) => r.hook_id);

describe('the legacy result shape — what `POST /broadcasts/:id/send` answers', () => {
  it('🔴 gives one entry per hook, in order, with the legacy statuses', async () => {
    const { out } = await send();

    expect(idsOf(out.results)).toEqual(JOB.hook_ids);
    expect(out.results.map((r) => r.status)).toEqual(['success', 'success']);
    expect(out.status).toBe('sent');
  });

  it('🔴 a hook LINE refused makes the WHOLE job `failed`, not `sent`', async () => {
    // h1 accepted, h2 refused — the honest middle the legacy shape cannot say.
    const { out } = await send({ answer: (n) => (n === 1 ? OK : REJECTED) });

    expect(out.results.map((r) => r.status)).toEqual(['success', 'error']);
    expect(out.status).toBe('failed');
  });

  it('a broadcast with no hooks is `failed`, exactly as the old sender says', async () => {
    const { out } = await send({}, { ...JOB, hook_ids: [] });

    expect(out.results).toEqual([]);
    expect(out.status).toBe('failed');
  });
});

describe('webhook_logs — the admin history tab goes blank without these', () => {
  it('🔴 writes exactly ONE row per hook', async () => {
    const { seen } = await send();

    expect(seen.logs).toHaveLength(JOB.hook_ids.length);
    expect(seen.logs.map((r) => r['hook_id'])).toEqual(JOB.hook_ids);
  });

  it('🔴 every row carries the channel + action_type the tab filters on', async () => {
    const { seen } = await send();

    for (const row of seen.logs) {
      // Measured filter (Broadcasts.tsx:90-99), quoted by `new-send.port.ts`.
      expect(row['channel']).toBe('line_api');
      expect(row['action_type']).toBe('send_broadcast');
      expect(row['method']).toBe('POST');
    }
  });

  it('the endpoint is the one the CELL posts to, not a remembered string', async () => {
    const { seen } = await send();

    expect(CELL.sendKind).toBe('broadcast');
    for (const row of seen.logs) {
      expect(row['endpoint']).toBe(LINE_BROADCAST_URL);
    }
  });

  it('carries the hook alias, the group and the payload snapshot', async () => {
    const { seen } = await send();
    const first = seen.logs[0] ?? {};

    expect(first['hook_alias']).toBe(HOOKS['h1']?.['alias']);
    expect(first['group_id']).toBe(HOOKS['h1']?.['group']);
    expect(first['status']).toBe('success');
    expect(first['payload_summary']).toEqual({
      broadcast_id: JOB._id,
      /* [FIX-20260826-LOGSENDKIND] **พลิกค่า ไม่ลบเคส** — เพิ่มชนิดที่ยิงจริงเข้า
         snapshot เพราะเจ้าของเปิด log แล้วเจอ endpoint /multicast คู่กับ
         action_type "send_broadcast" (key ตระกูลที่เปลี่ยนไม่ได้ — สิทธิ์+ตัวกรองยึดอยู่)
         JOB fixture ไม่มี send_kind ⇒ cellFor เลือกค่าปริยาย 'broadcast' */
      send_kind: 'broadcast',
      message_type: 'text',
      text: JOB.message.text,
      image_url: undefined,
      flex_json: undefined,
    });
  });

  it('🔴 a refused hook gets an ERROR row with a readable reason', async () => {
    const { seen } = await send({ answer: (n) => (n === 1 ? OK : REJECTED) });
    const second = seen.logs[1] ?? {};

    expect(second['status']).toBe('error');
    expect(typeof second['error_message']).toBe('string');
    expect(String(second['error_message']).length).toBeGreaterThan(0);
  });
});

describe('a broken log writer must never cost a send that already happened', () => {
  it('🔴 a `create` that THROWS still returns the delivered result', async () => {
    const { out, seen } = await send({
      createLog: () => {
        throw new Error('webhook_logs is unavailable');
      },
    });

    expect(out.status).toBe('sent');
    expect(out.results.map((r) => r.status)).toEqual(['success', 'success']);
    // The send itself really happened — one LINE request per OA.
    expect(seen.dispatched).toHaveLength(JOB.hook_ids.length);
    // ⚠️ AND every hook was still ATTEMPTED. A writer guarded once around the
    // loop would abandon hook 2 the moment hook 1 threw, leaving a half-empty
    // history tab that reads as "the other OAs were never sent to".
    expect(seen.logs).toHaveLength(JOB.hook_ids.length);
  });

  it('🔴 a `create` that REJECTS is swallowed the same way', async () => {
    const { out } = await send({
      createLog: () => Promise.reject(new Error('write concern failed')),
    });

    expect(out.status).toBe('sent');
  });
});

describe('the sink is built from the cell, not from a hand-typed shape', () => {
  it('🔴 dispatches the cell`s OWN send kind', async () => {
    const { seen } = await send();

    for (const req of seen.dispatched) {
      expect(req['kind']).toBe(CELL.sendKind);
    }
  });

  it('🔴 sends NO recipient list, because this cell addresses nobody', async () => {
    const { seen } = await send();

    // `recipientsPerRequest: 0` means LINE fans out; a `to` on that pipe is a
    // different request than the one the plan costed.
    expect(CELL.recipientsPerRequest).toBe(0);
    for (const req of seen.dispatched) {
      expect(Object.prototype.hasOwnProperty.call(req, 'to')).toBe(false);
    }
  });

  it('carries a retry key built from the run and the hook', async () => {
    const { seen } = await send();
    const keys = seen.dispatched.map((r) => String(r['retryKey']));

    /* ⚠️ The key USED to be `<runId>:<hookId>:<chunkIndex>` and this asserted
       that shape. A real send proved LINE refuses anything that is not a UUID
       (`HTTP 400 … 'X-Line-Retry-Key' … invalid`), so it is a deterministic
       UUID now. What actually mattered was never the spelling — it is that two
       OAs in one run get DIFFERENT keys, because a shared key marks the second
       chunk delivered without sending it. ที่สำคัญคือ "ต่างกัน" ไม่ใช่ "อ่านออก". */
    const UUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const k of keys) expect(k).toMatch(UUID);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('one request per OA — the broadcast pipe never chunks', async () => {
    const { seen } = await send();
    expect(seen.dispatched).toHaveLength(JOB.hook_ids.length);
  });
});

describe('fail closed — a rule that cannot be built is not a send', () => {
  it('🔴 a group-targeted job SENDS — a group names OAs, not people', async () => {
    /**
     * ⚠️ REVERSED ON 24/08, and the old assertion was right when it was written.
     *
     * It read "refuses a group-targeted job rather than reaching every
     * follower", because `group_ids` was stored and read by nobody: a group
     * selection could only mean a narrowing the sender could not honour, and
     * reaching a WIDER list than asked for is the failure this path exists to
     * prevent. Refusing was correct.
     *
     * 🔴 WHAT CHANGED IS WHAT A GROUP MEANS, checked against the live data and
     *    not assumed: `members` has NO group column at all, while `hooks.group`
     *    maps one group to many OAs. So a group selects **OAs**, never people —
     *    it cannot narrow or widen an audience, which is still decided by
     *    `rules` alone. The OA list is resolved and authorised at SAVE time
     *    (`expandGroupsIntoHookIds`), so by the time a run starts the job holds
     *    explicit, already-checked `hook_ids`.
     *    group คัด OA ไม่ได้คัดคน ⇒ ปฏิเสธไว้ก็ไม่มีประโยชน์ มีแต่ทำให้ตั้งกลุ่มแล้วส่งไม่ได้.
     *
     * The audience is unchanged here: no `rules` on this job means everyone on
     * those OAs, exactly as `mode: 'all'` behaves two describes above.
     */
    const { out, seen } = await send({}, { ...JOB, target: { mode: 'group' } });

    expect(out.status).toBe('sent');
    expect(seen.dispatched).toHaveLength(JOB.hook_ids.length);
  });

  it('🔴 an UNKNOWN target mode still refuses', async () => {
    /* `all` and `group` are the two the normaliser accepts. Anything else is a
       row nobody wrote on purpose, and guessing what it meant is how a campaign
       reaches a list the admin never chose. โหมดที่ไม่รู้จัก = ไม่ส่ง. */
    const { out, seen } = await send(
      {},
      { ...JOB, target: { mode: 'something-nobody-wrote' } },
    );

    expect(out.status).toBe('failed');
    expect(out.results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(seen.dispatched).toEqual([]);
    // Refusals are logged too — a silent refusal is invisible to the admin.
    expect(seen.logs).toHaveLength(JOB.hook_ids.length);
  });

  it('refuses a job with no message', async () => {
    const { out, seen } = await send({}, { ...JOB, message: undefined });

    expect(out.status).toBe('failed');
    expect(seen.dispatched).toEqual([]);
  });

  it('🔴 refuses when even ONE hook id cannot be read', async () => {
    const { out, seen } = await send({}, { ...JOB, hook_ids: ['h1', null] });

    expect(out.status).toBe('failed');
    expect(out.results.map((r) => r.status)).toEqual(['error', 'error']);
    // The good hook is NOT sent to: a partly-read list is not a shorter list.
    expect(seen.dispatched).toEqual([]);
  });
});

describe('an OA the run STOPPED is not a delivered OA', () => {
  /**
   * 🔴 `summarizeRun` answers `stopped`, and `stopped` is not `success`.
   *
   * Reached the honest way: `retry-key.ts` refuses a hook id containing a
   * character it may not put in a key (rejecting, never sanitising — two ids on
   * one key is a chunk marked delivered), so that OA stops before its first
   * request. A flatten written as "anything but `error` is fine" would report
   * this campaign as `sent` having sent nothing at all.
   */
  it('🔴 reports `error` and `failed`, having dispatched nothing', async () => {
    const { out, seen } = await send({}, { ...JOB, hook_ids: ['h.1'] });

    expect(seen.dispatched).toEqual([]);
    expect(out.results.map((r) => r.status)).toEqual(['error']);
    expect(String(out.results[0]?.['error'])).toContain('stopped');
    expect(out.status).toBe('failed');
  });
});

describe('nothing rejects out of send()', () => {
  it('🔴 a document whose property read throws still ANSWERS', async () => {
    const exploding: Record<string, unknown> = {
      _id: 'b1',
      get hook_ids(): unknown {
        throw new Error('lean getter blew up');
      },
    };

    const out = await build().service.send(exploding, ACTOR);
    expect(out.status).toBe('failed');
    expect(out.results).toEqual([]);
  });

  it('🔴 a throw AFTER the hooks were read still answers per hook', async () => {
    // The hooks are known by the time `message` explodes, so the caller must
    // learn which OAs were not sent to — an empty `results[]` would say
    // "nothing was asked for", which is a different and wrong story.
    const exploding: Record<string, unknown> = {
      _id: 'b1',
      hook_ids: JOB.hook_ids,
      target: JOB.target,
      get message(): unknown {
        throw new Error('message getter blew up');
      },
    };

    const built = build();
    const out = await built.service.send(exploding, ACTOR);

    expect(out.results.map((r) => r.hook_id)).toEqual(JOB.hook_ids);
    expect(out.results.map((r) => r.status)).toEqual(['error', 'error']);
    expect(out.status).toBe('failed');
    // and the history tab still hears about both of them
    expect(built.seen.logs).toHaveLength(JOB.hook_ids.length);
  });

  it('a job with no fields at all answers `failed` rather than throwing', async () => {
    const out = await build().service.send({}, ACTOR);
    expect(out.status).toBe('failed');
  });
});

describe('the claim, as `claim.ts` defines it', () => {
  /**
   * ⚠️ PINNED SO THE MIGRATION CANNOT BE TURNED ON BY ACCIDENT.
   *
   * `CLAIMABLE_FROM` is `['scheduled']`, but `sendBroadcastNow` accepts a job in
   * any status — so a `draft` job takes the new path and comes back
   * `not-claimed`. This test does not endorse that; it makes it VISIBLE, and it
   * turns red the day the claim learns another state.
   */
  it('🔴 only ever tries to take a `scheduled` job', async () => {
    const { seen } = await send();
    const filter = (seen.claims[0]?.['filter'] ?? {}) as Record<
      string,
      unknown
    >;

    expect(filter['_id']).toBe(JOB._id);
    expect(filter['status']).toEqual({ $in: ['scheduled'] });
  });

  it('hands the job back with a final status once the run ends', async () => {
    const { seen } = await send();
    const release = seen.claims[seen.claims.length - 1] ?? {};
    const update = (release['update'] ?? {}) as Record<string, unknown>;
    const set = (update['$set'] ?? {}) as Record<string, unknown>;

    expect(seen.claims.length).toBeGreaterThan(1);
    expect(set['status']).toBe('sent');
  });
});

describe('the model names the service injects by string', () => {
  /**
   * The service cannot import `@/modules/chat` — `chat.module` imports
   * `@/modules/content`, so the barrel would close a boot-time cycle. It names
   * the two models by string instead, and this is the guard that a rename turns
   * a test red instead of turning a broadcast silent.
   */
  it('🔴 match the Mongoose model names those classes register under', () => {
    expect(Member.name).toBe('Member');
    expect(ChatRoom.name).toBe('ChatRoom');
  });
});

/**
 * [FIX-20260828-HISTALIAS] ชื่อ OA บนแถวประวัติ — สายที่ประกาศไว้แต่ไม่มีใครต่อ
 * ===========================================================================
 * เจ้าของแจ้ง 28/08: หน้าตารางประวัติรอบส่ง คอลัมน์ ALIAS **ว่างเฉพาะบางงาน**
 *
 * 🔴 ทำไมของเดิมไม่มีเทสจับ: `history-row.spec.ts` พิสูจน์ไว้แล้วว่า
 *    `hookAliases` เข้าไป ⇒ `hook_alias` ออกมา — และมันก็จริงเสมอ
 *    สิ่งที่ไม่มีใครถามคือ **มีใครส่ง `hookAliases` เข้ามาไหม** คำตอบคือไม่เคยเลย
 *    ⇒ ทั้งสองฝั่งถูกทั้งคู่ แต่ไม่มีสายเชื่อม · บั๊กแบบนี้ไม่มีอะไร "พัง" ให้เทสจับ
 *      มีแค่ค่าที่หายเงียบ ๆ ⇒ เทสจึงต้องวัดที่ **แถวที่ถูกเขียนจริง** ปลายทาง
 *      ห้ามวัดว่า "ส่ง argument แล้ว" เพราะนั่นคือการเทสสายไฟ ไม่ใช่เทสไฟ
 *
 * ⚠️ ห้ามลดเป็นเทสระดับ argument — ถ้าวันหน้า `history-row.ts` เปลี่ยนวิธีอ่านชื่อ
 *    เทสแบบนั้นจะยังเขียวทั้งที่คอลัมน์กลับไปว่าง (กับดักเดิมเป๊ะ)
 */
describe('[HISTALIAS] แถวประวัติต้องมีชื่อ OA ของตัวเอง', () => {
  const rowsOf = (seen: Seen): Record<string, unknown>[] =>
    seen.history.flat() as Record<string, unknown>[];

  it('⭐⭐ 🔴 ทุกแถวพกชื่อ OA ของตัวเอง ไม่ใช่ของเพื่อน', async () => {
    const { seen } = await send();
    const rows = rowsOf(seen);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r['hook_id'])).toEqual(['h1', 'h2']);
    /* ชื่อต้องตรงกับ OA ของแถวนั้น — สลับกันเมื่อไหร่ = อ่านประวัติผิดตัว */
    expect(rows.map((r) => r['hook_alias'])).toEqual(['OA-ONE', 'OA-TWO']);
  });

  it('⭐ OA ที่ LINE ปฏิเสธ ก็ยังต้องมีชื่อ — แถว error คือแถวที่คนอยากรู้ที่สุด', async () => {
    const { seen } = await send({ answer: (n) => (n === 1 ? OK : REJECTED) });
    const rows = rowsOf(seen);

    expect(rows.map((r) => r['hook_alias'])).toEqual(['OA-ONE', 'OA-TWO']);
  });
});

/**
 * [FIX-20260828-TRANSCRIPTVARS] backtest — เส้นส่งต้องไม่ถูกกระทบ
 * ===========================================================================
 * การแก้รอบนี้ยก `PlainCardMessageBuilder` ออกมาเป็นตัวแปรก่อนส่งเข้า sink
 * (เดิมสร้าง inline) เพื่อให้ตัวเขียนสำเนาถามได้ว่า "OA นี้ได้ข้อความหน้าตายังไง"
 *
 * 🔴 เคสข้างล่างคือคำตอบของคำสั่ง *"cast อื่นห้ามพัง"* — ถ้าการยกตัวแปรเผลอ
 *    สร้าง instance ใหม่ สลับลำดับ หรือส่งค่าคนละชุดเข้า sink เคสนี้จับได้ทันที
 *
 * ⚠️ กติกาการแปลง payload → สิ่งที่บันทึก ปักไว้ที่
 *    `z-test/unit/broadcast-transcript-content.spec.ts` ซึ่งเทสฟังก์ชันตรง ๆ
 *    การขับทั้ง service เพื่อวัดสองบรรทัดนั้นต้องสร้าง pager double ทั้งใบ
 *    ซึ่งบวมเกินกว่าสิ่งที่พิสูจน์
 */
describe('[TRANSCRIPTVARS] backtest — การส่งไม่ถูกกระทบ', () => {
  it('⭐⭐ 🔴 จำนวนครั้งที่ยิง เนื้อข้อความ และผลลัพธ์ ยังเหมือนเดิมทุกตัว', async () => {
    const { out, seen } = await send();

    expect(seen.dispatched).toHaveLength(2);
    expect(out.results.map((r) => r.status)).toEqual(['success', 'success']);
    expect(out.status).toBe('sent');
    for (const d of seen.dispatched) {
      const first = (d['messages'] as Array<Record<string, unknown>>)?.[0];
      expect(first?.['text']).toBe('hello');
    }
  });

  it('⭐⭐ 🔴 LINE ปฏิเสธ ⇒ ยังรายงานเหมือนเดิม ไม่ได้ถูกกลบด้วยงานสำเนา', async () => {
    const { out } = await send({ answer: (n) => (n === 1 ? OK : REJECTED) });

    expect(out.results.map((r) => r.status)).toEqual(['success', 'error']);
    expect(out.status).toBe('failed');
  });
});
