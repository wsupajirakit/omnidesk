/**
 * [FIX-20260816-COPYHTTP] copyText — the three states that matter:
 *  1. secure context (clipboard API present) → uses it, true
 *  2. plain http (clipboard undefined — THE BUG this util exists for)
 *     → falls back to execCommand('copy'), true
 *  3. both paths dead → false (caller shows the failure toast)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { copyText } from '../utils/copyText';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('uses navigator.clipboard when available and resolves true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('THE BUG CASE: clipboard undefined (http) → still copies via execCommand', async () => {
    vi.stubGlobal('navigator', {}); // exactly what an http page sees
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    await expect(copyText('0955550010')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // the helper must clean up after itself — no stray textarea left behind
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('returns false when both paths fail — caller can say so', async () => {
    vi.stubGlobal('navigator', {});
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('denied');
    };
    await expect(copyText('x')).resolves.toBe(false);
  });

  // The legacy path APPENDS the textarea before it copies. When execCommand
  // throws, the removeChild never runs and the node is orphaned in the DOM —
  // one leaked hidden textarea per failed copy, silently, forever.
  it('LEAK CASE: execCommand throws → the textarea is still removed', async () => {
    vi.stubGlobal('navigator', {});
    (document as unknown as { execCommand: () => boolean }).execCommand = () => {
      throw new Error('denied');
    };
    const before = document.querySelectorAll('textarea').length;
    await expect(copyText('leak')).resolves.toBe(false);
    expect(document.querySelectorAll('textarea').length).toBe(before);
  });

  it('LEAK CASE: select() throws → the textarea is still removed', async () => {
    vi.stubGlobal('navigator', {});
    vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(() => {
      throw new Error('no focus');
    });
    (document as unknown as { execCommand: () => boolean }).execCommand = () => true;
    const before = document.querySelectorAll('textarea').length;
    await expect(copyText('leak2')).resolves.toBe(false);
    expect(document.querySelectorAll('textarea').length).toBe(before);
  });
});
