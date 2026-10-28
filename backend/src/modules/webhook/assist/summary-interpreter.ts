/**
 * [FEAT-20260813-WRAPAI-W2] SummaryInterpreter — our side, vendor-blind. Mirrors
 * `reply-interpreter.ts` for the summary path.
 *
 * Takes a `SummaryTransportResult` (raw text + status, from ANY vendor) and turns
 * it into the `{summary, category}` the assist flow expects. This is the SHARED
 * half of the summary response path: it only ever sees `rawText`, never a vendor
 * shape, so every vendor's raw text feeds the SAME JSON extraction and the SAME
 * fallback strings. A DeepSeek reply that also answers as JSON reuses this
 * unchanged — no parse logic copied per vendor. parse อยู่ที่เดียว ใช้ได้ทุก vendor.
 *
 * Transcribes, byte-for-byte, the PARSE + FALLBACK half of
 * `analyzeConversationForAdmin` (`rag-engine.service.ts:1836-1873`):
 *   · rawText = the model text, `|| ''` (an errored call → the outer-catch string)
 *   · extract: first `{` .. last `}` (tolerates a ```json fence), then JSON.parse
 *   · happy path: `{ summary: parsed.summary || 'ไม่สามารถสรุปข้อมูลได้',
 *                     category: parsed.category || 'Other' }`
 *   · parse-fail / no-braces: `{ summary: rawText || 'ไม่สามารถวิเคราะห์ข้อมูล
 *                     ได้ในขณะนี้', category: 'Other' }`
 *   · vendor error (outer catch): `{ summary: 'เกิดข้อผิดพลาดในการวิเคราะห์บท
 *                     สนทนา', category: 'Other' }`
 *
 * ⚠️ THREE DISTINCT THAI STRINGS + raw passthrough — legacy's header (`:1781`)
 *    says "a caller distinguishes them only by the wording, so none may be
 *    merged." They are kept separate here for the same reason. ห้าม merge.
 *
 * ⚠️ CATEGORY is always 'Other' on every non-happy path; only a parsed object
 *    can carry Collection/IT/a model value.
 */
import type { SummaryTransportResult } from './summary-neutral';

/** The three fallback strings — kept as named constants so none is accidentally merged. */
export const SUMMARY_NO_SUMMARY_FIELD = 'ไม่สามารถสรุปข้อมูลได้';
export const SUMMARY_PARSE_FALLBACK = 'ไม่สามารถวิเคราะห์ข้อมูลได้ในขณะนี้';
export const SUMMARY_ERROR_FALLBACK = 'เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา';

export interface SummaryResult {
  summary: string;
  category: string;
}

/**
 * A minimal error-logger — just `.error(msg)`. Passed in (not imported) so the
 * interpreter stays a pure function by default and only logs when a caller wants
 * it to, exactly as the reply-path dyntag takes an optional logSink.
 */
export interface SummaryErrorLogger {
  error(message: string): void;
}

/**
 * Interpret a summary transport result into `{summary, category}`.
 *
 * @param result vendor-free — the interpreter never learns which vendor produced it.
 * @param logger  optional — when present, reproduces legacy's JSON-parse-error log
 *                (analyzeConversationForAdmin:1855). Omit for a pure call.
 */
export function interpretSummary(
  result: SummaryTransportResult,
  logger?: SummaryErrorLogger,
): SummaryResult {
  // ── vendor error → the outer-catch string (analyzeConversationForAdmin:1869) ─
  // A transport reports an error as a non-null errorMessage with rawText
  // undefined; legacy's outer catch returns this fixed literal regardless of
  // what (if anything) came back. Kept DISTINCT from the parse fallback below.
  if (result.errorMessage !== null && result.rawText === undefined) {
    return { summary: SUMMARY_ERROR_FALLBACK, category: 'Other' };
  }

  // ── success path (:1836-1864), byte-for-byte ───────────────────────────────
  // legacy: `readGeminiText(res.data) || ''` — an empty/absent text becomes '',
  // which has no braces and falls straight through to the parse fallback.
  const rawText = result.rawText || '';

  // extract: first `{` .. last `}` — how legacy tolerates a ```json fence (:1840).
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try {
      const jsonStr = rawText.substring(start, end + 1);
      const parsed = JSON.parse(jsonStr) as {
        summary?: string;
        category?: string;
      };
      return {
        summary: parsed.summary || SUMMARY_NO_SUMMARY_FIELD,
        category: parsed.category || 'Other',
      };
    } catch (parseErr) {
      // parse threw — fall through to the SAME fallback as the no-braces case,
      // exactly as legacy (:1854 logs then falls to :1861).
      // ⚠️ TRANSCRIBED side-effect (analyzeConversationForAdmin:1855-1857): the
      //    "AI Analysis JSON parse error" log, with the message AND the raw text.
      //    Dropping it was divergence D1 — a malformed model reply went silent.
      //    Logged only when a logger is supplied (kept pure otherwise).
      const msg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      logger?.error(`AI Analysis JSON parse error: ${msg} Raw: ${rawText}`);
    }
  }

  // parse-fail / no-braces fallback (:1861): raw text if non-empty, else the string.
  return { summary: rawText || SUMMARY_PARSE_FALLBACK, category: 'Other' };
}
