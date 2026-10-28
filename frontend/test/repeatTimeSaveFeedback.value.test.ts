/**
 * [FIX-2708-REPEATSAVEFB] Saving a repeat time must do something visible.
 * ===========================================================================
 * Reported from the stg screen on 27/08: pressing save changed nothing on
 * screen. The old `saveRepeatTime` did fire a real PUT and patched state in
 * memory, but:
 *   · never closed the modal   -> no sign the work finished
 *   · never re-fetched         -> the row still showed the old next_run_at
 *   · never reported an outcome -> success and failure looked identical
 *
 * These cases pin the three things that must happen after a successful save,
 * and pin that a FAILURE must leave the modal open (closing it while nothing
 * was stored tells the user it saved).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'pages', 'messaging', 'Broadcasts.tsx'),
  'utf8',
);

/** The whole body of saveRepeatTime. */
const body = (): string => {
  const at = SRC.indexOf('const saveRepeatTime');
  expect(at, 'saveRepeatTime must exist').toBeGreaterThan(-1);
  const end = SRC.indexOf('\n  const toggleRepeat', at);
  expect(end).toBeGreaterThan(at);
  return SRC.slice(at, end);
};

describe('[REPEATSAVEFB] saving a repeat time reaches the screen', () => {
  it('success -> re-fetch the table, close the modal, report success', () => {
    const fn = body();
    expect(fn, 'must re-fetch so next_run_at on the row is the server value').toMatch(/fetchItems\(\)/);
    expect(fn, 'must close the modal').toMatch(/setRepeatModal\(null\)/);
    expect(fn, 'must report the outcome').toMatch(/showAlert\(/);
  });

  it('failure -> keep the modal open and say it failed', () => {
    const fn = body();
    const catchAt = fn.indexOf('} catch');
    const finallyAt = fn.indexOf('} finally');
    expect(catchAt).toBeGreaterThan(-1);
    const catchBlock = fn.slice(catchAt, finallyAt > catchAt ? finallyAt : undefined);
    expect(catchBlock, 'catch must alert').toMatch(/showAlert\(/);
    expect(catchBlock, 'catch must not close the modal').not.toMatch(/setRepeatModal\(null\)/);
  });

  it('close/re-fetch come AFTER the awaited save, never before', () => {
    const fn = body();
    const put = fn.indexOf('updateBroadcast');
    const close = fn.indexOf('setRepeatModal(null)');
    expect(put).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(put);
  });
});
