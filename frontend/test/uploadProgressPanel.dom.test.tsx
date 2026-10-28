/**
 * [FEAT-20260904-UPLOADPROGRESS] The panel an admin watches while a file uploads.
 * ===========================================================================
 * Four promises are pinned here, and every one of them is something a screenshot
 * of a working upload would NOT catch:
 *
 *  · a video is previewed as a PLAYER before the server has seen it, an image
 *    as a picture — from the kind, not from the filename
 *  · while shrinking there is NO bar, because there is no measurable progress
 *  · 100% says "finishing", not "done" — the server can still refuse the bytes
 *  · cancel ASKS FIRST, and the question is different for a video because what
 *    is thrown away is different (minutes of encoding, not a few seconds)
 *
 * ⚠️ `URL.createObjectURL` does not exist in jsdom and is stubbed. The revoke is
 * asserted too: one unreleased 50 MB clip per attempt is a tab that grows until
 * it is reloaded, and nothing on screen ever shows it.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadProgressPanel } from '../components/object/gallery/UploadProgressPanel';

const t = (k: string): string => k;
const revoke = vi.fn();

beforeEach(() => {
  revoke.mockClear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (f: File) => `blob:${f.name}`,
    revokeObjectURL: revoke,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const videoFile = (): File =>
  new File(['x'], 'clip.mp4', { type: 'video/mp4' });
const imageFile = (): File =>
  new File(['x'], 'photo.png', { type: 'image/png' });

const mount = (
  over: Partial<React.ComponentProps<typeof UploadProgressPanel>> = {},
): ReturnType<typeof render> =>
  render(
    <UploadProgressPanel
      file={videoFile()}
      kind="video"
      phase="uploading"
      percent={42}
      onCancel={vi.fn()}
      t={t}
      {...over}
    />,
  );

describe('[UPLOADPROGRESS] the preview before the server has the file', () => {
  it('🔴 a video is previewed as a player, from a local blob url', () => {
    /* 🔴 This is the "previewable before upload" requirement: the source is the
       picked File, so it works while the upload is still running — and before
       it starts at all. */
    mount();
    const player = screen.getByTestId('pending-video');
    expect(player).toHaveAttribute('src', 'blob:clip.mp4');
    expect(player).toHaveAttribute('controls');
    expect(screen.queryByTestId('pending-image')).toBeNull();
  });

  it('🔴 an image is previewed as a picture', () => {
    mount({ file: imageFile(), kind: 'image' });
    expect(screen.getByTestId('pending-image')).toHaveAttribute(
      'src',
      'blob:photo.png',
    );
    expect(screen.queryByTestId('pending-video')).toBeNull();
  });

  it('🔴 the blob url is released when the panel goes away', () => {
    /* 🔴 MUTATION KILLER. Nothing on screen changes when this leaks; the tab
       just grows by the size of every file the admin ever picked. */
    const view = mount();
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:clip.mp4');
  });

  it('the file name and its size are shown', () => {
    mount();
    expect(screen.getByTitle('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText(/MB/)).toBeInTheDocument();
  });
});

describe('[UPLOADPROGRESS] what the numbers are allowed to say', () => {
  it('🔴 no bar while shrinking — there is nothing to measure yet', () => {
    /* 🔴 MUTATION KILLER. A bar frozen at 0% for the two minutes a real-time
       video encode takes reads as a hung upload, and the admin cancels a job
       that was working. No request yet means no percentage; do not fake one. */
    mount({ phase: 'shrinking', percent: 0 });
    expect(screen.queryByTestId('upload-bar')).toBeNull();
    expect(
      screen.getByText('object_image.upload_phase_shrinking'),
    ).toBeInTheDocument();
  });

  it('shows the percentage while bytes are moving', () => {
    mount({ percent: 42 });
    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByTestId('upload-bar')).toHaveStyle({ width: '42%' });
  });

  it('🔴 100% says "finishing", never "done"', () => {
    /* 🔴 The bytes left the browser; the server can still answer 400 or 413.
       Declaring success at 100% is how an admin walks away from a refused file. */
    mount({ percent: 100 });
    expect(
      screen.getByText('object_image.upload_phase_finishing'),
    ).toBeInTheDocument();
    expect(screen.queryByText('100%')).toBeNull();
  });
});

describe('[UPLOADPROGRESS] cancel asks before it throws work away', () => {
  it('🔴 one press does NOT cancel — it asks', () => {
    /* 🔴 MUTATION KILLER. Wiring the button straight to `onCancel` passes every
       other case here and loses an admin's upload on a misclick. */
    const onCancel = vi.fn();
    mount({ onCancel });
    fireEvent.click(screen.getByTestId('upload-cancel'));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId('upload-cancel-yes')).toBeInTheDocument();
  });

  it('confirming cancels, and backing out leaves the upload alone', () => {
    const onCancel = vi.fn();
    mount({ onCancel });
    fireEvent.click(screen.getByTestId('upload-cancel'));
    fireEvent.click(screen.getByTestId('upload-cancel-no'));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('upload-cancel'));
    fireEvent.click(screen.getByTestId('upload-cancel-yes'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('🔴 the question tells a video admin what they actually lose', () => {
    /* 🔴 The two sentences are different on purpose: cancelling a video throws
       away minutes of encoding, cancelling an image throws away seconds. */
    mount({ kind: 'video' });
    fireEvent.click(screen.getByTestId('upload-cancel'));
    expect(
      screen.getByText('object_image.upload_cancel_confirm_video'),
    ).toBeInTheDocument();

    cleanup();
    mount({ file: imageFile(), kind: 'image' });
    fireEvent.click(screen.getByTestId('upload-cancel'));
    expect(
      screen.getByText('object_image.upload_cancel_confirm'),
    ).toBeInTheDocument();
  });

  it('no cancel button before the transfer has started', () => {
    /* During `shrinking` there is no request yet, so there is nothing to stop —
       offering a button that does nothing is worse than not offering one. */
    mount({ phase: 'shrinking', onCancel: undefined });
    expect(screen.queryByTestId('upload-cancel')).toBeNull();
  });
});
