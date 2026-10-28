import { BadRequestException } from '@nestjs/common';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';

import type { GroupDocument } from '@/modules/hooks';
import { NEW_PATH_SEND_KINDS } from './broadcast-run/new-path.switch';
import {
  GUARD_WINDOW_MIN_HOURS,
  GUARD_WINDOW_MAX_HOURS,
} from './audience/sources/guard-window.policy';
import {
  BROADCAST_TITLE_MAX,
  resolveTitle,
  type TitleRejection,
} from './broadcast-send/adapters/title-rule';
import type { AutoReplyResponseDto, BroadcastMessageDto } from './dto';

const MESSAGE_TYPES = new Set(['text', 'image', 'flex']);

export function parseActiveValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true') return true;
    if (normalized === '0' || normalized === 'false') return false;
  }
  return null;
}

export function ensureValidResponse(
  payload: AutoReplyResponseDto | undefined,
): AutoReplyResponseDto {
  if (!payload || typeof payload !== 'object') {
    throw new BadRequestException('response is required');
  }
  const type = payload.type;
  if (!MESSAGE_TYPES.has(type)) {
    throw new BadRequestException('Invalid response type');
  }

  if (type === 'text') {
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new BadRequestException('response.text is required');
    return { type, text };
  }

  if (type === 'image') {
    const url =
      typeof payload.image_url === 'string' ? payload.image_url.trim() : '';
    if (!url) throw new BadRequestException('response.image_url is required');
    if (!/^https:\/\//i.test(url)) {
      throw new BadRequestException(
        'response.image_url must start with https://',
      );
    }
    return { type, image_url: url };
  }

  const rawFlex = payload.flex_json;
  if (rawFlex === undefined || rawFlex === null || rawFlex === '') {
    throw new BadRequestException('response.flex_json is required');
  }
  if (typeof rawFlex === 'string') {
    try {
      const parsed = JSON.parse(rawFlex) as unknown;
      return { type, flex_json: parsed };
    } catch {
      throw new BadRequestException('response.flex_json must be valid JSON');
    }
  }
  return { type, flex_json: rawFlex };
}

export function ensureValidMessage(
  payload: BroadcastMessageDto | undefined,
): BroadcastMessageDto {
  if (!payload || typeof payload !== 'object') {
    throw new BadRequestException('message is required');
  }
  const type = payload.type;
  if (!MESSAGE_TYPES.has(type)) {
    throw new BadRequestException('Invalid message type');
  }

  if (type === 'text') {
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new BadRequestException('message.text is required');
    return { type, text };
  }

  if (type === 'image') {
    const url =
      typeof payload.image_url === 'string' ? payload.image_url.trim() : '';
    if (!url) throw new BadRequestException('message.image_url is required');
    if (!/^https:\/\//i.test(url)) {
      throw new BadRequestException(
        'message.image_url must start with https://',
      );
    }
    return { type, image_url: url };
  }

  /**
   * [FEAT-20260824-BCASTFLEXID] A card may arrive as a REFERENCE now.
   *
   * 🔴 THIS FUNCTION IS WHY THE FEATURE COULD NOT WORK. It rebuilds the message
   *    field by field, so `flex_id` was dropped on the way in — and worse, the
   *    check below demanded `flex_json`, so a payload carrying only a reference
   *    was rejected with `message.flex_json is required`. An admin picking a
   *    card from the library got a 400 that named a field they never filled.
   *    ประกอบใหม่ทีละฟิลด์ = flex_id หาย · แล้วยังบังคับ flex_json ⇒ เลือกการ์ดแล้วเซฟไม่ได้.
   *
   * ⚠️ ONE OF THE TWO, not both required. A reference is the way forward; the
   *    raw copy stays legal because every campaign saved before today has one
   *    and editing such a job must not force the admin to re-pick a card.
   *    `resolveSavedCard` reads the id first and the copy second, so a job
   *    holding both still sends the library's version.
   *    มีอย่างใดอย่างหนึ่งก็พอ — ของเก่าที่มีแต่ json ต้องแก้ต่อได้.
   */
  const flexId =
    typeof payload.flex_id === 'string' ? payload.flex_id.trim() : '';
  const rawFlex = payload.flex_json;
  const hasRaw = !(rawFlex === undefined || rawFlex === null || rawFlex === '');

  if (!flexId && !hasRaw) {
    throw new BadRequestException(
      'message.flex_id or message.flex_json is required',
    );
  }

  if (flexId && !mongoose.isValidObjectId(flexId)) {
    /* Caught here rather than at the send: a bad id saved today becomes a
       scheduled run that fails at 3am with nobody watching.
       id ผิดรูป ต้องรู้ตอนเซฟ ไม่ใช่ตอน cron ยิง. */
    throw new BadRequestException('Invalid flex card identifier');
  }

  /* Present only when supplied — an absent reference must stay absent so an
     old job is not stamped with a field it never had. */
  const ref = flexId ? { flex_id: flexId } : {};

  if (!hasRaw) return { type, ...ref };

  if (typeof rawFlex === 'string') {
    try {
      const parsed = JSON.parse(rawFlex) as unknown;
      return { type, flex_json: parsed, ...ref };
    } catch {
      throw new BadRequestException('message.flex_json must be valid JSON');
    }
  }
  return { type, flex_json: rawFlex, ...ref };
}

export async function ensureValidGroupIds(
  groupIds: unknown,
  groupModel: Model<GroupDocument>,
): Promise<mongoose.Types.ObjectId[]> {
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    throw new BadRequestException('group_ids is required');
  }
  const normalized = groupIds
    .map((id) => (typeof id === 'string' ? id.trim() : String(id)))
    .filter(Boolean);
  const invalid = normalized.filter((id) => !mongoose.isValidObjectId(id));
  if (invalid.length > 0) {
    throw new BadRequestException('Invalid group identifier');
  }
  const groups = await groupModel
    .find({ _id: { $in: normalized } })
    .select('_id');
  if (groups.length !== normalized.length) {
    throw new BadRequestException('Group not found');
  }
  return groups.map((group) => group._id);
}

export async function normalizeTarget(
  target: unknown,
  groupModel: Model<GroupDocument>,
): Promise<{
  mode: string;
  group_ids: mongoose.Types.ObjectId[];
  match?: string;
  rules?: unknown[];
}> {
  if (!target || typeof target !== 'object') {
    return { mode: 'all', group_ids: [] };
  }
  const targetObj = target as {
    mode?: string;
    group_ids?: unknown;
    match?: unknown;
    rules?: unknown;
  };

  /**
   * [FIX-20260823-BCASTRULES] The conditions survive normalisation.
   *
   * 🔴 THIS FUNCTION REBUILDS THE OBJECT FIELD BY FIELD, so anything not named
   *    here was dropped before it ever reached Mongo — the same silent-drop
   *    shape `sanitizeBroadcast` and `normalizeBroadcast` have both cost this
   *    feature once already. Measured on 23/08: a job saved WITH conditions
   *    sent to every member of the OA, because the conditions were never
   *    stored. ประกอบใหม่ทีละฟิลด์ = อะไรไม่อยู่ในลิสต์ก็หายเงียบ.
   *
   * ⚠️ NOT VALIDATED HERE. `buildAudienceFilter` owns that, and it REFUSES a
   *    job it cannot build rather than dropping a condition — dropping one
   *    would make the audience WIDER than the admin asked for. Validating in
   *    two places would mean two answers to the same question.
   */
  const audience: { match?: string; rules?: unknown[] } = {};
  if (typeof targetObj.match === 'string' && targetObj.match !== '') {
    audience.match = targetObj.match;
  }
  if (Array.isArray(targetObj.rules)) {
    audience.rules = targetObj.rules;
  }
  const mode = targetObj.mode || 'all';
  if (mode !== 'all' && mode !== 'group') {
    throw new BadRequestException('target.mode must be all or group');
  }
  if (mode === 'group') {
    const group_ids = await ensureValidGroupIds(
      targetObj.group_ids,
      groupModel,
    );
    return { mode, group_ids, ...audience };
  }
  return { mode: 'all', group_ids: [], ...audience };
}

/**
 * [FEAT-20260823-BCASTTITLE] The job's `title_detail`, on the way IN.
 * ===========================================================================
 * Two layers check this value, and they answer differently ON PURPOSE:
 *
 *   SAVE (here)  — REFUSE, with the reason. The form is still open and the
 *                  admin can fix it in five seconds.
 *   SEND (`title-rule.ts` via the card builder) — FALL BACK to the default.
 *                  Losing a whole campaign over a notification line would be
 *                  the wrong trade, and rows written before this check exists
 *                  (a script, an import) must still send.
 * ปฏิเสธตอนเซฟ · ตอนส่งใช้ค่าเริ่มต้นแทน ไม่ล้มทั้งแคมเปญ.
 *
 * ⚠️ EMPTY IS NOT A REJECTION — it is "no custom title", the normal case, and
 *    it stores `null` so the render falls back with NOTHING to report. A
 *    WHITESPACE-ONLY box is still refused: that is a typo, not a choice.
 *    The dashboard's copy agrees exactly (`utils/broadcastTitle.ts`) — if these
 *    two ever disagree the form lies about what will be accepted.
 */
const TITLE_REASONS: Readonly<Record<TitleRejection, string>> = {
  empty: 'title_detail must not be only spaces',
  'has-tag': 'title_detail cannot contain {{tags}}',
  'edge-space': 'title_detail must not start or end with a space',
  'bad-character': 'title_detail allows Thai, English, digits and spaces only',
  'too-long': `title_detail must be at most ${BROADCAST_TITLE_MAX} characters`,
};

export function ensureValidTitleDetail(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const check = resolveTitle(raw);
  if (check.rejected)
    throw new BadRequestException(TITLE_REASONS[check.rejected]);
  return check.title;
}

/**
 * [FEAT-20260823-BCASTSENDKIND] Which LINE endpoint a job goes out on.
 * ===========================================================================
 * 🔴 `null` MEANS "THE SENDER WE HAVE ALWAYS USED", and it is the normal answer.
 *    Every campaign stored before 23/08 is in that state and none of them may
 *    move because a column appeared. So an empty box CLEARS the choice rather
 *    than being an error — the same shape `ensureValidTitleDetail` uses.
 *    ไม่ตั้ง = ท่อเดิม ซึ่งเป็นเคสปกติ ไม่ใช่ข้อผิดพลาด.
 *
 * 🔴 REFUSED HERE RATHER THAN SILENTLY IGNORED. A typo like `multicastt` would
 *    otherwise be stored, look deliberate in the row, and route the campaign
 *    down the OLD path — the admin would swear they had switched it over and
 *    the evidence would agree with them. พิมพ์ผิดแล้วเงียบ = หาไม่เจอทั้งวัน.
 *
 * The list comes from `new-path.switch.ts`, never a second copy: the value that
 * passes validation and the value that opens the gate must be the same set, or
 * a job can be saved that nothing will ever route.
 */
/**
 * [FEAT-2708-GUARDWINDOW] How fresh a follow-up stamp must be, in hours.
 * ===========================================================================
 * `null` = NO GUARD, and it is the normal answer — every campaign stored
 * before 27/08 is in that state and none of them may move because a column
 * appeared. An empty box CLEARS the choice rather than being an error, the
 * same shape `ensureValidSendKind` above uses. ไม่ตั้ง = ไม่มี guard.
 *
 * 🔴 Whole hours 1-72 only (owner: "ห้าม 0"). Range lives in
 *    `guard-window.policy.ts` — the value that saves and the value the filter
 *    accepts must be the same set, or a job can be stored that every send
 *    round then refuses (same doctrine as `ensureValidSendKind`'s list).
 * DTO does the shape (@IsInt @Min @Max); this layer answers WITH THE RULE for
 * hand-made calls and hand-edited rows.
 */
export function ensureValidGuardWindow(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < GUARD_WINDOW_MIN_HOURS ||
    raw > GUARD_WINDOW_MAX_HOURS
  ) {
    throw new BadRequestException(
      `guard_window_hours must be a whole number of hours between ` +
        `${GUARD_WINDOW_MIN_HOURS} and ${GUARD_WINDOW_MAX_HOURS}`,
    );
  }
  return raw;
}

export function ensureValidSendKind(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !NEW_PATH_SEND_KINDS.includes(raw)) {
    throw new BadRequestException(
      `send_kind must be one of: ${NEW_PATH_SEND_KINDS.join(', ')}`,
    );
  }
  return raw;
}

/**
 * [FEAT-20260823-BCASTCARDTYPE] Does every recipient get the same card?
 * ===========================================================================
 * `null` = `'plain'` = one card for everybody, which is what every campaign
 * has always done and what a job that names nothing keeps doing.
 *
 * 🔴 `'personal'` COSTS ONE LINE REQUEST PER RECIPIENT. The card body differs
 *    per person, so it cannot ride one request — that is LINE's shape, not a
 *    limit to route around. Refusing a typo here matters for the same reason
 *    it does on `send_kind`: `personall` stored silently would look deliberate
 *    in the row while the run quietly stayed on one card for everyone.
 *    การ์ดรายคน = ยิงทีละคน · พิมพ์ผิดแล้วเงียบ = หาไม่เจอ.
 */
const CARD_TYPES: readonly string[] = ['plain', 'personal'];

export function ensureValidCardType(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !CARD_TYPES.includes(raw)) {
    throw new BadRequestException(
      `card_type must be one of: ${CARD_TYPES.join(', ')}`,
    );
  }
  return raw;
}

/**
 * 🔴 THE ONE COMBINATION THAT CANNOT EXIST.
 *
 * `/message/broadcast` sends ONE request with no recipient list, so there is
 * nowhere to put a value that differs per person. The send matrix already says
 * so (`broadcast:personal` → `allowed: false`) and `run-plan.ts:129` refuses
 * it at send time — but by then the admin has saved a campaign, scheduled it,
 * and learned it cannot run only when it did not.
 *
 * Refused HERE, while the form is still open, for the same reason
 * `ensureValidTitleDetail` refuses there rather than at render.
 * ปฏิเสธตอนเซฟ ดีกว่าให้รู้ตอนถึงเวลาส่งแล้วส่งไม่ได้.
 */
export function ensureSendableCombination(
  sendKind: string | null,
  cardType: string | null,
): void {
  if (sendKind === 'broadcast' && cardType === 'personal') {
    throw new BadRequestException(
      'a personalised card cannot be sent by broadcast — ' +
        'broadcast has no recipient list, so use multicast',
    );
  }
}

/**
 * [FEAT-20260823-BCASTDESC] Why this campaign exists, in the admin's words.
 * ===========================================================================
 * 🔴 REQUIRED ON CREATE, OPTIONAL ON UPDATE — and the asymmetry is the whole
 *    design, not an oversight:
 *
 *    · the COLUMN must stay optional, because every campaign stored before
 *      23/08 has none and `required: true` would make each of them fail to
 *      save the next time anyone edited it — the same trap a schema `default`
 *      sets, wearing different clothes
 *    · a NEW campaign has no such history, so there is nothing to protect and
 *      every reason to insist: a description nobody is asked for is a
 *      description nobody writes
 *    · an EDIT of an old campaign must not be blocked by a field the campaign
 *      never had. Renaming a 2025 broadcast cannot require writing its
 *      rationale first.
 *    งานเก่าต้องแก้ได้ · งานใหม่ต้องมีคำอธิบาย.
 *
 * This mirrors `name` (`broadcasts.service.ts:384` vs `:499`), which the repo
 * already enforces exactly this way. One shape, not a new one.
 *
 * ⚠️ THE DASHBOARD KEEPS A SECOND COPY of the rule so an admin hears about it
 *    while the form is open. That copy is a courtesy; this one decides.
 */
export const DESCRIPTION_MAX = 500;

export function ensureValidDescription(
  raw: unknown,
  opts: { readonly required: boolean },
): string | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') {
    if (opts.required) {
      throw new BadRequestException(
        'description is required — say what this campaign is for',
      );
    }
    return null;
  }
  if (text.length > DESCRIPTION_MAX) {
    /* Refused, not truncated: a cut explanation reads as a different sentence
       and the admin never learns theirs was too long — the rule
       `resolveTitle` settled for the same reason. ตัดกลาง = คนละความหมาย. */
    throw new BadRequestException(
      `description must be at most ${DESCRIPTION_MAX} characters`,
    );
  }
  return text;
}

/**
 * [FEAT-20260824-BCASTREPEAT] The repeat rule as the admin asked for it.
 *
 * Owner, 24/08: *"repeat ด้วยต้องตั้งค่าได้จริงใ้ชได้จริง รันทุกๆตอนไหน นาที ชั่วโมง
 * วันไหนของวีค จ - อาทิตย์"*.
 *
 * 🔴 ONLY `mode` IS CHECKED HERE, and it is checked for one reason: a typo in it
 *    fails SILENTLY. `isRepeating()` reads `=== 'repeat'`
 *    (`broadcast-schedule/schedule-shape.ts:209`), so `"repeate"` means "run
 *    once" — the admin sets a daily campaign, gets a 200, and it fires one time
 *    with nothing anywhere to say why. Every other field is a NUMBER that
 *    `broadcast-schedule/next-run.ts` already clamps into range, and checking a
 *    bound twice means two answers to one question — the answer that decides
 *    whether a job fires has to be the scheduler's.
 *    mode พิมพ์ผิด = เงียบ ⇒ ต้องกันที่นี่ · ตัวเลขให้ next-run.ts clamp.
 *
 * ⚠️ `undefined` IN, `undefined` OUT. A job that sets no cadence must carry no
 *    `schedule` key at all, so it is byte-identical to every campaign that
 *    predates this feature. Returning `{}` would stamp an empty object onto
 *    every new row and make "never configured" indistinguishable from
 *    "configured to nothing". ไม่ตั้ง = ไม่มีคีย์ ห้ามคืน {}.
 */
export const SCHEDULE_MODES = ['once', 'repeat'] as const;

export function ensureValidSchedule(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('schedule must be an object');
  }
  const rule = raw as Record<string, unknown>;
  const mode = rule['mode'];
  if (mode !== undefined) {
    if (
      typeof mode !== 'string' ||
      !(SCHEDULE_MODES as readonly string[]).includes(mode)
    ) {
      throw new BadRequestException(
        `schedule.mode must be one of: ${SCHEDULE_MODES.join(', ')}`,
      );
    }
  }
  /* An object with nothing in it is the admin clearing the rule, and that is a
     real instruction — it is kept as `{}` so UPDATE can overwrite a stored
     cadence. Only a MISSING schedule means "do not touch". */
  return rule;
}
