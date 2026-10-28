/**
 * [PROG-20260905-DOCFETCH] Fetch the document context for the prompt — or answer empty.
 *
 * WHY IT MOVED, and it is a placement argument rather than a size one. `doc-retrieval/`
 * already holds the seam (`doc-retrieval.provider.ts`); what stayed in the spine was the
 * DECISION to use it — two nested conditions, a try/catch and two log lines — sitting a
 * thousand lines from the code it is about. The gate order does not depend on it: this block
 * computes a value for the prompt and takes no branch anyone else can see.
 *
 * [FEAT-20261026-RAGENGINE] THE SOURCE IS NOW THE TRAINING DOC (owner, 26/10). The seam is bound
 * to the RAG engine (`@/modules/rag`), which retrieves from the Training Doc boxes the prompt
 * already carries — so a `doc_id` is no longer required. `IGNORE_DOC_ID` belonged to the retired
 * Google-Doc lane and only keeps its old effect on the "flag is off" log line below; the engine
 * has its own fleet-wide switch in code (`rag/rag.config.ts` `engineEnabled`).
 * แหล่งเอกสาร = Training Doc ในฟอร์ม · ไม่ต้องมี doc_id แล้ว
 *
 * ⚠️ THE DEFAULT PATH MUST STAY UNTOUCHED. Retrieval is off unless the OA sets
 * `doc_retrieval: true`, and off means no seam call, no extra model call, no extra spend,
 * empty context exactly as before this feature existed. `doc-retrieval-baseline.spec.ts` pins
 * that and must keep passing without edits.
 *
 * ⚠️⚠️ THE CATCH IS NOT BELT-AND-BRACES. The engine already answers empty on every failure
 * and never throws — but this catch is what makes the guarantee true for ANY provider bound to
 * the seam, including a future one that throws. Without it a rejected retrieval escapes into
 * the outer webhook catch, the reply block never runs, and **the customer gets nothing**.
 * เส้นเอกสารพังได้ ลูกค้าต้องยังได้คำตอบเสมอ
 */
import type { DocContext } from './doc-retrieval.provider';

type Doc = Record<string, unknown>;

const NO_CONTEXT: DocContext = Object.freeze({
  docText: '',
  suggestionOverride: null,
});

export interface FetchRelatedTextInput {
  hook: Doc | null | undefined;
  /** Legacy Google-Doc id — passed through for adapters that still read it; no longer a gate. */
  docId: string | null | undefined;
  /** The customer's question, as the prompt will use it. */
  question: string | null | undefined;
  /**
   * [P2] GEMINI's key, by name — this value goes into a Google URL downstream, so the
   * vendor-resolved key must never arrive here.
   */
  geminiOnlyKey: string | null | undefined;
  /** `IGNORE_DOC_ID` — now only silences the "flag is off" log, as it always did. */
  ignoreDocId: string | null | undefined;
  /** [FEAT-20261026-RAGENGINE] for the engine: its index key and the text it retrieves from. */
  hookId?: string | null;
  sections?: readonly { start: string; end: string; text: string }[];
}

export interface FetchRelatedTextDeps {
  /** [FEAT-20261026-RAGENGINE] the plain passage, or a `DocContext` (RAG engine). */
  retrieve: (args: Doc) => Promise<string | DocContext>;
  log: (message: string) => void;
  warn: (message: string) => void;
  /** The caller's own formatter, so the warn line stays byte-identical. */
  errText: (err: unknown) => string;
}

export async function fetchDocContext(
  input: FetchRelatedTextInput,
  deps: FetchRelatedTextDeps,
): Promise<DocContext> {
  const { hook, docId } = input;

  if (hook?.['doc_retrieval'] !== true) {
    if (docId && input.ignoreDocId !== '1') {
      deps.log(
        `[DOC] doc_id=${docId} is set but doc_retrieval is off for this OA ` +
          `— proceeding with empty context, as before`,
      );
    }
    return NO_CONTEXT;
  }

  const args: Doc = {
    question: input.question,
    docId,
    fastMode: hook?.['fast_mode'],
    // [P2] Gemini-only: this key goes into a Google URL downstream.
    apiKey: input.geminiOnlyKey ?? null,
    temperature: hook?.['gemini_temperature'],
    topK: hook?.['gemini_top_k'],
    topP: hook?.['gemini_top_p'],
    /* [FEAT-20260826-DOCMODEL] รุ่นของ OA เอง — ไม่ตั้ง ⇒ ตกไป MODEL_ID เหมือนเดิม
       ⚠️ [FEAT-20260904-VENDORSECCOL] GEMINI's column by NAME, never the vendor-resolved one. */
    modelId: hook?.['ai_model'],
    hookId: input.hookId ?? null,
    hook,
    sections: input.sections ?? [],
  };
  try {
    const got = await deps.retrieve(args);
    if (typeof got === 'string')
      return { docText: got, suggestionOverride: null };
    return {
      docText: got?.docText ?? '',
      suggestionOverride: got?.suggestionOverride ?? null,
    };
  } catch (docErr) {
    deps.warn(
      `[DOC] retrieval threw for doc_id=${docId} — answering without ` +
        `document context: ${deps.errText(docErr)}`,
    );
    return NO_CONTEXT;
  }
}
