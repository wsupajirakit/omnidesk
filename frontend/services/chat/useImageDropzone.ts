/**
 * ==== [FEAT-20260818-DROPIMAGE] ลากรูปมาวางที่กล่องพิมพ์ =======================
 *
 * ข้อกำหนด 18/08: ช่องตอบในหน้า ticket-support ต้องวางรูปด้วยการลากมาวางได้
 * (เดิมมีแค่ปุ่มเลือกไฟล์กับ Ctrl+V)
 *
 * ## ทำอะไร
 * คืน handler ชุด drag/drop ไปแปะที่กล่องพิมพ์ + ธง `isDragging` ให้เอาไปโชว์กรอบ
 * ตอนลากอยู่เหนือกล่อง · ตัวไฟล์ที่ได้จะถูกส่งต่อเข้า `onFiles` ซึ่งฝั่งเรียกชี้ไปที่
 * `stageImages` ตัวเดียวกับปุ่มเลือกไฟล์และ Ctrl+V ⇒ เพดาน 5 รูป/การกรอง image/*
 * /การ revoke object URL เป็นชุดเดียวกันหมด ไม่มีทางเข้าไหนหลุดกฎ
 *
 * ## ทำไมเป็น hook แยกไฟล์ ไม่เขียนใน TicketChat
 * `pages/chat/TicketChat.tsx` ยาว 4,400+ บรรทัด และอยู่ในรายการ waiver ของ
 * `max-lines` ซึ่งกฎคือ **ลดได้เท่านั้น** (check-list §FE anti-bloat) · ตัวนับ depth
 * ของ dragenter/dragleave เป็นตรรกะที่ต้องเทสได้โดยไม่ต้อง render หน้าแชททั้งหน้า
 * จึงอยู่ในไฟล์ของตัวเองข้าง ๆ `useTicketWS.ts` (hook ของแชทอยู่โฟลเดอร์นี้อยู่แล้ว)
 *
 * ## ตัวนับ depth — จุดที่พลาดกันบ่อย
 * `dragleave` ยิงทุกครั้งที่เมาส์ข้ามขอบ **ลูก** ในกล่อง (toolbar, textarea, ปุ่มส่ง)
 * ถ้าใช้ boolean เดียวกรอบจะกระพริบตลอดเวลาที่ลากผ่าน ⇒ นับ enter/leave เป็นชั้น
 * แล้วดับกรอบเมื่อกลับมาที่ 0 เท่านั้น · `drop` และ `dragend` รีเซ็ตเป็น 0 ทันที
 * เพราะไม่มี leave ตามมาให้หักลบ
 *
 * ## ที่ตั้งใจไม่ทำ
 * - ไม่รับไฟล์ที่ไม่ใช่รูป (PDF/โฟลเดอร์/ลิงก์/ข้อความ) — helper กรองให้แล้ว และเมื่อ
 *   ไม่มีรูปเลยจะ **ไม่** preventDefault ⇒ เบราว์เซอร์ทำงานตามปกติ ไม่กลืน gesture
 * - ไม่ทำ drop ทั้งหน้าจอ · รับเฉพาะกล่องพิมพ์ ตามขอบเขตที่กำหนดไว้
 * - ไม่ทำ upload ที่นี่ — วางแล้วขึ้นถาดพรีวิวเหมือนเดิม แล้วกดส่งเอง (แคปชั่นได้)
 *
 * revert: ลบไฟล์นี้ + บล็อก dropzone ใน TicketChat.tsx (tag เดียวกัน)
 */
import { useCallback, useRef, useState } from 'react';

import { dragHasFiles, imageFilesFromDrop } from '../../utils/imageTransfer';

export interface ImageDropzone {
  /** ลากไฟล์อยู่เหนือกล่องตอนนี้ (เอาไปโชว์กรอบ/ข้อความ) */
  isDragging: boolean;
  /** แปะทั้งก้อนที่ element ที่ต้องการให้รับการวาง */
  dropHandlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

export const useImageDropzone = (
  /** จำนวนช่องว่างที่ยังรับได้ (0 = เต็ม ⇒ ไม่รับ ไม่โชว์กรอบ) */
  freeSlots: number,
  /** ปิดรับชั่วคราว เช่นโหมดโน๊ต / ยังไม่ได้กดรับเคส / กำลังส่ง */
  enabled: boolean,
  /** ไฟล์รูปที่ได้ — ชี้ไปที่ seam เดียวกับปุ่มเลือกไฟล์ */
  onFiles: (files: File[]) => void,
): ImageDropzone => {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);
  const canAccept = enabled && freeSlots > 0;

  const reset = useCallback(() => {
    depth.current = 0;
    setIsDragging(false);
  }, []);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!canAccept || !dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      depth.current += 1;
      setIsDragging(true);
    },
    [canAccept],
  );

  /**
   * dragover ต้อง preventDefault ทุกเฟรม ไม่งั้นเบราว์เซอร์จะไม่ยอมให้ drop เกิดขึ้น
   * (ค่า default ของ dragover = ปฏิเสธการวาง) · ตั้ง dropEffect เป็น copy ให้เคอร์เซอร์
   * บอกผู้ใช้ว่าวางได้จริง
   */
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!canAccept || !dragHasFiles(e.dataTransfer?.types)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (!isDragging) setIsDragging(true);
    },
    [canAccept, isDragging],
  );

  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!canAccept) return;
      e.preventDefault();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setIsDragging(false);
    },
    [canAccept],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      if (!canAccept) return;
      const files = imageFilesFromDrop(e, freeSlots);
      // ไม่มีรูป = ไม่กลืน gesture ปล่อยให้เบราว์เซอร์จัดการตามปกติ
      if (files.length === 0) {
        reset();
        return;
      }
      e.preventDefault();
      reset();
      onFiles(files);
    },
    [canAccept, freeSlots, onFiles, reset],
  );

  return { isDragging, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
};

export default useImageDropzone;
