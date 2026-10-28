/**
 * [FEAT-20260828-LOGSEARCH] ค้นประวัติการส่งด้วยชื่อ OA หรือ id ของ job
 * ===========================================================================
 * เจ้าของ 28/08: *"เพิ่ม search ค้นหาด้วย hook name + job id ได้
 * (ต้องพิมพ์ 4 ตัวอักษรขึ้นไป)"*
 *
 * 🔴 ทำไมกฎอยู่ฝั่ง BE ไม่ใช่ฝั่งหน้าจอ: รายการนี้แบ่งหน้าที่เซิร์ฟเวอร์
 *    ⇒ กรองฝั่ง FE จะค้นเจอแค่แถวของหน้าที่เปิดอยู่ · พิมพ์ชื่อที่มีจริงแล้วได้ผลว่าง
 *      ทั้งที่แถวนั้นอยู่หน้า 3 — ผิดแบบเงียบ ไม่มี error ให้เห็น
 *
 * เทสนี้จับ **filter จริงที่ถูกส่งเข้า `find()`** ไม่ใช่จับว่า "ฟังก์ชันถูกเรียก" —
 * สิ่งที่ตัดสินว่าใครถูกค้นเจอคือรูปของ query ก้อนนั้นก้อนเดียว
 */
import { Types } from 'mongoose';

import { WebhookLogService } from '@/modules/system';
import { MIN_SEARCH_CHARS } from '@/modules/system/webhook-log.service';

/** query double ที่บันทึก filter ทุกก้อนที่ `find()` ได้รับ */
function makeService() {
  const filters: Record<string, unknown>[] = [];
  const chain = (): Record<string, unknown> => ({
    sort: () => chain(),
    skip: () => chain(),
    limit: () => chain(),
    select: () => chain(),
    lean: () => chain(),
    exec: () => Promise.resolve([]),
  });
  const logModel = {
    find: (f: Record<string, unknown>) => {
      filters.push(f);
      return chain();
    },
    countDocuments: () => ({ exec: () => Promise.resolve(0) }),
  };
  const service = new WebhookLogService(
    logModel as never,
    { findById: () => chain() } as never,
    {
      persist: () => {
        throw new Error('listLogs must not write');
      },
    } as never,
  );
  return { service, filters };
}

const listWith = async (search?: string) => {
  const { service, filters } = makeService();
  await service.listLogs({ roleName: 'superadmin', groupIds: [], search });
  return filters[0] ?? {};
};

describe('[LOGSEARCH] ค้นด้วยชื่อ OA หรือ id ของ job', () => {
  /* [FIX-20260828-LOGSEARCHID] เคสนี้เคยปักว่า `$or` มีสองก้อน **เสมอ** ซึ่งผิด
     🔴 `payload_summary.broadcast_id` เก็บเป็น **ObjectId ไม่ใช่สตริง** (วัดจริง
        28/08: objectId ทั้ง 61 แถว) ⇒ `$regex` แมตช์ศูนย์แถวเสมอ · เทสเดิมจึง
        "เขียว" อยู่บนเงื่อนไขที่ค้นอะไรไม่เจอเลย — เขียวไม่ได้แปลว่าใช้งานได้
     ⇒ ตอนนี้: คำค้นทั่วไปค้นแต่ชื่อ OA · เฉพาะ hex 24 ตัวเท่านั้นที่เทียบ id */
  it('⭐⭐ 🔴 คำค้นทั่วไป ⇒ ค้นชื่อ OA อย่างเดียว ไม่ยัดเงื่อนไขที่แมตช์ไม่ได้', async () => {
    const filter = await listWith('omnideskdevoa');
    const or = filter['$or'] as Record<string, unknown>[];

    expect(Array.isArray(or)).toBe(true);
    expect(or).toHaveLength(1);
    expect(Object.keys(or[0] ?? {})).toEqual(['hook_alias']);
  });

  it('⭐⭐ 🔴 hex 24 ตัว ⇒ เทียบ id เป็น ObjectId ไม่ใช่ regex', async () => {
    /* regex กับคอลัมน์ ObjectId = ศูนย์แถวเสมอ · นี่คือบั๊กที่เจ้าของเจอ */
    const id = 'a0d000000000000000000093';
    const or = (await listWith(id))['$or'] as Record<string, unknown>[];

    expect(or).toHaveLength(2);
    const byId = or[1]?.['payload_summary.broadcast_id'];
    expect(byId).toBeInstanceOf(Types.ObjectId);
    expect(String(byId)).toBe(id);
    /* และยังค้นชื่อ OA ควบคู่ไปด้วย — id ที่พิมพ์อาจบังเอิญเป็นชื่อ OA ก็ได้ */
    expect(Object.keys(or[0] ?? {})).toEqual(['hook_alias']);
  });

  it('⭐ hex24 ตัวพิมพ์ใหญ่ก็ต้องเทียบ id ได้', async () => {
    const or = (await listWith('6A8D21682991FFC8C14F96D7'))['$or'] as Record<
      string,
      unknown
    >[];
    expect(or).toHaveLength(2);
  });

  it('⭐⭐ 🔴 คำที่ไม่ใช่ hex24 ต้องไม่ถูกแปลงเป็น ObjectId — ไม่งั้นคำขอ 500', async () => {
    /* `new Types.ObjectId('omnideskdev')` โยนทันที · ถ้าไม่เช็ครูปก่อน การพิมพ์ค้น
       ตามปกติจะทำให้ทั้งคำขอพัง ไม่ใช่แค่หาไม่เจอ */
    for (const needle of [
      'omnideskdev',
      '6a8d2168',
      'zzzzzzzzzzzzzzzzzzzzzzzz',
    ]) {
      const or = (await listWith(needle))['$or'] as unknown[];
      expect(or).toHaveLength(1);
    }
  });

  it('⭐⭐ 🔴 สั้นกว่าขั้นต่ำ ⇒ ไม่ค้นเลย ไม่ใช่ค้นแบบกว้าง', async () => {
    /* คำสั้นแทบไม่กรองอะไร แต่ยังบังคับสแกนทั้งชุด · ปล่อยผ่าน = ทั้งตารางถูกกวาด
       ทุกครั้งที่ผู้ใช้พิมพ์ตัวแรก */
    for (const short of ['', 'a', 'ab', 'abc']) {
      expect(await listWith(short)).not.toHaveProperty('$or');
    }
    expect('abcd'.length).toBe(MIN_SEARCH_CHARS);
    expect(await listWith('abcd')).toHaveProperty('$or');
  });

  it('⭐⭐ 🔴 อักขระ regex ถูกหนี — ไม่ทำให้คำขอทั้งใบพัง', async () => {
    /* `a(b` เป็น regex ที่ไม่สมบูรณ์ ⇒ ปล่อยดิบ ๆ Mongo จะโยนทั้งคำขอ
       ส่วน `(a+)+$` เปิดทาง ReDoS */
    const filter = await listWith('a(b)+$');
    const or = filter['$or'] as Record<string, { $regex: string }>[];
    const pattern = or[0]?.['hook_alias']?.$regex ?? '';

    expect(pattern).toBe('a\\(b\\)\\+\\$');
    /* ต้องยังคอมไพล์เป็น regex ได้จริง และตรงกับข้อความตรงตัวเท่านั้น */
    expect(new RegExp(pattern).test('xxa(b)+$yy')).toBe(true);
    expect(new RegExp(pattern).test('ab')).toBe(false);
  });

  it('⭐ ไม่สนตัวพิมพ์เล็กใหญ่ และตัดช่องว่างหัวท้ายก่อนนับความยาว', async () => {
    const or = (await listWith('  OmniDeskDev  '))['$or'] as Record<
      string,
      { $regex: string; $options: string }
    >[];
    expect(or[0]?.['hook_alias']?.$options).toBe('i');
    expect(or[0]?.['hook_alias']?.$regex).toBe('OmniDeskDev');
  });

  it('⭐ ไม่ส่งคำค้นมา ⇒ query เหมือนเดิมทุกประการ', async () => {
    /* กันไม่ให้ฟีเจอร์นี้ไปเปลี่ยนพฤติกรรมของทุกคนที่ไม่ได้ค้นอะไร */
    expect(await listWith(undefined)).not.toHaveProperty('$or');
  });
});
