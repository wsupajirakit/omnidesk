/**
 * [FEAT-20260907-CLONETEMPLATEBTN] "copy แม่แบบ" — one button, two views.
 * ===========================================================================
 * Owner, 07/09, three things that pull against each other:
 *   1. the table's ⧉ icon must show its label
 *   2. the carousel needs the same action, on the RIGHT, with the tag's Copy
 *      button moved to sit beside the tag
 *   3. *"reuse it, do not duplicate — that breaks the rule"*, and *"watch the
 *      scale and the right-alignment, they are NOT the same in the two views"*
 *
 * So most of this file is about the reuse holding, not about the button working.
 * A second look-alike button would pass every behaviour test and still be the
 * thing the owner said not to build.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import React from 'react';

import { FlexCloneTemplateButton } from '../components/flex/FlexCloneTemplateButton';
import { FlexCardCarousel } from '../components/flex/carousel/FlexCardCarousel';
import { I18nProvider } from '../i18n';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
const PAGE = read('pages/content/FlexMessageList.tsx');
const CAROUSEL = read('components/flex/carousel/FlexCardCarousel.tsx');
const BUTTON = read('components/flex/FlexCloneTemplateButton.tsx');

const wrap = (node: React.ReactElement) =>
  render(<I18nProvider>{node}</I18nProvider>);

const ITEMS = [
  { id: 'a1', name: 'promo', tag: 'flex_m00028', content_json: {} },
];

describe('the button itself', () => {
  it('⭐⭐ says what it does and calls back', () => {
    const onClick = vi.fn();
    const { container } = wrap(<FlexCloneTemplateButton onClick={onClick} />);
    const btn = container.querySelector('[data-testid="flex-clone-template"]') as HTMLElement;
    expect(btn.textContent).toContain('แม่แบบ');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('🔴 type="button" — the flex page wraps its filters in a real <form>', () => {
    const { container } = wrap(<FlexCloneTemplateButton onClick={vi.fn()} />);
    const btn = container.querySelector('[data-testid="flex-clone-template"]') as HTMLButtonElement;
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('⭐⭐ the two scales really differ — the owner flagged this', () => {
    const md = wrap(<FlexCloneTemplateButton onClick={vi.fn()} size="md" />);
    const sm = wrap(<FlexCloneTemplateButton onClick={vi.fn()} size="sm" />);
    const cls = (r: ReturnType<typeof wrap>) =>
      (r.container.querySelector('[data-testid="flex-clone-template"]') as HTMLElement).className;
    expect(cls(md)).not.toBe(cls(sm));
    /* and the icon does too, which is the part a class diff alone would miss */
    const size = (r: ReturnType<typeof wrap>) =>
      r.container.querySelector('svg')?.getAttribute('width');
    expect(size(md)).not.toBe(size(sm));
  });

  it('🔴 positions NOTHING itself — alignment belongs to the parent', () => {
    /* In the table it is one of a right-aligned icon cluster; in the carousel it
       is pushed away from the tag. A margin of its own would be wrong in one of
       the two. This is the failure the owner warned about, stated as a test.
       ⚠️ Asserted on the RENDERED class list, not on the file text: the file's own
          header explains why there is no `ml-auto`, so a source-text search finds
          the word in a comment and fails for the wrong reason. It did, on the
          first run of this case. */
    const both = (['sm', 'md'] as const).map(size => {
      const { container } = wrap(<FlexCloneTemplateButton onClick={vi.fn()} size={size} />);
      return (container.querySelector('[data-testid="flex-clone-template"]') as HTMLElement)
        .className;
    });
    for (const cls of both) {
      expect(cls).not.toContain('ml-auto');
      expect(cls).not.toContain('mr-auto');
      expect(cls).not.toContain('justify-end');
      expect(cls).not.toContain('absolute');
    }
  });

  it('a caller can still position it', () => {
    const { container } = wrap(
      <FlexCloneTemplateButton onClick={vi.fn()} className="ml-auto" />,
    );
    const btn = container.querySelector('[data-testid="flex-clone-template"]') as HTMLElement;
    expect(btn.className).toContain('ml-auto');
  });
});

describe('reuse — the rule the owner named', () => {
  it('⭐⭐ BOTH views go through the shared component', () => {
    expect(PAGE).toContain('FlexCloneTemplateButton');
    expect(CAROUSEL).toContain('FlexCloneTemplateButton');
  });

  it('🔴 neither view hand-rolls its own clone button', () => {
    /* The old table markup was `<Copy size={16} />` inside a bare <button> with
       `title={t('common.clone')}`. If that shape comes back anywhere, the two
       buttons have started to drift — which is exactly what was forbidden. */
    expect(PAGE).not.toContain("title={t('common.clone')}");
  });

  it('🔴 the carousel imports the FILE, not the barrel (that would be a cycle)', () => {
    /* `components/flex/index.ts` re-exports `./carousel`, so importing the
       barrel from inside the carousel closes a loop. */
    expect(CAROUSEL).toContain("from '../FlexCloneTemplateButton'");
    expect(CAROUSEL).not.toMatch(/from '\.\.\/index'/);
  });

  it('⭐⭐ the page WIRES the carousel — the prop is optional, so this is the guard', () => {
    /* `onCloneCard` is optional so the older carousel tests keep compiling. The
       price is that forgetting to pass it loses the button silently — TypeScript
       will not say a word. This is the case that notices.
       🔴 The first version searched for the bare string `onCloneCard`, and a
          mutation that renamed the prop to `onCloneCardDISABLED` SURVIVED: the
          rename still contains the substring. Matching the JSX assignment is what
          makes this a real guard. */
    expect(PAGE).toMatch(/\bonCloneCard=\{/);
    expect(PAGE).toContain('openClone(found)');
  });
});

describe('the carousel footer', () => {
  it('⭐⭐ the tag\'s Copy sits BESIDE the tag, the clone button on the right', () => {
    const { container } = wrap(
      <FlexCardCarousel
        items={ITEMS}
        onEdit={vi.fn()}
        onCopyTag={vi.fn()}
        onCloneCard={vi.fn()}
        emptyText="empty"
      />,
    );
    const clone = container.querySelector('[data-testid="flex-clone-template"]') as HTMLElement;
    expect(clone).not.toBeNull();
    /* the parent, not the button, does the pushing */
    expect(clone.className).toContain('ml-auto');
  });

  it('🔴 the tag no longer eats the row', () => {
    /* `flex-1` on the tag span is what pushed Copy to the far edge — the layout
       being undone. If it comes back, Copy leaves the tag's side again. */
    const footer = CAROUSEL.slice(CAROUSEL.indexOf('UI-20260907-CAROUSELFOOTER'));
    expect(footer).not.toContain('min-w-0 flex-1 overflow-x-auto');
  });

  it('clicking it hands the card id back to the page', () => {
    const onCloneCard = vi.fn();
    const { container } = wrap(
      <FlexCardCarousel
        items={ITEMS}
        onEdit={vi.fn()}
        onCopyTag={vi.fn()}
        onCloneCard={onCloneCard}
        emptyText="empty"
      />,
    );
    fireEvent.click(container.querySelector('[data-testid="flex-clone-template"]') as HTMLElement);
    expect(onCloneCard).toHaveBeenCalledWith('a1');
  });

  it('🔴 a tile with no tag still shows the clone button', () => {
    /* The whole footer row used to be gated on `item.tag`. Menu cards with no
       minted tag would have lost the new button entirely. */
    const { container } = wrap(
      <FlexCardCarousel
        items={[{ id: 'b2', name: 'no tag', content_json: {} }]}
        onEdit={vi.fn()}
        onCopyTag={vi.fn()}
        onCloneCard={vi.fn()}
        emptyText="empty"
      />,
    );
    expect(container.querySelector('[data-testid="flex-clone-template"]')).not.toBeNull();
  });

  it('and draws nothing extra when the page passes no handler', () => {
    const { container } = wrap(
      <FlexCardCarousel
        items={[{ id: 'b2', name: 'no tag', content_json: {} }]}
        onEdit={vi.fn()}
        onCopyTag={vi.fn()}
        emptyText="empty"
      />,
    );
    expect(container.querySelector('[data-testid="flex-clone-template"]')).toBeNull();
  });
});
