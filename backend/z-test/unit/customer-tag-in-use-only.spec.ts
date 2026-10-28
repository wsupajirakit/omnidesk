/**
 * [FIX-20260814-TAGINUSEONLY] — ตัวเลือกป้ายต้องมีลูกค้าใช้จริงทุกอัน
 * ============================================================================
 * เจ้าของสั่ง 2026-08-14: "คิวรี่เหมือนเดิมเลย แต่ถ้าไม่มีคนใช้ = ไม่ต้องออกมาใน
 * select option" + "ต้องใช้ได้จริงทั้งหมดที่มีให้เลือก"
 *
 * ⚠️ ทำไมต้องนับจาก customer_tags ไม่ใช่เชื่อ `use_count`:
 *    `use_count` ถูก `$inc: 1` ตอนติดป้าย (chat.service.ts:1570) และ **ไม่มีที่ไหน
 *    ลดมันตอนถอดป้ายออก** ⇒ ป้ายที่ลูกค้าคนสุดท้ายถูกถอดไปแล้ว ยังค้าง count เป็นบวก
 *    ตลอดกาล การเชื่อ field นี้จึงเท่ากับโชว์ป้ายผีที่ฟีเจอร์นี้ตั้งใจกำจัด
 *    พิสูจน์กับ DB จริงแล้ว: ป้ายผี use_count=99 (สูงสุด) โผล่บนสุดก่อนแก้ · หายหลังแก้
 *
 * ⚠️ ขอบเขต: กรองแค่ "รายการที่ให้เลือก" — sort/limit/response shape เหมือนเดิมทุกอย่าง
 *    และตรรกะกรอง ticket ไม่ถูกแตะ (ป้ายที่แอดมินเลือกไว้แล้วยังกรองได้ปกติ)
 */
import { ChatService } from '@/modules/chat';

/** ตัวช่วยจำลอง `tagModel.find(...).sort(...).limit(...).lean()` */
interface TagChain {
  find: jest.Mock;
  sort: jest.Mock;
  limit: jest.Mock;
  lean: jest.Mock;
}
function tagChain(rows: unknown[]): TagChain {
  // annotate ไว้เพราะ chain อ้างถึงตัวเอง — ไม่งั้น tsc ฟ้อง implicit any (TS7022)
  const chain: TagChain = {
    find: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeService(opts: { tags: unknown[]; inUseIds: unknown[] }) {
  const tagModel = tagChain(opts.tags);
  const distinct = jest.fn().mockResolvedValue(opts.inUseIds);
  const customerTagModel = { distinct };

  /* ChatService รับ dep หลายตัว — ใส่เฉพาะสองตัวที่เมธอดนี้แตะ ที่เหลือปล่อยว่าง
     (ถ้าเมธอดไปแตะตัวอื่นเมื่อไหร่ เทสจะพังทันที ซึ่งเป็นสัญญาณที่ต้องการ) */
  const svc = Object.create(ChatService.prototype) as ChatService;
  Object.assign(svc, { tagModel, customerTagModel });
  return { svc, tagModel, distinct };
}

const TAG_A = { _id: 'tag-a', label: '123123', color: null, use_count: 2 };
const TAG_B = { _id: 'tag-b', label: '4123', color: null, use_count: 1 };

/* [FEAT-20260816-TAGSCOPE] The "global" behaviour this suite pins is now the
   superadmin view only — everyone else is scoped by OA (tested in
   tag-popular-scope.spec.ts) and an auth-less call is fail-closed. Every
   original case must therefore call as super, or what it means to assert
   (the in-use/sort/limit/shape logic) would never even run. */
const SUPER = { roleName: 'superadmin' } as never;

describe('[TAG IN-USE ONLY] listPopularTags กรองเฉพาะป้ายที่มีลูกค้าใช้', () => {
  it('⭐ query ถูกจำกัดด้วย _id ของป้ายที่มีใน customer_tags', async () => {
    const { svc, tagModel, distinct } = makeService({
      tags: [TAG_A, TAG_B],
      inUseIds: ['tag-a', 'tag-b'],
    });

    await svc.listPopularTags({ limit: '20' }, SUPER);

    expect(distinct).toHaveBeenCalledWith('tag_id'); // ⭐ นับจากของจริง
    expect(tagModel.find).toHaveBeenCalledWith({
      _id: { $in: ['tag-a', 'tag-b'] },
    });
  });

  it('⭐ ไม่มีป้ายไหนถูกใช้เลย = ไม่มีตัวเลือก (ไม่ใช่โชว์ทั้งหมด)', async () => {
    /* จุดพลาดคลาสสิก: `$in: []` ต้องได้ผลลัพธ์ว่าง ไม่ใช่ "ไม่กรอง" — ถ้าเผลอ
       เขียนเป็น `inUseIds.length ? {...} : {}` จะกลายเป็นโชว์ป้ายผีทั้งหมด */
    const { svc, tagModel } = makeService({ tags: [], inUseIds: [] });

    const out = (await svc.listPopularTags({ limit: '20' }, SUPER)) as {
      data: unknown[];
    };

    expect(tagModel.find).toHaveBeenCalledWith({ _id: { $in: [] } });
    expect(out.data).toEqual([]);
  });

  it('sort / limit / รูปแบบผลลัพธ์ ไม่เปลี่ยนจากเดิม', async () => {
    // ฟีเจอร์นี้เพิ่มเงื่อนไขเดียว — อย่างอื่นต้องเหมือนเดิมเป๊ะ
    const { svc, tagModel } = makeService({
      tags: [TAG_A, TAG_B],
      inUseIds: ['tag-a', 'tag-b'],
    });

    const out = (await svc.listPopularTags({ limit: '20' }, SUPER)) as {
      success: boolean;
      data: Record<string, unknown>[];
    };

    expect(tagModel.sort).toHaveBeenCalledWith({
      use_count: -1,
      last_used_at: -1,
    });
    expect(tagModel.limit).toHaveBeenCalledWith(20);
    expect(out.success).toBe(true);
    expect(out.data[0]).toEqual({
      _id: 'tag-a',
      label: '123123',
      color: null,
      use_count: 2,
    });
  });

  it('limit ยังถูกบีบอยู่ในช่วงเดิม (1..50)', async () => {
    const { svc, tagModel } = makeService({ tags: [], inUseIds: [] });
    await svc.listPopularTags({ limit: '999' }, SUPER);
    expect(tagModel.limit).toHaveBeenCalledWith(50);
  });
});
