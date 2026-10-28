/**
 * [FEAT-20260809-PAYTOOL-COPY] Guards the extracted customer-facing copy table.
 *
 * WHY THIS FILE EXISTS: pulling the reply strings out of the runner into
 * `payment/payment-reply-copy.ts` made them easy to edit — which also made them
 * easy to BLANK. A one-character slip (deleting a line, leaving `''` behind while
 * rewording) would ship a customer an empty LINE message on a money path, and
 * nothing else in the suite would notice: the runner happily resolves `''` and
 * falls through to `dynamicText`. เทสนี้กันคนแก้คำแล้วเผลอลบข้อความจนว่าง.
 *
 * WHAT IT PINS (deliberately NOT the wording itself — copy is meant to change):
 *   1. every ReplyState has an entry — a new state cannot ship without copy;
 *   2. no default is empty or whitespace-only;
 *   3. the runner's REPLY_STATE_DEFAULTS really reads from REPLY_TEXT, i.e. the
 *      extraction is wired, not decorative;
 *   4. a `tool.payment.*_reply_text` override still beats the default, and an
 *      empty override still falls back to it (the precedence the move must not
 *      have touched).
 *
 * If you INTENTIONALLY reword a string, this file needs no change. If it fails,
 * a message a customer reads went missing.
 */
import {
  PaymentRunnerService,
  REPLY_TEXT,
  BUTTON_LABELS,
  CONTACT_ADMIN_MESSAGE,
  MINT_FLEX_ALT_TEXT,
  type ReplyState,
} from '@/modules/payment';

/**
 * The full ReplyState set, written out literally. `satisfies` makes this a
 * COMPILE error if a state is added to the union without being listed here, so
 * the "every state" assertions below can never silently check a stale subset.
 */
const ALL_STATES = [
  'topup_success',
  'walletpay_success',
  'matched_pending',
  'no_match_retry',
  'not_linked',
  // [FEAT-20260810-MEMBERNOTMATCH] บัญชีที่โอนมาไม่ใช่ของลูกค้าเอง — หยุดก่อน walletpay
  'member_not_match',
  // [FEAT-20260823-TOPUPDUP] topup ตอบ duplicate — หยุดก่อน walletpay เช่นกัน
  // ข้อความเป็นทางสำรอง ปกติตอบด้วยการ์ด hook.flex_duplicate ของ Swiftcheck
  'topup_duplicate',
  'review',
  'statement_not_found',
] as const satisfies readonly ReplyState[];

/** Reach the runner's private cfg/reply helpers without booting Nest — both are
 *  pure functions of their arguments (no I/O, no injected deps touched). */
function runnerInternals() {
  const svc = Object.create(
    PaymentRunnerService.prototype,
  ) as PaymentRunnerService;
  return {
    readCfg: (payment: Record<string, unknown>) =>
      (svc as unknown as { readCfg: (t: unknown) => unknown }).readCfg({
        _id: 'tool',
        payment,
      }),
    reply: (state: ReplyState, cfg: unknown) =>
      (
        svc as unknown as {
          _reply: (s: ReplyState, c: unknown, d?: string) => { text: string };
        }
      )._reply(state, cfg),
  };
}

describe('[PAYTOOL-COPY] extracted customer-facing reply copy', () => {
  it('has one entry for every ReplyState', () => {
    expect(Object.keys(REPLY_TEXT).sort()).toEqual([...ALL_STATES].sort());
  });

  it.each(ALL_STATES)('REPLY_TEXT.%s is a non-empty string', (state) => {
    const text = REPLY_TEXT[state];
    expect(typeof text).toBe('string');
    // .trim() so a message of only spaces — which renders as a blank bubble to
    // the customer — fails just like a truly empty one.
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it('has non-empty copy for every button and for the flex altText', () => {
    // Keys are a CONTRACT with the runner's ReplyAction; buildAction renders
    // nothing for an action it cannot find a label for.
    expect(Object.keys(BUTTON_LABELS).sort()).toEqual([
      'contact_admin',
      'retry',
    ]);
    for (const label of Object.values(BUTTON_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(0);
    }
    expect(CONTACT_ADMIN_MESSAGE.trim().length).toBeGreaterThan(0);
    // altText is what a customer reads on a locked screen with no card body.
    expect(MINT_FLEX_ALT_TEXT.trim().length).toBeGreaterThan(0);
  });

  /**
   * [EDIT-20260817-ALTTEXT] The exact wording the owner chose on 17/08.
   *
   * Pinned because "non-empty" above cannot tell the difference between his
   * wording and the previous one ('แจ้งผลการเติมเงิน'), which claimed a COMPLETED
   * top-up on a card that only reports what the check found. Restoring the old
   * literal — or paraphrasing this one — would ship silently: no other test reads
   * the value, only the symbol.
   *
   * This is a copy decision, not a mechanism, so it is asserted here (the copy
   * spec) and nowhere else. Changing the wording on purpose = change this line
   * too, deliberately. เปลี่ยนคำต้องมาแก้บรรทัดนี้ด้วย ไม่ให้เปลี่ยนเงียบ.
   */
  it('[ALTTEXT] the flex altText is the neutral wording, not the "top-up done" one', () => {
    expect(MINT_FLEX_ALT_TEXT).toBe('ผลการตรวจสอบจากข้อมูลที่ได้รับ');
    expect(MINT_FLEX_ALT_TEXT).not.toContain('เติมเงิน');
  });

  describe('the runner actually resolves through REPLY_TEXT', () => {
    it.each(ALL_STATES)(
      'no config override ⇒ %s resolves to its REPLY_TEXT default',
      (state) => {
        const { readCfg, reply } = runnerInternals();
        // Empty payment config = the shipped default fires for every state.
        expect(reply(state, readCfg({})).text).toBe(REPLY_TEXT[state]);
      },
    );

    it('a tool.payment.*_reply_text override still beats the default', () => {
      const { readCfg, reply } = runnerInternals();
      // One override per cfgKey. reply_success_text intentionally covers BOTH
      // success states — they share the key by design.
      const cfg = readCfg({
        reply_success_text: 'OVR_success',
        pending_reply_text: 'OVR_pending',
        no_match_reply_text: 'OVR_nomatch',
        not_linked_reply_text: 'OVR_notlinked',
        review_reply_text: 'OVR_review',
        not_found_reply_text: 'OVR_notfound',
      });
      expect(reply('topup_success', cfg).text).toBe('OVR_success');
      expect(reply('walletpay_success', cfg).text).toBe('OVR_success');
      expect(reply('matched_pending', cfg).text).toBe('OVR_pending');
      expect(reply('no_match_retry', cfg).text).toBe('OVR_nomatch');
      expect(reply('not_linked', cfg).text).toBe('OVR_notlinked');
      expect(reply('review', cfg).text).toBe('OVR_review');
      expect(reply('statement_not_found', cfg).text).toBe('OVR_notfound');
    });

    it('an EMPTY override falls back to the default, it does not blank the reply', () => {
      const { readCfg, reply } = runnerInternals();
      // '' is how an operator "clears" the field in the panel. It must mean
      // "use the default", never "send the customer nothing".
      const cfg = readCfg({ review_reply_text: '', reply_success_text: '' });
      expect(reply('review', cfg).text).toBe(REPLY_TEXT.review);
      expect(reply('topup_success', cfg).text).toBe(REPLY_TEXT.topup_success);
    });
  });
});
