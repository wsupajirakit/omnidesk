import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { queryClient } from '../services/query';

/* [FEAT-20261027-TANSTACK] The app's QueryClient is one module-level instance
   (services/query/queryClient.ts), so a cached answer from one test would paint
   into the next. Empty it after every case → each test starts as a cold page
   load, which is what every existing test was written against. */
afterEach(() => {
  queryClient.clear();
});

// jsdom (vitest) does not expose a usable localStorage without an origin — polyfill a simple one
// so authStorage / preferences / i18n can read/write during render.
const _store: Record<string, string> = {};
const _ls = {
  getItem: (k: string) => (k in _store ? _store[k] : null),
  setItem: (k: string, v: string) => { _store[k] = String(v); },
  removeItem: (k: string) => { delete _store[k]; },
  clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
  key: (i: number) => Object.keys(_store)[i] ?? null,
  get length() { return Object.keys(_store).length; },
};
Object.defineProperty(globalThis, 'localStorage', { value: _ls, writable: true, configurable: true });
if (typeof window !== 'undefined') Object.defineProperty(window, 'localStorage', { value: _ls, writable: true, configurable: true });

/**
 * [FIX-20260904-JSDOMSCROLL] `scrollIntoView` — a browser API jsdom does not have
 * ===========================================================================
 * jsdom implements no layout, so it ships `Element.prototype.scrollIntoView` as
 * nothing at all. Any component that scrolls a field into view — e.g. the object
 * form jumping to the first invalid tab (`components/object/scope/ObjectFormTabs.tsx`)
 * — therefore throws `target.scrollIntoView is not a function` inside a handler,
 * which vitest reports as an UNHANDLED ERROR: the run says "296 files passed"
 * and "2 errors" in the same breath, and its own warning says that may cause
 * false positives.
 *
 * 🔴 THE FIX BELONGS HERE, NOT IN THE COMPONENT. Guarding the call with `?.` in
 *    product code would be changing shipped behaviour to satisfy a test
 *    environment — every real browser has this method. The gap is jsdom's.
 *    ห้ามแก้โค้ดจริงเพื่อเอาใจ jsdom — ช่องโหว่อยู่ที่ environment
 *
 * A no-op is the honest stub: there is no layout to scroll, so there is nothing
 * to assert about the result. A test that needs to prove "it scrolled" should
 * spy on this method, which is possible precisely because it now exists.
 *
 * revert: delete this block; the two unhandled errors come back.
 */
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* no layout in jsdom — nothing to scroll */
  };
}

/**
 * [FIX-20260904-JSDOMSCROLL] `URL.createObjectURL` / `revokeObjectURL` — same gap
 * ===========================================================================
 * jsdom has no blob URL store, so both methods are absent. A component that
 * previews a picked file before it uploads — `components/object/gallery/
 * UploadProgressPanel.tsx` — calls `createObjectURL` inside a `useEffect`, so
 * the throw lands in React's commit phase and surfaces as an unhandled error
 * rather than a failing case: the run reads "296 files passed · 1 error".
 *
 * The stub returns a STRING because that is what the component stores and later
 * hands to `revokeObjectURL`; returning undefined would move the failure one
 * step later instead of removing it. Each call gets a distinct value so a test
 * that asserts "a new preview replaced the old one" can still tell them apart.
 *
 * Same rule as above: real browsers have these, the gap is jsdom's, so the
 * product code is not touched. เบราว์เซอร์จริงมีครบ — อย่าไปแก้โค้ดจริง
 *
 * revert: delete this block; the unhandled error comes back.
 */
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  let blobSeq = 0;
  URL.createObjectURL = () => `blob:jsdom/${++blobSeq}`;
  URL.revokeObjectURL = () => {
    /* nothing was registered — nothing to release */
  };
}

/**
 * [FEAT-20260825-BCASTFOLD] กางการ์ดที่พับอยู่ทั้งหมดในฟอร์มบรอดแคสต์
 * ===========================================================================
 * ตั้งแต่ 25/08 การ์ดในโมดัลสร้าง/แก้ไขบรอดแคสต์ **พับเป็นค่าเริ่มต้น**
 * (เจ้าของสั่ง: *"ทุกอย่างให้พับไว้"*) ⇒ เทสที่เขียนไว้ก่อนหน้านั้นหาช่องกรอกไม่เจอ
 * เพราะเนื้อในถูก unmount ไม่ใช่แค่ซ่อน
 *
 * 🔴 ทางแก้คือ "กางก่อนแล้วค่อยทดสอบ" ไม่ใช่ไปตั้ง `defaultOpen` เป็น true
 *    การเปลี่ยนค่าเริ่มต้นเพื่อให้เทสผ่าน = ลบฟีเจอร์ที่เจ้าของสั่งทิ้งไปเงียบ ๆ
 *    เทสต้องเดินตามหน้าจอจริง ไม่ใช่บังคับหน้าจอให้เดินตามเทส.
 *
 * ⚠️ กดซ้ำ ๆ จนไม่มีปุ่มที่ `aria-expanded="false"` เหลือ — การ์ดซ้อนการ์ดได้
 *    และการ์ดชั้นในเพิ่ง mount หลังชั้นนอกกางเสร็จ
 */
export function openAllFormSections(container: HTMLElement): void {
  for (let round = 0; round < 5; round++) {
    const closed = Array.from(
      container.querySelectorAll('[data-testid$="-toggle"][aria-expanded="false"]')
    ) as HTMLElement[];
    if (closed.length === 0) return;
    /* 🔴 `fireEvent` ไม่ใช่ `el.click()` — RTL ห่อ act() ให้เอง ทำให้ React
       flush state ก่อนบรรทัดถัดไปอ่าน DOM · `el.click()` ตรง ๆ ทำให้การ์ด
       "กางแล้วแต่ยังไม่ปรากฏ" แล้วเทสจะฟ้อง `expected null not to be null`
       (เจอจริง 25/08 พร้อม warning "not wrapped in act(...)")
       กดปุ่มดิบ = React ยังไม่อัปเดต DOM ทัน. */
    closed.forEach(btn => fireEvent.click(btn));
  }
}
