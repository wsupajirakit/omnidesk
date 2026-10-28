/**
 * [FEAT-20260820-LOCKDUPFIRST] a slip that already paid answers "already used"
 * ===========================================================================
 * Owner, 2026-08-20, after reading a live case: "ถ้า lock เหมือนเคสนี้ แล้วส่งเข้ามาอีก
 * เฉพาะ flow lock นะ ลำดับ จะเอา is duplicate ขึ้นบนสุด ห้ามแก้ไขส่วนอื่นนะ เฉพาะแบบ
 * lock = success เท่านั้น" · "ห้ามเปลี่ยนพฤติกรรมเคสอื่น".
 *
 * THE CASE THAT PROMPTED IT (prod, member 0835550017)
 *   12:31:56  slip 623212823975I000000B9790 → topup credited → slip locked
 *             (`consumed:true`, `lock_reason:'success'`)
 *   12:33:29  SAME slip sent again → the runner steps aside (no chain run at
 *             all) and the card layer answers. It answered **"ชื่อผู้รับไม่ถูกต้อง"**,
 *             because the account-match check sits ABOVE the duplicate check —
 *             so the customer was told their recipient was wrong about a slip
 *             whose money had already arrived. ⇒ เงินเข้าไปแล้ว แต่บอกว่าชื่อผู้รับผิด
 *
 * WHAT THIS SUITE PINS
 *   · with the flag OFF (every existing caller) the order is byte-identical;
 *   · with it ON, duplicate wins over all three violation checks;
 *   · the flag is only ever ON for `skipped === 'duplicate_after_success'`,
 *     which the runner returns from exactly one line and only after finding a
 *     prior slip locked with `lock_reason:'success'`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { handleSlipFlex } from '@/modules/webhook/slip-flex/slip-flex.handler';

import { spineSource } from '../lib/spine-sources';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

/** Swiftcheck's answer for a slip it has seen before, on a hook that checks accounts. */
const verifyResult = (over: Record<string, unknown> = {}) => ({
  success: true,
  data: {
    isDuplicate: true,
    matchedAccount: false, // ⇒ the account check would fire first
    amountInSlip: 200,
    rawSlip: {
      transRef: '623212823975I000000B9790',
      amount: { amount: 200 },
      sender: { displayName: 'นาง ชนัญลดา จ' },
      receiver: { displayName: 'บริษัท วรรณสุข ไ' },
    },
    ...over,
  },
});

/** A hook with BOTH cards bound and account-matching on — the live shape. */
const HOOK = {
  _id: 'h1',
  match_account: true,
  match_account_number: '1050006075',
  flex_duplicate: 'DUP',
  flex_success_not_match: 'NOTMATCH',
  flex_success: 'OK',
  slip_check_out_of_time: null,
  slip_check_min_amount: null,
};

const run = async (over: Record<string, unknown> = {}) => {
  const picked: string[] = [];
  const out = await handleSlipFlex(
    {
      slipVerifyResult: verifyResult(),
      hook: HOOK as never,
      slipCreatedAt: new Date(),
      slipRecordId: 's1',
      userId: 'U1',
      accessToken: 'tok',
      replyToken: 'rt',
      eventId: 'e1',
      incomingType: 'image',
      baseUrl: 'http://x',
      logContext: {},
      ...over,
    } as never,
    {
      findFlexById: (id: string) => {
        picked.push(id);
        return Promise.resolve({
          _id: id,
          content_json: { type: 'bubble' },
        } as never);
      },
      sendLineFlexReply: () => Promise.resolve({ status: 200 } as never),
      logMessage: () => Promise.resolve(undefined as never),
      persistWebhookLog: () => Promise.resolve(undefined as never),
      lineReplyEndpoint: 'https://api.line.me/v2/bot/message/reply',
      log: () => undefined,
      warn: () => undefined,
    } as never,
  );
  return { out, picked };
};

describe('⭐ a locked slip resent — duplicate goes first', () => {
  it('ON: the duplicate card wins over the account-match card', async () => {
    /* the whole point: the money already arrived, so "already used" is the only
       honest thing to say. เงินเข้าไปแล้ว ต้องบอกว่าใช้ไปแล้ว. */
    const { picked } = await run({ duplicateFirst: true });
    expect(picked).toContain('DUP');
    expect(picked).not.toContain('NOTMATCH');
    expect(picked).not.toContain('OK');
  });

  it('OFF: byte-identical to before — the account card still wins', async () => {
    /* every existing caller passes nothing, so this is the path they all take.
       ไม่ส่ง flag = เดินเส้นเดิมทุกบรรทัด. */
    const { picked } = await run();
    expect(picked).toContain('NOTMATCH');
    expect(picked).not.toContain('DUP');
  });

  it('OFF is the default — omitting the field is the same as false', async () => {
    const withFalse = await run({ duplicateFirst: false });
    const omitted = await run();
    expect(withFalse.picked).toEqual(omitted.picked);
  });

  /* ═══════════════════════════════════════════════════════════════════════
   * [FIX-20260902-LOCKDUPOVERWRITE] the competitor this file never tried
   * ═══════════════════════════════════════════════════════════════════════
   * Every case above pits `duplicateFirst` against the ACCOUNT-MATCH card, and
   * that block already gated on `!violationDetected` — so it passed while the
   * feature was broken. The fixture could not reach the other competitor at all:
   * `HOOK.slip_check_out_of_time` is `null` and `rawSlip` carries no `date`, so
   * the out_of_time block never ran, and out_of_time was the ONE check with no
   * gate. It overwrote the duplicate card whenever both applied.
   *
   * What that cost: `[FEAT-20260820-LOCKDUPFIRST]` exists for a slip whose money
   * ALREADY arrived and is being resent. With an old slip the customer was told
   * "slip expired" instead of "already used" — the wrong sentence about money,
   * from the feature written to get that sentence right.
   * ⇒ เทสเดิมเลือกคู่แข่งที่มี guard อยู่แล้ว เลยไม่เคยเห็นตัวที่ไม่มี
   */
  const OLD_SLIP_HOOK = {
    ...HOOK,
    slip_check_out_of_time: 60,
    flex_out_of_time: 'OUTOFTIME',
  };
  /* +2h in Bangkok, the format `parseBangkokSlipDateMs` accepts. */
  const oldDate = new Date(Date.now() - 2 * 3600 * 1000 + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');

  it('🔴 ON: an OLD duplicate still gets the duplicate card, not out_of_time', async () => {
    const { picked } = await run({
      duplicateFirst: true,
      hook: OLD_SLIP_HOOK,
      slipVerifyResult: verifyResult({
        rawSlip: { transRef: 'T1', amount: { amount: 200 }, date: oldDate },
      }),
    });
    expect(picked).toContain('DUP');
    expect(picked).not.toContain('OUTOFTIME');
  });

  it('⭐⭐ OFF: the same old duplicate gets out_of_time — the orders really differ', async () => {
    /* The other half of the pair. Without it, the case above could be satisfied
       by a rule that always answers DUP, and the flag would prove nothing. */
    const { picked } = await run({
      duplicateFirst: false,
      hook: OLD_SLIP_HOOK,
      slipVerifyResult: verifyResult({
        rawSlip: { transRef: 'T1', amount: { amount: 200 }, date: oldDate },
      }),
    });
    expect(picked).toContain('OUTOFTIME');
    expect(picked).not.toContain('DUP');
  });
});

describe('the flag changes nothing when there is nothing to change', () => {
  it('ON but Swiftcheck did not call it a duplicate → order is untouched', async () => {
    /* the flag only PROMOTES the duplicate check; it cannot invent one.
       ธงนี้แค่เลื่อนลำดับ ไม่ได้สร้าง duplicate ขึ้นมาเอง. */
    const { picked } = await run({
      duplicateFirst: true,
      slipVerifyResult: verifyResult({ isDuplicate: false }),
    });
    expect(picked).toContain('NOTMATCH');
    expect(picked).not.toContain('DUP');
  });

  it('ON, duplicate, and the account DOES match → still the duplicate card', async () => {
    const { picked } = await run({
      duplicateFirst: true,
      slipVerifyResult: verifyResult({ matchedAccount: true }),
    });
    expect(picked).toContain('DUP');
    expect(picked).not.toContain('OK');
  });

  it('ON but no duplicate card bound → falls through, never blank', async () => {
    /* an unbound slot must not swallow the answer: the next check in the normal
       order still gets its turn. ไม่ได้ผูกการ์ดไว้ = ต้องไม่เงียบ. */
    const { picked } = await run({
      duplicateFirst: true,
      hook: { ...HOOK, flex_duplicate: null },
    });
    expect(picked).toContain('NOTMATCH');
  });
});

describe('where the flag comes from — one source, one condition', () => {
  const runner = src('src/modules/payment/payment-runner.service.ts');
  /* [PROG-20260905-CENSUSCONV] One of the two sites moved to non-text/assist-bypass.ts.
     The rule is untouched — BOTH sites must read the runner's `.lockedDuplicate`, so a
     customer resending an already-paid slip gets the same card whether or not an admin is
     holding the room — and counting only the service would have quietly dropped to one
     site and stopped enforcing it on the half that moved.

     🔴 AND IT DID DROP, 05/09 — THE LIST WAS NAMED FILES AND THE FILES MOVED AGAIN.
     SP45 took the second site out of `webhook.service.ts` into
     `gates/slip-flex-send.step.ts`, this hand-written list did not follow, and the case
     started asserting `toHaveLength(2)` against ONE site. It failed loudly, which is the
     only reason this is a fixed bug rather than a rule that quietly stopped covering the
     half that moved.

     ⇒ the list is now the ROLE DIRECTORIES a slip call site may live in, not two file
     paths. Narrowed to `gates` + `non-text` rather than the default set on purpose: a
     smaller list is a stronger assertion, and `slip-flex/` is excluded because its
     handler DISCUSSES `duplicateFirst: true`/`false` in prose, which would be counted as
     call sites. รายชื่อไฟล์ตายตัวมันตามการย้ายไม่ทัน ต้องบอกเป็น "โฟลเดอร์ที่มันอยู่ได้" */
  const wh = spineSource(join(__dirname, '../..'), ['gates', 'non-text']);

  it("'duplicate_after_success' is returned from exactly one place", () => {
    expect(runner.split("skipped: 'duplicate_after_success'").length - 1).toBe(
      1,
    );
  });

  it('and only after finding a prior slip locked with lock_reason success', () => {
    const block = runner.slice(
      runner.indexOf('const prior = (await this.slipModel'),
      runner.indexOf("skipped: 'duplicate_after_success'"),
    );
    expect(block).toContain('consumed: true');
    expect(block).toContain("lock_reason: 'success'");
  });

  it("⭐ BOTH slip call sites pass the RUNNER's answer, not a literal", () => {
    /* a customer doing the same thing must not get a different card because an
       admin happens to be holding the room. ล็อกเป็นตัวตัดสิน ไม่ใช่สถานะห้อง.
       ⚠️ Counting the occurrences was not enough — a mutation that hardcoded
       `duplicateFirst: false` on the assist path still counted two and survived.
       What matters is that BOTH read `.lockedDuplicate`. นับจำนวนไม่พอ ต้องดูค่าที่ส่ง. */
    const sites = [...wh.matchAll(/duplicateFirst:\s*([^,\n]+)/g)].map((m) =>
      m[1]!.trim(),
    );
    expect(sites).toHaveLength(2);
    for (const v of sites) expect(v).toMatch(/\.lockedDuplicate$/);
  });

  it('⭐ the flag is set for THAT skip reason and no other', () => {
    /* A mutation widening it to `skipped !== undefined` survived every
       behavioural case here: every other reason the runner steps aside
       (`not_success`, `not_working`, `error`, `no_run`) would then promote the
       duplicate card too — reordering cards for slips that never paid.
       ต้องเทียบกับค่าเดียวเท่านั้น ไม่ใช่ "มี skipped ก็พอ". */
    const line = wh
      .split('\n')
      .find((l) => l.includes('const lockedDuplicate'));
    expect(line).toBeDefined();
    expect(line).toContain("=== 'duplicate_after_success'");
    expect(line).not.toMatch(/!==|\bincludes\b|\bstartsWith\b/);
  });
});
