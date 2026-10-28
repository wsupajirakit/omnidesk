import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  MaxLength,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsOpenCaseCategory } from './open-case-category.validator';

/**
 * [FIX-20260817-JOBSTATUSSET] The only three states the system has.
 *
 * 0 waiting · 1 accepted · 2 closed — confirmed against the live collection
 * (`tickets.distinct('job_status')` = [0,1,2]) and against every reader: the
 * list filters (`tickets.service.ts:744-748`), the counters
 * (`:1184`, `:1268`) and the dashboard queue (`job_status: '0,1'`).
 * `@IsNumber` alone accepted 7 or -1, which writes a ticket no filter can ever
 * see again — invisible on the queue, invisible on the closed list.
 * ค่าอื่นนอกสามค่านี้ = ตั๋วที่ไม่มีหน้าจอไหนมองเห็น.
 */
const JOB_STATUSES = [0, 1, 2] as const;

/**
 * [FEAT-20260827-PATCHAFTERCLOSE] the close-case sections, as the dialog sends them.
 *
 * A class and not an inline object literal because `forbidNonWhitelisted` only
 * reaches a NESTED object when that object has a DTO of its own — without one,
 * `patch_after_close` would accept any shape at all and a typo like
 * `withdrawl: 'unfollow'` would be dropped in silence rather than 400.
 * ต้องเป็นคลาส ไม่งั้นพิมพ์ผิดข้างในจะเงียบ
 *
 * `@IsIn` on every field: the helper compares by exact string, so a value
 * outside these two would be read as "not asked" — indistinguishable from a
 * section that never appeared. Rejecting it at the door keeps that ambiguity out.
 */
export class PatchAfterCloseDto {
  /** section "การติดตามลงทะเบียน" — `stop` sets `members.ignore_abandon_assist`. */
  @IsOptional()
  @IsIn(['stop', 'keep'])
  registration?: 'stop' | 'keep';

  /** section "การติดตามฝากถอน" · คู่ฝาก — `unfollow` clears `notice_deposit_at`. */
  @IsOptional()
  @IsIn(['follow', 'unfollow'])
  deposit?: 'follow' | 'unfollow';

  /** section "การติดตามฝากถอน" · คู่ถอน — `unfollow` clears `notice_withdraw_at`. */
  @IsOptional()
  @IsIn(['follow', 'unfollow'])
  withdraw?: 'follow' | 'unfollow';
}

export class CreateTicketDto {
  @IsOptional()
  @IsString()
  line_oa_hook_id?: string;

  @IsOptional()
  @IsString()
  hook_id?: string;

  @IsOptional()
  @IsString()
  chat_msg_id?: string;

  @IsOptional()
  @IsString()
  line_user_id?: string;

  @IsOptional()
  @IsString()
  chat_user_id?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  need_detail?: string;

  @IsOptional()
  @IsString()
  chat_status?: string;

  @IsOptional()
  @IsNumber()
  @IsIn(JOB_STATUSES)
  job_status?: number;

  @IsOptional()
  @IsString()
  admin_user_id?: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  need_detail?: string;

  @IsOptional()
  @IsString()
  chat_status?: string;

  @IsOptional()
  @IsNumber()
  @IsIn(JOB_STATUSES)
  job_status?: number;

  @IsOptional()
  @IsString()
  admin_user_id?: string;

  /**
   * ==== [FIX-20260823-CLAIMCAS] กัน race ตอนสองคนกด "รับเคสต่อ" พร้อมกัน ====
   *
   * WHAT: เจ้าของเคสที่ **ผู้กดเห็นอยู่บนจอตอนกด** · `''` = เห็นว่ายังไม่มีใครถือ
   *
   * WHY: เดิมการเขียนใช้ฟิลเตอร์ `{ _id, job_status: { $ne: 2 }, scope }` ซึ่ง
   * **ไม่มีเงื่อนไขว่าใครถืออยู่** ⇒ สองคนกดพร้อมกันสำเร็จทั้งคู่ คนกดทีหลังชนะ
   * และ **คนแรกไม่มีทางรู้ว่าถูกแย่ง** — เห็นว่าตัวเองได้เคสทั้งที่ไม่ได้
   * (`findOneAndUpdate` atomic ระดับเอกสารจริง แต่ atomic ไม่ได้แปลว่ากันแย่ง)
   *
   * HOW: ส่งค่านี้มา ⇒ เงื่อนไขถูก AND เข้าไปในฟิลเตอร์ของคำสั่งเขียน**เดียวกัน**
   * ⇒ ไม่มีช่องว่างระหว่างอ่านกับเขียน กัน race ได้ 100% ไม่ใช่แค่ลดโอกาส
   *   · ตรง   → เขียนสำเร็จ เป็นเจ้าของ
   *   · ไม่ตรง → ไม่ match, คืน `null` ⇒ ผู้เรียกรู้ทันทีว่าถูกแย่ง
   *
   * ⚠️ **ไม่ได้ปิดกั้นการแย่งเคสที่ตั้งใจ** — ปุ่ม "รับเคสต่อ" มีไว้แย่งอยู่แล้ว
   *    คนที่แพ้เห็นเจ้าของคนใหม่แล้วกดซ้ำได้ทันที (คราวนี้คาดหวังคนใหม่)
   *
   * ⚠️ **ไม่ส่งมา = พฤติกรรมเดิมทุกบรรทัด** — ทุกผู้เรียกที่มีอยู่วันนี้ไม่ส่ง
   *    จึงไม่มีอะไรเปลี่ยนสำหรับพวกเขา (ปิด/เปลี่ยนหมวด/แก้ need_detail ฯลฯ)
   *
   * ⚠️ ต้องประกาศที่นี่เท่านั้นถึงจะใช้ได้ — `main.ts:136` เปิด `whitelist: true`
   *    field ที่ไม่อยู่ใน DTO **ถูกตัดทิ้งเงียบ ๆ ก่อนถึง handler**
   *
   * ⚠️ ค่านี้ **ไม่ถูกเขียนลงเอกสาร** — ใช้เป็นเงื่อนไขอย่างเดียว
   *    (ดู `stripControlFields` ที่ service)
   *
   * revert: ลบ field นี้ + บล็อกที่ service แท็กเดียวกัน ⇒ กลับไป last-write-wins
   */
  @IsOptional()
  @IsString()
  expected_admin_user_id?: string;

  /**
   * [FEAT-20260826-CLOSECLEARFU] "ปิดเคสนี้แล้วเลิกตามการสมัครของลูกค้าคนนี้"
   *
   * ติ๊กมาจากกล่องยืนยันปิดเคส (`/ticket-support`) เฉพาะตอนที่ member คนนั้นมี
   * **ครบทั้งสอง** stamp — `follow_up.line.abandon_trigger_at` และ
   * `follow_up.line.request_reg_at` — เท่านั้นถึงจะมีช่องให้ติ๊ก
   *
   * 🔴 ค่านี้ทับกฎเดิมที่เขียนไว้ 5 ไฟล์ว่า `request_reg_at` ห้ามเคลียร์
   *    เจ้าของยืนยัน 26/08/2026 หลังรับทราบผลกระทบแล้ว — เหตุผลเต็มและผลที่ตามมา
   *    อยู่ที่ `modules/tickets/close-case-follow-up.helper.ts`
   *
   * ⚠️ **ไม่ถูกเขียนลงเอกสาร ticket** — เป็นเงื่อนไขล้วน จึงต้องถูก `delete` ออกจาก
   *    `updateData` ก่อน `$set` แบบเดียวกับ `expected_admin_user_id` ข้างบน
   *
   * ⚠️ ต้องประกาศที่นี่เท่านั้น — `main.ts` เปิด `forbidNonWhitelisted: true`
   *    ⇒ field ที่ไม่อยู่ใน DTO ทำให้ทั้งคำขอ **400** ไม่ใช่ถูกตัดเงียบ ๆ
   *    ⇒ ต้อง deploy BE ก่อน FE เสมอ ไม่งั้นปิดเคสไม่ได้ทั้งระบบ
   *
   * revert: ลบ field นี้ + helper + บล็อกที่ service แท็กเดียวกัน
   */
  @IsOptional()
  @IsBoolean()
  clear_follow_up?: boolean;

  /**
   * [FEAT-20260827-PATCHAFTERCLOSE] "patch after close ticket" — what the admin
   * decided about this customer's follow-ups while closing the case.
   *
   * กล่องยืนยันปิดเคสถูกแบ่งเป็น **section** และแต่ละ section จะโผล่ก็ต่อเมื่อ member
   * มี stamp ของเรื่องนั้นจริง ๆ:
   *   `registration` — ขึ้นเมื่อมีครบทั้ง `abandon_trigger_at` + `request_reg_at`
   *                    · `stop` ⇒ `members.ignore_abandon_assist = true`
   *   `deposit`      — ขึ้นเมื่อมี `notice_deposit_at`  · `unfollow` ⇒ ล้าง stamp นั้น
   *   `withdraw`     — ขึ้นเมื่อมี `notice_withdraw_at` · `unfollow` ⇒ ล้าง stamp นั้น
   *
   * 🔴 **section ไหนไม่ขึ้น = ปิดเคสปกติ ไม่แตะอะไรเลย** (เจ้าของย้ำ 27/08) ⇒ ทุก field
   *    เป็น optional และ `undefined` แปลว่า "ไม่ได้ถูกถาม" ไม่ใช่ค่า default
   *    และ BE ยังเช็ค stamp ซ้ำเองอีกชั้น — คำตอบที่อ้างถึง stamp ที่ member ไม่มี จะถูก
   *    ทิ้งเงียบ ๆ เพราะแท็บค้างหรือคำขอที่ปั้นมือส่งอะไรมาก็ได้
   *
   * ⚠️ **ไม่ถูกเขียนลงเอกสาร ticket** — เป็นเงื่อนไขล้วน จึงถูก `delete` ออกจาก
   *    `updateData` ก่อน `$set` แบบเดียวกับ `clear_follow_up` ข้างบน
   *
   * ⚠️ `main.ts` เปิด `forbidNonWhitelisted: true` ⇒ field ที่ไม่อยู่ใน DTO ทำให้ทั้ง
   *    คำขอ **400** ⇒ **ต้อง deploy BE ก่อน FE เสมอ**
   *
   * ⚠️ ของเดิม `clear_follow_up` (26/08) **ยังอยู่ครบและยังทำงาน** — client เก่ายิงมา
   *    ก็ยังปิดเคสได้เหมือนเดิม ไม่ต้อง deploy พร้อมกัน
   *
   * revert: ลบ field นี้ + `patch-after-close.helper.ts` + บล็อกที่ service แท็กเดียวกัน
   */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PatchAfterCloseDto)
  patch_after_close?: PatchAfterCloseDto;

  @IsOptional()
  assigned_at?: Date | string;

  @IsOptional()
  resolved_at?: Date | string;
}

export class ListTicketsQueryDto {
  @IsOptional()
  @IsString()
  job_status?: string;

  @IsOptional()
  @IsString()
  category?: string;

  /* [FIX-20260827-TKTMEMBERPARAM] both are the member's ObjectId — the value a
     LINE-id string will be REFUSED with 400 by the service (the name is a lie
     inherited from legacy; see ticket.schema.ts on `line_user_id`).
     `member_id` is the honest alias; `line_user_id` stays for shipped callers. */
  @IsOptional()
  @IsString()
  line_user_id?: string;

  @IsOptional()
  @IsString()
  member_id?: string;

  @IsOptional()
  @IsString()
  admin_user_id?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  start_date?: string;

  @IsOptional()
  @IsString()
  end_date?: string;

  /**
   * [FEAT-20260808-TKTSCOPE] Optional FE date-scope filter. NEW additive param
   * (not legacy parity). Accepts an integer in {2,3,4,5,7}; anything else —
   * omitted, empty, or out-of-set — is treated as omitted = unbounded list =
   * today's exact behaviour (see resolveWithinDaysCutoff in tickets.service).
   * Kept as a plain string here so an out-of-set value is ignored safely rather
   * than 400-ing a list request; the allowed-set clamp lives in the service.
   */
  @IsOptional()
  @IsString()
  within_days?: string;

  /**
   * [FEAT-20260826-TKTFILTERPARAMS] 📖 docs/bottleneck_26_aug.md (S5 · 3a)
   * Opt-in server-side twins of the dashboard's client filters — absent =
   * today's behaviour byte for byte. `oa` = one hook id narrowing the resolved
   * scope; `tag` = customer-tag id (`customer_tags.tag_id`); `tier` = the
   * screen's lowercased tier key (member-tier-key.util.ts). Layer-3 paging
   * cannot turn on while these live only in the browser (fe_todo73 §1.3).
   */
  @IsOptional()
  @IsString()
  oa?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  tier?: string;

  /**
   * [FEAT-20260826-TKTTABCOUNTS] PRESENT (even '') ⇒ the response gains
   * `tab_counts` {waiting, active, mine, ended} aggregated over the request's
   * filter without its job_status and without its `ids` subset — the badge
   * truth once paging means the screen no longer holds every row. Absent ⇒
   * response byte-identical.
   */
  @IsOptional()
  @IsString()
  counts?: string;

  /**
   * [FEAT-20260826-TKTACTIVITYSORT] 'activity' switches CURSOR paging to
   * (updated_at desc, _id desc) — page 1 becomes the working set. Recognised
   * only with `cursor`; absent/other values/non-cursor = created_at path,
   * byte-identical.
   */
  @IsOptional()
  @IsString()
  sort?: string;

  /**
   * [PERF-20260821-TICKETCURSOR] opt-in keyset paging. PRESENT (even '') turns
   * cursor mode on: '' = first page, otherwise the `next_cursor` of the previous
   * response. Absent = the legacy page/limit/all behaviour, unchanged.
   */
  @IsOptional()
  @IsString()
  cursor?: string;

  /**
   * [PERF-20260822-TKTIDSFETCH] Comma-separated ticket ids — fetch a NAMED
   * SUBSET through the list's own path instead of reloading everything.
   *
   * Declared here because the global pipe runs `forbidNonWhitelisted`: an
   * undeclared param 400s the whole list request before the handler runs.
   * ANDed onto the existing filter, so it can only narrow. Absent = today.
   * See `list-ids.util.ts` for the parsing and the cap.
   */
  @IsOptional()
  @IsString()
  ids?: string;
}

export class ClearTicketsDto {
  @IsOptional()
  @IsBoolean()
  clear_waiting?: boolean;

  @IsOptional()
  @IsBoolean()
  clear_processing?: boolean;
}

// [FEAT-20260817-REOPENBYADMIN] body of POST /api/tickets/reopen-by-admin.
// The global pipe runs forbidNonWhitelisted, so the ONE field must be declared
// or every request answers 400 before the handler runs.
export class ReopenTicketByAdminDto {
  @IsMongoId()
  ticket_id!: string;
}

/**
 * [FEAT-20260819-OPENFROMROOM] Open the FIRST case for a conversation that never
 * had one. Named for what it is — there is no earlier ticket, so this is not a
 * reopen. The room decides the customer and the OA; the admin supplies the rest.
 */
export class OpenTicketFromRoomDto {
  @IsMongoId()
  room_id!: string;

  /**
   * What THIS route accepts. Without a provider declaration: 'Other' and 'Payment',
   * the values an open-from-room case was written with (checked against the live data,
   * not guessed). Collection / IT are written by the assist summary, not here. Anything
   * else is refused rather than quietly stored, so the category filters keep working.
   * [FEAT-20261014-TICKETCATS] the list is the active provider's (loan_v1: Collection ·
   * IT · Payment · Other); a provider that declares nothing keeps exactly Other · Payment.
   */
  @IsOptional()
  @IsOpenCaseCategory()
  category?: string;

  /** Empty or omitted → the service stores a stated default, never a blank. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  need_detail?: string;
}
