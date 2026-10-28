/**
 * [FEAT-20260823-BCASTNEWSENDSPLIT] The pure half of the new send service.
 * ===========================================================================
 * MOVED, NOT CHANGED — every function below is byte-for-byte what it was in
 * `new-send.service.ts`, which crossed the 400-line ratchet on 23/08 while
 * `send_kind` / `card_type` / the actor logging were added to it.
 *
 * 🔴 THE WAIVER LIST MAY ONLY SHRINK (dev-local §6.1), so a file that crosses
 *    the line gets SPLIT and never waived. These are the parts that need no
 *    Mongo, no Nest and no clock — reading a field, naming a cell, shaping an
 *    outcome — so they move out whole and the service keeps only the work that
 *    genuinely needs its dependencies. ข้ามเส้นแล้วต้องแยก ไม่ใช่ยกเว้น.
 *
 * ⚠️ NO BEHAVIOUR CHANGE IS INTENDED HERE. The suite that covered these paths
 *    before the move is the same suite that has to pass after it; anything
 *    that goes red is a mistake in the move, not a discovery.
 *
 * revert: paste these back above the class and delete this file.
 */
import { Types } from 'mongoose';

import { LINE_BROADCAST_URL, LINE_MULTICAST_URL } from '@/infra/line';

import type { AudienceQuery } from '../audience';
import { summarizeRun } from '../broadcast-history';
import {
  failureSentence,
  SEND_MATRIX,
  type SavedCard,
  type SendCell,
} from '../broadcast-send';

import type { BroadcastRunReport } from './run-ports';

/**
 * The cell a job's `send_kind` selects.
 *
 * Anything this does not recognise falls back to `broadcast:plain` — but that
 * branch is unreachable in practice, because `usesNewSendPath` already refused
 * every value outside the set before the service was called. It is here so a
 * future kind added to one list and not the other degrades to the PROVEN cell
 * rather than to `undefined`. ตกหล่นแล้วต้องได้ของที่พิสูจน์แล้ว ไม่ใช่ undefined.
 */
export function cellFor(sendKind: unknown, cardType: unknown): SendCell {
  const kind = sendKind === 'multicast' ? 'multicast' : 'broadcast';
  const card = cardType === 'personal' ? 'personal' : 'plain';
  /* `broadcast:personal` exists in the matrix with `allowed: false` — a
     `/message/broadcast` carries no recipient list, so there is nowhere to put
     a per-person value. `run-plan.ts:129` refuses it with that cell's own
     reason rather than this file inventing one, which is why the impossible
     combination is RETURNED instead of being quietly corrected here.
     คู่ที่เป็นไปไม่ได้ ต้องถูกปฏิเสธพร้อมเหตุผล ไม่ใช่แอบเปลี่ยนให้. */
  return SEND_MATRIX[`${kind}:${card}`];
}

/**
 * [FEAT-20260823-BCASTACTOR] Who asked for this, and about which campaign.
 *
 * 🔴 EVERY LOG LINE ON THIS PATH CARRIES IT. A send failure that says only
 * WHAT broke is unanswerable at 2am: a campaign reaches real customers, and
 * the first two questions are always "which one" and "who set it off". Without
 * this the answer is a grep through `audit_logs` by timestamp, if the timing
 * happens to be close enough. บอกแต่ว่าพังอะไร ตอบไม่ได้ว่าใครกดของใคร.
 *
 * ⚠️ The NAME, never the whole actor object — an actor may carry more than a
 *    name and a log is the last place to widen what gets written down.
 */
export const who = (
  jobId: unknown,
  actor: { readonly id?: unknown; readonly name?: string },
  jobName?: unknown,
): string => {
  /* `idOf` and not `String()`: an actor id may be an ObjectId or a populated
     document, and `String({})` writes `[object Object]` into the log — a line
     that looks like it identifies somebody and does not.
     ใช้ตัวอ่าน id ตัวเดิม ไม่ใช่ String() ที่จะได้ [object Object]. */
  const id = idOf(actor.id);
  /* 🔴 THE NAME AS WELL AS THE ID. An id identifies the row; the NAME is what
     the admin who set it up calls it, what the list shows, and what they will
     say when they ask about it. A log line with only an id makes every
     conversation start with a lookup. ต้องมีชื่อด้วย ไม่ใช่แค่ id. */
  const name = textOf(jobName);
  return (
    `broadcast=${idOf(jobId) ?? 'unknown'}` +
    `${name === undefined ? '' : ` "${name}"`}` +
    ` by=${actor.name ?? 'unknown'}${id === null ? '' : `(${id})`}`
  );
};

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/** A non-empty string, or nothing. `''` is not a name, an alias or a type. */
export const textOf = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/**
 * Whatever an id column holds, as the string the pipeline needs. `null` means
 * "not usable AS GIVEN" — never a repaired value: `retry-key.ts` records what
 * repairing costs (two ids on one key, a 409, a chunk marked delivered).
 */
export function idOf(value: unknown): string | null {
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === 'string') return textOf(value) ?? null;
  // A populated ref comes back as the whole document, not as its id.
  if (isRecord(value) && '_id' in value) return idOf(value['_id']);
  return null;
}

/** Every hook id, or `null` when even one cannot be read. Fails CLOSED. */
export function hookIdsOf(raw: readonly unknown[]): string[] | null {
  const ids: string[] = [];
  for (const entry of raw) {
    const id = idOf(entry);
    if (id === null) return null;
    ids.push(id);
  }
  return ids;
}

/**
 * 🔴 `target.mode === 'group'` REFUSES. `audience-source.registry.ts` has no
 * group-membership key, and a rule that cannot be built is a filter that gets
 * DROPPED — which makes the audience WIDER, the exact silent widening
 * `buildAudienceFilter` refuses for an unknown key. ไม่ใช่ส่งให้ทุกคน.
 */
export function audienceFor(target: unknown): AudienceQuery | null {
  /**
   * [FEAT-20260824-BCASTMULTIOA] `mode: 'group'` NO LONGER REFUSES.
   *
   * 🔴 IT USED TO, AND THAT WAS RIGHT AT THE TIME. `group_ids` was stored and
   *    read by nobody, so a group selection could only mean "narrower than we
   *    can honour" — and reaching a WIDER list than an admin asked for is the
   *    failure this whole path is shaped around, so refusing was correct.
   *
   * 🔴 WHAT CHANGED IS WHAT A GROUP MEANS, and it was verified against the live
   *    data rather than assumed: `members` carries no group column at all, while
   *    `hooks.group` maps one group to many OAs. A group therefore selects
   *    **OAs**, never people — it cannot narrow an audience, and it cannot widen
   *    one either. The audience is still decided by `rules` alone, which is what
   *    the lines below read.
   *    group คัด OA ไม่ได้คัดคน ⇒ ไม่มีทางทำให้รายชื่อกว้างกว่าที่สั่ง.
   *
   * ⚠️ THE OA LIST IS ALREADY RESOLVED AND AUTHORISED BY THE TIME A RUN STARTS.
   *    `broadcasts.service.ts` expands the groups at SAVE time and checks every
   *    resulting OA against the admin's own scope, then stores the union in
   *    `hook_ids`. Expanding here instead would resolve groups with no admin in
   *    the room — a cron tick could reach an OA whose group membership changed
   *    after the job was authorised. ขยายกลุ่มตอนเซฟ ตอน cron ไม่มีใครให้เช็คสิทธิ์.
   *
   * ⚠️ An unknown mode still refuses. `'all'` and `'group'` are the two the
   *    normaliser accepts; anything else is a row nobody wrote on purpose.
   */
  const mode = isRecord(target) ? textOf(target['mode']) : undefined;
  if (mode !== undefined && mode !== 'all' && mode !== 'group') return null;

  /**
   * 🔴 [FIX-20260823-BCASTRULES] THE CONDITIONS ARE READ. They were not.
   *
   * This returned `{match:'and', rules:[]}` — every member of the OA —
   * whatever the job stored, so the entire audience feature was inert at the
   * one place it decides anything. Measured on 23/08 by running a real
   * scheduled send: a job carrying a rule for three named people targeted all
   * sixteen. `matched: 0` in every history row was the same fact, unread.
   * เงื่อนไขถูกทิ้งตรงนี้ ⇒ ยิงกว้างกว่าที่สั่งทุกครั้ง.
   *
   * ⚠️ AN EMPTY LIST STILL MEANS EVERYONE, and that is a real answer — a
   *    campaign to every follower is a normal thing to want. What changed is
   *    that a NON-empty list is no longer thrown away.
   *
   * ⚠️ NOT VALIDATED HERE. `buildAudienceFilter` owns that and REFUSES a job
   *    whose rule it cannot build; dropping one would make the audience wider
   *    than asked, which is the failure this whole path is shaped around.
   */
  const raw = isRecord(target) ? target : {};
  const rules = Array.isArray(raw['rules']) ? raw['rules'] : [];
  const match = raw['match'] === 'or' ? 'or' : 'and';
  return { match, rules };
}

/**
 * ⚠️ THE SAME FOUR FIELDS the old sender writes (`buildPayloadSummary`,
 * `broadcasts.service.ts:117-131`), rebuilt because that helper is module
 * private and this lane may not edit that file. Change one, change both.
 */
export function payloadSummaryOf(
  broadcastId: unknown,
  card: SavedCard | null,
  /* [FIX-20260826-LOGSENDKIND] ชนิดที่ยิงจริง (`cell.sendKind`) — เจ้าของเปิด log
     แล้วเจอ endpoint /multicast คู่กับ action_type "send_broadcast" และถามว่าบันทึกผิดไหม
     ⇒ `action_type` เป็น key ตระกูลที่ 4 ที่ยึดอยู่ (สิทธิ์ + ตัวกรอง FE สองที่ + dropdown)
       เปลี่ยนไม่ได้ · ชนิดจริงจึงบันทึกตรงนี้แทน — additive, แถวเก่าไม่มี field นี้ก็อ่านได้เหมือนเดิม
     ⚠️ optional เพื่อไม่หักผู้เรียกเดิม · ไม่ส่งมา = ไม่เขียน field (ไม่เดา) */
  sendKind?: string,
): Record<string, unknown> {
  const type = card?.type;
  return {
    broadcast_id: broadcastId,
    ...(sendKind ? { send_kind: sendKind } : {}),
    message_type: type,
    text: type === 'text' ? card?.text : undefined,
    image_url: type === 'image' ? card?.image_url : undefined,
    flex_json: type === 'flex' ? card?.flex_json : undefined,
  };
}

/** The endpoint the cell's pipe posts to. Asked, never typed. */
export const endpointFor = (cell: SendCell): string =>
  cell.sendKind === 'multicast' ? LINE_MULTICAST_URL : LINE_BROADCAST_URL;

/** One hook's answer, before it is split into a result row and a log row. */
export interface HookOutcome {
  readonly hookId: unknown;
  readonly ok: boolean;
  readonly error?: string;
  /**
   * [FIX-20260828-SKIPSTATUS] OA นี้ถูก **ข้าม** ไม่ใช่ยิงแล้วพัง
   *
   * 🔴 แยกจาก `ok` โดยตั้งใจ · `ok` ยังเป็น `false` เหมือนเดิมทุกประการ เพราะ
   *    มันคือสิ่งที่ตัดสิน `results[].status` และสถานะรวมของงาน — ถ้าเปลี่ยนเป็น
   *    `true` งานที่ทุก OA ถูกข้าม (ไม่มีใครได้รับสักคน) จะรายงานว่า "sent"
   *    แล้ว `claim.ts` จะปลดงานเป็น `sent` และรอบถัดไปไม่ถูกหยิบอีกเลย
   *    ⇒ ธงนี้บอกได้แค่ว่า "จะบันทึกลงประวัติด้วยคำว่าอะไร" ไม่ได้เปลี่ยนว่าเกิดอะไรขึ้น
   */
  readonly skipped?: boolean;
  /** `response_summary` — the run's own numbers, since LINE's body is gone. */
  readonly response: Record<string, unknown>;
}

/** Nothing was attempted. Every hook says why, in the same words. */
export function refuse(
  hooks: readonly unknown[],
  reason: string,
): HookOutcome[] {
  return hooks.map((hookId) => ({
    hookId,
    ok: false,
    error: reason,
    response: { refused: true, detail: reason },
  }));
}

/**
 * The report, per hook.
 *
 * 🔴 THE STATUS IS ASKED, NOT COMPUTED — `summarizeRun` derives it from the
 * counters. This only flattens its five statuses onto the two the legacy caller
 * understands, and `partial` flattens to ERROR: the old shape has no word for
 * "some of them", and calling it success would hide a half-sent campaign.
 * ครึ่ง ๆ กลาง ๆ ต้องนับเป็น error ไม่ใช่ success.
 */
export function outcomesFrom(
  hookIds: readonly string[],
  report: BroadcastRunReport,
): HookOutcome[] {
  const base = { run_id: report.runId, outcome: report.outcome };
  const detail = report.detail ?? report.error ?? `run ${report.outcome}`;

  return hookIds.map((hookId, index) => {
    const oa = report.result?.perOa.find((o) => o.hookId === hookId);
    if (oa === undefined) {
      // No per-OA row: the run never started, or the plan skipped this OA and
      // the others carried on. Both are errors for THIS hook.
      const skipped = report.plan?.perOa[index]?.skipReason;
      const why = skipped ? `this OA was skipped: ${skipped}` : detail;
      /* [FIX-20260828-SKIPSTATUS] มี `skipReason` = แผนตัดสินว่าไม่ต้องส่ง OA นี้
         ⇒ ไม่ใช่ความล้มเหลว · ไม่มี `skipReason` = รอบไม่ได้เริ่มเลย ซึ่งเป็น error จริง */
      return {
        hookId,
        ok: false,
        ...(skipped ? { skipped: true } : {}),
        error: why,
        response: { ...base, why },
      };
    }

    const c = oa.counters;
    const status = summarizeRun(c, {
      stopped: oa.stoppedBy !== undefined,
    }).status;
    const ok = status === 'success';
    const verdict = oa.stoppedBy
      ? `stopped: ${oa.stoppedBy}`
      : `run status: ${status}`;

    /**
     * [FEAT-20260824-BCASTWHYFAILED] The verdict, then the evidence.
     *
     * 🔴 THIS IS THE LINE THAT USED TO LOSE IT. `verdict` alone is what every
     *    failed row said before today — `"run status: error"` for a dead token,
     *    an exhausted quota and a rejected payload alike. `failureSentence`
     *    appends LINE's own answer WITHOUT removing the verdict, so nothing a
     *    reader relied on disappeared; the row only got longer.
     *    ของเดิมไม่ได้หายไปไหน แค่ต่อหลักฐานท้ายเข้าไป.
     */
    const why = failureSentence(verdict, oa.firstFailure);

    return {
      hookId,
      ok,
      ...(ok ? {} : { error: why }),
      response: {
        ...base,
        run_status: status,
        sent: c.sent,
        failed: c.failed,
        unsent: c.unsent,
        requests_made: c.requestsMade,
        /**
         * ⚠️ SPREAD, so a run where nothing failed writes NO key. A
         * `line_status: null` on a successful row would invite a reader to
         * treat "succeeded" and "failed for an unknown reason" as the same
         * shape. absent ≠ null. สำเร็จ = ไม่มีคีย์นี้เลย.
         */
        ...(oa.firstFailure?.status === undefined
          ? {}
          : { line_status: oa.firstFailure.status }),
        ...(oa.firstFailure?.reason === undefined
          ? {}
          : { line_reason: oa.firstFailure.reason }),
      },
    };
  });
}
