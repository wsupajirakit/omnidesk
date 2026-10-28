/* [FE] [FEAT-20260816-MULTIIMG] — the staged-images tray above the composer.
 *
 * Rules pinned:
 *   1. renders one thumbnail per staged image, in order, with the n/5 counter
 *   2. each thumbnail's ✕ removes THAT image (index passed out, state stays in
 *      the composer — this component owns no state)
 *   3. clicking a thumbnail asks for the zoom preview of THAT url
 *   4. an empty tray renders nothing at all
 *
 * revert: delete together with components/chat/PendingImagesTray.tsx.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import PendingImagesTray from '../components/chat/PendingImagesTray';

const items = [
  { url: 'blob:one' },
  { url: 'blob:two' },
  { url: 'blob:three' },
];

describe('PendingImagesTray', () => {
  it('renders one thumbnail per image, in order, with the counter', () => {
    render(
      <PendingImagesTray items={items} max={5} onRemove={() => {}} onPreview={() => {}} />,
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(3);
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      'blob:one',
      'blob:two',
      'blob:three',
    ]);
    expect(screen.getByText(/3\/5/)).toBeTruthy();
    expect(screen.getByText(/สูงสุด 5 รูป/)).toBeTruthy();
  });

  it('✕ removes the RIGHT image — index goes out, no state in here', () => {
    const onRemove = vi.fn();
    render(
      <PendingImagesTray items={items} max={5} onRemove={onRemove} onPreview={() => {}} />,
    );
    fireEvent.click(screen.getByLabelText('ลบรูปที่ 2'));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('clicking a thumbnail previews THAT url', () => {
    const onPreview = vi.fn();
    render(
      <PendingImagesTray items={items} max={5} onRemove={() => {}} onPreview={onPreview} />,
    );
    fireEvent.click(screen.getAllByRole('img')[2]);
    expect(onPreview).toHaveBeenCalledWith('blob:three');
  });

  it('empty tray renders nothing', () => {
    const { container } = render(
      <PendingImagesTray items={[]} max={5} onRemove={() => {}} onPreview={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
