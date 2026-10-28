import {
  resolveVendorPair,
  resolveDeepSeekReasoning,
  type DeepSeekReasoning,
} from '@/modules/hooks';

import { asString, maskToken } from '../logging/coerce-mask.util';

/**
 * [PROG-20260905-C5] Credentials and the AI vendor pair, derived once per turn.
 *
 * WHAT IT IS. A pure function of the hook row plus two injected services. No awaits, no
 * database, no LINE call, no webhook_log row — it reads a hook and produces the values
 * every later gate uses. That is what makes it the cheapest block in the spine to prove:
 * feed the same hook in, compare the seventeen values out.
 *
 * ⚠️ THE VENDOR SPLIT IS THE WHOLE POINT, and it must not be "tidied" back together.
 * `hookAiKey` is the OA's OWN key and nothing else; the env fallback is applied later, at
 * the provider, where the vendor is known. Before that split the fallback was applied
 * here — above the line where the vendor is even read — so a keyless DeepSeek hook
 * arrived holding Google's key and the transport sent `Authorization: Bearer AIza…` to
 * api.deepseek.com. `aiKeyForMaskOnly` exists ONLY to be masked into a log line; it is
 * not the key that travels.
 *
 * ⚠️ `effectiveFastMode` is hard-zero on purpose. It is not a bug and not dead code:
 * the spine reads it, and the value is what the wrap-ai harness pins.
 *
 * ⚠️ NO LINE FALLBACK EXISTS IN THIS REPO. Legacy read a process-wide channel here; every
 * OA carries its own credentials, so an OA with no token produces `Bearer ` and gets a
 * 401 — the same OUTCOME legacy reaches with an unset global env.
 */

export interface RequestCredentialsDeps {
  /* Matches CryptoService's real signature — it can answer null/undefined, and the
     `|| ''` fallbacks below are what turn that into the empty-credential outcome. */
  crypto: { safeDecrypt: (value: string) => string | null | undefined };
  /** `this.ai.geminiApiKey` — used for the MASK only, never as the travelling key. */
  geminiApiKey: string | undefined;
  logger: { log: (message: string) => void };
}

export interface RequestCredentials {
  channelSecret: string;
  accessToken: string;
  /* `(hook.channel_id as string) ?? null` — the cast asserts non-null, so TypeScript
     narrows the whole expression to `string`. Declaring it wider here would widen it for
     every consumer downstream, which is a change this extraction has no business making. */
  channelId: string;
  hookAiKey: string;
  aiKeyForMaskOnly: string;
  geminiOnlyKey: string;
  geminiTemp: number | undefined;
  geminiTopK: number | undefined;
  geminiTopP: number | undefined;
  geminiThinkingBudget: number | undefined;
  /**
   * [FEAT-20260909-DSREASONING] DeepSeek's reasoning for the MAIN lane. `null`
   * for every hook that has not set it — which is all of them until an admin
   * does — and the DeepSeek transport then attaches nothing.
   * ⚠️ Gemini is unaffected: its budget is `geminiThinkingBudget` above and its
   *    path is unchanged.
   *
   * 🔴 OPTIONAL, not required, and that is deliberate. Making it required turns
   *    every hand-built `RequestCredentials` in the test suite into a compile
   *    error — this file's shape is assembled by hand in several harnesses — for
   *    a field whose absence already means exactly what its null means. The
   *    lesson is one this work has met before: a new REQUIRED field on a widely
   *    constructed type is a change to every constructor of it.
   */
  deepseekReasoning?: DeepSeekReasoning | null;
  aiVendor: string | null;
  aiModel: string | null | undefined;
  effectiveFastMode: number;
  telegramKey: string | null | undefined;
  telegramChatId: string | null | undefined;
  /** Assigned back to the method-scope `let`: the OUTER CATCH reads it. */
  docId: string | undefined;
  /** Assigned back to the method-scope `let`: the outer catch spreads it into its row. */
  logContext: Record<string, unknown>;
}

export function deriveRequestCredentials(
  hook: Record<string, unknown> | null | undefined,
  deps: RequestCredentialsDeps,
): RequestCredentials {
  const channelSecret =
    deps.crypto.safeDecrypt(
      (hook?.['channel_secret'] as string) ?? (hook?.['line_secret'] as string),
    ) || '';
  // ⚠️ Legacy falls back to `config.channels.line.*` here. This repo has no
  //    process-wide LINE channel — every OA carries its own credentials —
  //    so the fallback is an empty string, and an OA with no token sends
  //    `Bearer ` and gets a 401 from LINE. That is the same OUTCOME legacy
  //    reaches when the global env is unset, which it is in every
  //    environment this repo runs in.
  const accessToken =
    deps.crypto.safeDecrypt(
      (hook?.['access_token'] as string) ?? (hook?.['line_key'] as string),
    ) || '';
  const channelId = (hook?.['channel_id'] as string) ?? null;

  /**
   * ⚠️ HISTORICAL NOTE — this block used to read "THE ONE VALUE THAT MUST NOT
   * LEAVE THIS FUNCTION", because `AiReplyRequest` deliberately had no field
   * for a key and the value existed only to be masked into two log lines.
   *
   * P2 changed that: the key is now per hook and per vendor, so it MUST
   * reach the provider — that is the only place the vendor is known and the
   * only place the "DeepSeek never borrows the Gemini key" rule can be
   * applied. What replaced the old invariant is the split below: which key
   * travels is no longer a question this function answers alone.
   * ของเดิมห้ามออกจากฟังก์ชัน — ตอนนี้ต้องออก แต่ออกได้ทางเดียว.
   */
  /* [P2-20260813] ⚠️ SPLIT, and the split is the whole point.
   *
   * `hookAiKey` is the OA's OWN key, nothing else. It is what travels to the
   * AI providers, where `resolveVendorKey` decides whether a shared env key
   * may stand in — and for DeepSeek the answer is never.
   *
   * Before this split the env fallback was applied HERE, above the line
   * where the vendor is even read, so a keyless DeepSeek hook arrived at the
   * provider holding Google's key: `resolveVendorKey` saw a non-empty value,
   * short-circuited, and the transport sent `Authorization: Bearer AIza…` to
   * api.deepseek.com. Proven by running it, not by reading it.
   * คีย์ค่ายหนึ่งห้ามหลุดไปอีกค่าย — ต้องแยกก่อนถึงจุดที่รู้จัก vendor.
   *
   * `aiKeyForMaskOnly` keeps the OLD meaning (own key, else the shared env
   * key) and is now used ONLY for masking into log lines — never outbound.
   *
   * ⚠️ `geminiOnlyKey` exists because the reply path is not the only place
   * that calls Google. Training-Doc retrieval puts the key straight into a
   * `generativelanguage.googleapis.com` URL (`rag-engine.service.ts:538`),
   * and this block used to hand it the OA's own key whatever the vendor —
   * so a DeepSeek OA with retrieval on sent its DeepSeek key to Google.
   * Proven by running it: the harness captured ["DEEPSEEK-OWN-KEY"].
   * A hook whose vendor is not Gemini contributes no key of its own here;
   * the shared Gemini rung still applies, exactly as it does today for a
   * keyless Gemini OA. เส้นเอกสารยิง Google — คีย์ที่ส่งต้องเป็นของ Gemini เท่านั้น. */
  /* Reads the field directly rather than the `aiVendor` const below: that
   one is declared further down with the knobs it belongs to, and moving
   it up here to satisfy an ordering rule would shuffle unrelated code. */
  const hookVendor = hook?.['ai_vendor'] as string | null | undefined;
  /* [FEAT-20260904-VENDORSECCOL] ⭐ THE ONE PLACE the vendor's own columns
   * are chosen. Everything downstream keeps receiving a single model + a
   * single key and never learns there are two pairs — which is what stops
   * vendor #3 from becoming six more call sites.
   *   gemini / absent → `ai_model` + `custom_ai_key` (unchanged)
   *   deepseek        → `ai_model_sec` + `custom_ai_key_sec`
   * A DeepSeek hook that holds only a Gemini key now resolves to NO key and
   * refuses, instead of firing Google's credential at api.deepseek.com.
   * ค่ายไหนอ่านคอลัมน์ของค่ายนั้น ไม่มีการยืมข้ามค่าย */
  const vendorPair = resolveVendorPair(hook ?? {}, hookVendor);
  const hookAiKey = deps.crypto.safeDecrypt(vendorPair.key ?? '') || '';
  const aiKeyForMaskOnly = hookAiKey || deps.geminiApiKey || '';
  /* ⚠️ Gemini-ONLY key, for the lane that posts to Google directly (Training
   * Doc retrieval). It reads `custom_ai_key` by NAME, not through the
   * resolver: that column is Gemini's by definition now, so a DeepSeek hook
   * contributes nothing here and the shared Gemini rung applies exactly as
   * it does for a keyless Gemini OA. The old `hookIsGemini ? … : ''` guard
   * is gone because the column itself is the guard. */
  const geminiOnlyKey =
    deps.crypto.safeDecrypt(hook?.['custom_ai_key'] as string) ||
    deps.geminiApiKey ||
    '';

  const geminiTemp = hook?.['gemini_temperature'] as number | undefined;
  const geminiTopK = hook?.['gemini_top_k'] as number | undefined;
  const geminiTopP = hook?.['gemini_top_p'] as number | undefined;
  // [FEAT-20260802-THINKHOOK] per-hook thinking budget; null = env fallback.
  const geminiThinkingBudget = hook?.['gemini_thinking_budget'] as
    number | undefined;
  /* [FEAT-20260909-DSREASONING] DeepSeek's own pair, MAIN lane. Read through the
     shared resolver so the column names live in exactly one place — a lane that
     reads the other lane's column is a mistake with no compile error and no
     symptom, because both values are the same type and usually null. */
  const deepseekReasoning = resolveDeepSeekReasoning(hook ?? {}, 'main');
  /* [P2-20260813] Per-hook vendor + model. Read here with the knobs they
   * belong to; null/absent means "the default vendor" and "that vendor's
   * family default model", which is what every hook resolves to today, so
   * an OA that never sets them is unaffected. */
  const aiVendor = (hook?.['ai_vendor'] as string | null | undefined) ?? null;
  // [FEAT-20260904-VENDORSECCOL] the model of the vendor that will answer,
  // resolved with its key above. `null` still means "that vendor's family
  // default", which is what every hook resolves to today.
  const aiModel = vendorPair.model;
  /* ⚠️ [FAST-MODE-PAIR 2/2] — noted 2026-08-13. THIS `0` is what reaches the
   * model, not `hook.fast_mode`.
   *
   * legacy:2393 hard-codes 0. `hook.fast_mode` (which is `1` on every OA — see
   * the paired note above, grep `[FAST-MODE-PAIR 1/2]`) is read and logged but
   * NOT used for the model call. This constant is what the pipeline uses, so the
   * fast-mode-2 branch inside `askGemini` is effectively force-disabled on every
   * hook: model calls always run FULL mode.
   * ⇒ do not "fix" this to read `hook.fast_mode` — that would silently flip every
   *   OA into fast mode. It is 0 on purpose. เจ้าของบังคับ 0 ทุก OA. */
  const effectiveFastMode = 0;
  const docId = asString(hook?.['doc_id']);
  if (docId) {
    deps.logger.log(
      `[DOC] Using doc_id: ${docId} link: https://docs.google.com/document/d/${docId}/edit`,
    );
  }
  const lineKeyMask = maskToken(accessToken);
  const geminiKeyMask = maskToken(aiKeyForMaskOnly);
  const telegramKeyRaw = hook?.['telegram_key'];
  const telegramKey =
    deps.crypto.safeDecrypt(
      typeof telegramKeyRaw === 'string' ? telegramKeyRaw.trim() : '',
    ) || null;
  const telegramChatIdRaw = hook?.['telegram_chat_id'];
  const telegramChatId =
    typeof telegramChatIdRaw === 'string'
      ? telegramChatIdRaw.trim()
      : (telegramChatIdRaw as string | undefined);
  const logContext: Record<string, unknown> = {
    hook_id: asString(hook?.['_id']),
    hook_alias: hook?.['alias'],
    group_id: asString(hook?.['group']),
    line_key_mask: lineKeyMask,
    gemini_api_key_mask: geminiKeyMask,
  };
  return {
    channelSecret,
    accessToken,
    channelId,
    hookAiKey,
    aiKeyForMaskOnly,
    geminiOnlyKey,
    geminiTemp,
    geminiTopK,
    geminiTopP,
    geminiThinkingBudget,
    deepseekReasoning,
    aiVendor,
    aiModel,
    effectiveFastMode,
    telegramKey,
    telegramChatId,
    docId,
    logContext,
  };
}
