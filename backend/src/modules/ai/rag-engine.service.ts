import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import axios from 'axios';
import { type Model, Types } from 'mongoose';

import { ChatMessage } from '@/modules/chat';
import { DynamicTag } from '@/modules/hooks';

/**
 * TRANSCRIBED — not redesigned. Source: legacy-api
 * `src/services/core-bot/ragEngineService.js` (1,293 lines), line for line.
 *
 * The owner's instruction for this file was explicit: copy the legacy logic, do
 * not improve it. That is not laziness, it is the safer reading of the evidence.
 * Every hazard an earlier analysis found here is a hazard that only bites the
 * person who "fixes" it, and each one is marked ⚠️ TRANSCRIBED below with what
 * would break if it were tidied. A reader who wants to change one of them should
 * expect a customer-visible difference with no test failing — which is exactly
 * why the differential suite in `z-test/unit/rag-engine-parity.spec.ts` runs the
 * legacy JavaScript beside this file on identical inputs.
 *
 * ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
 * · `validateSignature` (legacy:52-66) — already ported, and better, as
 *   `src/modules/webhook/line-signature.guard.ts`. Deliberately NOT duplicated;
 *   a second HMAC implementation is how the two drift. `CHANNEL_SECRET` went
 *   with it, so this file reads no LINE env at all.
 * · `suggestQuestions` (legacy:1089-1138) — DELETED on instruction. `grep`
 *   across legacy-api finds its definition and its export and no caller, and its
 *   body is a live billable model call. Carrying a paid path forward with no
 *   caller to constrain it is strictly worse than not having it.
 *   `formatThaiDateTime` was its only consumer and IS ported, because it is a
 *   pure function and the next caller should not write a second one.
 *
 * ── THE MODEL IS NEVER CALLED FROM A TEST ───────────────────────────────────
 * Four functions here put a request on the wire to Google. Every one goes
 * through `axios`, module-level, so a spec replaces `axios.post`/`axios.get`
 * with a stub that rejects by default and an un-stubbed call fails the test
 * instead of billing an account. Nothing in the test suite has ever reached
 * `generativelanguage.googleapis.com`, and `z-test/lib/no-ai-outbound.ts`
 * throws on any attempt that gets past that.
 */

/** legacy:24 — module-scope logger; legacy used bare `console.*`, which the
 * repo's `no-console` rule forbids. Message text is unchanged. */
const logger = new Logger('RagEngineService');

/* ===============================================================
   ENV — legacy:8-31
=============================================================== */
/**
 * ⚠️ Read ONCE at import, exactly as legacy reads them at `require` time. A
 * later `process.env` mutation does not reach these; the per-call reads further
 * down (`GEMINI_TOP_P`, `GEMINI_TOP_K`, `GEMINI_TEMPERATURE`,
 * `GEMINI_THINKING_BUDGET`) are live because legacy reads *those* per call.
 * The inconsistency is legacy's and is load-bearing for anything that sets env
 * after boot.
 */
const GEMINI_API_KEY = process.env['GEMINI_API_KEY'];
const MODEL_ID = process.env['MODEL_ID'] || 'gemini-3.5-flash';
// [FEAT-20260829-EPOCHTHAI] revert: ลบ import + จุดเรียกใน buildRawJsonBlock
import { withThaiTime } from './epoch-thai-time.util';

const FAST_MODE = Number(process.env['FAST_MODE'] || 0); // 0 = full, 2 = fast

/**
 * legacy:13-25 [FIX-20260727-STALL] — axios' default timeout is 0, i.e. wait
 * forever; a dead socket then costs ~925s of kernel timeout. 30s is 7.6x the
 * worst `gemini/generate_response` ever measured in `webhook_logs` (max 3953ms),
 * so no normal answer is affected. Passed as the third argument to all four
 * remaining `axios.post` calls.
 */
/* [FEAT-20260907-AIVENDORCORE] The object moved to the leaf door and is
   RE-EXPORTED here, unchanged. Nine call sites across six subsystems import it
   from this path and one of them pins it by IDENTITY (`toBe`), so a second
   declaration with the same shape would pass every value check and still break
   the contract. One object, many import sites.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
/* [FEAT-20260907-AIVENDORCORE] All FOUR URL literals in this file now come from
   the leaf door. Three used `/v1` and one used `/v1beta` — in the same file, at
   call sites nobody compared. Proven interchangeable by live fire before the
   change (200/200 plain, 400/400 raw budget 0, 200/200 thinkingLevel minimal).
   ⚠️ This file is on the LIVE customer reply path — `webhook/ai-reply/reply-blocks.ts`
      and `reply-dyntag.ts` import it — so the four sites were changed together and
      re-measured against the full suite, not treated as legacy cleanup.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
import {
  GEMINI_HTTP_OPTS,
  geminiHttpOpts,
  geminiUrl,
  readGeminiText,
} from '@/modules/ai-vendor';
export { GEMINI_HTTP_OPTS };

/** legacy:27-31. Anything that is not 0/1/2 (or "0"/"1"/"2") falls back to env. */
export function resolveFastMode(value?: unknown): number {
  if (value === 0 || value === 1 || value === 2) return value;
  if (value === '0' || value === '1' || value === '2') return Number(value);
  return FAST_MODE;
}

/** legacy:33-47. Thai weekday/day/month, Buddhist year truncated to 2 digits. */
export function formatThaiDateTime(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('th-TH', {
    weekday: 'long',
    timeZone: 'Asia/Bangkok',
  });
  const day = now.toLocaleDateString('th-TH', {
    day: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
  const month = now.toLocaleDateString('th-TH', {
    month: 'long',
    timeZone: 'Asia/Bangkok',
  });
  // legacy: `(...toLocaleString(...) * 1 + 543)`. `Number(x)` is what `x * 1`
  // does; written out only because TS rejects arithmetic on a string.
  const yearBE = (
    Number(
      now.toLocaleString('en-US', {
        year: 'numeric',
        timeZone: 'Asia/Bangkok',
      }),
    ) + 543
  )
    .toString()
    .slice(-2);
  const timeStr = now.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok',
  });
  return `${weekday}ที่ ${day} ${month} ${yearBE} ${timeStr}`;
}

/* ===============================================================
   2–4) GOOGLE DOCS FETCH · CHUNK · LOCAL RETRIEVE · AI RETRIEVE — REMOVED 26/10/2026
=============================================================== */
/*
 * [FEAT-20261026-RAGENGINE] The retrieval half transcribed from legacy:68-345 (Google-Doc
 * export by `doc_id`, char n-grams + Jaccard, `localRetrieveSnippets`, `findRelevantText` and its
 * Gemini extraction call) lived here. It was never bound (`DOC_RETRIEVAL_PROVIDER` had no
 * `provide:` anywhere — see the note at `webhook/doc-retrieval/doc-retrieval.provider.ts`), so it
 * never ran in production. It is replaced by the RAG engine in `src/modules/rag/` (Training-Doc
 * source, Thai BM25 + optional embeddings, per-hook switch), plugged in by one line in
 * `webhook.module.ts`. Recover the old code from tag `ckpt-before-rag-engine-demo-26102026`.
 * ส่วนค้นเอกสารเดิมถูกแทนด้วย module rag ใหม่ — ดูโค้ดเก่าได้จาก tag ก่อนแก้
 */

/* ===============================================================
   5) ASK GEMINI (ANSWER) — legacy:347-1084
=============================================================== */

/**
 * ⚠️ TRANSCRIBED — exact string equality against these two Thai strings, after
 * `trim()` and nothing else. No normalisation, no case fold, no punctuation
 * tolerance. Both are copied byte for byte from legacy:350-351; changing one
 * character in either silently stops `noData` from ever being true for that
 * phrasing, and `noData` is what makes the webhook send the hook's
 * `default_answer_text` instead of the model's words.
 */
export const FALLBACK_TEXT = 'ไม่พบข้อมูลที่เกี่ยวข้องในเอกสาร';
export const ALT_FALLBACK_TEXT = 'ข้อมูลนี้ไม่มีในเอกสาร';
export const TAG_FOUND = '[[[FOUND]]]';
export const TAG_NOT_FOUND = '[[[NOT_FOUND]]]';

/**
 * ⚠️ TRANSCRIBED — module-level and `/g`. A `/g` regex carries `lastIndex`
 * across `.test()` calls, so two consecutive `.test()` calls on the same string
 * can return true then false. `askGemini` gets away with it because the
 * `.replace()` that follows resets `lastIndex` to 0 on every call. Anything that
 * calls `.test()` twice — a caller, a future refactor, a test — sees the
 * alternation. Do not drop the `/g`: `.replace` needs it to strip EVERY tag, and
 * models emit more than one.
 */
export const TAG_FOUND_REGEX =
  /(\[\[\[FOUND\]\]\]|\{\{\{FOUND\}\}\}|\(\(\(FOUND\)\)\))/g;
export const TAG_NOT_FOUND_REGEX =
  /(\[\[\[NOT_FOUND\]\]\]|\{\{\{NOT_FOUND\}\}\}|\(\(\(NOT_FOUND\)\)\))/g;

/** legacy:357-360. */
export function isFallbackText(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  return t === FALLBACK_TEXT || t === ALT_FALLBACK_TEXT;
}

/**
 * legacy:365-380 [FEAT-20260728-TAGSCOPE] — scope of a dynamic tag: this OA
 * (`hook_id`) ∪ the whole group the OA belongs to (`group_id`). One helper so
 * production and the tests build the identical filter.
 *
 * ⚠️ TRANSCRIBED — with a hook but no group, `group_id`/`group_ids` are NOT in
 * the `$or` at all, so a group-scoped tag is invisible to an ungrouped OA. With
 * neither, there is no `$or` and the query matches EVERY enabled tag in the
 * system. That second case is what a caller with `hookId = null` gets.
 */
export function buildDynamicTagQuery(
  hookId?: unknown,
  hookGroupId: unknown = null,
): Record<string, unknown> {
  const query: Record<string, unknown> = { status: true, deleted_at: null };
  // hook_ids = scope "เลือกบางตัวในกลุ่ม" (checkbox) — array contains match ของ Mongo
  // group_ids = tag ผูกหลายกลุ่ม (group_id เดี่ยว = legacy ยังใช้ได้)
  if (hookId && hookGroupId) {
    query['$or'] = [
      { hook_id: hookId },
      { hook_ids: hookId },
      { group_id: hookGroupId },
      { group_ids: hookGroupId },
    ];
  } else if (hookId) {
    query['$or'] = [{ hook_id: hookId }, { hook_ids: hookId }];
  }
  return query;
}

/**
 * legacy:396 [FEAT-20260731-TAGMISMATCH] — the shape of a dynamic-tag NAME, used
 * to spot a marker the model wrote that no loaded tag answers to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * [FIX-20260901-TAGREBLIND] WIDENED. Legacy's `_x_` matched 0 of the 801 real
 * tags — this scanner had never once fired in production.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. Legacy pinned the middle segment to the literal `x`. That is the
 * shape the tag GENERATOR emits (`hooks/dynamic-tags.service.ts:60`,
 * `TAG_PREFIX = 'odk_x_90'`), and the regex was evidently written from it. It is
 * NOT the shape the collection holds. Counted against `dynamic_tags` on 01/09:
 *
 *     odk_p_*   451        odk_s_*   350        odk_x_*   0
 *     old  /[a-z]+_x_\d+/                            0 / 801 matched
 *     new  /(?:odk_[a-z]+_\d+|[a-z]+_[a-z]_\d+)/   801 / 801 matched
 *
 * So both call sites — the inbound scan (`webhook/ai-reply/reply-dyntag.ts:243`)
 * and the outbound one (`ai-vendors/gemini/gemini-reply.provider.ts:184`) — have
 * been reporting on an empty set since the day they shipped. No error, no log,
 * and every test green: the fixtures spell their tags `odk_x_1`, which is the
 * generator's shape, so the suite agreed with the code and neither agreed with
 * the database. โค้ดบอกเจตนา · DB บอกความจริง — this is that rule, exactly.
 *
 * WHY TWO BRANCHES AND NOT ONE `[a-z]+_[a-z]+_\d+`. The one-branch version also
 * matches `custom_content_1` — a marker from a different family that this scanner
 * must never claim — because nothing in it says where the name starts.
 *
 *   1. `odk_[a-z]+_\d+`   the family actually in use, middle segment of ANY
 *                         length. Owner's rule, 01/09: anything spelled `odk_…`
 *                         has to be readable, so `odk_ab_00001` and
 *                         `odk_bank_00001` must match as surely as `odk_p_00001`.
 *   2. `[a-z]+_[a-z]_\d+`  legacy's shape with the middle opened from the literal
 *                         `x` to any single letter. Keeps every non-`nxs` prefix
 *                         legacy served (`ins_x_12`, `abcd_x_7`) working.
 *
 * Branch 2 makes this a strict SUPERSET of legacy — `x` is one of `[a-z]` — so
 * nothing legacy caught is lost.
 *
 * Verified by RUNNING both branches against the collection, not by reading them:
 * 801/801 real tags matched · `odk_ab_00001`, `odk_bank_00001`, `odk_x_90001`,
 * `ins_x_12`, `abcd_x_7` all matched · 0 false positives across
 * `custom_content_1`, `menu_main_00010`, `menu_sub_00011`, `flex_m00001`,
 * `flex_pc00001`, `img_promo`, `flex_profile`, `assist`, `history`,
 * `customer-helper`, `START_OF_BASIC_INFO`, `END_OF_COMPANY_INFO`.
 *
 * 🔴 THIS IS A DELIBERATE DIVERGENCE FROM LEGACY, the first in this family.
 *    `rag-engine-parity.spec.ts` no longer asserts the two sources are equal; it
 *    asserts the divergence and proves the superset property. Do not "restore
 *    parity" by narrowing this back — that re-blinds the scanner.
 *
 * ⚠️ TIED TO THE TAG GENERATOR. If `TAG_PREFIX` in
 *    `modules/hooks/dynamic-tags.service.ts:60` is ever changed — a new prefix, a
 *    longer middle segment, letters after the digits — COME BACK HERE and re-run
 *    the count above before trusting this scanner again. The generator and this
 *    reader have already drifted apart once, silently, and nothing but this note
 *    connects them. That file carries the mirror of this warning.
 *    ⇒ แก้ prefix ที่ต้นกำเนิด tag เมื่อไหร่ ต้องกลับมาแก้ตรงนี้เสมอ
 *
 * ⚠️ TRANSCRIBED — `/g` again, and `matchAll` requires it. Unlike the FOUND
 * regexes this one is only ever used with `matchAll`, which does not mutate
 * `lastIndex` of the original… but it DOES throw if the flag is missing. Keep it.
 *
 * revert: `/[a-z]+_x_\d+/gi` — the scanner then matches none of the 801 live tags
 * again, and both call sites go back to reporting nothing.
 */
export const TAG_MARKER_RE = /(?:odk_[a-z]+_\d+|[a-z]+_[a-z]_\d+)/gi;

/**
 * legacy:398-405 — pure. Never touches the text, never touches the DB; returns
 * only the distinct markers that are not in the known set.
 */
export function findUnknownTagMarkers(
  text: unknown,
  knownTagNames: unknown,
): string[] {
  if (!text || !(knownTagNames instanceof Set)) return [];
  const found = new Set<string>();

  // is `String(text)` on an unconstrained argument. An object stringifying to
  // "[object Object]" (which contains no `_x_<digits>`) yielding zero markers is
  // the behaviour, not an accident: a caller that passes a non-string gets "no
  // unknown markers" rather than a throw on the customer-reply path.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  for (const m of String(text).matchAll(TAG_MARKER_RE)) {
    if (!knownTagNames.has(m[0])) found.add(m[0]);
  }
  return [...found];
}

/** The `webhookLogService.createLog` seam. See `WEBHOOK_LOG_SINK` below. */
export interface WebhookLogSink {
  createLog(payload: Record<string, unknown>): Promise<unknown>;
}

/**
 * legacy:411-438 — writes ONE row per bot reply, not one per marker, so a
 * document with several typos cannot flood `webhook_logs`. Fire-and-forget with
 * `.catch()`, the same pattern `dynamic_tag_calculation_error` already uses: a
 * logging failure must never break the reply.
 *
 * ⚠️ PORT DIFFERENCE (the only signature change in this file): legacy resolves
 * `webhookLogService` with a `require()` inside the try, so a missing module
 * degrades to "logging skipped". Nest has no equivalent late binding, so the
 * sink is the 5th parameter. Absent sink ≡ legacy's `require` throwing: the
 * `console.warn` still fires, the DB row does not get written. Parameters 1-4
 * keep legacy's order so a reviewer can diff them.
 */
export function reportTagMismatch(
  markers: string[] | null | undefined,
  tagsLoaded: boolean,
  hookId?: unknown,
  hookGroupId?: unknown,
  sink?: WebhookLogSink | null,
): void {
  if (!tagsLoaded || !markers || markers.length === 0) return;
  const unique = [...new Set(markers)];

  // interpolates `hookId` straight into the template. In practice it is a string
  // or an ObjectId (whose toString is the hex id, which is what you want in a
  // log line); anything else printing "[object Object]" is legacy's output too.
  logger.warn(
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    `[TAG MISMATCH] hook=${String(hookId ?? '') || '-'} unknown_markers=${unique.join(', ')}`,
  );

  try {
    if (!sink) throw new Error('no webhook log sink bound');
    void sink
      .createLog({
        channel: 'log_operation',
        action_type: 'dynamic_tag_marker_mismatch',
        status: 'error',
        hook_id: hookId || undefined,
        group_id: hookGroupId || undefined,
        error_message: `Unknown dynamic tag marker(s): ${unique.join(', ')}`,
        raw_request: { unknown_markers: unique, count: unique.length },
        reference_id: unique[0],
      })
      .catch((lErr: unknown) =>
        logger.error(
          `[TAG MISMATCH] failed to write log: ${String(dig(lErr, 'message'))}`,
        ),
      );
  } catch (e) {
    logger.error(
      `[TAG MISMATCH] logging skipped: ${String(dig(e, 'message'))}`,
    );
  }
}

/* ---------------------------------------------------------------
   [FEAT-20260731-RAWJSON] — legacy:441-580
   The delimiters below are chosen not to collide with anything already in a
   document: the doc splitter uses [END_OF_BASIC_INFO] / [END_OF_COMPANY_INFO] /
   [END_OF_NO_PROFILE_DATA], and tags use the [[[name]]] shape.

   ⚠️ The names were changed once ([REFACTOR-20260804-PROFILEMARKER]) and admins
   reference them by hand in `ai_raw_json_rules`. Renaming them again means every
   OA's admin-written rules point at a block that is not in the prompt, and the
   model silently applies no rule. Read as a pair:
     [RAW_JSON_PROFILE_START]        ข้อมูลลูกค้า
     [RAW_JSON_PROFILE_RULES_START]  กติกาของข้อมูลลูกค้า
     [RAW_SITE_RULES_START]          กติกาเว็บ
     [SITE_RULES_GUIDE_START]        กติกาของกติกาเว็บ
--------------------------------------------------------------- */
export const RAW_JSON_START = '[RAW_JSON_PROFILE_START]';
export const RAW_JSON_END = '[RAW_JSON_PROFILE_END]';
export const RAW_JSON_RULES_START = '[RAW_JSON_PROFILE_RULES_START]';
export const RAW_JSON_RULES_END = '[RAW_JSON_PROFILE_RULES_END]';
/**
 * legacy:481 — token ceiling. Truncation is always announced, never silent.
 *
 * [FEAT-20260829-EPOCHTHAI] 20000 → 25000 เมื่อ 29/08/2026.
 *
 * WHY: การเติม `<field>_th` ข้าง epoch ทำให้ก้อน raw profile โตขึ้น ~28%
 * (วัดจากก้อนจริง: 8,392 → 10,755 pretty-printed). ลูกค้าคนเดียวยังห่างเพดาน
 * มาก แต่ถ้า OA ผูกหลาย tool ในถุงเดียว ก้อนรวมจะชนเร็วขึ้นกว่าเดิม.
 *
 * ⚠️ ค่านี้ถูกใช้ **สองที่** — `buildRawJsonBlock` และ `buildRawSiteRulesBlock`
 * ⇒ การขยายช่วยฝั่ง site rules ด้วย ซึ่งเป็นฝั่งที่เคยเกิดเหตุจริง: บัญชีฝากที่
 * เปิดอยู่ถูกตัดทิ้งเพราะเลยเพดาน โมเดลจึงเห็นแต่บัญชีปิดแล้วตอบลูกค้าว่า
 * "ฝากปิด" (21/08 16:59, `[PROMPT-BLOCKS] kind=site_rules len=20121`
 * + `_truncated` — ดู site-rules-block-slim.spec.ts:1-20).
 *
 * ⚠️ นี่คือเพดานเรื่อง **ค่า token** ไม่ใช่ข้อจำกัดทางเทคนิค — prompt ยาวขึ้น
 * = จ่ายแพงขึ้นต่อคำตอบ. ตรวจแล้วว่าไม่มีเพดานอื่นรออยู่ปลายน้ำ และไม่มีเทส
 * ตัวไหนผูกกับตัวเลขนี้ (parity spec แค่ re-export ชื่อ ไม่ได้ assert ค่า).
 *
 * revert: เปลี่ยนกลับเป็น 20000 — พฤติกรรมกลับไปตัดที่เดิมทันที ไม่มีอย่างอื่นตาม.
 */
export const RAW_JSON_MAX_CHARS = 25000;

export type ProfileData = Record<string, unknown>;

/**
 * legacy:483-523.
 *
 * ⚠️ TRANSCRIBED COUPLING — `excludeSiteRules` is the caller's `sendSiteRules`.
 * When BOTH switches are on, the site-rules endpoint is filtered out of this
 * dump because `buildRawSiteRulesBlock` is about to send it as its own block;
 * sending it twice costs tokens and gives the model two copies to disagree
 * about. When only `sendRawJson` is on, nothing is filtered and the dump is
 * complete — that is why the filter is conditional rather than always-on.
 *
 * ⚠️ TRANSCRIBED — `role === 'site_rules'` wins over the key-name guess, and the
 * `hasRole` probe is over ALL values: if any endpoint declares the role, the
 * name-based `/site.?rule/i` test is not consulted at all. `buildRawSiteRulesBlock`
 * picks with the same precedence, which is what keeps the two functions choosing
 * the same block.
 */
export function buildRawJsonBlock(
  profileData: ProfileData | null | undefined,
  excludeSiteRules = false,
): string {
  let src: ProfileData = profileData || {};
  if (excludeSiteRules) {
    try {
      const hasRole = Object.values(src).some(
        (v) => !!v && dig(v, 'role') === 'site_rules',
      );
      const filtered: ProfileData = {};
      for (const [k, v] of Object.entries(src)) {
        const isSite = hasRole
          ? !!v && dig(v, 'role') === 'site_rules'
          : /site.?rule/i.test(k);
        if (isSite) continue;
        filtered[k] = v;
      }
      src = filtered;
    } catch {
      /* กันพัง — ใช้ src เดิม */
    }
  }
  let body: string;
  try {
    /* [FEAT-20260829-EPOCHTHAI] เติม `<field>_th` ข้าง epoch ก่อน serialize.
       เลขเดิมยังอยู่ครบ — เพิ่มคู่ ไม่แทนที่ ⇒ โมเดลได้ทั้งค่าที่คำนวณได้และ
       ข้อความไทยที่รูปแบบตรงกับบรรทัด `Today is …` ที่มันได้รับอยู่แล้ว
       (webhook.service.ts:4602) จึงเทียบ "กี่วันมาแล้ว" ได้โดยไม่ต้องแปลงเอง.

       ⚠️ COPY-ON-WRITE เหมือน slimBankAccounts ข้างล่าง: `withThaiTime`
       deep-copy ก่อนเสมอ ⇒ `profileData` ของผู้เรียกไม่ถูกแตะ. สำคัญมาก เพราะ
       ก้อนนี้ถูกอ่านต่อโดย flex vars / notice / ticket / _error_trigger อีก
       ~29 จุดใน webhook.service.ts ซึ่งไม่ควรเห็นฟิลด์ที่งอกใหม่.
       ⚠️ webhook_logs เก็บ `raw_response: r?.data` ตั้งแต่ตอน fetch
       (external/custom-tool.service.ts:1385) ซึ่งเกิดก่อนบรรทัดนี้ ⇒ log ยังดิบ.
       พังเมื่อไหร่คืนก้อนเดิม (ฟังก์ชันไม่ throw) = พฤติกรรมเดิมเป๊ะ. */
    const withTime = withThaiTime(src);
    // ส่งทั้งก้อนตามที่ผู้ใช้เลือก — success/status ติดไปด้วย เพื่อให้ AI แยกออกว่า
    // "ลูกค้าไม่มีข้อมูล" กับ "ระบบดึงข้อมูลไม่ได้" ซึ่งต้องตอบลูกค้าคนละแบบ
    body = JSON.stringify(withTime, null, 2);
  } catch (e) {
    // circular ref หรืออะไรก็ตาม — ห้ามทำให้บอทตอบไม่ได้
    body = JSON.stringify({
      _error: 'serialize failed: ' + String(dig(e, 'message')),
    });
  }
  if (body.length > RAW_JSON_MAX_CHARS) {
    body =
      body.slice(0, RAW_JSON_MAX_CHARS) +
      '\n... (ตัดข้อมูลส่วนที่เหลือออกเพราะยาวเกิน)\n{"_truncated": true}';
  }
  return [
    RAW_JSON_START,
    'Raw Json Profile : enable = true',
    'Raw Json =',
    body,
    RAW_JSON_END,
  ].join('\n');
}

export const SITE_RULES_START = '[RAW_SITE_RULES_START]';
export const SITE_RULES_END = '[RAW_SITE_RULES_END]';

/**
 * legacy:531-557 — extracts only the site-rules endpoint from `profileData`.
 * Returns `""` when there is none, and the caller then sends nothing: the switch
 * being on with no site rules present is not an error.
 *
 * ⚠️ TRANSCRIBED — `break` on the FIRST match in each pass. Two endpoints with
 * `role: 'site_rules'` means the second is silently ignored, and object key
 * order decides which one wins.
 */
/**
 * ==== [FIX-20260821-SITERULESSLIM] keep every bank account inside the clip limit ====
 *
 * WHAT: before serialising, every `bank_account.accounts[]` entry in the
 * picked payload is reduced to the four fields the Training Document reads to
 * decide open/closed: `account_type`, `is_view`, `status`, `bank_code`.
 *
 * WHY: the block is pretty-printed and then clipped at RAW_JSON_MAX_CHARS.
 * The live demo-oa-three payload inflates to ~35k pretty-printed, so only 8 of 22
 * accounts survived the cut — and the ONE open deposit sat beyond it. The
 * model saw nothing but closed accounts, called the side closed, and sent the
 * maintenance card to a customer whose deposits worked (observed 21/08 16:59,
 * `[PROMPT-BLOCKS] kind=site_rules len=20121` + `_truncated`). The dropped
 * fields (`remark`, `report_daily`, `balance`, names, numbers, provider ids…)
 * are the very ones the prompt already FORBIDS the model to repeat, so
 * sending them bought truncation and leak risk and nothing else.
 * โมเดลไม่เคยเห็นใบที่เปิด เพราะโดนตัดทิ้งก่อนถึง — ตัด field ขยะออก บัญชีครบ 22 ใบ.
 *
 * HOW: copy-on-write — the walk deep-copies `picked` (JSON round-trip; the
 * data arrived as JSON) and slims the COPY. The caller's profileData is never
 * touched: flex vars and the panel cache read the same object afterwards.
 * Never throws (reply path): any failure returns the original picked object,
 * i.e. exactly the pre-slim behaviour, truncation and all.
 *
 * SCOPE: this builder only. `buildRawJsonBlock`'s dump stays full — when the
 * site-rules switch is off, that block is the model's only copy and slimming
 * it would change an unrelated behaviour.
 *
 * revert: delete SLIM_ACCOUNT_FIELDS + slimBankAccounts + the one call below,
 *         and z-test/unit/site-rules-block-slim.spec.ts goes with it.
 */
const SLIM_ACCOUNT_FIELDS = [
  'account_type',
  'is_view',
  'status',
  'bank_code',
] as const;

function slimBankAccounts(picked: ProfileData): ProfileData {
  try {
    const copy = JSON.parse(JSON.stringify(picked)) as ProfileData;
    const walk = (node: unknown, depth: number): void => {
      if (depth > 12 || !node || typeof node !== 'object') return;
      const rec = node as Record<string, unknown>;
      for (const [k, v] of Object.entries(rec)) {
        if (k === 'bank_account' && v && typeof v === 'object') {
          const ba = v as Record<string, unknown>;
          if (Array.isArray(ba.accounts)) {
            ba.accounts = ba.accounts.map((a) => {
              if (!a || typeof a !== 'object') return a;
              const src = a as Record<string, unknown>;
              const slim: Record<string, unknown> = {};
              for (const f of SLIM_ACCOUNT_FIELDS) {
                if (f in src) slim[f] = src[f];
              }
              return slim;
            });
          }
          continue;
        }
        walk(v, depth + 1);
      }
    };
    walk(copy, 0);
    return copy;
  } catch {
    return picked; // กันพัง — ตกกลับพฤติกรรมเดิมทั้งก้อน
  }
}

export function buildRawSiteRulesBlock(
  profileData: ProfileData | null | undefined,
): string {
  let picked: ProfileData | null = null;
  try {
    for (const [k, v] of Object.entries(profileData || {})) {
      if (!!v && dig(v, 'role') === 'site_rules') {
        picked = { [k]: v };
        break;
      }
    }
    if (!picked) {
      for (const [k, v] of Object.entries(profileData || {})) {
        if (/site.?rule/i.test(k)) {
          picked = { [k]: v };
          break;
        }
      }
    }
  } catch {
    picked = null;
  }
  if (!picked) return '';
  let body: string;
  try {
    body = JSON.stringify(slimBankAccounts(picked), null, 2);
  } catch (e) {
    body = JSON.stringify({
      _error: 'serialize failed: ' + String(dig(e, 'message')),
    });
  }
  if (body.length > RAW_JSON_MAX_CHARS) {
    body =
      body.slice(0, RAW_JSON_MAX_CHARS) +
      '\n... (ตัดข้อมูลส่วนที่เหลือออกเพราะยาวเกิน)\n{"_truncated": true}';
  }
  return [SITE_RULES_START, 'Site Rules =', body, SITE_RULES_END].join('\n');
}

/**
 * legacy:561-565 — the admin-written rules that accompany the raw json.
 * Returns `null` when empty so the caller omits the block entirely rather than
 * handing the model an empty box to interpret.
 */
export function buildRawJsonRulesBlock(rules: unknown): string | null {
  // verbatim. The field is a free-text admin textarea, so a non-string only
  // arrives through a direct API call; legacy sends its stringification to the
  // model rather than dropping the block, and so does this.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const body = String(rules == null ? '' : rules).trim();
  if (!body) return null;
  return [RAW_JSON_RULES_START, body, RAW_JSON_RULES_END].join('\n');
}

export const SITE_RULES_GUIDE_START = '[SITE_RULES_GUIDE_START]';
export const SITE_RULES_GUIDE_END = '[SITE_RULES_GUIDE_END]';

/**
 * legacy:575-579 — the twin of the above, for the site-rules block.
 *
 * ⚠️ TRANSCRIBED — the markers MUST differ from `RAW_JSON_RULES_*`. Sharing them
 * gives the model two boxes with the same name and contradictory contents, and
 * it picks one. Also note these two blocks are gated on DIFFERENT booleans:
 * `rawJsonRules` rides on `sendRawJson`, `siteRulesGuide` rides on
 * `sendSiteRules`. Collapsing them onto one switch is a behaviour change.
 */
export function buildSiteRulesGuideBlock(guide: unknown): string | null {
  // identical to `buildRawJsonRulesBlock` above and for the same reason.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  const body = String(guide == null ? '' : guide).trim();
  if (!body) return null;
  return [SITE_RULES_GUIDE_START, body, SITE_RULES_GUIDE_END].join('\n');
}

/**
 * legacy:585-595 [FEAT-20260802-THINKHOOK] — hook value (if valid) → env → 0.
 * Valid is -1 (dynamic) or 0..24576. A malformed value falls through to the next
 * source rather than erroring, so an unset hook with no env is 0, i.e. off, i.e.
 * exactly what every pre-existing hook already did.
 */
export function resolveThinkingBudget(hookBudget?: unknown): number {
  const isValid = (n: number) =>
    Number.isInteger(n) && (n === -1 || (n >= 0 && n <= 24576));
  if (
    hookBudget !== null &&
    hookBudget !== undefined &&
    isValid(Number(hookBudget))
  ) {
    return Number(hookBudget);
  }
  const raw = process.env['GEMINI_THINKING_BUDGET'];
  if (raw !== undefined && raw !== '' && isValid(Number(raw))) {
    return Number(raw);
  }
  return 0; // default ปิด
}

/**
 * legacy:624-632 [FIX-20260804-DYFILTER] — one bracket token, either `[0]` or
 * `[key=value]`.
 *
 * ⚠️ TRANSCRIBED — comparison is by STRING, because a provider sends `0` as a
 * number in one field and a string in another. And a filter that matches nothing
 * yields `undefined`, never "the first element": showing a customer a balance in
 * the wrong currency is worse than showing them nothing.
 */
export function _pickFromBracket(v: unknown, token: string): unknown {
  if (v === null || v === undefined) return undefined;
  const eq = token.indexOf('=');
  if (eq < 0) return (v as Record<number, unknown>)[Number(token)]; // [0] — ทางเดิม
  if (!Array.isArray(v)) return undefined;
  const key = token.slice(0, eq);
  const want = token.slice(eq + 1);
  // legacy: `it && String(it[key]) === want` — truthiness, so a `0` element is
  // skipped rather than probed. Kept.
  return (v as unknown[]).find(
    (it) => !!it && String((it as Record<string, unknown>)[key]) === want,
  );
}

/**
 * legacy:634-647 [FIX-20260803-DYTAGIDX] — dotted path reader that understands
 * `[n]` and stacked `[n][m]`.
 *
 * ⚠️ TRANSCRIBED — before this existed the reader treated every segment as a
 * literal key, so `deposit[0].status` looked for a key named `deposit[0]`,
 * found nothing, and the tag answered "N/A" silently. 11 of the 20
 * CUSTOMER_LOOKUP tags in the database were doing exactly that. There is exactly
 * ONE copy of this reader on purpose — it used to be declared twice (the
 * calculation branch and the plain branch) and fixing one left the other broken.
 */
export function _resolveDotIndexPath(o: unknown, p: unknown): unknown {
  return String(p)
    .split('.')
    .reduce<unknown>((curr, seg) => {
      if (curr === null || curr === undefined) return undefined;
      // แยก "ชื่อคีย์" กับ "[...]" ที่ห้อยท้าย (รับได้ทั้งเลข index และ key=value)
      const m = seg.match(/^([^[\]]*)((?:\[[^\]]*\])*)$/);
      if (!m) return (curr as Record<string, unknown>)[seg];
      const name = m[1] ?? '';
      let v: unknown =
        name === '' ? curr : (curr as Record<string, unknown>)[name];
      for (const tok of (m[2] ?? '').match(/\[([^\]]*)\]/g) || []) {
        if (v === null || v === undefined) return undefined;
        v = _pickFromBracket(v, tok.slice(1, -1));
      }
      return v;
    }, o);
}

/**
 * legacy:649-654.
 *
 * ⚠️ TRANSCRIBED — the two `data.` / `data.data.` retries exist because
 * `customToolService` wraps its result and the wrap depth varies by endpoint.
 * They fire on `undefined` OR `null`, so a path whose real value is `null`
 * re-reads at a deeper level and may return a *different field's* value.
 */
export function getNestedResilient(obj: unknown, path: unknown): unknown {
  let val = _resolveDotIndexPath(obj, path);
  if (val === undefined || val === null)
    val = _resolveDotIndexPath(obj, `data.${String(path)}`);
  if (val === undefined || val === null)
    val = _resolveDotIndexPath(obj, `data.data.${String(path)}`);
  return val;
}

/** The subset of a `dynamic_tags` row this file reads. */
export interface DynamicTagLike {
  tag: string;
  value: string;
  sub_type?: string | null;
}

/**
 * legacy:663-671 [FEAT-20260729-CUSTOOL] — pick the API block a dynamic tag
 * refers to. Order: legacy `Path : …` key → `sub_type` verbatim → `sub_type`
 * upper-cased (the custom-tool endpoint key).
 *
 * ⚠️ TRANSCRIBED — the custom-tool line keys results by ENDPOINT KEY, not by
 * path, because a path can move (v1→v3) and a key cannot. A `sub_type` that does
 * not match any endpoint key yields "N/A" with no error anywhere.
 */
export function pickApiSource(
  profileData: ProfileData | null | undefined,
  dTag: DynamicTagLike,
): unknown {
  if (!profileData) return undefined;
  const pathKey = `Path : ${String(dTag.sub_type)}`.trim();
  return (
    profileData[pathKey] ||
    profileData[dTag.sub_type as string] ||
    profileData[
      String(dTag.sub_type || '')
        .trim()
        .toUpperCase()
    ]
  );
}

/** Context handed to `applyFormat`, exactly the object legacy builds. */
export interface DynamicTagFormatContext {
  path: string;
  canonical: string;
  field: string;
}

/**
 * The `flexVarFormatRules.applyFormat` + `translationDictService.translate` pair
 * that legacy `require`s inside `computeDynamicTagValue`.
 *
 * ⚠️ PORT DIFFERENCE. Legacy resolves both with a late `require()`; here they are
 * passed in. The port repo does have both halves (`applyFormat` lives inside
 * `@/modules/content/flex-var/flex-var-guidelines.ts` and `translate` on
 * `TranslationDictCacheService`) but `applyFormat` is not exported from that
 * module's barrel and its in-repo copy drops the `tool` option that legacy passes
 * here — so binding to it would be a behaviour change, not a wiring change.
 * Injecting the pair keeps this file honest and keeps the decision with whoever
 * wires the module. Unbound ⇒ the raw value is used, which is what legacy does
 * when the require or the lookup fails.
 */
export interface DynamicTagFormatDeps {
  applyFormat?: (
    raw: unknown,
    ctx: DynamicTagFormatContext,
    translate: (dict: string, key: unknown) => string | null,
  ) => string | null;
  translate?: (
    dict: string,
    key: unknown,
    opt: { tool?: unknown; scope?: unknown; path: string },
  ) => string | null;
}

export interface DictOpts {
  tool?: unknown;
  scope?: unknown;
}

/**
 * legacy:698-756 — resolve one api-type dynamic tag. MAY THROW; the caller
 * catches, logs a `dynamic_tag_calculation_error` row, and falls back to "N/A".
 *
 * ⚠️ TRANSCRIBED — the operator scan is `["+","-","*","/"].find(op => value.includes(op))`
 * over the RAW path string. A path that legitimately contains a hyphen (or a
 * base64-ish segment) is therefore treated as a subtraction and split, which
 * throws "Invalid numbers for calculation". That is a live footgun and it is the
 * documented behaviour: tags are validated by the admin form, not here.
 *
 * ⚠️ TRANSCRIBED — the translation step is `if (hit) shown = hit`, so an empty
 * string from the dictionary is discarded and the raw value survives. Every
 * layer fails safe to the raw value.
 *
 * ⚠️ TRANSCRIBED — the HTML strip runs on the CALCULATED branch too, and it is a
 * regex, not a parser. `<` inside a value that is not markup will eat text.
 */
export function computeDynamicTagValue(
  apiSource: unknown,
  dTag: DynamicTagLike,
  dictOpts: DictOpts = {},
  deps: DynamicTagFormatDeps = {},
): string {
  const operators = ['+', '-', '*', '/'];
  const operator = operators.find((op) => dTag.value.includes(op));
  let resolvedValue = 'N/A';

  if (operator) {
    const parts = dTag.value.split(operator).map((p) => p.trim());
    const raw1 = getNestedResilient(apiSource, parts[0]);
    const raw2 = getNestedResilient(apiSource, parts[1]);
    const val1 = Number(raw1);
    const val2 = Number(raw2);
    if (isNaN(val1) || isNaN(val2)) {
      throw new Error(
        `Invalid numbers for calculation: "${String(raw1)}" ${operator} "${String(raw2)}"`,
      );
    }
    let result = 0;
    switch (operator) {
      case '+':
        result = val1 + val2;
        break;
      case '-':
        result = val1 - val2;
        break;
      case '*':
        result = val1 * val2;
        break;
      case '/':
        if (val2 === 0) throw new Error('Division by zero');
        result = val1 / val2;
        break;
    }
    resolvedValue = result.toString();
  } else {
    const rawVal = getNestedResilient(apiSource, dTag.value);
    /* [FEAT-20260803-TRANSDICT] แปลค่าให้เป็นภาษาคนก่อนส่งลูกค้า
     * ⚠️ เดิมเส้นนี้ String(rawVal) ตรง ๆ → dynamic tag แบบ api ส่ง "enable" /
     *    "wait-approve" / unix timestamp ดิบให้ลูกค้าเห็น ทั้งที่การ์ด flex แปลแล้ว
     * ⚠️ dTag.value เป็น path เต็มอยู่แล้ว เช่น data.profile.status
     *    → ตัด root ออกให้ตรงกับรูปแบบ canonical ของกฎ (รองรับทั้ง profile และ shop)
     * ⚠️ fail-safe ทุกชั้น: ไม่เข้ากฎ / dict ไม่มีคำ / พัง → คืนค่าเดิม */

    // verbatim. A dynamic tag whose path lands on an object DOES send the
    // customer "[object Object]"; that is a known bad output and the admin form
    // is where it is prevented. Guarding here would change what the customer
    // sees for tags that are live in the database today.
    let shown =
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      rawVal !== undefined && rawVal !== null ? String(rawVal) : 'N/A';
    if (rawVal !== undefined && rawVal !== null) {
      try {
        const full = String(dTag.value || '');
        const rel = full
          .replace(/^data\.profile\./, '')
          .replace(/^data\.shop\./, '');
        const { applyFormat, translate } = deps;
        // Unbound pair ≡ legacy's `require` throwing: keep the raw value.
        if (applyFormat && translate) {
          const hit = applyFormat(
            rawVal,
            {
              path: rel,
              canonical: rel.replace(/\[[^\]]*\]/g, '[]'),
              field: (rel.split('.').pop() ?? '').replace(/\[\d+\]/g, ''),
            },
            (d, k) =>
              translate(d, k, {
                tool: dictOpts.tool,
                scope: dictOpts.scope,
                path: full,
              }),
          );
          if (hit) shown = hit;
        }
      } catch (e) {
        logger.error(
          `[TRANSDICT] แปลค่า dynamic tag ไม่สำเร็จ ใช้ค่าเดิม: ${String(dig(e, 'message'))}`,
        );
      }
    }
    resolvedValue = shown;
  }

  // Smart Strip HTML: Extract text if value contains HTML (e.g., status buttons)
  if (typeof resolvedValue === 'string' && /<[^>]*>/.test(resolvedValue)) {
    resolvedValue = resolvedValue.replace(/<[^>]*>/g, '').trim();
  }
  return resolvedValue;
}

/* ---------------------------------------------------------------
   askGemini return shapes — legacy:936, 1056, 1075
--------------------------------------------------------------- */

/**
 * The fast-mode-2 return, legacy:936-939.
 *
 * ⚠️⚠️ TRANSCRIBED HAZARD, AND THE MOST DANGEROUS ONE IN THIS FILE. There is NO
 * `tagStatus` KEY. Not `tagStatus: null` — absent. The caller destructures it to
 * `undefined`, and its test is `tagStatus === null && noData`; `undefined ===
 * null` is false, so a fast-mode reply with no document does NOT take the
 * "not found" branch and the customer gets the fallback text rather than the
 * hook's `default_answer_text`.
 *
 * Declaring a single return type with `tagStatus: 'found' | 'not_found' | null`
 * is the obvious tidy-up and it is a customer-visible behaviour change that NO
 * test would catch, because the key is absent in JSON either way once it is
 * `undefined`. The union below exists to make the absence part of the type.
 */
export interface AskGeminiFastResult {
  text: string;
  noData: boolean;
}

/** The success and error returns, legacy:1056-1063 and 1075-1082. */
export interface AskGeminiApiResult {
  text: string;
  noData: boolean;
  tagStatus: 'found' | 'not_found' | null;
  http_status: number;
  error_message: string | null;
  response_data: unknown;
}

export type AskGeminiResult = AskGeminiFastResult | AskGeminiApiResult;

/* ===============================================================
   DI seams
=============================================================== */

/** Bind to `WebhookLogService` when the AI module is wired into the pipeline. */
export const WEBHOOK_LOG_SINK = Symbol('WEBHOOK_LOG_SINK');
/** Bind to `{ applyFormat, translate }`. See `DynamicTagFormatDeps`. */
export const DYNAMIC_TAG_FORMAT_DEPS = Symbol('DYNAMIC_TAG_FORMAT_DEPS');

/* ===============================================================
   Small helpers that exist only to satisfy the type checker
=============================================================== */

/** `a?.b?.c` over an unknown value — what untyped JS property access does. */
function dig(o: unknown, ...keys: string[]): unknown {
  return keys.reduce<unknown>(
    (cur, k) =>
      typeof cur === 'object' && cur !== null
        ? (cur as Record<string, unknown>)[k]
        : undefined,
    o,
  );
}

/** `Number.parseFloat(x)` already does ToString(x); this only types it. */
function parseFloatLoose(v: unknown): number {
  return Number.parseFloat(v as string);
}

/** `Number.parseInt(x, 10)` already does ToString(x); this only types it. */
function parseIntLoose(v: unknown): number {
  return Number.parseInt(v as string, 10);
}

/** legacy reads `res.data?.candidates?.[0]?.content?.parts?.[0]?.text`. */
/* [FEAT-20260908-AIVENDORERR] The FIFTH copy of the same Gemini reader, removed.
   `GeminiPayload` described exactly the shape the door's reader inlines
   (`candidates?[0].content?.parts?[0].text`) and nothing else referenced it, so
   the type went with the function. The four call sites below are unchanged and
   still wrap the result in their own `|| ''` / `|| fallbackText`, which is this
   file's own convention and not the reader's business.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 7 */

/** Legacy logs `err.response?.data || err.message` — an object or a string. */
function stringifyErr(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/* ===============================================================
   The service
=============================================================== */

/**
 * The three functions that need a database or a log sink. The rest of the legacy
 * module is above as free functions, because that is what it is: legacy exports
 * them from a module singleton with no state beyond `_docCacheById` and
 * `_aiRetrievalInFlight`, and both of those stay module-level so that a second
 * Nest instance would share them exactly as a second `require` does.
 *
 * `AiModule` is imported by `WebhookModule` (webhook.module.ts:194) and this
 * service is a provider/export of it (ai.module.ts:57-58); the Gemini reply and
 * assist providers depend on it. The two optional seams above are still unbound.
 */
@Injectable()
export class RagEngineService {
  constructor(
    @InjectModel(DynamicTag.name)
    private readonly dynamicTagModel: Model<DynamicTag>,
    @InjectModel(ChatMessage.name)
    private readonly chatMessageModel: Model<ChatMessage>,
    @Optional()
    @Inject(WEBHOOK_LOG_SINK)
    private readonly webhookLogSink?: WebhookLogSink,
    @Optional()
    @Inject(DYNAMIC_TAG_FORMAT_DEPS)
    private readonly formatDeps?: DynamicTagFormatDeps,
  ) {}

  /**
   * [FEAT-20260813-WRAPAI-W1D] Expose the THREE dyntag dependencies this service
   * OWNS so the re-homed tag path (webhook/reply-dyntag.ts + the provider's
   * outbound scan/report) can run outside `askGemini` without re-injecting the
   * model, the format token, or the log sink in a second module. This is a thin
   * accessor — NOT logic: it hands back the exact `dynamicTagModel`,
   * `this.formatDeps ?? {}`, and `this.webhookLogSink` that `askGemini` itself
   * uses (`:1390`, `:1459`, `:1503/1575/1726`), so the wrapped path resolves,
   * scans and REPORTS tags byte-identically to the legacy path (in prod
   * `formatDeps` is unbound → both see `{}` → `computeDynamicTagValue` returns the
   * raw value; `webhookLogSink` IS bound → the mismatch row is written just as
   * askGemini writes it — see ai.module.ts).
   *
   * The `finder` is typed structurally (`find().lean()`) to match reply-dyntag's
   * `DynamicTagFinder`, so no vendor/webhook type leaks into this file. The sink
   * is exposed as its `WebhookLogSink` type (already defined here) so the provider
   * can pass it straight into the exported `reportTagMismatch`.
   *
   * revert: delete this getter; nothing but the W1d provider switch reads it.
   */
  get dyntagDeps(): {
    finder: {
      find(q: Record<string, unknown>): { lean(): Promise<DynamicTagLike[]> };
    };
    formatDeps: DynamicTagFormatDeps;
    logSink: WebhookLogSink | null;
  } {
    return {
      finder: this.dynamicTagModel,
      formatDeps: this.formatDeps ?? {},
      logSink: this.webhookLogSink ?? null,
    };
  }

  /**
   * legacy:758-1084.
   *
   * ⚠️ SEVENTEEN positional parameters, in legacy's order. Legacy's own comment
   * at parameter 16 says the tail should have been collapsed into an options
   * object and that the author chose not to, because collapsing meant touching
   * every call site at once. The debt is transcribed with the code: this file
   * has no call site of its own, so collapsing here would have made the two
   * signatures un-diffable for zero benefit. If you collapse it, keep the field
   * ORDER identical so a reviewer can still read them side by side.
   *
   * ⚠️ The `parts` array order is load-bearing:
   *   rawJson → rawJsonRules → siteRules → siteRulesGuide → Document → Question.
   * The model reads the rules as applying to the block immediately above them.
   */
  /* 🔴 [NOTE-20260908-ASKGEMINI-UNCALLED] NO PRODUCTION CALLER. Established
     08/09/2026 by a sweep of src/ for invocations, not by reading a comment.
     Only `z-test/unit/rag-engine-parity.spec.ts` calls it, and a green spec is
     not a live path.

     WHY, AND WHY IT IS NOT A MISTAKE: `[FEAT-20260813-WRAPAI-W1D]` re-routed the
     reply path through the vendor-swappable funnel
     (substituteDynamicTags -> assembleReply -> resolveReplyTransport().send ->
     interpretReply), which is byte/response-equal to this method. The provider
     says so itself at `gemini-reply.provider.ts:14-38`, including: "askGemini
     stays in place, now unused by this path; removing it is a later, separate
     act." Its `revert:` line depends on this method still being here.

     ⚠️ CONSEQUENCE WORTH CARRYING: the retry ladder inside this method is
        therefore unreachable. Any argument of the form "retry already exists in
        two lanes" is really ONE lane — the reply ladder in
        `gemini-reply.transport.ts`. See `[PLAN-20260908-RETRYGAP]` in
        `ai-vendor/send.ts`.

     ⚠️ Owner decision 08/09/2026: left in place, not deleted. */
  async askGemini(
    question: string,
    docText: string | null,
    fastModeOverride?: unknown,
    geminiKey: string | undefined = GEMINI_API_KEY,
    suggestionText = '',
    profileData: ProfileData | null = null,
    geminiTemp?: unknown,
    geminiTopK?: unknown,
    geminiTopP?: unknown,
    hookId: unknown = null,
    // [FEAT-20260728-TAGSCOPE] กลุ่มของ hook (Hook.group) — optional
    hookGroupId: unknown = null,
    // [FEAT-20260731-RAWJSON] ส่ง JSON ดิบเข้า AI ด้วยไหม — default false
    sendRawJson: unknown = false,
    // [FEAT-20260731-RAWJSONRULES] ข้อความกติกาจากช่องในฟอร์ม (ว่างได้)
    rawJsonRules: unknown = '',
    // [FEAT-20260802-THINKHOOK] budget thinking ต่อ hook (null = ไม่ตั้ง)
    hookThinkingBudget: unknown = null,
    // [FEAT-20260802-RAWSITERULES] เปิด = ส่งก้อน site rules เข้า AI
    sendSiteRules: unknown = false,
    // [REFACTOR-20260803-DICTIDENTITY] P4 — คลังคำที่ OA นี้ใช้ { tool, scope }
    dictOpts: DictOpts = {},
    // [FEAT-20260804-SITERULESGUIDE] กติกาของก้อน site rules
    siteRulesGuide: unknown = '',
  ): Promise<AskGeminiResult> {
    // [PERF-20260802-TIMING2] แยกเวลาใน askGemini: prep(tag+build) vs Gemini API ล้วน
    const _tPrep = Date.now();
    const temperature = parseFloatLoose(
      geminiTemp ?? process.env['GEMINI_TEMPERATURE'],
    );
    const resolvedTemperature = Number.isFinite(temperature)
      ? temperature
      : 0.0;
    const topP = parseFloatLoose(geminiTopP ?? process.env['GEMINI_TOP_P']);
    const resolvedTopP = Number.isFinite(topP) ? topP : 0.1;
    const topK = parseIntLoose(geminiTopK ?? process.env['GEMINI_TOP_K']);
    const resolvedTopK = Number.isFinite(topK) ? topK : 1;
    const fallbackText = FALLBACK_TEXT;

    let finalSuggestionText = suggestionText || '';
    const resolvedTagsBuffer: { tag: string; value: string }[] = []; // always defined

    /* [FEAT-20260731-TAGMISMATCH] report-only state, never read by the caller.
     * `tagsLoaded` guards against false alarms: when the tag list was never
     * fetched (profileData is null, or the DB read threw) EVERY marker would
     * look unknown. ถ้าโหลดรายชื่อ tag ไม่สำเร็จ = ไม่รายงานอะไรเลย ดีกว่าเตือนมั่ว */
    const knownTagNames = new Set<string>();
    const mismatchedMarkers: string[] = [];
    let tagsLoaded = false;

    if (profileData) {
      // 1) FETCH DYNAMIC TAGS FROM DATABASE
      let dynamicTags: DynamicTagLike[] = [];
      const query = buildDynamicTagQuery(hookId, hookGroupId);
      try {
        dynamicTags = await this.dynamicTagModel.find(query).lean();
        dynamicTags.forEach((t) => t?.tag && knownTagNames.add(t.tag));
        tagsLoaded = true;
      } catch (tagErr) {
        logger.error(
          `[DYNAMIC TAG] Fetch error: ${String(dig(tagErr, 'message'))}`,
        );
      }

      // 2) PREPARE SYNC BASE TAGS (RETAIN OLD LOGIC FOR BACKWARD COMPATIBILITY)
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
      };

      // Replace Base Tags [[[tag]]]
      for (const [key, value] of Object.entries(baseReplacements)) {
        const regex = new RegExp(`\\[\\[\\[\\s*${key}\\s*\\]\\]\\]`, 'g');
        // `String(value)` is what `String.replace` does to a non-string
        // replacement; `$&` etc. keep their meaning either way.
        finalSuggestionText = finalSuggestionText.replace(regex, String(value));
      }

      // 3) RESOLVE DYNAMIC TAGS (ins_x_90...)
      for (const dTag of dynamicTags) {
        if (!finalSuggestionText.includes(dTag.tag)) continue;

        // Extract surrounding context (up to 60 chars) around the tag. Legacy
        // computes it and then logs nothing — the console.log is commented out
        // there. Kept because deleting it would hide that the reader exists.
        const tagIdx = finalSuggestionText.indexOf(dTag.tag);
        const ctxStart = Math.max(0, tagIdx - 30);
        const ctxEnd = Math.min(
          finalSuggestionText.length,
          tagIdx + dTag.tag.length + 30,
        );
        void finalSuggestionText
          .substring(ctxStart, ctxEnd)
          .replace(/\n/g, ' ')
          .trim();

        const apiSource = pickApiSource(profileData, dTag);

        let resolvedValue = 'N/A';
        if (apiSource && dTag.value) {
          try {
            resolvedValue = computeDynamicTagValue(
              apiSource,
              dTag,
              dictOpts,
              this.formatDeps ?? {},
            );
          } catch (calcErr) {
            const msg = String(dig(calcErr, 'message'));
            logger.error(
              `[DYNAMIC TAG ERROR] Tag: ${dTag.tag}, Formula: ${dTag.value}, Error: ${msg}`,
            );
            resolvedValue = 'N/A';

            // Log to Webhook Log under 'log_operation' channel.
            // [FEAT-20260808-DYTAGLOG] sink is now bound (ai.module.ts) so this
            // writes ONE webhook_logs row { channel, action_type, status,
            // error_message, raw_request:{tag,formula,sub_type}, reference_id }
            // on a dytag calc error — additive, existing collection, no schema
            // change; matches legacy ragEngineService.js:888-895.
            void this.webhookLogSink
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

        /* Replace in text (CRITICAL: Do not remove)
         * ⚠️⚠️ TRANSCRIBED HAZARD — `dTag.tag` is interpolated into a RegExp with
         * NO ESCAPING. A tag containing a regex metacharacter therefore matches
         * something other than itself, and the trailing `|${dTag.tag}` alternative
         * means a bare occurrence is replaced too. `escapeRegex` exists in this
         * repo (`@/common/utils`) and is deliberately NOT used here: escaping
         * changes which text gets substituted for tags that are already live in
         * the database, and the difference is silent. */
        const dRegex = new RegExp(
          `(?:\\{\\{|\\[\\[\\[|\\[\\[)\\s*${dTag.tag}\\s*(?:\\}\\}|\\]\\]\\]|\\]\\])|${dTag.tag}`,
          'g',
        );
        finalSuggestionText = finalSuggestionText.replace(
          dRegex,
          String(resolvedValue),
        );

        // Store in buffer for precise post-AI filtering
        resolvedTagsBuffer.push({
          tag: dTag.tag,
          value: String(resolvedValue),
        });
      }

      /* [FEAT-20260731-TAGMISMATCH] inbound scan (typos in the Training Doc).
       * MUST run AFTER the replace loop: a tag that resolved is already gone
       * from the text, so only genuinely unknown markers are left to find. */
      mismatchedMarkers.push(
        ...findUnknownTagMarkers(finalSuggestionText, knownTagNames),
      );
    }

    const finalInstruction = [
      finalSuggestionText,
      '---',
      `- If the answer is found, append "${TAG_FOUND}" at the end.`,
      `- If the answer is NOT found, append "${TAG_NOT_FOUND}" at the end.`,
      `- IMPORTANT: You MUST INCLUDE tags like [[[assist]]] exactly as they appear in the Document in your response.`,
    ]
      .filter(Boolean)
      .join('\n');

    // FAST MODE: no AI
    if (resolveFastMode(fastModeOverride) === 2) {
      const noData = !docText || !docText.trim();
      // fast mode skips the AI, still report the inbound scan
      reportTagMismatch(
        mismatchedMarkers,
        tagsLoaded,
        hookId,
        hookGroupId,
        this.webhookLogSink,
      );
      // ⚠️ NO `tagStatus` KEY. See AskGeminiFastResult. Do not add one.
      return {
        text: noData ? fallbackText : docText,
        noData,
      };
    }

    try {
      /* ⚠️ `String()` — see the note at the first call site: an undefined key used to
         reach the wire as the literal "undefined", and that is preserved. */
      const url = geminiUrl(MODEL_ID);

      const _tApiStart = Date.now(); // [PERF-20260802-TIMING2]
      logger.log(
        `[PERF-20260802-TIMING2] askGemini prep (tags+build): ${_tApiStart - _tPrep}ms`,
      );

      /* [PERF-20260802-THINKBUDGET] gemini flash enables "thinking" by default,
       * which costs ~15-18s. Our default is OFF (budget 0). Order: hook → env →
       * 0. ⚠️ ห้ามพัง: if the endpoint rejects thinkingConfig (400) we re-fire
       * without it rather than failing the reply. */
      const _thinkBudget = resolveThinkingBudget(hookThinkingBudget);
      const geminiBody: {
        system_instruction: { parts: { text: string }[] };
        contents: { parts: { text: string }[] }[];
        generationConfig: {
          temperature: number;
          topP: number;
          topK: number;
          thinkingConfig?: { thinkingBudget: number };
        };
      } = {
        system_instruction: {
          parts: [{ text: finalInstruction }],
        },
        contents: [
          {
            parts: [
              /* [FEAT-20260731-RAWJSON] แทรกก่อน Document เสมอ. Its own part, not
               * concatenated into the document, so the model sees two separate
               * sources instead of one blob whose halves disagree. Off (the
               * default) = this array is byte-identical to what it always was.
               * [FEAT-20260802-RAWSITERULES] with site rules on, the site-rules
               * endpoint is filtered OUT of this dump so it is not sent twice. */
              ...(sendRawJson === true
                ? [
                    {
                      text: buildRawJsonBlock(
                        profileData,
                        sendSiteRules === true,
                      ),
                    },
                  ]
                : []),
              /* กติกาตามหลังก้อนข้อมูล ก่อน Document. Same switch as the block
               * above: off = neither is sent; on but blank = this one is skipped. */
              ...(sendRawJson === true && buildRawJsonRulesBlock(rawJsonRules)
                ? [{ text: buildRawJsonRulesBlock(rawJsonRules) as string }]
                : []),
              // ก้อน site rules แยก (auto-inject เมื่อ ai_raw_site_rules on) ก่อน Document
              ...(sendSiteRules === true && buildRawSiteRulesBlock(profileData)
                ? [{ text: buildRawSiteRulesBlock(profileData) }]
                : []),
              /* กติกาตามหลังก้อน site rules — โครงเดียวกับ raw json เป๊ะ
               * (ข้อมูลก่อน แล้วค่อยกติกาที่อธิบายข้อมูลก้อนนั้น) */
              ...(sendSiteRules === true &&
              buildSiteRulesGuideBlock(siteRulesGuide)
                ? [{ text: buildSiteRulesGuideBlock(siteRulesGuide) as string }]
                : []),
              ...(docText ? [{ text: 'Document:\n' + docText }] : []),
              { text: 'Question:\n' + question },
            ],
          },
        ],
        generationConfig: {
          temperature: resolvedTemperature,
          topP: resolvedTopP,
          topK: resolvedTopK,
          thinkingConfig: { thinkingBudget: _thinkBudget },
        },
      };

      let res;
      try {
        res = await axios.post(
          url,
          geminiBody,
          geminiHttpOpts(String(geminiKey)),
        ); // [FIX-20260727-STALL] arg 3
      } catch (thinkErr) {
        // ถ้าเจ๊งเพราะ thinkingConfig (400) → ยิงซ้ำแบบเอาออก (ห้ามพัง)
        const st = dig(thinkErr, 'response', 'status');
        const em = JSON.stringify(
          dig(thinkErr, 'response', 'data') || '',
        ).toLowerCase();
        if (
          st === 400 &&
          geminiBody.generationConfig.thinkingConfig &&
          em.includes('think')
        ) {
          logger.warn(
            '[PERF-20260802-THINKBUDGET] endpoint ไม่รับ thinkingConfig → ยิงซ้ำแบบไม่มี (ตอบได้ปกติ)',
          );
          delete geminiBody.generationConfig.thinkingConfig;
          res = await axios.post(
            url,
            geminiBody,
            geminiHttpOpts(String(geminiKey)),
          );
        } else {
          throw thinkErr; // error อื่น = ปล่อยให้ catch เดิมจัดการ (fallback text)
        }
      }
      logger.log(
        `[PERF-20260802-TIMING2] gemini HTTP call (pure Google API): ${Date.now() - _tApiStart}ms · thinkBudget=${_thinkBudget}`,
      );

      const text = readGeminiText(res.data) || fallbackText;

      // TRULY RAW log to see if Gemini is sending the tag
      logger.log(`[GEMINI] (Truly Raw) text: "${text}"`);
      logger.log(
        `[GEMINI] System Instruction used: "${finalInstruction.substring(0, 300)}..."`,
      );

      /* ⚠️ TRANSCRIBED — `resolvedTagsBuffer` is filled above and then never
       * read: legacy's "which tags did the model actually use" logging is
       * commented out (legacy:1024-1035). The buffer is kept because deleting it
       * would delete the only record that the feature was built. */

      /* ⚠️ TRANSCRIBED — two `.test()` calls on `/g` regexes. Safe here only
       * because the `.replace()` below resets `lastIndex` on both every call.
       * Also note the if/else immediately below does NOTHING in either branch —
       * it is legacy's, kept, because the comments in it are the only statement
       * anywhere that not-found wins over found, and the ternary further down
       * relies on exactly that precedence. */
      const hasFoundTag = TAG_FOUND_REGEX.test(text);
      const hasNotFoundTag = TAG_NOT_FOUND_REGEX.test(text);
      if (hasNotFoundTag) {
        // not found tag takes priority
      } else if (hasFoundTag) {
        // found tag present
      }
      const cleanText = text
        .replace(TAG_FOUND_REGEX, '')
        .replace(TAG_NOT_FOUND_REGEX, '')
        .trim();

      /* [FEAT-20260731-TAGMISMATCH] outbound scan + single report. Catches the
       * case where the model copies a broken marker out of the chat history
       * rather than the document. cleanText is READ, never modified. */
      mismatchedMarkers.push(
        ...findUnknownTagMarkers(cleanText, knownTagNames),
      );
      reportTagMismatch(
        mismatchedMarkers,
        tagsLoaded,
        hookId,
        hookGroupId,
        this.webhookLogSink,
      );

      return {
        text: cleanText,
        noData: isFallbackText(cleanText),
        tagStatus: hasNotFoundTag ? 'not_found' : hasFoundTag ? 'found' : null,
        http_status: res.status,
        error_message: null,
        response_data: res.data,
      };
    } catch (err) {
      const message = (dig(err, 'response', 'data', 'error', 'message') ||
        dig(err, 'response', 'data', 'message') ||
        dig(err, 'message') ||
        'Gemini request failed') as string;
      logger.error(
        `Gemini error: ${stringifyErr(dig(err, 'response', 'data') ?? dig(err, 'message'))}`,
      );
      // AI failed, but the inbound findings are still valid
      reportTagMismatch(
        mismatchedMarkers,
        tagsLoaded,
        hookId,
        hookGroupId,
        this.webhookLogSink,
      );
      const text = 'โปรดลองอีกครั้งหรือกรุณาติดต่อเจ้าหน้าที่';
      return {
        text,
        noData: false,
        tagStatus: null,
        // ⚠️ `.trim()` on a non-string `message` throws OUT of this catch. Legacy
        // has the same edge and it has never fired, because every source above
        // is a string when present.
        http_status:
          (dig(err, 'response', 'status') as number | undefined) || 0,
        error_message: message.trim(),
        response_data: dig(err, 'response', 'data'),
      };
    }
  }

  /**
   * legacy:1140-1211 — summarise the conversation for a human admin when assist
   * is requested. Returns a fixed Thai summary + one of three English categories.
   *
   * ⚠️ TRANSCRIBED — `/v1/`, like `findRelevantText` and unlike `askGemini`.
   * ⚠️ TRANSCRIBED — three separate fallbacks, each with a different Thai string:
   *   parse produced no braces → `rawText` as the summary;
   *   parse threw            → logged, then the same;
   *   the request failed     → "เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา".
   * A caller distinguishes them only by the wording, so none may be merged.
   */
  /* 🔴 [NOTE-20260908-ANALYZECONV-UNCALLED] NO PRODUCTION CALLER, same shape as
     askGemini above. The live assist summary goes through
     `assist-summary.provider.ts:195` -> `resolveSummaryTransport(request.aiVendor)`,
     and that provider's own comment at `:178` records that it USED to call this
     method inline.

     🔴 AND IT COULD NOT DO WHAT A READER MIGHT EXPECT OF IT. This method is
        hard-wired to Gemini in its body — it builds a Gemini URL, a Gemini-shaped
        contents/parts request and reads a Gemini response, and imports no
        registry, transport or resolver. Routing the summary back through here
        would REMOVE per-hook vendor selection, not add it: the lane is already
        vendor-switchable and a hook set to `deepseek` really does reach
        api.deepseek.com (pinned by `wrap-ai-p2a-thread.spec.ts`, which spies
        axios and asserts the host).

     ⚠️ Owner decision 08/09/2026: left in place, not deleted. */
  async analyzeConversationForAdmin(
    history: string | null | undefined,
    currentQuestion: string,
    currentAnswer: string,
    geminiKey: string | undefined = GEMINI_API_KEY,
  ): Promise<{ summary: string; category: string }> {
    try {
      /* ⚠️ `String()` — see the note at the first call site: an undefined key used to
         reach the wire as the literal "undefined", and that is preserved. */
      const url = geminiUrl(MODEL_ID);

      const res = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  text: `
วิเคราะห์บทสนทนาระหว่างลูกค้าและบอท สรุปความต้องการของลูกค้าให้กระชับที่สุด และจัดหมวดหมู่ปัญหา
ตอบกลับเป็น JSON format เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "summary": "รายละเอียดความต้องการของลูกค้าสั้นๆ 1-2 บรรทัด (เช่น ต้องการปลดระบบ 'ติดกำกับ' หลังผ่อนชำระครบถ้วน)",
  "category": "หมวดหมู่ (ต้องเป็นหนึ่งในค่าภาษาอังกฤษที่กำหนดเท่านั้น)"
}

หมวดหมู่ที่อนุญาตให้ใช้มีดังนี้เท่านั้น (ห้ามใช้ค่าอื่นนอกจากนี้ ถ้าไม่เข้าเงื่อนไขใดเลยให้ลง Other ทันที):
- Collection (สำหรับ ทวงถาม: เช่น สอบถามยอดค้างชำระ, ถามยอดค่างวดของสัญญาเดิม, ต้องการจ่ายเงิน/ชำระค่างวด, ขอเลื่อนหรือต่อรองการจ่ายเงิน, การประนอมหนี้)
- IT (สำหรับ ไอที: เช่น อุปกรณ์มีปัญหา, หน้าจอโดนล็อค/เครื่องล็อค, ปัญหาเข้าแอพไม่ได้, ปัญหาเทคนิคและอุปกรณ์)
- Other (สำหรับ อื่นๆ หรือกรณีที่ไม่เข้าเงื่อนไขด้านบนเลย)

บทสนทนาย้อนหลัง:
${history || 'ไม่มีประวัติ'}

เหตุการณ์ล่าสุด:
- ลูกค้า: "${currentQuestion}"
- ระบบ (บอท): "${currentAnswer}"
`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            topP: 0.1,
            topK: 1,
          },
        },
        // [FEAT-20260908-GEMINIKEYHEADER] key as a header; same 30s stall ceiling
        geminiHttpOpts(String(geminiKey)), // [FIX-20260727-STALL] เดิมไม่มี argument ที่ 3
      );

      const rawText = readGeminiText(res.data) || '';

      // Attempt to parse the JSON output
      try {
        // Find the first { and last } to handle markdown formatting (```json)
        const start = rawText.indexOf('{');
        const end = rawText.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          const jsonStr = rawText.substring(start, end + 1);
          const parsed = JSON.parse(jsonStr) as {
            summary?: string;
            category?: string;
          };
          return {
            summary: parsed.summary || 'ไม่สามารถสรุปข้อมูลได้',
            category: parsed.category || 'Other',
          };
        }
      } catch (parseErr) {
        logger.error(
          `AI Analysis JSON parse error: ${String(dig(parseErr, 'message'))} Raw: ${rawText}`,
        );
      }

      // Fallback if parsing fails
      return {
        summary: rawText || 'ไม่สามารถวิเคราะห์ข้อมูลได้ในขณะนี้',
        category: 'Other',
      };
    } catch (err) {
      logger.error(
        `AI Analysis error: ${stringifyErr(dig(err, 'response', 'data') ?? dig(err, 'message'))}`,
      );
      return {
        summary: 'เกิดข้อผิดพลาดในการวิเคราะห์บทสนทนา',
        category: 'Other',
      };
    }
  }

  /**
   * legacy:1216-1267 — classify a room into one of twenty Thai categories from
   * its last five customer/bot text messages.
   *
   * ⚠️⚠️ [NOTE-20260810-CATEGORYUNPORTED] NOT WIRED INTO THE WEBHOOK, ON PURPOSE.
   * Owner confirmed 2026-08-10 that this stays unported: the twenty categories
   * below are acme's lending/collections taxonomy (acme runs two — a
   * 4-category set and this 20-category one), so they describe acme's
   * business, not a general OA's. `webhook.service.ts:2637` therefore leaves
   * `categorySettled` pre-resolved and never calls this, and the
   * `acme_category` flag that gates the feature defaults OFF.
   *
   * The function is kept — ported, tested against legacy in
   * `z-test/unit/rag-engine-parity.spec.ts`, and correct — because the flag can
   * legitimately be switched on for a acme deployment. What must not happen
   * is someone "completing the port" as cleanup: that would bill a model call on
   * every hand-off and stamp a acme category onto tenants who never opted
   * in. ตั้งใจไม่ต่อเข้า webhook ไม่ใช่ของค้าง.
   *
   * ⚠️ TRANSCRIBED — `limit(5)` is applied to messages of ANY type, and the
   * non-text ones are filtered out AFTERWARDS. A room whose last five messages
   * are images therefore classifies as "อื่นๆ" even though it has plenty of text
   * just above them. Moving the filter into the query changes the answer.
   * ⚠️ TRANSCRIBED — `.reverse()` after the descending sort, so the prompt reads
   * oldest-first while the *selection* is newest-first.
   * ⚠️ TRANSCRIBED — every failure path returns the same string "อื่นๆ", including
   * a malformed room id, which throws inside the `try` before any query runs.
   */
  /* 🔴 [NOTE-20260908-ANALYZECATEGORY-UNCALLED] NO PRODUCTION CALLER — and this
     one is unused BY DESIGN, built ahead of the feature that would use it.

     `webhook.service.ts:3911` carries `[NOTE-20260810-CATEGORYUNPORTED]`: the
     owner confirmed on 2026-08-10 that the omission is deliberate. The
     classifier is acme's, and its prompt hard-codes acme's twenty
     lending/collections categories (see the prompt below), so pointing it at a
     general OA would label rooms from a business the tenant is not in. The
     `acme_category` flag that gates the feature therefore defaults OFF, and
     the value this method would return is hard-coded as an already-resolved
     promise at the call site.

     ⚠️ Owner statement 08/09/2026: "built ahead, not used yet". Kept. */
  async analyzeCategoryFromRoom(
    roomId: string | Types.ObjectId,
    geminiKey: string | undefined = GEMINI_API_KEY,
  ): Promise<string> {
    try {
      const objId =
        typeof roomId === 'string' ? new Types.ObjectId(roomId) : roomId;

      const messages = (await this.chatMessageModel
        .find(
          { room_id: objId, sender_type: { $in: ['customer', 'bot'] } },
          { sender_type: 1, message_type: 1, content: 1, created_at: 1 },
        )
        .sort({ created_at: -1 })
        .limit(5)
        .lean()) as unknown as {
        sender_type?: string;
        message_type?: string;
        content?: unknown;
      }[];

      const textMessages = messages
        .filter(
          (m) =>
            m.message_type === 'text' &&
            typeof m.content === 'string' &&
            m.content.trim() !== '',
        )
        .reverse();

      if (textMessages.length === 0) return 'อื่นๆ';

      const conversationStr = textMessages
        .map(
          (m) =>
            `${m.sender_type === 'customer' ? 'ลูกค้า' : 'บอท'}: ${String(m.content).trim()}`,
        )
        .join('\n');

      /* ⚠️ `String()` — see the note at the first call site: an undefined key used to
         reach the wire as the literal "undefined", and that is preserved. */
      const url = geminiUrl(MODEL_ID);

      const res = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  text: `คุณเป็นผู้เชี่ยวชาญด้านการจำแนกหมวดหมู่บทสนทนาในธุรกิจสินเชื่อและการเงิน\nจงวิเคราะห์บทสนทนาด้านล่าง แล้วเลือกหมวดหมู่ที่ตรงที่สุด "เพียงหนึ่งหมวด" จากรายการที่กำหนดให้เท่านั้น แล้วตอบกลับเป็น JSON เท่านั้น ไม่ต้องอธิบายเพิ่ม\n\nรายการหมวดหมู่ที่อนุญาต (ต้องเลือกจากนี้เท่านั้น ห้ามสร้างหมวดใหม่):\n1. สอบถามยอดหนี้/ค้างชำระ\n2. แจ้งชำระเงิน/ส่งสลิป\n3. ขอเลื่อน/ผ่อนผันชำระ\n4. ขอปิดบัญชี/ยอดปิดบัญชี\n5. สมัครสินเชื่อ/ขอกู้เพิ่ม\n6. สอบถามสถานะอนุมัติ\n7. สอบถามดอกเบี้ย/ค่าธรรมเนียม\n8. ขอคืนเงิน\n9. แก้ไขข้อมูลส่วนตัว\n10. ทวงถาม/ติดตามหนี้\n11. ร้องเรียน/แจ้งปัญหา\n12. ปัญหาการใช้งานแอป/ระบบ\n13. ขอเอกสาร/สัญญา\n14. ขอใบเสร็จ/ใบกำกับภาษี\n15. ติดต่อเจ้าหน้าที่\n16. โปรโมชั่น/สอบถามผลิตภัณฑ์\n17. ภัยธรรมชาติ/เหตุสุดวิสัย\n18. ติดต่อนอกเวลาทำการ\n19. ทดสอบระบบ\n20. อื่นๆ\n\nกฎสำคัญ:\n- ต้องพยายามจัดเข้าหมวดหลัก (ข้อ 1-19) ก่อนเสมอ\n- เลือก "อื่นๆ" เฉพาะกรณีที่ไม่เข้าหมวด 1-19 ใดเลยจริงๆ เท่านั้น\n- ค่า category ต้องคัดลอกชื่อหมวดจากรายการให้ตรงเป๊ะ (ไม่ต้องใส่เลขลำดับ)\n\nโครงสร้าง JSON ที่ต้องตอบ:\n{ "category": "<ชื่อหมวดจากรายการ>" }\n\nบทสนทนา:\n${conversationStr}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.2, topP: 0.3, topK: 10 },
        },
        // [FEAT-20260908-GEMINIKEYHEADER] key as a header; same 30s stall ceiling
        geminiHttpOpts(String(geminiKey)), // [FIX-20260727-STALL] เดิมไม่มี argument ที่ 3
      );

      const rawText = readGeminiText(res.data) || '';
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(rawText.substring(start, end + 1)) as {
          category?: unknown;
        };
        if (
          parsed.category &&
          typeof parsed.category === 'string' &&
          parsed.category.trim()
        ) {
          return parsed.category.trim();
        }
      }
      return 'อื่นๆ';
    } catch (err) {
      logger.error(
        `[analyzeCategoryFromRoom] error: ${String(dig(err, 'message'))}`,
      );
      return 'อื่นๆ';
    }
  }
}
