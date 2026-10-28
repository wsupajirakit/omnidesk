/**
 * [FEAT-20260824-BCASTTAGPICK] Turning tags into pickable options — the pure
 * half, so the rules can be tested without a network or a browser.
 * ===========================================================================
 * เจ้าของ 24/08: *"2 ทำสิครับ dive จริงอย่าสร้างหนี้ทำดี ๆ"* — ต่อจากที่ agent รายงานว่า
 * `customer_tag` ยังใช้บนหน้าจอไม่ได้ เพราะค่าที่ BE ต้องการคือ **`tags._id` (hex)**
 * ไม่ใช่ชื่อป้าย ⇒ แอดมินพิมพ์ "VIP" ลงช่อง text จะโดนปฏิเสธเสมอ
 *
 * ── ข้อเท็จจริงที่วัดจากของจริง 24/08 (ไม่ได้เดาจากโค้ด) ──────────────────────
 * `GET /api/chat/tags/popular?limit=…` ตอบ
 *   `{success, data:[{_id, label, color, use_count}]}`
 * `GET /api/chat/tags/suggest?q=…`     ตอบรูปเดียวกัน
 * แถวจริงใน `tags` มี `_id`,`label`,`key`,`color`,`group_ids`,`use_count` และ
 * `customer_tags.tag_id` ชี้มาที่ `tags._id` ⇒ ค่าที่ต้องเก็บลงกฎคือ `_id`
 *
 * 🔴 ทำไมเก็บ id ไม่เก็บชื่อ — `tag.schema.ts:11-15` บันทึกไว้เองว่าเคยคัดลอกชื่อลง
 *    ทุกแถวแล้ว **ผิด**: "VIP" ของสองกลุ่มยุบรวมกัน และเปลี่ยนชื่อทีต้องไล่แก้ทุกแถว
 *    เก็บ id ⇒ เปลี่ยนชื่อป้ายเมื่อไหร่ campaign ที่เซฟไว้ยังชี้ป้ายใบเดิม
 *
 * revert: ลบไฟล์นี้ + `TagValuePicker.tsx` + entry ใน `valueSource.registry.ts`
 * ⇒ ช่องค่าของ `customer_tag` กลับเป็น text ธรรมดาเหมือนก่อน
 */
import type { MultiCheckOption } from '../pickers/MultiCheckSelect';

/** What both tag endpoints return, field for field. */
export interface TagOptionSource {
  readonly _id: string;
  readonly label: string;
  readonly use_count?: number;
}

/**
 * `24` hex characters — a Mongo ObjectId, which is what `tags._id` is.
 *
 * Used to tell a REAL saved id apart from junk a previous free-text box may
 * have stored (the field accepted anything before this picker existed).
 * ใช้แยก id จริง ออกจากข้อความมั่ว ๆ ที่ช่อง text เดิมเคยรับไว้.
 */
export const TAG_ID_RE = /^[0-9a-f]{24}$/i;

/** One tag → one row in the menu. The id rides along as the greyed hint. */
export function toOption(tag: TagOptionSource): MultiCheckOption {
  return {
    value: tag._id,
    label: tag.label,
    /* The id is shown, not hidden: when a send goes wrong the operator needs
       the exact value that was stored, and a label alone cannot be looked up. */
    hint: tag._id,
  };
}

/**
 * Merge the tags that are LOADED with the ids already SELECTED.
 *
 * 🔴 THIS IS THE ONE THAT MATTERS, and it is not cosmetic. `popular` returns a
 *    top-N list, so a campaign saved months ago can easily hold a tag id that
 *    is not in it. Without this merge the picker renders that id as nothing —
 *    the admin sees an EMPTY condition, "fixes" it by picking something, and a
 *    working campaign silently changes audience.
 *    id ที่เซฟไว้แต่ไม่อยู่ใน list ยอดนิยม ต้องยังโชว์ ไม่งั้นแอดมินเห็นว่าง แล้วแก้ทับของที่ใช้ได้อยู่.
 *
 * ⚠️ An id with no known label keeps the ID as its label rather than a blank or
 *    the word "unknown" — the value is the truth we have; inventing a friendly
 *    name we do not know would be worse than showing the raw one.
 *    ไม่รู้ชื่อ = โชว์ id ห้ามโชว์ว่างและห้ามแต่งชื่อเอง.
 *
 * ⚠️ Order: loaded tags first (the useful ones), then any stray selected ids.
 *    Selected-but-unknown rows are the exception, so they belong at the end.
 */
export function mergeSelectedIntoOptions(
  loaded: readonly TagOptionSource[],
  selected: readonly string[],
): MultiCheckOption[] {
  const options = loaded.map(toOption);
  const known = new Set(options.map(o => o.value));

  for (const id of selected) {
    if (id === '' || known.has(id)) continue;
    known.add(id);
    options.push({ value: id, label: id, hint: id });
  }

  return options;
}

/**
 * The rule's stored value → the list of ids the picker shows as checked.
 *
 * ⚠️ `eq` stores a bare string, `in` stores an array — the backend registry
 *    declares both operators (`ops: ['eq','in']`) and `buildAudienceFilter`
 *    checks the SHAPE, so handing it an array for `eq` refuses the whole job.
 *    Reading has to accept both because a rule can be switched between the two
 *    operators after it was saved. eq=ค่าเดี่ยว · in=ลิสต์ · อ่านต้องรับทั้งคู่.
 */
export function selectedIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v !== '');
  }
  return typeof value === 'string' && value !== '' ? [value] : [];
}

/**
 * The ids the admin picked → the value shape THIS operator needs.
 *
 * 🔴 `eq` COLLAPSES TO THE FIRST ID, and returns `''` — not `undefined`, not
 *    `[]` — when nothing is picked. An empty string is what the text box that
 *    came before produced for "nothing chosen", so the filter builder's
 *    existing refusal path keeps working unchanged. ค่าว่างต้องหน้าตาเหมือนเดิม.
 */
export function valueForOp(op: string, ids: readonly string[]): unknown {
  if (op === 'in') return [...ids];
  return ids[0] ?? '';
}
