/**
 * What a resolver is, and what it answers with. Types only — imports nothing.
 * ===========================================================================
 * `resolveInfo` reads what a customer WROTE and answers what it managed to pull
 * out of it. It is deliberately NOT part of `register/`: registration is only
 * today's caller. A cron cleaning old rows, a CLI, an admin tool re-reading a
 * transcript — anything with text can call it and nothing about it knows LINE,
 * Nest, Mongo or the webhook. เป็นกลาง · ใครเรียกก็ได้.
 *
 * ⚠️ ONE SHAPE FOR EVERY RESOLVER, on purpose. `basic register` today and
 * `dynamic register` later must answer with the same object, or every consumer
 * grows a branch per resolver and the registry stops being a registry.
 * ทุกตัวตอบหน้าตาเดียวกัน ไม่งั้นคนเรียกต้องแยกเคสเอง.
 *
 * revert: delete this folder and the `resolver` field in `scenario.types.ts`.
 */

/** One reading of the numbers found in the text. */
export interface ResolvedPair {
  /** The digits judged to be a phone number, separators already stripped. */
  phone: string | null;
  /** The digits judged to be a bank account, separators already stripped. */
  account: string | null;
}

/**
 * What every resolver returns. The owner calls this "Basicdata".
 *
 * ⚠️ WHY `candidates` IS A LIST AND NOT ONE ANSWER
 *   Both real messages the owner supplied hold TWO ten-digit runs, and only the
 *   leading `0` says which is the phone. When even that does not decide, the
 *   resolver cannot know — so it answers with both readings instead of guessing
 *   and hiding the guess. `[0]` is its best reading; `[1]` is the same two values
 *   swapped, which is exactly the mistake `[0]` would make if it were wrong.
 *   A consumer that finds `[0]` wrong has `[1]` already sitting there.
 *   สลับไว้ให้เลย · เดาผิดเมื่อไหร่ ตัวที่ถูกอยู่ช่องถัดไปแล้ว.
 */
export interface ResolvedInfo {
  /** Which resolver produced this, by its registry key. */
  by: string;
  /**
   * BOTH a phone and an account were pulled out. Anything less is `false` —
   * one of the two, or neither, is not enough. ต้องครบสองอย่างเท่านั้น.
   */
  found: boolean;
  /** `[0]` the best reading · `[1]` the same values swapped. Always length 2. */
  candidates: ResolvedPair[];
}

/** What a resolver is handed: the same list of messages a scenario receives. */
export interface ResolveInfoInput {
  /** One message is a list of one. Order is the order they were written in. */
  messages: string[];
}

/** A named way of resolving info out of text. The registry holds these. */
export interface InfoResolver {
  /** The key the registry files it under, and callers select by. */
  name: string;
  /** One line on what it does, for whoever reads the registry. */
  what: string;
  /**
   * Do the reading. MUST BE SYNCHRONOUS AND PURE — no network, no database, no
   * model. That is not a style preference: the caller decides whether to end a
   * live webhook flow from this answer, so it has to be available in the same
   * tick the customer's message arrives. A resolver that needs to await
   * something does not belong in this registry.
   * ต้อง sync และบริสุทธิ์ · เพราะคนเรียกใช้ผลตัดสิน flow ทันที.
   */
  resolve(input: ResolveInfoInput): ResolvedInfo;
}
