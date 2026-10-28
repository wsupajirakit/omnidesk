/**
 * [FEAT-20260918-AUTOTRANS] The plug, and the only thing the storage path knows.
 * =============================================================================
 * `chat-history.service.ts` is the funnel every message row goes through — LINE
 * and every other channel, inbound and outbound. Auto-translation had to hang
 * off it without becoming part of it, so what the funnel holds is THIS
 * interface: one method, optional, injected.
 *
 * ## Why an optional port rather than a call into the translate service
 *
 * - **It can be absent.** Nothing provided ⇒ the funnel makes zero extra calls
 *   and behaves exactly as it did before the feature existed. That is what
 *   makes the feature removable ("ไม่ใช้ก็ได้") in the literal sense, not the
 *   "it is there but switched off" sense.
 * - **It keeps the parity net intact.** `chat-history-parity.spec.ts` drives
 *   this service through fake models and diffs every model call against the
 *   legacy JavaScript. A translator wired in as a hard dependency would show up
 *   in that diff; an absent optional one cannot.
 * - **It does not drag the chat module into the vendor stack.** The funnel
 *   depends on a two-field interface, not on `ChatTranslateService`, its config,
 *   its cap ledger or its credentials.
 *
 * ## The contract, in one line: this must never throw and never block
 *
 * Implementations are called with `void` from inside the storage path. A
 * translation that fails — vendor down, cap reached, no key on the OA, a
 * timeout, anything at all — must leave the message exactly as it was stored:
 * the original text, no translation entry, no error surfaced to the customer or
 * the operator. แปลไม่สำเร็จด้วยเหตุผลใดก็ตาม = เก็บแบบเดิม ไม่งง ไม่พัง
 */

export interface AutoTranslateInboundInput {
  /** The row that was just written. */
  messageId: string;
  roomId: string;
  hookId: string | null;
  /** What the customer wrote, already trimmed by the caller. */
  text: string;
  senderType: string;
  messageType: string;
}

export interface AutoTranslateInboundPort {
  /**
   * Fire-and-forget. Resolves either way; never rejects.
   * @returns the language it translated into, or `null` when it did nothing.
   */
  onInboundMessage(input: AutoTranslateInboundInput): Promise<string | null>;
}

/** DI token — a string token because the port is an interface, not a class. */
export const AUTO_TRANSLATE_INBOUND = 'AUTO_TRANSLATE_INBOUND';
