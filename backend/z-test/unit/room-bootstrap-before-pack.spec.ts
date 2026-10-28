import { createHmac } from 'node:crypto';

import {
  AiProviderUnavailableError,
  AssistSummaryUnavailableError,
  type AiReplyRequest,
  WebhookService,
  type WebhookRequestMeta,
} from '@/modules/webhook';

/**
 * ==== [TEST-20260813-ROOMBOOT-B-RB2] BEFORE pack — eager-room feature ====
 *
 * Characterisation snapshots of the REAL `processWebhook` across the full
 * scenario matrix of `docs/line_webhook_flow_spec.md` §10.3, recorded BEFORE
 * the room-bootstrap feature exists. The AFTER run may differ ONLY per the
 * expected-diff table in ROOM-BOOTSTRAP-PLAN §3B:
 *
 *   · `room.ensure` step appears (chatHistory.getOrCreateRoom called directly)
 *     for scenarios with a real userId — TODAY IT NEVER APPEARS (`roomEnsure`
 *     is [] in every snapshot; that emptiness IS the before-state being pinned)
 *   · dummy/standby and no-userId scenarios must not change AT ALL
 *   · everything else (replies, chat rows, log kinds, step order) byte-equal
 *
 * Harness pattern copied from webhook-flow-matrix.spec.ts (project convention:
 * specs are self-contained). Fakes record; nothing is billed; LINE token dead.
 * เทสนี้คือกล้องวงจรปิดของ flow เดิม — feature มาแล้วภาพต้องต่างแค่จุดที่ประกาศ.
 *
 * revert: delete this file (snapshots die with it). No prod import.
 */

const CHANNEL_SECRET = 'roomboot-channel-secret';
const HOOK_ID = 'a0d000000000000000000013';
const USER_ID = 'Uroomboot0000000000000000000001';
const DUMMY_USER = 'Udeadbeefdeadbeefdeadbeefdeadbeef';

interface Trace {
  steps: string[];
  replies: string[];
  chatRowKinds: string[];
  logKinds: string[];
  roomEnsure: unknown[]; // direct getOrCreateRoom calls — MUST be [] before the feature
  systemLogs: Array<Record<string, unknown>>; // logSystemMessage calls (suppressed-check rows)
  aiRequests: AiReplyRequest[];
}

function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of [
    'populate',
    'lean',
    'sort',
    'limit',
    'skip',
    'select',
    'session',
  ]) {
    q[m] = () => q;
  }
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (res: (v: unknown) => unknown) =>
    Promise.resolve(result).then(res);
  return q;
}

interface Opts {
  hook?: Record<string, unknown>;
  room?: Record<string, unknown> | null;
  profileData?: Record<string, unknown>;
  aiReplyText?: string;
  withImageStorage?: boolean;
  rateLimited?: boolean;
  withPaymentRunner?: boolean;
  logMessageFails?: boolean;
}

function baseHook(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: HOOK_ID,
    alias: 'roomboot',
    status: 1,
    channel_secret: CHANNEL_SECRET,
    access_token: 'roomboot-dead-token', // dead — any real send would 401
    channel_type: 'line',
    slip_check: false,
    auto_unassist_minutes: 30,
    ...over,
  };
}

const LINKED_PROFILE = {
  'Path : api/v1/customer': {
    success: true,
    status: 200,
    data: {
      customer: { customer_name: 'สมชาย ทดสอบ', customer_tel: '0800000000' },
    },
  },
};

/**
 * The ONLY shape the refusal gate accepts as "provably no account":
 * an explicit 404 block (`require-profile.gate.ts:67-101` — success!==true AND
 * status 404). Empty `{}` profileData means "API told us nothing" and lands in
 * the missing-profile guard instead — a different branch (found the hard way:
 * the first version of S04/S05 pinned that wrong branch and TEST TRUST review
 * of the snapshots caught it).
 */
const UNLINKED_404_PROFILE = {
  'Path : api/v1/customer': { success: false, status: 404, data: null },
};

function buildHarness(opts: Opts = {}): {
  trace: Trace;
  post: (events: unknown[]) => Promise<void>;
} {
  const hook = opts.hook ?? baseHook();
  const trace: Trace = {
    steps: [],
    replies: [],
    chatRowKinds: [],
    logKinds: [],
    roomEnsure: [],
    systemLogs: [],
    aiRequests: [],
  };

  const hookModel = { findOne: () => query(hook) };
  const chatRoomModel = {
    findOne: () => {
      trace.steps.push('room.findOne');
      return query(opts.room ?? null);
    },
    findOneAndUpdate: () => {
      trace.steps.push('room.upsert');
      return query({ _id: 'room-1' });
    },
    updateOne: () => {
      trace.steps.push('room.update');
      return query({ acknowledged: true });
    },
  };
  const chatMessageModel = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'msg-x' }),
    updateOne: () => query({ acknowledged: true }),
    countDocuments: () => query(0),
  };
  const memberModel = {
    findOne: () => {
      trace.steps.push('member.read');
      return query(null);
    },
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'mem-1' }),
    updateOne: () => {
      trace.steps.push('member.write');
      return query({ acknowledged: true });
    },
    findOneAndUpdate: () => {
      trace.steps.push('member.write');
      return query({ _id: 'mem-1' });
    },
    findById: () => query(null),
    countDocuments: () => query(0),
  };
  const passthrough = {
    findOne: () => query(null),
    find: () => query([]),
    create: () => Promise.resolve({ _id: 'x' }),
    updateOne: () => query({ acknowledged: true }),
    findById: () => query(null),
    countDocuments: () => query(0),
  };

  const lineApi = {
    sendLineReplyMessage: (_t: string, _r: string, text: string) => {
      trace.steps.push('line.reply');
      trace.replies.push(text);
      return Promise.resolve({ status: 200, data: {} });
    },
    sendLineFlexReply: (
      _t: string,
      _r: string,
      _c: unknown,
      altText: string,
    ) => {
      trace.steps.push('line.flex');
      trace.replies.push(`[flex] ${altText}`);
      return Promise.resolve({ status: 200, data: { sentMessages: [] } });
    },
    sendLineLoadingIndicator: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushMessage: () => Promise.resolve({ status: 200, data: {} }),
    sendLinePushFlexMessage: () => Promise.resolve({ status: 200, data: {} }),
    getLineProfile: () => {
      trace.steps.push('line.profile');
      return Promise.resolve(null);
    },
  };

  const service = new WebhookService(
    hookModel as never,
    chatRoomModel as never,
    chatMessageModel as never,
    memberModel as never, // memberModel (recorded — ledger needs member op order)
    passthrough as never, // assignHistoryModel
    passthrough as never, // ticketModel
    passthrough as never, // objectImageModel
    {
      findById: () =>
        query(
          opts.withImageStorage
            ? {
                _id: 'store1',
                image_url: '/uploads/slip.jpg',
                file_path: '/tmp/slip.png',
              }
            : null,
        ),
    } as never, // imageStorageModel
    { safeDecrypt: (v: string) => v } as never,
    {
      cacheHook: () => Promise.resolve(),
      getHookByAlias: () => Promise.resolve(hook),
      getHookByAliasWithSource: () =>
        Promise.resolve({ hook, source: 'cache' }),
    } as never, // hookCache
    {
      logMessage: (row: Record<string, unknown>) => {
        trace.steps.push('chat.log');
        trace.chatRowKinds.push(
          `${String(row['senderType'])}:${String(row['messageType'] ?? row['reason'] ?? '?')}`,
        );
        if (opts.logMessageFails && row['senderType'] === 'customer') {
          // logMessage is best-effort in prod (never throws) — model that:
          // the row is "lost", the caller receives null.
          trace.steps.push('chat.log.FAILED');
          return Promise.resolve(null);
        }
        return Promise.resolve({ _id: 'msg-1', room_id: 'room-1' });
      },
      logSystemMessage: (input: Record<string, unknown>) => {
        trace.steps.push('chat.systemLog');
        trace.systemLogs.push(input);
        return Promise.resolve({ _id: 'sys-1' });
      },
      resolveRoom: () => Promise.resolve({ _id: 'room-1' }),
      // ⭐ The seam under test. TODAY nothing calls it directly — every
      //    snapshot pins roomEnsure: []. AFTER the feature, scenarios with a
      //    real userId gain exactly one entry + one 'room.ensure' step.
      getOrCreateRoom: (...args: unknown[]) => {
        trace.steps.push('room.ensure');
        trace.roomEnsure.push(args);
        return Promise.resolve({ _id: 'room-1' });
      },
    } as never, // chatHistory
    lineApi as never,
    {
      downloadAndSaveImage: () =>
        Promise.resolve(opts.withImageStorage ? 'store1' : null),
      downloadAndSaveVideo: () => Promise.resolve(null),
    } as never,
    {
      createLog: (row: Record<string, unknown>) => {
        trace.logKinds.push(
          String(row['action_type'] ?? row['channel'] ?? '?'),
        );
        return Promise.resolve();
      },
    } as never,
    {
      getCombinedData: () => {
        trace.steps.push('external.fetch');
        return Promise.resolve(opts.profileData ?? {});
      },
    } as never,
    {
      getToolForHook: () => Promise.resolve(null),
      getCombinedData: () => Promise.resolve(opts.profileData ?? {}),
      extractProfile: () => null,
    } as never,
    {
      consume: () => Promise.resolve({ limited: opts.rateLimited === true }),
    } as never,
    {
      getClient: () => {
        throw new Error('no redis in unit test');
      },
    } as never,
    {
      generate: (req: AiReplyRequest) => {
        trace.steps.push('ai.generate');
        trace.aiRequests.push(req);
        if (opts.aiReplyText !== undefined) {
          return Promise.resolve({
            text: opts.aiReplyText,
            noData: false,
            tagStatus: null,
          });
        }
        return Promise.reject(new AiProviderUnavailableError());
      },
    },
    { summarise: () => Promise.reject(new AssistSummaryUnavailableError()) },
    { getConfigByKey: () => Promise.resolve(null) } as never,
    { telegramWebhookSecret: undefined, multiEventDelivery: false },
    { geminiApiKey: undefined, modelId: 'gemini-3.5-flash' } as never,
    { ignoreDocId: undefined } as never,
    { publish: () => Promise.resolve() } as never,
    {
      mintLinkToken: () => {
        trace.steps.push('mint');
        return { url: 'https://link.test/x', token: 'tok', expiresAt: 0 };
      },
    } as never,
    { findOne: () => query(null), findById: () => query(null) } as never, // flexModel
    {
      translate: (_d: string, k: string | number | null) => `${k ?? ''}`,
    } as never,
    {
      isSlipVerifyEnabled: (h: Record<string, unknown> | null | undefined) =>
        h?.['slip_check'] === true && !!h?.['slip_verify_key'],
      verifySlip: () => {
        trace.steps.push('slip.verify');
        return Promise.resolve({
          slipVerifyResult: null,
          slipRecordId: null,
          slipCreatedAt: null,
          slipCondition: null,
          attempted: false,
        });
      },
      handleSlipCallback: () => {
        trace.steps.push('slip.callback');
        return Promise.resolve();
      },
    } as never, // slipFlow
    {
      checkIfSlipWithQrCode: () => {
        trace.steps.push('qr.check');
        return Promise.resolve(false);
      },
    } as never, // qrVision
    undefined, // configCacheInvalidator (optional)
    (opts.withPaymentRunner
      ? {
          resolvePaymentTool: () => {
            trace.steps.push('pay.resolveTool');
            return Promise.resolve({ _id: 'ptool-1' });
          },
          resumeForRetry: () => {
            trace.steps.push('pay.resume');
            return Promise.resolve({ kind: 'text', text: 'retry-ok' });
          },
        }
      : undefined) as never, // paymentRunner (optional)
    undefined, // docRetrievalProvider (optional)
    undefined, // strike (optional)
    /* [FEAT-20260828-PUSHCORE-G] `LinePushDispatcher`. Candidate G moved the
       register keyword's two replies onto the push core, so they no longer reach
       the `lineApi` double above. Without this the send throws "not bound", the
       handler never reaches its log line, and the S13 snapshot loses both the bot
       chat row and `custreg_send_link` — which is a harness gap, not a behaviour
       change, so the SNAPSHOT WAS LEFT ALONE and the double was added instead.
       It records into the same `trace` arrays, keeping every step name identical:
       a text reply is still 'line.reply', a card is still 'line.flex'.
       ⚠️ `ok` is what the caller branches on — the core returns `{ok:false,...}`
       rather than rejecting, so a double answering only `status` would let a
       refused send read as delivered. */
    {
      dispatch: (req: {
        kind: string;
        messages?: Array<Record<string, unknown>>;
      }) => {
        const m = req.messages?.[0];
        if (m?.['type'] === 'flex') {
          trace.steps.push('line.flex');
          trace.replies.push(
            `[flex] ${typeof m['altText'] === 'string' ? m['altText'] : ''}`,
          );
          return Promise.resolve({
            ok: true,
            status: 200,
            attempts: 1,
            durationMs: 0,
            data: { sentMessages: [] },
          });
        }
        trace.steps.push('line.reply');
        trace.replies.push(typeof m?.['text'] === 'string' ? m['text'] : '');
        return Promise.resolve({
          ok: true,
          status: 200,
          attempts: 1,
          durationMs: 0,
          data: {},
        });
      },
    } as never,
  );

  const post = async (events: unknown[]): Promise<void> => {
    const body = { destination: 'Uroomboot', events };
    const raw = Buffer.from(JSON.stringify(body));
    const meta: WebhookRequestMeta = {
      method: 'POST',
      originalUrl: '/roomboot/webhook',
      rawBody: raw,
      signature: createHmac('SHA256', CHANNEL_SECRET)
        .update(raw)
        .digest('base64'),
      baseUrl: 'http://localhost:4801',
      ip: '127.0.0.1',
      userAgent: 'jest',
    };
    await service.processWebhook(body, hook, 'cache', 'roomboot', meta);
  };

  return { trace, post };
}

function ev(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    eventId: 'ev-1',
    replyToken: 'rt-1',
    timestamp: Date.now(),
    source: { type: 'user', userId: USER_ID },
    message: { type: 'text', id: 'm1', text: 'ยอดเท่าไหร่' },
    ...over,
  };
}

/** Snapshot shape shared by every scenario — the BEFORE truth. */
function snap(trace: Trace): Record<string, unknown> {
  return {
    steps: trace.steps,
    replies: trace.replies,
    chatRowKinds: trace.chatRowKinds,
    logKinds: trace.logKinds,
    roomEnsure: trace.roomEnsure, // pinned [] everywhere before the feature
  };
}

describe('[TEST-20260813-ROOMBOOT-B-RB2] BEFORE pack — full-flow characterisation', () => {
  it('S01 new-user text — room null, AI answers (WH-E1)', async () => {
    const h = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ตอบแล้วค่ะ',
    });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
    // ⭐ AFTER-state (feature landed 13/08): exactly ONE eager ensure, with the
    //    full key — hookId present (never null = never an orphan room) and the
    //    explicit channelType. Was `toEqual([])` in the BEFORE pack (see tag
    //    ckpt-roomboot-brb2-13082026 for the pre-feature truth).
    expect(h.trace.roomEnsure).toEqual([[USER_ID, {}, null, HOOK_ID, 'line']]);
  });

  it('S02 returning-user text — room exists, assist off (WH-E1)', async () => {
    const h = buildHarness({
      room: { _id: 'room-1', assist_status: false },
      profileData: LINKED_PROFILE,
      aiReplyText: 'ตอบลูกค้าเก่า',
    });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S03 image with image_answer_text (WH-E2/G13)', async () => {
    const h = buildHarness({
      hook: baseHook({ image_answer_text: 'รับรูปแล้วค่ะ' }),
      profileData: LINKED_PROFILE,
      withImageStorage: true,
    });
    await h.post([ev({ message: { type: 'image', id: 'img1' } })]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S04 unlinked-slip refusal WITH [[[assist]]] (WH-G8 arm A)', async () => {
    const h = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับสลิปแล้ว',
        slip_check: true,
        slip_verify_key: 'enc:k',
        slip_require_profile: true,
        slip_require_profile_text: 'กรุณาผูกบัญชีก่อนนะคะ [[[assist]]]',
      }),
      profileData: UNLINKED_404_PROFILE, // explicit 404 = the only refusal trigger
      withImageStorage: true,
    });
    await h.post([ev({ message: { type: 'image', id: 'img1' } })]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  /* [FIX-20260819-REFUSEDIMGHISTORY] renamed together with its snapshot. This arm
     used to record NOTHING inbound: the customer's image was written only when the
     refusal copy carried `[[[assist]]]`. Production 19/08 showed the cost — two
     refused slips, and an operator opening the room saw the bot's replies with no
     idea what had been sent. The row is unconditional now; the ticket stays
     marker-gated, which this same snapshot proves (no assist step appears, one
     `line.reply`, `slip_refused_no_profile` unchanged).
     ชื่อเดิมบอกว่า "logs nothing inbound" — เปลี่ยนโดยตั้งใจ ไม่ใช่ snapshot เพี้ยน. */
  it('S05 unlinked-slip refusal WITHOUT marker (WH-G8 arm B — image recorded, no ticket)', async () => {
    const h = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับสลิปแล้ว',
        slip_check: true,
        slip_verify_key: 'enc:k',
        slip_require_profile: true,
        slip_require_profile_text: 'กรุณาผูกบัญชีก่อนนะคะ',
      }),
      profileData: UNLINKED_404_PROFILE,
      withImageStorage: true,
    });
    await h.post([ev({ message: { type: 'image', id: 'img1' } })]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S06 sticker — logged then silent (WH-E3/G9)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([
      ev({
        message: { type: 'sticker', id: 's1', packageId: '1', stickerId: '2' },
      }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S07 pay: postback with runner armed — consumed BEFORE logging, no room today (WH-E5/G6)', async () => {
    const h = buildHarness({ withPaymentRunner: true });
    await h.post([
      ev({
        type: 'postback',
        message: undefined,
        postback: { data: 'pay:resume:run-1:2' },
      }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
    // The core expected-diff case: today there is NO chat.log and NO room work.
    expect(h.trace.steps).not.toContain('chat.log');
  });

  /* ⚠️⚠️ SNAPSHOT UPDATED 31/08/2026 — [FIX-20260831-NOPOSTBACKROW], and this is
     a DECLARED difference, not a drifted one.
     ────────────────────────────────────────────────────────────────────────
     This camera recorded "plain postback ⇒ logged". A postback is a button
     press, not a message, and its payload was reaching the ticket chat as if
     the customer had typed it (`{{paylink.contact_admin}}`, seen live). The
     row is no longer written, so `chatRowKinds` is now empty here.

     What must NOT have moved, and is still in the picture: the event still dies
     at the no-text gate, no reply is sent, no AI request is made, and the
     `pay:` postback in S07 above is untouched (it was already consumed before
     logging). Anything else moving in this file is a bug, not a side effect.
     ภาพเปลี่ยนได้เฉพาะจุดนี้ · จุดอื่นขยับ = พัง. */
  it('S08 plain postback — NOT logged since 31/08, dies at no-text (WH-E4/G15)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([
      ev({
        type: 'postback',
        message: undefined,
        postback: { data: 'menu:open' },
      }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  /**
   * ⚠️ [FEAT-20260905-EVENTREG] THIS SNAPSHOT MOVED TWICE, AND IS NOW BACK WHERE IT STARTED.
   *
   * At SP26 it gained an `event_follow` webhook_log row, because the event-type registry
   * had shipped at SP11 with `event-handlers/follow.handler.ts` ENABLED. On 05/09 the row
   * was removed again and the handler ships switched off.
   *
   * WHY THE ROW WENT AWAY, and it is not that the row was wrong. The handler is written,
   * tested and ready; what was wrong is that it started writing on a live path inside an
   * INFRASTRUCTURE change that nobody had approved as a BEHAVIOUR change. Registering a
   * new event type must be additive until someone asks for it. `handler-entries.ts` now
   * refuses an enabled entry that does not record who decided, so this cannot recur by
   * typing `true`.
   *
   * HOW IT WAS FOUND, because that matters more than the row. This characterisation
   * snapshot was not in SP11's gate set, so it sat red for fourteen save points while
   * every gate run reported green. It surfaced only when a later save point widened the
   * gate set. The rule the ledger now carries: a save point runs the specs that OWN the
   * behaviour it touches, not only the specs that exercise the file it edited.
   * เทสที่ไม่ได้รัน = เทสที่ไม่มี
   */
  it('S09 follow — member sync + logged [follow], no greeting (WH-E6)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([ev({ type: 'follow', message: undefined })]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S10 unfollow — logged [unfollow], no reply possible (WH-E7)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([
      ev({ type: 'unfollow', message: undefined, replyToken: undefined }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S11 assist hold — room assisted, bot bypassed (WH-G10/A2)', async () => {
    const h = buildHarness({
      room: { _id: 'room-1', assist_status: true },
      profileData: LINKED_PROFILE,
    });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S12 rate-limited text — canned reply, still logged (WH-G11)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE, rateLimited: true });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S13 customer-register keyword — link card, handled (WH-G12)', async () => {
    const h = buildHarness({
      hook: baseHook({ customer_link_enabled: true }),
      profileData: LINKED_PROFILE,
    });
    await h.post([
      ev({ message: { type: 'text', id: 'm1', text: 'customer-register' } }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S14 non-text with NOTHING configured — logged, silent return (WH-G13 tail)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([ev({ message: { type: 'image', id: 'img1' } })]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S15 status-off, reply arm (WH-G14)', async () => {
    const h = buildHarness({
      hook: baseHook({ status: 0 }),
      profileData: LINKED_PROFILE,
    });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S16 status-off, silent arm — เงียบแต่เก็บแชท (WH-G14)', async () => {
    const h = buildHarness({
      hook: baseHook({ status: 0, status_off_action: 'silent' }),
      profileData: LINKED_PROFILE,
    });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S17 dummy test event in events[0] — must never gain a room (WH-E10 residual)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([
      ev({
        replyToken: '00000000000000000000000000000000',
        source: { type: 'user', userId: DUMMY_USER },
      }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S18 join — no source.userId, whole user block skipped (WH-G7/E8)', async () => {
    const h = buildHarness({ profileData: LINKED_PROFILE });
    await h.post([
      ev({
        type: 'join',
        message: undefined,
        source: { type: 'group', groupId: 'G1' },
      }),
    ]);
    expect(snap(h.trace)).toMatchSnapshot();
  });

  it('S20 refusal decided while room is ASSISTED — check result must be SAVED to history (suppressed reply)', async () => {
    // [FEAT-20260813-SUPPRESSEDCHECK] owner: การเงียบถูกแล้ว แต่ "คำที่จะตอบ"
    // ต้องเข้า history ให้แอดมินเห็น — red-first: ก่อน feature spec นี้ต้องแดง.
    const h = buildHarness({
      hook: baseHook({
        image_answer_text: 'รับสลิปแล้ว',
        slip_check: true,
        slip_verify_key: 'enc:k',
        slip_require_profile: true,
        slip_require_profile_text: 'กรุณาผูกบัญชีก่อนนะคะ',
      }),
      room: { _id: 'room-1', assist_status: true }, // แอดมินถือห้องอยู่
      profileData: UNLINKED_404_PROFILE,
      withImageStorage: true,
    });
    await h.post([ev({ message: { type: 'image', id: 'img1' } })]);
    // ไม่มี reply ออก (ถูกต้อง — assist ยึด)
    expect(h.trace.replies).toEqual([]);
    // ⭐ แต่ผลตรวจต้องถูกเก็บเป็น system row ให้แอดมินเห็น
    const sys = h.trace.systemLogs.filter((x) =>
      String(x['content'] ?? '').includes('กรุณาผูกบัญชีก่อนนะคะ'),
    );
    expect(sys).toHaveLength(1);
    expect(sys[0]?.['messageType']).toBe('divider');
    expect((sys[0]?.['metadata'] as Record<string, unknown>)?.['variant']).toBe(
      'suppressed_reply',
    );
  });

  it('S19 inbound logMessage fails — today the room is lost with it (WH-T4)', async () => {
    const h = buildHarness({
      profileData: LINKED_PROFILE,
      aiReplyText: 'ตอบได้แม้ log พัง',
      logMessageFails: true,
    });
    await h.post([ev()]);
    expect(snap(h.trace)).toMatchSnapshot();
    expect(h.trace.steps).toContain('chat.log.FAILED');
  });
});
