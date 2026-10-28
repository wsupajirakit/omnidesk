/**
 * [FEAT-20260825-MULTIGROUP] หลายกลุ่มเว็บใน job เดียว — และแถวเก่าต้องไม่หาย
 * ===========================================================================
 * เจ้าของ 25/08: *"กลุ่มเว็บต้อง multi check เลือกได้หลายกลุ่ม fe be รองรับทำงานจริง"* ·
 * *"ตกลงไม่สร้างหนี้และไม่กระทบ seamless"* · *"note บอกว่าเราไม่ใช้ตัวเดิม"*
 *
 * 🔴 `assign_group` ไม่ใช่ป้ายชื่อ — `broadcasts-read.service.ts` ใช้มันกรอง
 *    **การมองเห็น** ของทุกคนที่ไม่ใช่ superadmin ⇒ พลาดตรงนี้ = แคมเปญหายจากจอ
 *    โดยไม่มี error · เทสในไฟล์นี้ล็อกไว้ทั้งสองทิศ: ของใหม่ต้องเห็น ของเก่าต้องไม่หาย
 */
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  resolveAssignGroups,
  ensureAssignGroupsAccess,
} from '@/modules/content';

const G1 = new mongoose.Types.ObjectId();
const G2 = new mongoose.Types.ObjectId();
const G3 = new mongoose.Types.ObjectId();

/** groupModel ปลอม — คืนกลุ่มที่ "มีอยู่จริง" ตามลิสต์ที่กำหนด */
const groupModel = (known: mongoose.Types.ObjectId[]) =>
  ({
    findById: (id: string) => ({
      select: () => {
        const hit = known.find((k) => k.toString() === String(id));
        return Promise.resolve(
          hit
            ? { _id: hit, group_name: `g-${hit.toString().slice(-4)}` }
            : null,
        );
      },
    }),
  }) as never;

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('resolveAssignGroups — รับได้ทั้งเดี่ยวและลิสต์', () => {
  it('ลิสต์หลายกลุ่ม ⇒ ได้ครบตามลำดับ', async () => {
    const out = await resolveAssignGroups(
      [G1.toString(), G2.toString()],
      groupModel([G1, G2]),
    );
    expect(out.map((g) => g.id.toString())).toEqual([
      G1.toString(),
      G2.toString(),
    ]);
  });

  it('ค่าเดี่ยว (client เก่า) ยังใช้ได้ ⇒ ลิสต์ที่มีสมาชิกตัวเดียว', async () => {
    const out = await resolveAssignGroups(G1.toString(), groupModel([G1]));
    expect(out).toHaveLength(1);
  });

  it('รับ `{id,name}` แบบที่แถวเก่าเก็บไว้ได้', async () => {
    const out = await resolveAssignGroups(
      [{ id: G1.toString(), name: 'อะไรก็ได้' }],
      groupModel([G1]),
    );
    expect(out[0]?.id.toString()).toBe(G1.toString());
  });

  it('ติ๊กซ้ำจาก UI ⇒ ไม่กลายเป็นสองแถวใน DB', async () => {
    const out = await resolveAssignGroups(
      [G1.toString(), G1.toString()],
      groupModel([G1]),
    );
    expect(out).toHaveLength(1);
  });

  it('absent ≠ [] — ไม่ส่งมาเลยได้ลิสต์ว่าง ไม่ใช่ throw', async () => {
    expect(await resolveAssignGroups(undefined, groupModel([]))).toEqual([]);
    expect(await resolveAssignGroups(null, groupModel([]))).toEqual([]);
  });

  it('กลุ่มที่ไม่มีอยู่จริง ⇒ ปฏิเสธ ไม่ใช่ข้ามเงียบ ๆ', async () => {
    await expect(
      resolveAssignGroups([G3.toString()], groupModel([G1])),
    ).rejects.toThrow();
  });
});

describe('ensureAssignGroupsAccess — เช็คทุกกลุ่ม ไม่ใช่ตัวแรก', () => {
  const user = (groups: string[]) =>
    ({ groups, role_name: 'operator' }) as never;

  it('ทุกกลุ่มอยู่ในสิทธิ์ ⇒ ผ่าน', () => {
    expect(() =>
      ensureAssignGroupsAccess(user([G1.toString(), G2.toString()]), [
        { id: G1 },
        { id: G2 },
      ]),
    ).not.toThrow();
  });

  /**
   * 🔴 เคสที่สำคัญที่สุดในไฟล์นี้ — ถ้าเช็คแค่ตัวแรก แอดมินจะแอบผูกกลุ่มที่ตัวเอง
   *    ไม่มีสิทธิ์ไว้ตัวที่ 2 ได้ และไม่มีอะไรฟ้อง
   */
  it('🔴 กลุ่มที่ไม่มีสิทธิ์แอบอยู่ตัวที่สอง ⇒ ต้องโดนปฏิเสธ', () => {
    expect(() =>
      ensureAssignGroupsAccess(user([G1.toString()]), [{ id: G1 }, { id: G2 }]),
    ).toThrow();
  });
});

describe('🔴 seamless — แถวเก่าต้องไม่หายจากหน้าจอ', () => {
  /**
   * source-guard: ตัวกรองการมองเห็นต้องอ่าน **ทั้งสองคีย์**
   * อ่านคีย์เดียวเมื่อไหร่ ฝั่งใดฝั่งหนึ่งหายทันทีโดยไม่มี error ให้เห็น
   */
  it('ตัวกรองอ่านทั้ง assign_group.id (เก่า) และ assign_group_ids (ใหม่)', () => {
    const body = src('src/modules/content/broadcasts-read.service.ts');
    expect(body).toContain("'assign_group.id': { $in: assignGroupIds }");
    expect(body).toContain('assign_group_ids: { $in: assignGroupIds }');
  });

  it('create/update เขียน assign_group คู่ไว้เสมอ — ไม่งั้นแถวใหม่หายจากตัวกรองเก่า', () => {
    const body = src('src/modules/content/broadcasts.service.ts');
    expect(body).toContain('assign_group_ids: assign_groups.map((g) => g.id)');
    expect(body).toContain("updates['assign_group']");
  });
});

/**
 * [FEAT-20260825-ATTIME] + [FEAT-20260825-MULTIGROUP]
 * สองบั๊กที่ **เจอตอนยิงจริงเท่านั้น** — เทสไม่เคยเห็น
 * ===========================================================================
 * 🔴 พิสูจน์ด้วย mutation 25/08: ถอด arm รอบแรกออก → 991 เคสยังเขียวหมด ·
 *    ทำขาอ่านไม่คืน `assign_group_ids` → เขียวหมดเหมือนกัน
 *    ⇒ ทั้งสองเรื่อง "แก้แล้ว" แต่ไม่มีอะไรกันไม่ให้พังซ้ำ
 *    เขียวทั้งชุดไม่ได้แปลว่าของที่เพิ่งแก้ถูกทดสอบ.
 */
describe('🔴 สองบั๊กที่เทสเคยมองไม่เห็น', () => {
  /**
   * บั๊ก 3: repeat job ที่ไม่มี `scheduled_at` ต้องได้ `next_run_at` ตอนสร้าง
   * ไม่งั้น `dueScanQuery` มองไม่เห็นเลย ⇒ **ตั้งไว้แล้วไม่มีวันยิง ไม่มี error**
   */
  it('create ต้อง arm รอบแรกเองเมื่อเป็น repeat และไม่มี scheduled_at', () => {
    const body = src('src/modules/content/broadcasts.service.ts');
    /* ต้องมีสาขาที่ยิง computeNextRun เมื่อเป็น repeat — ไม่ใช่แค่ตอนมี scheduled_at */
    expect(body).toMatch(
      /status === 'scheduled' && isRepeatRule\(schedule\)[\s\S]{0,300}computeNextRun/,
    );
  });

  /* [FIX-20260826-ARMONSTATUS] **พลิกเคส ไม่ลบ**
     เดิมตรึงว่าเส้น update ต้องมี `updates['schedule'] !== undefined` อยู่ใกล้
     `computeNextRun` — แต่ **รูปแบบนั้นเองคือบั๊ก**: มันติดอาวุธก็ต่อเมื่อ request
     ส่ง `schedule` มา ⇒ เปลี่ยน draft → scheduled เฉย ๆ จะไม่ได้ cursor และเงียบ
     ⚠️ วัดจาก prod 26/08: 3 งาน `scheduled` + `repeat` + `at_time_min` มีค่า
        แต่ `next_run_at` ว่าง ⇒ ไม่มีวันถูก scan เจอ
     ⇒ เจตนาของเคสนี้ (**update ต้อง re-arm**) ไม่เปลี่ยน · เปลี่ยนแค่ตัวที่ทำหน้าที่
       จากโค้ดฝังใน service เป็น `armNextRunOnUpdate` ที่มีเทสของตัวเองที่
       `broadcast-arm-on-status.spec.ts` (8 เคส ครอบทั้งด้านที่ต้องติดและห้ามติด) */
  it('update ก็ต้อง re-arm เมื่อกฎซ้ำเปลี่ยน', () => {
    const body = src('src/modules/content/broadcasts.service.ts');
    expect(body).toMatch(/armNextRunOnUpdate\([\s\S]{0,400}scheduleTouched/);
  });

  /**
   * บั๊ก 2: ขาอ่านสร้าง response ทีละ field ⇒ ลืม copy = ฟอร์มเปิดมาว่าง
   * แล้วเซฟครั้งถัดไปทับกลุ่มที่ตั้งไว้ด้วยค่าว่าง
   */
  it('ขาอ่านต้องคืน assign_group_ids ไม่ใช่แค่ assign_group', () => {
    const body = src('src/modules/content/broadcast-payload.util.ts');
    expect(body).toMatch(
      /assign_group_ids: Array\.isArray\(raw\['assign_group_ids'\]\)/,
    );
  });

  /**
   * บั๊ก 1: ฟิลด์ใหม่ต้องประกาศใน DTO ไม่งั้น `ValidationPipe` ปฏิเสธทั้ง request
   * ด้วยคำว่า "validation failed" ที่ไม่บอกว่าฟิลด์ไหน
   */
  it('DTO ประกาศ at_time_min และ assign_group_ids ครบ', () => {
    const body = src('src/modules/content/dto/broadcast.dto.ts');
    expect(body).toContain('at_time_min?: number;');
    expect(body).toContain('assign_group_ids?: unknown;');
  });
});
