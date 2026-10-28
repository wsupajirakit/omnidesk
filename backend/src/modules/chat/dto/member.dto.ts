import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateMemberNicknameDto {
  @IsString()
  nickname!: string;
}

export class UpdateMemberDetailDto {
  @IsOptional()
  @IsString()
  detail?: string | null;
}

/**
 * [FEAT-20260821-IGNOREABANDON] the shape of the per-customer switch request.
 *
 * ⚠️ THERE IS NO `class-validator` DECORATOR HERE, AND THAT IS THE FIX.
 * A first version of this was a DTO with `@IsBoolean()`. It was WRONG, and a
 * live probe caught it: `main.ts:141` runs the global pipe with
 * `transformOptions: { enableImplicitConversion: true }`, so class-transformer
 * coerces the body BEFORE any validator sees it — and `Boolean('false')` is
 * `true`. Measured against the running server, every one of these answered 200:
 *
 *     'true'  → true      'yes' → true      1 → true
 *     'false' → 🔴 true    0     → false     '' → false
 *
 * So the string `"false"` — the exact thing an HTML form or a `curl` sends —
 * SWITCHED THE CHASE OFF while the operator was switching it back on. That is
 * the failure the sibling bulk routes' headers warn about word for word, and a
 * `@IsBoolean()` decorator cannot prevent it because it runs too late.
 * `"false"` เป็นสตริง truthy · pipe แปลงก่อน validator ⇒ decorator ช่วยไม่ได้.
 *
 * A type alias has no metatype, so the pipe skips it entirely and the raw body
 * reaches the service, which does its own `typeof value !== 'boolean'` check —
 * exactly how `PATCH /hook/abandon/bulk` and its two siblings already work, and
 * that route was measured returning 400 for `"true"` while this one returned
 * 200. Copying the shape that demonstrably works beats decorating a broken one.
 * revert: delete this type and the route/service method that use it.
 */
export type UpdateMemberIgnoreAbandonBody = Record<string, unknown>;

export class RefreshRawProfileDto {
  @IsOptional()
  @IsString()
  hook_id?: string;

  /**
   * [FEAT-20260824-CLAIMPROFILE] The one reason allowed past the refresh
   * cooldown.
   *
   * Owner, 24/08/2026: when an admin takes a room, that customer's profile must
   * be re-fetched and the panel must show the new data immediately — cooldown or
   * not. Taking a case is a single deliberate act, not something a hand can
   * repeat; landing inside another refresh's window would leave the admin with a
   * stale panel and nothing to tell them why.
   *
   * ⚠️ A CLOSED VALUE, DELIBERATELY NOT A BOOLEAN. `force: true` would let any
   * caller switch the guard off, and the first place that gets copied is the
   * manual refresh button — which is the exact thing the cooldown protects.
   * `@IsIn` means the only bypass that exists is the one that was asked for, and
   * the value itself says why, so the audit line can be read later.
   * ค่าปิด ไม่ใช่ boolean — boolean เปิดรูให้ปุ่มมือ.
   *
   * revert: delete this field and the `trigger === 'case_taken'` term in
   *         `members.service.ts`.
   */
  /* [FEAT-20260825-CHATOPENFRESH] เหตุผลที่สองที่ยอมให้ข้าม cooldown
     เจ้าของ 25/08: *"เวลาเข้ามาที่ chat ใดๆ ก็ต้องดึง profile สดๆ ทันที
     ทั้ง site rule / raw profile … ต้องดึงสด (ทะลุเงื่อนไข cooldown) ทุกครั้ง
     เปิดหน้าแชทการ์ดคนนั้นๆ"*
     ⚠️ ยังเป็น **ค่าปิด** เหมือนเดิม — เพิ่มค่าที่อนุญาต ไม่ได้เปลี่ยนเป็น boolean
        ปุ่ม refresh มือยังไม่ส่ง trigger ⇒ ยังติด cooldown เหมือนเดิมทุกประการ
     ⚠️ ค่าบอกเหตุผล ⇒ อ่าน log ย้อนหลังแยกออกว่าใครสั่งดึงเพราะอะไร
        (`request_meta.source` จะเป็น `chat_opened` แยกจาก `manual_refresh`)
     ⚠️ ต้นทุนที่รู้กันแล้ว: เปิดห้อง = ยิงปลายทาง 1 ครั้ง · วัดจริง 25/08 รอบ cold
        ใช้ 3,861ms (90% ของ request) · เจ้าของเคาะแล้วว่าเอาแบบทะลุทุกครั้ง
     revert: เอา 'chat_opened' ออกจาก @IsIn + จากยูเนียน + จุดเรียกฝั่ง FE */
  @IsOptional()
  @IsIn(['case_taken', 'chat_opened'])
  trigger?: 'case_taken' | 'chat_opened';
}

export class ListContactsDto {
  @IsOptional()
  @IsString()
  group_id?: string;

  @IsOptional()
  @IsString()
  hook_id?: string;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  status?: string;

  /**
   * [FEAT-20260823-CONTACTFOLLOW] Filter by the follow-up stamps a member carries.
   *
   * `deposit` | `withdraw` | `both` | `none` — anything else (including absent)
   * means "do not filter", so an old client and a typo both behave exactly as
   * before. The values are validated in the service, not with an enum decorator,
   * to match how `status` and `tag` on this same DTO are handled.
   *
   * WHY IT IS A SERVER FILTER AND NOT AN FE ONE: this listing is paginated by
   * the server ($skip/$limit in listContacts), so filtering the page the client
   * already holds would filter ONE page and leave the total lying.
   * กรองที่ FE = กรองแค่หน้าเดียว ตัวนับจะโกหก
   */
  @IsOptional()
  @IsString()
  follow?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}
