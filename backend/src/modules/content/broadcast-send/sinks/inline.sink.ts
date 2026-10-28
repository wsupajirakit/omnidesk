/**
 * [FEAT-20260822-BCASTINLINESINK] candidate E — the plug into push core.
 * ===========================================================================
 * D59, answered: the owner named broadcast, which is the condition
 * `docs/core-push.md` set for unlocking Phase 3 ("ล็อกอยู่ ห้ามทำจนกว่าเจ้าของ
 * สั่งชื่อ candidate"). This is **case 1 — a new caller**, the smallest of the
 * three cases that document defines:
 *
 *   · the kinds already exist (`multicast`, `broadcast` in `LineSendKind`)
 *   · both are already in `RETRY_KEY_KINDS`, so `X-Line-Retry-Key` rides free
 *   · the payload builder already exists (`buildBroadcastMessage`)
 *   ⇒ nothing is ADDED to core. Only a wire is connected to it.
 *   ต่อสาย ไม่ใช่สร้าง — คอร์ไม่ถูกแตะแม้บรรทัดเดียว.
 *
 * WHY THIS IS NOT DEBT — the three rules that would have made it debt:
 *
 * 1. It injects `LinePushDispatcher` (the wrapper), never `LinePushService`.
 *    The wrapper is where the queue swap happens in phase 4, so when bullmq
 *    arrives this file does not change. เผื่อท่อไว้แล้ว ไม่ต้องกลับมาแก้.
 * 2. It puts NO business rule inside core. Chunking, dedupe, ceilings, guards
 *    and retry keys are all decided before the request reaches here — which is
 *    the rule `line-push.ts` states for every caller.
 * 3. It does NOT touch `line.module.ts`'s `InlineLinePushQueue` binding. That
 *    binding is shared by every core caller, so swapping it for one feature
 *    would change behaviour for chat and quota too (แผน §S6).
 *
 * ⚠️ STILL NOT WIRED INTO A ROUTE. Constructing this class is what makes a
 *    broadcast reach LINE, and no service does that yet. The token seam below
 *    is deliberately abstract for the same reason.
 *
 * revert: delete this file and drop it from `sinks/index.ts`. Core is untouched,
 * so nothing else needs undoing.
 */
import { Injectable } from '@nestjs/common';

import type { LineMessage, LinePushDispatcher } from '@/infra/line';

import type { BroadcastChunk } from '../chunk';
import type {
  BroadcastChunkSink,
  ChunkResult,
  ChunkSendRequest,
} from '../chunk-sink';
import type { SendCell } from '../send-matrix.registry';

/**
 * Where the channel access token comes from.
 *
 * 🔴 A SEAM, not a convenience. `dev-local §4b` records the trap in this exact
 * area: `loadHookAccessToken` read `hook['line_key']`, but the live rows keep
 * the token in `access_token` — a field-name guess that returned `undefined`
 * and produced "Line access token is required" at the worst moment. Whoever
 * implements this MUST open a real row first, not the schema.
 * เปิดแถวจริงก่อน ห้ามเดาชื่อ field.
 *
 * Returning an empty string is safe: core answers `{ok:false, status:0}` and
 * makes no call at all.
 */
export interface HookTokenReader {
  tokenFor(hookId: string): Promise<string>;
}

/**
 * What one chunk's render produced.
 *
 * 🔴 THE COUNTS TRAVEL WITH THE MESSAGES. An earlier version returned only
 * `LineMessage[]`, so the card builder measured `imagesReplaced` and
 * `unknownTags` and then threw them away — which made `images_replaced: 0` in
 * every history row mean "never counted", indistinguishable from "every
 * picture was fine". A counter that cannot say "I don't know" lies by
 * construction. ตัวนับที่บอกว่า "ไม่รู้" ไม่ได้ = ตัวนับที่โกหกตั้งแต่เกิด.
 */
export interface ChunkMessages {
  readonly messages: LineMessage[];
  /** Broken picture URLs swapped for the fallback in THIS chunk. */
  readonly imagesReplaced: number;
  /** Tags nothing knew about — they rendered as `N/A`. */
  readonly unknownTags: readonly string[];
}

/** Renders the card for one chunk. For a personal card the chunk holds one id. */
export interface ChunkMessageBuilder {
  /**
   * @param hookId Which OA this chunk is going to.
   *
   * 🔴 [FEAT-20260823-BCASTOAVARS] ADDED, NOT CHANGED — and the distinction is
   * the whole point: the parameter is OPTIONAL, so every existing
   * implementation and every existing caller keeps compiling and behaving
   * exactly as before. `PlainCardMessageBuilder` did not even declare a
   * parameter, and still does not have to.
   *
   * WHY IT WAS NEEDED. A chunk carries `{index, to}` and nothing else, so a
   * builder could not tell WHICH OA it was rendering for — and `hook_*` /
   * `site_rules.*` differ per OA. Without this the card had to be rendered
   * with one map for the whole run, which is why `NO_VARS` was passed and
   * every variable in every broadcast came out as `N/A`.
   * ก่อนหน้านี้ builder ไม่รู้ว่ากำลังเรนเดอร์ให้ OA ไหน ⇒ ใส่ค่าอะไรไม่ได้เลย.
   */
  messagesFor(chunk: BroadcastChunk, hookId?: string): ChunkMessages;
}

/**
 * [FEAT-20260824-BCASTTRANSCRIPT] Told who a chunk actually reached.
 *
 * 🔴 THE ONLY PLACE THAT KNOWS THE TRUTH. The run report carries counters, not
 *    recipients, and the pager's port answers a `string[]` of LINE ids with no
 *    room attached. Re-deriving "who got it" afterwards would be a second pass
 *    over the audience that could disagree with what was dispatched — a member
 *    added between the send and the copy would get a transcript row for a
 *    message they never received. ที่นี่คือที่เดียวที่รู้ว่ายิงถึงใครจริง.
 *
 * ⚠️ IT MUST DO NO I/O. This runs inside the send loop, once per chunk. The
 *    implementation is an array push; the database work happens after the run,
 *    outside the loop. ห้ามมี I/O ตรงนี้ — เก็บใส่ array แล้วเขียนทีเดียวตอนจบ.
 *
 * ⚠️ OPTIONAL, like `renewLease` and `prefetchRecipients` before it. A sink
 *    built without one behaves exactly as it does today, which is what keeps
 *    the whole transcript feature deletable.
 */
export interface DeliveryCollector {
  /** Called ONCE per successfully dispatched chunk. Never for a failed one. */
  delivered(hookId: string | undefined, lineUserIds: readonly string[]): void;
}

@Injectable()
export class InlineChunkSink implements BroadcastChunkSink {
  constructor(
    private readonly dispatcher: LinePushDispatcher,
    private readonly tokens: HookTokenReader,
    private readonly messages: ChunkMessageBuilder,
    private readonly cell: SendCell,
    /**
     * [FEAT-20260824-BCASTTRANSCRIPT] Optional — absent means today's behaviour
     * exactly. Nothing in the send path reads what it collects.
     */
    private readonly collector?: DeliveryCollector,
  ) {}

  /**
   * ⚠️ NEVER THROWS — the sink contract, and the runner counts on it: one bad
   * chunk must cost one chunk, not the campaign. Anything unexpected becomes a
   * failed chunk with a readable reason.
   */
  async send(req: ChunkSendRequest): Promise<ChunkResult> {
    try {
      const token = await this.tokens.tokenFor(req.hookId);
      /* The sink has known the OA all along (`req.hookId`) and simply never
         passed it on. That is the entire fix on this side. */
      const built = this.messages.messagesFor(req.chunk, req.hookId);
      const { messages } = built;

      // A request with no message is a bug upstream, not something to send.
      if (messages.length === 0) {
        return { ok: false, sent: 0, error: 'no message to send' };
      }

      const result = await this.dispatcher.dispatch({
        kind: this.cell.sendKind,
        token,
        // 🔴 `broadcast` must carry NO `to`. LINE fans out to every friend of
        // the OA, and sending a list on that endpoint is a different request
        // than the one the plan costed. ท่อ broadcast ห้ามใส่รายชื่อ.
        ...(this.cell.recipientsPerRequest > 0
          ? { to: [...req.chunk.to] }
          : {}),
        messages,
        retryKey: req.retryKey,
      });

      /**
       * [FEAT-20260824-BCASTTRANSCRIPT] Record who this chunk reached.
       *
       * 🔴 ONLY ON SUCCESS, and only on a pipe that carries a recipient list.
       *    A failed chunk reached nobody, so a transcript row for it would put
       *    a message in a customer's history that never arrived. And the
       *    BROADCAST pipe has no `to` at all — LINE fans it out and never says
       *    to whom — so there is nothing truthful to record there.
       *    ยิงไม่สำเร็จ = ไม่มีใครได้รับ ⇒ ห้ามเขียน · broadcast ไม่รู้ว่าใครได้รับ ⇒ ไม่เขียน.
       *
       * ⚠️ Guarded, so a throwing collector cannot fail a chunk LINE already
       *    accepted — the same rule the whole sink follows.
       */
      if (result.ok && this.cell.recipientsPerRequest > 0 && this.collector) {
        try {
          this.collector.delivered(req.hookId, req.chunk.to);
        } catch {
          /* A copy that could not be recorded must never undo a real send. */
        }
      }

      return {
        ok: result.ok,
        status: result.status,
        // Core already reports 409 as ok:true (an earlier attempt with this key
        // won). The runner re-checks the status anyway — two locks, one door.
        /**
         * 🔴 `to.length` IS ZERO ON THE BROADCAST PIPE, by design — that
         * endpoint carries no recipient list. Reporting it verbatim made a
         * fully successful broadcast answer `sent: 0` against a field
         * documented as "recipients LINE accepted". The executor happens to
         * count from the plan instead, so it was latent rather than live, but
         * any future reader of `ChunkResult.sent` would inherit a wrong
         * number. `null` says "this pipe cannot know" — which is the truth.
         * ท่อ broadcast ไม่รู้จำนวนคน ⇒ ต้องบอกว่าไม่รู้ ไม่ใช่บอกว่าศูนย์.
         */
        sent: result.ok ? req.chunk.to.length : 0,
        ...(this.cell.recipientsPerRequest > 0
          ? {}
          : { recipientsUnknown: true as const }),
        imagesReplaced: built.imagesReplaced,
        ...(built.unknownTags.length > 0
          ? { unknownTags: built.unknownTags }
          : {}),
        ...(result.reason ? { error: result.reason } : {}),
      };
    } catch (e) {
      return {
        ok: false,
        sent: 0,
        error: e instanceof Error ? e.message : 'inline sink failed',
      };
    }
  }
}
