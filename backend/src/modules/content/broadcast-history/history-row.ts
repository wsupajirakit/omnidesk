/**
 * [FEAT-20260822-BCASTHISTROW] One OA's run, turned into one stored row.
 * ===========================================================================
 * Pure on purpose: every number that will be read back months later is decided
 * here, where a spec can check it, rather than inside a service where it can
 * only be checked by sending a real campaign.
 * ตัวเลขที่จะถูกอ่านย้อนหลัง ต้องตัดสินในที่ที่เทสเข้าถึงได้.
 *
 * ⚠️ ONE ROW PER OA, not per run. `broadcasts_histories.hook_id` is a single
 *    field, so "which OA did badly?" is answerable only if each OA gets its
 *    own row. The run-level totals are the sum of them.
 *
 * ⚠️ NO RECIPIENT IDS. The owner asked for the counts and explicitly not the
 *    list ("เจอใครบ้างอันนี้ไม่ต้องเก็บ มันจะยาวไป"), with the door left open —
 *    `recipients_captured` records WHICH capture switches were on, so a row
 *    written today can be told apart from one written after the door opens.
 *
 * revert: delete this file; only the run service and its spec use it.
 */
import { failureSentence } from '../broadcast-send/chunk-failure';
import type { OaOutcome } from '../broadcast-send/run-executor';
import type { SendCell } from '../broadcast-send/send-matrix.registry';

import { summarizeRun, type RunCounters } from './run-counters';

export interface HistoryRowInput {
  readonly broadcastId: unknown;
  readonly runId: string;
  readonly broadcastName?: string;
  readonly cell: SendCell;
  /**
   * OA display names, keyed by hook id.
   *
   * 🔴 A MAP, NOT ONE STRING. This used to be a single run-level `hookAlias`
   * applied to EVERY row — so a three-OA run wrote three rows all naming the
   * first OA. Reading that log back, a human would blame the wrong channel for
   * a stop that happened somewhere else, which is the exact opposite of what a
   * log is for.
   * ชื่อ OA ต้องเป็นราย OA — ค่าเดียวใช้ทุกแถวคือ log ที่ชี้ผิดตัว.
   */
  readonly hookAliases?: Readonly<Record<string, string>>;
  readonly triggeredBy: 'manual' | 'scheduler';
  readonly triggeredByUser?: unknown;
  readonly triggeredByName?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  /** How stale the site-rules blob was, when one was used. */
  readonly siteRulesAgeDays?: number;
  /**
   * [FEAT-20260903-BCASTSRAGE] The same fact, PER OA — which is the only way it
   * can be true.
   *
   * `siteRulesAgeDays` above is one number for the whole run, and a run reaches
   * up to 20 channels whose blobs were fetched at completely different times.
   * Writing the run-level number onto every row would state a fact about OA #1
   * on the row of OA #7. This map wins where it has an entry; the run-level
   * value stays as the fallback so every existing caller writes what it wrote.
   * อายุเป็นของ OA แต่ละตัว ไม่ใช่ของทั้ง run.
   */
  readonly siteRulesAgeDaysByHook?: Readonly<Record<string, number>>;
  /** Which capture switches were on — all three are off today. */
  readonly recipientsCaptured: Readonly<Record<string, boolean>>;
  /**
   * [FEAT-20260907-BCASTUNUSEDRULES] This round dropped the audience conditions
   * its job carried, because its pipe cannot address anybody.
   *
   * ⚠️ OPTIONAL, AND ONLY EVER `true`. The caller (`broadcast-run/run-io.ts`)
   *    derives it and omits it otherwise, so a caller that predates this — and
   *    every ordinary round — produces exactly the row it produced before.
   *    Not this case means NO KEY, not `false`.
   */
  readonly audienceRulesIgnored?: boolean;
  readonly errorMessage?: string;
  /**
   * [FEAT-20260824-RUNSNAPSHOT] What the campaign was SET TO for this round.
   *
   * Owner, 24/08: *"ประวัติต้องบอกว่า board หรือ multi พร้อมบอก job detail ที่รัน
   * เงื่อนไขทั้งหมด ว่าตอนนั้น job ตั้งอะไรไว้"*.
   *
   * 🔴 A COPY TAKEN AT RUN TIME, not a reference. The campaign can be edited
   *    afterwards, so resolving it on READ would show today's rules beside last
   *    week's run — the history would start lying the moment anyone touched the
   *    job. job แก้ได้ตลอด ⇒ ต้องแช่ค่าไว้ ไม่ใช่ไปดึงตอนอ่าน.
   *
   * ⚠️ OPTIONAL. Every run recorded before today has none, and the reader must
   *    say "this round predates the snapshot" rather than render a blank that
   *    looks like a bug. absent ≠ ว่างเปล่า.
   */
  readonly settingsSnapshot?: Record<string, unknown>;
}

export interface HistoryRow extends Record<string, unknown> {
  readonly broadcast_id: unknown;
  readonly run_id: string;
  readonly hook_id?: unknown;
  readonly status: string;
  readonly next_chunk_index: number;
}

/**
 * ⚠️ `refused` is passed through, never guessed. A run that was refused has all
 * zeroes, and so does a run that matched nobody — the two mean opposite things
 * to whoever reads the row a month later.
 */
/** The display name of THIS OA, or nothing — never another OA's name. */
function aliasFor(input: HistoryRowInput, hookId: string): string | undefined {
  return input.hookAliases?.[hookId];
}

/**
 * [FEAT-20260903-BCASTSRAGE] `{ site_rules_age_days }` for THIS OA, or `{}`.
 *
 * Same shape as `aliasFor` and for the same reason: a per-OA fact must be
 * looked up by hook id, or row seven states row one's truth. A non-finite value
 * writes nothing rather than a `NaN` nobody can read back.
 */
function siteRulesAge(
  input: HistoryRowInput,
  hookId: string,
): { site_rules_age_days?: number } {
  const perOa = input.siteRulesAgeDaysByHook?.[hookId];
  const value = typeof perOa === 'number' ? perOa : input.siteRulesAgeDays;
  if (typeof value !== 'number' || !Number.isFinite(value)) return {};
  return { site_rules_age_days: value };
}

/**
 * [FEAT-20260824-BCASTWHYFAILED] This OA's own failure, as a row fragment.
 *
 * Returns `undefined` — not `{}` — when the OA never failed, so the caller can
 * tell "no reason of its own" from "a reason that happens to be empty" and fall
 * back to the run-level message only in the first case. absent ≠ empty.
 */
function oaErrorMessage(
  oa: OaOutcome,
): { readonly error_message: string } | undefined {
  const failure = oa.firstFailure;
  if (failure === undefined) return undefined;

  /* The verdict this row already shows, so the sentence reads as an
     explanation OF the status rather than as an unrelated second opinion. */
  const verdict = oa.stoppedBy ? `stopped: ${oa.stoppedBy}` : 'send failed';
  const text = failureSentence(verdict, failure);
  return text === verdict &&
    failure.reason === undefined &&
    failure.status === undefined
    ? undefined
    : { error_message: text };
}

export function buildHistoryRow(
  input: HistoryRowInput,
  oa: OaOutcome,
  opts: { readonly refused?: boolean } = {},
): HistoryRow {
  const c: RunCounters = oa.counters;
  const summary = summarizeRun(c, {
    refused: opts.refused === true,
    stopped: oa.stoppedBy !== undefined,
  });

  /* `imagesMeasured` is really "a render happened" — it is set from the same
     chunk result that carries the tags, so both fields hang off it. Named here
     so the second use does not read as borrowing an unrelated flag. */
  const rendered = oa.imagesMeasured;

  return {
    broadcast_id: input.broadcastId,
    run_id: input.runId,
    ...(input.broadcastName ? { broadcast_name: input.broadcastName } : {}),
    hook_id: oa.hookId,
    ...(aliasFor(input, oa.hookId)
      ? { hook_alias: aliasFor(input, oa.hookId) }
      : {}),
    send_kind: input.cell.sendKind,
    card_type: input.cell.cardType,

    matched: c.matched,
    targeted: c.targeted,
    /**
     * [FEAT-20260907-BCASTUNUSEDRULES] Sits HERE, right under `targeted`,
     * because that is the number a reader is misled by: on this path it counts
     * the people the conditions selected while LINE delivered to every
     * follower. (`matched` above is 0 on every per-OA row — `countersForOa`
     * never sets it — so it is not the one to read.)
     *
     * ⚠️ Spread, so a round that is not this case carries NO SUCH KEY — the same
     *    "absent ≠ zero/false" rule `images_replaced` and `resume_after_id`
     *    already follow in this object. Writing `false` would put a new field on
     *    every history row in the system, which is exactly what must not happen.
     */
    ...(input.audienceRulesIgnored ? { audience_rules_ignored: true } : {}),
    sent: c.sent,
    failed: c.failed,
    unsent: c.unsent,
    requests_planned: c.requestsPlanned,
    requests_made: c.requestsMade,
    chunks_planned: c.chunksPlanned,
    chunks_done: c.chunksDone,
    /**
     * 🔴 OMITTED WHEN NOBODY LOOKED. `images_replaced: 0` reads as "every
     * picture was fine"; leaving it out says "not measured", which is the
     * truth for a preview or for a pipe that renders nothing. Writing 0 there
     * would be the same lie this field carried before it was wired at all.
     */
    ...(rendered ? { images_replaced: c.imagesReplaced } : {}),

    /**
     * [FEAT-20260823-BCASTHISTTAGS] Which tags came out `N/A`.
     *
     * Gated on the SAME signal, because it answers the same question: a run
     * that rendered nothing measured no tags either, and `[]` there would
     * claim every tag resolved. `oa.unknownTags` is already de-duplicated by
     * the executor's Set. เรนเดอร์แล้วค่อยเชื่อ [] ได้.
     */
    ...(rendered ? { unknown_tags: [...oa.unknownTags] } : {}),

    status: summary.status,
    ...(oa.stoppedBy ? { stop_reason: oa.stoppedBy } : {}),
    /**
     * [FEAT-20260824-BCASTWHYFAILED] Why THIS OA failed, in LINE's own words.
     *
     * 🔴 PER-OA BEATS THE RUN-LEVEL MESSAGE, and the precedence is the point.
     *    `input.errorMessage` is one sentence for the whole run (a refusal, a
     *    card that could not be read) — correct when nothing ran, useless when
     *    OA 1 hit a quota wall and OA 2 was fine, because it would stamp the
     *    same words on both rows. A row that names its own reason wins; the
     *    run-level line remains for rows that have none.
     *    เหตุผลของ OA ตัวเองต้องมาก่อนเหตุผลรวมของ run.
     *
     * ⚠️ The field is NOT new — `broadcast-history.schema.ts:181` has declared
     *    `error_message` since the collection existed and nothing on this path
     *    ever wrote it. No schema change, no migration; rows written before
     *    today simply carry no key, which already reads as "not recorded".
     *    field เดิมที่ประกาศไว้แล้วแต่ไม่มีใครเขียน ⇒ ไม่แตะ schema ไม่ต้อง migrate.
     */
    ...(oaErrorMessage(oa) ??
      (input.errorMessage ? { error_message: input.errorMessage } : {})),
    /* [FEAT-20260824-RUNSNAPSHOT] Spread, so a run with nothing captured writes
       NO key rather than an empty object — "never captured" and "captured
       nothing" are different facts and the reader shows them differently. */
    ...(input.settingsSnapshot === undefined
      ? {}
      : { settings_snapshot: input.settingsSnapshot }),

    triggered_by: input.triggeredBy,
    ...(input.triggeredByUser
      ? { triggered_by_user: input.triggeredByUser }
      : {}),
    ...(input.triggeredByName
      ? { triggered_by_name: input.triggeredByName }
      : {}),
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    /* [FEAT-20260903-BCASTSRAGE] Per OA first, run-level second, and NO KEY at
       all when neither exists — "never fetched" must not read as "fetched
       today". This column had a schema, a reader and an FE that shows it, and
       no producer whatsoever until today. */
    ...siteRulesAge(input, oa.hookId),

    /**
     * 🔴 THE RESUME POINT IS PART OF THE ROW, not a separate collection.
     * D52 proposed snapshotting the recipient list; keyset resume replaced it,
     * and this is where the cursor survives a restart. A row without it is a
     * run that can only start over. จุด resume ต้องอยู่ในแถว ไม่งั้นเริ่มใหม่อย่างเดียว.
     */
    ...(oa.resume.afterId !== null
      ? { resume_after_id: oa.resume.afterId }
      : {}),
    next_chunk_index: oa.resume.nextChunkIndex,

    recipients_captured: { ...input.recipientsCaptured },
  };
}

/** Every OA of one run, in the order they ran. */
export function buildHistoryRows(
  input: HistoryRowInput,
  perOa: readonly OaOutcome[],
  opts: { readonly refused?: boolean } = {},
): HistoryRow[] {
  return perOa.map((oa) => buildHistoryRow(input, oa, opts));
}
