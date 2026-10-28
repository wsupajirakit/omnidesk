/**
 * [FEAT-20260907-GALLERYINCREMENTAL] The album's stored-file grid: five across,
 * drawn a chunk at a time, growing by itself as the scroll reaches the end.
 * ===========================================================================
 * Requirement: 5 per row + lazy load, do not load everything + load more
 * automatically when the scroll reaches the position.
 *
 * 🔴 WHAT IS AND IS NOT FIXED. The FETCH is still one call for the whole album:
 *    `GET /api/image-storage` accepts `object_image_id` and `matching_tag` only —
 *    read out of the backend controller, not assumed. What this removes is the
 *    render cost, which is the part that shows. Server paging is a BE change and
 *    was not made unasked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';

import {
  useIncrementalReveal,
  REVEAL_CHUNK,
} from '../components/object/gallery/useIncrementalReveal';

const MEDIA_STEP_SRC = readFileSync(
  join(process.cwd(), 'components/object/form/ObjectFormMediaStep.tsx'),
  'utf8',
);

/* A controllable IntersectionObserver — jsdom has none, and the hook's own
   fallback (reveal everything) would hide the very behaviour under test. */
let fire: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
let observed = 0;
/** the element the LIVE observer is watching, or null if nothing is. */
let watching: Element | null = null;

/**
 * 🔴 `disconnect()` REALLY STOPS THIS FAKE FROM FIRING, AND THAT MATTERS.
 *
 * The first version of this class had an empty `disconnect()` — and it hid a
 * real bug. React attaches refs CHILD FIRST, so the sentinel's ref ran before
 * the scroll box's, the observer was built with `root: null` (the viewport),
 * and the box's ref then disconnected it. In the browser that left the sentinel
 * watched by nobody and load-more never fired. The no-op fake kept `fire`
 * pointing at the dead observer's callback, so the suite reported success for a
 * feature that did not work. A fake that cannot go wrong proves nothing.
 */
class FakeIO {
  private readonly cb: (e: { isIntersecting: boolean }[]) => void;
  private live = true;
  constructor(cb: (e: { isIntersecting: boolean }[]) => void) {
    this.cb = cb;
    fire = (entries) => {
      if (this.live) this.cb(entries);
    };
  }
  observe(el: Element) {
    observed += 1;
    watching = el;
  }
  disconnect() {
    this.live = false;
    watching = null;
  }
}

beforeEach(() => {
  fire = null;
  observed = 0;
  watching = null;
});

afterEach(() => {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

/** Drives the hook the way the grid does: a scroll box, tiles, a sentinel. */
const Harness: React.FC<{ total: number }> = ({ total }) => {
  const reveal = useIncrementalReveal(total);
  return (
    <div ref={reveal.rootRef} data-testid="box">
      {Array.from({ length: reveal.visibleCount }).map((_, i) => (
        <div key={i} data-testid="tile" />
      ))}
      {reveal.hasMore && <div ref={reveal.sentinelRef} data-testid="more" />}
    </div>
  );
};

describe('the grid itself', () => {
  it('⭐⭐ is FIVE across, at every width', () => {
    /* Five, at every width. The old value was a responsive ladder
       (`grid-cols-4 sm:grid-cols-5 md:grid-cols-6`), which is five on exactly
       one screen size — so the ladder had to go, not just gain a 5. */
    expect(MEDIA_STEP_SRC).toContain('grid grid-cols-5 gap-x-6 gap-y-8');
    /* [UI-20260907-GRIDGUTTER] the gutter is part of the ask: at five across the
       tiles are narrow, and an 8px gap read as one solid block. */
    expect(MEDIA_STEP_SRC).not.toContain('grid-cols-5 gap-2');
    expect(MEDIA_STEP_SRC).not.toContain('grid-cols-5 gap-4');
    /* the axes are deliberately unequal — square tiles make an equal gap read as
       tighter between rows, so the row gutter is the larger of the two */
    expect(MEDIA_STEP_SRC).not.toContain('grid-cols-5 gap-6 ');
    expect(MEDIA_STEP_SRC).not.toContain('grid-cols-4 sm:grid-cols-5 md:grid-cols-6');
  });

  it('⭐⭐ renders a SLICE, not the whole array', () => {
    expect(MEDIA_STEP_SRC).toContain('serverImages.slice(0, reveal.visibleCount)');
  });

  it('⭐⭐ the sentinel SAYS more is coming, with how many are left', () => {
    /* [UI-20260907-LOADMOREGUIDE] with a hundred images the grid
       has to grow, and a silent 6px spacer gave no sign of it — the album just
       looked like it stopped at twenty. The count is what makes it a fact rather
       than a spinner that might be stuck. */
    expect(MEDIA_STEP_SRC).toContain("t('object_image.gallery_loading_more'");
    expect(MEDIA_STEP_SRC).toContain('serverImages.length - reveal.visibleCount');
  });

  it('🔴 the sentinel spans the row', () => {
    /* Without `col-span-full` the marker eats one of the five cells and every
       tile after it shifts across — a layout bug that only appears once an
       album is long enough to have a sentinel at all. */
    const at = MEDIA_STEP_SRC.indexOf('obj-gallery-more');
    expect(at).toBeGreaterThan(-1);
    expect(MEDIA_STEP_SRC.slice(at, at + 200)).toContain('col-span-full');
  });
});

describe('growing as you scroll', () => {
  it('⭐⭐ starts with one chunk, not the whole album', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getAllByTestId } = render(<Harness total={REVEAL_CHUNK * 3} />);
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK);
  });

  it('⭐⭐⭐ reaching the end reveals the next chunk — no button', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getAllByTestId } = render(<Harness total={REVEAL_CHUNK * 3} />);
    expect(observed).toBeGreaterThan(0);

    act(() => fire?.([{ isIntersecting: true }]));
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK * 2);

    act(() => fire?.([{ isIntersecting: true }]));
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK * 3);
  });

  it('🔴🔴 something is ACTUALLY watching the sentinel after mount', () => {
    /* The case that would have caught the ref-ordering bug: it is not enough
       that an observer was constructed, it has to still be live and still
       observing when the mount settles. */
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getByTestId } = render(<Harness total={REVEAL_CHUNK * 3} />);
    expect(watching).not.toBeNull();
    expect(watching).toBe(getByTestId('more'));
  });

  it('🔴 stops at the total and drops the sentinel', () => {
    /* An observer still watching a permanently visible marker would keep firing
       for nothing. */
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getAllByTestId, queryByTestId } = render(<Harness total={REVEAL_CHUNK + 3} />);
    act(() => fire?.([{ isIntersecting: true }]));
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK + 3);
    expect(queryByTestId('more')).toBeNull();
  });

  it('a short album shows in full and never gets a sentinel', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getAllByTestId, queryByTestId } = render(<Harness total={3} />);
    expect(getAllByTestId('tile')).toHaveLength(3);
    expect(queryByTestId('more')).toBeNull();
  });

  it('🔴 an entry that is NOT intersecting changes nothing', () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getAllByTestId } = render(<Harness total={REVEAL_CHUNK * 2} />);
    act(() => fire?.([{ isIntersecting: false }]));
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK);
  });

  it('🔴🔴 with NO IntersectionObserver everything is shown', () => {
    /* jsdom and old browsers take this path. "Slow but complete" beats "fast but
       most of the album is unreachable" — the same stance `useLazyReveal` took.
       Note this case runs with the fake DELETED, unlike its neighbours. */
    const { getAllByTestId } = render(<Harness total={REVEAL_CHUNK * 2} />);
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK * 2);
  });

  it('🔴 switching album resets the window', () => {
    /* Reusing a count from a previous album would show a long one cut short with
       a sentinel that never re-fires. */
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    const { getAllByTestId, rerender } = render(<Harness total={REVEAL_CHUNK * 3} />);
    act(() => fire?.([{ isIntersecting: true }]));
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK * 2);

    rerender(<Harness total={REVEAL_CHUNK * 4} />);
    expect(getAllByTestId('tile')).toHaveLength(REVEAL_CHUNK);
  });
});

describe('the detail dialog, same round', () => {
  const DETAIL_SRC = readFileSync(
    join(process.cwd(), 'components/object/gallery/StoredImageDetailModal.tsx'),
    'utf8',
  );

  it('⭐⭐ the detail LINK field is hidden', () => {
    expect(DETAIL_SRC).not.toContain("t('object_image.form_detail_link_label')");
  });

  it('🔴 but its value is still carried and still saved', () => {
    /* Hiding the input must not blank the stored link on the next save of every
       file that has one. The field stays in the form object. */
    expect(DETAIL_SRC).toContain('detail_link: string');
  });

  it('⭐⭐ the badge shows the file\'s detail text after the number', () => {
    /* [UI-20260907-RANKDETAIL] Five across leaves each picture too small to
       identify by sight, so the strip carries the detail the uploader typed.
       ⚠️ Only the DETAIL may be truncated — the number is in a `shrink-0` span,
          because a badge that cuts off "#1" has lost its whole point. */
    expect(MEDIA_STEP_SRC).toContain('{img.detail_text}');
    expect(MEDIA_STEP_SRC).toContain('<span className="shrink-0">#{index + 1}</span>');
    expect(MEDIA_STEP_SRC).toContain('min-w-0 truncate font-bold normal-case');
  });

  it('🔴 a file with no detail adds nothing — no stray separator', () => {
    /* Rendered conditionally rather than as `#1 · {detail ?? \'\'}`, which would
       leave a dangling gap on every file that has never been described. */
    expect(MEDIA_STEP_SRC).toContain('{img.detail_text ? (');
  });

  it('⭐⭐ the badge reads "#n", without the word RANK', () => {
    expect(DETAIL_SRC).toContain('`#${storage.priority}`');
    expect(DETAIL_SRC).not.toContain('Rank #');
    expect(MEDIA_STEP_SRC).not.toContain('RANK #');
  });
});

/* [FEAT-20260907-INLINEDETAIL] The caption can be edited from the tile itself. */
describe('editing the detail from the strip', () => {
  const INLINE_SRC = readFileSync(
    join(process.cwd(), 'components/object/gallery/StoredDetailInlineEdit.tsx'),
    'utf8',
  );
  const ACTIONS_SRC = readFileSync(
    join(process.cwd(), 'components/object/form/useGalleryActions.ts'),
    'utf8',
  );

  it('⭐⭐⭐ it saves through the SAME path the dialog uses', () => {
    /* One function, two callers. A second copy is where "the dialog refreshes
       the grid but the inline one does not" comes from: everything after the
       request — refetch, success alert, failure alert — has to stay shared. */
    expect(ACTIONS_SRC).toContain('const saveDetail = async (');
    expect(ACTIONS_SRC).toContain('const handleSaveImageDetail = async (): Promise<void> => saveDetail();');
    expect(MEDIA_STEP_SRC).toContain('gallery.saveDetail(img.id, { detail_text: text })');
  });

  it('🔴 the inline marker is NOT `editingImage`', () => {
    /* `editingImage` is what opens the full dialog. Reusing it would pop that
       dialog open at the same moment the inline field appeared. */
    expect(ACTIONS_SRC).toContain('const [inlineDetailId, setInlineDetailId]');
    expect(MEDIA_STEP_SRC).toContain('gallery.inlineDetailId === img.id');
  });

  it('🔴 the editor does not save by itself — it hands the text up', () => {
    expect(INLINE_SRC).not.toContain('imageStorageService');
    expect(INLINE_SRC).toContain('onSave: (text: string) => void');
  });

  it('🔴 Enter and Escape are stopped from reaching the album form', () => {
    /* This sits inside a real <form>; an unhandled Enter submits the ALBUM. */
    expect(INLINE_SRC).toContain("if (e.key === 'Enter')");
    expect(INLINE_SRC).toContain("if (e.key === 'Escape')");
    expect(INLINE_SRC).toContain('e.stopPropagation();');
  });

  it('🔴 the pencil is offered in update mode only', () => {
    /* Same rule as the pencil in the hover overlay — a read-only visit must not
       offer an edit that cannot be saved. */
    const at = MEDIA_STEP_SRC.indexOf('inline-detail-open-');
    expect(at).toBeGreaterThan(-1);
    expect(MEDIA_STEP_SRC.slice(at - 400, at)).toContain("resolvedMode === 'update'");
  });

  it('the draft stays inside the editor, not in the grid', () => {
    /* One keystroke re-rendering five columns of mounted <video> is a visible
       cost; the text only leaves this component on save. */
    expect(INLINE_SRC).toContain('const [draft, setDraft] = useState(initialText)');
    expect(MEDIA_STEP_SRC).not.toContain('setDraft');
  });
});
