/* [FIX-20260822-NOTICEHARDEN] where the notice screening and the abandon
 * ladder meet — the three journeys the owner asked to see proven.
 * ===========================================================================
 * The two features answer different questions and run in a fixed order on the
 * same message: screening first ("is deposit/withdraw open right now?"), the
 * abandon ladder second ("was this customer handed the registration card and
 * kept talking?"). These cases pin what happens when both could apply.
 *
 * ⛔ Neither feature was edited to make these pass; they read the real rule
 * functions. เทสปรับตามของจริง ของจริงห้ามปรับตามเทส.
 */
import {
  stampAbandonTriggerOnce,
  ABANDON_BOT_LOOKBACK,
  ABANDON_SKIPPED_REPLY_PREFIXES,
  abandonBotRowFilter,
  isSkippedReplyType,
  buildNoticeContext,
  decideNotice,
  wasSentRegistrationCard,
} from '@/modules/webhook';

const IN_WINDOW = new Date('2026-08-22T16:30:00.000Z'); // 23:30 Bangkok
const OUT_WINDOW = new Date('2026-08-22T07:00:00.000Z'); // 14:00 Bangkok
const CARD = 'a0d00000000000000000006f';

/** the OA in the owner's scenario: screening on, both sides configured. */
const HOOK = {
  status: 1,
  notice_deposit_status: true,
  notice_withdraw_status: true,
  notice_deposit_flex_id: CARD,
  notice_deposit_offtime_flex_id: CARD,
  notice_withdraw_flex_id: CARD,
  notice_withdraw_offtime_flex_id: CARD,
};
const SITE_OPEN = {
  data: {
    shop: {
      bank_account: {
        accounts: [
          { account_type: 'deposit', is_view: true },
          { account_type: 'withdraw', status: 'enable' },
        ],
      },
    },
  },
};

const screeningFires = (text: string, now: Date, site: unknown = SITE_OPEN) =>
  decideNotice(
    buildNoticeContext({
      eventKind: 'text',
      hook: HOOK,
      text,
      siteRulesRaw: site,
      now,
    }),
  );

/** a bot history row as the abandon lookback reads it. */
const row = (type: string, cardId?: string) => ({
  metadata: {
    auto_reply_type: type,
    ...(cardId === undefined ? {} : { flex_doc_id: cardId }),
  },
});
const HELPER_ROW = row('flex_customerhelper', CARD);
const SCREENING_ROW = row('flex_notice_a', CARD);
const AI_ROW = row('');

describe('⭐ journey 1 — no screening match: the ladder runs exactly as before', () => {
  it('⭐ an ordinary message after the registration card still reaches abandon', () => {
    /* "ลูกค้าทักมาไม่เข้าเงื่อนไข screening ก็ไป abandon เหมือนเดิม" — the guard
       answers null, so the webhook falls through to runFollowUpFlow(), and the
       rule still sees the card in the window. */
    expect(screeningFires('สวัสดีครับ ขอถามหน่อย', OUT_WINDOW)).toBeNull();
    expect(wasSentRegistrationCard([HELPER_ROW], CARD)).toBe(true);
  });

  it('⭐ the ladder still sees the card behind ordinary bot replies', () => {
    const window = [AI_ROW, AI_ROW, HELPER_ROW].slice(-ABANDON_BOT_LOOKBACK);
    expect(wasSentRegistrationCard(window, CARD)).toBe(true);
  });
});

describe('⭐ journey 2 — screening matches: the card answers, the ladder waits', () => {
  it('⭐ deposit words inside the window produce a screening card', () => {
    const d = screeningFires('เงินไม่เข้าเลย', IN_WINDOW);
    expect(d?.caseId).toBe('A');
  });

  it('⭐ that screening row does NOT count as the registration card', () => {
    /* the abandon rule must never mistake a screening reply for the card it
       hunts for — that would stamp a customer who was never asked. */
    expect(wasSentRegistrationCard([SCREENING_ROW], CARD)).toBe(false);
  });
});

describe('⭐ journey 3 — screening first, then an ordinary message', () => {
  it('⭐ three screening cards must NOT push the registration card out', () => {
    /* the whole point of the skip list: without it this window holds three
       screening rows and the ladder concludes "never asked". */
    const rowsNewestFirst = [
      SCREENING_ROW,
      SCREENING_ROW,
      SCREENING_ROW,
      HELPER_ROW,
    ];
    const re = (
      abandonBotRowFilter() as {
        'metadata.auto_reply_type': { $not: RegExp };
      }
    )['metadata.auto_reply_type'].$not;
    const kept = rowsNewestFirst
      .filter((r) => !re.test(String(r.metadata.auto_reply_type)))
      .slice(0, ABANDON_BOT_LOOKBACK);
    expect(kept).toContain(HELPER_ROW);
    expect(wasSentRegistrationCard(kept, CARD)).toBe(true);
  });

  it('⭐ with the skip list emptied, the same window loses the card', () => {
    /* proves the fix is what saves it — and that switching it off is a real,
       visible change rather than decoration. Both layers read the SAME list,
       so emptying it restores the old behaviour at the query AND at the rule. */
    const rowsNewestFirst = [
      SCREENING_ROW,
      SCREENING_ROW,
      SCREENING_ROW,
      HELPER_ROW,
    ];
    expect(abandonBotRowFilter([])).toEqual({});
    expect(isSkippedReplyType('flex_notice_a', [])).toBe(false);
    const kept = rowsNewestFirst.slice(0, ABANDON_BOT_LOOKBACK);
    expect(kept).not.toContain(HELPER_ROW);
    /* with nothing skipped, a screening row that happens to carry the bound
       card id reads as "the customer was asked" — the very hole the list
       closes. */
    expect(ABANDON_SKIPPED_REPLY_PREFIXES.length).toBeGreaterThan(0);
  });
});

/* ── [FIX-20260822-NOTICEHARDEN] "one list, BOTH layers" — proven, not claimed
 * ===========================================================================
 * The skip list advertises three ways to change it, the last being
 * `deps.skippedReplyPrefixes`. An independent audit found that only the QUERY
 * honoured it: the rule layer called `isSkippedReplyType(type)` with no
 * override, so a caller that injected its own list got a query filtered by ITS
 * list and rows judged by the MODULE's — the two layers could disagree, which
 * is exactly what the doc says cannot happen. Both layers now take the list;
 * these cases are what keep them together. ต้องเปลี่ยนพร้อมกันทั้งสองชั้น. */
describe('⭐ the injected skip list reaches both layers', () => {
  /* a screening row that ALSO carries the OA's bound card id — the shape that
     makes the rule's "carries the bound card" clause fire if it is not
     skipped. This is the row an operator creates by pointing a notice card at
     the same flex document as the registration card. */
  const SCREENING_ROW = {
    metadata: { auto_reply_type: 'flex_notice_a', flex_doc_id: CARD },
  };

  const harness = (rows: unknown[]) => {
    const find = jest.fn().mockReturnValue({
      sort: () => ({
        limit: () => ({
          select: () => ({
            lean: () => ({ exec: () => Promise.resolve(rows) }),
          }),
        }),
      }),
    });
    const updateOne = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });
    return { find, updateOne };
  };
  /* ⚠️ the filter's key is the LITERAL string 'metadata.auto_reply_type'; a
     `toHaveProperty` on it reads the dot as a path step and answers about a
     nested object that does not exist. Compare the key list instead. */
  const queryKeys = (find: jest.Mock): string[] =>
    Object.keys(find.mock.calls[0][0] as Record<string, unknown>);
  const input = {
    hasProfile: false,
    room: { _id: 'r1' },
    member: {},
    channelUserId: 'Uabc',
    helperCardId: CARD,
  };

  it('⭐ default list: the screening row is skipped in the QUERY and in the RULE', async () => {
    const { find, updateOne } = harness([SCREENING_ROW]);
    const res = await stampAbandonTriggerOnce(input, {
      chatMessageModel: { find } as never,
      memberModel: { updateOne } as never,
      warn: jest.fn(),
    });
    // query layer: the extra condition is there
    expect(queryKeys(find)).toContain('metadata.auto_reply_type');
    // rule layer: the row did not count as the registration card
    expect(res).toEqual({ matched: false, stamped: false });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('⭐ injected empty list: BOTH layers stand down together', async () => {
    const { find, updateOne } = harness([SCREENING_ROW]);
    const res = await stampAbandonTriggerOnce(input, {
      chatMessageModel: { find } as never,
      memberModel: { updateOne } as never,
      warn: jest.fn(),
      skippedReplyPrefixes: [],
    });
    /* query layer: back to the exact pre-fix two-key query… */
    expect(queryKeys(find)).not.toContain('metadata.auto_reply_type');
    expect(queryKeys(find)).toEqual(['room_id', 'sender_type']);
    /* …and the rule layer must agree, or the injection is a half measure: the
       screening row now counts as the card and the customer is stamped. */
    expect(res.matched).toBe(true);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it('⭐ a custom prefix is honoured by the rule layer too', async () => {
    const { find, updateOne } = harness([SCREENING_ROW]);
    const res = await stampAbandonTriggerOnce(input, {
      chatMessageModel: { find } as never,
      memberModel: { updateOne } as never,
      warn: jest.fn(),
      // a list that does NOT cover `flex_notice_` → the row counts again
      skippedReplyPrefixes: ['some_other_'],
    });
    expect(queryKeys(find)).toContain('metadata.auto_reply_type');
    expect(res.matched).toBe(true);
  });
});
