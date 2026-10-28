/**
 * [FEAT-20260902-NOWBLOCK] The switch — ONE decision point, and it is off by default.
 * ===========================================================================
 * Every caller asks this function. Nothing anywhere else reads the environment for
 * this feature, and that is the whole design: the day the switch should be read per
 * OA instead of per server, the change happens INSIDE this function and no call site
 * moves. ท่อเผื่อไว้แล้ว — วันเปลี่ยนเป็นราย hook แก้ในฟังก์ชันนี้ที่เดียว
 *
 * ── THE LADDER — three rungs, and the empty one is the point ──────────────
 *   layer 1  hook   NOT READ YET. The parameter exists so per-OA is a one-line
 *                   change here. ⚠️ Do not delete it because it looks unused —
 *                   removing it is what would turn C3 into real work later.
 *   layer 2  env    `AI_NOW_BLOCK` ([FEAT-20261018-NOWBLOCKENV], owner 18/10/2026) —
 *                   `on` / `true` / `1` ⇒ on · `off` / `false` / `0` / `no` ⇒ off ·
 *                   unset, empty or anything else ⇒ falls through to layer 3.
 *   layer 3  const  NOW_BLOCK_DEFAULT_MODE — `'off'`.
 *
 * ── 🟢 18/10/2026: THE ENV LAYER IS BACK — OWNER'S CALL ─────────────────────
 * *"ต้องอ่าน AI_NOW_BLOCK จาก env ถ้าหาไม่เจอหรือไม่มีค่า = off · คนที่ไม่ตั้งห้ามพัง"*. The two
 * sites run on separate servers with separate environments, so the variable is how the
 * loan site turns the block on while shop-api — which never sets it — keeps today's prompt.
 * The rules that keep the 03/09 worry (below) from coming back:
 *   · declared in `env.schema.ts` as an optional string — it cannot fail a boot;
 *   · read through `getValidatedEnv()` inside a try/catch, exactly like
 *     `ai-translate/translate-http-timeout.ts` — before validation it answers OFF instead
 *     of throwing on the reply path;
 *   · only a clear yes turns it on; a typo is OFF, never ON.
 *   · `now-block-mode.spec.ts` [NOWBLOCKENV] pins the whole matrix, so an env that
 *     "looks wired but reads nothing" goes red by name.
 *
 * ── (history) 03/09/2026: THE ENV LAYER WAS REMOVED — OWNER'S CALL THEN ─────
 * An earlier version of this file read `process.env.AI_NOW_BLOCK === 'on'` between
 * the two rungs above. The owner removed it: *"เอา env ออก — const ตัวเดียวใน code"*.
 * The closest live precedent agrees — `resolveQrPrescanMode` (qr-prescan/index.ts:63-68)
 * reads a hook field, falls back to a const, and touches no environment at all.
 *
 * What that buys, and it is not nothing: there is now exactly ONE way this feature
 * can be turned on, it is visible in a diff, it goes through review, and it reverts
 * with the commit. An env var can be typed into a deploy panel by anyone, leaves no
 * trace in the repository, and — as `[FIX-20260829-STRIKEENVDEAD]` cost this project
 * in production — can look wired while reading nothing.
 * What it costs: flipping the switch is a deploy, not a restart. Accepted.
 * เปิด/ปิด = แก้ค่าคงที่บรรทัดเดียวแล้ว deploy · ไม่มี env ให้ไปตั้งที่อื่น
 *
 * (03/09) There was likewise no entry in `env.schema.ts` — reversed 18/10, see above.
 *
 * ── WHY IT IS STILL RESOLVED PER CALL ─────────────────────────────────────
 * The const could have been read straight at each call site. It is not, because the
 * whole shape exists so layer 1 can land later: the day the answer depends on which
 * OA is asking, it MUST be computed per call, and every caller already asks a
 * function rather than a constant. Measured cost: one call on a path that then
 * awaits a language model for seconds.
 *
 * revert: delete the `now-block/` folder.
 */

/** On or off. No third state — an unreadable value is off, never an error. */
import { getValidatedEnv } from '@/config/env.schema';

export type NowBlockMode = 'on' | 'off';

/**
 * 🔴 **THE SWITCH.** Flip this to `'on'` and deploy to enable the feature server-wide.
 *
 * ⚠️ Before it is ever flipped for a real OA, `HOLIDAYS_PENDING` in
 * `calendar/th-holidays.ts` must be empty — while it is not, the calendar answers
 * "ordinary working day" on days that are public holidays, which is a confident
 * wrong answer rather than a missing one. A spec pins that invariant.
 *
 * ── WHAT `'off'` GUARANTEES, AND WHY NO PARITY HARNESS GUARDS IT ───────────
 * Owner's assessment, 03/09/2026, and it is correct: the constant IS the control,
 * so an OFF build needs no byte-comparison harness to prove it changes nothing.
 * The chain is structural, not statistical — every link is a no-op, not a small
 * difference:
 *
 *   this constant is `'off'`
 *     → `nowBlockText()` returns `null` before it computes anything
 *     → `webhook.service.ts` leaves `nowContextText` undefined on BOTH branches
 *     → `AiReplyRequest.nowBlockText` is absent
 *     → `buildBlocks` pushes no `kind: 'now'` (reply-blocks.ts, non-empty guard)
 *     → the wire bytes are the ones that shipped before this folder existed.
 *
 * The remaining edits on the OFF path are types only: a union member in
 * `reply-neutral.ts`, an optional field on the provider request, one pass-through
 * in the assembler. None of them executes when the field is undefined.
 *
 * ⚠️ ONE line on the OFF path is NOT covered by this constant, and it is named
 * here rather than left for someone to find: `webhook.service.ts:5491-5492` now
 * calls `formatThaiDateTime(nowInstant)` where it used to call it with no
 * argument. That module-private formatter (`webhook.service.ts:531`) does
 * `dateInput ? new Date(dateInput) : new Date()`, so a valid Date in yields the
 * same string — and it removes a second clock read, which is strictly better than
 * what was there. If that formatter is ever changed, this is the line to re-check.
 *
 * Mutation cover for the chain above: flipping this constant to `'on'` turns 13
 * cases red, and deleting the seat's guarded call turns 3 more red.
 */
export const NOW_BLOCK_DEFAULT_MODE: NowBlockMode = 'off';

/**
 * [FEAT-20261018-NOWBLOCKENV] What `AI_NOW_BLOCK` says, or `null` = "not set / not clear"
 * (the caller then uses the const). Never throws: before the environment is validated
 * `getValidatedEnv()` throws, and that must not reach a customer's reply.
 */
function nowBlockModeFromEnv(): NowBlockMode | null {
  let raw: string | undefined;
  try {
    raw = getValidatedEnv().AI_NOW_BLOCK;
  } catch {
    return null;
  }
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'on' || v === 'true' || v === '1') return 'on';
  if (v === 'off' || v === 'false' || v === '0' || v === 'no') return 'off';
  return null;
}

/**
 * Is the block on for this reply?
 *
 * @param _hook the OA document, accepted today and deliberately not read — layer 1
 *              of the ladder above. Pass it from every call site from day one.
 *
 * ⚠️ THE UNDERSCORE IS THE ONLY THING MARKING IT UNUSED. `noUnusedParameters` is on
 * (tsconfig.json:31), and this repo's convention for a parameter that exists for a
 * future reader is exactly this prefix — see `mustRecheckCeiling(_trigger)` in
 * content/broadcast-send/run-trigger.ts:59, a seam of the same kind. Implementing
 * layer 1 means dropping the underscore and reading the field; it does NOT mean
 * changing any signature, and no call site moves.
 */
export function resolveNowBlockMode(
  _hook: Record<string, unknown> | null | undefined,
): NowBlockMode {
  /* The repo's shape for a parameter that exists for a future reader: the
     underscore satisfies tsconfig's noUnusedParameters, the `void` satisfies
     eslint's no-unused-vars, and together they say "kept on purpose" more loudly
     than a disable comment would. Same pair as `mustRecheckCeiling(_trigger)`
     (content/broadcast-send/run-trigger.ts:59) and `NoopRecipientLedger.record`. */
  void _hook;

  /* layer 1 — per-OA. Intentionally empty, and empty for a reason: no OA carries
     such a field today, and writing a reader for data that cannot exist yet is the
     kind of speculative guard this repo has decided against. When it lands it reads
     `_hook?.['ai_now_block']` here and falls through to the const below when unset,
     so an OA can opt in or out while the server-wide default keeps working for
     everyone else. Nothing outside this function changes on that day. */

  // layer 2 — the server's environment (18/10). Unset / unclear ⇒ null ⇒ layer 3.
  const fromEnv = nowBlockModeFromEnv();
  if (fromEnv !== null) return fromEnv;

  // layer 3 — the const, 'off'.
  return NOW_BLOCK_DEFAULT_MODE;
}
