/**
 * [PROG-20260905-G34] Prompt assembly: history, time context and the now-block.
 *
 * WHAT IT PRODUCES. The three text blocks the model request carries, plus the operator's
 * suggestion after substitution. Nothing is sent here — the model call stays in the spine,
 * because WHEN it fires is a gate-order fact and this file has no business owning it.
 *
 * ⚠️ THE STABLE-PROMPT FORK IS A LIVE EMERGENCY SWITCH. `!== false`, not `=== true`:
 * Mongoose defaults apply on CREATE only, so an old hook row reads `undefined` and must
 * mean ON. Only an explicit `false` — the per-OA opt-out that needs no deploy — restores
 * the old prepend/inject path. Flipping this comparison silently switches every legacy OA
 * to the other layout.
 *
 * ⚠️ ORDER INSIDE IS BEHAVIOUR. Context variables are substituted LAST, after history and
 * the time line are already concatenated in: substituting earlier leaves anything appended
 * afterwards unsubstituted. The history marker is stripped OUTSIDE the try so a database
 * error cannot leak a raw [[[history]]] into the prompt.
 *
 * Args are DESTRUCTURED at the top and the body is left untouched — renaming values
 * through a moved body is what turned an object property into a positional argument twice
 * on an earlier cut.
 */

import { errText } from '../logging/coerce-mask.util';
import { nowBlockText } from '../now-block';
import { buildRoomFilter } from '../room-bootstrap/room-filter';
import {
  formatHistory,
  injectHistory,
  needsHistory,
  resolveHistoryLimit,
  substituteCtxVars,
} from './prompt-context.util';

type Doc = Record<string, unknown>;

/* `errText` and `buildRoomFilter` are both IMPORTED, not redeclared. Role files may import
   each other freely — only importing back from `webhook.service.ts` would be a cycle, which
   is why they were copied here in the first place. `errText` reached TWELVE copies before
   [PROG-20260905-ERRTEXT] gave it one home; the earlier note here argued it could stay
   local "because it is a two-line coercion with no schema in it", and twelve copies is the
   answer to that argument. */

export interface PromptAssemblyArgs {
  hook: Doc | null | undefined;
  userId?: string;
  /* `userText` is a string by this point in the spine — the no-text gate returned
     above it. Typed non-optional so the substitution below needs no cast. */
  userText: string;
  /** The Bangkok-time string the spine already formatted. */
  thaiNow: string;
  /** The same instant the spine formatted `thaiNow` from — the now-block reads it. */
  nowInstant: Date;
  /** The operator's suggestion text, before substitution. */
  suggestion: string;
}

export interface PromptAssemblyDeps {
  logger: { log: (m: string) => void; error: (m: string) => void };
  chatRoomModel: {
    findOne: (filter: Doc) => {
      lean: <T = Doc>() => { exec: () => Promise<T | null> };
    };
  };
  chatMessageModel: {
    find: (filter: Doc) => {
      sort: (order: Record<string, number>) => {
        limit: (n: number) => {
          lean: <T = Doc[]>() => { exec: () => Promise<T> };
        };
      };
    };
  };
}

export interface AssembledPrompt {
  suggestion: string;
  historyBlockText: string | undefined;
  timeContextText: string | undefined;
  nowContextText: string | undefined;
}

export async function assemblePrompt(
  args: PromptAssemblyArgs,
  deps: PromptAssemblyDeps,
): Promise<AssembledPrompt> {
  const { hook, userId, userText, thaiNow, nowInstant } = args;
  let suggestion = args.suggestion;

  const stablePrompt = hook?.['ai_stable_prompt'] !== false;
  const timeContext = `Today is ${thaiNow} (Bangkok Time)\n\n`;
  let historyBlockText: string | undefined;
  let timeContextText: string | undefined;
  if (stablePrompt) {
    timeContextText = `Today is ${thaiNow} (Bangkok Time)`;
  } else {
    suggestion = timeContext + suggestion;
  }
  /* [FEAT-20260902-NOWBLOCK] THE SINGLE GUARDED CALL — the whole seat.
   Off by default: `nowBlockText()` returns null unless the folder's own
   switch constant says on — there is no environment variable, owner's call
   03/09/2026 — and null on any internal failure, so nothing is added and
   the prompt keeps today's bytes on BOTH branches. ปิด = ไม่มี now เลย
   · stable layout  → rides as its own contents block before `question`
   · opt-out branch → prepended into the document text, where the time line
     already goes. It lands AFTER the fingerprint above on purpose: taken
     earlier, `doc_sha` would change on every request and stop meaning
     "the training document was edited".
   ⚠️ On the opt-out branch this text then passes through ctx-var and
   dynamic-tag substitution, which the stable branch never applies — the
   builder sanitises braces and newlines for exactly that reason.
   revert: delete this block, the import, and the `now-block/` folder. */
  const nowBlock = nowBlockText({
    hook,
    instant: nowInstant,
    datetimeTh: thaiNow,
  });
  let nowContextText: string | undefined;
  if (nowBlock) {
    if (stablePrompt) nowContextText = nowBlock;
    else suggestion = `${nowBlock}\n\n${suggestion}`;
  }
  try {
    if (needsHistory(suggestion)) {
      const historyRoom = await deps.chatRoomModel
        .findOne(buildRoomFilter(userId ?? '', hook?.['_id']))
        .lean<Record<string, unknown>>()
        .exec();
      if (historyRoom) {
        // [FEAT-20260730-HISTLIMIT] per-OA, clamped 1..30 so a bad row in
        // the database cannot pull thousands of messages into a prompt.
        // ⚠️ THIS history only. The "summarise for the admin" (10) and
        //    "categorise the room" (5) paths are separate and untouched.
        const historyMsgs = await deps.chatMessageModel
          .find({ room_id: historyRoom['_id'] })
          .sort({ created_at: -1 })
          .limit(resolveHistoryLimit(hook))
          .lean<Array<{ sender_type?: string; content?: unknown }>>()
          .exec();
        if (stablePrompt) {
          historyBlockText = formatHistory(historyMsgs);
        } else {
          suggestion = injectHistory(suggestion, formatHistory(historyMsgs));
        }
      } else if (stablePrompt) {
        historyBlockText = formatHistory([]);
      } else {
        suggestion = injectHistory(suggestion, formatHistory([]));
      }
    }
  } catch (historyErr) {
    deps.logger.error(`[HISTORY FETCH ERROR] ${errText(historyErr)}`);
  }
  /* [FEAT-20260830-STABLEPROMPT] strip the marker OUTSIDE the try so a
   history DB error can no longer leak a raw [[[history]]] into the
   prompt on the new path (the old path keeps its known behaviour —
   audit §5.4). replaceAll via injectHistory('') keeps the HISTALL
   two-marker rule for free. */
  if (stablePrompt && needsHistory(suggestion)) {
    suggestion = injectHistory(suggestion, '');
  }

  // [FIX-20260804-SUGGESTCTXVAR] LAST, after history and the time context
  // are already concatenated in — substituting earlier would leave text
  // appended afterwards unsubstituted.
  suggestion = substituteCtxVars(suggestion, hook, userText);

  /**
   * ═════════════════════════════════════════════════════════════
   * THE SEAM — legacy:4214-4254 (`ragService.askGemini`, 14 args)
   * ═════════════════════════════════════════════════════════════
   * Every field below is a legacy positional argument, one for one. What
   * is NOT below is the key: legacy passes `geminiApiKey` as argument 4,
   * and it is absent here by design. See ai-reply.provider.ts.
   *
   * ⚠️ `profileData: apiErrorTrigger ? null : profileData` — when the
   *    profile fetch failed the model is given NO data rather than partial
   *    data, so it cannot answer from a half-filled profile.
   */
  return { suggestion, historyBlockText, timeContextText, nowContextText };
}
