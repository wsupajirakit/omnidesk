/**
 * [FEAT-20260907-AIVENDORCORE] The one shape that goes in, and the one that comes out.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ===========================================================================
 * Six transports across three modules each built their own request and read
 * their own response. The responses were ALREADY identical — four files
 * declared the same `candidates[0].content.parts[0].text` walk, character for
 * character, with no variation at all. The requests differed in exactly four
 * ways, and every one of them was an ABSENCE rather than a different shape:
 * three paths send no system instruction, three send no thinking config, one
 * sends an image part, and the knobs differ in value only.
 *
 * That is why this is one contract and not a union of three, and why it needs
 * no `mode` discriminator. A `mode` would put "am I replying or translating"
 * in the same place as "which vendor", and every future caller would widen it.
 *
 * 🔴 ABSENT MEANS NOT SENT — NOT "SENT AS A DEFAULT".
 *    If a caller omits `systemInstruction`, the key does not appear in the JSON
 *    at all, so a summary body stays byte-identical to the one it produced
 *    before this layer existed. A default would silently change three working
 *    paths, which is the exact failure this extraction exists to avoid.
 *    `z-test/unit/ai-vendor-wire-baseline.spec.ts` asserts the absence, not the
 *    intention.
 *
 * ⚠️ WHAT THIS DOOR DOES NOT ACCEPT, each for its own reason:
 *    · prompt text — the assemblers stay with their features; the door takes
 *      finished parts
 *    · an API key to resolve — the caller passes a decrypted string, which is
 *      what lets this module import nothing and stay reachable from everywhere
 *    · a thinking policy — `thinking-config.ts` decides and the caller passes
 *      the result through `generationExtra`, so the file that fixed a real 400
 *      stays the single decider
 *    · a call cap — the cap wraps a provider, a layer above this one
 */

/** A single content part: text, or an inline image. Gemini's own union. */
export interface VendorPart {
  readonly text?: string;
  readonly inlineData?: { readonly mimeType: string; readonly data: string };
}

/** The determinism knobs. Every caller sends all three; only the values differ. */
export interface VendorKnobs {
  readonly temperature: number;
  readonly topP: number;
  readonly topK: number;
}

export interface VendorCall {
  /** Already resolved by the caller — the door never defaults a model. */
  readonly model: string;
  /** Decrypted. The door places it where the vendor wants it, and nowhere else. */
  readonly apiKey: string;
  readonly parts: readonly VendorPart[];
  readonly knobs: VendorKnobs;
  /** Absent ⇒ the key is not written into the body. */
  readonly systemInstruction?: string;
  /**
   * Extra `generationConfig` entries, attached verbatim. Today this carries
   * exactly one thing — the output of `resolveThinkingConfig` — and it is passed
   * through rather than interpreted so the door holds no opinion about models.
   */
  readonly generationExtra?: Readonly<Record<string, unknown>>;
}

/**
 * What every caller needs, and nothing else.
 *
 * ⚠️ `ok` is not `status === 200`. A vendor can answer 200 with no candidate at
 *    all, which every existing transport already treats as "no text" rather than
 *    as success. Callers map this into their own result type.
 */
export interface VendorResult {
  readonly ok: boolean;
  /** `undefined` when the vendor answered but produced no text. */
  readonly text: string | undefined;
  /** 0 when the request never reached a response. */
  readonly httpStatus: number;
  /** The parsed body, for callers that log or audit it. */
  readonly raw: unknown;
  readonly errorMessage: string | null;
}
