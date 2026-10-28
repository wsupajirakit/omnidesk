/**
 * [FEAT-20260824-BCASTTIMEDOOR] One door for every admin-supplied time.
 *
 * Owner, 24/08: *"ทำ single truth เรื่องเวลา boardcast ต้องผ่านจุดเดียว"* ·
 * *"เวลาที่ถูกต้องใน db ห้ามงง"* · the written half is `docs/TIME-RULE.md`.
 */
import {
  DEFAULT_INPUT_OFFSET,
  carriesOffset,
  parseAdminTime,
} from '@/modules/content/broadcast-time';

describe('carriesOffset — which strings say WHICH instant', () => {
  it('accepts every unambiguous shape', () => {
    expect(carriesOffset('2026-08-24T15:00:00+07:00')).toBe(true);
    expect(carriesOffset('2026-08-24T15:00:00+0700')).toBe(true);
    expect(carriesOffset('2026-08-24T08:00:00Z')).toBe(true);
    expect(carriesOffset('2026-08-24T15:00:00-05:00')).toBe(true);
    /* A bare DATE is unambiguous — ISO says UTC midnight and there is no hour
       for a zone to move. วันที่ล้วนไม่กำกวม. */
    expect(carriesOffset('2026-08-24')).toBe(true);
  });

  it('🔴 rejects exactly what `datetime-local` produces', () => {
    expect(carriesOffset('2026-08-24T15:00')).toBe(false);
    expect(carriesOffset('2026-08-24T15:00:00')).toBe(false);
    expect(carriesOffset('2026-08-24 15:00')).toBe(false);
  });
});

describe('parseAdminTime — the instant does NOT depend on the server', () => {
  it('🔴 an offset-less value is read at the DECLARED zone, not the process one', () => {
    /* The whole point. Before this door, `new Date("2026-08-24T15:00")` meant
       08:00Z on a Bangkok machine and 15:00Z in a UTC container — the same
       campaign, seven hours apart, silently.
       ตอนนี้ความหมายมาจากค่าที่ประกาศไว้ ไม่ใช่ TZ ของเครื่อง. */
    expect(DEFAULT_INPUT_OFFSET).toBe('+07:00');
    expect(parseAdminTime('2026-08-24T15:00', 'x')?.toISOString()).toBe(
      '2026-08-24T08:00:00.000Z',
    );
    expect(parseAdminTime('2026-08-24T15:00:00', 'x')?.toISOString()).toBe(
      '2026-08-24T08:00:00.000Z',
    );
  });

  it('🔴 an explicit offset always wins over the default', () => {
    expect(parseAdminTime('2026-08-24T15:00:00Z', 'x')?.toISOString()).toBe(
      '2026-08-24T15:00:00.000Z',
    );
    expect(
      parseAdminTime('2026-08-24T15:00:00-05:00', 'x')?.toISOString(),
    ).toBe('2026-08-24T20:00:00.000Z');
  });

  it('🔴 it never adds or subtracts hours of its own', () => {
    /* "Fixing" the display by shifting before storage is the thing that really
       breaks it. 15:00+07:00 IS 08:00Z — that is the same moment, not an error.
       ห้ามบวก/ลบชั่วโมงเอง. */
    const a = parseAdminTime('2026-08-24T15:00:00+07:00', 'x');
    const b = parseAdminTime('2026-08-24T08:00:00Z', 'x');
    expect(a?.getTime()).toBe(b?.getTime());
  });

  it('🔴 absent stays absent — an empty box never becomes "now"', () => {
    expect(parseAdminTime(undefined, 'x')).toBeUndefined();
    expect(parseAdminTime(null, 'x')).toBeUndefined();
    expect(parseAdminTime('', 'x')).toBeUndefined();
  });

  it('a Date from Mongo passes through untouched', () => {
    const d = new Date('2026-08-24T08:00:00.000Z');
    expect(parseAdminTime(d, 'x')).toBe(d);
  });

  it('epoch milliseconds are an instant too', () => {
    const ms = Date.parse('2026-08-24T08:00:00.000Z');
    expect(parseAdminTime(ms, 'x')?.toISOString()).toBe(
      '2026-08-24T08:00:00.000Z',
    );
  });

  it('🔴 garbage is refused with the FIELD NAME, not a generic message', () => {
    /* An admin has to know WHICH box to fix. */
    expect(() => parseAdminTime('ไม่ใช่วันที่', 'scheduled_at')).toThrow(
      /scheduled_at/,
    );
    expect(() => parseAdminTime({}, 'sent_at')).toThrow(/sent_at/);
    expect(() => parseAdminTime(new Date('nope'), 'ends_at')).toThrow(
      /ends_at/,
    );
  });
});
