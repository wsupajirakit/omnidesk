/**
 * [P2-20260813] DeepSeek reply transport — vendor #2 behind the same seam.
 *
 * Implements `ReplyTransport` and nothing else: the neutral call in, a neutral
 * result out. Every DeepSeek-shaped decision (chat-completions body, Bearer
 * auth, `choices[0]`) dies inside this file — the assembler, the interpreter
 * and the provider never learn a second vendor exists. ทุกอย่างที่เป็น DeepSeek
 * ตายในไฟล์นี้ ไฟล์อื่นไม่รู้จักมันเลย.
 *
 * ⚠️ NOT registered yet. Adding the entry in `reply-transport.registry.ts` is a
 *    separate step (plan T13) because it flips `wrap-ai-w1b-transport.spec.ts`
 *    (which asserts today that 'deepseek' falls back to gemini) — that spec is
 *    updated in the same commit as the registration, never silently.
 *
 * ⚠️ [P2-20260813] `call.modelId` is now HONOURED. It used to be ignored on
 *    purpose, because the assembler resolved it from `MODEL_ID` with a Gemini
 *    default — passing that on would have asked DeepSeek for a Gemini model.
 *    The model is per hook now and the assembler passes `null` when the hook
 *    chose none, so this transport applies its OWN family default instead.
 *
 * Knobs with no DeepSeek equivalent are ignored ONCE with a log, never
 * silently: `topK` (no API field) and `thinkingBudget` (the reasoner decides its
 * own budget). ค่าไหนไม่มีที่ลง ต้องบอก ไม่ใช่เงียบ.
 *
 * revert: delete this file (and its registry entry if T13 already landed).
 */

import { Logger } from '@nestjs/common';

/* [FEAT-20260907-AIVENDORCORE] the one door — URL, timeout options and the reader.
   The body builder is NOT taken from it here: this transport's `buildDeepSeekBody`
   also carries `noteIgnoredKnobs` and the top_k contract note, so it keeps its own
   assembly and the door supplies only what was genuinely duplicated.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
import {
  DEEPSEEK_CHAT_URL,
  deepSeekHttpOpts,
  readDeepSeekText as readVendorText,
  familyModel,
  resolveModelId as resolveVendorModelId,
  vendorFailure,
  vendorSuccess,
  postToVendor,
  deepSeekReasoningWire,
} from '@/modules/ai-vendor';

import type { NeutralReplyCall } from '../../ai-reply/reply-neutral';
import type {
  ReplyTransport,
  TransportResult,
} from '../../ai-reply/reply-transport';

const logger = new Logger('DeepSeekReplyTransport');

/** DeepSeek's OpenAI-compatible chat endpoint. */
/* [FEAT-20260907-AIVENDORCORE] The URL moved to the leaf door. It is RE-EXPORTED
   here because `deepseek-summary.transport.ts` imports it from this file — that
   sibling edge is removed in the same change, but re-exporting keeps this file a
   valid import site for anything outside this folder that already depends on it.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
export { DEEPSEEK_CHAT_URL };

/** Same 30s ceiling the Gemini transport uses — a value, not a shared import. */
/* [FEAT-20260907-AIVENDORCORE] was declared here AND in the summary sibling AND
   in translate — three copies of one number. Now one, from the door. */

/**
 * This vendor's family default, applied when the hook chose no model.
 *
 * [P2-20260813] No env rung: the owner's rule is that every value shaping an
 * answer comes from the hook, and a server-level model would be exactly the
 * override that rule removes. `DEEPSEEK_MODEL_ID` was deleted with this change.
 * ค่า default ของค่าย ไม่ใช่ค่าที่ตั้งได้จาก server.
 */
/* [FEAT-20260908-AIVENDORMODELS] value from the door; name kept — two specs and
   the summary sibling import it from this path. */
export const DEEPSEEK_FAMILY_MODEL = familyModel('deepseek', 'reply');

/** The model this call asks for: the hook's choice, else the family default. */
export function resolveDeepSeekModelId(modelId?: string | null): string {
  return resolveVendorModelId(modelId, DEEPSEEK_FAMILY_MODEL);
}

/** ⚠️ Same `a?.b?.c`-over-unknown helper the Gemini transport uses (error mapping). */
/* [FEAT-20260908-AIVENDORERR] `dig` was declared in seven transports,
   identically. It comes from the door now. */

/* [FEAT-20260907-AIVENDORCORE] The reader moved to the leaf door VERBATIM — both
   guards included (`finish_reason === 'content_filter'`, and the non-empty-string
   narrowing that keeps a `null` content from slipping past the interpreters'
   `rawText === undefined` gate).
   RE-EXPORTED rather than deleted: `z-test/unit/wrap-ai-p2-deepseek-reply.spec.ts`
   imports it from this path, and a second definition is exactly the drift this
   change exists to remove. One implementation, two import sites.
   ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md */
export { readVendorText as readDeepSeekText };

interface DeepSeekMessage {
  role: 'system' | 'user';
  content: string;
}

interface DeepSeekBody {
  model: string;
  messages: DeepSeekMessage[];
  temperature: number;
  top_p: number;
  /**
   * [FEAT-20260909-DSREASONING] Present ONLY when the OA chose a reasoning
   * setting. Optional in the type for the same reason it is conditional in the
   * builder: a body without it must be the object it always was.
   */
  thinking?: { type: string };
  /** [FIX-20261014-DSEFFORTTOP] top level — where DeepSeek reads it. */
  reasoning_effort?: string;
}

/**
 * Neutral call → DeepSeek body.
 *
 * The blocks carry ORDER as data, and DeepSeek has no multi-part message, so
 * they are joined with a blank line in list order — that join is this adapter's
 * documented decision, and the spec pins it. Gemini keeps one part per block;
 * neither vendor may reorder.
 */
export function buildDeepSeekBody(call: NeutralReplyCall): DeepSeekBody {
  const base: DeepSeekBody = {
    model: resolveDeepSeekModelId(call.modelId),
    messages: [
      { role: 'system', content: call.instruction },
      { role: 'user', content: call.blocks.map((b) => b.text).join('\n\n') },
    ],
    temperature: call.knobs.temperature,
    top_p: call.knobs.topP,
  };
  /* [FEAT-20260909-DSREASONING] The OA's reasoning choice, when it made one.
     🔴 NO CHOICE ⇒ `base` IS RETURNED UNCHANGED — the same object, not a copy
     with a key omitted. Every hook written before this column resolves to
     null/undefined, so `ai-vendor-wire-baseline.spec.ts` pins the same bytes it
     always pinned and needed no edit.
     ⚠️ Attached here rather than in `@/modules/ai-vendor`'s builder: that door
     declares "FOUR KEYS, ALWAYS … adding one would change every DeepSeek
     request in the system at once", and it is shared with the translate lane. */
  const r = call.reasoning;
  if (!r) return base;
  /* [FIX-20261014-DSEFFORTTOP] effort at the top level, not inside `thinking` (ft17). */
  return { ...base, ...deepSeekReasoningWire(r) };
}

/**
 * Ignored-knob notice — deduped PER HOOK, not per process.
 *
 * ⚠️ REVIEW FIX: the first version used a single module-level boolean, so only
 *    the FIRST caller in the process ever got a line — every later OA's dropped
 *    knobs were silent, and the line that did print showed another OA's numbers.
 *    That is the silence the "never silently" promise forbids. Deduped by the
 *    dropped VALUES now, so a different configuration always gets its own line.
 *    ค่าชุดใหม่ต้องได้บรรทัดใหม่ ไม่ใช่เงียบเพราะมีคนอื่น log ไปแล้ว.
 *
 * The set is bounded by the number of distinct knob combinations in use.
 */
const knobNoticeSeen = new Set<string>();

/** Test seam: clears the dedupe so a spec can assert the log without ordering. */
export function resetIgnoredKnobNotice(): void {
  knobNoticeSeen.clear();
}

function noteIgnoredKnobs(call: NeutralReplyCall): void {
  // ⚠️ The neutral call carries NO hook id (reply-neutral.ts) — vendor-free by
  //    design — so the dedupe key is the dropped VALUES themselves. Two OAs with
  //    different budgets each get their own line (the bug being fixed); two
  //    turns of the same OA get one. Not a perfect per-OA key, and better than
  //    a process-wide flag that silenced everyone after the first.
  const seenKey = `${String(call.knobs.topK)}|${String(call.thinkingBudget)}`;
  if (knobNoticeSeen.has(seenKey)) return;
  knobNoticeSeen.add(seenKey);
  // `topK` is always a number on the neutral call (reply-neutral.ts:38), so it
  // is ALWAYS dropped for DeepSeek — say so rather than pretend it travelled.
  const ignored: string[] = [`topK=${String(call.knobs.topK)}`];
  if (call.thinkingBudget !== null) {
    ignored.push(`thinkingBudget=${String(call.thinkingBudget)}`);
  }
  logger.warn(
    `[P2-DEEPSEEK] ignoring knobs with no DeepSeek equivalent: ` +
      `${ignored.join(', ')} (deduped by value; the values stay in the hook, ` +
      `they just do not travel)`,
  );
}

export class DeepSeekReplyTransport implements ReplyTransport {
  async send(call: NeutralReplyCall): Promise<TransportResult> {
    const body = buildDeepSeekBody(call);
    try {
      // ⚠️ REVIEW FIX: inside the try. Everything else in this method converts a
      //    failure into a TransportResult; a throw from the notice would have
      //    been the one escape hatch out of that contract.
      noteIgnoredKnobs(call);
      // ⚠️ The key rides the Authorization header — never the URL, never a log.
      const res = await postToVendor(
        DEEPSEEK_CHAT_URL,
        body,
        deepSeekHttpOpts(call.apiKey ?? ''),
      );
      /* [FEAT-20260908-AIVENDORERR] the success envelope all six lanes shared. */
      return vendorSuccess(res, readVendorText(res.data));
    } catch (err) {
      // Same contract the interpreter gates on: rawText undefined AND
      // errorMessage non-null ⇒ the legacy error shape. No fallback TEXT here —
      // that is domain, and the shared interpreter owns it.
      /* [FEAT-20260908-AIVENDORERR] the mapping all six lanes shared, verbatim. */
      return vendorFailure(err);
    }
  }
}
