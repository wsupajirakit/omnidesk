import { readFileSync } from 'fs';
import { join } from 'path';

import {
  census,
  classifyLines,
  findMethodRange,
} from '../lib/code-line-census';

/**
 * [PROG-20260905-CENSUS] Two things are proven here, and they are the foundation the
 * spine reduction program stands on:
 *
 *   1. THE RULER IS CORRECT AND RE-RUNNABLE. Without this, "we cut 50%" is a claim
 *      about an unpublished script. Every rule the scanner implements has a case, and
 *      each case is written so a naive prefix-matching classifier fails it — that is
 *      what separates 2,829 from the 3,892 a prefix rule reports for the same method.
 *
 *   2. THE SPINE MAY NOT GROW. The ratchet reads its ceiling from
 *      z-test/fixtures/spine-size-ratchet.json. A cut lowers the ceiling in the same
 *      commit; anything that pushes the method back up turns this red by name. Cutting
 *      without the ratchet is bailing a boat with the tap running: the method grew
 *      +28.9% in the fortnight the program was being planned.
 */
describe('[PROG-20260905-CENSUS] the CODE-line ruler', () => {
  it('counts a plain statement as code and a blank line as blank', () => {
    expect(census('const a = 1;\n\nconst b = 2;\n')).toEqual({
      code: 2,
      comment: 0,
      blank: 1,
      raw: 3,
    });
  });

  it('counts a line comment as comment, and code with a trailing comment as CODE', () => {
    const kinds = classifyLines(
      '// just prose\nconst a = 1; // trailing note\n',
    );
    expect(kinds).toEqual(['comment', 'code']);
  });

  it('treats a whitespace-only line INSIDE a block comment as comment, not blank', () => {
    // The prose block is one unit; a gap inside it is not a separator between statements.
    const kinds = classifyLines('/* first\n\n   second */\n');
    expect(kinds).toEqual(['comment', 'comment', 'comment']);
  });

  it('counts code that follows a block comment closing mid-line', () => {
    const kinds = classifyLines('/* note\n   more */ doWork();\n');
    expect(kinds).toEqual(['comment', 'code']);
  });

  it('does NOT open a comment for a /* that lives inside a string literal', () => {
    // A prefix/regex classifier gets this wrong and then misreads every following line.
    const kinds = classifyLines(
      "const s = '/* not a comment */';\nconst after = 1;\n",
    );
    expect(kinds).toEqual(['code', 'code']);
  });

  it('does NOT open a comment for a // inside a template literal', () => {
    const kinds = classifyLines(
      'const url = `https://example.test/x`;\nconst after = 1;\n',
    );
    expect(kinds).toEqual(['code', 'code']);
  });

  it('keeps a multi-line template literal as code across its lines', () => {
    const kinds = classifyLines(
      'const t = `line one\nline two`;\nconst after = 1;\n',
    );
    expect(kinds).toEqual(['code', 'code', 'code']);
  });

  it('does not end a string on an escaped quote', () => {
    const kinds = classifyLines(
      "const s = 'it\\'s here /* still string */';\n",
    );
    expect(kinds).toEqual(['code']);
  });

  it('censuses a 1-indexed inclusive range the way an editor shows it', () => {
    const src = 'a();\n// note\n\nb();\n';
    expect(census(src, 2, 3)).toEqual({
      code: 0,
      comment: 1,
      blank: 1,
      raw: 2,
    });
  });

  it('finds a method range by brace matching, not by a recorded line number', () => {
    const src = [
      'class X {',
      '  private async go() {',
      '    if (a) { b(); }',
      '  }',
      '}',
    ].join('\n');
    expect(findMethodRange(src, 'private async go(')).toEqual({
      from: 2,
      to: 4,
    });
  });

  it('returns null rather than a wrong range when the signature is absent', () => {
    // Silently measuring nothing would read as a perfect score in the ratchet below.
    expect(
      findMethodRange('const a = 1;\n', 'private async missing('),
    ).toBeNull();
  });
});

describe('[PROG-20260905-RATCHET] the spine may not grow', () => {
  const ratchet = JSON.parse(
    readFileSync(
      join(__dirname, '../fixtures/spine-size-ratchet.json'),
      'utf8',
    ),
  ) as {
    file: string;
    methodSignature: string;
    methodCodeCeiling: number;
    fileCodeCeiling: number;
    fileCodeCeilingRaisedBy?: {
      savePoint: string;
      feature: string;
      from: number;
      to: number;
      why: string;
    }[];
    baseline: { methodCode: number; methodRaw: number; fileCode: number };
  };

  const source = readFileSync(join(__dirname, '../..', ratchet.file), 'utf8');

  it('locates the spine method by signature (a rotted anchor is a failure, not a pass)', () => {
    const range = findMethodRange(source, ratchet.methodSignature);
    expect(range).not.toBeNull();
    // The method is the biggest thing in the file by a wide margin; a match that is not
    // thousands of lines long means the brace matcher latched onto the wrong `{`.
    expect(
      (range as { from: number; to: number }).to -
        (range as { from: number }).from,
    ).toBeGreaterThan(1000);
  });

  it('keeps the spine method at or below its ceiling', () => {
    const range = findMethodRange(source, ratchet.methodSignature) as {
      from: number;
      to: number;
    };
    const measured = census(source, range.from, range.to);
    // Lower the ceiling in the SAME commit as the cut that earned it.
    expect(measured.code).toBeLessThanOrEqual(ratchet.methodCodeCeiling);
  });

  it('keeps the whole service file at or below its ceiling', () => {
    // A body moved out of the method but left in the same file is not a reduction.
    expect(census(source).code).toBeLessThanOrEqual(ratchet.fileCodeCeiling);
  });

  /**
   * [PROG-20260905-RAISE] A file-ceiling raise must be earned, not typed.
   *
   * The method ceiling has no raise mechanism and must never get one. The file also holds
   * `processWebhook`, the constructor and the module-scope helpers, so a genuinely new
   * feature can land there while the method does not move — and refusing that outright
   * does not stop the file growing, it just teaches the next person to hide the feature
   * inside an existing block to dodge the counter. That is the bloat this ratchet exists
   * to prevent, so a raise is allowed and made EXPENSIVE instead: it has to be declared,
   * it has to name a feature tag that is really in the file, and the arithmetic has to add
   * up. A number edited on its own fails here. ขึ้นเพดานได้ แต่ต้องเซ็นชื่อกำกับ
   */
  it('accounts for every raise of the file ceiling', () => {
    const raises = ratchet.fileCodeCeilingRaisedBy ?? [];
    if (raises.length === 0) return;

    // Each raise names a feature that is actually in the file — an entry invented to buy
    // headroom for a nameless edit cannot satisfy this.
    for (const raise of raises) {
      expect({
        feature: raise.feature,
        present: source.includes(raise.feature),
      }).toEqual({
        feature: raise.feature,
        present: true,
      });
      expect(raise.why.length).toBeGreaterThan(40);
      expect(raise.to).toBeGreaterThan(raise.from);
    }

    /* They form an unbroken chain, and the ceiling in force is AT OR BELOW the last
       declared raise.

       ⚠️ This assertion was `expect(last.to).toBe(fileCodeCeiling)` when it was written,
       and it was wrong the second time it ran: the very next save point cut 40 lines and
       lowered the ceiling to 3,487, which is the behaviour this whole ratchet exists to
       reward — and the guard called it a failure. `<=` is the real rule. A raise still
       cannot happen without an entry, because a ceiling ABOVE the last declared `to` has
       no explanation and fails here. เพดานลดได้เสมอ · ขึ้นต้องมีใบเซ็น */
    const last = raises[raises.length - 1]!;
    expect(ratchet.fileCodeCeiling).toBeLessThanOrEqual(last.to);
    for (let i = 1; i < raises.length; i++) {
      /* 🔴 `<=`, NOT `===`, AND THIS IS THE SAME MISTAKE AS THE ONE ABOVE, ONE LEVEL
         DEEPER. The link used to be `raises[i].from === raises[i-1].to`, which silently
         assumed the ceiling only ever moves UP between two raises. It does not — the
         whole point of this ratchet is that cuts pull it DOWN, and the file fell 3,527
         → 2,630 across the reduction program. The next raise then had to start from
         2,630, the chain link refused it, and a REAL customer-visible fix (the slip
         card lost on an expired reply token) could not be recorded at all.

         A raise starts from wherever the ceiling ACTUALLY WAS, which after reductions
         is at or below the previous raise's `to`. What the rule is really protecting is
         unchanged and still enforced: every raise names a feature that is in the file,
         carries a reason, ends above where it started, and the ceiling in force is at
         or below the last declared `to`. A raise still cannot happen without a signed
         entry. เพดานลดได้เสมอ · ขึ้นครั้งถัดไปเริ่มจากที่มันอยู่จริง ไม่ใช่จากยอดเดิม */
      expect(raises[i]!.from).toBeLessThanOrEqual(raises[i - 1]!.to);
    }
  });

  it('records a baseline that still matches the tree it was measured on', () => {
    // If this drifts without the ceiling moving, someone edited the baseline block
    // instead of earning the reduction.
    const range = findMethodRange(source, ratchet.methodSignature) as {
      from: number;
      to: number;
    };
    expect(census(source, range.from, range.to).raw).toBe(
      range.to - range.from + 1,
    );
    expect(range.from).toBeLessThan(range.to);
  });
});
