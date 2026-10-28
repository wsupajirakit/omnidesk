/**
 * [FEAT-20260824-BCASTMINT] A choice becomes rules. Pure, so it can be tested
 * without a browser and cannot smuggle in a side effect.
 * ===========================================================================
 * เจ้าของ 24/08: *"แล้วมิ้นค่าให้ในฟอร์ม"* · *"ล้างของเดิมแล้วใส่ใหม่"*.
 */

import type { MintChoice, MintOp } from './mint.registry';

/** The rule shape the form and the backend already agree on. */
export interface MintedRule {
  readonly key: string;
  readonly op: MintOp;
  readonly value: string;
}

/**
 * Turn one choice into the rules that replace the form's current ones.
 *
 * 🔴 IT GOES THROUGH `campaignTime`, THE SAME DOOR THE DATE BOX USES.
 *    That helper stamps the browser's real offset onto the value
 *    (`RuleValueInput.tsx#localOffset`), which is what makes a minted value and
 *    a hand-typed value the SAME KIND of string. Building the ISO here by hand
 *    would create a second spelling of "what time is this", and `docs/TIME-RULE.md`
 *    exists precisely so that never happens twice.
 *    มินต์ต้องออกมาเป็นสตริงชนิดเดียวกับที่คนกรอกเอง ไม่งั้นมีสองความหมายของเวลา.
 *
 * ⚠️ `now` IS A PARAMETER, and that is not only for tests: reading the clock
 *    inside would make the value depend on WHEN THE MODULE LOADED for anyone
 *    who leaves the tab open. The caller passes the instant of the click.
 *    เวลาต้องมาจากตอนกด ไม่ใช่ตอนโหลดไฟล์.
 *
 * @returns exactly ONE rule. It is an array because the form's field is an
 *   array and a future mint may fill in two — the caller must not have to
 *   change shape when that day comes.
 */
export function rulesForChoices(
  choices: readonly MintChoice[],
  now: Date = new Date(),
): MintedRule[] {
  return choices.map(choice => ({
    key: choice.rule_key,
    op: choice.op,
    /* [FIX-20260826-MINTHASVALUE] `has_value` ถามว่า "มีหรือไม่มี" ⇒ **ไม่มีค่าให้กรอก**
       ฝั่งฟอร์มถือกฎเดียวกันอยู่แล้วที่ `OPS_WITHOUT_VALUE`
       (components/campaign/audience/valueSource.registry.ts)
       ⚠️ ต้องเป็นสตริงว่าง ไม่ใช่ `undefined` — รูปร่างของ rule ต้องคงที่
          ไม่งั้นตัวเทียบ/ตัวเซฟฝั่งฟอร์มจะเจอ key หายไปบ้างมีบ้าง
       เดิมตรงนี้ยัด ISO ของ "ตอนนี้" ลงไป ซึ่งเป็นรูปแบบที่ BE ล็อกออกไปแล้ว */
    value: '',
  }));
}

/**
 * รวมตัวเลือกที่ติ๊กไว้เป็นชุดเงื่อนไขชุดเดียว
 *
 * [FIX-20260825-MINTMULTI] เจ้าของ 25/08: *"ให้เลือกฝากและถอนพร้อมกันได้เลย
 * (ใช้เงื่อนไขข้อใดข้อหนึ่งถ้าเลือกทั้งสอง)"*
 * ⇒ เลือก 2 ตัวขึ้นไป = `or` (ข้อใดข้อหนึ่ง) · ตัวเดียว = `and` เหมือนเดิม
 *   เหตุผล: "เคยได้รับแจ้งเตือนฝาก **และ** ถอน" แคบกว่าที่เจ้าของต้องการมาก
 *   คนที่ควรตามคือคนที่เคยได้รับใบใดใบหนึ่ง
 */
export function applyMint(
  choices: readonly MintChoice[],
  now: Date = new Date(),
): { readonly match: 'and' | 'or'; readonly rules: MintedRule[] } {
  return {
    match: choices.length > 1 ? 'or' : 'and',
    rules: rulesForChoices(choices, now),
  };
}
