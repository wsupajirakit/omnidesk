/**
 * [FEAT-20260831-FLEXCAROUSEL] มุมมอง carousel ของหน้า Flex Message
 * ===========================================================================
 * เจ้าของสั่ง 31/08:
 *   · ปุ่มลูกตาไม่ต้องอยู่ในแถว — ย้ายมาเป็นปุ่ม "ปรับการแสดงผล" ข้างปุ่มแก้สิทธิหลายใบ
 *     และต้องอยู่ **ก่อน** ปุ่มนั้น
 *   · กดแล้วแสดงการ์ดทุกใบเป็น carousel พร้อมชื่อ — เรียงแถวเดียว **ไม่ซ้อนกัน** เลื่อนได้
 *   · คลิกการ์ดแล้วแก้ไขได้ · กดปุ่มเดิมซ้ำกลับเป็นตาราง
 *   · สลับแท็บ normal/menu ต้อง reset กลับเป็นตารางทุกครั้ง
 *   · pagination ต้องอยู่และกดได้จริง
 *   · ห้ามคอขวด ⇒ การ์ดโหลดแบบ lazy
 *
 * 🔴 ไฟล์นี้รับช่วง PIN จาก `flexRowPreview.dom.test.tsx` ที่ถูกลบไปพร้อมฟีเจอร์
 *    พรีวิวในแถว (ปุ่มลูกตารายแถวถูกถอดตามคำสั่ง ⇒ โมดูลนั้นกลายเป็น dead code)
 *    ข้อที่ยังมีค่าถูกย้ายมาที่นี่ทั้งหมด ไม่ได้หายไปเฉย ๆ:
 *      PIN "ไม่คุยกับเซิร์ฟเวอร์" · PIN "reuse FlexBubble ห้ามเขียน renderer ใหม่"
 *      PIN "reset ตอนสลับแท็บ"
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const PAGE = strip(read('pages/content/FlexMessageList.tsx'));
const CAROUSEL = strip(read('components/flex/carousel/FlexCardCarousel.tsx'));
const VIEWMODE = strip(read('components/flex/carousel/useFlexViewMode.ts'));
const LAZY = strip(read('components/flex/carousel/useLazyReveal.ts'));

describe('[FLEXCAROUSEL] ปุ่มลูกตาออกจากแถว กลายเป็นปุ่มสลับโหมด', () => {
  it('⭐⭐ ไม่มีปุ่มลูกตารายแถวเหลืออยู่แล้ว', () => {
    /* เดิมทุกแถวมีปุ่ม Eye/EyeOff เปิดพรีวิวใต้แถว — เจ้าของสั่งให้เอาออก */
    expect(PAGE).not.toContain('rowPreview');
    expect(PAGE).not.toContain('<EyeOff');
    expect(PAGE).not.toContain('<Eye ');
  });

  /* [UI-20260907-FLEXTOOLBARSPLIT] SUPERSEDED, 07/09.
     This used to assert the opposite: ปรับการแสดงผล had to come BEFORE
     แก้สิทธิหลายใบ, because on 31/08 both buttons sat in one right-hand cluster
     and the owner wanted the toggle to lead. On 07/09 they asked for the two to
     be split to opposite ends of the toolbar, which removes the adjacency the
     old rule was about. The case is rewritten to the new arrangement rather
     than deleted, so the reversal is visible to whoever reads it next. */
  it('⭐⭐ ปุ่มแก้สิทธิหลายใบอยู่ **ซ้าย** · ปรับการแสดงผลอยู่ **ขวา** คนละฝั่งกัน', () => {
    const bulk = PAGE.indexOf("t('flex.bulk_enter')");
    const toggle = PAGE.indexOf("t('flex.view_toggle')");
    expect(bulk).toBeGreaterThan(-1);
    expect(toggle).toBeGreaterThan(-1);
    /* left slot is written first, so the bulk button comes first in source */
    expect(bulk).toBeLessThan(toggle);
    /* and the row really does push them apart */
    expect(PAGE).toContain('flex items-center justify-between gap-2 border-b');
  });

  it('🔴 โหมด carousel ต้องไม่ดันปุ่มปรับการแสดงผลไปซ้าย', () => {
    /* The bulk button renders only in table mode. If the two buttons were direct
       children of the `justify-between` row, carousel mode would leave ONE child
       and it would land on the LEFT. The always-mounted empty left slot is what
       prevents that — this pins the slot, not the class string alone. */
    const row = PAGE.slice(PAGE.indexOf('justify-between gap-2 border-b'));
    const leftSlot = row.indexOf('<div className="flex items-center gap-2">');
    const bulkGate = row.indexOf('!viewMode.isCarousel &&');
    expect(leftSlot).toBeGreaterThan(-1);
    /* the mode gate is INSIDE the slot, not around it */
    expect(leftSlot).toBeLessThan(bulkGate);
  });

  it('⭐ ปุ่มเดียวคุมทั้งไปและกลับ (toggle ไม่ใช่สองปุ่ม)', () => {
    expect(PAGE).toContain('viewMode.toggle');
    expect(VIEWMODE).toMatch(/m === 'table' \? 'carousel' : 'table'/);
  });
});

describe('[FLEXCAROUSEL] reset ตอนสลับแท็บ (PIN ย้ายมาจาก row preview)', () => {
  it('⭐⭐⭐ หน้าเพจ key โหมดด้วย `tab` ⇒ สลับแท็บกลับเป็นตารางเสมอ', () => {
    expect(PAGE).toContain('useFlexViewMode(tab)');
  });

  it('⭐⭐ ฮุกรีเซ็ตกลับค่าเริ่มต้นเมื่อ resetKey เปลี่ยน', () => {
    /* mutation: ลบ useEffect ก้อนนี้ → ข้อนี้แดง */
    expect(VIEWMODE).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{\s*setMode\('carousel'\);\s*\},\s*\[resetKey\]\)/);
  });

  it('⭐⭐ ค่าเริ่มต้นคือ carousel (ตรงข้ามกับ datatable) — เจ้าของสั่ง 31/08', () => {
    expect(VIEWMODE).toContain("useState<FlexViewMode>('carousel')");
  });
});

describe('[FLEXCAROUSEL] การ์ดเรียงแถวเดียว ไม่ซ้อน เลื่อนได้ กดแก้ไขได้', () => {
  it('⭐⭐ เรียงแถวเดียวด้วย flex + overflow-x — ไม่ใช่การซ้อนด้วย absolute', () => {
    /* "ไม่ต้องซ้อนนะเรียงแถวเดียวกัน แล้วเลื่อนได้" */
    expect(CAROUSEL).toMatch(/flex snap-x snap-mandatory gap-4 overflow-x-auto/);
    // ไม่มีการวางทับแบบ carousel 3 มิติ
    expect(CAROUSEL).not.toMatch(/absolute[^"]*translate-x-\[/);
  });

  it('⭐⭐ ทุกไทล์มีชื่อการ์ด และกดแล้วเรียก onEdit ของใบนั้น', () => {
    expect(CAROUSEL).toContain('{item.name}');
    expect(CAROUSEL).toContain('onClick={() => onEdit(item.id)}');
  });

  it('⭐⭐ โชว์ tag เต็ม ๆ พร้อมปุ่ม Copy เหมือนในตาราง', () => {
    /* เจ้าของสั่ง: "แสดง tag เต็มๆพร้อมปุ่ม copy เหมือน datatable"
       ⚠️ ห้าม truncate ตัว tag — ถ้ายาวให้เลื่อนในกล่องตัวเอง */
    expect(CAROUSEL).toContain('onCopyTag(item.tag as string)');
    expect(CAROUSEL).toContain('<Copy size={12} /> Copy');
    /* [FEAT-20260831-MENUMAINTAG] the expression inside the span changed — the
       value is now shown in its `[[[ ]]]` marker form when it IS a marker, raw
       when it is a slug. The INTENT this case has always guarded is unchanged
       and still asserted above and below: the value is shown in full, never
       truncated, and scrolls inside its own box. */
    /* [UI-20260907-CAROUSELFOOTER] the class list changed from `min-w-0 flex-1`
       to `min-w-0 shrink`. `flex-1` made the tag eat the whole row and pushed the
       Copy button to the far edge; the owner asked on 07/09 for Copy to sit
       BESIDE the tag, with the new "copy แม่แบบ" button taking the right instead.
       What this case guards is unchanged and still asserted below: the tag is
       shown in full, never truncated, and scrolls inside its own box. */
    const tagSpan = /<span className="min-w-0 shrink ([^"]*)"[\s\S]{0,120}?item\.tag/.exec(CAROUSEL);
    expect(tagSpan).toBeTruthy();
    /* the TAG box scrolls and never truncates — the card NAME above it still does,
       which is why this reads the tag's own class list instead of the whole file. */
    expect(tagSpan![1]).toContain('overflow-x-auto');
    expect(tagSpan![1]).toContain('whitespace-nowrap');
    expect(tagSpan![1]).not.toContain('truncate');
    expect(CAROUSEL).toContain('flexMarker(item.tag)');
  });

  it('⭐⭐ 🔴 ห้ามมี button ซ้อน button ในไทล์ (HTML ผิด + a11y พัง)', () => {
    /* ไทล์ต้องเป็น <div> เพราะข้างในมีทั้งปุ่มแก้ไขและปุ่ม copy */
    expect(CAROUSEL).toMatch(/data-testid="flex-carousel-card"[\s\S]{0,200}className="group relative flex/);
    expect(CAROUSEL).not.toMatch(/<button[^>]*data-testid="flex-carousel-card"/);
  });

  it('⭐ ย่อการ์ดที่ 70% ตามที่เจ้าของสั่ง', () => {
    expect(CAROUSEL).toContain('CAROUSEL_ZOOM = 0.7');
  });

  it('⭐⭐ 🔴 การ์ดที่ยาวต้องเลื่อนดูได้ ไม่ใช่ถูกตัด (เจ้าของ: "อย่าตกขอบ")', () => {
    expect(CAROUSEL).toContain('overflow-y-auto overflow-x-hidden');
    expect(CAROUSEL).not.toMatch(/h-\[420px\][^>]*overflow-hidden/);
  });

  it('⭐ มีปุ่มเลื่อนซ้าย/ขวา และมี label แปลภาษา', () => {
    expect(CAROUSEL).toContain("t('flex.carousel_prev')");
    expect(CAROUSEL).toContain("t('flex.carousel_next')");
  });
});

describe('[FLEXCAROUSEL] 🔴 ห้ามคอขวด — lazy load ฝั่ง client', () => {
  it('⭐⭐⭐ การ์ดที่ยังไม่เข้าใกล้จอ ต้องไม่ mount FlexBubble', () => {
    /* คอขวดจริง: FlexBubble เรียก renderFlex + DOMPurify.sanitize ต่อการ์ดหนึ่งใบ
       per-page เลือกได้ถึง 100 ⇒ mount พร้อมกันหมดคือ sanitize 100 รอบใน commit เดียว */
    expect(CAROUSEL).toContain('lazy.isRevealed(item.id)');
    expect(CAROUSEL).toContain('flex-carousel-placeholder');
  });

  it('⭐⭐ ใช้ IntersectionObserver **ตัวเดียว** ไม่ใช่ตัวต่อไทล์', () => {
    const created = LAZY.match(/new IntersectionObserver/g) ?? [];
    expect(created.length).toBe(1);
  });

  it('⭐⭐ เปิดแล้วเลิกเฝ้า และไม่ปิดคืน — กันการ sanitize ซ้ำตอนเลื่อนไปมา', () => {
    expect(LAZY).toContain('io.unobserve(e.target)');
    expect(LAZY).not.toContain('next.delete(');
  });

  it('⭐⭐ ไม่มี IntersectionObserver (jsdom/เบราว์เซอร์เก่า) ⇒ เปิดทุกใบ ไม่ใช่จอว่าง', () => {
    expect(LAZY).toMatch(/typeof IntersectionObserver === 'undefined'/);
  });

  it('⭐ placeholder สูงเท่าการ์ดจริง ⇒ ไม่มี layout shift', () => {
    expect(CAROUSEL).toMatch(/h-\[420px\][\s\S]{0,500}flex-carousel-placeholder/);
  });

  it('⭐⭐⭐ 🔴 observer ต้องถูกสร้างใน ref callback ไม่ใช่ใน useEffect', () => {
    /* บั๊กจริงที่เจ้าของเจอบนจอ 31/08: การ์ดไม่ขึ้นเลย ทั้งหน้าเป็นกล่องเทา
       เพราะ React ผูก ref ตอน commit ซึ่งเกิด **ก่อน** effect ⇒ ตอน ref ทำงาน
       observer ยังไม่ถูกสร้าง ⇒ `?.observe()` กลืนเงียบ ⇒ ไม่มีใบไหนถูกเฝ้า
       ⇒ ต้องสร้างแบบ lazy ตอนถูกใช้ครั้งแรก และ effect เหลือแค่ disconnect */
    expect(LAZY).toContain('const getObserver = useCallback');
    // effect ต้องไม่สร้าง observer อีกต่อไป
    const effect = LAZY.slice(LAZY.indexOf('useEffect('), LAZY.indexOf('const registerRef'));
    expect(effect).not.toContain('new IntersectionObserver');
    expect(effect).toContain('disconnect()');
  });

  it('⭐⭐ ref callback ถูก cache ต่อ id ⇒ ไม่ observe ซ้ำทุก render', () => {
    expect(LAZY).toContain('refCache');
  });

  it('⭐⭐ setState คืนตัวเดิมเมื่อไม่มีอะไรใหม่ ⇒ ไม่เกิด re-render loop', () => {
    expect(LAZY).toMatch(/if \(fresh\.length === 0\) return prev;/);
  });
});

describe('[FLEXCAROUSEL] PIN ย้ายมาจาก row preview — ยังต้องจริงอยู่', () => {
  it('⭐⭐ PIN: โหมดนี้ไม่คุยกับเซิร์ฟเวอร์เลย (สลับโหมดต้องฟรี)', () => {
    for (const src of [CAROUSEL, VIEWMODE, LAZY]) {
      expect(src).not.toMatch(/\bfetch\(|axios|Service\./);
    }
  });

  it('⭐⭐⭐ PIN: reuse FlexBubble ตัวเดิม ห้ามเขียน renderer ใหม่ (DOMPurify)', () => {
    /* ถ้ามีใครเขียน renderer ใหม่ = แตก sanitiser = เปิดช่อง stored XSS */
    expect(CAROUSEL).toContain("from '../../chat/FlexBubble'");
    expect(CAROUSEL).toContain('<FlexBubble');
    expect(CAROUSEL).not.toContain('dangerouslySetInnerHTML');
    expect(CAROUSEL).not.toContain('DOMPurify');
  });
});

describe('[FLEXCAROUSEL] ท้ายลิสต์ — คนละตัวควบคุมต่อโหมด', () => {
  it('⭐⭐ จำนวนรวมอยู่ตำแหน่งเดิมเสมอ ทั้งสองโหมด', () => {
    /* "แสดงจำนวนการ์ดทั้งหมดตลอดเวลาตำแหน่งเดิม" ⇒ span นี้ต้องอยู่นอกเงื่อนไขโหมด */
    const total = PAGE.indexOf("t('common.showing_total'");
    const modeSplit = PAGE.indexOf('viewMode.isCarousel ? (', total);
    expect(total).toBeGreaterThan(-1);
    expect(modeSplit).toBeGreaterThan(total); // จำนวนรวมมาก่อนการแยกโหมด = ใช้ร่วมกัน
  });

  it('⭐⭐ โหมดการ์ด: ไม่มี pagination ไม่มี per-page และ **ไม่มีปุ่มโหลดเพิ่ม**', () => {
    /* เจ้าของสั่ง: "load more auto เวลา scroll สุด ไม่ใช่ปุ่ม ไม่เอาปุ่ม" */
    expect(PAGE).not.toContain("t('flex.load_more')");
    expect(PAGE).toContain('setCardCount((c) => c + CAROUSEL_STEP)');
    // per-page ถูกกั้นด้วย !isCarousel
    expect(PAGE).toMatch(/\{!viewMode\.isCarousel && \([\s\S]{0,600}common\.per_page/);
  });

  it('⭐⭐⭐ เลื่อนสุด = โหลดเอง · ผูกเฉพาะตอนยังมีของ', () => {
    expect(PAGE).toContain('hasMore={items.length < totalItems}');
    expect(PAGE).toContain('onReachEnd={loadMoreCards}');
    expect(CAROUSEL).toContain('flex-carousel-end');
    expect(CAROUSEL).toMatch(/if \(!onReachEnd \|\| !hasMore\) return;/);
  });

  it('⭐⭐⭐ 🔴 observer ปลายแถวต้องใช้ root = แถบที่เลื่อน ไม่ใช่ viewport', () => {
    /* แถวนี้เลื่อนแนวนอนในกล่องตัวเอง — ใช้ viewport จะไม่มีวันตรวจเจอ */
    expect(CAROUSEL).toMatch(/\{ root, rootMargin: '200px' \}/);
  });

  it('⭐⭐ กันยิงซ้อนตอนค้างอยู่ปลายแถว', () => {
    expect(PAGE).toContain('if (loadingRef.current) return;');
  });

  it('⭐⭐ `onReachEnd` ต้องเป็น useCallback — ไม่งั้น observer subscribe รัว', () => {
    expect(PAGE).toMatch(/const loadMoreCards = useCallback\(/);
  });

  it('⭐⭐ โหมดตาราง: ยังมี pagination + per-page ครบ', () => {
    expect(PAGE).toContain("t('common.per_page')");
    expect(PAGE).toContain('[10, 25, 50, 100]');
    expect(PAGE).toContain('setCurrentPage(prev => Math.min(totalPages, prev + 1))');
  });

  it('⭐⭐⭐ 🔴 the read depends on itemsPerPage and cardCount', () => {
    /* ของเดิมไม่มี `itemsPerPage` เพราะเคยเป็นค่าคงที่ ⇒ ถ้าไม่เติม
       เปลี่ยนจำนวนต่อหน้า/กดโหลดเพิ่ม จะไม่ยิงคำขอใหม่เลยแบบเงียบ ๆ
       [FEAT-20261027-TANSTACK] FLIPPED, not deleted: the property moved from the old
       useCallback deps array (`}, [currentPage, …`) into the query PARAMS — the page's
       params object IS the query key (services/media/queries/useFlexQueries.ts), so a
       value missing from it never re-reads, exactly the bug this case guards. */
    const at = PAGE.indexOf('useFlexListPageQuery(');
    const params = PAGE.slice(at, PAGE.indexOf('tab,', at));
    expect(at).toBeGreaterThan(-1);
    expect(params).toContain('itemsPerPage');
    expect(params).toContain('cardCount');
    expect(params).toContain('viewMode.isCarousel');
    const hook = strip(read('services/media/queries/useFlexQueries.ts'));
    expect(hook).toMatch(/useFlexListPageQuery[\s\S]*queryKey: mediaKeys\.flexList\(params/);
  });

  it('⭐⭐ โหมดการ์ดยิง page 1 เสมอ + limit ที่โตขึ้น (ไม่ append ฝั่ง client)', () => {
    expect(PAGE).toContain('page: viewMode.isCarousel ? 1 : currentPage');
    expect(PAGE).toContain('limit: viewMode.isCarousel ? cardCount : itemsPerPage');
  });

  it('⭐ เปลี่ยนแท็บ/ค้นหา/ฟิลเตอร์ ⇒ รีเซ็ตจำนวนที่โหลดด้วย', () => {
    const resets = PAGE.match(/setCardCount\(CAROUSEL_STEP\)/g) ?? [];
    expect(resets.length).toBeGreaterThanOrEqual(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   🔴 เคสรันจริง — ตัวที่ **จับบั๊กจริงได้** ไม่ใช่แค่ตรวจรูปโค้ด
   ─────────────────────────────────────────────────────────────────────────
   บั๊ก 31/08 (การ์ดไม่ขึ้นเลย ทั้งหน้าเป็นกล่องเทา) หลุดจากเทสชุดแรกทั้งหมด
   เพราะ **jsdom ไม่มี IntersectionObserver** ⇒ โค้ดเดินทาง fallback ที่เปิดทุกใบ
   ⇒ เทสเขียวทั้งที่ของจริงพัง · ต้อง mock IO เข้าไปถึงจะเดินเส้นทางจริง
   ⚠️ ห้ามลบ describe นี้ และห้ามลบการ mock — ไม่งั้นเส้นทางจริงจะไม่เคยถูกทดสอบ
   ══════════════════════════════════════════════════════════════════════════ */
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { FlexCardCarousel } from '../components/flex/carousel/FlexCardCarousel';
import { I18nProvider } from '../i18n';

const BUBBLE = { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [] } };
const ITEMS = [
  { id: 'a', name: 'CARD A', tag: 'flex_m00001', content_json: BUBBLE },
  { id: 'b', name: 'CARD B', tag: 'flex_m00002', content_json: BUBBLE },
];

let observed: Element[] = [];
let fire: ((entries: any[]) => void) | null = null;

beforeEach(() => {
  observed = [];
  fire = null;
  class MockIO {
    constructor(cb: (e: any[]) => void) { fire = cb; }
    observe(el: Element) { observed.push(el); }
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).IntersectionObserver = MockIO as any;
});

afterEach(() => {
  cleanup();
  delete (globalThis as any).IntersectionObserver;
  vi.restoreAllMocks();
});

const renderCarousel = () =>
  render(
    <I18nProvider>
      <FlexCardCarousel items={ITEMS} onEdit={() => {}} onCopyTag={() => {}} emptyText="empty" />
    </I18nProvider>,
  );

describe('[FLEXCAROUSEL] 🔴 เส้นทางจริงที่มี IntersectionObserver', () => {
  it('⭐⭐⭐ ทุกไทล์ต้องถูก observe จริง — บั๊กเดิมคือไม่มีใบไหนถูกเฝ้าเลย', () => {
    renderCarousel();
    /* ก่อนแก้: observer ถูกสร้างใน useEffect ซึ่งรัน **หลัง** ref
       ⇒ observed.length === 0 ⇒ ไม่มีการ์ดใบไหนโผล่ตลอดกาล */
    expect(observed.length).toBe(ITEMS.length);
  });

  it('⭐⭐⭐ ก่อน observer ยิง = กล่องเทา · ยิงแล้ว = การ์ดจริงโผล่', () => {
    const { queryAllByTestId } = renderCarousel();
    expect(queryAllByTestId('flex-carousel-placeholder').length).toBe(ITEMS.length);

    // จำลองว่าไทล์แรกเลื่อนเข้ามาใกล้จอ
    act(() => { fire?.([{ isIntersecting: true, target: observed[0] }]); });

    expect(queryAllByTestId('flex-carousel-placeholder').length).toBe(ITEMS.length - 1);
  });
});

/* [FIX-20260831-CAROUSELPENCIL] the pencil looked like the way in and was not.
   ────────────────────────────────────────────────────────────────────────────
   Owner, 31/08: "กดรูปดินสอแล้วไม่เปิดฟอร์มแก้". The tile's edit control was the
   card NAME; the `Edit2` glyph sat NEXT to that button as decoration, so a click
   that landed on the icon — the one thing on the row that says "edit" — hit
   nothing at all. The name still works, which is why this never showed up as
   "editing is broken": it only failed for whoever aimed at the icon.

   These are DOM cases on purpose. The old cases in this file assert on source
   text, and source text cannot tell a rendered <button> from a bare <svg>. */
describe('[CAROUSELPENCIL] the pencil itself opens the form', () => {
  const renderWith = (onEdit: (id: string) => void) =>
    render(
      <I18nProvider>
        <FlexCardCarousel items={ITEMS} onEdit={onEdit} onCopyTag={() => {}} emptyText="empty" />
      </I18nProvider>,
    );

  it('⭐⭐⭐ clicking the pencil calls onEdit with THAT tile id', () => {
    const onEdit = vi.fn();
    const { getAllByTestId } = renderWith(onEdit);
    const pencils = getAllByTestId('flex-carousel-edit');
    expect(pencils.length).toBe(ITEMS.length);
    fireEvent.click(pencils[1]!);
    expect(onEdit).toHaveBeenCalledWith(ITEMS[1]!.id);
  });

  it('⭐⭐ it is a real button — reachable by keyboard, not an icon that eats clicks', () => {
    const onEdit = vi.fn();
    const { getAllByTestId } = renderWith(onEdit);
    expect(getAllByTestId('flex-carousel-edit')[0]!.tagName).toBe('BUTTON');
  });

  it('⭐ the card name still opens the form — the old way is not taken away', () => {
    const onEdit = vi.fn();
    const { getByText } = renderWith(onEdit);
    fireEvent.click(getByText(ITEMS[0]!.name));
    expect(onEdit).toHaveBeenCalledWith(ITEMS[0]!.id);
  });

  it('⭐ the copy button still does NOT open the form', () => {
    const onEdit = vi.fn();
    const onCopyTag = vi.fn();
    const { getAllByText } = render(
      <I18nProvider>
        <FlexCardCarousel items={ITEMS} onEdit={onEdit} onCopyTag={onCopyTag} emptyText="empty" />
      </I18nProvider>,
    );
    fireEvent.click(getAllByText('Copy')[0]!);
    expect(onCopyTag).toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

/* [FEAT-20260831-CAROUSELBAR] the strip's own scroll bar — above AND below.
   ────────────────────────────────────────────────────────────────────────────
   Owner, 31/08: the bar must be bigger, visible at both ends and actually
   grabbable. The browser's overlay scrollbar fades out when the pointer stops,
   which is why the row often looked like it did not scroll at all.

   ⚠️ jsdom performs no layout, so `scrollWidth`/`clientWidth` are 0 and the bar
      would correctly render nothing. The geometry is stubbed to describe a strip
      that really does overflow — that is the case under test. */
describe('[CAROUSELBAR] the scroll bar', () => {
  const withGeometry = (scrollWidth = 2000, clientWidth = 800) => {
    const view = render(
      <I18nProvider>
        <FlexCardCarousel items={ITEMS} onEdit={() => {}} onCopyTag={() => {}} emptyText="empty" />
      </I18nProvider>,
    );
    const strip = view.getByTestId('flex-carousel-strip');
    Object.defineProperty(strip, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(strip, 'clientWidth', { value: clientWidth, configurable: true });
    let left = 0;
    Object.defineProperty(strip, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (v: number) => { left = v; strip.dispatchEvent(new Event('scroll')); },
    });
    act(() => { strip.dispatchEvent(new Event('scroll')); });
    return { ...view, strip };
  };

  it('⭐⭐⭐ renders ABOVE and BELOW the strip — one control, both ends', () => {
    const { queryByTestId } = withGeometry();
    expect(queryByTestId('flex-carousel-bar-top')).toBeTruthy();
    expect(queryByTestId('flex-carousel-bar-bottom')).toBeTruthy();
  });

  it('⭐⭐⭐ a strip that does NOT overflow gets no bar at all', () => {
    /* a decorative full-width bar that cannot move is worse than none. */
    const { queryByTestId } = withGeometry(600, 800);
    expect(queryByTestId('flex-carousel-bar-top')).toBeNull();
    expect(queryByTestId('flex-carousel-bar-bottom')).toBeNull();
  });

  it('⭐⭐ the thumb is as wide as the visible share of the strip', () => {
    const { getByTestId } = withGeometry(2000, 500);
    const thumb = getByTestId('flex-carousel-thumb-top') as HTMLElement;
    expect(thumb.style.width).toBe('25%');
  });

  it('⭐⭐ the strip stays the source of truth — scrolling it moves the thumb', () => {
    const { getByTestId, strip } = withGeometry(2000, 1000);
    const thumb = () => (getByTestId('flex-carousel-thumb-bottom') as HTMLElement).style.left;
    expect(thumb()).toBe('0%');
    act(() => { (strip as HTMLElement).scrollLeft = 1000; });
    expect(thumb()).toBe('50%');
  });
});
