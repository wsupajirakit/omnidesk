import { join } from 'path';

import {
  countAcross,
  filesContaining,
  tsFilesUnder,
} from '../lib/source-census';

const ROOT = join(__dirname, '../..');

/**
 * [PROG-20260905-CENSUSCONV] The multi-file census is about to become the fence behind
 * several owner-motivated rules, so it is proven before anything relies on it — including
 * proof that it can still go RED, which is the only property that makes a fence worth
 * keeping.
 */
describe('[PROG-20260905-CENSUSCONV] multi-file source census', () => {
  const doorPattern = /await this\.buildHookHelperFlexFor\(/g;
  const service = 'src/modules/webhook/webhook.service.ts';

  it('counts a pattern across several files', () => {
    const total = countAcross(ROOT, [service], doorPattern);
    expect(total).toBeGreaterThan(0);
  });

  it('GOES RED when a file that holds matches is left out of the list', () => {
    // The whole point: a shorter list must produce a smaller number, or the census would
    // silently pass while a door had moved somewhere nobody is looking.
    const withService = countAcross(ROOT, [service], doorPattern);
    const withoutService = countAcross(ROOT, [], doorPattern);
    expect(withoutService).toBeLessThan(withService);
    expect(withoutService).toBe(0);
  });

  it('names which files hold the pattern, so a failure says where to look', () => {
    expect(filesContaining(ROOT, [service], doorPattern)).toEqual([service]);
  });

  it('treats a role directory that does not exist yet as empty, not as an error', () => {
    // Census lists name directories LATER steps create. "Not yet" is never a defect, and
    // throwing here would make the fence fail for the one reason that cannot be a bug.
    expect(tsFilesUnder(ROOT, 'src/modules/webhook/not-created-yet')).toEqual(
      [],
    );
  });

  it('walks a role directory and finds its TypeScript files', () => {
    const files = tsFilesUnder(ROOT, 'src/modules/webhook/hook-reply');
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith('.ts'))).toBe(true);
    // Sorted, so a census list is stable between runs and a diff is readable.
    expect([...files].sort()).toEqual(files);
  });
});
