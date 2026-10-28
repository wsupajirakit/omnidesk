/**
 * [FEAT-20260902-NOWBLOCK] The block as the model receives it.
 *
 * What is pinned here is a CONTRACT with every OA's training document: the fence
 * names, the key names, their order, and the exact `key = value` shape. A document
 * is written against this text, so a change here is a change every OA can see —
 * these cases exist so that such a change has to be deliberate.
 *
 * revert: delete this file with the `now-block/` folder.
 */
import {
  NOW_BLOCK_END,
  NOW_BLOCK_START,
  buildNowBlock,
  resolveNowFacts,
} from '@/modules/webhook/now-block/now-block.builder';
import type { HolidaySource } from '@/modules/webhook/now-block/calendar/holiday-source.port';

/** A UTC instant for a Bangkok wall clock on 2 Sep 2026 — never a local literal. */
const bangkok = (hh: number, mm = 0, day = 2): Date =>
  new Date(Date.UTC(2026, 8, day, hh - 7, mm, 0));

const THAI_LINE = 'วันพุธที่ 02 กันยายน 69 22:53:11';

/** A calendar under the test's control — the port earning its keep already. */
const calendarWith = (rows: Record<string, string>): HolidaySource => ({
  lookup: (iso) => rows[iso] ?? null,
  lastCoveredDate: () => '2026-12-31',
});

const emptyCalendar = calendarWith({});

describe('[NOWBLOCK] the fences', () => {
  /* Not cosmetic. The outbound sweep that runs before a reply reaches a customer
     strips `[START_OF_*]` / `[END_OF_*]` and nothing else, so a model that echoes
     a fence back is covered for free — but ONLY at these exact names. A rename to
     `[NOW]` would put the literal text in a customer's chat with nothing failing. */
  it('are the shape the outbound sweep already knows', () => {
    expect(NOW_BLOCK_START).toBe('[START_OF_NOW]');
    expect(NOW_BLOCK_END).toBe('[END_OF_NOW]');
  });

  it('open and close the block', () => {
    const text = buildNowBlock({
      instant: bangkok(14),
      datetimeTh: THAI_LINE,
      holidays: emptyCalendar,
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('[START_OF_NOW]');
    expect(lines[lines.length - 1]).toBe('[END_OF_NOW]');
  });
});

describe('[NOWBLOCK] the key contract', () => {
  const text = buildNowBlock({
    instant: bangkok(22, 53),
    datetimeTh: THAI_LINE,
    holidays: emptyCalendar,
  });

  it('carries exactly these keys, in this order', () => {
    const keys = text
      .split('\n')
      .filter((l) => l.includes(' = '))
      .map((l) => l.split(' = ')[0]);
    expect(keys).toEqual([
      'datetime_th',
      'date_iso',
      'time_24h',
      'office_hours',
      'is_holiday',
      'holiday_name',
      'status',
      'append_time_suffix',
    ]);
  });

  /* On the `ai_stable_prompt === false` branch this text is concatenated into the
     training-document string and then walked by the unknown-tag-marker scan. A key
     shaped `<word>_<letter>_<digits>` would file a bogus `dynamic_tag_marker_mismatch`
     row on every single reply. Today's keys are clear; the next key added is where
     it breaks, which is why this is pinned rather than left to memory. */
  it('no key can be mistaken for a dynamic-tag marker', () => {
    const TAG_MARKER_RE = /(?:odk_[a-z]+_\d+|[a-z]+_[a-z]_\d+)/i;
    const keys = text
      .split('\n')
      .filter((l) => l.includes(' = '))
      .map((l) => l.split(' = ')[0] as string);
    for (const key of keys) expect(key).not.toMatch(TAG_MARKER_RE);
  });

  it('renders every value on its own single line', () => {
    for (const line of text.split('\n')) expect(line).not.toContain('\n');
    expect(text.split('\n')).toHaveLength(10); // 2 fences + 8 keys
  });
});

describe('[NOWBLOCK] the values', () => {
  it('passes the Thai date line through verbatim — it never formats its own', () => {
    const text = buildNowBlock({
      instant: bangkok(14),
      datetimeTh: THAI_LINE,
      holidays: emptyCalendar,
    });
    expect(text).toContain(`datetime_th = ${THAI_LINE}`);
  });

  it('renders a dash rather than inventing a format when the line is missing', () => {
    const text = buildNowBlock({
      instant: bangkok(14),
      holidays: emptyCalendar,
    });
    expect(text).toContain('datetime_th = -');
  });

  it('derives the Bangkok date and clock from the instant', () => {
    const facts = resolveNowFacts({
      instant: bangkok(22, 53),
      datetimeTh: THAI_LINE,
      holidays: emptyCalendar,
    });
    expect(facts.dateIso).toBe('2026-09-02');
    expect(facts.time24h).toBe('22:53');
  });

  /* 23:30 Bangkok is 16:30 UTC on the SAME day, but 00:30 Bangkok is 17:30 UTC on
     the PREVIOUS day. A date derived from the process clock would be a day out for
     the whole Bangkok early morning, silently, and only on a UTC machine. */
  it('the date belongs to the Bangkok day, not the UTC day', () => {
    const justAfterMidnight = new Date(Date.UTC(2026, 8, 2, 17, 30, 0)); // 03/09 00:30 in Bangkok
    const facts = resolveNowFacts({
      instant: justAfterMidnight,
      holidays: emptyCalendar,
    });
    expect(facts.dateIso).toBe('2026-09-03');
    expect(facts.time24h).toBe('00:30');
  });

  it('names the holiday and flips is_holiday together', () => {
    const text = buildNowBlock({
      instant: bangkok(14, 0, 12),
      datetimeTh: THAI_LINE,
      holidays: calendarWith({ '2026-08-12': 'วันแม่แห่งชาติ' }),
    });
    // the calendar row is keyed on the Bangkok day of that instant
    expect(text).toContain('is_holiday = false');
    const onTheDay = buildNowBlock({
      instant: new Date(Date.UTC(2026, 7, 12, 7, 0, 0)), // 12/08/2026 14:00 Bangkok
      datetimeTh: THAI_LINE,
      holidays: calendarWith({ '2026-08-12': 'วันแม่แห่งชาติ' }),
    });
    expect(onTheDay).toContain('is_holiday = true');
    expect(onTheDay).toContain('holiday_name = วันแม่แห่งชาติ');
    expect(onTheDay).toContain('status = HOLIDAY');
  });

  it('shows a dash for holiday_name on an ordinary day', () => {
    const text = buildNowBlock({
      instant: bangkok(14),
      holidays: emptyCalendar,
    });
    expect(text).toContain('holiday_name = -');
  });

  it('status and append_time_suffix always agree', () => {
    const open = resolveNowFacts({
      instant: bangkok(14),
      holidays: emptyCalendar,
    });
    expect(open.status).toBe('OPEN');
    expect(open.appendTimeSuffix).toBe(false);

    const closed = resolveNowFacts({
      instant: bangkok(22),
      holidays: emptyCalendar,
    });
    expect(closed.status).toBe('AFTER_CLOSE');
    expect(closed.appendTimeSuffix).toBe(true);
  });
});

describe('[NOWBLOCK] values are sanitised before they reach the prompt', () => {
  /* `substituteCtxVars` rewrites `{{…}}` silently and never throws, and it runs
     over this text on the opt-out branch. A holiday name carrying braces would be
     quietly rewritten into something nobody wrote. */
  it('strips braces so the ctx-var rewriter has nothing to rewrite', () => {
    const text = buildNowBlock({
      instant: new Date(Date.UTC(2026, 7, 12, 7, 0, 0)),
      holidays: calendarWith({ '2026-08-12': 'วันแม่ {{hook_domain}}' }),
    });
    expect(text).not.toContain('{{');
    expect(text).toContain('holiday_name = วันแม่ hook_domain');
  });

  it('collapses newlines so the key = value shape survives', () => {
    const text = buildNowBlock({
      instant: bangkok(14),
      datetimeTh: 'วันพุธ\nแทรกบรรทัด',
      holidays: emptyCalendar,
    });
    expect(text.split('\n')).toHaveLength(10);
    expect(text).toContain('datetime_th = วันพุธ แทรกบรรทัด');
  });
});
