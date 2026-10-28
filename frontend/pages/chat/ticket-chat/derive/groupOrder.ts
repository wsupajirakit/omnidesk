/**
 * [REFACTOR-20261027-TCSPLIT] The bodies of TicketChat's `visibleGroups` and `orderedGroups`
 * useMemos — which groups the switcher offers (alphabetical) and in what order the tabs stand
 * (promoted → favourites → the rest). Moved verbatim; pure. The useMemos stay in the page.
 * revert: paste each body back into its useMemo in the page.
 */
import { filterVisibleGroups } from '../../../../services/admin';

export function sortVisibleGroups({
  groups,
}: {
  groups: any[];
}) {
  const real = filterVisibleGroups(groups as any).sort((a: any, b: any) =>
    (a.group_name || '').localeCompare(b.group_name || '', undefined, { numeric: true, sensitivity: 'base' })
  );
  // DEV-ONLY: inject 10 dummy OA groups to exercise the slider 70%-overflow.
  // OFF by default (never in prod). Turn on in the browser console with
  //   localStorage.setItem('tc_dummy_oa','1'); location.reload()
  // and off with localStorage.removeItem('tc_dummy_oa').
  try {
    if (localStorage.getItem('tc_dummy_oa') === '1') {
      const dummies = Array.from({ length: 10 }, (_, i) => ({
        _id: `dummy-oa-${i + 1}`,
        group_name: `DummyOA-${String(i + 1).padStart(2, '0')}`,
      }));
      return [...real, ...dummies];
    }
  } catch { /* ignore */ }
  return real;
}


export function orderGroups({
  promotedId, visibleGroups, favOrder,
}: {
  promotedId: string;
  visibleGroups: { _id: string; group_name: string; }[];
  favOrder: string[];
}) {
  const head = promotedId;
  const byId = new Map(visibleGroups.map(g => [g._id, g]));
  const seen = new Set<string>();
  const out: typeof visibleGroups = [];
  const push = (id?: string | null) => {
    if (!id || seen.has(id)) return;
    const g = byId.get(id);
    if (!g) return;
    seen.add(id); out.push(g);
  };
  push(head);
  favOrder.forEach(push);
  visibleGroups.forEach(g => push(g._id));   // remaining alpha
  return out;
  // [FIX-20260801-OATABSTAY] เอา activeGroupId ออกจาก deps ด้วย — ไม่ได้ใช้ข้างในแล้ว
  // ถ้าปล่อยไว้ array จะถูกสร้างใหม่ทุกครั้งที่คลิกแท็บโดยไม่มีอะไรเปลี่ยน
}
