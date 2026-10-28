/**
 * [FEAT-20260813-EAGERROOM] Create the chat room the moment an event
 * identifies a real customer — instead of ~1,040 lines later as a side-effect
 * of `chatHistory.logMessage` (webhook.service.ts:2109).
 *
 * Owner intent (13 Aug): "ห้องต้องสร้างทันทีที่มี event … ไม่ชนของเดิม ไม่พัง
 * ถอดได้ … เปิดร่วมกับของเดิมได้ ห้องไม่ซ้ำ และไม่ได้ไปหยุด flow เดิม".
 *
 * HOW IT COEXISTS WITH THE OLD PATH (no edit over there):
 * `getOrCreateRoom` is an idempotent upsert on `{line_user_id, hook_id}` with a
 * unique index — when `logMessage` later runs its own upsert it simply no-ops.
 * ของเดิมไม่ถูกแตะแม้แต่บรรทัดเดียว เจอห้องแล้วก็เฉยเอง.
 *
 * ⚠️ AWAITED, NOT fire-and-forget — deliberate (ROOM-BOOTSTRAP-PLAN §7 rev2-F1):
 * a `void` call would race the member profile sync (webhook.service.ts:1297)
 * on the same unique member key `{line_user_id}`; the loser E11000s and either
 * this room create or the profile sync fails nondeterministically. Awaiting
 * restores today's strictly-sequential write order at the cost of ~2 indexed
 * queries. Errors are swallowed + logged — the pipeline NEVER stops here.
 *
 * ⚠️ `getOrCreateRoom` THROWS on failure (unlike `logMessage`, which swallows)
 * — the try/catch below is load-bearing, not style.
 *
 * Scope guards (verified 2026-08-13, doc §WH-E10):
 * LINE's modern Verify button sends `{destination, events: []}` (caught by the
 * `:803` no-events gate before we ever run) — the filters below only defend
 * against hand-crafted test payloads carrying the community dummy values, and
 * LINE module handover `mode: 'standby'` events.
 *
 * revert: delete the one call site in webhook.service.ts (grep EAGERROOM) and
 *         this folder. Rooms already created are inert data — no cleanup needed.
 */

/** The community/test dummy user LINE examples use — never a real customer. */
export const LINE_DUMMY_USER = 'Udeadbeefdeadbeefdeadbeefdeadbeef';

/** Verify-style tokens are all zeros (legacy dummies used all-f too). */
const DUMMY_REPLY_TOKEN = /^(0+|f+)$/i;

export interface BootstrapEvent {
  replyToken?: string;
  mode?: string;
  source?: { userId?: string };
}

export interface EnsureRoomDeps {
  getOrCreateRoom: (
    userId: string,
    profile: Record<string, never>,
    channelId: string | null,
    hookId: string,
    channelType: string,
  ) => Promise<unknown>;
  logError: (msg: string) => void;
}

export interface EnsureRoomArgs {
  event: BootstrapEvent;
  userId: string | undefined;
  hookId: string | null | undefined;
  channelId: string | null;
  channelType: string | null | undefined;
}

/**
 * Pure gate — exactly which events deserve an eager room.
 * Kept separate so it is trivially unit-testable.
 */
export function shouldBootstrapRoom(args: EnsureRoomArgs): boolean {
  const { event, userId, hookId } = args;
  if (typeof userId !== 'string' || userId.trim() === '') return false;
  // ⚠️ hookId is MANDATORY: getOrCreateRoom defaults it to null, and a
  // null-hook room is an orphan the message path can never find (a silent
  // duplicate). Refusing here is the guard. ห้องไร้ hook = ห้องกำพร้า ไม่สร้าง.
  if (typeof hookId !== 'string' || hookId.trim() === '') return false;
  if (userId === LINE_DUMMY_USER) return false;
  if (event.mode === 'standby') return false;
  if (
    typeof event.replyToken === 'string' &&
    event.replyToken.length >= 32 &&
    DUMMY_REPLY_TOKEN.test(event.replyToken)
  ) {
    return false;
  }
  return true;
}

/**
 * Ensure the room exists, sequentially (await me). Never throws.
 *
 * [FIX-20260814-EAGERPROFILE] The empty `{}` profile creates an IDS-ONLY
 * placeholder Member when none exists yet (chat-history.service.ts, the
 * `hasHint` branch) — the profile sync later in the same request then sees an
 * unsynced doc and fills the real name/picture/nickname. The original claim
 * here ("the sync $sets the real values — verified") was WRONG: the old
 * placeholder stamped display_name:'Unknown' + last_synced_at:now, which
 * satisfied the sync's needsRefresh guard (webhook.service.ts:1332-1335) and
 * suppressed the very fetch this comment relied on — every first-contact
 * customer stayed "Unknown" (live: 14/08 demo-shop logs). placeholder ต้องดูออก
 * ว่ายังไม่ sync — ห้าม stamp ชื่อปลอม/เวลา sync ปลอม.
 */
export async function ensureRoomOnEvent(
  deps: EnsureRoomDeps,
  args: EnsureRoomArgs,
): Promise<void> {
  if (!shouldBootstrapRoom(args)) return;
  try {
    await deps.getOrCreateRoom(
      args.userId as string,
      {},
      args.channelId ?? null,
      args.hookId as string,
      // Explicit, never the 'line' default — a facebook hook's room must not
      // be mislabeled (chat-history.service.ts:109-114 records that exact bug).
      args.channelType || 'line',
    );
  } catch (e) {
    deps.logError(
      `[EAGERROOM] room create failed (continuing, logMessage will retry): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}
