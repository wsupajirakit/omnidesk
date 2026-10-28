/**
 * [FEAT-20260908-AICAPLEDGER] The three caps, driven for real against real files.
 * ref: todo/task/07092026/be_todo109_07092026_aivendorcore.md §13 SAVE POINT 5
 * ============================================================================
 * The ledger mechanics moved into `ai-vendor/cap-ledger.ts`. The claim is "the
 * mechanism moved, nothing else did", and the only way to be sure is to run each
 * decorator ON and OFF, separately, against a throwaway file on disk — not to
 * read the diff and agree with myself.
 *
 * 🔴 REAL FILES, NOT A MOCKED `fs`. A mocked filesystem would pass even if the
 *    ledger were never written, which is the one thing a cap must actually do —
 *    the count has to survive a restart. Each case uses its own tmp file and
 *    deletes it after, so nothing here can touch the real budget ledger.
 *
 * ⚠️ THE THREE COUNTERS ARE SEPARATE AND STAY SEPARATE. A case below proves the
 *    translate ledger and the reply ledger do not see each other — that
 *    isolation is the reason translate has its own file at all: a translation
 *    budget must never be able to silence the customer-facing bot.
 *
 * revert: delete this file with `cap-ledger.ts`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AiCapDecorator,
  AiCapReachedError,
} from '../../src/modules/webhook/ai-reply/ai-cap.decorator';
import {
  AssistSummaryCapDecorator,
  AssistSummaryCapReachedError,
} from '../../src/modules/webhook/assist/assist-summary-cap.decorator';
import {
  TranslateCapDecorator,
  TranslateCapReachedError,
} from '../../src/modules/ai-translate/translate-cap.decorator';

let dir: string;
let n = 0;
/** A fresh ledger path per case — no case can inherit another's count. */
const ledger = (): string => join(dir, `cap-${(n += 1)}.json`);
const AT = () => '2026-09-08T00:00:00.000Z';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'aicap-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Minimal inners that only record that they were reached. */
const replyInner = (calls: string[]) => ({
  generate: (r: { question: string }) => {
    calls.push(r.question);
    /* The FULL AiReplyResponse — `noData` and `tagStatus` are required, and
       matching the real interface is what removes the `as never` casts. */
    return Promise.resolve({
      text: 'REPLY',
      noData: false,
      tagStatus: 'found' as const,
    });
  },
});
const summaryInner = (calls: string[]) => ({
  /* Returns the FULL response shape — `category` is required, and satisfying the
     real interface is what lets these stubs drop their `as never` casts. */
  summarise: (r: { currentQuestion?: string }) => {
    calls.push(r.currentQuestion ?? '');
    return Promise.resolve({ summary: 'SUM', category: 'Other' });
  },
});
const translateInner = (calls: string[]) => ({
  translate: (r: { targetLang: string }) => {
    calls.push(r.targetLang);
    return Promise.resolve({ text: 'TR' });
  },
});

const replyReq = { question: 'Q1', hookId: 'HOOK-1' };
const summaryReq = { currentQuestion: 'SQ1' };
const translateReq = { targetLang: 'en', text: 'x' };

describe('[FEAT-20260908-AICAPLEDGER] OPEN — under the limit, the call goes through', () => {
  it('reply: passes through, counts, and PERSISTS the count', async () => {
    const file = ledger();
    const seen: string[] = [];
    const cap = new AiCapDecorator(replyInner(seen), 2, file, AT);
    await cap.generate(replyReq as never);

    expect(seen).toEqual(['Q1']); // the inner really ran
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as {
      count: number;
      limit: number;
      calls: { at: string; hookId: string; question: string }[];
    };
    /* The whole point of a file-backed cap: it survives a restart. */
    expect(onDisk.count).toBe(1);
    expect(onDisk.limit).toBe(2);
    /* 🔴 THIS LANE'S ENTRY SHAPE — hookId AND question. Losing a field here
       would be invisible in behaviour and would blind the audit trail. */
    expect(onDisk.calls).toEqual([
      { at: AT(), hookId: 'HOOK-1', question: 'Q1' },
    ]);
  });

  it('summary: passes through and records ONLY the question (no hookId)', async () => {
    const file = ledger();
    const seen: string[] = [];
    const cap = new AssistSummaryCapDecorator(summaryInner(seen), 2, file, AT);
    await cap.summarise(summaryReq as never);

    expect(seen).toEqual(['SQ1']);
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as {
      calls: Record<string, unknown>[];
    };
    expect(onDisk.calls).toEqual([{ at: AT(), question: 'SQ1' }]);
    expect(Object.keys(onDisk.calls[0]!)).not.toContain('hookId');
  });

  it('translate: passes through and records the TARGET, not a question', async () => {
    const file = ledger();
    const seen: string[] = [];
    const cap = new TranslateCapDecorator(translateInner(seen), 2, file, AT);
    await cap.translate(translateReq as never);

    expect(seen).toEqual(['en']);
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as {
      calls: Record<string, unknown>[];
    };
    expect(onDisk.calls).toEqual([{ at: AT(), target: 'en' }]);
  });
});

describe('[FEAT-20260908-AICAPLEDGER] CLOSED — at the limit, the call is refused', () => {
  it('🔴 reply: throws its OWN error and the inner is never reached', async () => {
    const file = ledger();
    const seen: string[] = [];
    const cap = new AiCapDecorator(replyInner(seen), 1, file, AT);

    await cap.generate(replyReq as never); // spends the only slot
    await expect(cap.generate(replyReq as never)).rejects.toBeInstanceOf(
      AiCapReachedError,
    );
    /* Refused means NOT CALLED — a cap that still spends the vendor call while
       throwing would be worse than no cap. */
    expect(seen).toEqual(['Q1']);
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as { count: number }).count,
    ).toBe(1);
  });

  it('🔴 summary: throws AssistSummaryCapReachedError, not the reply error', async () => {
    const file = ledger();
    const seen: string[] = [];
    const cap = new AssistSummaryCapDecorator(summaryInner(seen), 1, file, AT);
    await cap.summarise(summaryReq as never);
    await expect(cap.summarise(summaryReq as never)).rejects.toBeInstanceOf(
      AssistSummaryCapReachedError,
    );
    expect(seen).toEqual(['SQ1']);
  });

  it('🔴 translate: throws TranslateCapReachedError, not a sibling error', async () => {
    /* The three error classes stay distinct because the handlers upstream catch
       them by type — collapsing them into one would silently change which
       feature degrades. */
    const file = ledger();
    const seen: string[] = [];
    const cap = new TranslateCapDecorator(translateInner(seen), 1, file, AT);
    await cap.translate(translateReq as never);
    await expect(cap.translate(translateReq as never)).rejects.toBeInstanceOf(
      TranslateCapReachedError,
    );
    expect(seen).toEqual(['en']);
  });
});

describe('[FEAT-20260908-AICAPLEDGER] the rules that make it a cap', () => {
  it('🔴 a CORRUPT ledger reads as EXHAUSTED, never as "0 used"', async () => {
    /* The one failure a cap must not have: a parse error handing out a whole
       fresh budget. Asserted for all three, because translate reaches the same
       rule through a different (log-free) path. */
    for (const build of [
      () => {
        const f = ledger();
        writeFileSync(f, '{ this is not json', 'utf8');
        return {
          run: () =>
            new AiCapDecorator(replyInner([]), 5, f, AT).generate(
              replyReq as never,
            ),
          err: AiCapReachedError,
        };
      },
      () => {
        const f = ledger();
        writeFileSync(f, '{ this is not json', 'utf8');
        return {
          run: () =>
            new AssistSummaryCapDecorator(summaryInner([]), 5, f, AT).summarise(
              summaryReq as never,
            ),
          err: AssistSummaryCapReachedError,
        };
      },
      () => {
        const f = ledger();
        writeFileSync(f, '{ this is not json', 'utf8');
        return {
          run: () =>
            new TranslateCapDecorator(translateInner([]), 5, f, AT).translate(
              translateReq as never,
            ),
          err: TranslateCapReachedError,
        };
      },
    ]) {
      const c = build();
      await expect(c.run()).rejects.toBeInstanceOf(c.err);
    }
  });

  it('🔴 the LIMIT comes from the caller — a number edited into the file is ignored', async () => {
    /* Otherwise the ledger could raise its own ceiling, and it would not be a
       cap. Every original read() did `limit: this.limit`; this pins that. */
    const file = ledger();
    writeFileSync(
      file,
      JSON.stringify({ count: 3, limit: 9999, calls: [] }),
      'utf8',
    );
    const seen: string[] = [];
    const cap = new AiCapDecorator(replyInner(seen), 3, file, AT);
    await expect(cap.generate(replyReq as never)).rejects.toBeInstanceOf(
      AiCapReachedError,
    );
    expect(seen).toEqual([]);
  });

  it("🔴 the ledger is REWRITTEN with the caller's limit, not the one it held", async () => {
    /* ⚠️ ADDED AFTER A MUTATION SURVIVED. The case above proves the REFUSAL
       ignores the file's limit — but it passes even if `readCapLedger` returns
       the file's number, because the decorator compares against `this.limit`
       directly. The returned value still reaches disk and `usage()`, so a file
       claiming `limit: 9999` would persist that back and every human reading the
       ledger would see the wrong ceiling. Assert the written value. */
    const file = ledger();
    writeFileSync(
      file,
      JSON.stringify({ count: 0, limit: 9999, calls: [] }),
      'utf8',
    );
    const cap = new AiCapDecorator(replyInner([]), 4, file, AT);
    await cap.generate(replyReq as never);
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as { limit: number }).limit,
    ).toBe(4);
    expect(cap.usage().limit).toBe(4);
  });

  it('🔴 remaining never goes NEGATIVE when a ledger is over its ceiling', () => {
    /* ⚠️ ADDED AFTER A MUTATION SURVIVED. Dropping the `Math.max(0, …)` clamp
       passed every case, because none of them had `count > limit`. That state is
       real: it is exactly what a lowered ceiling produces — the operator drops
       AI_CAP_LIMIT below what has already been spent. A negative "remaining"
       reads as budget available. */
    const file = ledger();
    writeFileSync(
      file,
      JSON.stringify({ count: 5, limit: 5, calls: [] }),
      'utf8',
    );
    const cap = new AiCapDecorator(replyInner([]), 3, file, AT);
    expect(cap.usage()).toEqual({ count: 5, limit: 3, remaining: 0 });
  });

  it('🔴 the slot is spent BEFORE the inner runs, so a crash cannot refund it', async () => {
    /* The documented ordering: the failure mode must be spending LESS than the
       limit, never more. If the increment moved after the call, a throwing
       inner would leave the count at 0 and the slot would be free again. */
    const file = ledger();
    const boom = {
      generate: (): Promise<{
        text: string | null;
        noData: boolean;
        tagStatus: 'found' | 'not_found' | null;
      }> => Promise.reject(new Error('vendor exploded')),
    };
    const cap = new AiCapDecorator(boom, 5, file, AT);
    await expect(cap.generate(replyReq as never)).rejects.toThrow(
      'vendor exploded',
    );
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as { count: number }).count,
    ).toBe(1);
  });

  it('🔴 a missing ledger starts at zero — but only a MISSING one', () => {
    const file = ledger(); // never written
    const cap = new AiCapDecorator(replyInner([]), 2, file, AT);
    expect(cap.usage()).toEqual({ count: 0, limit: 2, remaining: 0 + 2 });
  });

  it('🔴 the counters are ISOLATED — translate cannot silence the reply lane', async () => {
    /* The reason translate owns a separate file. Fill translate to its ceiling
       and the reply cap must be completely unaffected. */
    const translateFile = ledger();
    const replyFile = ledger();
    const tCap = new TranslateCapDecorator(
      translateInner([]),
      1,
      translateFile,
      AT,
    );
    await tCap.translate(translateReq as never);
    await expect(tCap.translate(translateReq as never)).rejects.toBeInstanceOf(
      TranslateCapReachedError,
    );

    const seen: string[] = [];
    const rCap = new AiCapDecorator(replyInner(seen), 1, replyFile, AT);
    await expect(rCap.generate(replyReq as never)).resolves.toBeDefined();
    expect(seen).toEqual(['Q1']); // the bot still answers
  });

  it('usage() reports without consuming a slot', async () => {
    const file = ledger();
    const seen: string[] = [];
    const cap = new AiCapDecorator(replyInner(seen), 3, file, AT);
    await cap.generate(replyReq as never);
    expect(cap.usage()).toEqual({ count: 1, limit: 3, remaining: 2 });
    expect(cap.usage()).toEqual({ count: 1, limit: 3, remaining: 2 });
    expect(seen).toHaveLength(1); // reading usage twice called nothing
  });
});
