/* ==== [PERF-20260822-TKTIDSFETCH] hook: ดึงเฉพาะใบที่ระบุ แทนการโหลดทั้งลิสต์ ====
 *
 * ## ทำไมย้ายออกจาก TicketChat.tsx
 * ตรรกะนี้มี **3 ทางตกกลับ** ไป full refetch (ไม่มี id · BE ตอบไม่สำเร็จ · โยน error)
 * ถ้าใครลบ `scheduleRefetch()` ใน `catch` ออก **ไม่มีอะไรแดง** ตราบใดที่มันฝังอยู่
 * ใน component 5,000 บรรทัดที่ render ทั้งหน้ายาก — จึงแยกออกมาให้ฉีด dependency
 * ได้ แล้วเทสทุกทางตกกลับตรง ๆ · `TicketChat` เหลือแค่เรียกใช้
 *
 * ## หน้าที่
 * สะสม `_id` ของ event ที่ patch ในที่ไม่ได้ ตลอดหน้าต่าง 600 ms (เท่า `scheduleRefetch`)
 * แล้วขอเฉพาะใบเหล่านั้นผ่าน endpoint ลิสต์ตัวเดิม + `ids` · ผลถูกรวมเข้า state
 * ด้วย `mergePartialTickets` (dedup + กรองสิทธิ์)
 *
 * ## กฎ
 * - พารามิเตอร์ทุกตัวต้องเหมือน `fetchActive` เป๊ะ — BE เอา `ids` ไป AND ทับ
 *   ⇒ ผลเป็น "ส่วนย่อยแท้" ของลิสต์เต็มเสมอ ตั๋วที่ไม่ตรงคำค้นแอบเข้ามาไม่ได้
 * - ล้มเมื่อไหร่ **ตกกลับ full refetch ทันที ห้ามเงียบ** — ทั้ง 3 ทางมีเทสแยก
 * - เกินเพดาน `PARTIAL_FETCH_MAX_IDS` = โหลดเต็มถูกกว่ายิงหลายรอบ
 *
 * revert: ลบไฟล์นี้ แล้วเปลี่ยนจุดเรียกใน TicketChat กลับเป็น `scheduleRefetch()`
 */
import { useCallback, useEffect, useRef } from 'react';

import { mergePartialTickets, PARTIAL_FETCH_MAX_IDS } from './partialTicketMerge';
import type { MergeableTicket } from './partialTicketMerge';

/** พารามิเตอร์ที่ต้องตรงกับ `fetchActive` — ผู้เรียกส่งมา hook ไม่เดาเอง */
export interface PartialFetchScope {
  activeGroupId: string | null | undefined;
  activeHookId: string | null | undefined;
  /** `undefined` = ทั้งหมด (เหมือน fetchActive) */
  withinDays: number | undefined;
  search: string | undefined;
  allowedHooks: Set<string> | null | undefined;
}

/** สิ่งที่ hook ต้องเรียก — ฉีดเข้ามาเพื่อให้เทสได้โดยไม่ต้อง mock เครือข่าย */
export interface PartialFetchDeps<T extends MergeableTicket> {
  listByGroup: (groupId: string, params: Record<string, unknown>) => Promise<{ success?: boolean; data?: T[] } | null | undefined>;
  listByHook: (hookId: string, params: Record<string, unknown>) => Promise<{ success?: boolean; data?: T[] } | null | undefined>;
  /** ทางตกกลับ — full refetch เดิม */
  scheduleRefetch: () => void;
  setActiveTickets: (updater: (prev: T[]) => T[]) => void;
  /** debounce เท่า `scheduleRefetch` — เปิดให้เทสย่นได้ */
  debounceMs?: number;
}

export function usePartialTicketFetch<T extends MergeableTicket>(
  scope: PartialFetchScope,
  deps: PartialFetchDeps<T>,
): (id: string) => void {
  const idsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // อ่านค่าล่าสุดเสมอตอน timer ยิง — ไม่ผูกกับ closure ตอน schedule
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const flush = useCallback(async () => {
    timerRef.current = null;
    const ids = Array.from(idsRef.current);
    idsRef.current.clear();
    if (ids.length === 0) return;

    const s = scopeRef.current;
    const d = depsRef.current;
    const params = {
      job_status: '0,1',
      limit: 'all',
      within_days: s.withinDays,
      search: s.search,
      ids,
    };
    try {
      let res: { success?: boolean; data?: T[] } | null | undefined;
      if (s.activeGroupId) res = await d.listByGroup(s.activeGroupId, params);
      else if (s.activeHookId) res = await d.listByHook(s.activeHookId, params);
      else { d.scheduleRefetch(); return; }           // ทาง ① ไม่มี scope
      if (!res?.success) { d.scheduleRefetch(); return; } // ทาง ② BE ตอบไม่สำเร็จ
      const rows = res.data ?? [];
      d.setActiveTickets((prev) =>
        mergePartialTickets(prev, rows, { allowedHooks: s.allowedHooks ?? null }),
      );
    } catch (e) {
      console.error('partial ticket fetch failed — falling back to full refetch', e);
      d.scheduleRefetch();                               // ทาง ③ โยน error
    }
  }, []);

  const schedule = useCallback((id: string) => {
    const d = depsRef.current;
    if (!id) { d.scheduleRefetch(); return; }           // ทาง ⓪ event ผิดรูป
    idsRef.current.add(id);
    if (idsRef.current.size > PARTIAL_FETCH_MAX_IDS) {  // เกินเพดาน → เต็มถูกกว่า
      idsRef.current.clear();
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      d.scheduleRefetch();
      return;
    }
    if (timerRef.current) return;                       // รวมเป็นรอบเดียว
    timerRef.current = setTimeout(() => { void flush(); }, d.debounceMs ?? 600);
  }, [flush]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return schedule;
}
