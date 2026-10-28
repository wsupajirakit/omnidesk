/**
 * [FEAT-20260822-BCASTCOUNTERS] What a history row must be able to answer, and
 * the seam that keeps recipient ids OUT of it until someone decides otherwise.
 */
import {
  EMPTY_COUNTERS,
  NoopRecipientLedger,
  RECIPIENT_CAPTURE,
  RECIPIENT_LIST_KINDS,
  addChunkResult,
  currentCaptureFlags,
  isCapturing,
  mergeCounters,
  summarizeRun,
} from '@/modules/content';

describe('run counters — "ทำไปเท่าไหร่" and "ครบไหม"', () => {
  const base = { ...EMPTY_COUNTERS, matched: 1000, targeted: 1000 };

  it('everything accepted reads as success and complete', () => {
    const s = summarizeRun({ ...base, sent: 1000 });
    expect(s.status).toBe('success');
    expect(s.complete).toBe(true);
    expect(s.deliveredRatio).toBe(1);
  });

  it('some accepted, some not, is partial — not success, not error', () => {
    const s = summarizeRun({ ...base, sent: 600, failed: 400 });
    expect(s.status).toBe('partial');
    expect(s.complete).toBe(true); // every target got an attempt
    expect(s.deliveredRatio).toBeCloseTo(0.6);
  });

  it('tried and nothing landed is an error', () => {
    expect(summarizeRun({ ...base, failed: 1000 }).status).toBe('error');
  });

  it('stopped halfway is neither partial nor error — it is stopped', () => {
    const s = summarizeRun(
      { ...base, sent: 300, unsent: 700 },
      { stopped: true },
    );
    expect(s.status).toBe('stopped');
    expect(s.complete).toBe(false);
  });

  it('refused before starting is NOT the same as matching nobody', () => {
    // Both have zero sent; a reader must be able to tell them apart.
    const refused = summarizeRun({ ...base, sent: 0 }, { refused: true });
    const nobody = summarizeRun({ ...EMPTY_COUNTERS });
    expect(refused.status).toBe('refused');
    expect(nobody.status).toBe('success');
    expect(nobody.complete).toBe(true);
  });

  it('folds a chunk result in without mutating the previous counters', () => {
    const start = {
      ...EMPTY_COUNTERS,
      targeted: 1000,
      unsent: 1000,
      chunksPlanned: 2,
    };
    const after = addChunkResult(start, 500, true);
    expect(after.sent).toBe(500);
    expect(after.unsent).toBe(500);
    expect(after.chunksDone).toBe(1);
    expect(after.requestsMade).toBe(1);
    expect(start.sent).toBe(0); // untouched
  });

  it('🔴 `unsent` can never go negative — it is a headcount, not a balance', () => {
    /* A surviving mutant: dropping the clamp left every test green, so a run
       whose chunk was bigger than what it had left to do could report
       `unsent: -400`. A negative headcount poisons the history row and every
       total built from it, and nobody would see it until a customer asked.
       ค้างส่งติดลบไม่มีในโลกจริง = ตัวนับพัง ต้องหนีบไว้ที่ศูนย์. */
    const after = addChunkResult(
      { ...EMPTY_COUNTERS, targeted: 100, unsent: 100 },
      500,
      true,
    );
    expect(after.unsent).toBe(0);
  });

  it('🔴 merging OA counts can never report a negative `unsent` either', () => {
    // The same clamp, on the other side of the fold: two OAs that between them
    // attempted more than the run targeted must read 0, never -3.
    const merged = mergeCounters(
      { ...EMPTY_COUNTERS, matched: 10, targeted: 10, sent: 8 },
      { ...EMPTY_COUNTERS, sent: 5 },
    );
    expect(merged.unsent).toBe(0);
    expect(merged.sent).toBe(13); // the sum itself is untouched
  });

  it('a failed chunk counts as failed, still consumes a request', () => {
    const after = addChunkResult(
      { ...EMPTY_COUNTERS, unsent: 500 },
      500,
      false,
    );
    expect(after.failed).toBe(500);
    expect(after.sent).toBe(0);
    expect(after.requestsMade).toBe(1);
  });
});

describe('recipient ledger — ids stay out of the row until asked for', () => {
  it('all three lists are off today', () => {
    for (const kind of RECIPIENT_LIST_KINDS) {
      expect(isCapturing(kind)).toBe(false);
      expect(RECIPIENT_CAPTURE[kind]).toBe(false);
    }
  });

  it('offers exactly the three the owner named', () => {
    expect([...RECIPIENT_LIST_KINDS].sort()).toEqual([
      'matched',
      'sent',
      'unsent',
    ]);
  });

  it('the row records that capture was off — "not stored" is not "nobody"', () => {
    expect(currentCaptureFlags()).toEqual({
      matched: false,
      sent: false,
      unsent: false,
    });
  });

  it('the no-op ledger never throws and never resolves to anything', async () => {
    const led = new NoopRecipientLedger();
    await expect(
      led.record({ runId: 'r1', hookId: 'h1', kind: 'sent', ids: ['U1'] }),
    ).resolves.toBeUndefined();
  });
});
