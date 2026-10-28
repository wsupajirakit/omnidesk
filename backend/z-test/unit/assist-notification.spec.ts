import {
  ASSIST_BUDGET_MS,
  type AssistDeps,
  type AssistNotificationArgs,
  AssistSummaryUnavailableError,
  resolveNeedDetailLimit,
  runAssistGuarded,
  stripAssistMarker,
  triggerAssistNotification,
} from '@/modules/webhook';
import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  resetActiveProvider,
} from '@/modules/customer-provider';

/**
 * The [[[assist]]] hand-off — legacy webhookController.js:260-821.
 *
 * WHY THIS IS A UNIT TEST AND NOT AN END-TO-END ONE
 * Reaching this code through `POST /webhook` requires a model reply containing
 * `[[[assist]]]`, and the owner's AI budget is spent (5/5) with further calls
 * explicitly forbidden. So the marker is INJECTED here as `rawAnswer` — the same
 * string the pipeline would have received — and the flow is driven directly.
 *
 * WHAT THAT MEANS FOR COVERAGE, STATED PLAINLY: everything below the model is
 * covered. What is NOT covered is that a real model reply actually carries the
 * marker to this function through the live pipeline. The wiring at both call
 * sites is verified by reading it, not by executing it. That gap is deliberate
 * and is the direct consequence of the budget rule.
 *
 * No Mongo, no Telegram, no model. Every collaborator records what it was asked
 * to do — the ONLY outbound transport is `postJson`, which is injected, so a
 * passing run cannot have opened a socket.
 */

const HOOK_ID = 'a0d000000000000000000014';
const USER_ID = 'Uassist0000000000000000000000001';
const ROOM_ID = 'a0d000000000000000000017';
const MSG_ID = 'a0d000000000000000000018';
const MEMBER_ID = 'a0d000000000000000000019';

interface Recorded {
  ticketsCreated: Array<Record<string, unknown>>;
  ticketUpdates: Array<{ filter: unknown; update: unknown }>;
  claims: Array<Record<string, unknown>>;
  posts: Array<{ url: string; body: Record<string, unknown> }>;
  logRows: Array<Record<string, unknown>>;
  summaryCalls: number;
}

/** A Mongoose query stub whose chain resolves to `result`. */
function query(result: unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  for (const m of ['sort', 'limit', 'lean', 'select']) q[m] = () => q;
  q['exec'] = () => Promise.resolve(result);
  q['then'] = (res: (v: unknown) => unknown) =>
    Promise.resolve(result).then(res);
  q['catch'] = () => q;
  return q;
}

interface HarnessOptions {
  /** The room the initial read and the claim see. null = no room at all. */
  room?: Record<string, unknown> | null;
  /**
   * What the atomic claim returns. `undefined` derives it from `room` the way
   * MongoDB would: a room that is not already assisted is claimable.
   */
  claimResult?: Record<string, unknown> | null;
  history?: Array<Record<string, unknown>>;
  /** Resolves the summary instead of rejecting. */
  summary?: { summary: string; category: string };
  aiCategoryEnabled?: boolean;
  /** Makes the Telegram transport fail. */
  telegramFails?: boolean;
  ticketCreateFails?: boolean;
}

function harness(opts: HarnessOptions = {}): {
  deps: AssistDeps;
  rec: Recorded;
} {
  const rec: Recorded = {
    ticketsCreated: [],
    ticketUpdates: [],
    claims: [],
    posts: [],
    logRows: [],
    summaryCalls: 0,
  };

  const room = opts.room === undefined ? { _id: ROOM_ID } : opts.room;

  const deps: AssistDeps = {
    chatRoomModel: {
      findOne: () => query(room),
      findOneAndUpdate: (filter: Record<string, unknown>) => {
        rec.claims.push(filter);
        const derived =
          room && room['assist_status'] !== true ? { ...room } : null;
        return query(
          opts.claimResult === undefined ? derived : opts.claimResult,
        );
      },
    } as never,
    chatMessageModel: { find: () => query(opts.history ?? []) } as never,
    ticketModel: {
      create: (doc: Record<string, unknown>) => {
        if (opts.ticketCreateFails) {
          return Promise.reject(new Error('ticket insert failed'));
        }
        rec.ticketsCreated.push(doc);
        return Promise.resolve({ _id: 'ticket1', ...doc });
      },
      updateOne: (filter: unknown, update: unknown) => {
        rec.ticketUpdates.push({ filter, update });
        return query({ acknowledged: true });
      },
    } as never,
    summaryProvider: {
      summarise: () => {
        rec.summaryCalls += 1;
        return opts.summary
          ? Promise.resolve(opts.summary)
          : Promise.reject(new AssistSummaryUnavailableError());
      },
    },
    isAiCategoryEnabled: () => Promise.resolve(opts.aiCategoryEnabled ?? false),
    persistWebhookLog: (entry) => {
      rec.logRows.push(entry);
      return Promise.resolve();
    },
    postJson: (url: string, body: unknown) => {
      rec.posts.push({ url, body: body as Record<string, unknown> });
      if (opts.telegramFails) {
        return Promise.reject(
          Object.assign(new Error('Telegram HTTP 400'), {
            response: { status: 400, data: { ok: false } },
          }),
        );
      }
      return Promise.resolve({ status: 200, data: { ok: true } });
    },
  };

  return { deps, rec };
}

function args(
  over: Partial<AssistNotificationArgs> = {},
): AssistNotificationArgs {
  return {
    userId: USER_ID,
    userText: 'ขอคุยกับแอดมินหน่อยครับ',
    rawAnswer: 'รอสักครู่นะคะ [[[assist]]]',
    telegramKey: 'test-telegram-key',
    telegramChatId: '-1000000000000',
    customerName: 'สมชาย ทดสอบ',
    customerTel: '0800000000',
    contractCode: 'C-001',
    bangkokTime: 'วันศุกร์ที่ 07 สิงหาคม 69 22:00:00',
    alias: 'assistunit',
    eventId: 'evt-1',
    logContext: { hook_id: HOOK_ID },
    chatMsgId: MSG_ID,
    userMongoId: MEMBER_ID,
    ...over,
  };
}

describe('triggerAssistNotification — the hand-off (legacy:260-780)', () => {
  describe('the marker gate', () => {
    it('does nothing at all without the marker — the normal-reply path', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ rawAnswer: 'ยินดีให้บริการค่ะ' }),
        deps,
      );
      expect(rec.claims).toHaveLength(0);
      expect(rec.ticketsCreated).toHaveLength(0);
      expect(rec.posts).toHaveLength(0);
    });

    it('accepts the two-bracket closing form legacy also accepts', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ rawAnswer: 'x [[[assist]]' }),
        deps,
      );
      expect(rec.ticketsCreated).toHaveLength(1);
    });
  });

  /**
   * The bug this whole port closes. Before it, `assist_status` stayed false and
   * the bot kept answering a customer it had promised to an operator.
   */
  it('claims the room atomically, filtering on assist_status != true', async () => {
    const { deps, rec } = harness();
    await triggerAssistNotification(args(), deps);

    expect(rec.claims).toHaveLength(1);
    const filter = rec.claims[0]!;
    // The $ne guard IN THE FILTER is what makes the claim atomic. Without it
    // this is a read-then-write with a race window.
    expect(filter['assist_status']).toEqual({ $ne: true });
    expect(filter['hook_id']).toBe(HOOK_ID);
    expect(filter['$or']).toEqual([
      { channel_user_id: USER_ID },
      { line_user_id: USER_ID },
    ]);
  });

  it('skips everything when the room is already assisted (legacy:135-138)', async () => {
    const { deps, rec } = harness({
      room: { _id: ROOM_ID, assist_status: true },
    });
    await triggerAssistNotification(args(), deps);

    // A human already owns this conversation: no second ticket, no second card.
    expect(rec.claims).toHaveLength(0);
    expect(rec.ticketsCreated).toHaveLength(0);
    expect(rec.posts).toHaveLength(0);
  });

  /**
   * The 2026-07-27 incident, reproduced: two events for the same room, neither
   * having seen the other's write. Exactly one may win.
   */
  it('two concurrent events produce exactly ONE ticket', async () => {
    // One shared room document, and a claim that succeeds only the first time —
    // which is what `findOneAndUpdate` with the $ne filter guarantees in Mongo.
    const shared = { _id: ROOM_ID, assist_status: false };
    let claimed = false;
    const rec: Recorded = {
      ticketsCreated: [],
      ticketUpdates: [],
      claims: [],
      posts: [],
      logRows: [],
      summaryCalls: 0,
    };
    const deps: AssistDeps = {
      chatRoomModel: {
        // Both events read BEFORE either writes — the stale snapshot that made
        // the original bug possible. The read says "not assisted" to both.
        findOne: () => query({ ...shared, assist_status: claimed }),
        findOneAndUpdate: (filter: Record<string, unknown>) => {
          rec.claims.push(filter);
          if (claimed) return query(null);
          claimed = true;
          return query({ ...shared });
        },
      } as never,
      chatMessageModel: { find: () => query([]) } as never,
      ticketModel: {
        create: (doc: Record<string, unknown>) => {
          rec.ticketsCreated.push(doc);
          return Promise.resolve({ _id: 'ticket1', ...doc });
        },
        updateOne: () => query({ acknowledged: true }),
      } as never,
      summaryProvider: {
        summarise: () => Promise.reject(new AssistSummaryUnavailableError()),
      },
      isAiCategoryEnabled: () => Promise.resolve(false),
      persistWebhookLog: () => Promise.resolve(),
      postJson: (url: string, body: unknown) => {
        rec.posts.push({ url, body: body as Record<string, unknown> });
        return Promise.resolve({ status: 200, data: { ok: true } });
      },
    };

    await Promise.all([
      triggerAssistNotification(args(), deps),
      triggerAssistNotification(args(), deps),
    ]);

    expect(rec.claims).toHaveLength(2); // both tried
    expect(rec.ticketsCreated).toHaveLength(1); // one won
    expect(rec.posts).toHaveLength(1); // one card, not two
  });

  it('still creates the ticket when NO room matches (legacy:209-226)', async () => {
    // The regression legacy's comment records finding: returning here because
    // the claim came back empty drops a ticket that legacy would have created.
    const { deps, rec } = harness({ room: null, claimResult: null });
    await triggerAssistNotification(args(), deps);
    expect(rec.ticketsCreated).toHaveLength(1);
  });

  it('skips the duplicate when the room exists but was already claimed', async () => {
    // Claim lost the race, and a room IS there — someone else owns it now.
    const { deps, rec } = harness({
      room: { _id: ROOM_ID },
      claimResult: null,
    });
    await triggerAssistNotification(args(), deps);
    expect(rec.ticketsCreated).toHaveLength(0);
    expect(rec.posts).toHaveLength(0);
  });

  describe('the staleness guard (legacy:183-194)', () => {
    it('suppresses a job that woke up after the 60s limit', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ eventTimestamp: Date.now() - 61_000 }),
        deps,
      );
      // By now an operator has probably taken the case by hand; claiming it
      // back would steal it from them.
      expect(rec.claims).toHaveLength(0);
      expect(rec.ticketsCreated).toHaveLength(0);
    });

    it('lets a fresh event through', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ eventTimestamp: Date.now() - 1_000 }),
        deps,
      );
      expect(rec.ticketsCreated).toHaveLength(1);
    });
  });

  describe('the ticket', () => {
    it('is created BEFORE the summary, with the fallback need_detail', async () => {
      const order: string[] = [];
      const { deps, rec } = harness({
        summary: { summary: 'ลูกค้าต้องการปลดล็อกเครื่อง', category: 'IT' },
      });
      const wrapped: AssistDeps = {
        ...deps,
        ticketModel: {
          create: (doc: Record<string, unknown>) => {
            order.push('ticket.create');
            rec.ticketsCreated.push(doc);
            return Promise.resolve({ _id: 'ticket1', ...doc });
          },
          updateOne: (f: unknown, u: unknown) => {
            order.push('ticket.update');
            rec.ticketUpdates.push({ filter: f, update: u });
            return query({ acknowledged: true });
          },
        } as never,
        summaryProvider: {
          summarise: () => {
            order.push('summarise');
            return Promise.resolve({
              summary: 'ลูกค้าต้องการปลดล็อกเครื่อง',
              category: 'IT',
            });
          },
        },
      };

      await triggerAssistNotification(args(), wrapped);

      // A slow or failed model must not cost the operator the case.
      expect(order).toEqual(['ticket.create', 'summarise', 'ticket.update']);
      expect(rec.ticketsCreated[0]!['need_detail']).toBe(
        'ลูกค้าต้องการความช่วยเหลือ',
      );
      expect(rec.ticketsCreated[0]!['chat_status']).toBe('bot');
      expect(rec.ticketsCreated[0]!['job_status']).toBe(0);
    });

    it('is patched with the summary, and adopts the AI category only when enabled', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'ลูกค้าต้องการปลดล็อกเครื่อง', category: 'IT' },
        aiCategoryEnabled: true,
      });
      await triggerAssistNotification(args(), deps);
      expect(rec.ticketUpdates[0]!.update).toEqual({
        $set: {
          category: 'IT',
          need_detail: 'ลูกค้าต้องการปลดล็อกเครื่อง',
        },
      });
    });

    it('discards the AI category when categorisation is OFF (the default)', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'ลูกค้าต้องการปลดล็อกเครื่อง', category: 'IT' },
        aiCategoryEnabled: false,
      });
      await triggerAssistNotification(args(), deps);
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      // The summary is still adopted; only the category falls back.
      expect(set['category']).toBe('Other');
      expect(set['need_detail']).toBe('ลูกค้าต้องการปลดล็อกเครื่อง');
    });

    it('locks the category to Payment for a payment flex, AI or not', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'สลิปโอนเงิน', category: 'IT' },
        aiCategoryEnabled: true,
      });
      await triggerAssistNotification(args({ isPaymentFlex: true }), deps);
      expect(rec.ticketsCreated[0]!['category']).toBe('Payment');
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      expect(set['category']).toBe('Payment');
    });
  });

  /* [FEAT-20261015-TICKETCATADOPT] Owner 14/10: the loan site's categories come from the
     customer provider, never from the `acme_category` config row. The summary prompt
     always asks the model for Collection | IT | Other; until now the answer was written to
     the ticket ONLY with that config row on — so a loan site without it got Other/Payment
     only, and the screen's ทวงถาม / อุปกรณ์ never filled.
     TARGET: a provider that declares categories adopts a model answer inside its list.
     PIN (shop-api, declares nothing): exactly the config-row rule above, every case. */
  describe('the AI category — decided by the customer provider when it declares one', () => {
    const provider = (n: string) =>
      CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n)!;
    const categoryOf = (rec: ReturnType<typeof harness>['rec']) =>
      (
        (rec.ticketUpdates[0]!.update as Record<string, never>)[
          '$set'
        ] as unknown as Record<string, unknown>
      )['category'];
    afterEach(() => resetActiveProvider());

    it.each(['IT', 'Collection', 'Other'])(
      '⭐ TARGET — loan_v1, config row OFF: the model’s %s is written',
      async (cat) => {
        bindActiveProvider(provider('loan_v1'));
        const { deps, rec } = harness({
          summary: { summary: 's', category: cat },
          aiCategoryEnabled: false,
        });
        await triggerAssistNotification(args(), deps);
        expect(categoryOf(rec)).toBe(cat);
      },
    );
    it('loan_v1: an answer outside its list is not written (stays Other)', async () => {
      bindActiveProvider(provider('loan_v1'));
      const { deps, rec } = harness({
        summary: { summary: 's', category: 'Loan' },
        aiCategoryEnabled: true,
      });
      await triggerAssistNotification(args(), deps);
      expect(categoryOf(rec)).toBe('Other');
    });
    it('loan_v1: a payment flex still locks Payment', async () => {
      bindActiveProvider(provider('loan_v1'));
      const { deps, rec } = harness({
        summary: { summary: 's', category: 'IT' },
      });
      await triggerAssistNotification(args({ isPaymentFlex: true }), deps);
      expect(categoryOf(rec)).toBe('Payment');
    });
    it('⭐ PIN — shop-api, config row OFF: the model’s IT is discarded (Other), as before', async () => {
      bindActiveProvider(provider('shopapi_v1'));
      const { deps, rec } = harness({
        summary: { summary: 's', category: 'IT' },
        aiCategoryEnabled: false,
      });
      await triggerAssistNotification(args(), deps);
      expect(categoryOf(rec)).toBe('Other');
    });
    it('⭐ PIN — shop-api, config row ON: whatever the model says is written, as before', async () => {
      bindActiveProvider(provider('shopapi_v1'));
      const { deps, rec } = harness({
        summary: { summary: 's', category: 'Whatever' },
        aiCategoryEnabled: true,
      });
      await triggerAssistNotification(args(), deps);
      expect(categoryOf(rec)).toBe('Whatever');
    });
  });

  describe('the Telegram card', () => {
    it('carries the summary and the on/off buttons keyed to the room', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'ลูกค้าต้องการปลดล็อกเครื่อง', category: 'IT' },
      });
      await triggerAssistNotification(args(), deps);

      expect(rec.posts).toHaveLength(1);
      const post = rec.posts[0]!;
      expect(post.url).toBe(
        'https://api.telegram.org/bottest-telegram-key/sendMessage',
      );
      const text = post.body['text'] as string;
      expect(text).toContain('[!!] ต้องการ Support จาก Admin (AI Analysis)');
      expect(text).toContain('ลูกค้าต้องการปลดล็อกเครื่อง');
      expect(text).toContain('สมชาย ทดสอบ');

      const kb = (
        post.body['reply_markup'] as {
          inline_keyboard: Array<Array<{ callback_data: string }>>;
        }
      ).inline_keyboard;
      expect(kb[0]![0]!.callback_data).toBe(`on:assistunit:${ROOM_ID}`);
      expect(kb[1]![0]!.callback_data).toBe(`off:assistunit:${ROOM_ID}`);
    });

    it('renders the unregistered customer exactly as legacy does', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(args({ customerName: 'N/A' }), deps);
      // Verbatim, stray space included.
      expect(rec.posts[0]!.body['text']).toContain(
        '- ผู้ใช้งาน: - (ไม่ได้ลงทะเบียน )',
      );
    });

    /** The owner's explicit ask: the hand-off must survive a hook with no creds. */
    it('with NO key or chat id: no send, no crash, ticket still created', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ telegramKey: null, telegramChatId: null }),
        deps,
      );
      expect(rec.posts).toHaveLength(0);
      // Telegram ANNOUNCES the hand-off; it is not what the hand-off IS.
      expect(rec.claims).toHaveLength(1);
      expect(rec.ticketsCreated).toHaveLength(1);
    });

    it('a Telegram failure is logged and never propagates', async () => {
      const { deps, rec } = harness({ telegramFails: true });
      await expect(
        triggerAssistNotification(args(), deps),
      ).resolves.toBeUndefined();
      expect(rec.ticketsCreated).toHaveLength(1);
      expect(
        rec.logRows.some(
          (r) => r['status'] === 'error' && r['channel'] === 'telegram',
        ),
      ).toBe(true);
    });

    it('sends the photo as a second call when mediaUrl is present', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ mediaUrl: 'https://example.invalid/a.jpg' }),
        deps,
      );
      expect(rec.posts).toHaveLength(2);
      expect(rec.posts[1]!.url).toContain('/sendPhoto');
    });

    describe('telegram_noti_type filtering (legacy:58-66)', () => {
      it.each([
        ['text', 'image', 0],
        ['image', 'text', 0],
        ['text', 'text', 1],
        ['image', 'image', 1],
        ['all', 'image', 1],
      ])(
        'noti=%s incoming=%s → %i card(s)',
        async (noti, incoming, expected) => {
          const { deps, rec } = harness();
          await triggerAssistNotification(
            args({
              telegramNotiType: noti,
              incomingMsgType: incoming,
            }),
            deps,
          );
          expect(rec.posts).toHaveLength(expected);
          // ⚠️ The filter returns BEFORE the claim, so a filtered-out event does
          //    not hand off at all — it is not "hand off quietly".
          expect(rec.ticketsCreated).toHaveLength(expected);
        },
      );
    });
  });

  /**
   * The owner verified this on both backends: the marker is STORED, and stripped
   * only for what is sent. This test pins the half this file owns.
   */
  it('strips the marker from the Telegram text but never mutates rawAnswer', async () => {
    const { deps, rec } = harness();
    const a = args({ rawAnswer: 'ขอส่งให้พี่แอดมินดูแลต่อนะคะ [[[assist]]]' });
    const before = a.rawAnswer;

    await triggerAssistNotification(a, deps);

    expect(rec.posts[0]!.body['text']).not.toContain('[[[assist]]]');
    // The input this function was handed is untouched — the stored chat_messages
    // row is written from the same value upstream and keeps its marker.
    expect(a.rawAnswer).toBe(before);
    expect(a.rawAnswer).toContain('[[[assist]]]');
  });

  describe('the summary source', () => {
    it('falls back to legacy’s Gemini-outage wording when the provider rejects', async () => {
      // This is the SHIPPED state: the provider is bound to the unavailable one.
      const { deps, rec } = harness();
      await triggerAssistNotification(args(), deps);
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      expect(set['need_detail']).toBe('เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา');
      // The operator still gets the case — that is the point.
      expect(rec.ticketsCreated).toHaveLength(1);
      expect(rec.posts).toHaveLength(1);
    });

    it('uses the media wording and calls no model when skipAI is set', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ skipAI: true, userText: 'image' }),
        deps,
      );
      expect(rec.summaryCalls).toBe(0);
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      expect(set['need_detail']).toBe(
        '(Media Message) ลูกค้าส่งไฟล์สื่อ (image) เข้ามาในระบบครับ',
      );
    });

    it('a configured limit of 0 skips the model and uses the customer’s own words', async () => {
      const { deps, rec } = harness();
      await triggerAssistNotification(
        args({ aiNeedDetailLimit: 0, userText: 'เข้าเว็บไม่ได้' }),
        deps,
      );
      expect(rec.summaryCalls).toBe(0);
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      expect(set['need_detail']).toBe('เข้าเว็บไม่ได้');
    });

    it('formats history oldest-first with Thai speaker labels', async () => {
      let seen = '';
      const { deps } = harness({
        history: [
          { _id: '2', sender_type: 'bot', content: 'สวัสดีค่ะ' },
          { _id: '1', sender_type: 'customer', content: 'สวัสดีครับ' },
        ],
      });
      const wrapped: AssistDeps = {
        ...deps,
        summaryProvider: {
          summarise: (req) => {
            seen = req.history;
            return Promise.resolve({ summary: 's', category: 'Other' });
          },
        },
      };
      await triggerAssistNotification(args(), wrapped);
      // Fetched newest-first, reversed for the model.
      expect(seen).toBe('ลูกค้า: สวัสดีครับ\nบอท: สวัสดีค่ะ');
    });

    it('hands the model an answer with the marker already stripped', async () => {
      let seen = '';
      const { deps } = harness();
      const wrapped: AssistDeps = {
        ...deps,
        summaryProvider: {
          summarise: (req) => {
            seen = req.currentAnswer;
            return Promise.resolve({ summary: 's', category: 'Other' });
          },
        },
      };
      await triggerAssistNotification(args(), wrapped);
      expect(seen).not.toContain('[[[assist]]]');
    });
  });

  describe('the flex-error override (legacy:337-369)', () => {
    it('forces Other + the generic summary with no prior customer messages', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'guesswork', category: 'Collection' },
        aiCategoryEnabled: true,
        history: [{ _id: MSG_ID, sender_type: 'customer', content: 'x' }],
      });
      await triggerAssistNotification(
        args({ slipError: { code: 'SLIP_NOT_FOUND' } }),
        deps,
      );
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      // The only customer message in history IS this one, so there is no
      // conversation to summarise and the model's answer was guesswork.
      expect(set['category']).toBe('Other');
      expect(set['need_detail']).toBe('ลูกค้าต้องการความช่วยเหลือ');
    });

    it('keeps the AI verdict when there ARE prior customer messages', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'real analysis', category: 'Collection' },
        aiCategoryEnabled: true,
        history: [
          { _id: MSG_ID, sender_type: 'customer', content: 'x' },
          { _id: 'older', sender_type: 'customer', content: 'earlier' },
        ],
      });
      await triggerAssistNotification(
        args({ slipError: { code: 'SLIP_NOT_FOUND' } }),
        deps,
      );
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      expect(set['category']).toBe('Collection');
      expect(set['need_detail']).toBe('real analysis');
    });

    it('does not apply to a payment flex', async () => {
      const { deps, rec } = harness({
        summary: { summary: 'สลิป', category: 'IT' },
        history: [{ _id: MSG_ID, sender_type: 'customer', content: 'x' }],
      });
      await triggerAssistNotification(
        args({ isPaymentFlex: true, slipError: { code: 'SLIP_NOT_FOUND' } }),
        deps,
      );
      const set = (rec.ticketUpdates[0]!.update as Record<string, never>)[
        '$set'
      ] as unknown as Record<string, unknown>;
      expect(set['category']).toBe('Payment');
      expect(set['need_detail']).toBe('สลิป');
    });
  });

  it('a failed ticket insert does not stop the Telegram notification', async () => {
    const { deps, rec } = harness({ ticketCreateFails: true });
    await expect(
      triggerAssistNotification(args(), deps),
    ).resolves.toBeUndefined();
    expect(rec.posts).toHaveLength(1);
  });
});

describe('resolveNeedDetailLimit — legacy:107-113', () => {
  it('defaults to the hardcoded 10 when never configured', () => {
    // The trap: Number(null) === 0, and 0 is MEANINGFUL here. Reading unset as 0
    // would switch AI summaries off for every OA that never set the field.
    expect(resolveNeedDetailLimit(null)).toBe(10);
    expect(resolveNeedDetailLimit(undefined)).toBe(10);
    expect(resolveNeedDetailLimit('')).toBe(10);
    expect(resolveNeedDetailLimit('   ')).toBe(10);
  });

  it('treats a configured 0 as the deliberate value it is', () => {
    expect(resolveNeedDetailLimit(0)).toBe(0);
    expect(resolveNeedDetailLimit('0')).toBe(0);
  });

  it('falls back to 10 on unusable values', () => {
    expect(resolveNeedDetailLimit(-1)).toBe(10);
    expect(resolveNeedDetailLimit('abc')).toBe(10);
    expect(resolveNeedDetailLimit(NaN)).toBe(10);
  });

  it('clamps to 30 and truncates', () => {
    expect(resolveNeedDetailLimit(9999)).toBe(30);
    expect(resolveNeedDetailLimit(12.9)).toBe(12);
  });
});

describe('stripAssistMarker', () => {
  it('removes every occurrence and both closing forms', () => {
    expect(stripAssistMarker('a [[[assist]]] b [[[assist]] c')).toBe(
      'a  b  c'.replace(/\s+$/, ''),
    );
    expect(stripAssistMarker(null)).toBe('');
  });
});

describe('runAssistGuarded — the timeout wrapper (legacy:532-821)', () => {
  it('resolves without throwing when the hand-off throws', async () => {
    const deps = {
      chatRoomModel: {
        findOne: () => {
          throw new Error('mongo is down');
        },
        findOneAndUpdate: () => {
          throw new Error('mongo is down');
        },
      },
      chatMessageModel: { find: () => query([]) },
      ticketModel: { create: () => Promise.reject(new Error('down')) },
      summaryProvider: {
        summarise: () => Promise.reject(new AssistSummaryUnavailableError()),
      },
      isAiCategoryEnabled: () => Promise.resolve(false),
      persistWebhookLog: () => Promise.resolve(),
      postJson: () => Promise.resolve({ status: 200, data: null }),
    } as unknown as AssistDeps;

    // The customer's reply is sent AFTER this returns. If it rejected, a broken
    // assist would cost the customer their answer — the 2026-07-27 outage.
    await expect(runAssistGuarded(args(), deps)).resolves.toBeUndefined();
  });

  it('releases the reply when the hand-off exceeds the budget', async () => {
    jest.useFakeTimers();
    try {
      const deps = {
        // Never settles — the hung Mongo socket from the incident.
        chatRoomModel: {
          findOne: () => ({
            lean: () => ({ exec: () => new Promise(() => {}) }),
          }),
        },
        chatMessageModel: { find: () => query([]) },
        ticketModel: { create: () => Promise.resolve({ _id: 't' }) },
        summaryProvider: { summarise: () => new Promise(() => {}) },
        isAiCategoryEnabled: () => Promise.resolve(false),
        persistWebhookLog: () => Promise.resolve(),
        postJson: () => Promise.resolve({ status: 200, data: null }),
      } as unknown as AssistDeps;

      const settled = jest.fn();
      const p = runAssistGuarded(args(), deps).then(settled);

      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      jest.advanceTimersByTime(ASSIST_BUDGET_MS + 1);
      await p;

      // The flow continues to the send; the abandoned job keeps running and is
      // stopped from doing damage by the staleness guard, not by this race.
      expect(settled).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns immediately on a reply with no marker', async () => {
    // Proves the 25s race is free on the normal path: the guard returns in
    // microseconds, so wrapping every reply in it costs nothing.
    const { deps, rec } = harness();
    await runAssistGuarded(args({ rawAnswer: 'ขอบคุณค่ะ' }), deps);
    expect(rec.claims).toHaveLength(0);
  });
});
