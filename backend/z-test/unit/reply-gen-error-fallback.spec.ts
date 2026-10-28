/**
 * [FEAT-20260823-GENERRFALLBACK] Gemini error answers with the not-found
 * default when the OA never wrote a dedicated AI-down line.
 *
 * Owner, 23/08 (after the allingame 429 went silent): "ถ้า gemini error อีก
 * ให้ใช้ค่าจาก fe label 'ข้อความตอบกลับเริ่มต้น (กรณีไม่พบคำตอบ)' …
 * ให้ webhook ใช้ตอน gemini error" — that label is `hooks.default_answer_text`
 * (th.json:498 → HookAiTab:964 → hooks.service:1221).
 *
 * THE PROOF SHAPE — a fixture of all 1,920 resolver input combinations was
 * captured from the code BEFORE the change (resolver-before-20260823.json).
 * This spec replays every cell and asserts:
 *   · cells the order did NOT touch are byte-identical to the capture, and
 *   · the ONLY cells allowed to differ are generative errors where the OA has
 *     no gen-error line but does have a default — silence → the default.
 * Run against the pre-change code, the changed-cell block goes red (that is
 * the before-proof); after the one-line change, everything is green.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isGenerativeError,
  resolveReplyText,
} from '@/modules/webhook/ai-reply/ai-reply.provider';

interface Cell {
  in: {
    text: string | null;
    tagStatus: 'found' | 'not_found' | null;
    noData: boolean;
    http_status: number | null;
    error_message: string | null;
    gen: string | null | undefined;
    def: string | null | undefined;
  };
  out: string | null;
}

const cells = JSON.parse(
  readFileSync(
    join(process.cwd(), 'z-test/fixtures/resolver-before-20260823.json'),
    'utf8',
  ),
) as Cell[];

const replay = (c: Cell): string | null =>
  resolveReplyText(
    {
      text: c.in.text,
      tagStatus: c.in.tagStatus,
      noData: c.in.noData,
      http_status: c.in.http_status,
      error_message: c.in.error_message,
    },
    c.in.def,
    c.in.gen,
  );

/** the one behaviour the owner ordered — and nothing else */
const isTheOrderedChange = (c: Cell): boolean =>
  isGenerativeError({
    http_status: c.in.http_status,
    error_message: c.in.error_message,
  }) &&
  !c.in.gen &&
  !!c.in.def;

describe('⭐⭐ parity — 1,920 cells against the pre-change capture', () => {
  it('has the full capture', () => {
    expect(cells.length).toBe(1920);
  });

  it('⭐ every cell OUTSIDE the ordered change is byte-identical to before', () => {
    const diffs: string[] = [];
    for (const c of cells) {
      if (isTheOrderedChange(c)) continue;
      const now = replay(c);
      if (now !== c.out)
        diffs.push(`${JSON.stringify(c.in)}: ${c.out} → ${now}`);
    }
    expect(diffs).toEqual([]);
  });

  it('⭐⭐ the ordered cells — silence becomes the default answer, exactly there', () => {
    /* BEFORE the fix these all answered null (that is what the capture holds);
       the order says they answer the OA's default_answer_text instead. */
    const changed = cells.filter(isTheOrderedChange);
    expect(changed.length).toBeGreaterThan(0);
    for (const c of changed) {
      expect(c.out).toBeNull(); // what shipped until today — the silence
      expect(replay(c)).toBe(c.in.def); // what the owner ordered
    }
  });
});

describe('⭐ the precedence the note promises', () => {
  const genErr = {
    text: 'x',
    tagStatus: null,
    noData: false,
    http_status: 429,
    error_message: 'cap',
  } as never;

  it('⭐ a dedicated AI-down line still wins over the default, always', () => {
    expect(resolveReplyText(genErr, 'ไม่พบคำตอบ', 'AIล่ม')).toBe('AIล่ม');
  });

  it('⭐ both empty = silence — an OA that chose quiet keeps it', () => {
    expect(resolveReplyText(genErr, null, null)).toBeNull();
    expect(resolveReplyText(genErr, '', '')).toBeNull();
    expect(resolveReplyText(genErr, undefined, undefined)).toBeNull();
  });

  it('the allingame row, replayed: 429 + no gen line + a default → the default', () => {
    expect(
      resolveReplyText(genErr, 'ไม่พบคำตอบค่ะ ติดต่อแอดมินได้เลย', null),
    ).toBe('ไม่พบคำตอบค่ะ ติดต่อแอดมินได้เลย');
  });
});
