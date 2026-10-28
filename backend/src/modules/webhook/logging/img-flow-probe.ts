/*
 * ==== [OBS-20260812-IMGPROBE] image-flow probe — DEV ONLY, LOG ONLY ====
 *
 * TEMPORARY dev observability. Not a feature. Remove before it can reach staging
 * or production — see "HOW TO REMOVE" at the bottom.
 *
 * WHAT IT DOES
 *   One log line per stage along the whole inbound-image path, so a single `grep`
 *   reconstructs the timeline of a real image from arrival to reply/ticket, and
 *   shows what the three operator-facing hook settings did on the way:
 *     · slip_require_profile   "รับสลิปเฉพาะลูกค้าที่ผูกบัญชีแล้ว"
 *     · missing_api_data_text  "ข้อความเมื่อไม่พบข้อมูล API"
 *     · image_answer_text      "ค่าตอบกลับเมื่อพบรูปภาพ"
 *   For each it records: was it read, what value did it hold, and what did the flow
 *   decide because of it — for both a registered and an unregistered customer.
 *
 * ⚠️ IT MUST NEVER CHANGE BEHAVIOUR
 *   Every call only READS values the flow already computed and writes a log line.
 *   No return, no mutation, no branch, no await on anything the flow waits for.
 *   If this file were deleted mid-run the flow would produce identical output.
 *
 * ⚠️ WHY THE ENV GUARD EXISTS — "ระวังขึ้น prod แล้ว log จะพัง"
 *   A probe that ships is worse than no probe: it prints customer text and hook
 *   config on every image, forever, in an environment nobody is watching. So the
 *   probe is OFF unless `IMG_FLOW_PROBE=on` is set explicitly. `.env` on staging and
 *   production never sets it, so even if this file ships the probe stays silent —
 *   the code path is a single boolean read.
 *
 *   ⚠️ The guard is a SAFETY NET, not permission to ship. The removal grep below is
 *      still mandatory before deploying anywhere that is not a developer machine.
 *
 * ⚠️ NEVER LOG SECRETS
 *   Hook config carries `slip_verify_key`, `access_token`, `channel_secret`. This
 *   file logs only the three settings named above plus flow decisions, and it
 *   truncates free text (`preview`) so a long customer message cannot flood the log.
 *
 * HOW TO READ THE OUTPUT
 *   grep '\[IMGPROBE\]' <log>            all stages of every image
 *   grep '\[IMGPROBE\] stage=settings'   just what the three settings held
 *
 * HOW TO REMOVE (must be done before stg/prod)
 *   1. `grep -rn "IMGPROBE" src/` — every insertion carries the tag
 *   2. delete this file and each tagged block it is called from
 *   3. `grep -rn "IMGPROBE" src/` must print nothing
 *   4. `docs/img-flow-probe-2.md` records the same steps for whoever finds it later
 */
import { Logger } from '@nestjs/common';

/** Own logger so probe lines are attributable and never mix with service logs. */
const logger = new Logger('IMGPROBE');

/**
 * Master switch. Read once per process — the probe is either on for this run or it
 * is not, and a running webhook must not change behaviour halfway through.
 *
 * Anything other than the exact string 'on' leaves it off, so a typo in `.env`
 * cannot accidentally enable logging in an environment nobody is watching.
 */
const PROBE_ON = process.env['IMG_FLOW_PROBE'] === 'on';

/** True when the probe is active. Exported so call sites can skip building args. */
export const imgProbeEnabled = (): boolean => PROBE_ON;

/** Keep free text short: a customer message must not flood the log. */
function preview(v: unknown, max = 60): string {
  const s = v === null || v === undefined ? '' : String(v);
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** `undefined`/`null` print as `-` so a missing value is never mistaken for empty. */
function val(v: unknown): string {
  if (v === undefined) return '-';
  if (v === null) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return preview(v);
}

/**
 * Write one probe line.
 *
 * ⚠️ Wrapped in try/catch: this sits on the path a customer is waiting on, so a
 *    broken probe must degrade to silence rather than throw.
 */
export function imgProbe(stage: string, fields: Record<string, unknown>): void {
  if (!PROBE_ON) return;
  try {
    const body = Object.entries(fields)
      .map(([k, v]) => `${k}=${val(v)}`)
      .join(' ');
    logger.log(`[IMGPROBE] stage=${stage} ${body}`);
  } catch {
    /* observability must never break the flow it observes */
  }
}

/**
 * The three operator-facing settings, logged in one line so their interaction is
 * readable at a glance.
 *
 * `slipRequireProfile` is printed raw (not coerced) on purpose: the gate tests it
 * with `=== true`, so a string `"true"` stored by a sloppy client reads as ON in the
 * dashboard but OFF in the code. Printing the raw value is what exposes that.
 */
export function imgProbeSettings(
  hook: Record<string, unknown> | null | undefined,
): void {
  if (!PROBE_ON) return;
  imgProbe('settings', {
    slip_require_profile: hook?.['slip_require_profile'],
    slip_require_profile_text: hook?.['slip_require_profile_text'],
    missing_api_data_text: hook?.['missing_api_data_text'],
    image_answer_text: hook?.['image_answer_text'],
    // Not one of the three, but it decides whether markers in the two texts above
    // are resolved or sent raw — without it the other lines are hard to interpret.
    hook_text_reply_mode: hook?.['hook_text_reply_mode'],
    // Context for why the slip legs did or did not run.
    slip_check: hook?.['slip_check'],
    has_slip_verify_key: Boolean(hook?.['slip_verify_key']),
  });
}
