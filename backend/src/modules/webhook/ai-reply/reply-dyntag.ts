/**
 * [FEAT-20260813-WRAPAI-W1D] Dynamic-tag substitution — our side, DB-backed.
 *
 * This is the one step W could not keep pure: substituting `[[[tag]]]` markers in
 * the Training Document requires a DB read. It is re-homed here as an ORCHESTRATION
 * of helpers `rag-engine.service.ts` ALREADY EXPORTS — nothing from that file is
 * copied, only imported and sequenced in legacy's exact order. So the assembler
 * stays pure (it receives the substituted string), and `rag-engine.service.ts`
 * is not touched.
 *
 * Sequence transcribed from `askGemini` (`rag-engine.service.ts:1386-1523`):
 *   1. fetch dynamic tags for the hook (`buildDynamicTagQuery` + a lean find)
 *   2. replace the six BASE tags `[[[tag]]]` from the profile installment data
 *   3. resolve each dynamic tag via `pickApiSource` + `computeDynamicTagValue`,
 *      then the un-escaped multi-bracket regex replace
 *   4. AFTER replacing, scan for unknown markers (`findUnknownTagMarkers`)
 *
 * ⚠️ TRANSCRIBED HAZARDS, preserved byte-for-byte (each is live in the DB and
 *    escaping/changing it would silently alter which text is substituted):
 *    · base-tag regex is `\[\[\[ tag \]\]\]` unescaped
 *    · dyntag regex interpolates `dTag.tag` UNESCAPED, with a bare `|${tag}` tail
 *    · `String(value)` replacement (so `$&` etc. keep meaning)
 *    · `resolvedValue = 'N/A'` on a missing source or a compute throw
 *
 * The `dynamicTagModel` and `formatDeps` are injected (the webhook module already
 * has them), so this file needs neither Mongo wiring of its own nor `ai/`.
 *
 * revert: delete this file; the provider (W1d) points substitution back at
 *         askGemini's internal path.
 */

import { Logger } from '@nestjs/common';

// eslint-disable-next-line no-restricted-imports -- same fence rag-doc-retrieval uses
import {
  buildDynamicTagQuery,
  computeDynamicTagValue,
  findUnknownTagMarkers,
  pickApiSource,
  type DynamicTagLike,
  type DynamicTagFormatDeps as AiDynamicTagFormatDeps,
  type WebhookLogSink,
} from '@/modules/ai/rag-engine.service';

import { providerBaseTags } from '@/modules/customer-provider';

import { providerBaseTagValues } from './provider-base-tags';

const logger = new Logger('substituteDynamicTags');

/** `a?.b?.c` over unknown — transcribed (`rag-engine.service.ts:1255`). */
function dig(o: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (cur, k) =>
      typeof cur === 'object' && cur !== null
        ? (cur as Record<string, unknown>)[k]
        : undefined,
    o,
  );
}

/** The lean find the substitution needs — matches `dynamicTagModel.find().lean()`. */
export interface DynamicTagFinder {
  find(query: Record<string, unknown>): {
    lean(): Promise<DynamicTagLike[]>;
  };
}

/**
 * The formatter pair `computeDynamicTagValue` needs — the SAME type ai/ defines
 * (`{ applyFormat?, translate? }`), re-exported so this file's callers pass the
 * exact shape the helper expects, not a loose `Record`. Injected, not built here.
 */
export type DynamicTagFormatDeps = AiDynamicTagFormatDeps;

export interface DyntagInput {
  /** The raw Training Document with markers still in it. */
  suggestionText: string;
  /** Combined external-API result, or null. */
  profileData: Record<string, unknown> | null;
  hookId: string | null;
  hookGroupId: string | null;
  dictOpts: { tool: string | null; scope: string | null };
}

export interface DyntagResult {
  /** The suggestion with every resolvable tag substituted. */
  substitutedSuggestion: string;
  /** True when the tag fetch succeeded — gates the mismatch report. */
  tagsLoaded: boolean;
  /**
   * INBOUND unknown markers — the ones left in the Training Document after
   * substitution (askGemini's first `findUnknownTagMarkers`, :1548). The caller
   * appends the OUTBOUND scan of the model's reply to this before reporting, so
   * the single `reportTagMismatch` sees both, exactly as askGemini does (:1718).
   */
  mismatchedMarkers: string[];
  /**
   * The known tag names fetched from the DB — needed for the caller's OUTBOUND
   * scan of the model reply (askGemini reuses the same `knownTagNames` set at
   * :1718). Empty when the fetch failed or the profile was null.
   */
  knownTagNames: Set<string>;
  /**
   * [FIX-20260901-TAGESCAPE] Run the SAME substitution over a later text — in
   * practice the model's own answer, which can echo a tag the document taught it.
   *
   * Closes over the rows already fetched for this request, so calling it costs no
   * database read and cannot land on a different scope than the document did.
   * Identity when the profile gate never opened (no rows, nothing to substitute).
   *
   * ⚠️ The caller must apply it BEFORE `resolveReplyTags`. That function's
   *    catch-all deletes every `[[…]]` it does not recognise, and a tag arriving
   *    after it is not recoverable — that deletion is what took a deposit amount
   *    out of a customer's message on 01/09. ต้องแทนก่อนตัวกวาดเสมอ
   */
  substituteEscapedTags: (text: string) => string;
}

/**
 * Substitute all tags in a Training Document. A DB read, kept out of the pure
 * assembler. Never throws — a fetch failure degrades to "no tags loaded", exactly
 * as askGemini does.
 */
export async function substituteDynamicTags(
  input: DyntagInput,
  model: DynamicTagFinder,
  formatDeps: DynamicTagFormatDeps,
  /**
   * The operation-log sink — the SAME `webhookLogSink` askGemini used inline
   * (`:1510`). Optional so a pure unit test can omit it; when present, a tag
   * COMPUTE error writes the `dynamic_tag_calculation_error` row exactly as
   * askGemini did. Dropping this was divergence D2 — the row silently stopped
   * being written. logSink ต้องส่งเข้ามาเพื่อให้ log row เขียนเหมือนเดิม.
   */
  logSink?: WebhookLogSink | null,
): Promise<DyntagResult> {
  const { profileData: profileIn, hookId, hookGroupId, dictOpts } = input;
  let finalSuggestionText = input.suggestionText;
  const knownTagNames = new Set<string>();
  const mismatchedMarkers: string[] = [];
  let tagsLoaded = false;

  /* [FIX-20260901-TAGESCAPE] IDENTITY by default, and that default is the whole
     safety argument. When the profile gate below does not open, no tag was ever
     fetched, so there is nothing to substitute and the caller's text must come
     back untouched — exactly as it does today. The function only becomes real
     inside the gate, alongside the rows it closes over. ไม่มีข้อมูล = ไม่แตะข้อความ */
  let substituteEscapedTags: (text: string) => string = (text) => text;

  // ⚠️ TRANSCRIBED GATE (askGemini:1414 `if (profileData) {`). The ENTIRE dyntag
  //    block — fetch, base-tag replace, dynamic resolve, mismatch scan — runs
  //    ONLY when profileData is truthy. With no profile (null), legacy touches
  //    NOTHING: the suggestion is returned with its markers intact, tagsLoaded
  //    stays false, and no base tag is blanked. Dropping this gate would fetch
  //    tags and blank base markers on a null profile — a silent divergence the
  //    W1d spec did not exercise (every fixture passed a non-null profile).
  //    profileData ต้อง truthy ทั้งบล็อกถึงจะทำงาน — ตรงกับ legacy เป๊ะ.
  if (profileIn) {
    const profileData = profileIn;

    // 1) FETCH DYNAMIC TAGS FROM DATABASE
    let dynamicTags: DynamicTagLike[] = [];
    const query = buildDynamicTagQuery(hookId, hookGroupId);
    try {
      dynamicTags = await model.find(query).lean();
      dynamicTags.forEach((t) => t?.tag && knownTagNames.add(t.tag));
      tagsLoaded = true;
    } catch (tagErr) {
      // fetch failed → no tags loaded; the mismatch scan below is gated on this,
      // so a failed fetch never produces a false "unknown marker" report.
      // ⚠️ TRANSCRIBED (askGemini:1430): the error line is still logged (D1).
      logger.error(
        `[DYNAMIC TAG] Fetch error: ${String(dig(tagErr, 'message'))}`,
      );
    }

    // 2) BASE TAGS from the profile installment data (transcribed :1428-1459)
    const profile = profileData['Path : api/v1/customer'];
    const installment =
      profileData['Path : api/line/v1/installment_current.php'];
    const instCalc = dig(installment, 'data', 'installment');
    const totalTerms = Number(dig(instCalc, 'Total_terms')) || 0;
    const currentTerm = Number(dig(instCalc, 'current_term')) || 0;
    const remainTerms = Math.max(0, totalTerms - currentTerm);

    const baseReplacements: Record<string, unknown> = {
      total_due_amount:
        dig(profile, 'data', 'installment', 'total_due_amount') ?? '',
      ins_due_date:
        dig(profile, 'data', 'installment', 'due_date') ||
        dig(instCalc, 'due_date') ||
        '',
      Total_terms_remain: remainTerms.toString(),
      ins_number: dig(instCalc, 'number') || '',
      due_date:
        dig(profile, 'data', 'installment', 'due_date') ||
        dig(instCalc, 'due_date') ||
        '',
      ins_current_amount: dig(instCalc, 'current_amount') ?? '',
      /* [FEAT-20261014-BASETAGS] the active provider's own reading wins where it finds a
         value (loan_v1: providers/loan-v1/base-tags.ts) · none declared = legacy exactly */
      ...providerBaseTagValues(profileData, providerBaseTags()),
    };
    for (const [key, value] of Object.entries(baseReplacements)) {
      const regex = new RegExp(`\\[\\[\\[\\s*${key}\\s*\\]\\]\\]`, 'g');
      finalSuggestionText = finalSuggestionText.replace(regex, String(value));
    }

    /* [FIX-20260901-TAGESCAPE] The resolution below was an inline loop over the
     * Training Document. It is now a REUSABLE pass, because the same work has to
     * happen a second time on the model's ANSWER.
     *
     * WHY. Measured 01/09 with the real collection (801 tags, `tagsLoaded=true`):
     * a tag the model echoes into its own reply reaches `resolveReplyTags`, whose
     * catch-all DELETES every `[[…]]` — the customer read `ฝากขั้นต่ำ ␣ บาท` with
     * the number simply gone. The document pass had already succeeded; the fetch
     * was never the problem. An earlier plan retracted this fix on the theory that
     * a second pass "would hit the same fetch and the same gate" — it does not,
     * because it does not fetch at all: it reuses `dynamicTags`, already in hand.
     *
     * ⚠️ MEMOISED on purpose. A tag present in BOTH the document and the answer
     *    must compute ONCE, or a broken formula writes two
     *    `dynamic_tag_calculation_error` rows for one reply and the operational
     *    trail starts double-counting. The cache also makes the second pass free.
     *
     * ⚠️ The document pass below is byte-identical to the loop it replaces: same
     *    order, same `.includes` guard against the progressively-substituted text,
     *    same regex, same `N/A` fallback. Only the SHAPE changed. */
    const resolvedCache = new Map<string, string>();

    const resolveTagValue = (dTag: DynamicTagLike): string => {
      const cached = resolvedCache.get(dTag.tag);
      if (cached !== undefined) return cached;

      const apiSource = pickApiSource(profileData, dTag);
      let resolvedValue = 'N/A';
      if (apiSource && dTag.value) {
        try {
          resolvedValue = computeDynamicTagValue(
            apiSource,
            dTag,
            dictOpts,
            formatDeps,
          );
        } catch (calcErr) {
          // ⚠️ TRANSCRIBED (askGemini:1497-1528) — the compute-error side-effects
          //    dropped in the first W1d cut were divergence D2. resolvedValue is
          //    still 'N/A' (no reply-text change), but the operational trail must
          //    survive: log the line AND write the ONE `dynamic_tag_calculation_
          //    error` row so a broken tag FORMULA is still traceable. logSink is
          //    the same bound sink askGemini used (via the provider's dyntagDeps).
          const msg = String(dig(calcErr, 'message'));
          logger.error(
            `[DYNAMIC TAG ERROR] Tag: ${dTag.tag}, Formula: ${dTag.value}, Error: ${msg}`,
          );
          resolvedValue = 'N/A';

          void logSink
            ?.createLog({
              channel: 'log_operation',
              action_type: 'dynamic_tag_calculation_error',
              status: 'error',
              error_message: msg,
              raw_request: {
                tag: dTag.tag,
                formula: dTag.value,
                sub_type: dTag.sub_type,
              },
              reference_id: dTag.tag,
            })
            .catch((lErr: unknown) =>
              logger.error(
                `Failed to create operation log: ${String(dig(lErr, 'message'))}`,
              ),
            );
        }
      }

      resolvedCache.set(dTag.tag, String(resolvedValue));
      return String(resolvedValue);
    };

    /**
     * Replace every dynamic tag this hook can see, in one text.
     *
     * ⚠️ UNESCAPED interpolation + bare `|${tag}` tail — transcribed hazard, kept
     *    byte-for-byte. The trailing alternative matches the BARE tag name with no
     *    brackets at all, which is why a model that writes `odk_s_00001` in prose
     *    is also covered.
     */
    const applyDynamicTags = (text: string): string => {
      let out = text;
      for (const dTag of dynamicTags) {
        if (!out.includes(dTag.tag)) continue;
        const dRegex = new RegExp(
          `(?:\\{\\{|\\[\\[\\[|\\[\\[)\\s*${dTag.tag}\\s*(?:\\}\\}|\\]\\]\\]|\\]\\])|${dTag.tag}`,
          'g',
        );
        out = out.replace(dRegex, resolveTagValue(dTag));
      }
      return out;
    };

    // 3) RESOLVE DYNAMIC TAGS in the Training Document (transcribed :1462-1546)
    finalSuggestionText = applyDynamicTags(finalSuggestionText);

    /* [FIX-20260901-TAGESCAPE] Handed to the caller so the model's ANSWER can be
       put through the identical pass, with no second fetch and no second gate.
       The provider applies it before the reply travels on to `resolveReplyTags`,
       which is the shape `[[link]]` has always used: SUBSTITUTE before the
       catch-all, never exempt from it. ⇒ ป้ายที่หลุดออกมาต้องถูกแทนค่า ไม่ใช่ถูกลบ */
    substituteEscapedTags = applyDynamicTags;

    // 4) mismatch scan — AFTER replace, so resolved tags are already gone (:1548).
    //    Inside the profileData gate, exactly as legacy: no profile = no scan.
    mismatchedMarkers.push(
      ...findUnknownTagMarkers(finalSuggestionText, knownTagNames),
    );
  }

  return {
    substitutedSuggestion: finalSuggestionText,
    tagsLoaded,
    mismatchedMarkers,
    knownTagNames,
    // [FIX-20260901-TAGESCAPE]
    substituteEscapedTags,
  };
}
