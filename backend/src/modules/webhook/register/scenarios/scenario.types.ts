/**
 * What a register scenario is. Types and nothing else — imports nothing.
 * ===========================================================================
 * Level 2 hands every message from a marked customer to ONE scenario, and the
 * webhook chooses which. Scenarios are independent of each other by design: each
 * lives in its own file, none imports another, and adding or retiring one is a
 * line in the registry. เพิ่ม/ถอด scenario ได้ทีละตัว ไม่กระทบตัวอื่น.
 *
 * ⚠️ WHY `endsFlow` IS DECLARED AND NOT RETURNED
 *   The work runs fire-and-forget — the customer must never wait on it — so by
 *   the time a scenario could compute an answer, the webhook has already had to
 *   decide whether to carry on. Declaring it makes the decision readable the
 *   instant the scenario is chosen, and keeps "does the bot stay silent" a
 *   property of the scenario rather than a race.
 *   A scenario may also compute it from what its resolver found — see
 *   `endsFlow` below. That stays inside the same tick, so nothing is awaited and
 *   the property above still holds. Scenario A does exactly this.
 *   ประกาศไว้ อ่านได้ทันที · ไม่ต้องรอผล.
 *
 * revert: delete this folder; `register.helper.ts` falls back to doing nothing.
 */

/**
 * What a resolver answered, as this file sees it.
 *
 * ⚠️ DECLARED STRUCTURALLY, NOT IMPORTED. A test asserts this file imports
 * nothing at all, and that is the property that keeps scenarios free of every
 * neighbour. It matches `ResolvedInfo` from `resolve-info/` by shape; the helper
 * that fills it in is the one that owns the real import.
 * ประกาศตามรูปร่าง ไม่ import · ไฟล์นี้ต้องไม่พึ่งใครเลย.
 */
export interface ScenarioResolved {
  by: string;
  found: boolean;
  candidates: Array<{ phone: string | null; account: string | null }>;
}

/** Everything a scenario is given. The same three values level 2 sends. */
export interface ScenarioInput {
  hookId: string;
  lineUserId: string;
  /**
   * What the customer wrote, ALWAYS AS A LIST — one message is a list of one.
   *
   * The hand-off's door accepts either a single string or a stretch of history
   * and normalises here, so a scenario written next year has exactly one shape
   * to handle and cannot forget the other. Untouched otherwise: not parsed, not
   * trimmed, not reordered — blanks and non-strings were dropped at the door.
   * ข้างในเป็น array เสมอ · คนเขียน scenario ใหม่ไม่มีอะไรให้พลาด.
   */
  messages: string[];
  /**
   * The chat room this happened in. A scenario that opens a case needs it
   * (the room decides member and hook); one that does not can ignore it.
   */
  roomId: string;
  /**
   * What this scenario's declared `resolver` pulled out of `messages`, or `null`
   * when the scenario declared none — or when the resolver could not be found or
   * failed. Already computed before the scenario runs, so a scenario never has
   * to call a resolver itself and two scenarios cannot resolve the same text
   * twice. หาให้เสร็จก่อนแล้ว · scenario ไม่ต้องเรียกเอง.
   */
  resolved: ScenarioResolved | null;
}

/**
 * What a scenario may use. Everything is optional: a scenario that needs none of
 * it must still run, and a caller that cannot supply a model must not break one.
 */
export interface ScenarioDeps {
  log: (msg: string) => void;
  /**
   * Open a case for a room, owned by nobody. Handed in as a plain function so
   * this folder still knows no database and no Nest.
   *
   * OPTIONAL like everything else here: a caller that cannot open cases simply
   * makes any scenario needing one do nothing.
   */
  openCase?: (input: {
    roomId: string;
    category: string;
    needDetail: string;
    dividerContent: string;
  }) => Promise<{ ticketId: string; roomId: string }>;
  /**
   * [FEAT-20260820-REQUESTREG] Record that this customer was asked to register.
   *
   * Handed in as a plain function for the same reason as `openCase`: this folder
   * knows no database. Writing is FIRST-WRITER-WINS on the caller's side, so a
   * customer asked twice keeps the first date.
   *
   * OPTIONAL like everything else here — a caller that cannot record simply
   * makes the scenario skip it, and the case is still opened.
   * บันทึกไม่ได้ก็ยังเปิดเคสตามปกติ.
   */
  markRequested?: () => Promise<unknown>;
  generate?: (request: {
    question: string;
    docText: string;
    suggestionText: string;
    profileData: Record<string, unknown> | null;
  }) => Promise<{ text?: string | null } | null | undefined>;
}

export interface RegisterScenario {
  /** The letter the webhook selects by. */
  name: string;
  /** One line on what it does, for whoever reads the registry. */
  what: string;
  /**
   * Which `resolveInfo` function should read the messages BEFORE anything is
   * decided, by its registry key (`'basic'` today). Omit it and `resolved`
   * arrives as `null` — which is what every scenario that does not care about
   * the text should do. เลือกตัวอ่านข้อความที่นี่ · ไม่ใส่ = ไม่อ่าน.
   */
  resolver?: string;
  /**
   * Does the webhook stop after handing over?
   *
   * A plain `true`/`false` is an answer this scenario always gives. A FUNCTION is
   * an answer computed from what the resolver found — which is how the owner
   * asked scenario A to behave: "ถ้าเจอ true = endflow webhook · ถ้าเจอ false ไม่ end
   * flow web hook".
   *
   * ⚠️ Either way the answer is available in the SAME TICK the message arrives.
   * That is why a resolver must be synchronous and pure (see `InfoResolver`):
   * the real work still runs fire-and-forget and is never waited on, so a
   * decision that needed to await something could not be made in time.
   * คิดจากผลได้ · แต่ยังตอบทันทีในจังหวะเดียวกัน ลูกค้าไม่รอ.
   */
  endsFlow: boolean | ((resolved: ScenarioResolved | null) => boolean);
  /**
   * Do the work. Never throws — a scenario that fails must not disturb a
   * conversation that has already been answered. Fired without being awaited.
   */
  run(input: ScenarioInput, deps: ScenarioDeps): Promise<void> | void;
}
