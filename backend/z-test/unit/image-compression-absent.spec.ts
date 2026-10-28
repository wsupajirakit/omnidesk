/**
 * [FIX-20260824-COMPRESSTRUTH] The 0.9 MB ceiling is advertised and not enforced.
 *
 * WHY THIS SPEC EXISTS: `compressImage`'s header used to say it "resizes/
 * compresses an image to stay under 0.9 MB", and nothing anywhere contradicted
 * it. `sharp` is not a dependency of this project, so the branch that would do
 * the work throws, the function turns that into `{ error }`, and BOTH callers
 * fold it into a size fallback — `processed.size || rawSize`. The result is a
 * stored row whose size matches the file on disk, which is honest, and a
 * codebase in which every reader believes a cap is being applied. It is not.
 *
 * These cases pin the reality, so the claim cannot drift back into the comment
 * and so that anyone who later installs `sharp` finds out here rather than in
 * production. They assert BEHAVIOUR, not the contents of package.json, except
 * for one deliberate tripwire that names the dependency directly.
 *
 * ⚠️ If these go red because `sharp` was added: that is a real decision, not a
 * broken test. Adding it changes the bytes handed to the QR pre-scan (whose
 * measured hit rate was taken on originals) and to the topup leg that
 * re-attaches the file. Update the header comment, re-measure the pre-scan, and
 * then flip these cases. Do not delete them.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compressImage } from '@/common/utils/image-processor';

const OVER_CAP = Math.ceil(0.9 * 1024 * 1024) + 1024; // just past 921,600
const UNDER_CAP = 1024;

const tmp = () => mkdtempSync(join(tmpdir(), 'imgproc-'));

function fileOfSize(bytes: number): string {
  const p = join(tmp(), 'x.jpg');
  writeFileSync(p, Buffer.alloc(bytes, 0x41));
  return p;
}

describe('[COMPRESSTRUTH] compression is advertised but does not run', () => {
  it('⭐ (T1) a file ABOVE the cap is NOT compressed — it fails, naming sharp', async () => {
    const p = fileOfSize(OVER_CAP);

    const result = await compressImage(p);

    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain('sharp');
    expect(result.processed).toBeUndefined();
  });

  it('⭐ (T2) that file is left on disk at its ORIGINAL size — no ceiling applied', async () => {
    const p = fileOfSize(OVER_CAP);

    await compressImage(p);

    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p).length).toBe(OVER_CAP);
  });

  it('(T3) a file BELOW the cap returns cleanly and never reaches sharp', async () => {
    // This half genuinely works: the early return happens before the require,
    // so small files were never depending on the missing package.
    const p = fileOfSize(UNDER_CAP);

    const result = await compressImage(p);

    expect(result).toEqual({ processed: false, size: UNDER_CAP });
    expect(result.error).toBeUndefined();
  });

  it('(T4) a missing file reports that, not a sharp problem — the guards are ordered', async () => {
    const result = await compressImage(join(tmp(), 'nope.jpg'));

    expect(String(result.error)).toContain('File not found');
    expect(String(result.error)).not.toContain('sharp');
  });

  it('(T5 TRIPWIRE) sharp is not a dependency — read the header before changing this', () => {
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const declared = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    expect({ sharpDeclared: 'sharp' in declared }).toEqual({
      sharpDeclared: false,
    });
  });

  it('(T6) the source no longer claims a ceiling it does not enforce', () => {
    // The lie was in the doc comment, so the fix is checkable there. The tag is
    // the anchor; the sentence around it may be reworded freely.
    const src = readFileSync(
      join(process.cwd(), 'src/common/utils/image-processor.ts'),
      'utf8',
    );

    expect(src).toContain('[FIX-20260824-COMPRESSTRUTH]');
    expect(src).toContain('THE COMPRESSION HALF NEVER');
  });
});
