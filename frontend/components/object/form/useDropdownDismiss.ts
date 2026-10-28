import { useEffect } from 'react';

/**
 * [REFACTOR-20260904-FORMHOOKS] Close the two dropdowns when the click lands
 * outside them.
 * ===========================================================================
 * A leaf of a hook, moved because it is genuinely self-contained: two refs in,
 * two setters in, one listener, nothing else. It was the last piece of the form
 * that had no reason to be inline.
 *
 * ⚠️ `mousedown`, NOT `click`. A dropdown item that unmounts on selection never
 * completes a click, so a `click` listener fires on the element behind it — or
 * not at all. mousedown also closes the menu before the button under the cursor
 * can act on the same gesture, which is what makes the dismissal feel instant.
 *
 * ⚠️ The empty dependency array is correct: the refs are stable and the setters
 * come from `useState`, so re-subscribing on every render would only add work.
 *
 * revert: paste the effect back into `ObjectImageFormModal.tsx`.
 */
export function useDropdownDismiss(
  categoryRef: React.RefObject<HTMLDivElement>,
  groupRef: React.RefObject<HTMLDivElement>,
  setIsCategoryDropdownOpen: (open: boolean) => void,
  setIsGroupDropdownOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryRef.current && !categoryRef.current.contains(event.target as Node)) {
        setIsCategoryDropdownOpen(false);
      }
      if (groupRef.current && !groupRef.current.contains(event.target as Node)) {
        setIsGroupDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
