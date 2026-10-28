/**
 * [FEAT-20260821-RATELADDER] Per-customer rate-limit ESCALATION — the policy.
 * ===========================================================================
 * Owner, 21/08:
 *   "rate limit รายคน ปัจจุบันมี level เดียว (lv1) … Level stack ต้องรู้ว่าติดกี่ครั้ง =
 *    reset เมื่อครบ 12 ชั่วโมง · ติดครั้งที่สอง ×2 เวลาของ level 1 || จำนวนข้อความที่รับได้
 *    ต่อ window /2 (ต่ำสุดสอง) · สาม ×3 · สี่ ×4 · รวม text+sticker+image+vdo (ทุก event)
 *    · ต้องถอดเงื่อนไขได้ทุกส่วน แม้กระทั่งชนิด event · ไม่ใช้ env ใช้ code
 *    · ข้อความที่ hard code ไว้ ห่อไว้ เผื่อเปลี่ยนใจเปลี่ยนข้อความ หรือตั้งเงียบได้"
 *
 * WHAT THIS FILE IS: pure functions over ONE config object. No Redis, no Nest,
 * no clock. The service beside it (`user-rate-ladder.service.ts`) owns the
 * strike counter; the webhook owns the reply. Everything the owner asked to be
 * removable is a FIELD of `DEFAULT_USER_RATE_LADDER`, and
 * `z-test/unit/user-rate-ladder.spec.ts` removes each one in turn to prove the
 * rest stands. แต่ละชั้นถอดได้ที่ config ไม่ต้องแตะตรรกะ.
 *
 * LEVEL 1 IS TODAY, BYTE FOR BYTE: base numbers come from the env the limiter
 * already reads (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`), level 1 adds no
 * key suffix, and `reply.text` defaults to the exact sentence that was hard-coded
 * in webhook.service.ts. A customer who never trips the limit twice inside the
 * reset window is on the same path as before this file existed.
 *
 * THE NUMBERS, as the owner stated them:
 *   level n (n ≥ 2) → window = base × levels[n-2].windowMultiplier
 *                     max    = halveMax ? max(minMax, floor(base / 2)) : base
 *   (÷2 ONCE, not per level — "จำนวนข้อความ /2" is relative to level 1 every time.)
 *   Beyond the last row the ladder stays on the last row ("สี่ ×4" is the ceiling).
 *
 * revert: delete this folder, drop the provider from webhook.module.ts, and put
 * `this.rateLimit.consume('default', userId)` back at the one call site.
 */

/** One rung above level 1. Delete a row to remove that level; the rows above shift down. */
export interface UserRateLevel {
  /** window = base window × this */
  windowMultiplier: number;
  /** max = max(minMax, floor(base max / 2)) when true; base max when false */
  halveMax: boolean;
  /** this level's reply; `undefined` = use `reply.text`; `null` = SILENT at this level */
  replyText?: string | null;
}

export interface UserRateLadderConfig {
  /** false = level 1 only, no strike reads or writes — today's behaviour exactly */
  enabled: boolean;
  /** strikes live this long, counted from the FIRST strike (fixed, not sliding) */
  strikeResetHours: number;
  /** the halving never goes below this */
  minMax: number;
  /** levels[0] is reached after the 1st strike, levels[1] after the 2nd, … */
  levels: ReadonlyArray<UserRateLevel>;
  /** which LINE message types are charged. Absent/false = not counted (postback, follow, location…) */
  countedTypes: Readonly<Record<string, boolean>>;
  /** the sentence sent when limited (level 1 and any level without its own); `null` = silent */
  reply: { text: string | null };
}

/** The hard-coded sentence from webhook.service.ts, kept byte-identical here. */
export const LEGACY_RATE_LIMIT_TEXT = 'กรุณารอสักครู่และลองใหม่อีกครั้ง';

export const DEFAULT_USER_RATE_LADDER: UserRateLadderConfig = {
  enabled: true,
  /* [FEAT-20260823-STRIKE2H] 12 → 2 ชั่วโมง (เจ้าของสั่ง 23/08/2026)
     WAS 12: ลูกค้าที่พิมพ์รัวช่วงเดียวสองนาที (คนร้อนใจรอคำตอบ ไม่ใช่คนกวน)
     ต้องติดโควตาแคบไปอีกเกือบทั้งวัน — คุยงานจริงลำบาก.
     NOW 2: คนพลาดกลับเป็นปกติภายในสองชั่วโมง ส่วนคนที่ตั้งใจกวนก็ยังโดนซ้ำ
     ได้อยู่ดีเพราะเขากลับมาทำอีกภายในหน้าต่างนี้แน่นอน.
     ⚠️ นับจาก strike **ใบแรก** ไม่ใช่ใบล่าสุด (TTL ตั้งครั้งเดียวตอน count===1
        ที่ redis.service.ts:89) ⇒ ยิงเพิ่มไม่ต่ออายุ ไม่มีทางค้างถาวร.
     revert: เปลี่ยนกลับเป็น 12 บรรทัดล่างนี้ (ไม่มีที่อื่นต้องแก้). */
  strikeResetHours: 2,
  minMax: 2,
  levels: [
    { windowMultiplier: 2, halveMax: true }, // 2nd strike → ×2, max ÷2
    { windowMultiplier: 3, halveMax: true }, // 3rd strike → ×3
    /* [FEAT-20260823-L4X6] ชั้นสุดท้าย ×6 ไม่ใช่ ×4 — เจ้าของสั่ง 23/08/2026:
       *"level 4 ให้ x 6 แทน ในเวลารอปลด"*
       เหตุผล: ×4 กับ ×3 ห่างกันแค่ 30 วิ (90→120) ซึ่งแทบไม่ต่างสำหรับคนที่
       ตั้งใจกวนแล้วสามรอบ. ×6 ทำให้ชั้นเพดานมีน้ำหนักจริง (90→180 วิ)
       ⚠️ กระทบเฉพาะ "เวลารอ" ไม่แตะจำนวนข้อความ — โควตายังเป็น
          max(minMax, floor(base÷2)) เท่าเดิมทุกชั้น.
       ⚠️ ชั้นนี้ยังเป็นเพดาน: strike ที่ 4, 5, 20 ก็อยู่ชั้นนี้เหมือนกันหมด.
       revert: เปลี่ยน 6 กลับเป็น 4 บรรทัดล่างนี้ (ไม่มีที่อื่นต้องแก้). */
    { windowMultiplier: 6, halveMax: true }, // 4th+ strike → ×6 (ceiling)
  ],
  // Owner: "ทุก event". Before this, sticker/video/audio/file were never charged
  // (they left the webhook before the limiter). Flip one to `false` to restore
  // that for a single type.
  countedTypes: {
    text: true,
    image: true,
    sticker: true,
    video: true,
    audio: true,
    file: true,
  },
  reply: { text: LEGACY_RATE_LIMIT_TEXT },
};

export interface BaseLimits {
  limit: number;
  windowSeconds: number;
}

/**
 * ONE KEY PER CUSTOMER, at every level. A level changes only the limit and the
 * TTL a window gets when it STARTS (the limiter sets expiry on the first hit);
 * mid-window the same counter keeps climbing, so a customer who just tripped
 * level 1 stays blocked until that window ends instead of landing in a fresh
 * level-2 window with two free messages. That leak was real — seen live on
 * 21/08 with per-level keys: messages 5 and 6 of a burst of 6 went through.
 * หนึ่งคน หนึ่ง key · ชั้นเปลี่ยนตัวเลข ไม่เปลี่ยนถัง.
 */
export type LevelLimits = BaseLimits;

/** strikes → level. 1-based so "level 1" in conversation is level 1 in code. */
export function levelFor(strikes: number, cfg: UserRateLadderConfig): number {
  if (!cfg.enabled || cfg.levels.length === 0 || strikes <= 0) return 1;
  return 1 + Math.min(strikes, cfg.levels.length);
}

/** The limiter's numbers at a level. Level 1 returns the base untouched. */
export function limitsAtLevel(
  level: number,
  base: BaseLimits,
  cfg: UserRateLadderConfig,
): LevelLimits {
  const row = level >= 2 ? cfg.levels[level - 2] : undefined;
  if (!row) return { ...base };
  return {
    limit: row.halveMax
      ? Math.max(cfg.minMax, Math.floor(base.limit / 2))
      : base.limit,
    windowSeconds: base.windowSeconds * row.windowMultiplier,
  };
}

/** Is this LINE message type charged against the window? */
export function isCountedType(
  messageType: string | undefined | null,
  cfg: UserRateLadderConfig,
): boolean {
  return !!messageType && cfg.countedTypes[messageType] === true;
}

/** What to answer at a level — `null` means say nothing. */
export function replyTextFor(
  level: number,
  cfg: UserRateLadderConfig,
): string | null {
  const row = level >= 2 ? cfg.levels[level - 2] : undefined;
  if (row && row.replyText !== undefined) return row.replyText;
  return cfg.reply.text;
}
