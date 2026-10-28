/**
 * ==== [FIX-20260818-VENDORKEYPROBE] Check an AI key against ITS OWN vendor ====
 * plan §7.4 — ไม่มีในแผนเดิม · owner 18/08: "มันก็ยิงตาม vendor endpoint ตัวเองสิ ... dynamic"
 * ===========================================================================
 *
 * THE BUG. `hook-credential-check.service.ts` built one URL — Google's
 * `/v1/models?key=` — no matter which vendor the hook had selected. So a DeepSeek
 * key typed into the OA form was handed to Google, Google rejected it, and the
 * save failed: a DeepSeek key could not be stored through the API at all. Worse
 * than the broken feature is where the key went — `ai-vendors/resolve-vendor-key.ts`
 * exists precisely to stop one vendor's credential reaching another, and the
 * write path was doing it on the way in.
 *
 * WHAT THIS FILE IS. One table, keyed by the vendor names the rest of the module
 * already uses. `Record<AiVendor, …>` is load-bearing: add a name to `AI_VENDORS`
 * without adding an entry here and the build fails, which is what makes
 * "vendor #3 edits one place" true rather than aspirational.
 *
 * ⚠️ WHY THE HOST IS RE-DECLARED INSTEAD OF IMPORTED. `DEEPSEEK_CHAT_URL` lives in
 * `@/modules/webhook`, and webhook already imports hooks. Importing back would
 * close a cycle that `hooks.service.ts` documents as fatal at boot. The string is
 * repeated with its source named, and the spec pins both copies together.
 *
 * ⚠️ UNKNOWN OR UNREACHABLE MEANS SKIP, NEVER REJECT. We can verify a Gemini key
 * because that call has been made for years. We cannot verify what DeepSeek
 * answers without spending someone's real key, which is forbidden — so a probe
 * we are unsure about is allowed to fail without blocking the save. A false
 * rejection would make a WORKING key unsaveable, which is the exact bug this
 * change exists to remove. ไม่รู้จัก = ข้าม ไม่ใช่ปฏิเสธ
 *
 * revert: delete this file and restore the hardcoded Google URL in
 *         `verifyCustomAiKey`. DeepSeek keys become unsaveable again.
 */

import { AI_VENDORS, type AiVendor } from './parse-ai-vendor';
import { DEEPSEEK_MODELS_URL, GEMINI_MODELS_URL } from '@/common/ai-endpoints';

/** Gemini's model list — the endpoint this repo has always used to check a key. */
/* [FEAT-20260908-AIVENDORHOSTS] From the door. This file's own header explains
   why it had to re-declare the host: `modules/ai` imports `@/modules/hooks`, so
   a hook file importing back would close a cycle. `@/common/ai-endpoints` imports
   NOTHING, which is exactly the shape that unblocks it — the wall this file
   documented is gone.
   BYTE-IDENTICAL: `GEMINI_MODELS_URL` is pinned to `/v1`, the surface this probe
   has always used.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
const GEMINI_MODELS_ENDPOINT = GEMINI_MODELS_URL;

/**
 * DeepSeek's OpenAI-compatible model list.
 * Host mirrors `webhook/ai-vendors/deepseek/deepseek-reply.transport.ts`
 * (`DEEPSEEK_CHAT_URL`) — same API, different path. Listing models is the cheap,
 * non-billed probe; a chat completion would be a paid inference call and must
 * never be used to test a key.
 */
/* [FEAT-20260908-AIVENDORHOSTS] From the door — same value, one declaration.
   Until now `DEEPSEEK_MODELS_URL` had no consumer at all, which by this repo's
   own rule made it debt; this is its consumer. */
const DEEPSEEK_MODELS_ENDPOINT = DEEPSEEK_MODELS_URL;

export interface AiKeyProbe {
  /** Where to ask. */
  url: string;
  /** Headers to send — Gemini carries the key in the query string instead. */
  headers: Record<string, string>;
  /**
   * `true`  → a failed probe REJECTS the key (we trust this answer).
   * `false` → a failed probe is IGNORED (we do not trust it enough to block a save).
   */
  rejectOnFailure: boolean;
}

/**
 * How to check each vendor's key.
 *
 * `null` would mean "this vendor cannot be checked at all"; no vendor needs that
 * today, and the type keeps the option explicit rather than implied by omission.
 */
const PROBES: Record<AiVendor, (key: string) => AiKeyProbe> = {
  gemini: (key) => ({
    // Byte-identical to what this service sent before this change — the Gemini
    // path must not move, since every stored key today is a Gemini key.
    url: `${GEMINI_MODELS_ENDPOINT}?key=${encodeURIComponent(key)}`,
    headers: {},
    rejectOnFailure: true,
  }),
  deepseek: (key) => ({
    url: DEEPSEEK_MODELS_ENDPOINT,
    headers: { Authorization: `Bearer ${key}` },
    // Deliberately false — see the header. We have never made this call, so its
    // failure is not evidence the key is bad, and blocking on it would recreate
    // the very bug being fixed.
    rejectOnFailure: false,
  }),
};

/**
 * The probe for `vendor`, or the default vendor's when it is absent/unknown.
 *
 * Absent means "the hook never chose", which is the same state the transport
 * registry resolves to Gemini — so the check and the reply agree about who the
 * default is.
 */
export function buildAiKeyProbe(
  key: string,
  vendor: string | null | undefined,
): AiKeyProbe {
  const name = typeof vendor === 'string' ? vendor.trim() : '';
  const known = (AI_VENDORS as readonly string[]).includes(name)
    ? (name as AiVendor)
    : 'gemini';
  return PROBES[known](key);
}
