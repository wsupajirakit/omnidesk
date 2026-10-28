/**
 * [FEAT-20260822-AIPROMPTLOG] — diagnostic fingerprints for the AI reply path.
 *
 * WHY: when a bot answers wrongly, the first question is always "which prompt
 * version did this hook hold, what time did the model see, and what did it
 * answer before post-processing?" — none of which the logs carried. These
 * helpers feed those answers into the existing `generate_response`
 * webhook_logs row (`payload_summary.doc_sha` / `doc_len` / `thai_time` /
 * `answer_tags`) and one stdout `[AI-BLOCKS]` line, without ever logging the
 * prompt body itself (privacy + size: a fingerprint identifies the version, a
 * 50k document does not belong in a log).
 *
 * CONTRACT: every function is total. Any input — null, garbage, wrong type —
 * returns a safe value; nothing here may throw, because a diagnostics failure
 * must never touch a customer reply. The callers additionally sit behind the
 * `wlogEmit` swallow ([FEAT-20260815-WLOGDOOR]) and their own try/catch.
 *
 * revert: delete this file, its spec, and the call sites tagged
 * [FEAT-20260822-AIPROMPTLOG] in webhook.service.ts and
 * gemini-reply.provider.ts — nothing else references it.
 */
import { createHash } from 'node:crypto';

/** Total text coercion: string as-is, null/undefined → '', other primitives
 *  stringified, objects as JSON (never "[object Object]"); throws are caught. */
const toText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint')
    return v.toString();
  if (typeof v === 'symbol') return v.description ?? 'symbol';
  if (typeof v === 'function') return '?';
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '?';
  }
};

/** First 8 hex chars of sha256 — enough to tell prompt versions apart. */
export function sha8(value: unknown): string {
  try {
    return createHash('sha256')
      .update(toText(value), 'utf8')
      .digest('hex')
      .slice(0, 8);
  } catch {
    return '?';
  }
}

/**
 * Fingerprint of the RAW Training Doc fields on the hook row. Must be computed
 * from `hook.suggestion_text` / `hook.suggestion_company_text` directly — the
 * `suggestionText` the provider receives has the `Today is …` line and the
 * chat history already substituted in, so hashing it would change every call.
 */
export function buildDocFingerprint(
  hook: Record<string, unknown> | null | undefined,
): { doc_sha: string; doc_len: string } {
  try {
    const s1 = toText(hook?.['suggestion_text']);
    const s2 = toText(hook?.['suggestion_company_text']);
    return {
      doc_sha: `${sha8(s1)}/${sha8(s2)}`,
      doc_len: `${s1.length}/${s2.length}`,
    };
  } catch {
    return { doc_sha: '?', doc_len: '?' };
  }
}

/**
 * Triple-bracket reply markers in a model answer, bracket-free, capped so one
 * bad answer cannot bloat a log row. Two-bracket dynamic tags are data
 * substitutions, not reply decisions, so they are deliberately not matched.
 */
export function extractAnswerTags(text: unknown, cap = 5): string[] {
  try {
    const found = toText(text).match(/\[\[\[[^[\]]{1,64}\]\]\]/g) ?? [];
    return found.slice(0, cap).map((m) => m.slice(3, -3));
  } catch {
    return [];
  }
}

/** HH:mm out of a `formatThaiDateTime()` string; anything else passes through. */
export function thaiClock(thaiDateTime: unknown): string {
  try {
    const s = toText(thaiDateTime);
    const m = s.match(/(\d{1,2}:\d{2}):\d{2}\s*$/);
    return m?.[1] ?? s;
  } catch {
    return '?';
  }
}

/**
 * `kind:length` per prompt block, with `!TRUNC` when the serialized block
 * carries the `_truncated` sentinel `buildRawSiteRulesBlock` appends on
 * overflow — the signal that used to require patching dist to see.
 */
export function describeBlocks(
  blocks: ReadonlyArray<{ kind?: unknown; text?: unknown }> | null | undefined,
): string {
  try {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    const list: ReadonlyArray<{ kind?: unknown; text?: unknown }> = blocks;
    return list
      .map((b) => {
        const text = typeof b?.text === 'string' ? b.text : '';
        const trunc = text.includes('"_truncated"') ? '!TRUNC' : '';
        const kind = b?.kind === undefined ? '?' : toText(b.kind);
        return `${kind}:${text.length}${trunc}`;
      })
      .join(',');
  } catch {
    return '';
  }
}
