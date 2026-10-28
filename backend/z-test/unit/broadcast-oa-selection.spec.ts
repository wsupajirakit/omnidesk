/**
 * [FEAT-20260824-BCASTMULTIOA] Many OAs and many groups in one job.
 * ===========================================================================
 * Owner, 24/08: *"เป้าหมมาย job เลือกได้หลาย group หลาย hook oa ใน job เดียว ทำดีๆ
 * ห้ามสร้างหนี้ อืสระ module ถอดได้ไม่พัง ห้ามคอขวด"*.
 *
 * The two dangerous cases are the duplicate (a follower receiving the card
 * twice) and the silent cap (an admin told nothing about OAs that were dropped).
 * Both get their own case below.
 */
import {
  HOOK_GROUP_COLUMN,
  mergeOaSelection,
  oaGroupExpansionQuery,
} from '@/modules/content/audience';

/** A stand-in for a Mongo ObjectId — only `toHexString` is ever asked for. */
const oid = (hex: string) => ({ toHexString: () => hex });

const A = 'a0d00000000000000000003b';
const B = 'a0d00000000000000000003c';
const C = 'a0d00000000000000000003d';

describe('oaGroupExpansionQuery — the shape, never a query', () => {
  it('asks for the OAs of the given groups, through the indexed column', () => {
    const q = oaGroupExpansionQuery([A, B]);
    expect(q?.filter).toEqual({ [HOOK_GROUP_COLUMN]: { $in: [A, B] } });
    expect(q?.projection).toEqual({ _id: 1 });
  });

  it('🔴 no groups ⇒ `null`, so the caller runs NO query at all', () => {
    /* An empty `$in` matches nothing, which reads exactly like "the group has
       no OAs" — a different fact, and the one that would hide a mistake.
       ไม่ได้เลือกกลุ่ม ≠ กลุ่มว่าง. */
    expect(oaGroupExpansionQuery([])).toBeNull();
    expect(oaGroupExpansionQuery(undefined)).toBeNull();
    expect(oaGroupExpansionQuery(null)).toBeNull();
    expect(oaGroupExpansionQuery('not-an-array')).toBeNull();
  });

  it('drops empty slots rather than asking for `$in: [null]`', () => {
    expect(oaGroupExpansionQuery([null, undefined])).toBeNull();
    expect(oaGroupExpansionQuery([A, null])?.filter).toEqual({
      [HOOK_GROUP_COLUMN]: { $in: [A] },
    });
  });
});

describe('mergeOaSelection — hooks and groups add up', () => {
  it('explicit picks plus group expansion, explicit first', () => {
    const s = mergeOaSelection([oid(A)], [{ _id: oid(B) }, { _id: oid(C) }]);
    expect(s.hookIds).toEqual([A, B, C]);
    expect(s.addedFromGroups).toBe(2);
  });

  it('accepts bare ids as well as projected documents', () => {
    const s = mergeOaSelection([A], [oid(B)]);
    expect(s.hookIds).toEqual([A, B]);
  });

  it('works with only groups, and with only hooks', () => {
    expect(mergeOaSelection([], [{ _id: oid(A) }]).hookIds).toEqual([A]);
    expect(mergeOaSelection([A], []).hookIds).toEqual([A]);
    expect(mergeOaSelection([], []).hookIds).toEqual([]);
  });
});

describe('mergeOaSelection — 🔴 the same OA twice is a card sent twice', () => {
  it('🔴 an OA reached BOTH ways is addressed once', () => {
    /* Picked by hand AND inside a chosen group. Without the dedupe the run does
       two LINE requests for one OA: two history rows, and a follower who gets
       the same card twice. ลูกค้าได้การ์ดซ้ำ. */
    const s = mergeOaSelection([oid(A)], [{ _id: oid(A) }, { _id: oid(B) }]);
    expect(s.hookIds).toEqual([A, B]);
    expect(s.addedFromGroups).toBe(1);
  });

  it('🔴 dedupes across WRAPPER kinds — a string and an ObjectId of the same id', () => {
    /* `hook_ids` come back as ObjectIds from a lean read while a request body
       carries strings. Comparing by identity would let the same OA through
       twice. เทียบด้วย hex ไม่ใช่ตัวอ้างอิง. */
    const s = mergeOaSelection([A], [{ _id: oid(A) }]);
    expect(s.hookIds).toEqual([A]);
    expect(s.addedFromGroups).toBe(0);
  });

  it('🔴 two DIFFERENT non-id objects must not collapse into one', () => {
    /* `String(obj)` gives `'[object Object]'` for anything without
       `toHexString`, so a naive implementation would dedupe eight unrelated
       objects down to one — a job addressing eight OAs sending to one while
       reporting eight. ห้ามใช้ String() ตรง ๆ. */
    const s = mergeOaSelection(
      [],
      [{ _id: { junk: 1 } }, { _id: { junk: 2 } }],
    );
    expect(s.hookIds).toEqual([]);
    expect(s.addedFromGroups).toBe(0);
  });
});

describe('mergeOaSelection — 🔴 the cap must be visible', () => {
  it('🔴 says so when it cut, and never caps silently', () => {
    /* A silent cap reads as "these are all your OAs", and the send then refuses
       the job for a reason the admin was never shown. ตัดแล้วต้องบอก. */
    const s = mergeOaSelection([oid(A)], [{ _id: oid(B) }, { _id: oid(C) }], 2);
    expect(s.hookIds).toEqual([A, B]);
    expect(s.truncatedToHooks).toBe(2);
  });

  it('🔴 explicit picks survive the cap; the group expansion is what gets cut', () => {
    /* An admin who typed an OA meant that one. A group is a bulk gesture.
       ที่เลือกเองต้องรอด. */
    const s = mergeOaSelection([oid(A), oid(B)], [{ _id: oid(C) }], 2);
    expect(s.hookIds).toEqual([A, B]);
    expect(s.hookIds).not.toContain(C);
  });

  it('🔴 `addedFromGroups` counts what SURVIVED, not what was found', () => {
    /* Otherwise the report claims a group contributed OAs this run never
       touches. */
    const s = mergeOaSelection([oid(A)], [{ _id: oid(B) }, { _id: oid(C) }], 2);
    expect(s.addedFromGroups).toBe(1);
  });

  it('no cap, a zero cap and a negative cap all mean "unbounded"', () => {
    const rows = [{ _id: oid(B) }, { _id: oid(C) }];
    expect(mergeOaSelection([oid(A)], rows).hookIds).toHaveLength(3);
    expect(mergeOaSelection([oid(A)], rows, 0).hookIds).toHaveLength(3);
    expect(mergeOaSelection([oid(A)], rows, -1).hookIds).toHaveLength(3);
  });

  it('a cap that cuts nothing leaves no truncation marker', () => {
    /* absent ≠ 0 — "nothing was cut" must not look like "cut to zero". */
    const s = mergeOaSelection([oid(A)], [{ _id: oid(B) }], 5);
    expect(s).not.toHaveProperty('truncatedToHooks');
  });
});

describe('mergeOaSelection — งานเก่าต้องไม่ขยับ (seamless)', () => {
  it('🔴 a job with no groups addresses exactly its own hook_ids', () => {
    /* Every campaign that exists today is in this state. If this ever changes,
       the feature moved somebody else's campaign.
       ไม่เลือกกลุ่ม = ยิงตาม hook_ids เดิมเป๊ะ. */
    const s = mergeOaSelection([oid(A), oid(B)], []);
    expect(s.hookIds).toEqual([A, B]);
    expect(s.addedFromGroups).toBe(0);
    expect(s).not.toHaveProperty('truncatedToHooks');
  });
});
