/**
 * ==== [FEAT-20260820-LINEPUSHCORE] LINE Messaging API endpoints — ONE copy ====
 *
 * WHY: the push URL is currently written in 6 places and the reply URL in 4
 * (line-api.service.ts:46-52, chat/channels/line-send-adapter.ts:22,
 * external/hook-outbound.service.ts:81, content/broadcasts.service.ts:62,
 * webhook.service.ts:5701, chat/channels/outbound-audit.ts:70, …). This file is
 * the single source the new `infra/line` core reads. Existing copies are NOT
 * touched here — they retire one candidate at a time in Phase 3, each with its
 * own approval. ของเดิมยังอยู่ครบ ไฟล์นี้คือจุดรวมของ "ตัวกลางใหม่" เท่านั้น.
 *
 * revert: delete `src/infra/line/` entirely — nothing outside this folder
 *         imports it until a Phase-3 migration lands.
 */

export const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
export const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
export const LINE_MULTICAST_URL =
  'https://api.line.me/v2/bot/message/multicast';
export const LINE_BROADCAST_URL =
  'https://api.line.me/v2/bot/message/broadcast';
export const LINE_LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';
/** Targeted broadcast (audience/demographic filters). Retry-key eligible. */
export const LINE_NARROWCAST_URL =
  'https://api.line.me/v2/bot/message/narrowcast';
/** Monthly quota + consumption — the reads hooks.service.ts:848 proxies today. */
export const LINE_QUOTA_URL = 'https://api.line.me/v2/bot/message/quota';
export const LINE_CONSUMPTION_URL =
  'https://api.line.me/v2/bot/message/quota/consumption';
/** LINE followers insight (followers, targeted reaches, blocks) */
export const LINE_INSIGHT_FOLLOWERS_URL =
  'https://api.line.me/v2/bot/insight/followers';
/** GET base — the user id is appended by the caller (see line-api.service.ts:52). */
export const LINE_PROFILE_URL_PREFIX = 'https://api.line.me/v2/bot/profile/';

/**
 * One default budget for every send, matching the measured value the webhook
 * client already uses (line-api.service.ts:54-62 — 15 s ≈ 12× the worst
 * observed push). Candidates that deliberately run tighter budgets today
 * (chat 8s/5s, broadcast 5s) pass `timeoutMs` per call when they migrate, so
 * their behaviour does not change by moving. ค่า default เดียว แต่ override ได้.
 */
export const LINE_DEFAULT_TIMEOUT_MS = 15_000;
