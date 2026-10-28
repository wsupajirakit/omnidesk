/**
 * [FEAT-20260907-BCASTNAMECELL] The name column is capped, and the full name is
 * still reachable.
 * ===========================================================================
 * Owner, 07/09: one long campaign name widened the name column for every row and
 * pushed the columns after it off the screen. The name gets about two thirds of
 * the room it used to take, and an info button after it opens the whole string.
 *
 * 🔴 THE ID ROW BELOW IS A DIFFERENT THING. `JobIdCell` renders the job id with
 *    its own copy and info buttons directly underneath. The owner said on 07/09
 *    that those are unrelated. Two cases here exist only to prove they were not
 *    touched and were not merged into one control.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

import {
  BroadcastNameCell,
  BROADCAST_NAME_MAX_CH,
  isNameTruncated,
} from '../components/messaging';
import { I18nProvider } from '../i18n';

const SHORT = 'promo';
/* The shape the owner was actually looking at when they asked for this. */
const LONG = 'FLOWTEST broadcast การ์ด site rule (dev-rule) 13:34:20';

const wrap = (node: React.ReactElement) =>
  render(<I18nProvider>{node}</I18nProvider>);

describe('the cap', () => {
  it('is a real number, not a feeling', () => {
    expect(BROADCAST_NAME_MAX_CH).toBeGreaterThan(0);
  });

  it('⭐⭐ the owner\'s own long name is over the cap', () => {
    /* If this ever goes green-by-accident because the cap was widened past the
       names in the list, the feature has quietly stopped doing anything. */
    expect(LONG.length).toBeGreaterThan(BROADCAST_NAME_MAX_CH);
    expect(isNameTruncated(LONG)).toBe(true);
  });

  it('a short name is not truncated', () => {
    expect(isNameTruncated(SHORT)).toBe(false);
  });

  it('🔴 whitespace does not push a short name over the line', () => {
    /* `'  promo  '.length` beats a tight cap while the visible text does not. */
    expect(isNameTruncated(`   ${SHORT}   `)).toBe(false);
  });

  it('exactly at the cap is NOT truncated — the boundary is inclusive', () => {
    expect(isNameTruncated('x'.repeat(BROADCAST_NAME_MAX_CH))).toBe(false);
    expect(isNameTruncated('x'.repeat(BROADCAST_NAME_MAX_CH + 1))).toBe(true);
  });
});

describe('what is rendered', () => {
  it('⭐⭐ the full name is in the DOM — the cut is CSS, not a substring', () => {
    /* Cutting the string in JS would make the name unsearchable and would break
       copy/paste out of the table. The browser does the eliding. */
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={vi.fn()} />);
    const el = container.querySelector('[data-testid="bcast-name-text"]');
    expect(el?.textContent).toBe(LONG);
  });

  it('the cap is applied as a max-width in ch', () => {
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={vi.fn()} />);
    const el = container.querySelector('[data-testid="bcast-name-text"]') as HTMLElement;
    expect(el.style.maxWidth).toBe(`${String(BROADCAST_NAME_MAX_CH)}ch`);
    expect(el.className).toContain('truncate');
  });

  it('the hover title carries the whole name', () => {
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={vi.fn()} />);
    expect(
      container.querySelector('[data-testid="bcast-name-text"]')?.getAttribute('title'),
    ).toBe(LONG);
  });
});

describe('the info button', () => {
  it('⭐⭐ appears for a long name and asks the PAGE to show it', () => {
    const onShowFull = vi.fn();
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={onShowFull} />);
    const btn = container.querySelector('[data-testid="bcast-name-info"]') as HTMLElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowFull).toHaveBeenCalledTimes(1);
  });

  it('🔴 is NOT shown when the name already fits', () => {
    /* A button that opens a dialog showing what is already on screen is noise. */
    const { container } = wrap(<BroadcastNameCell name={SHORT} onShowFull={vi.fn()} />);
    expect(container.querySelector('[data-testid="bcast-name-info"]')).toBeNull();
  });

  it('🔴 does not submit anything — type="button"', () => {
    /* The table sits inside a page with forms; a default-type button submits. */
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={vi.fn()} />);
    const btn = container.querySelector('[data-testid="bcast-name-info"]') as HTMLButtonElement;
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('is reachable without a mouse', () => {
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={vi.fn()} />);
    const btn = container.querySelector('[data-testid="bcast-name-info"]') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });

  it('🔴 the cell renders NO id, NO copy button and NO second info', () => {
    /* Owner, 07/09: the id row and its buttons are unrelated and must not be
       absorbed into this one. `JobIdCell` stays a separate component rendered by
       the page; if it ever gets pulled in here, this goes red. */
    const { container } = wrap(<BroadcastNameCell name={LONG} onShowFull={vi.fn()} />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelector('code')).toBeNull();
  });
});
