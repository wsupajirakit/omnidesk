import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * [FEAT-20260831-FLEXCAROUSEL] เปิดการ์ดเฉพาะใบที่ใกล้จะถูกมองเห็น
 * ===========================================================================
 * 🔴 ทำไมต้องมี — คอขวดที่วัดได้จริง ไม่ใช่การเผื่อไว้
 *   `FlexBubble` เรียก `renderFlex()` แล้วตามด้วย `DOMPurify.sanitize()`
 *   (`components/chat/FlexBubble.tsx:153-161`) ต่อการ์ด **หนึ่งใบ**
 *   ⇒ ถ้า mount ทุกใบพร้อมกัน หน้าเพจจะ sanitize N รอบใน commit เดียว
 *     ตอน per-page = 10 ยังพอไหว แต่ผู้ใช้เลือก 100 ได้ ⇒ ค้างเห็น ๆ
 *
 * 🔴 ทำไมไม่ใช้ `content-visibility: auto` แทน (ทางที่พิจารณาแล้วไม่เลือก)
 *   มันข้ามแค่ **paint/layout** ของ DOM ที่ mount แล้ว — React ยัง mount และ
 *   DOMPurify ยังทำงานครบทุกใบ ⇒ **ไม่ได้แก้คอขวดที่แท้จริงเลย**
 *
 * 🔴🔴 บั๊กที่เกิดจริงรอบแรก — อ่านก่อนแก้ไฟล์นี้ (เจ้าของเจอบนจอ 31/08)
 *   เดิมสร้าง observer ใน `useEffect` แล้วให้ ref callback เรียก
 *   `observerRef.current?.observe(el)` — **ไม่มีใบไหนโผล่เลย ทั้งหน้าเป็นกล่องเทา**
 *   เพราะ **React ผูก ref ตอน commit ซึ่งเกิดก่อน effect เสมอ** ⇒ ตอน ref ทำงาน
 *   `observerRef.current` ยังเป็น `null` ⇒ `?.` กลืนเงียบ ⇒ ไม่มีการเฝ้าสักใบ
 *   ⇒ ตอนนี้สร้าง observer **แบบ lazy ในตัว ref callback เอง** (`getObserver()`)
 *     effect เหลือหน้าที่เดียวคือ disconnect ตอน unmount
 *   ⚠️ อย่าย้ายการสร้างกลับไปไว้ใน effect เด็ดขาด
 *
 * 🔑 observer ตัวเดียวสำหรับทุกไทล์ ไม่ใช่ตัวต่อไทล์
 * 🔑 เปิดแล้วเปิดเลย — ไม่ปิดคืนเมื่อเลื่อนพ้นจอ (กัน sanitize ซ้ำไปมา)
 * 🔑 ref callback ถูก cache ต่อ id ⇒ identity คงที่ข้าม render
 *   ไม่งั้น React จะถอด/ผูก ref ใหม่ทุกรอบ แล้ว observe ซ้ำไม่รู้จบ
 * 🔑 `setRevealed` คืนตัวเดิมเมื่อไม่มีอะไรใหม่ ⇒ ไม่เกิด re-render loop
 *   (สร้าง Set ใหม่ทุกครั้ง = state เปลี่ยนทุกครั้ง = วนไม่จบ)
 *
 * ⚠️ ไม่มี IntersectionObserver (jsdom ในเทส, เบราว์เซอร์เก่า) ⇒ **เปิดทุกใบทันที**
 *    "ช้าแต่เห็นครบ" ปลอดภัยกว่า "เร็วแต่จอว่าง" เสมอ
 *    ⚠️ เพราะ jsdom เดินทางนี้ เทสที่ไม่ mock IO จึง **จับบั๊กข้างบนไม่ได้**
 *       ⇒ `flexCarousel.dom.test.tsx` มีเคสที่ mock IO ไว้โดยเฉพาะ ห้ามลบ
 *
 * revert: ลบไฟล์นี้ แล้วให้ `FlexCardCarousel` วาด `FlexBubble` ตรง ๆ ทุกใบ
 */

export interface LazyRevealState {
  /** ผูกกับ element ของไทล์ — `ref={registerRef(id)}` */
  registerRef: (id: string) => (el: HTMLElement | null) => void;
  /** ไทล์นี้ควร mount การ์ดจริงหรือยัง */
  isRevealed: (id: string) => boolean;
}

/** เปิดล่วงหน้าก่อนเข้าจอเท่านี้ ⇒ เลื่อนแล้วการ์ดพร้อมอยู่แล้ว ไม่เห็นกล่องเปล่า */
const PRELOAD_MARGIN = '300px';

export const useLazyReveal = (): LazyRevealState => {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  /** element → id · ใช้ตอน callback เพื่อรู้ว่า node ไหนคือใบไหน */
  const idOf = useRef(new WeakMap<Element, string>());
  /** id → ref callback · cache ไว้ให้ identity คงที่ (ดูหัวไฟล์) */
  const refCache = useRef(new Map<string, (el: HTMLElement | null) => void>());

  const reveal = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRevealed((prev) => {
      const fresh = ids.filter((i) => !prev.has(i));
      if (fresh.length === 0) return prev; // ไม่มีอะไรใหม่ ⇒ ไม่เปลี่ยน state
      const next = new Set(prev);
      fresh.forEach((i) => next.add(i));
      return next;
    });
  }, []);

  /* สร้างตอนถูกใช้ครั้งแรก ไม่ใช่ใน effect — เหตุผลอยู่ในหัวไฟล์ (บั๊กจริง) */
  const getObserver = useCallback((): IntersectionObserver | null => {
    if (observerRef.current) return observerRef.current;
    if (typeof IntersectionObserver === 'undefined') return null;
    const io = new IntersectionObserver(
      (entries) => {
        const hit: string[] = [];
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const id = idOf.current.get(e.target);
          if (id) {
            hit.push(id);
            io.unobserve(e.target); // เปิดแล้วเลิกเฝ้า
          }
        }
        reveal(hit); // setState ครั้งเดียวต่อ batch
      },
      { rootMargin: PRELOAD_MARGIN },
    );
    observerRef.current = io;
    return io;
  }, [reveal]);

  /* effect เหลือหน้าที่เดียว: เก็บกวาดตอน unmount */
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  const registerRef = useCallback(
    (id: string) => {
      const cached = refCache.current.get(id);
      if (cached) return cached;
      const fn = (el: HTMLElement | null) => {
        if (!el) return;
        const io = getObserver();
        if (!io) {
          reveal([id]); // ไม่มี IO ⇒ เปิดทันที
          return;
        }
        idOf.current.set(el, id);
        io.observe(el);
      };
      refCache.current.set(id, fn);
      return fn;
    },
    [getObserver, reveal],
  );

  const isRevealed = useCallback((id: string) => revealed.has(id), [revealed]);

  return { registerRef, isRevealed };
};
