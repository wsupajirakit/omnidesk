import { useCallback, useEffect, useState } from 'react';

/**
 * [FEAT-20260830-FLEXBULKGROUPS] which cards the bulk action will write to.
 *
 * WHY THE SELECTION IS CLEARED ON `resetKey`
 *   The users page — the pattern this feature copies — keeps its selection
 *   across page, filter and search changes. Reading that code turned up the
 *   consequence: ids of rows that are no longer on screen stay selected, so the
 *   confirm dialog lists FEWER names than the write actually touches, and the
 *   count it restates is wrong. On a REPLACE write that is somebody silently
 *   losing access to a card they never saw named.
 *   Here the page passes tab | page | filters as one key, so anything that
 *   changes which rows exist also drops the selection.
 *   เปลี่ยนหน้า/แท็บ/ตัวกรอง = ล้างที่เลือก ป้องกันเขียนทับใบที่มองไม่เห็น
 *
 * Bulk MODE survives the reset — only the ticked ids are dropped. Turning the
 * mode off with every page change would make the feature unusable.
 *
 * revert: delete this file, its siblings in this folder, and the call sites in
 * pages/content/FlexMessageList.tsx.
 */
export interface FlexSelectionState {
  /** Bulk mode: the checkbox column and the action bar are visible. */
  active: boolean;
  ids: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Tick every id on the current page, keeping anything already ticked. */
  selectMany: (ids: string[]) => void;
  clear: () => void;
  enter: () => void;
  /** Leave bulk mode and drop the selection — one action, never half of it. */
  exit: () => void;
}

export const useFlexSelection = (resetKey: unknown): FlexSelectionState => {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<string[]>([]);

  /* mutation: delete this effect → the "changing page clears the selection"
     case in flexBulkGroups.dom.test.tsx goes red. */
  useEffect(() => {
    setIds([]);
  }, [resetKey]);

  const isSelected = useCallback((id: string) => ids.includes(id), [ids]);
  const toggle = useCallback(
    (id: string) =>
      setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])),
    [],
  );
  const selectMany = useCallback(
    (next: string[]) => setIds((cur) => [...new Set([...cur, ...next])]),
    [],
  );
  const clear = useCallback(() => setIds([]), []);
  const enter = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    setIds([]);
  }, []);

  return { active, ids, isSelected, toggle, selectMany, clear, enter, exit };
};
