/**
 * [UI-20260901-OBJGRIDFRAME] Re-layout a borrowed picker without editing it.
 *
 * `MultiCheckGrid` belongs to the broadcast lane. It hardcodes two columns and a
 * 22rem scroll box, which is right where broadcast puts it and wrong in the
 * Object modals, where the grid gets the full modal width and the labels are
 * short.
 *
 * The tempting fix is a `columns` prop on `MultiCheckGrid` with a default of 2.
 * That is still debt: it edits a file another feature owns, widens its contract
 * forever, and puts this form's layout question inside a component that has no
 * reason to know about it. Every future caller then has one more prop to reason
 * about, and the broadcast tests carry the risk of our change.
 *
 * So: inherit by WRAPPING. This renders the picker untouched and re-lays out its
 * grid from the outside, using the `data-testid` hooks the component already
 * exposes as public API. Nothing in `components/campaign/` changes; deleting
 * this file restores the borrowed look exactly.
 *
 * WARNING — the selectors below depend on `MultiCheckGrid` rendering
 * `[data-testid$="-grid"]` for its grid and putting the scroll box immediately
 * around it. That is a real coupling and it is the price of not editing the
 * component. It is narrow (two selectors), it is declared here rather than
 * spread across two modals, and `objectGridFrame.dom.test.tsx` fails if either
 * hook moves — which is what stops it becoming a silent breakage.
 *
 * revert: delete this file and render `<MultiCheckGrid>` directly. The grid goes
 * back to two columns and 22rem.
 */
import React from 'react';

export interface ObjectGridFrameProps {
  /** Columns on a wide screen. Folds to fewer as the viewport narrows. */
  columns: 3 | 4;
  /** Scroll-box height, e.g. `'26rem'`. */
  maxHeight?: string;
  children: React.ReactNode;
}

/* Whole class names, never interpolated: Tailwind scans source as text, so a
   built string like `lg:grid-cols-${n}` is never emitted and the grid silently
   collapses to one column. */
const COLUMNS: Record<3 | 4, string> = {
  3: 'object-grid-3',
  4: 'object-grid-4',
};

export const ObjectGridFrame: React.FC<ObjectGridFrameProps> = ({
  columns,
  maxHeight = '32rem',
  children,
}) => (
  <div
    className={`object-grid-frame ${COLUMNS[columns]}`}
    style={{ ['--object-grid-max-h' as string]: maxHeight }}
    data-testid="object-grid-frame"
    data-columns={columns}
  >
    {children}
  </div>
);

export default ObjectGridFrame;
