/* [FEAT-20260822-NOTICERUNTIME] R3c — the guard's impure step, on fake deps
 * ===========================================================================
 * Real door functions (readMemberConfig reads the in-memory doc; the write
 * gets a fake model), fake LINE/history/log deps that record their calls.
 * What is pinned: the fail-open directions, the sent-pivot, the write order
 * (bot row before the reply), the cooldown round trip, and the stamp write.
 */
/* eslint-disable @typescript-eslint/require-await --
   the fake deps are deliberately synchronous: the guard awaits them, so they
   must be async-shaped, and adding a no-op await to each would only add noise. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  NOTICE_ALT_TEXT,
  NOTICE_DEPOSIT_AT_KEY,
  runNoticeGuard,
  type NoticeGuardDeps,
} from '@/modules/webhook';

const CARD_ID = 'a0d000000000000000000070';
const IN_WINDOW = new Date('2026-08-22T16:30:00.000Z'); // 23:30 Bangkok

const firingHook = {
  notice_deposit_status: true,
  notice_deposit_offtime_flex_id: CARD_ID,
};
const textInput = (hook: Record<string, unknown>) => ({
  eventKind: 'text' as const,
  hook,
  text: 'ฝากไม่เข้าครับ',
  now: IN_WINDOW,
});

function makeDeps(over: Partial<NoticeGuardDeps> = {}) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const updates: unknown[] = [];
  /* the payloads, not just the names: an assertion on "logBotRow ran" passes
     for a row that names the WRONG case. เก็บ payload ไว้ให้เทสจับตัวจริงได้. */
  const botRows: Array<{ card: unknown; flexDocId: string; caseId: string }> =
    [];
  const wlogs: Array<{ actionType: string; httpStatus: number }> = [];
  const sends: Array<{ card: unknown; altText: string }> = [];
  const deps: NoticeGuardDeps = {
    member: null,
    memberModel: {
      updateOne: (filter: unknown, update: unknown) => {
        updates.push({ filter, update });
        return { exec: async () => ({ modifiedCount: 1 }) };
      },
    } as never,
    channelUserId: 'Utestuser',
    loadCard: async () => {
      calls.push('loadCard');
      return { type: 'bubble' };
    },
    logBotRow: (a) => {
      calls.push('logBotRow');
      botRows.push(a);
    },
    sendFlex: async (card, altText) => {
      calls.push('sendFlex');
      sends.push({ card, altText });
      return { status: 200, data: { ok: true } };
    },
    wlog: async (a) => {
      calls.push('wlog');
      wlogs.push({ actionType: a.actionType, httpStatus: a.httpStatus });
    },
    /* ⚠️ the MESSAGE is kept on purpose: `calls.toContain('warn')` passes for a
       warn from ANY branch — the outer catch, the customer row, the stamp, the
       quota — so a mutation that swaps which one fires stays green. Cases that
       care assert on `warnings`. เก็บข้อความไว้ ไม่งั้นเทสจับผิดตัวไม่ได้. */
    warn: (m: string) => {
      calls.push('warn');
      warnings.push(m);
    },
    now: IN_WINDOW,
    ...over,
  };
  return { deps, calls, updates, warnings, botRows, wlogs, sends };
}

describe('⭐ runNoticeGuard — the one impure step', () => {
  it('⭐ fires end to end: send FIRST, then the bot row, then stamp, then wlog', async () => {
    const { deps, calls, updates } = makeDeps();
    await expect(runNoticeGuard(textInput(firingHook), deps)).resolves.toBe(
      true,
    );
    /* [FIX-20260822-NOTICEHARDEN] order changed on purpose: the send comes
       first so a rejected send leaves NO row claiming a card went out (#10),
       and the durable stamp is written before the observable log (#8). */
    expect(calls).toEqual(['loadCard', 'sendFlex', 'logBotRow', 'wlog']);
    // the rolling stamp went through the door onto the right leaf
    expect(updates).toHaveLength(1);
    const u = updates[0] as { filter: unknown; update: unknown };
    expect(u.filter).toEqual({ line_user_id: 'Utestuser' });
    expect(JSON.stringify(u.update)).toContain(
      `config.${NOTICE_DEPOSIT_AT_KEY}`,
    );
  });

  it('⭐ the cooldown is REMOVED — a fresh stamp no longer blocks (owner, 22/08)', async () => {
    /* "เรามี rate limit อยู่แล้ว ไม่ต้องมี cooldown ถ้ามัน flood มันก็ได้การ์ดเดิม
       นั้นแหละ ถอด cooldown ออก note ไว้ (เผื่อเอากลับ)". The guard now passes
       NOTICE_COOLDOWN_ENABLED (policy: false) into the checker, so a stamp
       minutes old fires again. Flipping that policy back to true restores the
       old behaviour, and notice-runtime-checkers.spec.ts still proves the
       checker itself works. */
    const stamped = (agoMin: number) => ({
      config: {
        follow_up: {
          line: {
            notice_deposit_at: new Date(
              IN_WINDOW.getTime() - agoMin * 60 * 1000,
            ),
          },
        },
      },
    });
    const fresh = makeDeps({ member: stamped(5) });
    await expect(
      runNoticeGuard(textInput(firingHook), fresh.deps),
    ).resolves.toBe(true);
    expect(fresh.calls).toContain('sendFlex');

    const stale = makeDeps({ member: stamped(90) });
    await expect(
      runNoticeGuard(textInput(firingHook), stale.deps),
    ).resolves.toBe(true);
  });

  it('⭐ fail-open BEFORE the send: no decision · no card id · unloadable card', async () => {
    for (const hook of [
      {}, // toggles absent = OFF (lean rule)
      { notice_deposit_status: true }, // no card configured
    ]) {
      const { deps, calls } = makeDeps();
      await expect(runNoticeGuard(textInput(hook), deps)).resolves.toBe(false);
      expect(calls).not.toContain('sendFlex');
    }
    const unloadable = makeDeps({ loadCard: async () => null });
    await expect(
      runNoticeGuard(textInput(firingHook), unloadable.deps),
    ).resolves.toBe(false);
    expect(unloadable.calls).not.toContain('sendFlex');
  });

  it('⭐ the sent pivot: a throw BEFORE the send falls through, AFTER still swallows', async () => {
    const before = makeDeps({
      sendFlex: async () => {
        throw new Error('LINE down');
      },
    });
    await expect(
      runNoticeGuard(textInput(firingHook), before.deps),
    ).resolves.toBe(false); // not sent → the flow may continue unchanged
    expect(before.calls).toContain('warn');

    const after = makeDeps({
      wlog: async () => {
        throw new Error('log down');
      },
    });
    await expect(
      runNoticeGuard(textInput(firingHook), after.deps),
    ).resolves.toBe(true); // already sent → never hand the event to the AI
    expect(after.calls).toContain('warn');
  });

  it('⭐ image path writes the customer row first, and its failure never stops the card', async () => {
    const order = makeDeps({
      logCustomerRow: async () => {
        order.calls.push('customerRow');
        return null;
      },
    });
    const imageInput = {
      eventKind: 'image' as const,
      hook: {
        notice_deposit_status: true,
        notice_deposit_scope: 'slip',
        notice_all_offtime_flex_id: CARD_ID,
      },
      qrReason: 'qr_found',
      now: IN_WINDOW,
    };
    await expect(runNoticeGuard(imageInput, order.deps)).resolves.toBe(true);
    /* the customer's own row still comes first — only the BOT row moved after
       the send (#10). */
    expect(order.calls).toEqual([
      'loadCard',
      'customerRow',
      'sendFlex',
      'logBotRow',
      'wlog',
    ]);

    const failing = makeDeps({
      logCustomerRow: async () => {
        throw new Error('history down');
      },
    });
    await expect(runNoticeGuard(imageInput, failing.deps)).resolves.toBe(true);
    expect(failing.calls).toContain('warn');
    expect(failing.calls).toContain('sendFlex');
  });

  it('a failed stamp write is swallowed — one extra card later, never a crash', async () => {
    const { deps, calls } = makeDeps({
      memberModel: {
        updateOne: () => {
          throw new Error('mongo down');
        },
      } as never,
    });
    await expect(runNoticeGuard(textInput(firingHook), deps)).resolves.toBe(
      true,
    );
    expect(calls).toContain('warn');
  });
});

/* ── [FIX-20260822-NOTICEHARDEN] the 22/08 review defects, RED first ─────────
 * Each case below fails against the code as shipped this morning and passes
 * only after its fix. เขียนให้แดงก่อนแก้ ตามกฏ dev-local. */
describe('⭐ hardening — defects found by the adversarial review', () => {
  it('⭐ #8 a failing wlog must NOT cost the stamp', async () => {
    /* the stamp is the only record of "we already warned this member"; a log
       hiccup must not erase it. Ordering fix: stamp BEFORE wlog. */
    const { deps, updates } = makeDeps({
      wlog: async () => {
        throw new Error('log queue full');
      },
    });
    await expect(runNoticeGuard(textInput(firingHook), deps)).resolves.toBe(
      true,
    );
    expect(updates).toHaveLength(1); // the stamp still landed
  });

  it('⭐ #10 a failed send must leave NO bot row behind', async () => {
    /* the row says "a card went out". When the send throws, the flow falls
       through to the AI, so a row here makes the admin screen disagree with
       the customer's phone — and pollutes the abandon lookback (#11). */
    const { deps, calls } = makeDeps({
      sendFlex: async () => {
        throw new Error('LINE 400');
      },
    });
    await expect(runNoticeGuard(textInput(firingHook), deps)).resolves.toBe(
      false,
    );
    expect(calls).not.toContain('logBotRow');
  });

  it('⭐ #9 an unusable case must not block the next one', async () => {
    /* deposit ON with the off-time card missing (a state only a clone or a
       hand edit can produce): case A matches and cannot send, so case B —
       fully configured — must get its turn instead of the whole guard
       going quiet. เคสแรกใช้ไม่ได้ ต้องลองเคสถัดไป. */
    const partial = {
      notice_deposit_status: true,
      notice_deposit_flex_id: CARD_ID, // B's card
      // notice_deposit_offtime_flex_id (A's card) deliberately absent
    };
    const { deps, calls } = makeDeps();
    await expect(
      runNoticeGuard(
        {
          eventKind: 'text' as const,
          hook: partial,
          text: 'ฝากไม่เข้าครับ',
          siteRulesRaw: {
            data: {
              shop: {
                bank_account: {
                  accounts: [{ account_type: 'deposit', is_view: false }],
                },
              },
            },
          },
          now: IN_WINDOW,
        },
        deps,
      ),
    ).resolves.toBe(true);
    expect(calls).toContain('sendFlex');
  });
});

/* ── [FIX-20260822-NOTICEOUTPUTS] what the guard actually HANDS to the webhook
 * ===========================================================================
 * Found by an independent test audit: every case above asserted that a dep RAN
 * ("calls contains sendFlex"), never WHAT it was given. A mutation that logs
 * the wrong case, sends the wrong alt text, or names the wrong action_type in
 * the webhook log stayed green — and those three strings are exactly what the
 * admin screen, the customer's notification bar and the Webhook Logs page show.
 * เทสต้องดูของที่ส่งออก ไม่ใช่แค่ว่าเรียกครบ. */
describe("⭐ the guard's outputs are the contract", () => {
  it('⭐ names the case in the row, the log action and the LINE alt text', async () => {
    const { deps, botRows, wlogs, sends } = makeDeps();
    await expect(runNoticeGuard(textInput(firingHook), deps)).resolves.toBe(
      true,
    );
    // the bot row the admin screen reads
    expect(botRows).toEqual([
      { card: { type: 'bubble' }, flexDocId: CARD_ID, caseId: 'A' },
    ]);
    // the webhook log row (lower-cased case id — the panel filters on it)
    expect(wlogs).toEqual([
      { actionType: 'notice_case_a_flex', httpStatus: 200 },
    ]);
    // what the phone shows in the notification bar
    expect(sends).toHaveLength(1);
    expect(sends[0]?.altText).toBe(NOTICE_ALT_TEXT);
  });

  it('⭐ a failed stamp is warned BY NAME — not just "some warn happened"', async () => {
    const { deps, warnings } = makeDeps({
      memberModel: {
        updateOne: () => ({
          exec: async () => {
            throw new Error('mongo down');
          },
        }),
      } as never,
    });
    await expect(runNoticeGuard(textInput(firingHook), deps)).resolves.toBe(
      true,
    );
    expect(warnings.join(' ')).toMatch(/stamp write failed/);
    expect(warnings.join(' ')).not.toMatch(/guard failed/);
  });
});

/* ── [FIX-20260822-NOTICEFALLBACK] how far #9 may walk ─────────────────────
 * The audit that found the outputs hole also found this: #9 walks past a case
 * whose card is unset, and the two word lists share twelve substrings, so a
 * plain sentence matches deposit AND withdraw at once. An unrestricted walk
 * answers a DEPOSIT complaint with the WITHDRAW card. การ์ดผิดฝั่งแย่กว่าเงียบ. */
describe('⭐ the #9 fallback stays on one side', () => {
  const sharedWordInput = (hook: Record<string, unknown>) => ({
    eventKind: 'text' as const,
    hook,
    // in BOTH lists (the shared block) → A and C both match in-window
    text: 'เงินไม่เข้า',
    now: IN_WINDOW,
  });

  it('⭐ same side: A has no card, B does → B answers, and the row says B', async () => {
    const { deps, botRows } = makeDeps();
    await expect(
      runNoticeGuard(
        {
          eventKind: 'text' as const,
          hook: {
            notice_deposit_status: true,
            // notice_deposit_offtime_flex_id (case A) deliberately absent
            notice_deposit_flex_id: CARD_ID, // case B
          },
          text: 'ฝากไม่เข้าครับ',
          /* B needs the site rules to say the deposit side is OFF — the same
             shape the checker reads on the real path (a deposit account that
             is not viewable = the deposit side counts zero). */
          siteRulesRaw: {
            data: {
              shop: {
                bank_account: {
                  accounts: [
                    {
                      account_type: 'deposit',
                      is_view: false,
                      status: 'enable',
                    },
                    { account_type: 'withdraw', status: 'enable' },
                  ],
                },
              },
            },
          },
          now: IN_WINDOW,
        },
        deps,
      ),
    ).resolves.toBe(true);
    expect(botRows.map((r) => r.caseId)).toEqual(['B']);
  });

  it('⭐ cross side: A has no card but C does → SILENT, never the withdraw card', async () => {
    const { deps, calls, botRows } = makeDeps();
    await expect(
      runNoticeGuard(
        sharedWordInput({
          notice_deposit_status: true,
          notice_withdraw_status: true,
          // deposit off-time card unset; withdraw off-time card configured
          notice_withdraw_offtime_flex_id: CARD_ID,
        }),
        deps,
      ),
    ).resolves.toBe(false);
    expect(calls).not.toContain('sendFlex');
    expect(botRows).toEqual([]);
  });

  it('⭐ the deposit side still wins a shared word when its card IS set', async () => {
    const { deps, botRows } = makeDeps();
    await expect(
      runNoticeGuard(
        sharedWordInput({
          notice_deposit_status: true,
          notice_withdraw_status: true,
          notice_deposit_offtime_flex_id: CARD_ID,
          notice_withdraw_offtime_flex_id: CARD_ID,
        }),
        deps,
      ),
    ).resolves.toBe(true);
    expect(botRows.map((r) => r.caseId)).toEqual(['A']);
  });
});

/* ── [FIX-20260822-NOTICEHARDEN] card ids that are not ids ─────────────────
 * `readCardId` accepts a string or an ObjectId (which carries its own
 * toString) and rejects everything else. Without these cases, replacing its
 * body with `String(raw ?? '')` is a green mutation — and that puts
 * "[object Object]" into findById, an id that can never resolve, while the
 * candidate walk has already stopped on it. */
describe('⭐ what counts as a card id', () => {
  const withCard = (raw: unknown) => ({
    eventKind: 'text' as const,
    hook: { notice_deposit_status: true, notice_deposit_offtime_flex_id: raw },
    text: 'ฝากไม่เข้าครับ',
    now: IN_WINDOW,
  });

  it('⭐ an ObjectId-shaped value is accepted as its text', async () => {
    const { deps, botRows } = makeDeps();
    await expect(
      runNoticeGuard(withCard({ toString: () => CARD_ID }), deps),
    ).resolves.toBe(true);
    expect(botRows[0]?.flexDocId).toBe(CARD_ID);
  });

  it('⭐ a plain object, an array or a number is NOT an id — the guard stays quiet', async () => {
    /* ⚠️ `[CARD_ID]` is the dangerous one: an array stringifies to its single
       element, so before the fix a mis-migrated row would have SENT that card
       under a case the operator never bound it to. อาเรย์ที่มี id เดียวคือกับดัก. */
    for (const junk of [
      {},
      [],
      [CARD_ID],
      [CARD_ID, CARD_ID],
      0,
      null,
      undefined,
      false,
    ]) {
      const { deps, calls } = makeDeps();
      await expect(runNoticeGuard(withCard(junk), deps)).resolves.toBe(false);
      expect(calls).not.toContain('loadCard');
    }
  });
});

/* ── the wiring in webhook.service.ts — which call site charges the ladder ──
 * The "exactly one unit per event" argument rests entirely on an asymmetry
 * between the two insertion points: the IMAGE guard answers above the limiter
 * and charges for itself, the TEXT guard answers below it and must not. That
 * asymmetry lived only in comments; adding `consumeQuota` to the text site
 * would double-charge every text notice with the whole suite green.
 * เทสต้องปักว่าใครชาร์จ ไม่ใช่เชื่อคอมเมนต์. */
describe('⭐ wiring — the two insertion points differ on purpose', () => {
  /* [PROG-20260905-LADDER] TWO OF THE THREE CALL SITES MOVED. The ordinary text guard is
     `gates/notice-text-guard.step.ts` and the withdraw door is `gates/admin-doors.step.ts`;
     only the image site is still inline, because a strike-plug hunk owns bytes inside it.
     Every rule below is about the WIRING of those sites and holds wherever they live, so
     the source is the spine plus the ladder directory. The count assertions are what makes
     this a widening rather than a weakening: a site that stopped consulting the knob still
     fails, and a site that vanished fails too. */
  const svc =
    readFileSync(
      join(__dirname, '../../src/modules/webhook/webhook.service.ts'),
      'utf8',
    ) +
    ['notice-text-guard.step.ts', 'admin-doors.step.ts']
      .map((f) =>
        readFileSync(
          join(__dirname, '../../src/modules/webhook/gates', f),
          'utf8',
        ),
      )
      .join('\n');
  /* every call block, sliced from its own `this.tryNoticeGuard({` to the next
     one (or to the end) — `eventKind` is the FIRST property inside the call,
     so the marker cannot be searched for before the opening brace. */
  const callBlocks = svc
    .split(/this\.tryNoticeGuard\(\{|deps\.tryNoticeGuard\(\{/)
    .slice(1)
    .map((chunk) => chunk.slice(0, 2500));
  const blockAt = (marker: string) => {
    const found = callBlocks.filter((b) => b.includes(marker));
    expect(found).toHaveLength(1);
    return found[0];
  };
  /* ⚠️⚠️ CHANGED 31/08/2026 — [FEAT-20260831-ADMINVIAWITHDRAW] added a THIRD
     insertion point (the withdraw-side admin button), so the text side is no
     longer one block. The assertions did not get weaker: they went from "the
     text site" to "EVERY text site", which is what the argument always meant —
     the "exactly one unit per event" claim rests on no text door charging the
     ladder, whichever door it is. หลายประตู = ต้องจริงทุกประตู. */
  const textBlocks = () =>
    callBlocks.filter((b) => b.includes("eventKind: 'text'"));

  it('⭐ the image call site charges the ladder; NO text site ever does', () => {
    const image = blockAt("eventKind: 'image'");
    expect(image).toContain('consumeQuota:');
    expect(image).toContain('this.rateLimit.consume(');
    const texts = textBlocks();
    expect(texts.length).toBeGreaterThanOrEqual(2); // ordinary + withdraw door
    for (const text of texts) {
      expect(text).not.toContain('consumeQuota');
      expect(text).not.toContain('rateLimit');
    }
  });

  it('⭐ EVERY text call site consults NOTICE_TEXT_EVENTS before it even asks', () => {
    /* the knob can only be read where the RAW event still exists — by the time
       the guard runs, a postback's payload is already plain text. A wiring that
       drifts back to calling unconditionally would make the knob dead again,
       with every behavioural test still green. */
    let from = 0;
    let seen = 0;
    for (;;) {
      /* the trailing comma keeps this on CALL SITES: the type declaration on
         `tryNoticeGuard` reads `eventKind: 'text' | 'image';` and would
         otherwise be counted as a door that consults nothing. */
      const i = svc.indexOf("eventKind: 'text',", from);
      if (i < 0) break;
      seen += 1;
      const before = svc.slice(Math.max(0, i - 1400), i);
      /* [FEAT-20260902-ADMINPOSTBACK] ONE documented exemption, recognised by the
         door that owns it rather than by "whatever fails".

         The knob answers "may a RAW event reach the text screens". The paylink
         door is not a raw event: it fires on one specific postback payload and
         SUPPLIES ITS OWN text (the copy constant), because the withdraw cases
         short-circuit on `ctx.withdrawWord` and a machine payload carries no word.
         Gating it on the knob would mean flipping NOTICE_TEXT_EVENTS to
         'message-only' — documented as a NARROWING of which raw events are
         screened — silently killed a button instead.
         ⇒ ประตูนี้ป้อน text เอง ไม่ใช่ event ดิบ จึงไม่ต้องถามสวิตช์
         The exemption is asserted in BOTH directions so it cannot quietly widen. */
      /* [PROG-20260905-LADDER] the local `payLinkPressed` is gone — the door is a step
         and asks `payLinkFromPostback(...) === 'contact_admin_via_withdraw'`. The
         exemption is recognised by the ACTION NAME, which is the thing that identifies the
         door; only the variable's name went away. */
      if (before.includes("=== 'contact_admin_via_withdraw'")) {
        expect(before).not.toContain('noticeTextEventAllowed(');
        // and it must be feeding the lane a real sentence, not the payload
        expect(svc.slice(i, i + 1400)).toContain(
          'text: CONTACT_ADMIN_WITHDRAW_MESSAGE',
        );
      } else {
        expect(before).toContain('noticeTextEventAllowed(');
        expect(before).toContain('event.type');
      }
      from = i + 1;
    }
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it('⭐ BOTH call sites hand the guard the assist verdict', () => {
    expect(blockAt("eventKind: 'image'")).toMatch(
      /assisted: (ctx\.)?skipBotProcessing/,
    );
    for (const text of textBlocks()) {
      /* `ctx.skipBotProcessing` in a step, `skipBotProcessing` inline — the rule is that
         the verdict is HANDED OVER, not how the caller happens to spell its own local. */
      expect(text).toMatch(/assisted: (ctx\.)?skipBotProcessing/);
    }
  });
});

/* ── [FIX-20260822-NOTICECOLLIDE] the cross-feature collisions, RED first ──── */
describe('⭐ collisions with the rest of the webhook', () => {
  it('⭐ assisted room: the guard stays silent on BOTH paths (owner, 22/08)', async () => {
    /* "เงียบทั้งสอง แต่ต้องตั้งค่าเปลี่ยนแปลงได้ในอนาคตแบบง่ายๆ ทำท่อไว้".
       An operator holding the room must not have a bot card land on top of
       their typing — every other reply site in the webhook already suppresses
       itself there. The policy knob keeps the door open to change it back. */
    const text = makeDeps();
    await expect(
      runNoticeGuard({ ...textInput(firingHook), assisted: true }, text.deps),
    ).resolves.toBe(false);
    expect(text.calls).not.toContain('sendFlex');

    const image = makeDeps();
    await expect(
      runNoticeGuard(
        {
          eventKind: 'image' as const,
          hook: {
            notice_deposit_status: true,
            notice_deposit_scope: 'slip',
            notice_all_offtime_flex_id: CARD_ID,
          },
          qrReason: 'qr_found',
          assisted: true,
          now: IN_WINDOW,
        },
        image.deps,
      ),
    ).resolves.toBe(false);
    expect(image.calls).not.toContain('sendFlex');
  });

  /* ── [FIX-20260822-NOTICEQUOTA] the ladder is charged ONCE, and only for an
   * event this guard actually answered. RED first: before the fix the charge
   * happened the moment a case MATCHED, so every path that matched without
   * sending (limited · card not configured · send rejected) charged here and
   * then let the flow charge again at webhook.service.ts's own limiter — two
   * units for one image, against that block's own "EXACTLY ONCE" rule.
   * นับครั้งเดียว ต่อเมื่อการ์ดออกไปจริง. */
  const slipInput = (over: Record<string, unknown> = {}) => ({
    eventKind: 'image' as const,
    hook: {
      notice_deposit_status: true,
      notice_deposit_scope: 'slip',
      notice_all_offtime_flex_id: CARD_ID,
      ...(over['hook'] as Record<string, unknown> | undefined),
    },
    qrReason: 'qr_found',
    now: IN_WINDOW,
  });

  it('⭐ P1 charges the ladder ONCE, and only AFTER the card really went out', async () => {
    const charged: string[] = [];
    const { deps, calls } = makeDeps({
      consumeQuota: async () => {
        calls.push('consumeQuota');
        charged.push('consume');
        return { limited: false };
      },
    });
    await expect(runNoticeGuard(slipInput(), deps)).resolves.toBe(true);
    expect(charged).toEqual(['consume']);
    // order is the proof: the send happens first, the charge answers for it.
    expect(calls.indexOf('sendFlex')).toBeLessThan(
      calls.indexOf('consumeQuota'),
    );
  });

  it('⭐ P1 a case that matches but CANNOT send charges nothing — the flow still owns the count', async () => {
    const charged: string[] = [];
    const quota = async () => {
      charged.push('consume');
      return { limited: false };
    };

    // (a) the case matches, but its card was never configured
    const noCard = makeDeps({ consumeQuota: quota });
    await expect(
      runNoticeGuard(
        {
          eventKind: 'image' as const,
          hook: { notice_deposit_status: true, notice_deposit_scope: 'slip' },
          qrReason: 'qr_found',
          now: IN_WINDOW,
        },
        noCard.deps,
      ),
    ).resolves.toBe(false);

    // (b) the card exists but LINE rejects the send
    const rejected = makeDeps({
      consumeQuota: quota,
      sendFlex: async () => {
        throw new Error('LINE 400');
      },
    });
    await expect(runNoticeGuard(slipInput(), rejected.deps)).resolves.toBe(
      false,
    );

    expect(charged).toEqual([]);
  });

  it('⭐ P1 a limited verdict does not suppress the card — and still costs exactly one unit', async () => {
    /* owner, 22/08, when the cooldown came out: "ถ้ามัน flood มันก็ได้การ์ดเดิม
       นั้นแหละ". The ladder's job here is to COUNT the event, not to decide
       whether the off-service card is allowed to answer it. Suppressing on
       `limited` would also hand the same event back to the flow, which charges
       it a second time — the bug this case exists to keep out. */
    const charged: string[] = [];
    const { deps, calls } = makeDeps({
      consumeQuota: async () => {
        charged.push('consume');
        return { limited: true };
      },
    });
    await expect(runNoticeGuard(slipInput(), deps)).resolves.toBe(true);
    expect(calls).toContain('sendFlex');
    expect(charged).toEqual(['consume']);
  });
});
