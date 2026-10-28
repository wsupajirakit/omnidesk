import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';

/**
 * [FIX-20260823-BCASTRULES] One audience condition, on the wire.
 *
 * 🔴 THE SHAPE HAS TO BE DECLARED, not left as `unknown`. With
 *    `whitelist: true` the pipe strips unknown properties RECURSIVELY, so an
 *    `unknown[]` arrives as a list of EMPTY OBJECTS — the rule survives as a
 *    shape and loses everything that made it a rule. Measured: `rules: [{}]`.
 *    unknown[] ไม่พอ — ฟิลด์ข้างในถูกล้างจนเหลือ {}.
 *
 * ⚠️ Declaring this does NOT hard-code the audience list. What is fixed is the
 *    SHAPE of a condition — three fields — while the KEYS come from the
 *    backend registry and may grow without touching this file.
 *    `buildAudienceFilter` is what refuses a key it does not know.
 */
export class AudienceRuleDto {
  @IsString()
  key!: string;

  @IsString()
  op!: string;

  /** Any scalar or list the operator accepts. Checked by the filter builder. */
  @IsOptional()
  value?: unknown;
}

export class BroadcastTargetDto {
  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  group_ids?: string[];

  /**
   * [FIX-20260823-BCASTRULES] How the conditions below combine.
   *
   * 🔴 DECLARED HERE OR THE WHOLE REQUEST IS REJECTED. `main.ts:136` runs the
   *    pipe with `forbidNonWhitelisted`, so a nested field no DTO mentions is
   *    a 400 — and before that the dashboard could not send a condition at
   *    all. Measured on 23/08: a run targeted every member of the OA because
   *    the rules never left the browser. ไม่ประกาศ = ส่งมาไม่ถึงเลย.
   */
  @IsOptional()
  @IsString()
  match?: string;

  /**
   * The conditions themselves. Left as `unknown[]` on purpose: the KEYS come
   * from a backend registry that may grow, and a DTO listing them would have
   * to be edited every time one is added — the copy this seam exists to
   * avoid. `buildAudienceFilter` validates every rule and REFUSES the job on
   * anything it cannot build. ตรวจของจริงที่ตัวสร้าง filter ไม่ใช่ที่ DTO.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AudienceRuleDto)
  rules?: AudienceRuleDto[];
}

/**
 * [FEAT-20260824-BCASTREPEAT] The repeat rule, on the wire.
 *
 * 🔴 WITHOUT THIS CLASS THE WHOLE FEATURE IS INERT. `ValidationPipe` runs with
 *    `whitelist: true` and strips unknown properties RECURSIVELY — a `schedule`
 *    typed as `unknown` arrives as `{}`, so an admin sets a cadence, gets a
 *    200, and the job never repeats. The audience `rules` reached Mongo as
 *    `[{}]` for exactly this reason and it cost a live send to find.
 *    ต้องประกาศทุกฟิลด์ ไม่งั้นมาถึงเป็น {} เงียบ ๆ.
 *
 * ⚠️ DECLARED, NOT VALIDATED. Every bound is already enforced — and CLAMPED —
 *    by `broadcast-schedule/next-run.ts` (`MIN_EVERY_MINUTES`, `DAY_MINUTES`,
 *    `MIN/MAX_TZ_OFFSET_MIN`, `MAX_DAY_WALK`). Re-checking here would mean two
 *    answers to one question, and the answer that decides whether a job fires
 *    has to be the one the scheduler reads. So these carry `@IsOptional()` and
 *    nothing else: the DTO's job is to let the value THROUGH.
 *    ตรวจของจริงที่ next-run.ts ไม่ใช่ที่ DTO — หนึ่งคำถาม หนึ่งคำตอบ.
 *
 * ⚠️ `mode` MISSING MUST MEAN "once". `isRepeating()` reads `=== 'repeat'`
 *    (`schedule-shape.ts:209`), so every campaign saved before today — which
 *    has no `schedule` at all — keeps running exactly once. Absent is not off,
 *    it is "the behaviour that already existed".
 */
export class BroadcastScheduleDto {
  /** `'once' | 'repeat'`. Missing ⇒ `once` ⇒ no second round. */
  @IsOptional()
  @IsString()
  mode?: string;

  /** Per-job kill switch. Only an explicit `false` turns it off. */
  @IsOptional()
  enabled?: boolean;

  /**
   * [FEAT-20260825-ATTIME] "ทำซ้ำ ตอนกี่โมง" — นาทีในวัน (15:00 ⇒ 900)
   *
   * 🔴 ต้องประกาศที่นี่ ไม่งั้น `ValidationPipe` (`whitelist` +
   *    `forbidNonWhitelisted`) **ปฏิเสธทั้ง request** ด้วยคำว่า "validation failed"
   *    ที่ไม่บอกว่าฟิลด์ไหน — เจอจริง 25/08 ตอนยิงเทสของจริงครั้งแรก
   *    ประกาศไม่ครบ = ทั้ง request ตกโดยไม่รู้สาเหตุ.
   *
   * ⚠️ คู่กับ `tz_offset_min` เสมอ ตัวเลขนี้ลอย ๆ ไม่มีความหมาย
   */
  @IsOptional()
  at_time_min?: number;

  /**
   * @deprecated [FEAT-20260825-ATTIME] ฟอร์มไม่ส่งแล้ว — `at_time_min` แทน
   * ยังรับอยู่เพื่อแถวเก่าและ client เก่าเท่านั้น
   */
  @IsOptional()
  every_minutes?: number;

  /** `0`=Sun … `6`=Sat, matching `Date#getUTCDay()` so nothing converts. */
  @IsOptional()
  @IsArray()
  days_of_week?: number[];

  /** Minutes from local midnight, inclusive. `09:00` = 540. */
  @IsOptional()
  window_start_min?: number;

  /** Minutes from local midnight, EXCLUSIVE. `18:00` = 1080. */
  @IsOptional()
  window_end_min?: number;

  /** `+07:00` = 420. A number, not a zone name — Thailand has no DST. */
  @IsOptional()
  tz_offset_min?: number;

  /** Nothing fires before this instant. */
  @IsOptional()
  starts_at?: string | Date | null;

  /** Nothing fires after this instant. The brake on a runaway repeat. */
  @IsOptional()
  ends_at?: string | Date | null;

  /** Stop after this many rounds. The other brake. */
  @IsOptional()
  max_runs?: number;
}

export class BroadcastMessageDto {
  @IsString()
  @IsNotEmpty()
  type!: 'text' | 'image' | 'flex';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  flex_json?: unknown;

  /**
   * [FEAT-20260824-BCASTFLEXID] The card to send, by id.
   *
   * 🔴 IT MUST BE DECLARED HERE OR IT NEVER ARRIVES. `ValidationPipe` runs with
   * `whitelist: true`, which STRIPS any property no DTO names — and strips it
   * silently, with a 200 and no error anywhere. This repo has paid for that
   * exact hole three times (`direct_ticket_on_reply`, `title_detail`, and the
   * audience `rules`, which reached Mongo as `[{}]`). A field the FE sends and
   * the BE does not declare is a field that does not exist.
   * ไม่ประกาศที่นี่ = FE ส่งมาแล้วหายเงียบ ไม่มี error.
   *
   * ⚠️ Validated as a string, not as an ObjectId, on purpose: the id is looked
   * up before the send, and a lookup that finds nothing is the honest answer to
   * a bad id. Casting here would turn "no such card" into a 400 that cannot say
   * which card was missing.
   */
  @IsOptional()
  @IsString()
  flex_id?: string;
}

/**
 * `name`, `hook_ids` and `message` are all required — `BroadcastsService`
 * rejects each in legacy's order (`name`, then `hook_ids`, then `assign_group`,
 * `target`, `message`). No presence constraint is declared here because
 * class-validator reports EVERY failure at once, which for an empty body
 * replaces legacy's `name is required` with five joined sentences. The type
 * constraints stay — legacy has no equivalent for those.
 */
export class CreateBroadcastDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  /**
   * @deprecated [FEAT-20260825-MULTIGROUP] ใช้ `assign_group_ids` แทน
   * ยังรับอยู่เพื่อ client เก่าเท่านั้น — ค่าที่ส่งมาจะถูกอ่านเป็นลิสต์ที่มีสมาชิกตัวเดียว
   */
  assign_group?: unknown;

  /**
   * [FEAT-20260825-MULTIGROUP] กลุ่มเว็บของ job นี้ — **ตัวหลัก**
   *
   * ⚠️ `unknown` ไม่ใช่ `string[]` เพราะ `ValidationPipe` `whitelist` จะตัดทิ้ง
   *    เงียบ ๆ ถ้าประกาศชนิดไม่ตรงกับที่ส่งจริง (FE ส่งได้ทั้ง id ดิบ และ `{id,name}`)
   *    ตัวตรวจจริงอยู่ที่ `resolveAssignGroups` ซึ่งปฏิเสธ id ที่ไม่มีอยู่จริง
   *    ประกาศแคบเกินที่นี่ = field หายแบบ 200 ไม่มี error
   */
  @IsOptional()
  assign_group_ids?: unknown;

  @IsOptional()
  target?: BroadcastTargetDto;

  @IsOptional()
  message?: BroadcastMessageDto;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  scheduled_at?: string | Date | null;

  /**
   * [FEAT-20260824-BCASTREPEAT] The repeat rule. `@ValidateNested` + `@Type` is
   * what makes the pipe keep the inner fields instead of handing on `{}`.
   * ต้องมี @Type ไม่งั้น class-transformer ไม่รู้จะประกอบเป็นคลาสไหน.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastScheduleDto)
  schedule?: BroadcastScheduleDto;

  @IsOptional()
  sent_at?: string | Date | null;

  @IsOptional()
  @IsString()
  audit_note?: string;

  /**
   * [FEAT-20260823-BCASTTITLE] The line a recipient reads in their chat list.
   *
   * 🔴 IT MUST BE DECLARED HERE OR IT NEVER ARRIVES. `main.ts:136` runs the
   *    pipe with `whitelist: true`, which DELETES every property no DTO
   *    mentions — before the handler runs, with no error and a 200 response.
   *    The dashboard would send this field, the API would answer OK, and
   *    nothing would ever be stored. ไม่ประกาศตรงนี้ = โดนตัดทิ้งเงียบ ๆ.
   *
   * `@IsString` is the shallow gate; the real rule (Thai/English/digits, no
   * tags, no edge spaces) is `ensureValidTitleDetail` in the service, because
   * it must answer with WHICH rule was broken. `null` / `''` clear it.
   */
  @IsOptional()
  @IsString()
  title_detail?: string | null;

  /**
   * [FEAT-20260823-BCASTSENDKIND] Which LINE endpoint this job goes out on.
   *
   * 🔴 Declared here or the pipe deletes it — `main.ts:136` runs with
   *    `whitelist` + `forbidNonWhitelisted`, so an undeclared field is a 400,
   *    not a silent drop. Same trap `title_detail` documents above.
   *
   * `null` / `''` clear it, which means "the sender we have always used" — the
   * state every campaign stored before 23/08 is in. The value list is checked
   * by `ensureValidSendKind`, which reads it from the switch so validation and
   * routing can never disagree.
   */
  @IsOptional()
  @IsString()
  send_kind?: string | null;

  /**
   * [FEAT-2708-GUARDWINDOW] Freshness window in whole hours (1-72).
   *
   * 🔴 Declared here or the pipe deletes it — same `forbidNonWhitelisted`
   *    trap `send_kind` documents above. `null` clears it = no guard, the
   *    state every campaign stored before 27/08 is in. Range re-checked with
   *    a reasoned message by `ensureValidGuardWindow`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  guard_window_hours?: number | null;

  /**
   * [FEAT-20260823-BCASTCARDTYPE] Does every recipient get the same card?
   *
   * `null` / `''` clear it, which means one card for everybody — the state
   * every campaign saved before 23/08 is in. Declared here or the pipe rejects
   * the whole request (`whitelist` + `forbidNonWhitelisted`).
   */
  @IsOptional()
  @IsString()
  card_type?: string | null;

  /**
   * [FEAT-20260823-BCASTDESC] An internal note about why this campaign exists.
   * Never rendered into a card, never sent to LINE.
   */
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * [FEAT-20260825-BCASTDIRECTTICKET] เปิดเคสรอไว้ให้คนที่ได้รับ multicast ใบนี้
   *
   * เหตุผลของเคสใช้ `description` ("แคมเปญนี้ทำเพื่ออะไร") ⇒ ข้อความเดียวใช้สองที่
   * ⚠️ `@IsOptional()` + ไม่มี default ⇒ ไม่ส่งมา = ไม่เปิด · งานเก่าทุกใบไม่ถูกแตะ
   * ⚠️ มีผลกับ multicast เท่านั้น — ตัวบังคับอยู่ที่ฝั่งรัน ไม่ใช่ที่นี่
   *    (broadcast ไม่มีรายชื่อผู้รับ จึงไม่มีใครให้เปิดเคสให้อยู่แล้ว)
   */
  @IsOptional()
  @IsBoolean()
  is_direct_ticket?: boolean;

  /**
   * [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่ (assist)
   *
   * ⚠️ `@IsOptional()` + ไม่มี default ⇒ ไม่ส่งมา = ไม่ข้าม · งานเก่าไม่ถูกแตะ
   * ⚠️ มีผลกับ multicast เท่านั้น ด้วยเหตุผลเดียวกับ `is_direct_ticket`
   */
  @IsOptional()
  @IsBoolean()
  skip_assist?: boolean;
}

export class UpdateBroadcastDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hook_ids?: string[];

  @IsOptional()
  /**
   * @deprecated [FEAT-20260825-MULTIGROUP] ใช้ `assign_group_ids` แทน
   * ยังรับอยู่เพื่อ client เก่าเท่านั้น — ค่าที่ส่งมาจะถูกอ่านเป็นลิสต์ที่มีสมาชิกตัวเดียว
   */
  assign_group?: unknown;

  /**
   * [FEAT-20260825-MULTIGROUP] กลุ่มเว็บของ job นี้ — **ตัวหลัก**
   *
   * ⚠️ `unknown` ไม่ใช่ `string[]` เพราะ `ValidationPipe` `whitelist` จะตัดทิ้ง
   *    เงียบ ๆ ถ้าประกาศชนิดไม่ตรงกับที่ส่งจริง (FE ส่งได้ทั้ง id ดิบ และ `{id,name}`)
   *    ตัวตรวจจริงอยู่ที่ `resolveAssignGroups` ซึ่งปฏิเสธ id ที่ไม่มีอยู่จริง
   *    ประกาศแคบเกินที่นี่ = field หายแบบ 200 ไม่มี error
   */
  @IsOptional()
  assign_group_ids?: unknown;

  @IsOptional()
  target?: BroadcastTargetDto;

  @IsOptional()
  message?: BroadcastMessageDto;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  scheduled_at?: string | Date | null;

  /**
   * [FEAT-20260824-BCASTREPEAT] The repeat rule. `@ValidateNested` + `@Type` is
   * what makes the pipe keep the inner fields instead of handing on `{}`.
   * ต้องมี @Type ไม่งั้น class-transformer ไม่รู้จะประกอบเป็นคลาสไหน.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => BroadcastScheduleDto)
  schedule?: BroadcastScheduleDto;

  @IsOptional()
  sent_at?: string | Date | null;

  @IsOptional()
  @IsString()
  audit_note?: string;

  /**
   * [FEAT-20260823-BCASTTITLE] The line a recipient reads in their chat list.
   *
   * 🔴 IT MUST BE DECLARED HERE OR IT NEVER ARRIVES. `main.ts:136` runs the
   *    pipe with `whitelist: true`, which DELETES every property no DTO
   *    mentions — before the handler runs, with no error and a 200 response.
   *    The dashboard would send this field, the API would answer OK, and
   *    nothing would ever be stored. ไม่ประกาศตรงนี้ = โดนตัดทิ้งเงียบ ๆ.
   *
   * `@IsString` is the shallow gate; the real rule (Thai/English/digits, no
   * tags, no edge spaces) is `ensureValidTitleDetail` in the service, because
   * it must answer with WHICH rule was broken. `null` / `''` clear it.
   */
  @IsOptional()
  @IsString()
  title_detail?: string | null;

  /**
   * [FEAT-20260823-BCASTSENDKIND] Which LINE endpoint this job goes out on.
   *
   * 🔴 Declared here or the pipe deletes it — `main.ts:136` runs with
   *    `whitelist` + `forbidNonWhitelisted`, so an undeclared field is a 400,
   *    not a silent drop. Same trap `title_detail` documents above.
   *
   * `null` / `''` clear it, which means "the sender we have always used" — the
   * state every campaign stored before 23/08 is in. The value list is checked
   * by `ensureValidSendKind`, which reads it from the switch so validation and
   * routing can never disagree.
   */
  @IsOptional()
  @IsString()
  send_kind?: string | null;

  /**
   * [FEAT-2708-GUARDWINDOW] Freshness window in whole hours (1-72).
   *
   * 🔴 Declared here or the pipe deletes it — same `forbidNonWhitelisted`
   *    trap `send_kind` documents above. `null` clears it = no guard, the
   *    state every campaign stored before 27/08 is in. Range re-checked with
   *    a reasoned message by `ensureValidGuardWindow`.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(72)
  guard_window_hours?: number | null;

  /**
   * [FEAT-20260823-BCASTCARDTYPE] Does every recipient get the same card?
   *
   * `null` / `''` clear it, which means one card for everybody — the state
   * every campaign saved before 23/08 is in. Declared here or the pipe rejects
   * the whole request (`whitelist` + `forbidNonWhitelisted`).
   */
  @IsOptional()
  @IsString()
  card_type?: string | null;

  /**
   * [FEAT-20260823-BCASTDESC] An internal note about why this campaign exists.
   * Never rendered into a card, never sent to LINE.
   */
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * [FEAT-20260825-BCASTDIRECTTICKET] เปิดเคสรอไว้ให้คนที่ได้รับ multicast ใบนี้
   *
   * เหตุผลของเคสใช้ `description` ("แคมเปญนี้ทำเพื่ออะไร") ⇒ ข้อความเดียวใช้สองที่
   * ⚠️ `@IsOptional()` + ไม่มี default ⇒ ไม่ส่งมา = ไม่เปิด · งานเก่าทุกใบไม่ถูกแตะ
   * ⚠️ มีผลกับ multicast เท่านั้น — ตัวบังคับอยู่ที่ฝั่งรัน ไม่ใช่ที่นี่
   *    (broadcast ไม่มีรายชื่อผู้รับ จึงไม่มีใครให้เปิดเคสให้อยู่แล้ว)
   */
  @IsOptional()
  @IsBoolean()
  is_direct_ticket?: boolean;

  /**
   * [FEAT-20260825-BCASTSKIPASSIST] ข้ามคนที่แอดมินกำลังคุยอยู่ (assist)
   *
   * ⚠️ `@IsOptional()` + ไม่มี default ⇒ ไม่ส่งมา = ไม่ข้าม · งานเก่าไม่ถูกแตะ
   * ⚠️ มีผลกับ multicast เท่านั้น ด้วยเหตุผลเดียวกับ `is_direct_ticket`
   */
  @IsOptional()
  @IsBoolean()
  skip_assist?: boolean;
}
