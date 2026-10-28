/**
 * [FIX-20260905-LINELOGO] One LINE mark, one set of contact helpers.
 *
 * ## 🔴 THE DUPLICATE HAD ALREADY DRIFTED — this is not a hypothetical
 * `LineLogoIcon` was declared twice, and the two drew DIFFERENT logos:
 *
 *   `components/chat/ChatRoomView.tsx`      `<text>LINE</text>`   ← the fix
 *   `components/member/PersonalPanel.tsx`   four letter `<path>`s ← pre-fix
 *
 * `[FIX-20260731-LINENAME]` corrected the wordmark on 31/07 because *"path
 * ตัวอักษรวาดออกมาไม่เป็นคำว่า LINE"*, and it reached ONE of the two. The room
 * header and the customer panel have been drawing different marks ever since,
 * and nothing in the suite noticed.
 *
 * The same shape produced today's other findings: three copies of a path reader
 * on the back end, and a blob-mapping module nothing rendered. A copy is only
 * safe while something measures it.
 * ก๊อปไว้สองที่ = แก้ที่เดียวแล้วอีกที่ค้าง · ต้องมีตัวนับ
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

const ROOT = join(__dirname, '..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'test', 'todo']);

/** Every source file under the repo, excluding build output and the tests. */
function sources(dir = ROOT, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const FILES = sources();

/** Declarations only — an import or a JSX use must not count as a definition. */
const definitionsOf = (name: string): string[] =>
  FILES.filter((f) => {
    const src = readFileSync(f, 'utf8');
    return (
      new RegExp(`^\\s*(export\\s+)?const ${name}\\s*[:=]`, 'm').test(src) ||
      new RegExp(`^\\s*(export\\s+)?function ${name}\\s*\\(`, 'm').test(src)
    );
  }).map((f) => f.slice(ROOT.length + 1));

describe('[LINELOGO] the mark and the contact helpers are defined once each', () => {
  it('⭐ exactly ONE LineLogoIcon, and it is the shared one', () => {
    expect(definitionsOf('LineLogoIcon')).toEqual([
      'components/common/LineLogoIcon.tsx',
    ]);
  });

  it('⭐ it is the CORRECTED wordmark, not the letter paths', () => {
    // If someone restores the path version, the panel silently goes back to a
    // logo that does not read as LINE — the exact regression this file records.
    const src = readFileSync(
      join(ROOT, 'components/common/LineLogoIcon.tsx'),
      'utf8',
    );
    expect(src).toContain('>\n      LINE\n    </text>');
    expect(src).not.toContain('M8.7 8.34H7.66v4.31H8.7V8.34z');
  });

  it('⭐ getCustomerPhone and parseCustomerDetail are defined once each', () => {
    expect(definitionsOf('getCustomerPhone')).toEqual([
      'components/common/customerDetail.ts',
    ]);
    expect(definitionsOf('parseCustomerDetail')).toEqual([
      'components/common/customerDetail.ts',
    ]);
  });

  it('the census actually walked the repo — not an empty list agreeing with itself', () => {
    // A broken walk would make every case above compare [] to [] and pass.
    expect(FILES.length).toBeGreaterThan(200);
    expect(definitionsOf('PersonalPanelNarrow')).toEqual([
      'components/profile-panel/ProfilePanel.tsx',
    ]);
  });
});
