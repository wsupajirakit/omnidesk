import React, { useCallback, useEffect, useRef } from 'react';
// [FEAT-20260831-MENUMAINTAG] the same [[[ ]]] spelling the table uses
import { flexMarker, isFlexMarkerValue } from '../../../utils/flexMarker';
// [FEAT-20260831-CAROUSELBAR] the strip's own scroll bar, above and below
import { CarouselScrollBar } from './CarouselScrollBar';
import { ChevronLeft, ChevronRight, Edit2, Copy } from 'lucide-react';

import { FlexBubble, canRenderFlex } from '../../chat/FlexBubble';
import { useI18n } from '../../../i18n';
import { useLazyReveal } from './useLazyReveal';
/* [FEAT-20260907-CLONETEMPLATEBTN] the FILE, never `../index` — the flex barrel
   re-exports this carousel, so going through it would be a cycle. */
import { FlexCloneTemplateButton } from '../FlexCloneTemplateButton';

/**
 * [FEAT-20260831-FLEXCAROUSEL] การ์ดทุกใบในหน้านี้ เรียงเป็นแถวเดียว เลื่อนได้ กดแก้ไขได้
 * ===========================================================================
 * เจ้าของสั่ง 31/08: *"แสดงการ์ดทุกใบเป็น carousel พร้อมชื่อ … ไม่ต้องซ้อนนะ
 * เรียงแถวเดียวกัน แล้วเลื่อนได้ คลิกแก้ไขได้มีชื่อบอก"*
 *
 * 🔑 **ไม่ซ้อนกัน** — เรียงเป็นแถวเดียวด้วย flex + `overflow-x-auto`
 *    ไม่ใช้ absolute/transform ซ้อนการ์ดแบบ carousel 3 มิติ ตามที่สั่งตรง ๆ
 *    ⇒ ไม่ต้องคำนวณตำแหน่ง ไม่ต้องวัดขนาด และ **เลื่อนด้วยนิ้ว/เทรackpad ได้เอง**
 *      บนมือถือโดยไม่ต้องเขียน gesture เพิ่มสักบรรทัด
 *
 * 🔑 **ใช้ `FlexBubble` ตัวเดิม ห้ามเขียน renderer ใหม่**
 *    FlexBubble เป็นตัว render การ์ดตัวเดียวของทั้งระบบ และเป็นตัวที่ถือ DOMPurify
 *    ⇒ เขียนใหม่ = แตก sanitiser ซึ่งเป็นด่านเดียวระหว่าง JSON ที่แอดมินแก้ได้
 *      กับ stored XSS · กติกาเดียวกับที่ `FlexRowPreview` เขียนไว้
 *
 * 🔑 **`zoom` ไม่ใช่ `transform: scale()`**
 *    FlexBubble ไม่ได้กำหนดความกว้างเอง (300px มาจาก stylesheet ของ flex-render)
 *    `transform` ไม่กระทบ layout ⇒ ช่องจะสูงเท่าการ์ดเต็มตัวแล้วมีรูโหว่
 *    `zoom` reflow ให้เอง ⇒ ไทล์หดตามจริงโดยไม่ต้องวัด node
 *    (เหตุผลเดียวกับ `FlexRowPreview` ที่ใช้ `zoom` อยู่แล้ว)
 *
 * ⚠️ ไม่ยิง request ใด ๆ — `content_json` มากับรายการอยู่แล้ว ⇒ สลับโหมดฟรี
 *    และ **หน้าเพจยังคุม pagination เหมือนเดิม** ตัวนี้แค่วาดของที่ได้รับมา
 *
 * revert: ลบโฟลเดอร์ `carousel/` แล้วเอา `isCarousel` ออกจากหน้าเพจ
 */

/** ย่อการ์ดลงเท่านี้ในไทล์ — เจ้าของสั่ง 70% (31/08) · export ให้เทสตรึงตัวเลขได้ */
export const CAROUSEL_ZOOM = 0.7;

/** ระยะที่ปุ่มลูกศรเลื่อนต่อหนึ่งคลิก (px) — กว้างกว่าหนึ่งไทล์เล็กน้อย */
const SCROLL_STEP = 240;

export interface FlexCarouselItem {
  id: string;
  name: string;
  /** flex tag / menu slug — โชว์เต็ม ๆ พร้อมปุ่มคัดลอก เหมือนในตาราง */
  tag?: string;
  content_json: unknown;
}

interface FlexCardCarouselProps {
  items: FlexCarouselItem[];
  /** กดที่ตัวการ์ด = แก้ไขใบนั้น */
  onEdit: (id: string) => void;
  /** ปุ่มคัดลอกแท็ก — ตัวเดียวกับที่ตารางใช้ (ห่อ [[[...]]] + toast ให้เอง) */
  onCopyTag: (tag: string) => void;
  /**
   * [FEAT-20260907-CLONETEMPLATEBTN] "copy แม่แบบ" — hand back the card id and the
   * PAGE opens its clone form, the same one the table's button opens. The
   * carousel neither knows nor decides what cloning means.
   *
   * ⚠️ Optional so the four existing renders in `test/flexCarousel.dom.test.tsx`
   *    keep compiling, and so a tile with no tag and no clone handler still draws
   *    nothing extra. The cost is that forgetting to wire it is silent, which is
   *    why `test/flexCloneTemplate.dom.test.tsx` asserts the page passes it.
   */
  onCloneCard?: (id: string) => void;
  /** ข้อความตอนไม่มีการ์ดเลย — หน้าเพจเป็นคนตัดสินคำ */
  emptyText: string;
  /** ยังมีให้โหลดอีกไหม — ถ้าไม่มี จะไม่เฝ้าปลายแถวเลย */
  hasMore?: boolean;
  /** เลื่อนจนสุดแล้ว ⇒ โหลดเพิ่มเอง (ไม่มีปุ่ม — เจ้าของสั่ง 31/08)
   *  ⚠️ ต้องเป็น callback ที่ identity คงที่ (useCallback ฝั่งหน้าเพจ)
   *     ไม่งั้น effect จะ subscribe ใหม่ทุก render */
  onReachEnd?: () => void;
}

export const FlexCardCarousel: React.FC<FlexCardCarouselProps> = ({
  items,
  onEdit,
  onCopyTag,
  onCloneCard,
  emptyText,
  hasMore = false,
  onReachEnd,
}) => {
  const { t } = useI18n();
  const stripRef = useRef<HTMLDivElement | null>(null);
  /** ตัวเฝ้าปลายแถว — เลื่อนมาถึงเมื่อไหร่ = โหลดเพิ่ม */
  const endRef = useRef<HTMLDivElement | null>(null);
  /* [FEAT-20260831-FLEXCAROUSEL] กันคอขวด: mount การ์ดจริงเฉพาะใบที่ใกล้เข้าจอ
     เหตุผลเต็ม + ทางที่ไม่เลือก อยู่ในหัว `useLazyReveal.ts` */
  const lazy = useLazyReveal();

  const scrollBy = useCallback((dx: number) => {
    stripRef.current?.scrollBy({ left: dx, behavior: 'smooth' });
  }, []);

  /* [FEAT-20260831-FLEXINFINITE] เลื่อนถึงปลายแถว = โหลดเพิ่มเอง ไม่มีปุ่ม
     ─────────────────────────────────────────────────────────────────────
     เจ้าของสั่ง 31/08: *"load more auto เวลา scroll สุด ไม่ใช่ปุ่ม ไม่เอาปุ่ม"*
     ⚠️ observer ตัวนี้แยกจาก `useLazyReveal` เพราะกติกาต่างกันคนละขั้ว:
        ตัวนั้น "เห็นแล้วเลิกเฝ้า" (เปิดครั้งเดียวพอ)
        ตัวนี้ต้อง **เฝ้าต่อ** เพราะพอโหลดเพิ่ม ปลายแถวจะขยับไปแล้วต้องยิงได้อีก
     ⚠️ `root` คือตัวแถบที่เลื่อน ไม่ใช่ viewport — แถวนี้เลื่อนแนวนอนในกล่องตัวเอง
        ถ้าใช้ viewport จะไม่มีวันตรวจเจอ
     ⚠️ ผูกเฉพาะตอน `hasMore` ⇒ โหลดครบแล้วไม่มี observer ค้างไว้เปล่า ๆ */
  useEffect(() => {
    if (!onReachEnd || !hasMore) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const el = endRef.current;
    const root = stripRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onReachEnd();
      },
      { root, rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onReachEnd, hasMore, items.length]);

  if (items.length === 0) {
    return (
      <div
        data-testid="flex-carousel-empty"
        className="px-6 py-16 text-center text-sm text-slate-500"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div data-testid="flex-carousel" className="relative px-6 py-6">
      {/* ปุ่มเลื่อน — ลอยทับขอบซ้าย/ขวาแบบภาพที่เจ้าของส่งมา
          `hidden sm:flex` เพราะบนมือถือปัดนิ้วสะดวกกว่าปุ่มอยู่แล้ว */}
      <button
        type="button"
        aria-label={t('flex.carousel_prev')}
        onClick={() => scrollBy(-SCROLL_STEP)}
        className="absolute left-1 top-1/2 z-10 hidden -translate-y-1/2 sm:flex h-9 w-9 items-center justify-center rounded-full border border-dark-700 bg-dark-800/90 text-slate-600 shadow-lg backdrop-blur transition-colors hover:text-slate-900"
      >
        <ChevronLeft size={18} />
      </button>
      <button
        type="button"
        aria-label={t('flex.carousel_next')}
        onClick={() => scrollBy(SCROLL_STEP)}
        className="absolute right-1 top-1/2 z-10 hidden -translate-y-1/2 sm:flex h-9 w-9 items-center justify-center rounded-full border border-dark-700 bg-dark-800/90 text-slate-600 shadow-lg backdrop-blur transition-colors hover:text-slate-900"
      >
        <ChevronRight size={18} />
      </button>

      {/* [FEAT-20260831-CAROUSELBAR] the bar sits above AND below (owner, 31/08).
          The browser's own overlay scrollbar fades out when the pointer stops, so on
          a row of 260px tiles nothing said "this scrolls" and there was nothing to
          grab. Same control twice, reading the same strip. */}
      <div className="sm:px-8">
        <CarouselScrollBar stripRef={stripRef} place="top" />
      </div>

      {/* แถวเดียว เลื่อนแนวนอน · `snap` ทำให้หยุดตรงไทล์พอดีเวลาเลื่อนเร็ว ๆ */}
      <div
        ref={stripRef}
        data-testid="flex-carousel-strip"
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth custom-scrollbar pb-2 sm:px-8"
      >
        {items.map((item) => (
          /* ⚠️ ไทล์เป็น <div> ไม่ใช่ <button> — เพราะข้างในมีปุ่ม copy อีกตัว
             และ button ซ้อน button เป็น HTML ที่ไม่ถูกต้อง (React เตือน + a11y พัง)
             ⇒ ตัวการ์ดเป็นปุ่ม "แก้ไข" และปุ่ม copy เป็นปุ่มพี่น้องกัน */
          <div
            key={item.id}
            ref={lazy.registerRef(item.id)}
            data-testid="flex-carousel-card"
            /* [FEAT-20260831-CAROUSELBAR] modernised, not redesigned: a soft ring
               instead of a hard border, a rounder corner and a lift that reads as
               depth. Layout, sizes and every data element are untouched. */
            className="group relative flex w-[260px] shrink-0 snap-start flex-col overflow-hidden rounded-3xl bg-dark-800 ring-1 ring-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_8px_24px_-12px_rgba(15,23,42,0.25)] transition-all duration-200 hover:-translate-y-1.5 hover:ring-primary-300 hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_36px_-14px_rgba(15,23,42,0.35)]"
          >
            <button
              type="button"
              onClick={() => onEdit(item.id)}
              title={t('common.edit')}
              className="block w-full text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-400"
            >
            {/* ตัวการ์ดจริง — สูงคงที่ทุกไทล์ เพื่อให้ชื่อด้านล่างอยู่ระดับเดียวกันหมด
                (ไม่งั้นการ์ดคนละความสูงจะทำให้แถวดูรุงรัง) */}
            {/* [FEAT-20260831-FLEXCAROUSEL] สูงพอสำหรับการ์ดทั่วไปที่ 70%
                ⚠️ `overflow-y-auto` ไม่ใช่ `overflow-hidden` — การ์ดที่ยาวกว่านี้
                   ต้อง **เลื่อนดูได้ ไม่ใช่ถูกตัดทิ้ง** (เจ้าของแจ้ง 31/08: "อย่าตกขอบ")
                   ความสูงคงที่ยังจำเป็น เพื่อให้ชื่อ+แท็กของทุกไทล์อยู่ระดับเดียวกัน */}
            <div className="flex h-[420px] w-full items-start justify-center overflow-y-auto overflow-x-hidden bg-dark-900/60 p-2 custom-scrollbar">
              {!lazy.isRevealed(item.id) ? (
                /* กล่องเปล่าความสูงเท่ากันเป๊ะ ⇒ ไม่มี layout shift ตอนการ์ดโผล่ */
                <div
                  data-testid="flex-carousel-placeholder"
                  className="h-full w-full animate-pulse rounded-lg bg-dark-700/40"
                />
              ) : canRenderFlex(item.content_json) ? (
                <div style={{ zoom: CAROUSEL_ZOOM }}>
                  <FlexBubble json={item.content_json} />
                </div>
              ) : (
                <span className="self-center px-3 text-center text-xs text-amber-600">
                  {t('flex.row_preview_unsupported')}
                </span>
              )}
            </div>

            </button>

            {/* ชื่อ + แท็กเต็ม ๆ พร้อมปุ่มคัดลอก — รูปแบบเดียวกับคอลัมน์ FLEX TAG ในตาราง
                (เจ้าของสั่ง 31/08: "แสดง tag เต็มๆพร้อมปุ่ม copy เหมือน datatable") */}
            <div className="border-t border-dark-700 bg-dark-800 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => onEdit(item.id)}
                  title={t('common.edit')}
                  className="min-w-0 flex-1 text-left focus:outline-none"
                >
                  <span className="block truncate text-sm font-bold text-slate-900" title={item.name}>
                    {item.name}
                  </span>
                </button>
                {/* [FIX-20260831-CAROUSELPENCIL] the pencil is a BUTTON, not a glyph.
                    เจ้าของแจ้ง 31/08: "กดรูปดินสอแล้วไม่เปิดฟอร์มแก้" — it used to be a
                    bare <Edit2> sitting NEXT to the name button, so the one thing on the
                    row that says "edit" was the one place a click did nothing. Aiming at
                    the name still worked, which is why this read as "sometimes it opens".
                    ⚠️ A SIBLING button, never nested inside the name button: this tile is
                       a <div> precisely because it holds several buttons (see the note at
                       the top of the tile) and a button inside a button is invalid HTML.
                    ⚠️ Visual is unchanged — the wrapper carries the icon's own spacing
                       classes and adds no padding, border or background of its own.
                    revert: put the bare <Edit2 … /> back and the icon stops responding. */}
                <button
                  type="button"
                  data-testid="flex-carousel-edit"
                  onClick={() => onEdit(item.id)}
                  title={t('common.edit')}
                  aria-label={t('common.edit')}
                  className="mt-0.5 shrink-0 leading-none text-slate-400 transition-colors hover:text-primary-500 group-hover:text-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-400 rounded"
                >
                  <Edit2 size={14} />
                </button>
              </div>
              {/* [UI-20260907-CAROUSELFOOTER] the footer is two clusters, not one row.
                  Owner, 07/09: the tag's Copy button belongs NEXT TO THE TAG, and the
                  new "copy แม่แบบ" button belongs at the far right.
                  ⚠️ The tag lost `flex-1`. That class made the tag eat the whole row and
                     pushed Copy to the right edge — which is exactly the layout being
                     undone here. It keeps `min-w-0` + `overflow-x-auto` so a long tag
                     still scrolls inside its own box instead of shoving the buttons off
                     the tile. `shrink` lets it give room back when both buttons are up.
                  ⚠️ `ml-auto` lives HERE, on the parent's side, not inside the shared
                     button — the same button is part of a right-aligned icon cluster in
                     the table, where a margin of its own would be wrong.
                  revert: put `flex-1` back on the tag span and drop the clone button. */}
              {(item.tag || onCloneCard) && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  {item.tag && (
                    <>
                      {/* เต็ม ๆ ไม่ตัด — ถ้ายาวเกินก็เลื่อนในกล่องของตัวเอง ไม่ดัน layout */}
                      {/* [FEAT-20260831-MENUMAINTAG] a marker is shown in its bracket form,
                          exactly as the table shows it; a slug (a menu card with no minted
                          tag yet) stays raw, because raw is what a postback payload needs.
                          The carousel printed every value raw before, so one card read
                          differently in the two views. */}
                      <span className="min-w-0 shrink overflow-x-auto whitespace-nowrap font-mono text-[11px] font-bold text-slate-900 custom-scrollbar">
                        {isFlexMarkerValue(item.tag) ? flexMarker(item.tag) : item.tag}
                      </span>
                      <button
                        type="button"
                        onClick={() => onCopyTag(item.tag as string)}
                        title={t('flex.copy_tag')}
                        className="shrink-0 rounded border border-slate-200 bg-white p-1.5 text-[10px] font-bold text-primary-600 shadow-sm transition-all hover:bg-primary-50 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Copy size={12} /> Copy
                      </button>
                    </>
                  )}
                  {onCloneCard && (
                    <FlexCloneTemplateButton
                      size="sm"
                      className="ml-auto"
                      onClick={() => onCloneCard(item.id)}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {/* [FEAT-20260831-FLEXINFINITE] ตัวเฝ้าปลายแถว — ไม่มีหน้าตา ไม่กินที่
            (w-px) แค่ให้ observer มีอะไรให้จับ · เลื่อนมาถึง = โหลดเพิ่มเอง */}
        {hasMore && (
          <div ref={endRef} data-testid="flex-carousel-end" className="w-px shrink-0" />
        )}
      </div>

      <div className="sm:px-8">
        <CarouselScrollBar stripRef={stripRef} place="bottom" />
      </div>
    </div>
  );
};
