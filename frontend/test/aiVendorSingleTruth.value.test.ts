/**
 * [FIX-20260828-AIVENDORTRUTH] รายชื่อ AI vendor ต้องมีแหล่งเดียว
 * ===========================================================================
 * เจ้าของ 28/08: *"`AI_VENDORS` ต้องมี single truth (เหมือน modal edit/create)
 * ไม่งั้นมั่ว"*
 *
 * 🔴 ทำไมต้องมีเทสตัวนี้: การก๊อปรายชื่อไปวางในหน้าจอใหม่ **ไม่ทำให้อะไรพัง**
 *    ณ วันที่ก๊อป · มันจะพังวันที่เพิ่ม vendor ตัวที่สาม แล้วมีคนแก้แค่ที่เดียว
 *    ⇒ ไม่มีเทสไหนจับได้ เพราะทั้งสองที่ยัง "ถูก" ในวันที่เขียน
 *
 * มีสอง "แหล่ง" ที่ถูกต้องอยู่แล้ว และคนละหน้าที่กัน:
 *   · `types/hook.ts` — **type union** (`ai_vendor?: 'gemini' | 'deepseek' | null`)
 *   · `config/aiVendors.ts` — **รายการตอนรัน** ที่หน้าจอเอาไปวาดเมนู
 * ทั้งคู่ต้องตรงกันเสมอ แต่ TypeScript ตรวจให้ไม่ได้ (union ไม่มีอยู่ตอนรัน)
 * ⇒ เคสแรกของไฟล์นี้คือสิ่งเดียวที่จับ "เพิ่ม type แต่ลืมเพิ่มรายการ" ได้
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { AI_VENDORS, asAiVendor } from '../config/aiVendors';

const ROOT = join(__dirname, '..');

/**
 * ไฟล์ที่มีชื่อ vendor เป็นตัวอักษรได้ — และเหตุผลของแต่ละไฟล์
 * ⚠️ รายการนี้ **มีแต่หดได้** · เพิ่มชื่อเข้ามาเมื่อไหร่ = มีคนก๊อปรายชื่อไปวางอีกที่
 */
const ALLOWED = new Map<string, string>([
  [
    join('config', 'aiVendors.ts'),
    'แหล่งเดียวของรายการตอนรัน — ไฟล์นี้คือของจริง',
  ],
  [
    join('types', 'hook.ts'),
    'type union ที่ `config/aiVendors.ts` ผูกอยู่ · เป็นแหล่งของ "ชนิด" ไม่ใช่ของ "รายการ"',
  ],
  [
    join('pages', 'hook', 'WebhookLogs.tsx'),
    'คนละเรื่องกัน — ตัวกรอง `webhook_logs.log_source` ที่ BE เป็นคนเขียนค่า ' +
      'ไม่ใช่ค่า ai_vendor ของ hook · รายการนั้นมี line_api / telegram / customer_link ปนอยู่ด้วย',
  ],
]);

/* [FIX-20260830-VENDORSCANWT] the skip list also has to cover a git WORKTREE
   checked out inside the repo. `.worktrees/<lane>/` holds a second copy
   of every source file, so the walk found the vendor list twice and reported
   the lane's own copy as "a new file that copied the list". `dist` is matched
   by prefix for the same reason — a `dist.bak-*` folder is a build output too.
   revert: restore the plain includes() check below. */
const SKIP_DIRS = ['node_modules', '.git', 'test', '.worktrees'];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.includes(name) || name.startsWith('dist')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('[AIVENDORTRUTH] รายชื่อ vendor ประกาศได้ที่เดียว', () => {
  it('⭐⭐ 🔴 type union กับรายการตอนรัน ต้องตรงกันเป๊ะ', () => {
    const types = readFileSync(join(ROOT, 'types', 'hook.ts'), 'utf8');
    const line = types.split('\n').find((l) => l.includes('ai_vendor?:')) ?? '';
    const fromType = [...line.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]).sort();

    expect(fromType).toEqual(AI_VENDORS.map((v) => v.value).slice().sort());
  });

  it('⭐⭐ 🔴 ไม่มีไฟล์ใหม่ก๊อปรายชื่อ vendor ไปวาง', () => {
    const offenders = sourceFiles(ROOT)
      .map((f) => f.slice(ROOT.length + 1))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => {
        const src = readFileSync(join(ROOT, rel), 'utf8');
        return AI_VENDORS.some(
          (v) => src.includes(`'${v.value}'`) || src.includes(`"${v.value}"`),
        );
      });

    expect(offenders).toEqual([]);
  });

  it('⭐ ค่าที่ไม่รู้จักและค่าว่าง ⇒ null = ใช้ค่าเริ่มต้น ไม่ใช่ค่ามั่ว', () => {
    /* 🔴 `''` ต้องเป็น null ไม่ใช่ `''` — BE อ่าน null ว่า "ใช้ vendor ปริยาย"
       แต่จะปฏิเสธ `''` ว่าเป็น vendor ที่ไม่รู้จัก */
    expect(asAiVendor('')).toBeNull();
    expect(asAiVendor('openai')).toBeNull();
    expect(asAiVendor('GEMINI')).toBeNull();
  });

  it('⭐ ชื่อที่รู้จักผ่านตรงตัว', () => {
    for (const v of AI_VENDORS) expect(asAiVendor(v.value)).toBe(v.value);
  });
});
