/**
 * [UI-20260828-SCROLLHINT] ลูกศรบอกว่ายังเลื่อนต่อได้
 * ===========================================================================
 * เจ้าของ 28/08: *"tab ไหนก็ตามใน modal ของ broadcast edit/create ถ้ามัน scroll ได้
 * ต้องมี guide arrow เด้งบอกว่าเลื่อนลง + ขึ้นด้วย ถ้ามีพื้นที่ให้ไปทางนั้น"*
 *
 * 🔴 ปัญหาจริง: ฟอร์มนี้ยาวกว่าจอเกือบทุกขั้น แต่ scrollbar ของ macOS ซ่อนตัวเอง
 *    เมื่อไม่ได้เลื่อน ⇒ ไม่มีอะไรบอกเลยว่ายังมีของอยู่ข้างล่าง · เคสที่เจ็บที่สุดคือ
 *    ปุ่มที่ต้องกดอยู่ต่ำกว่าขอบจอพอดี แล้วผู้ใช้สรุปว่า "ไม่มีให้เลือก"
 *
 * 🔴 โชว์เฉพาะทางที่ไปได้จริง — ไม่ใช่โชว์ทั้งสองอันตลอด
 *    ลูกศรขึ้นตอนอยู่บนสุด หรือลูกศรลงตอนอยู่ล่างสุด คือสัญญาณที่โกหก
 *    พอโกหกครั้งเดียว ครั้งต่อไปผู้ใช้ก็จะไม่เชื่อมันอีกเลย
 *
 * ⚠️ ฟังทั้ง `scroll` และ `resize` **และ** ขนาดเนื้อหาที่เปลี่ยน (`ResizeObserver`) —
 *    ฟอร์มนี้กาง/พับการ์ดและสลับขั้นได้ ความสูงของเนื้อหาจึงเปลี่ยนโดยที่ไม่มีใคร
 *    เลื่อนอะไรเลย · ฟังแค่ `scroll` = ลูกศรค้างผิดสถานะหลังสลับขั้น
 * ⚠️ `ResizeObserver` ไม่มีใน jsdom ⇒ ต้องเช็คก่อนใช้ ไม่งั้นเทสทุกตัวที่ render
 *    ฟอร์มนี้จะพังพร้อมกัน
 * ⚠️ `pointer-events-none` บนตัวลูกศร — มันลอยทับเนื้อหา ถ้ากินคลิกจะบังปุ่มที่อยู่ใต้มัน
 *
 * ⚠️ ไม่ใช่ปุ่มกด และไม่มี `onClick` โดยตั้งใจ — มันเป็น "ป้ายบอกทาง" ไม่ใช่ตัวควบคุม
 *    ผู้ใช้เลื่อนด้วยล้อ/นิ้วอยู่แล้ว การทำให้กดได้จะเพิ่มเป้ากดที่ลอยทับเนื้อหา
 *
 * 📍 MOVED 29/08/2026 from `components/campaign/form/` to `components/common/`.
 *    It has two users now, so it is a shared primitive rather than a campaign file.
 *    Not a single line of the body changed in the move.
 *
 * Current users:
 *   `components/campaign/BroadcastFormModal.tsx`  — the broadcast form
 *   `components/modals/ConfirmModal.tsx`          — the confirm dialog (worst case:
 *                                                   close-case with several topics)
 *
 * revert: delete this file and the `<ScrollHint>` at both call sites above.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { useI18n } from '../../i18n';

/** เผื่อไว้กันเศษ 1px ตอนคำนวณความสูง — ไม่งั้นลูกศรจะกะพริบตอนเลื่อนจนสุด */
const EDGE_PX = 4;

export const ScrollHint: React.FC<{
  /** element ที่เลื่อนได้จริง — ส่ง ref ของตัวที่มี `overflow-y-auto` */
  targetRef: React.RefObject<HTMLElement | null>;
}> = ({ targetRef }) => {
  const { t } = useI18n();
  const [up, setUp] = useState(false);
  const [down, setDown] = useState(false);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    /* เนื้อหาสั้นกว่ากรอบ ⇒ ไม่มีทางไปไหน ⇒ ไม่ต้องมีลูกศรสักอัน */
    if (max <= EDGE_PX) {
      setUp(false);
      setDown(false);
      return;
    }
    setUp(el.scrollTop > EDGE_PX);
    setDown(el.scrollTop < max - EDGE_PX);
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    /* รวบหลายเหตุการณ์ที่มาติด ๆ กันให้วัดครั้งเดียวต่อเฟรม — `scroll` ยิงถี่มาก */
    const schedule = () => {
      if (typeof window.requestAnimationFrame !== 'function') {
        measure();
        return;
      }
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    };

    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    /* ⚠️ jsdom ไม่มี ResizeObserver — ขาดตัวนี้ไปลูกศรจะค้างผิดสถานะหลังสลับขั้น
       แต่ห้ามทำให้ throw ในเทส */
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(schedule);
      ro.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro?.disconnect();
      if (frame.current !== null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frame.current);
      }
    };
  }, [measure, targetRef]);

  /* ชั้นนอก: ตำแหน่งอย่างเดียว — ถือ `-translate-x-1/2` ไว้จัดกึ่งกลาง
     🔴 ห้ามใส่ animation ที่นี่ · `gauge-nudge` ขยับ `transform` ซึ่งจะทับ
        `-translate-x-1/2` ทิ้ง แล้วป้ายจะกระเด็นไปติดขอบซ้าย */
  const shell = 'pointer-events-none absolute left-1/2 -translate-x-1/2 z-10';
  /* ชั้นใน: หน้าตา + การเด้ง
     [UI-20260828-SCROLLHINT] ขยายจากเดิมราว 20% ตามที่เจ้าของขอ —
     `text-[11px]` → `text-[13px]` · ไอคอน 13 → 16 · ระยะขอบขยับตาม
     ไม่ได้ขยายด้วย `scale` เพราะนั่นจะทำให้ตัวหนังสือเบลอบนจอความละเอียดปกติ */
  const chip =
    'scroll-hint-nudge flex items-center gap-1.5 ' +
    'rounded-full border border-slate-300 bg-white/90 px-3 py-1.5 text-[13px] font-medium ' +
    'text-slate-600 shadow-sm backdrop-blur ' +
    'dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-300';

  return (
    <>
      {up && (
        <span className={`${shell} top-2`} data-testid="scroll-hint-up">
          <span className={chip}>
            <ChevronUp size={16} aria-hidden />
            {t('common.scroll_up_more')}
          </span>
        </span>
      )}
      {down && (
        <span className={`${shell} bottom-2`} data-testid="scroll-hint-down">
          <span className={chip}>
            <ChevronDown size={16} aria-hidden />
            {t('common.scroll_down_more')}
          </span>
        </span>
      )}
    </>
  );
};

export default ScrollHint;
