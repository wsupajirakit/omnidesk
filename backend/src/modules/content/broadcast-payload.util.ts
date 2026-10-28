/**
 * [FEAT-20260823-BCASTSVCSPLIT] The shapes `broadcasts.service.ts` builds.
 * ===========================================================================
 * MOVED, NOT CHANGED. `broadcasts.service.ts` has been over the 400-line
 * ratchet since before this work (671 at the start of 23/08) and grew with it,
 * so the parts that need no Mongo and no Nest move out: the status vocabulary,
 * the two LINE payload builders, and the response contract.
 *
 * 🔴 THE WAIVER LIST MAY ONLY SHRINK (dev-local §6.1) — a file over the line
 *    gets split, never waived. This is the zero-risk half of that split: pure
 *    functions and a type, with the same suite green before and after.
 *    ⚠️ THE CLASS ITSELF IS STILL OVER. Splitting it means moving methods into
 *    a second provider and rewiring the controller — a behaviour-carrying
 *    change that must not ride along with a feature commit, so it is written
 *    down as planned work rather than half-done here.
 *    ที่เหลือเป็นคลาส ต้องแยกตอนที่ไม่ได้แก้พฤติกรรมไปพร้อมกัน.
 *
 * revert: paste these back above the class and delete this file.
 */
import {
  NO_ACTOR_NAMES,
  actorNameOf,
  type ActorNames,
} from './content-actor-names.util';
import type { BroadcastMessage } from './schemas/broadcast.schema';

export const STATUS_VALUES = new Set([
  'draft',
  'scheduled',
  'sent',
  'failed',
  'cancelled',
]);

/**
 * [FIX-20260808-BROADCASTSEND] LINE broadcast endpoint.
 * legacy: legacy-api dev_sec src/controllers/content/broadcastController.js:14
 *   `const LINE_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"`.
 * `/message/broadcast` fans out to EVERY follower of that OA — there is no
 * per-user recipient list, so the audience is per-HOOK (one hook = one OA), and
 * the send loop below iterates hooks, not users. (legacy send loop ~210-300)
 */
export const LINE_BROADCAST_URL =
  'https://api.line.me/v2/bot/message/broadcast';

/**
 * [FIX-20260808-BROADCASTSEND] legacy uses `timeout: 5000` on this axios.post
 * (legacy broadcastController.js ~243). Kept identical — legacy has no retry, so
 * a failure here is one attempt recorded once. ต่างจาก webhook (15s) โดยตั้งใจ.
 */
export const LINE_BROADCAST_TIMEOUT_MS = 5_000;

/**
 * [FIX-20260808-BROADCASTSEND] The broadcast message shaped for the LINE wire.
 * Ported verbatim from legacy `buildLineMessage` (broadcastController.js ~189):
 * text → {type,text}; image → {type,originalContentUrl,previewImageUrl};
 * flex → {type,altText:'Broadcast message',contents:flex_json}.
 */
/**
 * [FEAT-20260823-BCASTPREVIEW] EXPORTED so the preview can mirror this exact
 * shape rather than describe it a second time.
 *
 * 🔴 This is what a broadcast REALLY sends today: `contents` is the saved
 * `flex_json` untouched, so a card holding `{{profile.bank_code}}` ships those
 * braces to the customer, and `altText` is the hard-coded string, so
 * `title_detail` is ignored. Both are true only while
 * `BROADCAST_NEW_PATH_ENABLED` is false — which is why the preview asks that
 * flag rather than assuming. พรีวิวต้องสะท้อนตัวที่วิ่งจริง ไม่ใช่ตัวที่อยากให้วิ่ง.
 */
export function buildLineMessage(
  message: BroadcastMessage | undefined,
): Record<string, unknown> {
  const type = message?.type;
  if (type === 'text') {
    return { type: 'text', text: message?.text };
  }
  if (type === 'image') {
    return {
      type: 'image',
      originalContentUrl: message?.image_url,
      previewImageUrl: message?.image_url,
    };
  }
  return {
    type: 'flex',
    altText: 'Broadcast message',
    contents: message?.flex_json,
  };
}

/**
 * [FIX-20260808-BROADCASTSEND] Trimmed payload snapshot for the webhook_log row,
 * ported from legacy (broadcastController.js ~248-256 / ~279-287): only the field
 * matching the message type is populated, the rest stay `undefined`.
 */
export function buildPayloadSummary(
  broadcastId: unknown,
  message: BroadcastMessage | undefined,
): Record<string, unknown> {
  const type = message?.type;
  return {
    broadcast_id: broadcastId,
    message_type: type,
    text: type === 'text' ? message?.text : undefined,
    image_url: type === 'image' ? message?.image_url : undefined,
    flex_json: type === 'flex' ? message?.flex_json : undefined,
  };
}

export interface SanitizedBroadcast {
  id: unknown;
  name: string;
  hook_ids: unknown[];
  /** @deprecated [FEAT-20260825-MULTIGROUP] กลุ่มแรกของ `assign_group_ids` */
  assign_group: { id: unknown; name: string };
  /**
   * [FEAT-20260825-MULTIGROUP] กลุ่มเว็บทั้งหมด — **ตัวหลัก**
   *
   * 🔴 ขาดตรงนี้ = ฟอร์มเปิดมาแล้วกลุ่มว่าง แล้วการเซฟครั้งถัดไปทับด้วยค่าว่าง
   *    เหมือนกับที่คอมเมนต์ของ `target.rules` ข้างล่างเตือนไว้เป๊ะ ๆ
   *    เจอจริง 25/08 ตอนยิงเทสของจริง — unit test เขียวหมดแต่ API คืน null
   * ⚠️ optional เพราะแถวก่อน 25/08 ไม่มีคีย์นี้ · absent ≠ []
   */
  assign_group_ids?: unknown[];
  target: {
    mode: string;
    group_ids: unknown[];
    /**
     * [FIX-20260824-BCASTRULESSCHEMA] The way back for the audience conditions.
     *
     * 🔴 Missing from here means the condition builder opens EMPTY on edit and
     * the next save writes that emptiness over a real rule — a campaign for
     * three named people quietly becoming a campaign for everyone. The write
     * direction alone proves nothing. ขาไปอย่างเดียวไม่พอ.
     */
    match?: string | null;
    rules?: unknown[];
  };
  message: unknown;
  status: string;
  scheduled_at?: Date | null;
  sent_at?: Date | null;
  /**
   * [FEAT-20260823-BCASTTITLE] Sent back so the edit form can show what was
   * saved. `null` = none set ⇒ the send falls back to `line messages`.
   */
  title_detail?: string | null;
  /** [FEAT-20260823-BCASTSENDKIND] `null` = the sender this job always used. */
  send_kind?: string | null;
  /** [FEAT-2708-GUARDWINDOW] freshness window in hours — null = no guard */
  guard_window_hours?: number | null;
  /** [FEAT-20260823-BCASTCARDTYPE] `null` = one card for everybody. */
  card_type?: string | null;
  /** [FEAT-20260823-BCASTDESC] `null` = a campaign saved before the column. */
  description?: string | null;
  /** [FEAT-20260825-BCASTDIRECTTICKET] เปิดเคสให้คนที่ได้รับ multicast ใบนี้ไหม
   *  boolean เสมอ ไม่ใช่ optional — ฟอร์มวาด checkbox และ `undefined` จะทำให้มัน
   *  กลายเป็นสถานะกึ่งกลางที่ผู้ใช้กดแล้วงง */
  is_direct_ticket: boolean;
  /** [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่ไหม
   *  boolean เสมอ ด้วยเหตุผลเดียวกับบรรทัดบน */
  skip_assist: boolean;
  /**
   * [FEAT-20260824-BCASTREPEAT] The repeat rule as stored.
   *
   * 🔴 THE WAY BACK for the cadence form. Without it the form re-opens with
   * every field blank and the next save writes that blank over a working
   * schedule — a daily campaign silently becoming a one-off.
   * `null` = never configured ⇒ runs once, which is what every campaign saved
   * before 24/08 does. ไม่มี = ยิงครั้งเดียว เหมือนของเดิม.
   */
  schedule?: Record<string, unknown> | null;
  /**
   * [FEAT-20260824-BCASTREPEAT] What the scheduler wrote back. READ-ONLY —
   * these are the scheduler's answer, not the admin's setting, and no DTO
   * accepts them.
   *
   * Sent so an admin can SEE that a repeat is armed: "next run 09:00 tomorrow,
   * ran 3 times" is the only place the feature becomes visible before it fires.
   * A cadence with no next-run showing is indistinguishable from one that
   * silently did nothing. ต้องเห็นรอบถัดไป ไม่งั้นแยกไม่ออกว่ามันทำงานอยู่จริงไหม.
   */
  next_run_at?: Date | null;
  last_run_at?: Date | null;
  run_count?: number | null;
  created_by?: string;
  updated_by?: string;
  /**
   * [FEAT-20260823-BCASTACTOR] Who set this campaign up, as a person reads it.
   *
   * `null` = we hold an id but could not resolve it (the account was removed,
   * or the lookup was unavailable) — NOT "nobody made this". The id above is
   * still there for anyone who needs to trace it.
   * แปลไม่ออก ≠ ไม่มีคนสร้าง — id ยังอยู่ให้ตามได้.
   */
  created_by_name?: string | null;
  updated_by_name?: string | null;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * [FEAT-20260823-BCASTSVCSPLIT] One stored row, shaped for a reader.
 *
 * MOVED OUT OF THE SERVICE, NOT CHANGED. `broadcasts.service.ts` has been over
 * the 400-line ratchet since before this work and the waiver list may only
 * shrink, so the parts that need no Mongo and no Nest move out. This one reads
 * a plain object and a name map and returns a plain object — nothing about it
 * ever needed to be a method.
 *
 * 🔴 IT WHITELISTS BY HAND, and that is the trap this file exists to keep
 *    visible: a column missing from the list below is DROPPED ON READ, so the
 *    form re-opens blank and the next save writes that blank over a real
 *    value. Four columns have already been lost that way here
 *    (`title_detail`, `send_kind`, `card_type`, `description`).
 *    เพิ่ม column ใหม่เมื่อไหร่ ต้องเพิ่มที่นี่ด้วยเสมอ.
 *
 * revert: paste it back as the body of the method that now delegates to it.
 */
export function sanitizeBroadcastRow(
  broadcast: { toObject?: () => unknown } | null | undefined,
  names: ActorNames = NO_ACTOR_NAMES,
): SanitizedBroadcast | null {
  if (!broadcast) return null;
  const raw = (broadcast.toObject ? broadcast.toObject() : broadcast) as Record<
    string,
    unknown
  >;

  const hookIds = Array.isArray(raw['hook_ids'])
    ? raw['hook_ids'].map((id: unknown) =>
        typeof id === 'object' && id !== null && '_id' in id ? id._id : id,
      )
    : [];

  const assignGroup = (raw['assign_group'] as {
    id?: unknown;
    name?: string;
  }) || {
    id: null,
    name: '',
  };

  const targetRaw = raw['target'] as
    /* [FIX-20260824-BCASTRULESSCHEMA] `match`/`rules` are read here too. They
       are stored as `Mixed`, so they arrive as whatever the row holds — the
       shape is asserted by `buildAudienceFilter`, never by this cast. */
    | {
        mode?: string;
        group_ids?: unknown[];
        match?: unknown;
        rules?: unknown;
      }
    | undefined;
  const targetGroupIds = Array.isArray(targetRaw?.group_ids)
    ? targetRaw.group_ids.map((id: unknown) =>
        typeof id === 'object' && id !== null && '_id' in id ? id._id : id,
      )
    : [];

  return {
    id: raw['_id'],
    name: (raw['name'] as string) || '',
    hook_ids: hookIds,
    assign_group: {
      id: assignGroup.id ?? null,
      name: assignGroup.name || '',
    },
    /**
     * [FEAT-20260825-MULTIGROUP] 🔴 ขาไปคืน ⇒ ต้อง copy ที่นี่ด้วย
     *
     * ตัวแปลงนี้สร้าง object **ทีละ field** ⇒ อะไรที่ไม่ได้เขียนไว้จะไม่ถึงหน้าจอเลย
     * และฟอร์มจะเปิดมาว่าง แล้วเซฟทับของเดิมด้วยค่าว่าง — บั๊กเดียวกับที่คอมเมนต์
     * ของ `target.rules` ข้างล่างเตือนไว้ · เจอจริง 25/08: unit test เขียวหมด
     * แต่ `GET /api/broadcasts/:id` คืน `assign_group_ids: null`
     *
     * ⚠️ แปลงเป็น id ล้วน (ไม่ใช่ document ที่ populate มา) ให้รูปตรงกับที่ FE ส่งมา
     */
    assign_group_ids: Array.isArray(raw['assign_group_ids'])
      ? (raw['assign_group_ids'] as unknown[]).map((g) =>
          typeof g === 'object' && g !== null && '_id' in g ? g._id : g,
        )
      : undefined,
    target: {
      mode: targetRaw?.mode || 'all',
      group_ids: targetGroupIds,
      /* [FIX-20260824-BCASTRULESSCHEMA] `null`/absent = no condition = everyone,
         which is what every campaign that predates the feature means. */
      match: (targetRaw?.match as string) ?? null,
      rules: Array.isArray(targetRaw?.rules) ? targetRaw.rules : [],
    },
    message: raw['message'],
    status: (raw['status'] as string) || 'draft',
    scheduled_at: (raw['scheduled_at'] as Date) || null,
    sent_at: (raw['sent_at'] as Date) || null,
    /* 🔴 THE WAY BACK. This function whitelists by hand, so a field missing
       from this list is dropped on READ — the form re-opens blank and the
       next save writes that blank over the real value. The write direction
       alone proves nothing. ขาไปอย่างเดียวไม่พอ ต้องมีขากลับด้วย. */
    title_detail: (raw['title_detail'] as string) ?? null,
    /* Same way-back rule as `title_detail`: missing from this list means the
       form re-opens with the choice blank and the next save clears it. */
    send_kind: (raw['send_kind'] as string) ?? null,
    guard_window_hours: (raw['guard_window_hours'] as number) ?? null,
    /* [FEAT-2708-GUARDWINDOW] same way-back rule as every line above — missing
       here means the form re-opens blank and the next save clears the guard. */
    card_type: (raw['card_type'] as string) ?? null,
    description: (raw['description'] as string) ?? null,
    /* [FEAT-20260825-BCASTDIRECTTICKET] Same way-back rule as every line above:
       missing here and the checkbox re-opens unticked, then the next save
       writes that blank over a job that really did want a ticket.
       ⚠️ `=== true`, not `?? null` — the FE renders a checkbox, and `null`
          would make it render as indeterminate rather than off. */
    is_direct_ticket: raw['is_direct_ticket'] === true,
    /* [FEAT-20260825-BCASTSKIPASSIST] อยู่ในลิสต์นี้เพราะกฎ "ขากลับ" ข้อเดียวกัน
       ตกบรรทัดนี้ = ฟอร์มเปิดมาไม่ติ๊ก แล้วเซฟทับงานที่ตั้งใจให้ข้าม */
    skip_assist: raw['skip_assist'] === true,
    /* [FEAT-20260824-BCASTREPEAT] Same way-back rule. `message` above rides
       through as a whole object, so `message.flex_id` needs no line of its own
       — but `schedule` is a top-level field and would be dropped here. */
    schedule: (raw['schedule'] as Record<string, unknown>) ?? null,
    /* The scheduler's own columns, so the form can show that a repeat is armed
       and how many rounds it has run. Never accepted back from a request. */
    next_run_at: (raw['next_run_at'] as Date) ?? null,
    last_run_at: (raw['last_run_at'] as Date) ?? null,
    run_count: (raw['run_count'] as number) ?? null,
    created_by: raw['created_by'] as string | undefined,
    updated_by: raw['updated_by'] as string | undefined,
    created_by_name: actorNameOf(names, raw['created_by']),
    updated_by_name: actorNameOf(names, raw['updated_by']),
    created_at: raw['created_at'] as Date | undefined,
    updated_at: raw['updated_at'] as Date | undefined,
  };
}
