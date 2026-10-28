/**
 * [FEAT-20260831-ADMINVIAWITHDRAW] the withdraw-side admin button.
 * ===========================================================================
 * `{{paylink.contact_admin_via_withdraw}}` is the ordinary contact-admin
 * button with ONE extra step in front of it: the WITHDRAW notice lane is walked
 * first, the first case that fires ends the request with its own card, and only
 * a clean walk lets the customer through to an admin.
 *
 * 🔴 THE FINDING THAT SHAPED THE DESIGN, and the reason the door reads no words.
 * Measured on the real matcher before a line was written:
 *
 *     "ติดต่อแอดมินปัญหาการถอนเงิน"   deposit ✓   withdraw ✓
 *     "ติดต่อแอดมินปัญหาการถอน"       deposit ·   withdraw ✓
 *
 * `'เงิน'` is in the SHARED block of both word lists, and the deposit cases come
 * FIRST in `NOTICE_CASE_ORDER` — so a phrase-driven version would have answered
 * a withdrawal question with the DEPOSIT card. The door therefore matches the
 * minted text exactly and hands the guard an explicit slice of cases.
 *
 * ⚠️ THE SLICE IS DERIVED, NEVER RE-LISTED. `WITHDRAW_CASE_ORDER` filters
 *    `NOTICE_CASE_ORDER`, so precedence lives in one array and a withdraw case
 *    added later joins automatically. The case below that reorders the source
 *    array is what keeps a copy from creeping back in.
 */
import {
  NOTICE_CASE_ORDER,
  WITHDRAW_CASE_ORDER,
  WITHDRAW_LANE_STAMP_KEYS,
  NOTICE_WITHDRAW_AT_KEY,
  NOTICE_DEPOSIT_AT_KEY,
  decideNoticeAll,
  type NoticeContext,
} from '@/modules/webhook/notice-runtime';
import {
  matchDepositWord,
  matchWithdrawWord,
} from '@/modules/webhook/notice-runtime/notice-word-match';
import {
  CONTACT_ADMIN_MESSAGE,
  CONTACT_ADMIN_WITHDRAW_MESSAGE,
} from '@/modules/payment';
import { PAYLINK_OFFERED, PAYLINK_TAG_FIELD } from '@/common/utils/paylink-tag';
import { buildPayLinkGuidelines } from '@/modules/content/flex-var/paylink-guidelines';
import { mintPayLinks } from '@/modules/webhook/payment-reply';

/** A context both withdraw cases can be steered with. */
const ctx = (over: Partial<NoticeContext> = {}): NoticeContext =>
  ({
    eventKind: 'text',
    withdrawOn: true,
    withdrawWord: true,
    depositOn: true,
    depositWord: true,
    inWindow: false,
    withdrawOff: false,
    depositOff: false,
    assisted: false,
    hookStatusOff: false,
    ...over,
  }) as NoticeContext;

describe('[ADMINVIAWITHDRAW] the tag itself', () => {
  it('⭐⭐⭐ it is a message button, exactly like the one it inherits from', () => {
    expect(PAYLINK_TAG_FIELD['contact_admin_via_withdraw']).toBe('text');
    expect(PAYLINK_TAG_FIELD['contact_admin']).toBe('text');
  });

  it('⭐⭐⭐ it mints its own text — and the ORIGINAL still mints its own', () => {
    const card = (name: string) => ({
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'message',
              label: 'x',
              text: `{{paylink.${name}}}`,
            },
          },
        ],
      },
    });
    /* [FEAT-20260902-ADMINPOSTBACK] this used to read `action.text`. The tag is
       still AUTHORED in `text` on a message button — every stored card says so —
       but it is now minted into a POSTBACK, because a message action posts
       ordinary text and the door could not tell a press from typing. The sentence
       survives as `displayText`, so the customer's phone is unchanged.
       ⇒ ประโยคเดิม แต่ย้ายไปอยู่ displayText และปุ่มกลายเป็น postback */
    const shownOf = (out: unknown): string =>
      (JSON.stringify(out).match(/"displayText":"([^"]*)"/) ?? [])[1] ?? '';
    const dataOf = (out: unknown): string =>
      (JSON.stringify(out).match(/"data":"([^"]*)"/) ?? [])[1] ?? '';

    const withdraw = mintPayLinks(
      card('contact_admin_via_withdraw'),
      {},
    ).contents;
    expect(shownOf(withdraw)).toBe(CONTACT_ADMIN_WITHDRAW_MESSAGE);
    expect(dataOf(withdraw)).toBe('paylink:v1:contact_admin_via_withdraw');

    /* the guard against a refactor breaking what already worked */
    const plain = mintPayLinks(card('contact_admin'), {}).contents;
    expect(shownOf(plain)).toBe(CONTACT_ADMIN_MESSAGE);
    expect(dataOf(plain)).toBe('paylink:v1:contact_admin');

    /* THE TWO MUST NEVER SHARE A PAYLOAD: one payload would send every withdraw
       press down the plain door and skip the withdraw notice screens silently. */
    expect(dataOf(withdraw)).not.toBe(dataOf(plain));
  });

  it('⭐⭐⭐ an UNKNOWN paylink name mints nothing — the button is dropped', () => {
    /* this used to be `return CONTACT_ADMIN_MESSAGE` for every non-retry name.
       Safe only because the field table refused unknowns two lines earlier; now
       it is answered here as well. */
    const card = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: {
              type: 'message',
              label: 'x',
              text: '{{paylink.made_up}}',
            },
          },
        ],
      },
    };
    const out = JSON.stringify(mintPayLinks(card, {}).contents);
    expect(out).not.toContain(CONTACT_ADMIN_MESSAGE);
    expect(out).not.toContain('button');
  });

  it('⭐⭐ the wording avoids the shared word, and that is measurable', () => {
    expect(matchWithdrawWord(CONTACT_ADMIN_WITHDRAW_MESSAGE)).toBe(true);
    /* ⭐ the whole reason for the phrasing: it must NOT read as a deposit
       complaint, or a fallback to the ordinary guard would send the wrong card */
    expect(matchDepositWord(CONTACT_ADMIN_WITHDRAW_MESSAGE)).toBe(false);
    /* and the phrase the owner first proposed does read as both — kept as the
       record of why the constant is spelled the way it is */
    expect(matchDepositWord('ติดต่อแอดมินปัญหาการถอนเงิน')).toBe(true);
  });
});

describe('[ADMINVIAWITHDRAW] the lane', () => {
  it('⭐⭐⭐ it is the withdraw cases, in NOTICE_CASE_ORDER order', () => {
    expect(WITHDRAW_CASE_ORDER.map((c) => c.caseId)).toEqual(['C', 'D']);
    for (const c of WITHDRAW_CASE_ORDER) {
      expect(c.stampKey).toBe(NOTICE_WITHDRAW_AT_KEY);
    }
  });

  it('⭐⭐⭐ NO deposit case can be in it — that is the bug it exists to stop', () => {
    expect(
      WITHDRAW_CASE_ORDER.some((c) => c.stampKey === NOTICE_DEPOSIT_AT_KEY),
    ).toBe(false);
  });

  it('⭐⭐⭐ the ORDER is borrowed, not copied', () => {
    /* the lane must be a VIEW of the one ordered array: every member of it
       appears in NOTICE_CASE_ORDER in the same relative order. A hand-written
       list would pass the id check above and fail this one the day someone
       reorders the source. */
    const positions = WITHDRAW_CASE_ORDER.map((c) =>
      NOTICE_CASE_ORDER.findIndex((x) => x.caseId === c.caseId),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('⭐⭐ the lane is CONFIGURABLE — one array decides what counts', () => {
    /* owner 31/08: E/F (whole-site) are out today, but adding
       NOTICE_PAYMENT_AT_KEY to this list is how they come in. */
    expect(WITHDRAW_LANE_STAMP_KEYS).toEqual([NOTICE_WITHDRAW_AT_KEY]);
  });
});

describe('[ADMINVIAWITHDRAW] what the walk decides', () => {
  it('⭐⭐⭐ off-time trips C and stops there', () => {
    const out = decideNoticeAll(ctx({ inWindow: true }), WITHDRAW_CASE_ORDER);
    expect(out[0]?.caseId).toBe('C');
    expect(out[0]?.cardField).toBe('notice_withdraw_offtime_flex_id');
  });

  it('⭐⭐⭐ a disabled withdraw side trips D', () => {
    const out = decideNoticeAll(
      ctx({ withdrawOff: true }),
      WITHDRAW_CASE_ORDER,
    );
    expect(out[0]?.caseId).toBe('D');
    expect(out[0]?.cardField).toBe('notice_withdraw_flex_id');
  });

  it('⭐⭐⭐ all conditions clear ⇒ NOTHING fires, so the customer reaches an admin', () => {
    const out = decideNoticeAll(ctx(), WITHDRAW_CASE_ORDER);
    expect(out).toEqual([]);
  });

  it('⭐⭐⭐ a deposit outage NEVER answers this door', () => {
    /* the deposit side is broken in every way at once; the lane stays silent */
    const out = decideNoticeAll(
      ctx({ depositOff: true, inWindow: false, withdrawOff: false }),
      WITHDRAW_CASE_ORDER,
    );
    expect(out).toEqual([]);
  });

  it('⭐⭐⭐ the DEFAULT walk is untouched — every existing caller still sees all six', () => {
    /* the seam is an optional argument; omitted, the behaviour is the old one */
    const both = decideNoticeAll(ctx({ inWindow: true }));
    expect(both.map((d) => d.caseId)).toContain('A');
    expect(both.map((d) => d.caseId)).toContain('C');
  });
});

/* ── the guide, which doubles as the SAVE-TIME ALLOWLIST ─────────────────────
   🔴 เจอจริง 31/08 ทันทีที่ tag ขึ้น: `buildPayLinkGuidelines` hard-coded the
   one name it knew, so the new tag was minted correctly by the server and then
   REFUSED ON SAVE by the editor — "ตรวจพบ Tag ที่ไม่มีในระบบ" — and never
   appeared in the variable table at all. Two tables, one of them forgotten.
   These cases fail on that version. */
describe('[ADMINVIAWITHDRAW] the operator can actually use it', () => {
  it('⭐⭐⭐ the guide OFFERS the new tag — searching "via" must find it', () => {
    const tags = buildPayLinkGuidelines('menu').map((r) => r.tag);
    expect(tags).toContain('{{paylink.contact_admin_via_withdraw}}');
    expect(tags).toContain('{{paylink.contact_admin}}');
  });

  it('⭐⭐⭐ every OFFERED tag is one the minter knows — no dead row on screen', () => {
    for (const t of PAYLINK_OFFERED) {
      expect(PAYLINK_TAG_FIELD[t.name]).toBeDefined();
    }
  });

  it('⭐⭐⭐ `retry` is offered to SLIP and never to MENU', () => {
    /* it is minted from a payment run's resume state, which a menu card can
       never supply — offering it there would put a button on screen that is
       always dropped at send time */
    expect(buildPayLinkGuidelines('menu').map((r) => r.tag)).not.toContain(
      '{{paylink.retry}}',
    );
    expect(buildPayLinkGuidelines('slip').map((r) => r.tag)).toContain(
      '{{paylink.retry}}',
    );
  });

  it('⭐⭐ each admin row names the field it must be pasted into', () => {
    for (const row of buildPayLinkGuidelines('menu')) {
      expect(row.desc).toContain('message');
      expect(row.source).toContain('action.text');
    }
  });
});
