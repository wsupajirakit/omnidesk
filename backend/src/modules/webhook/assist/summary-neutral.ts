/**
 * [FEAT-20260813-WRAPAI-W2] Neutral types for the assist-summary funnel — the
 * vendor-free contract between the summary transport and the summary interpreter.
 *
 * This mirrors `reply-neutral.ts` for the summary path. Nothing here names a
 * vendor: a `SummaryCall` is what ANY summariser needs (the three conversation
 * strings + the key), and a `SummaryTransportResult` is what ANY summariser hands
 * back (the raw model text + an http status, or an error). The interpreter turns
 * the raw text into `{summary, category}`; the transport never does — so a second
 * vendor (DeepSeek) plugs in as one transport, no parse logic copied.
 *
 * Why a summary path needs its OWN neutral types (not the reply ones): the
 * summary wire is a DIFFERENT shape — `/v1/` not `/v1beta/`, a single prompt part
 * with the three strings interpolated, hardcoded knobs, no dyntag/blocks/thinking.
 * Sharing the reply types would force summary-shaped data through reply-shaped
 * fields. summary กับ reply คนละ wire — type แยกกันชัด ไม่ปนกัน.
 *
 * revert: delete this file; the summary transport/interpreter that import it go
 *         with it, and the provider points back at analyzeConversationForAdmin.
 */

/**
 * Everything a summariser needs for one turn — the named form of
 * `analyzeConversationForAdmin`'s four positional arguments. Vendor-free: a
 * transport reads these and builds its own wire body.
 */
export interface SummaryCall {
  /** Formatted prior turns, oldest first (may be empty). Legacy `history`. */
  history: string | null | undefined;
  /** The customer message that triggered the hand-off. Legacy `currentQuestion`. */
  currentQuestion: string;
  /** The bot's answer, marker already stripped. Legacy `currentAnswer`. */
  currentAnswer: string;
  /** The resolved key the transport fires with (never empty — the provider throws first). */
  apiKey: string;

  /**
   * [P2-20260813] The model this hook asks for, or `null` for the vendor's
   * family default. Same contract as the reply path: the caller never guesses a
   * default, because the right one depends on which vendor receives the call.
   */
  modelId?: string | null;
  /**
   * [FEAT-20260909-DSREASONING] The OA's reasoning choice for the MAIN lane.
   *
   * Owner, 09/09: *"summary ใช้แบบเดียวกับบอทหลัก"* — the summary does not get a
   * setting of its own. It reads the SAME columns the reply path reads, so an
   * admin sets one thing and both behave alike. That is why this field is
   * threaded from the same credentials bundle rather than resolved again here.
   *
   * 🔴 NO VENDOR IS NAMED — a neutral call describes a capability, and a
   *    transport with no equivalent simply does not read the field. The reply
   *    lane's twin of this field was first named after a vendor and a spec that
   *    reads these files went red immediately.
   *
   * ⚠️ ABSENT/NULL ⇒ the transport attaches nothing and the body is the object
   *    it has always been.
   */
  reasoning?: {
    type: 'enabled' | 'disabled';
    effort?: 'low' | 'high' | 'max';
  } | null;
}

/**
 * What a summary transport hands back — raw text plus status, NEVER a parsed
 * `{summary, category}`. The interpreter owns the JSON extraction and the three
 * fallback strings, so every vendor's raw text feeds the same interpretation and
 * cannot drift.
 */
export interface SummaryTransportResult {
  /**
   * The model's raw reply text (`readGeminiText(...) || ''` in legacy), or
   * `undefined` when the call errored before any text came back.
   */
  rawText: string | undefined;
  /** The vendor http status, or 0 for a transport/thrown error. */
  httpStatus: number;
  /** The raw provider payload, for logs. */
  raw: unknown;
  /**
   * Non-null when the vendor call failed (the outer-catch case in legacy). The
   * interpreter maps this to the DISTINCT "เกิดข้อผิดพลาด…" outage string, kept
   * separate from the parse fallbacks.
   */
  errorMessage: string | null;
}
