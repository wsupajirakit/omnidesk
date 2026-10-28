/**
 * [FEAT-20260828-JOBSEARCH] ค้นแคมเปญด้วยชื่อ หรือ id ของงาน
 * ===========================================================================
 * เจ้าของ 28/08: *"หน้าหลักด้วย search job ด้วย id ได้ (ทั้งประวัติและ job
 * search job id ได้)"* · *"หน้า broadcast search 4 ตัวขึ้นไป"*
 *
 * 🔴 เคสที่สำคัญที่สุดในไฟล์นี้คือ **ขอบเขตสิทธิ์ต้องไม่ถูกทับ**
 *    `listBroadcasts` ใช้ `filters['$or']` ไปแล้วสำหรับจำกัดกลุ่มของผู้ใช้ที่ไม่ใช่
 *    superuser · ถ้าคำค้นเขียน `$or` ทับ ขอบเขตนั้นจะหายไป **เงียบ ๆ** และผู้ใช้
 *    จะเห็นแคมเปญของกลุ่มอื่น — บั๊กความปลอดภัย ไม่ใช่บั๊กการแสดงผล
 *    ⇒ คอมเมนต์ในไฟล์นั้นเตือนเรื่องนี้ไว้เองตั้งแต่ 25/08 · เคสนี้ทำให้คำเตือน
 *      กลายเป็นสิ่งที่บังคับได้จริง
 */
import mongoose from 'mongoose';

import { BroadcastsReadService } from '@/modules/content/broadcasts-read.service';
import type { AuthenticatedUser } from '@/common';

const GROUP = 'a0d00000000000000000001e';
const JOB_ID = 'a0d000000000000000000038';

const scoped = {
  userId: 'op-1',
  roleName: 'operator',
  groups: [GROUP],
} as unknown as AuthenticatedUser;

const superadmin = {
  userId: 'admin-1',
  roleName: 'superadmin',
} as unknown as AuthenticatedUser;

/** จับ filter ที่ถูกส่งเข้า `find()` — รูปของ query คือสิ่งเดียวที่ตัดสินผลลัพธ์ */
function makeService() {
  const filters: Record<string, unknown>[] = [];
  const chain = {
    sort: () => chain,
    skip: () => chain,
    limit: () => chain,
    lean: () => Promise.resolve([]),
  };
  const broadcastModel = {
    countDocuments: (f: Record<string, unknown>) => {
      filters.push(f);
      return Promise.resolve(0);
    },
    find: (f: Record<string, unknown>) => {
      filters.push(f);
      return chain;
    },
  };
  /* ⚠️ เส้นจริงคือ `.find().select().lean()` — `lean()` คืนอาร์เรย์เลย ไม่มี `.exec()`
     เคยใส่ `.exec()` แล้วพัง (`hooks.map is not a function`) ⇒ ต้องตรงกับของจริง */
  const hookModel = {
    find: () => ({
      select: () => ({ lean: () => Promise.resolve([]) }),
    }),
  };
  const service = new BroadcastsReadService(
    broadcastModel as never,
    hookModel as never,
    {
      model: () => ({
        find: () => ({
          select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
        }),
      }),
    } as never,
  );
  return { service, filters };
}

const listWith = async (
  search: string | undefined,
  user: AuthenticatedUser = superadmin,
) => {
  const { service, filters } = makeService();
  await service.listBroadcasts(user, search === undefined ? {} : { search });
  return filters[0] ?? {};
};

/** ก้อน `$or` ที่มาจากคำค้น (อยู่ใน `$and` เสมอ) */
const searchOr = (filter: Record<string, unknown>) => {
  const and = filter['$and'] as Array<Record<string, unknown>> | undefined;
  return and?.[and.length - 1]?.['$or'] as
    Record<string, unknown>[] | undefined;
};

describe('[JOBSEARCH] ค้นด้วยชื่อ หรือ id', () => {
  it('⭐⭐ 🔴 hex24 ⇒ ค้นทั้งชื่อและ `_id` แบบ ObjectId', () => {
    return listWith(JOB_ID).then((filter) => {
      const or = searchOr(filter);
      expect(or).toHaveLength(2);
      expect(Object.keys(or?.[0] ?? {})).toEqual(['name']);
      expect(or?.[1]?.['_id']).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(String(or?.[1]?.['_id'])).toBe(JOB_ID);
    });
  });

  it('⭐⭐ 🔴 คำธรรมดา ⇒ ค้นชื่ออย่างเดียว และต้องไม่พยายามแปลงเป็น ObjectId', () => {
    /* `new ObjectId('promo')` โยนทันที ⇒ ถ้าไม่เช็ครูปก่อน การพิมพ์ค้นตามปกติ
       จะทำให้ทั้งคำขอ 500 แทนที่จะแค่หาไม่เจอ */
    return listWith('promo').then((filter) => {
      const or = searchOr(filter);
      expect(or).toHaveLength(1);
      expect(Object.keys(or?.[0] ?? {})).toEqual(['name']);
    });
  });

  it('⭐⭐ 🔴 สั้นกว่า 4 ตัว ⇒ ไม่ค้นเลย', async () => {
    for (const short of ['', 'a', 'ab', 'abc', '   ']) {
      expect(searchOr(await listWith(short))).toBeUndefined();
    }
    expect(searchOr(await listWith('abcd'))).toHaveLength(1);
  });

  it('⭐ อักขระ regex ถูกหนี — ไม่ทำให้คำขอทั้งใบพัง', async () => {
    const or = searchOr(await listWith('a(b)+$'));
    const pattern = (or?.[0]?.['name'] as { $regex: string })?.$regex;
    expect(pattern).toBe('a\\(b\\)\\+\\$');
    expect(new RegExp(pattern).test('xxa(b)+$yy')).toBe(true);
  });
});

describe('[JOBSEARCH] 🔴 ขอบเขตสิทธิ์ต้องไม่ถูกทับ', () => {
  it('⭐⭐ 🔴 ผู้ใช้ที่ไม่ใช่ superuser: ค้นแล้วขอบเขตกลุ่มยังอยู่ครบ', async () => {
    const filter = await listWith(JOB_ID, scoped);

    /* ขอบเขตกลุ่มยังอยู่ที่ `$or` ระดับบนสุด ไม่ถูกคำค้นเขียนทับ */
    const scopeOr = filter['$or'] as Record<string, unknown>[];
    expect(scopeOr).toBeDefined();
    expect(scopeOr.map((c) => Object.keys(c)[0]).sort()).toEqual([
      'assign_group.id',
      'assign_group_ids',
    ]);
    /* และคำค้นไปอยู่ใน `$and` แยกจากกัน ⇒ ทั้งสองเงื่อนไขต้องเป็นจริงพร้อมกัน */
    expect(searchOr(filter)).toHaveLength(2);
  });

  it('⭐⭐ 🔴 ไม่ค้นอะไร ⇒ ขอบเขตกลุ่มยังเหมือนเดิมทุกประการ', async () => {
    const filter = await listWith(undefined, scoped);

    expect(filter['$or']).toBeDefined();
    expect(filter['$and']).toBeUndefined();
  });
});
