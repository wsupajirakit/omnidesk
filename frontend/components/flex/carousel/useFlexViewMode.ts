import { useCallback, useEffect, useState } from 'react';

/**
 * [FEAT-20260831-FLEXCAROUSEL] ตาราง หรือ carousel — หน้านี้กำลังแสดงผลแบบไหน
 *
 * WHAT
 *   สองโหมดเท่านั้น (`table` | `carousel`) · **ค่าเริ่มต้นคือ `carousel`**
 *   และกลับเป็น `carousel` เสมอเมื่อ `resetKey` เปลี่ยน
 *
 * ⚠️ เจ้าของสั่ง 31/08: *"การแสดงผล flex ปรับเป็น default เลย (ตรงข้ามกับ datatable)"*
 *    ⇒ เปิดหน้ามาเห็นการ์ดก่อน ปุ่ม "ปรับการแสดงผล" คือทางไปตาราง
 *    ⇒ ต้นทุนตอนเปิดหน้าถูกคุมด้วย lazy reveal อยู่แล้ว (ดู `useLazyReveal.ts`)
 *      ไม่งั้นการเปลี่ยน default จะกลายเป็นคอขวดทันทีที่เปิดหน้า
 *
 * WHY THE KEY IS A PARAMETER
 *   เจ้าของสั่ง 31/08: *"แยกแท็บ normal / menu ต้อง reset ทุกครั้งเวลาสลับแท็บ"*
 *   หน้าเพจส่ง `tab` เข้ามาเป็นคีย์ ⇒ การรีเซ็ตเกิดขึ้น **ทุกทางที่ `tab` เปลี่ยน**
 *   ไม่ใช่เฉพาะตอนกดปุ่มแท็บ · เป็นแพตเทิร์นเดียวกับ `useRowPreview` ที่ฟีเจอร์
 *   พรีวิวในแถวใช้อยู่ก่อนหน้า — จงใจให้เหมือนกัน เพราะเป็นกฎข้อเดียวกัน
 *   สลับแท็บ = กลับเป็นตารางเสมอ ไม่ว่าจะสลับจากทางไหน
 *
 * WHY NOT A BOOLEAN
 *   ชื่อโหมดอ่านออกที่จุดเรียกใช้ (`mode === 'carousel'`) และถ้าวันหนึ่งมีโหมดที่สาม
 *   ก็เพิ่มได้โดยไม่ต้องไล่แก้ทุก call site ที่เคยเป็น `!isTable`
 *
 * NO SERVER
 *   ฮุกนี้ถือแค่สตริงเดียว · การ์ดทุกใบมาพร้อม `content_json` ในรายการอยู่แล้ว
 *   ⇒ สลับโหมดไม่ยิง request สักครั้ง และ **ไม่แตะ pagination**
 *   (หน้าเพจวาด pagination ไว้นอกตาราง โหมด carousel จึงยังกดเปลี่ยนหน้าได้จริง)
 *
 * revert: ลบไฟล์นี้ทั้งโฟลเดอร์ `carousel/` แล้วเอาปุ่มสลับโหมดออกจากหน้าเพจ
 */
export type FlexViewMode = 'table' | 'carousel';

export interface FlexViewModeState {
  mode: FlexViewMode;
  isCarousel: boolean;
  /** สลับไปอีกโหมดหนึ่ง — ปุ่มเดียวคุมทั้งไปและกลับ ตามที่เจ้าของสั่ง */
  toggle: () => void;
  /** กลับเป็นค่าเริ่มต้น = carousel (ใช้เองได้ถ้ามีทางอื่นที่ต้องรีเซ็ต) */
  reset: () => void;
}

export const useFlexViewMode = (resetKey: unknown): FlexViewModeState => {
  const [mode, setMode] = useState<FlexViewMode>('carousel');

  /* กฎ reset-on-tab-switch · กลับเป็นค่าเริ่มต้น (= carousel) ไม่ใช่ค้างโหมดเดิม
     mutation: ลบ effect นี้ → เทส "สลับแท็บแล้วต้อง reset" แดงทันที */
  useEffect(() => {
    setMode('carousel');
  }, [resetKey]);

  const toggle = useCallback(
    () => setMode((m) => (m === 'table' ? 'carousel' : 'table')),
    [],
  );
  const reset = useCallback(() => setMode('carousel'), []);

  return { mode, isCarousel: mode === 'carousel', toggle, reset };
};
