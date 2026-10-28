import {
  BUSINESS_TZ_OFFSET_MINUTES,
  MAX_RANGE_DAYS,
  businessToday,
  resolveLogDateRange,
} from '@/common/utils/date-range';

/**
 * [FEAT-20260809-DATERANGE] Contract tests for the shared log date-range policy.
 *
 * Two properties are locked down, and they fail for different reasons:
 *   (A) TIMEZONE — a bare `YYYY-MM-DD` must mean a BANGKOK day. If this regresses, the
 *       "today" filter silently drops every event between 00:00 and 06:59 Bangkok, which
 *       looks like a working filter returning fewer rows rather than like a bug.
 *   (B) CAP — a window wider than MAX_RANGE_DAYS must be clamped, because the cap is the
 *       only thing standing between one request and a full-collection scan.
 * เทสนี้ต้องพังถ้ามีคนแก้ timezone หรือถอด cap ออก.
 */

const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('resolveLogDateRange — Bangkok day boundaries', () => {
  it('starts a bare date at 00:00 Bangkok, i.e. 17:00 UTC the previous day', () => {
    const { filter } = resolveLogDateRange('2026-08-09', undefined);
    // 2026-08-09T00:00+07:00 === 2026-08-08T17:00Z
    expect(iso(filter?.$gte ?? null)).toBe('2026-08-08T17:00:00.000Z');
  });

  it('ends a bare date at 23:59:59.999 Bangkok, i.e. 16:59:59.999Z the same day', () => {
    const { filter } = resolveLogDateRange(undefined, '2026-08-09');
    expect(iso(filter?.$lte ?? null)).toBe('2026-08-09T16:59:59.999Z');
  });

  it('covers a full Bangkok day for from===to (the "today" default)', () => {
    const { filter } = resolveLogDateRange('2026-08-09', '2026-08-09');
    expect(iso(filter?.$gte ?? null)).toBe('2026-08-08T17:00:00.000Z');
    expect(iso(filter?.$lte ?? null)).toBe('2026-08-09T16:59:59.999Z');
    // The window must be a full day minus one millisecond — not 17 hours, which is what a
    // naive UTC parse would produce and what this test exists to catch. Compared in ms:
    // dividing to seconds first rounds 86399.999 up to 86400 and hides a real off-by-a-day.
    const spanMs = filter!.$lte!.getTime() - filter!.$gte!.getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('includes an event at 00:30 Bangkok on the selected day', () => {
    // The concrete regression: 00:30 Bangkok is 17:30Z on the PREVIOUS UTC day.
    const { filter } = resolveLogDateRange('2026-08-09', '2026-08-09');
    const earlyMorning = new Date('2026-08-08T17:30:00.000Z');
    expect(earlyMorning >= filter!.$gte!).toBe(true);
    expect(earlyMorning <= filter!.$lte!).toBe(true);
  });

  it('passes a full ISO instant through untouched (no double shift)', () => {
    const { filter } = resolveLogDateRange(
      '2026-08-09T03:00:00.000Z',
      undefined,
    );
    expect(iso(filter?.$gte ?? null)).toBe('2026-08-09T03:00:00.000Z');
  });

  it('keeps an explicit +07:00 offset as the instant it names', () => {
    const { filter } = resolveLogDateRange(
      '2026-08-09T00:00:00+07:00',
      undefined,
    );
    expect(iso(filter?.$gte ?? null)).toBe('2026-08-08T17:00:00.000Z');
  });
});

describe('resolveLogDateRange — range cap', () => {
  it('leaves a window inside the cap alone', () => {
    const { clamped, filter } = resolveLogDateRange('2026-08-07', '2026-08-09');
    expect(clamped).toBe(false);
    expect(iso(filter?.$gte ?? null)).toBe('2026-08-06T17:00:00.000Z');
  });

  it('clamps a window wider than the cap by moving `from` forward', () => {
    const { clamped, filter, effectiveFrom } = resolveLogDateRange(
      '2026-01-01',
      '2026-08-09',
    );
    expect(clamped).toBe(true);
    // Keeps the most recent MAX_RANGE_DAYS ending at `to` — the latest activity, which is
    // what someone asking for a wide window almost always wants.
    const spanDays =
      (filter!.$lte!.getTime() - filter!.$gte!.getTime()) /
      (24 * 60 * 60 * 1000);
    expect(spanDays).toBeCloseTo(MAX_RANGE_DAYS, 5);
    expect(effectiveFrom!.getTime()).toBe(filter!.$gte!.getTime());
  });

  it('does not invent a missing bound — a one-sided range stays one-sided', () => {
    const openStart = resolveLogDateRange(undefined, '2026-08-09');
    expect(openStart.filter?.$gte).toBeUndefined();
    expect(openStart.clamped).toBe(false);

    const openEnd = resolveLogDateRange('2020-01-01', undefined);
    expect(openEnd.filter?.$lte).toBeUndefined();
    expect(openEnd.clamped).toBe(false);
  });
});

describe('resolveLogDateRange — degrade safely', () => {
  it('returns no filter when nothing usable was supplied', () => {
    expect(resolveLogDateRange(undefined, undefined).filter).toBeNull();
    // Junk is ignored rather than rejected, matching buildDateFilter in
    // webhook-log.query.ts so the two cannot disagree about the same input.
    expect(resolveLogDateRange('not-a-date', 'also-junk').filter).toBeNull();
  });

  it('keeps the good half when only one bound parses', () => {
    const { filter } = resolveLogDateRange('nonsense', '2026-08-09');
    expect(filter?.$gte).toBeUndefined();
    expect(iso(filter?.$lte ?? null)).toBe('2026-08-09T16:59:59.999Z');
  });
});

describe('businessToday', () => {
  it('returns the Bangkok calendar day, not the UTC one', () => {
    // 2026-08-08T18:00Z is already 2026-08-09 in Bangkok.
    expect(businessToday(new Date('2026-08-08T18:00:00.000Z'))).toBe(
      '2026-08-09',
    );
    expect(businessToday(new Date('2026-08-08T16:00:00.000Z'))).toBe(
      '2026-08-08',
    );
  });

  it('agrees with the offset constant', () => {
    expect(BUSINESS_TZ_OFFSET_MINUTES).toBe(420);
  });
});
