/**
 * [FEAT-20260820-MEMBERCONFIG] per-member settings bag — the ways it could rot
 * ===========================================================================
 * Owner: "เราจะไม่ใช้กับ abandon อย่างเดียวทันที เราทำเผื่อไว้ว่าอยากมี config อนาคต
 * จะได้ไม่ต้องเจาะ field เพิ่ม" · "seamless เอาขึ้น stg ไม่พัง".
 *
 * Nothing in the system reads this yet — on purpose. So what these tests protect
 * is not a feature, it is the three ways a bag like this goes wrong:
 *   1. a typo'd key stored happily and read back as absent for ever;
 *   2. one feature's write wiping another feature's key;
 *   3. absent quietly meaning "off" and turning a live feature off on deploy.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MEMBER_CONFIG_KEYS,
  assertMemberConfigKey,
  clearMemberConfig,
  memberConfigPath,
  readMemberConfig,
  writeMemberConfig,
  writeMemberConfigOnce,
} from '@/modules/chat/config';

const src = (rel: string): string =>
  readFileSync(join(process.cwd(), rel), 'utf8');

const makeModel = (modifiedCount = 1) => {
  const updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ modifiedCount }),
  });
  return { deps: { memberModel: { updateOne } as never }, updateOne };
};

describe('the registry — a bag with a guest list is not a junk drawer', () => {
  it('a key nobody declared is refused, loudly', () => {
    expect(() =>
      assertMemberConfigKey('follow_up.line.abandon_triggerr'),
    ).toThrow(/unknown key/);
    expect(() => assertMemberConfigKey('anything')).toThrow();
  });

  it('the declared keys are exactly the ones intended — no accidental growth', () => {
    /* [FEAT-20260820-REQUESTREG] `request_reg_at` added deliberately, with the
       owner's approval, to record WHEN a registration case was opened for a
       customer so they can be counted afterwards.
       ⚠️ The two keys have OPPOSITE lifetimes and that is the point:
         · `abandon_trigger_at` is a flag — cleared the moment they register
         · `request_reg_at`     is a record — cleared by nothing, ever
       This list going red is this test doing its job. Grow it only with a reason
       written here. คีย์งอกต้องมีเหตุผลจดไว้ตรงนี้เสมอ. */
    /* grown 2026-08-22 — [FEAT-20260822-NOTICERUNTIME]: the three rolling
       notice stamps (deposit/withdraw/payment), declared ahead of their R3
       wiring; written with writeMemberConfig (they must move), cleared by
       nobody by design. */
    /* grown 2026-08-25 — [FEAT-20260825-HELPERTRIGGER]:
       `customer_helper_trigger_at` records WHEN the customer-helper (the offer
       to link an account) was LAST put in front of this customer.
       ⚠️ ROLLING RECORD — written with writeMemberConfig so it moves on every
          qualifying event, and cleared by nobody. Owner, 25/08: *"ไม่มีเคลียร์
          เก็บไว้ + ทับเวลาไปทุกครั้งที่เข้าเงื่อนไข"* ⇒ same lifetime as the three
          notice stamps above, NOT the same as `abandon_trigger_at`.
       ⚠️ WHEN it is written is one editable predicate, not an inline condition:
          `webhook/follow-up/customer-helper-trigger.rule.ts`. Changing the
          policy must not require touching the reply path. */
    expect(Object.keys(MEMBER_CONFIG_KEYS).sort()).toEqual([
      'follow_up.line.abandon_trigger_at',
      'follow_up.line.customer_helper_trigger_at',
      'follow_up.line.notice_deposit_at',
      'follow_up.line.notice_payment_at',
      'follow_up.line.notice_withdraw_at',
      'follow_up.line.request_reg_at',
    ]);
  });

  it('the path is built in one place, rooted at config', () => {
    expect(memberConfigPath('follow_up.line.abandon_trigger_at')).toBe(
      'config.follow_up.line.abandon_trigger_at',
    );
  });
});

describe('reading — absent must mean "behave as before"', () => {
  const STAMP = new Date('2026-08-20T10:00:00.000Z');
  const member = {
    line_user_id: 'U1',
    config: { follow_up: { line: { abandon_trigger_at: STAMP } } },
  };

  it('reads a stored stamp back as the same instant', () => {
    const out = readMemberConfig(
      member,
      'follow_up.line.abandon_trigger_at',
      null as never,
    );
    expect(out).toEqual(STAMP);
  });

  it('the CALLER owns the default — the reader never invents one', () => {
    // the same absent member, two callers, two different answers
    const fallback = new Date('2020-01-01T00:00:00.000Z');
    expect(
      readMemberConfig({}, 'follow_up.line.abandon_trigger_at', fallback),
    ).toEqual(fallback);
    expect(
      readMemberConfig({}, 'follow_up.line.abandon_trigger_at', null as never),
    ).toBeNull();
  });

  it.each([null, undefined, {}, { config: null }, { config: 'nonsense' }])(
    'a member with no usable bag (%p) falls back instead of throwing',
    (m) => {
      expect(
        readMemberConfig(m, 'follow_up.line.abandon_trigger_at', null as never),
      ).toBeNull();
    },
  );

  it('a half-built bag falls back — no crash on a missing middle level', () => {
    expect(
      readMemberConfig(
        { config: { follow_up: {} } },
        'follow_up.line.abandon_trigger_at',
        null as never,
      ),
    ).toBeNull();
  });

  it('a value of the WRONG type is treated as absent, not trusted', () => {
    /* `Mixed` means Mongoose validates nothing. A string that merely LOOKS like a
       date is the dangerous case: it compares and sorts as text, so a screen
       ordering by "stuck longest" would be quietly wrong. */
    const bad = {
      config: { follow_up: { line: { abandon_trigger_at: '2026-08-20' } } },
    };
    expect(
      readMemberConfig(bad, 'follow_up.line.abandon_trigger_at', null as never),
    ).toBeNull();
  });

  it('reading an undeclared key throws rather than returning the fallback', () => {
    expect(() =>
      readMemberConfig({}, 'follow_up.line.nope' as never, null as never),
    ).toThrow(/unknown key/);
  });
});

describe('writing — one leaf at a time, never the whole bag', () => {
  const STAMP = new Date('2026-08-20T10:00:00.000Z');
  const KEY = 'follow_up.line.abandon_trigger_at';
  const PATH = 'config.follow_up.line.abandon_trigger_at';

  it('writes a DOT PATH, so a sibling key of another feature survives', async () => {
    const { deps, updateOne } = makeModel();
    await writeMemberConfig({ line_user_id: 'U1' }, KEY, STAMP, deps);
    const [filter, update] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter).toEqual({ line_user_id: 'U1' });
    expect(Object.keys(update)).toEqual(['$set']);
    expect(update.$set).toEqual({ [PATH]: STAMP });
    // the failure this guards: $set: { config: {...} } replaces the bag wholesale
    expect(Object.keys(update.$set!)[0]).toContain('.');
  });

  it('a typo is refused BEFORE any query is built', async () => {
    const { deps, updateOne } = makeModel();
    await expect(
      writeMemberConfig({}, 'follow_up.line.abandon_triggerr', STAMP, deps),
    ).rejects.toThrow(/unknown key/);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('a value that is not a real Date is refused before any query is built', async () => {
    const { deps, updateOne } = makeModel();
    // a string that looks like a date is the dangerous one — it would sort as text
    await expect(
      writeMemberConfig({}, KEY, '2026-08-20', deps),
    ).rejects.toThrow(/expects date, got string/);
    await expect(writeMemberConfig({}, KEY, true, deps)).rejects.toThrow(
      /expects date, got boolean/,
    );
    await expect(
      writeMemberConfig({}, KEY, new Date('nonsense') as never, deps),
    ).rejects.toThrow(/invalid date/);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('says false when it changed nothing', async () => {
    const { deps } = makeModel(0);
    expect(
      await writeMemberConfig({ line_user_id: 'U1' }, KEY, STAMP, deps),
    ).toBe(false);
  });

  /* [FEAT-20260820-ABANDONTRIGGER] the stamp means "since when", so the FIRST one
     is the true one. A stuck customer writes again and again; without this guard
     every message would move the timestamp forward until it meant "last message". */
  it('the ONCE writer puts the guard in the FILTER — no read-then-write window', async () => {
    const { deps, updateOne } = makeModel();
    await writeMemberConfigOnce({ line_user_id: 'U1' }, KEY, STAMP, deps);
    const [filter, update] = updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, Record<string, unknown>>,
    ];
    expect(filter['line_user_id']).toBe('U1');
    expect(filter['$or']).toEqual([
      { [PATH]: { $exists: false } },
      { [PATH]: null },
    ]);
    expect(update.$set).toEqual({ [PATH]: STAMP });
  });

  it('the ONCE writer says false when somebody else was first', async () => {
    const { deps } = makeModel(0);
    expect(
      await writeMemberConfigOnce({ line_user_id: 'U1' }, KEY, STAMP, deps),
    ).toBe(false);
  });

  it('the ONCE writer checks key and value too — a typo cannot slip through it', async () => {
    const { deps, updateOne } = makeModel();
    await expect(
      writeMemberConfigOnce({}, 'nope', STAMP, deps),
    ).rejects.toThrow();
    await expect(writeMemberConfigOnce({}, KEY, 1, deps)).rejects.toThrow();
    expect(updateOne).not.toHaveBeenCalled();
  });

  /* Clearing is NOT wired anywhere yet — the owner asked for the trigger first and
     said the clear would come later, "แต่ต้องเพิ่มแบบง่าย ๆ". This test is the proof
     that adding it later is one call, not a redesign. */
  it('clearing $unsets the leaf — ready to wire the day registration should clear it', async () => {
    const { deps, updateOne } = makeModel();
    await clearMemberConfig({ line_user_id: 'U1' }, KEY, deps);
    const [, update] = updateOne.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(update).toEqual({ $unset: { [PATH]: '' } });
  });
});

describe('seamless — the ways this could move the response or the data', () => {
  const schema = src('src/modules/chat/schemas/member.schema.ts');
  const noComments = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('the schema declares config — strict:true drops undeclared paths in silence', () => {
    expect(noComments(schema)).toContain('config?: Record<string, unknown>;');
  });

  it('config has NO default — a default is written on the insert half of an upsert', () => {
    // measured: with a default, `.lean()` returns the key for every new member
    // and the key lands in the database. Absent is what keeps this invisible.
    /* Take the @Prop line that sits immediately ABOVE `config` — several other
       props are also `Mixed` (`meta`, `raw_profile_data`, `tier`) and matching
       the first one of those tested the wrong line entirely. */
    const lines = noComments(schema).split('\n');
    const at = lines.findIndex((l) =>
      l.includes('config?: Record<string, unknown>;'),
    );
    expect(at).toBeGreaterThan(0);
    const propLine = lines[at - 1]!;
    expect(propLine).toContain('@Prop(');
    expect(propLine).toContain('MongooseSchema.Types.Mixed');
    expect(propLine).not.toContain('default');
  });

  it('nothing outside chat/config reaches into member.config', () => {
    // the single-door property: if this ever fails, the storage decision has
    // leaked and can no longer be changed in one place
    const offenders: string[] = [];
    for (const f of [
      'src/modules/chat/chat.service.ts',
      'src/modules/chat/chat-history.service.ts',
      'src/modules/chat/members.service.ts',
      'src/modules/webhook/webhook.service.ts',
      /* [PROG-20260905-G23] The follow-up flow moved out of the spine and took the bag
         call with it. This is a DENY list — files scanned for reaching into
         `member.config` directly — so the new home has to be scanned too, or the single
         door property is only proven for the file the code left. The service stays on the
         list: it is still the biggest file in the module and still the likeliest place for
         somebody to reach past the door. */
      'src/modules/webhook/gates/follow-up-flow.ts',
      'src/modules/customer-link/customer-link.service.ts',
    ]) {
      /* Narrow on purpose: `@/config/app.config` is an import path and has
         nothing to do with a member. What must never appear is somebody reading
         a member's bag directly (`member.config`, `user['config']`) or writing
         it (`config:` inside an update, `'config.` as a dotted path). */
      const body = noComments(src(f));
      if (
        /\b(member|user|lineUser|updatedUser)\??\.(config)\b/.test(body) ||
        /\['config'\]/.test(body) ||
        /'config\./.test(body) ||
        /\$set:[\s\S]{0,120}\bconfig:/.test(body)
      ) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ONE feature reads the bag, and it goes through the helpers', () => {
    /* [FEAT-20260820-ABANDONTRIGGER] the bag stopped being pure infrastructure the
       day the follow-up stamp landed. The invariant that still matters is the
       single door: everything that touches a member's config does it through
       `chat/config`, so the storage decision stays changeable in one place.
       ใครจะใช้ก็ได้ แต่ต้องผ่านประตูนี้เท่านั้น. */
    const readers = execSync(
      // real IMPORTS only — the schema file names the folder in a revert note
      `grep -rlE "from '[^']*chat/config'" src --include='*.ts' || true`,
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((f) => f && !f.startsWith('src/modules/chat/config/'))
      .sort();
    /* [FEAT-20260820-CLEARONLINK] two readers added the same day, both through
       the one door this test exists to protect:
         · `customer-link/clear-follow-up-on-register.helper.ts` — takes the
           abandon flag off the instant a registration succeeds, instead of
           waiting for the customer's next message to reach the webhook gate
         · `webhook/webhook.service.ts` — writes `request_reg_at` when scenario A
           opens a registration case
       Neither reaches into `member.config` directly; both go through the helpers,
       which is the invariant. เพิ่มคนใช้ได้ แต่ต้องผ่านประตูเดิม. */
    /* [FEAT-20260822-NOTICERUNTIME] one more, through the same door:
         · `webhook/notice-runtime/notice-guard.helper.ts` — reads the rolling
           notice stamps for the cooldown and writes them after each card. */
    /* [FEAT-20260823-CONTACTFOLLOW] one more reader, same door:
         · `chat/chat.service.ts` — listContacts turns `?follow=` into a member
           filter on the notice stamps, via `memberConfigPath` + the runtime's
           own key constants. Read-only; writes and clears stay where they were. */
    /* [FEAT-20260824-BCASTCLEARNOTICE] one more, through the same door:
         · `content/broadcast-follow-up/clear-notice-on-multicast.ts` — clears
           the deposit/withdraw notice stamps of everyone a MULTICAST reached.
           The stamp means "we told them the bank is broken"; a campaign saying
           it works again ends that, and a new bank problem re-stamps it.
           Owner 24/08. Reaches the bag only through `clearMemberConfigMany`. */
    expect(readers).toEqual([
      'src/modules/chat/chat.service.ts',
      /* [FEAT-20260829-MANUALFOLLOWSTAMP] added 29/08 — the SECOND consumer a
         human drives, and the first human-driven WRITER. `setFollowUpStamp`
         records `notice_deposit_at` / `notice_withdraw_at` when an admin presses
         the `n/a` row on the customer panel, through `writeMemberConfig` like
         everything else on this list.
         ⚠️ Unlike the notice runtime, which MUST move the stamp per card, this
         one REFUSES a stamp that already has a value — a human press must not
         rewrite the record other screens report on. That rule lives in a helper
         beside the service (`member-follow-stamp.helper.ts`) which imports
         nothing from the door and therefore never appears in this list — the
         same deliberate omission as customer-helper-trigger.rule.ts below. */
      'src/modules/chat/members.service.ts',
      'src/modules/content/broadcast-follow-up/clear-notice-on-multicast.ts',
      /* [FEAT-20260825-MCASTABANDON] a second writer of `abandon_trigger_at`.
         A multicast asking for details arms the follow-up gate for the people it
         reached, so their next message is handed to the register scenario.
         ⚠️ This flag is read for a DECISION, unlike the counting keys — arming
         someone means their next inbound message opens a case and ends the flow.
         Reasoning and every knob: `stamp-abandon-on-multicast.ts`. */
      'src/modules/content/broadcast-follow-up/stamp-abandon-on-multicast.ts',
      'src/modules/customer-link/clear-follow-up-on-register.helper.ts',
      /* [FEAT-20260826-CLOSECLEARFU] added 26/08 — the close-case clearer, the
         only consumer a human drives. It goes through `clearMemberConfig` like
         every other one, which is what this list is really asserting. */
      'src/modules/tickets/tickets.service.ts',
      'src/modules/webhook/follow-up/abandon-trigger.helper.ts',
      'src/modules/webhook/follow-up/clear-follow-up.helper.ts',
      /* [FEAT-20260825-HELPERTRIGGER] one more writer through the same door.
         It uses `writeMemberConfig` (the OVERWRITING one) because the stamp it
         keeps answers "when did we LAST offer the customer-helper" — freezing
         the first offer would answer a different question.
         ⚠️ Its decision lives in a separate PURE file (customer-helper-trigger
         .rule.ts) which imports nothing and therefore never appears in this
         list — that is deliberate, not an omission. */
      'src/modules/webhook/follow-up/customer-helper-trigger.helper.ts',
      'src/modules/webhook/follow-up/follow-up.gate.ts',
      /* [PROG-20260905-G23] This entry USED TO BE `webhook/webhook.service.ts`. The spine
         reduction program moved the follow-up flow — and with it the one
         `writeMemberConfigOnce` call that made the service a door importer — into
         `gates/follow-up-flow.ts`. The service still reaches the bag INDIRECTLY through
         `stampCustomerHelperTrigger`, but that helper is already on this list in its own
         right, and this list names files that import the door, not files that benefit
         from it. ย้ายโค้ดแล้วต้องย้ายบัญชีตาม */
      'src/modules/webhook/gates/follow-up-flow.ts',
      'src/modules/webhook/notice-runtime/notice-guard.helper.ts',
    ]);
  });
});
