/**
 * Scenario A — read what the customer wrote, and decide the flow. Nothing else.
 * ===========================================================================
 * Owner, 2026-08-20, in order:
 *   · "เมื่อ A ได้ข้อมูล msg. มา จะยังไม่ตอบกลับ endflow · เรียก resloveInfo -> basic register"
 *   · "ถ้าเจอ true = endflow webhook · ถ้าเจอ false ไม่ end flow web hook"
 *   · "end flow คือ webhook ไม่ทำงานอีกเลย เก็บแค่ chat message ของลูกค้าแล้วจบ แค่นั้น"
 *   · "found = true ยังไม่ทำอะไร แช่ไว้ freeze ไว้"
 *
 * So A does exactly one thing: it says whether the flow ends.
 *
 *   found = true   → the flow ends. The customer's message was already stored
 *                    above the gate, and NOTHING else happens. แช่ไว้.
 *   found = false  → the flow carries on and the bot answers as it normally would.
 *
 * ⚠️ THE CASE IS OPENED ONLY WHEN `found` — and that is not a style choice.
 *   Opening a case CLAIMS the room, and a claimed room returns at the assist
 *   branch which sits ABOVE the follow-up gate. A case opened while
 *   `found = false` would silence the bot from the next message onwards — the
 *   exact opposite of "ไม่ end flow". So the case and the flow decision have to
 *   move together, or the owner's rule is true for one message and quietly false
 *   afterwards. เปิดเคส = จองห้อง ⇒ ห้ามเปิดตอนยังไม่เจอ.
 *
 *   (It was frozen for one round on 2026-08-20 — "found = true ยังไม่ทำอะไร แช่ไว้"
 *   — then un-frozen the same day with the wording below.)
 *
 * ⚠️ EVERY WORD COMES FROM `scenario-a.copy.ts`. The need, the category and the
 *   divider sentence are not written here, and the divider is DERIVED from the
 *   need so the two can never drift apart after somebody edits one.
 *
 * ⚠️ Nothing is done with the numbers themselves — they stay in chat history and
 * the log records whether, never what. ยังไม่เอาค่าไปใช้ ตามที่สั่ง.
 *
 * ⚠️ [FEAT-20260820-AALWAYSENDS] THE RESOLVER STILL RUNS, BUT DECIDES NOTHING.
 * `resolver: 'basic'` is kept so the readings keep landing in the log for the
 * `dynamic` reader being built next; removing it would cost information and buy
 * nothing, because the flow now ends either way. If you want it gone as well,
 * delete the `resolver` line — no other line depends on it.
 * ตัวอ่านยังทำงานไว้เก็บ log เฉย ๆ ไม่มีสิทธิ์ตัดสินแล้ว.
 *
 * revert: delete this file and its line in `scenarios/index.ts`.
 */
import {
  SCENARIO_A_CATEGORY,
  SCENARIO_A_NEED_DETAIL,
  scenarioADividerText,
} from './scenario-a.copy';
import type { RegisterScenario } from './scenario.types';

export const SCENARIO_A: RegisterScenario = {
  name: 'A',
  what: 'reads the message for a phone and an account, then opens an unassigned case',
  /* Which reader runs before anything is decided. One word — swapping to a
     future `'dynamic'` resolver is an edit here and nowhere else. */
  resolver: 'basic',
  /* [FEAT-20260820-AALWAYSENDS] ALWAYS. The digits no longer decide anything.
     Owner, 2026-08-20: "เลเวล 2 ตอน direct ticket ไม่นับตัวเลขแล้ว ไม่ว่าจะเป็น text
     ส่งมาหรือ sticker ใน webhook action นั้น endflow = true ทันที ไม่มี false แล้ว".

     WHAT THIS REPLACED — the exact line, so the revert is a paste:
         endsFlow: (resolved) => resolved?.found === true,
     and, in `run` below, an early return that skipped the case when
     `!input?.resolved?.found`. The two moved together on purpose and must move
     back together: see the ⚠️ in this file's header for why a case opened on a
     flow that carries on would silence the bot from the next message.

     WHY IT IS SAFE NOW. That warning was about `found = false` opening a case
     while the flow stayed OPEN. With the flow always ending, the case and the
     decision agree by construction — there is no combination left where a room
     is claimed but the bot is expected to keep talking.
     ตัวเลขไม่ตัดสินอีกแล้ว · จบทุกครั้ง ⇒ เปิดเคสทุกครั้ง สอดคล้องกันเสมอ. */
  endsFlow: true,

  async run(input, deps) {
    /* [FEAT-20260820-AALWAYSENDS] no reading of `resolved` decides anything here
       any more — every message that reaches A opens the case. The block that
       used to stand at the top of this function was:

           if (!input?.resolved?.found) {
             deps.log(`[REGISTER-SCENARIO-A] user=${'${input?.lineUserId ?? \'\'}'} found=false — flow left open, no case`);
             return;
           }

       Paste it back together with the `endsFlow` line above to restore the old
       behaviour; neither half works alone. */
    if (!deps.openCase || !input?.roomId) return;
    try {
      const opened = await deps.openCase({
        roomId: input.roomId,
        category: SCENARIO_A_CATEGORY,
        needDetail: SCENARIO_A_NEED_DETAIL,
        dividerContent: scenarioADividerText(SCENARIO_A_NEED_DETAIL),
      });
      /* Whether and how many, never what. The phone and the account stay in chat
         history, which is the one place they belong. บอกว่าเจอ ไม่บอกค่า. */
      deps.log(
        `[REGISTER-SCENARIO-A] case opened ticket=${opened.ticketId} room=${opened.roomId} user=${input.lineUserId} readings=${String(input.resolved?.candidates?.length ?? 0)}`,
      );

      /* [FEAT-20260820-REQUESTREG] Record that this customer was asked — AFTER
         the case actually opened, so the record and the case cannot disagree.
         A room already in a case throws above and never reaches this line, which
         is correct: no new case, no new record.
         Awaited, but only inside work the caller already fired and forgot, so no
         customer waits on it. Failure is swallowed by the catch below: losing the
         record must not turn an opened case into an error.
         จดหลังเปิดเคสสำเร็จเท่านั้น · จดไม่ได้ก็ไม่ทำให้เคสพัง. */
      if (deps.markRequested) await deps.markRequested();
    } catch (err) {
      /* "already in a case" lands here and is the expected steady state, not an
         error: opening a case claims the room, so a customer already in one can
         never reach this twice. ห้องมีเคสอยู่แล้ว = ปกติ. */
      deps.log(
        `[REGISTER-SCENARIO-A] no case opened for ${input.lineUserId}: ${(err as Error)?.message}`,
      );
    }
  },
};
