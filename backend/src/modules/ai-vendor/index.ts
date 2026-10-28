/**
 * [FEAT-20260907-AIVENDORCORE] The single door to an AI vendor.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md
 * ===========================================================================
 * 🔴 THIS MODULE IMPORTS NO OTHER MODULE, AND MUST NOT START.
 *    `chat → webhook` and `webhook → chat` both exist, so the module graph
 *    already contains a cycle. Any module dependency here would put some
 *    consumer on the wrong side of an arrow — which is exactly the wall
 *    `tickets/translate` and `hooks/ai-vendor/ai-key-probe` are stuck behind
 *    today, and both say so in their own comments. A leaf cannot create a cycle,
 *    so every module reaches this one unconditionally. That is not a style
 *    choice; it is the only shape that lets webhook, chat, tickets, system, slip
 *    and hooks all use the same door.
 *    ⚠️ `@/common/ai-endpoints` is not a module — it is a constants file that
 *       imports nothing, which is why the URLs live there.
 *
 * WHAT IS HERE: where a vendor lives, what its request looks like, and how to
 * read its answer. WHAT IS NOT: prompts, keys, caps, model policy, and the HTTP
 * call itself — each excluded for a reason written at its own site.
 */
export type { VendorCall, VendorKnobs, VendorPart, VendorResult } from './call';
export {
  AI_HTTP_TIMEOUT_MS,
  GEMINI_HTTP_OPTS,
  geminiHttpOpts,
  deepSeekHttpOpts,
} from './http';
export {
  buildGeminiBody,
  geminiBatchEmbedUrl,
  geminiUrl,
  readGeminiText,
} from './gemini/transport';
export type { GeminiBody } from './gemini/transport';
export {
  DEEPSEEK_CHAT_URL,
  buildDeepSeekBody,
  readDeepSeekText,
} from './deepseek/transport';
export type { DeepSeekBody } from './deepseek/transport';
/* [FIX-20261014-DSEFFORTTOP] where DeepSeek reads the effort — one spelling for all lanes */
export { deepSeekReasoningWire } from './deepseek/reasoning-wire';
export type {
  DeepSeekReasoningChoice,
  DeepSeekReasoningWire,
} from './deepseek/reasoning-wire';
export * from './models';
export * from './cap-ledger';
export * from './vendor-error';
export * from './send';
