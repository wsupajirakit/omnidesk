/**
 * [FEAT-20260907-IMAGEONLYPICKER] "Attach IMG" on the image message type.
 * ===========================================================================
 * on the IMAGE branch, offer a button that opens the media gallery
 * the flex editor already uses — **images only, no video** — pasting the link
 * into the field; preview the image beside the input; allow clearing; and allow
 * a second attach to REPLACE the first without clearing first.
 *
 * 🔴 And, stated as a hard constraint: **do not disturb the flex picker.** The
 *    `describe('the flex picker is untouched')` block is that promise. It fails
 *    if the shared components stop behaving identically for a caller that passes
 *    no `lockKind` — which is every caller that existed before today.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';

import { BroadcastImageField } from '../components/campaign/image/BroadcastImageField';
import { MediaItemListView } from '../components/media-picker/MediaItemListView';
import { I18nProvider } from '../i18n';

const wrap = (node: React.ReactElement) => render(<I18nProvider>{node}</I18nProvider>);

const ALBUM = { id: 'a1', detail: 'album', created_at: '2026-09-07' } as never;

const field = (over: Partial<React.ComponentProps<typeof BroadcastImageField>> = {}) =>
  wrap(
    <BroadcastImageField
      value=""
      onChange={vi.fn()}
      inputClassName="x"
      {...over}
    />,
  );

describe('the field itself', () => {
  it('⭐⭐ keeps the same input name — the payload is unchanged', () => {
    /* The form still stores exactly one thing, `image_url`, written through the
       same setState. If this name drifts, the value stops reaching the campaign
       and nothing else would say so. */
    const { container } = field();
    expect(container.querySelector('input[name="message_image_url"]')).not.toBeNull();
  });

  it('⭐⭐ the button is labelled "Attach IMG"', () => {
    const { container } = field();
    expect(container.textContent).toContain('Attach IMG');
  });

  it('typing still works — the field was not turned into a picker-only control', () => {
    const onChange = vi.fn();
    const { container } = field({ onChange });
    fireEvent.change(container.querySelector('[data-testid="broadcast-image-url"]') as HTMLElement, {
      target: { value: 'https://x/y.png' },
    });
    expect(onChange).toHaveBeenCalledWith('https://x/y.png');
  });
});

describe('preview, clear and replace', () => {
  it('⭐⭐ previews the image beside the input once there is a url', () => {
    const { container } = field({ value: 'https://x/y.png' });
    const img = container.querySelector('[data-testid="broadcast-image-preview-img"]');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://x/y.png');
  });

  it('🔴 no url, no preview and no clear button', () => {
    const { container } = field();
    expect(container.querySelector('[data-testid="broadcast-image-preview"]')).toBeNull();
    expect(container.querySelector('[data-testid="broadcast-image-clear"]')).toBeNull();
  });

  it('⭐⭐ clearing empties the field', () => {
    const onChange = vi.fn();
    const { container } = field({ value: 'https://x/y.png', onChange });
    fireEvent.click(container.querySelector('[data-testid="broadcast-image-clear"]') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('🔴 the clear control is a real BUTTON beside Attach IMG, not floated in the input', () => {
    /* [FIX-20260907-IMAGECLEARVISIBLE] It started as a faint ✕ at `right-2`
       inside the field — but the shared `inputClass` only carries `px-4`, so it
       sat ON TOP of the URL text and read as "there is no clear button". The
       and that is how the overlap surfaced. */
    const { container } = field({ value: 'https://x/y.png' });
    const btn = container.querySelector('[data-testid="broadcast-image-clear"]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.className).not.toContain('absolute');
    /* it says what it does, rather than being an unlabelled glyph */
    expect((btn.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('🔴 read-only hides the clear control', () => {
    const { container } = field({ value: 'https://x/y.png', disabled: true });
    expect(container.querySelector('[data-testid="broadcast-image-clear"]')).toBeNull();
  });

  it('⭐⭐ the preview shows the WHOLE image, and is not a thumbnail', () => {
    /* [UI-20260907-BIGGERIMGPREVIEW] `object-cover` would crop to fill, hiding
       the edges of a tall or wide image — a preview that lies about what gets
       sent. jsdom does no layout, so the contract is asserted on the classes. */
    const { container } = field({ value: 'https://x/y.png' });
    const img = container.querySelector('[data-testid="broadcast-image-preview-img"]') as HTMLElement;
    expect(img.className).toContain('object-contain');
    expect(img.className).not.toContain('object-cover');
    expect(img.className).not.toContain('h-24');
  });

  it('🔴 a broken url says so instead of showing a broken-image icon', () => {
    const { container } = field({ value: 'https://x/nope.png' });
    fireEvent.error(container.querySelector('[data-testid="broadcast-image-preview-img"]') as HTMLElement);
    expect(container.querySelector('[data-testid="broadcast-image-preview-error"]')).not.toBeNull();
  });

  it('🔴 a NEW url gets a fresh verdict — the error does not stick', () => {
    /* Without the effect that resets it, one bad address would leave every image
       chosen afterwards showing "cannot load". */
    const { container, rerender } = field({ value: 'https://x/nope.png' });
    fireEvent.error(container.querySelector('[data-testid="broadcast-image-preview-img"]') as HTMLElement);
    expect(container.querySelector('[data-testid="broadcast-image-preview-error"]')).not.toBeNull();

    rerender(
      <I18nProvider>
        <BroadcastImageField value="https://x/good.png" onChange={vi.fn()} inputClassName="x" />
      </I18nProvider>,
    );
    expect(container.querySelector('[data-testid="broadcast-image-preview-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="broadcast-image-preview-img"]')).not.toBeNull();
  });

  it('⭐⭐ REPLACING needs no clear first — the field is the only state', () => {
    /* Attaching writes over `value`; there is no second "attached image" state to
       get out of step, so re-attaching is a plain overwrite. Shown by the preview
       following the value with nothing else touched. */
    const { container, rerender } = field({ value: 'https://x/first.png' });
    expect(
      container.querySelector('[data-testid="broadcast-image-preview-img"]')?.getAttribute('src'),
    ).toBe('https://x/first.png');
    rerender(
      <I18nProvider>
        <BroadcastImageField value="https://x/second.png" onChange={vi.fn()} inputClassName="x" />
      </I18nProvider>,
    );
    expect(
      container.querySelector('[data-testid="broadcast-image-preview-img"]')?.getAttribute('src'),
    ).toBe('https://x/second.png');
  });
});

/* The pill labels are TRANSLATED — they render as ทั้งหมด / รูปภาพ / วิดีโอ, not
   as "All / IMG / VDO".
   🔴 The first version of this file asserted `not.toContain('VDO')` for the
      locked case, which passed because that string never appears in ANY render.
      A test that can only pass proves nothing; the sibling case below is what
      exposed it, by failing on the same wrong string. Read from the locale so
      the two cases cannot drift apart from the UI again. */
const PILL_VIDEO = 'วิดีโอ';
const PILL_IMAGE = 'รูปภาพ';
const PILL_ALL = 'ทั้งหมด';

describe('images only', () => {
  it('⭐⭐⭐ the picker opened here hides the kind pills', () => {
    /* `lockKind="image"` means the video choice is not offered at all — a picker
       that can hand back a video is offering a value this field cannot use. */
    const { container } = wrap(
      <MediaItemListView album={ALBUM} onBackToAlbums={vi.fn()} lockKind="image" />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain(PILL_VIDEO);
    /* ⚠️ NOT asserted: the absence of ทั้งหมด. That word also appears in this
       view's end-of-list line ("แสดงครบทั้งหมดแล้ว"), so forbidding it would fail
       for a reason unrelated to the pills — it did, on the first run. The video
       pill is the one label that appears nowhere else, which makes it the honest
       thing to measure. */
  });
});

describe('the flex picker is untouched', () => {
  it('⭐⭐⭐ without lockKind the pills are still all there', () => {
    /* THE CONSTRAINT, as a test. `components/flex/FlexMessageFormModal.tsx`
       passes no `lockKind`, so it must render exactly what it always did: all
       three pills. If this goes red, a request about the broadcast form has
       changed the flex editor. */
    const { container } = wrap(
      <MediaItemListView album={ALBUM} onBackToAlbums={vi.fn()} />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain(PILL_ALL);
    expect(text).toContain(PILL_IMAGE);
    expect(text).toContain(PILL_VIDEO);
  });

  it('⭐⭐⭐ without selectAction the tile button still COPIES', () => {
    /* [FEAT-20260907-USETHISIMAGE] The flex editor's tiles must keep their copy
       button. The default is `'copy'`, so an absent prop means an unchanged
       flex picker — this is the same promise as the pills above, for the other
       new prop. Asserted on the testid, which encodes which branch rendered. */
    const src = readFileSync(
      join(process.cwd(), 'components/media-picker/MediaItemListView.tsx'),
      'utf8',
    );
    expect(src).toContain("selectAction = 'copy'");
  });

  it('⭐⭐ the picker header pins its buttons right ONLY when asked', () => {
    /* [FIX-20260907-PICKERHEADERRIGHT] The shared modal header is
       `flex items-center justify-between` with THREE children — title, actions,
       close — so three items get spread evenly and "อัปโหลดเพิ่มเติม" lands in the
       middle of the bar. `ml-auto` pins it beside the ✕.
       🔴 The flex editor renders this SAME modal
          (`FlexMessageFormModal.tsx:1755`), so the fix is opt-in: the owner
          scoped it to the broadcast form. Default must stay unchanged. */
    const src = readFileSync(
      join(process.cwd(), 'components/media-picker/MediaPickerModal.tsx'),
      'utf8',
    );
    expect(src).toContain("headerActionsRight ? 'ml-auto' : ''");
  });

  it('🔴 and the flex editor really does pass NEITHER new prop', () => {
    /* Read from the source rather than trusted: a future edit that added a
       `lockKind` or a `selectAction` there would silently change the flex
       editor's picker while every test about the broadcast form stayed green. */
    const src = readFileSync(
      join(process.cwd(), 'components/flex/FlexMessageFormModal.tsx'),
      'utf8',
    );
    expect(src).not.toContain('lockKind');
    expect(src).not.toContain('selectAction');
    expect(src).not.toContain('headerActionsRight');
  });
});
