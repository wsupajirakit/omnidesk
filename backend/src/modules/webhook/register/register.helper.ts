/**
 * Where a stuck customer's messages are handed off to.
 * ===========================================================================
 * Level 3 of the follow-up flow: a customer who was asked to register, was
 * marked, came back, was asked again, and is STILL writing. From that point on
 * their messages are not answered by the bot at all — they are handed here.
 *
 * ⚠️ IT STILL DOES NOTHING WITH WHAT IT LEARNS, ON PURPOSE. The owner asked for the hand-off to
 * exist and be wired before anything reads it, so the shape is settled while it
 * is still free to change. It logs, and returns that it accepted the message.
 * ยังไม่ทำอะไร · รับไว้เฉย ๆ ตามที่สั่ง.
 *
 * WHY ITS OWN FOLDER
 *   It is not part of `follow-up/`: that folder decides WHO is stuck, this one
 *   is what happens NEXT. Whatever is eventually built here — a form parser, a
 *   queue, a human hand-off — belongs beside this file, not inside the levels.
 *
 * ⚠️ NEUTRAL BY CONSTRUCTION, like the levels: no Nest injection, no webhook
 * types, no LINE client. It receives plain values and returns a verdict.
 * Anything can call it — a cron, a CLI, a test — and removing it means deleting
 * this folder and one call. ถอดออกได้ทันทีโดยไม่กระทบใคร.
 *
 * revert: delete this folder and its call in webhook.service.
 */
import { resolveInfo } from '../resolve-info';

import { resolveScenario, type ScenarioDeps } from './scenarios';

export interface RegisterHandoffInput {
  /** Which OA the conversation belongs to. */
  hookId: string;
  /** The customer, by their channel id. */
  lineUserId: string;
  /**
   * What the customer wrote. ONE MESSAGE, OR A STRETCH OF HISTORY — this is the
   * only place in the whole hand-off where both shapes are legal, and it is
   * deliberate: the caller sends whatever it happens to have, and nothing
   * downstream is asked to cope with a union.
   * รับได้ทั้งข้อความเดียวและ history · ที่นี่ที่เดียว.
   *
   * ⚠️ Normalised to `string[]` before any scenario sees it — see `toMessages`.
   * Untouched otherwise: nothing is parsed, trimmed or reordered.
   */
  messages: string | string[];
  /** The chat room it happened in. A scenario that opens a case needs it. */
  roomId: string;
  /**
   * Which scenario should take it. THE CALLER CHOOSES — for the webhook that is
   * the moment level 2 fires. An unknown letter is not an error: nothing runs
   * and the flow is left alone, which is the safe direction on a live
   * conversation. ผู้เรียกเป็นคนเลือก · เลือกผิดก็ไม่พัง.
   */
  scenario: string;
}

export type RegisterHandoffDeps = ScenarioDeps;

export interface RegisterHandoffResult {
  /** Did this hand-off take responsibility for the message? */
  accepted: boolean;
  /**
   * Should the caller stop here?
   *
   * Comes from the chosen scenario — either its plain declaration, or computed
   * from what its resolver just read out of the messages. Known the instant the
   * scenario is picked either way: the scenario's own work runs without being
   * waited on, and the caller could not have waited to find out.
   * รู้ทันทีที่เลือก · จะประกาศไว้หรือคิดจากผลที่อ่านได้ก็ตอบทันเหมือนกัน.
   */
  endFlow: boolean;
}

/**
 * Bring either accepted shape down to the one shape scenarios are given.
 *
 * A single string becomes a one-item list; a list is kept in order. Entries that
 * are not usable text — a blank, a stray `null`, a number a caller spread in by
 * accident — are DROPPED rather than coerced or thrown on: this runs beside a
 * live conversation that has already been answered, and one bad entry in an
 * assembled history must not cost the customer their case.
 * ขยะในลิสต์ = ทิ้ง ไม่ใช่พัง · ตัวที่เหลือไม่ถูกแตะเลย.
 */
function toMessages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(
    (m): m is string => typeof m === 'string' && m.trim() !== '',
  );
}

/**
 * Take the message. Do nothing with it yet.
 *
 * Returns `accepted: false` only when it was given nothing usable, so the caller
 * can tell "handled" from "could not be handled" without inspecting anything.
 */
export function handoffToRegister(
  input: RegisterHandoffInput,
  deps: RegisterHandoffDeps,
): RegisterHandoffResult {
  const hookId = String(input?.hookId ?? '');
  const lineUserId = String(input?.lineUserId ?? '');
  if (!hookId || !lineUserId) return { accepted: false, endFlow: false };

  const scenario = resolveScenario(input?.scenario);
  if (!scenario) {
    deps.log(
      `[REGISTER-HANDOFF] no scenario "${String(input?.scenario ?? '')}" — nothing run`,
    );
    return { accepted: false, endFlow: false };
  }

  const messages = toMessages(input?.messages);

  /* [FEAT-20260820-RESOLVEINFO] Read the text BEFORE deciding anything.
     `resolveInfo` is pure and synchronous by contract, so this costs the customer
     nothing measurable and — crucially — the answer exists in this same tick,
     which is what lets a scenario compute `endsFlow` from it instead of only
     declaring it. A scenario with no `resolver` gets `null` and behaves exactly
     as it did before this existed.
     อ่านข้อความก่อนตัดสิน · sync ล้วน ลูกค้าไม่รอ. */
  const resolved = scenario.resolver
    ? resolveInfo(scenario.resolver, { messages })
    : null;

  /* Declared, or computed from what was just resolved. Either way it is known
     now — before the scenario's own work has started, which is never awaited. */
  const endFlow =
    typeof scenario.endsFlow === 'function'
      ? scenario.endsFlow(resolved)
      : scenario.endsFlow;

  /* How many, never what. The numbers and the account the customer typed belong
     in chat history and nowhere else — a log line is read by more people and
     kept for longer. บอกจำนวน ไม่บอกเนื้อความ. */
  deps.log(
    `[REGISTER-HANDOFF] hook=${hookId} user=${lineUserId} scenario=${scenario.name} msgs=${messages.length} resolved=${resolved ? String(resolved.found) : 'none'} endFlow=${String(endFlow)}`,
  );

  /* Run it, and do NOT wait. `void` is the whole point: the customer's message
     has already been answered and stored, and nobody may be kept waiting on work
     that today nothing consumes. A scenario that rejects is swallowed here so a
     failure inside one can never surface on a live conversation.
     ลูกค้าไม่ต้องรอ · scenario ล้มก็เงียบ. */
  void (async () => {
    try {
      await scenario.run(
        {
          hookId,
          lineUserId,
          messages,
          roomId: String(input?.roomId ?? ''),
          resolved,
        },
        deps,
      );
    } catch (err) {
      deps.log(
        `[REGISTER-HANDOFF] scenario ${scenario.name} failed: ${(err as Error)?.message}`,
      );
    }
  })();

  return { accepted: true, endFlow };
}
