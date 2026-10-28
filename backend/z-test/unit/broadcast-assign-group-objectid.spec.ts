/**
 * [FIX-2708-ASSIGNGROUPOID] ObjectId ที่ `assign_group.id` ต้องผ่านด่านสิทธิ์
 * ===========================================================================
 * เจอจริงตอนเทสใหญ่ 27/08: ทุก job ที่สร้างผ่าน API แล้วกดส่ง ได้ 403
 * "assign_group is required" ทั้งที่สิทธิ์ถูกต้องและกลุ่มตรง
 *
 * ต้นเหตุ (dive, ไม่ใช่เดา):
 *   · `resolveAssignGroup` คืน `{ id: ObjectId, name }` — สัญญาของมันเอง
 *     (`content-oa-access.util.ts:140-143`) และ `broadcasts.service.ts:168,247`
 *     เขียนรูปนี้ลงแถวตอน create
 *   · `broadcasts.service.ts:738` ส่ง `broadcast.assign_group?.id` ⇒ ตัวที่ไหลเข้า
 *     `ensureAssignGroupAccess` คือ **ObjectId ดิบ** ไม่ใช่ string และไม่ใช่ object
 *     ที่มีคีย์ `id` ⇒ ไม่เข้า branch ไหนเลย ⇒ `assignStr=''` ⇒ 403 เสมอ
 *   · หัวไฟล์เดียวกัน (:131-138) เตือนเรื่อง ObjectId/`.id` ไว้แล้ว แต่เตือนคนละขา
 *     (ขา "อย่า unwrap object") — ขา "รับ ObjectId ดิบ" ยังไม่มีใครรับ
 *
 * เคสนี้ปักทั้งสองรูปที่ระบบผลิตจริง: ObjectId ดิบ และ `{id: ObjectId}`
 */
import mongoose from 'mongoose';

import { ensureAssignGroupAccess } from '@/modules/content';

const GROUP = 'a0d00000000000000000001e';
const user = { groups: [GROUP], role_name: 'admin' } as never;

describe('[ASSIGNGROUPOID] ด่านสิทธิ์ต้องอ่าน ObjectId ออก', () => {
  it('⭐⭐ ObjectId ดิบ (สิ่งที่ broadcasts.service.ts:738 ส่งมาจริง) ต้องผ่าน', () => {
    const oid = new mongoose.Types.ObjectId(GROUP);
    expect(() => ensureAssignGroupAccess(user, oid)).not.toThrow();
  });

  it('⭐ `{id: ObjectId}` (รูปที่ resolveAssignGroup คืน) ต้องผ่าน', () => {
    const wrapped = { id: new mongoose.Types.ObjectId(GROUP), name: 'g' };
    expect(() => ensureAssignGroupAccess(user, wrapped)).not.toThrow();
  });

  it('string เดิมยังผ่านเหมือนเดิม · กลุ่มอื่นยังถูกปฏิเสธ', () => {
    expect(() => ensureAssignGroupAccess(user, GROUP)).not.toThrow();
    const other = new mongoose.Types.ObjectId('a0d000000000000000000028');
    expect(() => ensureAssignGroupAccess(user, other)).toThrow(
      /insufficient group access/,
    );
  });

  it('ค่าที่ว่างจริงยังถูกปฏิเสธด้วยข้อความเดิม — ห้ามหลวมเกินที่แก้', () => {
    for (const bad of [undefined, null, '', {}, { id: undefined }]) {
      expect(() => ensureAssignGroupAccess(user, bad)).toThrow(
        /assign_group is required/,
      );
    }
  });
});
